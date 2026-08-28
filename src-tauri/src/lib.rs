pub mod disk;
pub mod domain;
pub mod github;
pub mod ide;
#[cfg(feature = "mcp")]
pub mod mcp;
pub mod process;
pub mod scanner;
pub mod storage;

use crate::domain::{
    CleanupPreview, CleanupRequest, CloneRepoRequest, GitHubAccountStatus, GitHubRepo,
    IdeSettings, PortInfo, ProcessInfo, Project, ProjectDetail, ProjectStatus,
    RegisterProjectRequest, RunProjectRequest, SafeOffloadResult,
};
use crate::process::ProcessManager;
use crate::scanner::{canonical_project_path, scan_project};
use crate::storage::Storage;
use chrono::Utc;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use uuid::Uuid;

use std::collections::HashMap;

/// Ventana durante la cual se reutiliza el resultado de `lsof` en lugar de
/// volver a lanzar el subproceso. El sondeo de la interfaz ocurre cada 6 s y
/// varias rutas (foco de ventana, eventos de estado, detalle) pueden coincidir
/// en el mismo instante: la caché evita multiplicar procesos externos.
const PROBE_TTL: Duration = Duration::from_millis(2_500);

type PortMap = HashMap<u16, Vec<(u32, String)>>;

pub struct AppState {
    storage: Arc<Mutex<Storage>>,
    processes: ProcessManager,
}

#[tauri::command(async)]
fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, String> {
    let mut projects = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.list_projects()?;
    update_projects_status_batch(&mut projects, &state.processes);
    Ok(projects)
}

#[tauri::command(async)]
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
        created_at: Utc::now().to_rfc3339(), last_error: None, is_pinned: false,
    };
    if is_project_running(&project).is_some() {
        project.status = ProjectStatus::Running;
    }
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.insert_project(&project)?;
    Ok(project)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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

/// Reescanea todos los proyectos registrados y reescribe sus metadatos. Hace
/// falta porque `project_type`, frameworks y comandos sólo se recalculan al
/// registrar o al pulsar «Actualizar»: al cambiar el detector, las filas viejas
/// conservaban etiquetas que la versión actual ya no produce.
///
/// A propósito no recalcula el tamaño en disco: recorrer 30 proyectos con sus
/// `node_modules` y `target` tarda minutos, y aquí sólo interesa la detección.
#[tauri::command(async)]
fn refresh_all_projects(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, String> {
    let projects = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.list_projects()?;
    for mut project in projects {
        let Ok(root) = trusted_project_root(&project) else { continue };
        let Ok(scan) = scan_project(&root) else { continue };
        project.project_type = scan.project_type;
        project.frameworks = scan.frameworks;
        project.package_manager = scan.package_manager;
        project.dev_command = scan.dev_command;
        project.build_command = scan.build_command;
        project.test_command = scan.test_command;
        project.local_url = scan.local_url;
        project.port = scan.port;
        // `project.disk_size_bytes` viaja sin tocar, así que se reescribe con el
        // valor que ya tenía en la base.
        let _ = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.refresh_project_metadata(&project);
    }
    let mut refreshed = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.list_projects()?;
    update_projects_status_batch(&mut refreshed, &state.processes);
    Ok(refreshed)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectRequest {
    pub project_id: String,
    pub delete_files: bool,
}

#[tauri::command(async)]
fn delete_project(request: DeleteProjectRequest, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&request.project_id)?;
    let _ = state.processes.stop(&app, &state.storage, &request.project_id);
    if request.delete_files {
        let path = Path::new(&project.canonical_path);
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|e| format!("No se pudo borrar la carpeta del disco: {e}"))?;
        }
    }
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.delete_project(&request.project_id)?;
    Ok(())
}

#[tauri::command(async)]
fn unregister_project(project_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.delete_project(&project_id)?;
    Ok(())
}

#[tauri::command(async)]
fn toggle_pin_project(project_id: String, is_pinned: bool, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.toggle_project_pin(&project_id, is_pinned)
}

#[tauri::command(async)]
fn run_project(request: RunProjectRequest, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<ProcessInfo, String> {
    let mut project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&request.project_id)?;
    let root = trusted_project_root(&project)?;
    let scan = scan_project(&root)?;

    // El puerto se resuelve una sola vez y se pasa explícitamente al constructor
    // del comando. Antes se sobrescribía `scan.port` con el puerto libre antes de
    // construir el comando, de modo que la comprobación interna ya lo veía libre
    // y nunca añadía el `--port`: el servidor arrancaba en el puerto ocupado
    // mientras el registro guardaba el nuevo.
    let mut desired_port = None;
    if request.action == "dev" {
        if !scan.installed_dependencies && scan.declared_dependencies > 0 {
            return Err("Primero debes instalar las dependencias del proyecto antes de iniciar el servidor de desarrollo.".into());
        }
        if let Some(port) = scan.port {
            let resolved = scanner::resolve_dev_port(&scan).unwrap_or(port);
            if resolved != port {
                desired_port = Some(resolved);
                project.port = Some(resolved);
                project.local_url = Some(format!("http://localhost:{resolved}"));
                let _ = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.refresh_project_metadata(&project);
            }
        }
    }

    let spec = scanner::command_for_action_on_port(&root, &scan, &request.action, request.script.as_deref(), desired_port)?;
    match state.processes.start(app, state.storage.clone(), project.clone(), request.action, spec) {
        Ok(process) => {
            invalidate_probe_cache();
            Ok(process)
        }
        Err(error) => {
            let _ = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.update_status(&project.id, ProjectStatus::Error, Some(&error));
            Err(error)
        }
    }
}

#[tauri::command(async)]
fn stop_project(project_id: String, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let result = state.processes.stop(&app, &state.storage, &project_id);
    invalidate_probe_cache();
    result
}

#[tauri::command(async)]
fn restart_project(project_id: String, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<ProcessInfo, String> {
    let _ = state.processes.stop(&app, &state.storage, &project_id);
    run_project(RunProjectRequest { project_id, action: "dev".into(), script: None }, app, state)
}

#[tauri::command(async)]
fn get_disk_report(project_id: String, state: tauri::State<'_, AppState>) -> Result<crate::domain::DiskReport, String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    disk::disk_report(&project_id, &trusted_project_root(&project)?)
}

#[tauri::command(async)]
fn preview_cleanup(project_id: String, state: tauri::State<'_, AppState>) -> Result<CleanupPreview, String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    disk::cleanup_preview(&project_id, &trusted_project_root(&project)?)
}

#[tauri::command(async)]
fn clean_project(request: CleanupRequest, state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    if !request.confirmed { return Err("Limpieza bloqueada: primero revisa el dry-run y confirma explícitamente la acción.".into()); }
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&request.project_id)?;
    let root = trusted_project_root(&project)?;
    let (deleted, _) = disk::clean_targets(&root, &request.targets)?;
    let _ = refresh_project(request.project_id, state)?;
    Ok(deleted)
}

#[tauri::command(async)]
fn get_ide_settings(state: tauri::State<'_, AppState>) -> Result<IdeSettings, String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.ide_settings()
}

#[tauri::command(async)]
fn save_ide_settings(settings: IdeSettings, state: tauri::State<'_, AppState>) -> Result<IdeSettings, String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.save_ide_settings(&settings)?;
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.ide_settings()
}

#[tauri::command(async)]
fn launch_project_tool(project_id: String, tool_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    let root = trusted_project_root(&project)?;
    let settings = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.ide_settings()?;
    ide::launch_tool(&settings, &tool_id, &root)
}

#[tauri::command(async)]
fn open_project_url(project_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    if project.status != ProjectStatus::Running && is_project_running(&project).is_none() {
        return Err("El proyecto no está en ejecución. Inicia el proyecto antes de abrir su URL.".into());
    }
    let url = project.local_url.ok_or_else(|| "No hay una URL local detectada. Declara un puerto en el script, por ejemplo --port 5173.".to_string())?;
    ide::open_url(&url)
}

#[tauri::command(async)]
fn open_external_url(url: String) -> Result<(), String> {
    ide::open_url(&url)
}

#[tauri::command(async)]
fn inspect_project_port(project_id: String, state: tauri::State<'_, AppState>) -> Result<Option<PortInfo>, String> {
    let project = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_project(&project_id)?;
    let Some(port) = project.port else { return Ok(None); };
    let pid = is_project_running(&project);
    Ok(Some(PortInfo { port, pid, listening: pid.is_some() }))
}

pub fn detect_all_listening_ports() -> PortMap {
    let mut map: PortMap = HashMap::new();
    let Ok(output) = Command::new("lsof").args(["-iTCP", "-sTCP:LISTEN", "-n", "-P", "-F", "pcn"]).output() else {
        return map;
    };
    let Ok(stdout) = String::from_utf8(output.stdout) else {
        return map;
    };

    let mut current_pid: Option<u32> = None;
    let mut current_cmd = String::new();

    for line in stdout.lines() {
        if let Some(pid_str) = line.strip_prefix('p') {
            current_pid = pid_str.trim().parse::<u32>().ok();
        } else if let Some(cmd) = line.strip_prefix('c') {
            current_cmd = cmd.trim().to_string();
        } else if let Some(name) = line.strip_prefix('n') {
            if let Some(port_str) = name.rsplit(':').next() {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    if let Some(pid) = current_pid {
                        map.entry(port).or_default().push((pid, current_cmd.clone()));
                    }
                }
            }
        }
    }
    map
}

fn port_cache() -> &'static Mutex<Option<(Instant, Arc<PortMap>)>> {
    static CACHE: OnceLock<Mutex<Option<(Instant, Arc<PortMap>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn cwd_cache() -> &'static Mutex<HashMap<u32, (Instant, Option<String>)>> {
    static CACHE: OnceLock<Mutex<HashMap<u32, (Instant, Option<String>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Escaneo de puertos con TTL corto. El bloqueo se mantiene durante la consulta
/// para que dos llamadas simultáneas compartan un único `lsof` en vez de
/// lanzar uno cada una.
fn listening_ports() -> Arc<PortMap> {
    let mut guard = port_cache().lock().unwrap_or_else(|error| error.into_inner());
    if let Some((captured_at, map)) = guard.as_ref() {
        if captured_at.elapsed() < PROBE_TTL {
            return Arc::clone(map);
        }
    }
    let map = Arc::new(detect_all_listening_ports());
    *guard = Some((Instant::now(), Arc::clone(&map)));
    map
}

/// Invalida las cachés de sondeo tras arrancar o detener un proceso, para que
/// el siguiente refresco de la interfaz refleje el cambio de inmediato.
fn invalidate_probe_cache() {
    if let Ok(mut guard) = port_cache().lock() {
        *guard = None;
    }
    if let Ok(mut guard) = cwd_cache().lock() {
        guard.clear();
    }
}

/// Resuelve el directorio de trabajo de varios PID con una sola invocación de
/// `lsof`, en lugar de un subproceso por PID.
fn process_cwds(pids: &[u32]) -> HashMap<u32, String> {
    let mut resolved = HashMap::new();
    if pids.is_empty() {
        return resolved;
    }

    let mut missing = Vec::new();
    {
        let mut cache = cwd_cache().lock().unwrap_or_else(|error| error.into_inner());
        cache.retain(|_, (captured_at, _)| captured_at.elapsed() < PROBE_TTL);
        for pid in pids {
            match cache.get(pid) {
                Some((_, Some(path))) => {
                    resolved.insert(*pid, path.clone());
                }
                Some((_, None)) => {}
                None => missing.push(*pid),
            }
        }
    }

    if missing.is_empty() {
        return resolved;
    }

    let joined = missing.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let queried = Command::new("lsof")
        .args(["-p", &joined, "-a", "-d", "cwd", "-Fpn"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|stdout| {
            let mut found: HashMap<u32, String> = HashMap::new();
            let mut current_pid: Option<u32> = None;
            for line in stdout.lines() {
                if let Some(pid_str) = line.strip_prefix('p') {
                    current_pid = pid_str.trim().parse::<u32>().ok();
                } else if let Some(path) = line.strip_prefix('n') {
                    if let Some(pid) = current_pid {
                        found.entry(pid).or_insert_with(|| path.to_string());
                    }
                }
            }
            found
        })
        .unwrap_or_default();

    let mut cache = cwd_cache().lock().unwrap_or_else(|error| error.into_inner());
    let now = Instant::now();
    for pid in missing {
        let value = queried.get(&pid).cloned();
        if let Some(path) = value.clone() {
            resolved.insert(pid, path);
        }
        cache.insert(pid, (now, value));
    }
    resolved
}

fn paths_overlap(left: &Path, right: &Path) -> bool {
    left == right || left.starts_with(right) || right.starts_with(left)
}

pub fn update_projects_status_batch(
    projects: &mut [Project],
    process_manager: &ProcessManager,
) {
    let mut pending = Vec::new();
    for (index, project) in projects.iter_mut().enumerate() {
        if process_manager.get(&project.id).is_some() {
            project.status = ProjectStatus::Running;
            continue;
        }
        // El estado «en ejecución» guardado en SQLite sobrevive a un cierre
        // abrupto de la app o del servidor. Si aquí no hay proceso administrado,
        // se parte de «detenido» y solo se vuelve a marcar en ejecución cuando el
        // sondeo de puertos confirma un servidor propio del proyecto.
        if matches!(project.status, ProjectStatus::Running | ProjectStatus::Starting) {
            project.status = ProjectStatus::Stopped;
        }
        if project.port.is_some() {
            pending.push(index);
        }
    }
    if pending.is_empty() {
        return;
    }

    let ports_map = listening_ports();
    let mut candidate_pids: Vec<u32> = Vec::new();
    for &index in &pending {
        let Some(port) = projects[index].port else { continue };
        let Some(listeners) = ports_map.get(&port) else { continue };
        for &(pid, _) in listeners {
            if !candidate_pids.contains(&pid) {
                candidate_pids.push(pid);
            }
        }
    }
    if candidate_pids.is_empty() {
        return;
    }

    let cwds = process_cwds(&candidate_pids);
    for index in pending {
        let Some(port) = projects[index].port else { continue };
        let Some(listeners) = ports_map.get(&port) else { continue };
        let canonical = Path::new(&projects[index].canonical_path);
        let is_match = listeners.iter().any(|(pid, _)| {
            cwds.get(pid).is_some_and(|cwd| paths_overlap(Path::new(cwd), canonical))
        });
        if is_match {
            projects[index].status = ProjectStatus::Running;
        }
    }
}

fn is_project_running(project: &Project) -> Option<u32> {
    let port = project.port?;
    let ports_map = listening_ports();
    let listeners = ports_map.get(&port)?;
    let pids = listeners.iter().map(|(pid, _)| *pid).collect::<Vec<_>>();
    let cwds = process_cwds(&pids);
    let canonical = Path::new(&project.canonical_path);
    pids.into_iter()
        .find(|pid| cwds.get(pid).is_some_and(|cwd| paths_overlap(Path::new(cwd), canonical)))
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

#[tauri::command(async)]
fn get_github_status(custom_token: Option<String>, state: tauri::State<'_, AppState>) -> Result<GitHubAccountStatus, String> {
    let storage_token = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_setting("github_token")?;
    let token = github::GitHubService::resolve_token(custom_token.as_deref(), storage_token);
    github::GitHubService::get_account_status(token.as_deref())
}

#[tauri::command(async)]
fn save_github_token(token: String, state: tauri::State<'_, AppState>) -> Result<GitHubAccountStatus, String> {
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.set_setting("github_token", &token)?;
    github::GitHubService::get_account_status(Some(&token))
}

#[tauri::command(async)]
fn list_github_repos(custom_token: Option<String>, state: tauri::State<'_, AppState>) -> Result<Vec<GitHubRepo>, String> {
    let storage_token = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.get_setting("github_token")?;
    let token = github::GitHubService::resolve_token(custom_token.as_deref(), storage_token);
    let local_projects = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.list_projects()?;
    github::GitHubService::list_repos(token.as_deref(), &local_projects)
}

#[tauri::command(async)]
fn clone_github_repo(request: CloneRepoRequest, state: tauri::State<'_, AppState>) -> Result<Project, String> {
    // El bloqueo se libera antes de clonar: `git clone` puede tardar minutos y
    // mantener el mutex dejaba congelado todo el resto del panel mientras tanto.
    let (storage_token, local_projects) = {
        let storage = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?;
        (storage.get_setting("github_token")?, storage.list_projects()?)
    };
    let token = github::GitHubService::resolve_token(None, storage_token);
    let project = github::GitHubService::clone_and_register(
        &request.repo_name,
        &request.clone_url,
        request.is_private,
        token.as_deref(),
        request.target_path.as_deref(),
        &local_projects,
    )?;
    state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.insert_project(&project)?;
    Ok(project)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
fn get_default_clone_dir(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let storage = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?;
    if let Ok(Some(saved)) = storage.get_setting("default_clone_dir") {
        if !saved.trim().is_empty() {
            return Ok(saved);
        }
    }
    let local_projects = storage.list_projects().unwrap_or_default();
    let default_dest = github::GitHubService::resolve_default_clone_destination("", &local_projects)?;
    Ok(default_dest.to_string_lossy().to_string())
}

#[tauri::command(async)]
fn set_default_clone_dir(path: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("La ruta no puede estar vacía.".to_string());
    }
    let p = Path::new(trimmed);
    if !p.exists() {
        std::fs::create_dir_all(p).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    }
    let storage = state.storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?;
    storage.set_setting("default_clone_dir", trimmed)?;
    Ok(trimmed.to_string())
}

#[tauri::command(async)]
async fn pick_folder(title: Option<String>, default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(ref t) = title {
        dialog = dialog.set_title(t);
    }
    if let Some(ref p) = default_path {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let pb = PathBuf::from(trimmed);
            if pb.exists() {
                dialog = dialog.set_directory(pb);
            }
        }
    }
    let folder = dialog.pick_folder().await;
    Ok(folder.map(|handle| handle.path().to_string_lossy().to_string()))
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
            list_projects, register_project, unregister_project, delete_project, toggle_pin_project, get_project_detail, refresh_project, refresh_all_projects, run_project, stop_project, restart_project,
            get_disk_report, preview_cleanup, clean_project, get_ide_settings, save_ide_settings, launch_project_tool,
            open_project_url, open_external_url, inspect_project_port,
            get_github_status, save_github_token, list_github_repos, clone_github_repo, safe_offload_project,
            get_default_clone_dir, set_default_clone_dir, pick_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dev Command Center");
}
