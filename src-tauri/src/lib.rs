pub mod disk;
pub mod domain;
pub mod github;
pub mod ide;
#[cfg(feature = "mcp")]
pub mod mcp;
mod process;
pub mod scanner;
pub mod storage;

use crate::domain::{
    CleanupPreview, CleanupRequest, CloneRepoRequest, GitHubAccountStatus, GitHubRepo,
    IdeSettings, PortInfo, ProcessInfo, Project, ProjectDetail, ProjectStatus,
    RegisterProjectRequest, RunProjectRequest, SafeOffloadResult,
};
use crate::process::ProcessManager;
use crate::scanner::{canonical_project_path, command_for_action, scan_project};
use crate::storage::Storage;
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use uuid::Uuid;

pub struct AppState {
    storage: Arc<Mutex<Storage>>,
    processes: ProcessManager,
}

#[tauri::command]
fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, String> {
    let mut projects = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.list_projects()?;
    for project in &mut projects {
        if state.processes.get(&project.id).is_some() {
            project.status = ProjectStatus::Running;
        } else if is_project_running(project).is_some() {
            project.status = ProjectStatus::Running;
        }
    }
    Ok(projects)
}

#[tauri::command]
fn register_project(request: RegisterProjectRequest, state: tauri::State<'_, AppState>) -> Result<Project, String> {
    let requested_path = absolute_input_path(&request.path)?;
    let root = canonical_project_path(&request.path)?;
    let scan = scan_project(&root)?;
    let report = disk::disk_report("pending", &root)?;
    let path = requested_path.to_string_lossy().to_string();
    let canonical_path = root.to_string_lossy().to_string();
    let name = request.name.filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| root.file_name().and_then(|name| name.to_str()).unwrap_or("Proyecto sin nombre").to_string());
    let mut project = Project {
        id: Uuid::new_v4().to_string(), name: name.trim().to_string(), path, canonical_path,
        project_type: scan.project_type, frameworks: scan.frameworks, package_manager: scan.package_manager,
        dev_command: scan.dev_command, build_command: scan.build_command, test_command: scan.test_command,
        local_url: scan.local_url, port: scan.port, status: ProjectStatus::Stopped, last_used_at: None,
        disk_size_bytes: report.total_bytes, tags: request.tags.into_iter().map(|tag| tag.trim().to_string()).filter(|tag| !tag.is_empty()).collect(),
        created_at: Utc::now().to_rfc3339(), last_error: None,
    };
    if is_project_running(&project).is_some() {
        project.status = ProjectStatus::Running;
    }
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.insert_project(&project)?;
    Ok(project)
}

#[tauri::command]
fn get_project_detail(project_id: String, state: tauri::State<'_, AppState>) -> Result<ProjectDetail, String> {
    let mut project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    let mut process_info = state.processes.get(&project_id);
    if process_info.is_none() {
        if let Some(pid) = is_project_running(&project) {
            project.status = ProjectStatus::Running;
            process_info = Some(ProcessInfo {
                project_id: project_id.clone(),
                pid,
                started_at: project.created_at.clone(),
                command: project.dev_command.clone().unwrap_or_else(|| {
                    project.port.map(|p| format!("Servidor activo en puerto {p}")).unwrap_or_else(|| "Proceso activo".into())
                }),
            });
        }
    } else {
        project.status = ProjectStatus::Running;
    }
    let root = match trusted_project_root(&project) {
        Ok(r) => r,
        Err(_) => {
            let _ = state.storage.lock().map(|db| db.delete_project(&project_id));
            return Err("La carpeta del proyecto ya no existe en el disco y ha sido removida de la lista.".into());
        }
    };
    let scan = scan_project(&root)?;
    let recent_commands = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.recent_commands(&project_id)?;
    Ok(ProjectDetail { process: process_info, project, scan, recent_commands })
}

#[tauri::command]
fn refresh_project(project_id: String, state: tauri::State<'_, AppState>) -> Result<Project, String> {
    let mut project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    let root = match trusted_project_root(&project) {
        Ok(r) => r,
        Err(_) => {
            let _ = state.storage.lock().map(|db| db.delete_project(&project_id));
            return Err("La carpeta del proyecto ya no existe en el disco y ha sido removida de la lista.".into());
        }
    };
    let scan = scan_project(&root)?;
    let report = disk::disk_report(&project_id, &root)?;
    project.project_type = scan.project_type;
    project.frameworks = scan.frameworks;
    project.package_manager = scan.package_manager;
    project.dev_command = scan.dev_command;
    project.build_command = scan.build_command;
    project.test_command = scan.test_command;
    project.local_url = scan.local_url;
    project.port = scan.port;
    project.disk_size_bytes = report.total_bytes;
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.refresh_project_metadata(&project)?;
    Ok(project)
}

#[tauri::command]
fn unregister_project(project_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.delete_project(&project_id)?;
    Ok(())
}

#[tauri::command]
fn run_project(request: RunProjectRequest, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<ProcessInfo, String> {
    let mut project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&request.project_id)?;
    let root = trusted_project_root(&project)?;
    let mut scan = scan_project(&root)?;

    if request.action == "dev" {
        if !scan.installed_dependencies && scan.declared_dependencies > 0 {
            return Err("Primero debes instalar las dependencias del proyecto antes de iniciar el servidor de desarrollo.".into());
        }
        if let Some(port) = scan.port {
            if scanner::is_port_in_use(port) {
                let next_port = scanner::find_next_available_port(port);
                if next_port != port {
                    scan.port = Some(next_port);
                    scan.local_url = Some(format!("http://localhost:{next_port}"));
                    project.port = Some(next_port);
                    project.local_url = Some(format!("http://localhost:{next_port}"));
                    let _ = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.refresh_project_metadata(&project);
                }
            }
        }
    }

    let spec = command_for_action(&root, &scan, &request.action, request.script.as_deref())?;
    match state.processes.start(app, state.storage.clone(), project.clone(), request.action, spec) {
        Ok(process) => Ok(process),
        Err(error) => {
            let _ = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.update_status(&project.id, ProjectStatus::Error, Some(&error));
            Err(error)
        }
    }
}

#[tauri::command]
fn stop_project(project_id: String, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.processes.stop(&app, &state.storage, &project_id)
}

#[tauri::command]
fn restart_project(project_id: String, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<ProcessInfo, String> {
    let _ = state.processes.stop(&app, &state.storage, &project_id);
    run_project(RunProjectRequest { project_id, action: "dev".into(), script: None }, app, state)
}

#[tauri::command]
fn get_disk_report(project_id: String, state: tauri::State<'_, AppState>) -> Result<crate::domain::DiskReport, String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    disk::disk_report(&project_id, &trusted_project_root(&project)?)
}

#[tauri::command]
fn preview_cleanup(project_id: String, state: tauri::State<'_, AppState>) -> Result<CleanupPreview, String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    disk::cleanup_preview(&project_id, &trusted_project_root(&project)?)
}

#[tauri::command]
fn clean_project(request: CleanupRequest, state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    if !request.confirmed { return Err("Limpieza bloqueada: primero revisa el dry-run y confirma explícitamente la acción.".into()); }
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&request.project_id)?;
    let root = trusted_project_root(&project)?;
    let (deleted, _) = disk::clean_targets(&root, &request.targets)?;
    let _ = refresh_project(request.project_id, state)?;
    Ok(deleted)
}

#[tauri::command]
fn get_ide_settings(state: tauri::State<'_, AppState>) -> Result<IdeSettings, String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.ide_settings()
}

#[tauri::command]
fn save_ide_settings(settings: IdeSettings, state: tauri::State<'_, AppState>) -> Result<IdeSettings, String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.save_ide_settings(&settings)?;
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.ide_settings()
}

#[tauri::command]
fn launch_project_tool(project_id: String, tool_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    let root = trusted_project_root(&project)?;
    let settings = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.ide_settings()?;
    ide::launch_tool(&settings, &tool_id, &root)
}

#[tauri::command]
fn open_project_url(project_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    if project.status != ProjectStatus::Running && is_project_running(&project).is_none() {
        return Err("El proyecto no está en ejecución. Inicia el proyecto antes de abrir su URL.".into());
    }
    let url = project.local_url.ok_or_else(|| "No hay una URL local detectada. Declara un puerto en el script, por ejemplo --port 5173.".to_string())?;
    ide::open_url(&url)
}

#[tauri::command]
fn inspect_project_port(project_id: String, state: tauri::State<'_, AppState>) -> Result<Option<PortInfo>, String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    let Some(port) = project.port else { return Ok(None); };
    let pid = is_project_running(&project);
    Ok(Some(PortInfo { port, pid, listening: pid.is_some() }))
}

fn is_project_running(project: &Project) -> Option<u32> {
    let port = project.port?;
    let output = Command::new("lsof").args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"]).output().ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    let canonical = Path::new(&project.canonical_path);
    for line in stdout.lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            if let Some(cwd) = get_process_cwd(pid) {
                let cwd_path = Path::new(&cwd);
                if cwd_path == canonical || cwd_path.starts_with(canonical) || canonical.starts_with(cwd_path) {
                    return Some(pid);
                }
            }
        }
    }
    None
}

fn get_process_cwd(pid: u32) -> Option<String> {
    let output = Command::new("lsof").args(["-p", &pid.to_string(), "-a", "-d", "cwd", "-Fn"]).output().ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix('n') {
            return Some(path.to_string());
        }
    }
    None
}

fn absolute_input_path(raw: &str) -> Result<PathBuf, String> {
    let input = Path::new(raw);
    if input.is_absolute() { return Ok(input.to_path_buf()); }
    std::env::current_dir().map(|cwd| cwd.join(input)).map_err(|error| format!("No se pudo resolver la ruta absoluta: {error}"))
}

fn trusted_project_root(project: &Project) -> Result<PathBuf, String> {
    let root = Path::new(&project.canonical_path);
    let canonical = std::fs::canonicalize(root).map_err(|_| format!("La carpeta registrada ya no está disponible: {}", project.path))?;
    if canonical != root {
        return Err("Operación bloqueada: la ruta canónica del proyecto cambió. Vuelve a registrar la carpeta para continuar.".into());
    }
    if !canonical.is_dir() { return Err("Operación bloqueada: la ruta registrada no es una carpeta.".into()); }
    Ok(canonical)
}

#[tauri::command]
fn get_github_status(custom_token: Option<String>, state: tauri::State<'_, AppState>) -> Result<GitHubAccountStatus, String> {
    let storage_token = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_setting("github_token")?;
    let token = github::GitHubService::resolve_token(custom_token.as_deref(), storage_token);
    github::GitHubService::get_account_status(token.as_deref())
}

#[tauri::command]
fn save_github_token(token: String, state: tauri::State<'_, AppState>) -> Result<GitHubAccountStatus, String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.set_setting("github_token", &token)?;
    github::GitHubService::get_account_status(Some(&token))
}

#[tauri::command]
fn list_github_repos(custom_token: Option<String>, state: tauri::State<'_, AppState>) -> Result<Vec<GitHubRepo>, String> {
    let storage_token = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_setting("github_token")?;
    let token = github::GitHubService::resolve_token(custom_token.as_deref(), storage_token);
    let local_projects = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.list_projects()?;
    github::GitHubService::list_repos(token.as_deref(), &local_projects)
}

#[tauri::command]
fn clone_github_repo(request: CloneRepoRequest, state: tauri::State<'_, AppState>) -> Result<Project, String> {
    let storage_token = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_setting("github_token")?;
    let token = github::GitHubService::resolve_token(None, storage_token);
    let project = github::GitHubService::clone_and_register(
        &request.repo_name,
        &request.clone_url,
        request.is_private,
        token.as_deref(),
        request.target_path.as_deref(),
    )?;
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.insert_project(&project)?;
    Ok(project)
}

#[tauri::command]
fn safe_offload_project(project_id: String, force: bool, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<SafeOffloadResult, String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    if state.processes.get(&project_id).is_some() {
        let _ = state.processes.stop(&app, &state.storage, &project_id);
    }
    let path = Path::new(&project.canonical_path);
    github::GitHubService::safe_offload_project(path, force)?;
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.delete_project(&project_id)?;
    Ok(SafeOffloadResult {
        success: true,
        project_id,
        project_name: project.name,
        message: "Proyecto archivado y carpeta local liberada de forma segura.".to_string(),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            let database_path = data_dir.join("dev-command-center.sqlite3");
            let storage = Storage::open(&database_path).map_err(|error| -> Box<dyn std::error::Error> { Box::new(std::io::Error::other(error)) })?;
            app.manage(AppState { storage: Arc::new(Mutex::new(storage)), processes: ProcessManager::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects, register_project, unregister_project, get_project_detail, refresh_project, run_project, stop_project, restart_project,
            get_disk_report, preview_cleanup, clean_project, get_ide_settings, save_ide_settings, launch_project_tool,
            open_project_url, inspect_project_port,
            get_github_status, save_github_token, list_github_repos, clone_github_repo, safe_offload_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dev Command Center");
}
