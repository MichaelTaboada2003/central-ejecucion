//! Comandos del registro de proyectos: listar, registrar, reescanear y las
//! banderas que se cambian desde la interfaz (fijado, archivado, naturaleza).
use crate::domain::{ProcessInfo, Project, ProjectDetail, ProjectStatus, RegisterProjectRequest};
use crate::probe::{is_project_running, update_projects_status_batch};
use crate::scanner::{canonical_project_path, scan_project};
use crate::{absolute_input_path, disk, storage, trusted_project_root, AppState, DeleteProjectRequest};
use chrono::Utc;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use uuid::Uuid;

fn try_recover_renamed_project_root(project: &Project, state: &tauri::State<'_, AppState>) -> Option<PathBuf> {
    let old_path = Path::new(&project.canonical_path);
    let parent = old_path.parent()?;
    if !parent.is_dir() {
        return None;
    }

    let registered_paths: HashSet<String> = state
        .with_storage(|db| db.list_projects())
        .ok()?
        .into_iter()
        .map(|p| p.canonical_path)
        .collect();

    // 1. Si en la misma carpeta padre existe una con el nombre exacto del proyecto
    let candidate = parent.join(&project.name);
    if candidate.is_dir() {
        if let Ok(canonical) = std::fs::canonicalize(&candidate) {
            let canon_str = canonical.to_string_lossy().to_string();
            if !registered_paths.contains(&canon_str) {
                return Some(canonical);
            }
        }
    }

    // 2. Si es un repositorio git, buscar en carpetas hermanas la que coincida por remoto
    let old_folder_name = old_path.file_name().and_then(|n| n.to_str()).map(str::to_lowercase);
    let proj_name_lower = project.name.to_lowercase();
    let entries = std::fs::read_dir(parent).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || path == old_path {
            continue;
        }
        if let Ok(canonical) = std::fs::canonicalize(&path) {
            let canon_str = canonical.to_string_lossy().to_string();
            if registered_paths.contains(&canon_str) {
                continue;
            }
            if let Some(candidate_remote) = crate::github::GitHubService::get_git_remote_url(&canonical) {
                let cr_lower = candidate_remote.to_lowercase();
                let matches_name = cr_lower.ends_with(&format!("/{}.git", proj_name_lower))
                    || cr_lower.ends_with(&format!("/{}", proj_name_lower));
                let matches_old_folder = old_folder_name.as_ref().map(|old| {
                    cr_lower.ends_with(&format!("/{}.git", old)) || cr_lower.ends_with(&format!("/{}", old))
                }).unwrap_or(false);
                if matches_name || matches_old_folder {
                    return Some(canonical);
                }
            }
        }
    }

    None
}

#[tauri::command(async)]
pub fn list_projects(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, String> {
    let mut projects = state.with_storage(|db| db.list_projects())?;
    // El mutex ya está liberado: comprobar en disco si cada carpeta sigue
    // montada puede tardar segundos en un volumen dormido y no debe bloquear
    // los demás comandos.
    storage::mark_unavailable_projects(&mut projects);
    update_projects_status_batch(&mut projects, &state.processes);
    Ok(projects)
}

#[tauri::command(async)]
pub fn register_project(request: RegisterProjectRequest, state: tauri::State<'_, AppState>) -> Result<Project, String> {
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
        project_type: scan.project_type, kind: scan.kind, frameworks: scan.frameworks, package_manager: scan.package_manager,
        dev_command: scan.dev_command, build_command: scan.build_command, test_command: scan.test_command,
        local_url: scan.local_url, port: scan.port, status: ProjectStatus::Stopped, last_used_at: None,
        disk_size_bytes: report.total_bytes, tags: request.tags.into_iter().map(|tag| tag.trim().to_string()).filter(|tag| !tag.is_empty()).collect(),
        created_at: Utc::now().to_rfc3339(), last_error: None, is_pinned: false, is_archived: false,
    };
    if is_project_running(&project).is_some() {
        project.status = ProjectStatus::Running;
    }
    state.with_storage(|db| db.insert_project(&project))?;
    Ok(project)
}

#[tauri::command(async)]
pub fn get_project_detail(project_id: String, state: tauri::State<'_, AppState>) -> Result<ProjectDetail, String> {
    let mut project = state.with_storage(|db| db.get_project(&project_id))?;
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
    // Un volumen externo desmontado o un `canonicalize` que cambia de destino no
    // pueden costar el registro del proyecto: antes se borraba la fila y con ella
    // sus etiquetas, su historial y su estado de fijado. Se marca el fallo y el
    // usuario decide si lo borra desde el detalle.
    let root = match trusted_project_root(&project) {
        Ok(r) => r,
        Err(error) => {
            if let Some(recovered) = try_recover_renamed_project_root(&project, &state) {
                recovered
            } else {
                let _ = state.storage.lock().map(|db| db.mark_project_error(&project_id, &error));
                return Err(error);
            }
        }
    };
    if let Some(folder_name) = root.file_name().and_then(|n| n.to_str()) {
        if !folder_name.trim().is_empty() && (project.name != folder_name || project.canonical_path != root.to_string_lossy()) {
            project.name = folder_name.trim().to_string();
            project.path = root.to_string_lossy().to_string();
            project.canonical_path = root.to_string_lossy().to_string();
            let _ = state.with_storage(|db| db.refresh_project_metadata(&project));
        }
    }
    let scan = scan_project(&root)?;
    let recent_commands = state.with_storage(|db| db.recent_commands(&project_id))?;
    Ok(ProjectDetail { process: process_info, project, scan, recent_commands })
}

#[tauri::command(async)]
pub fn refresh_project(project_id: String, state: tauri::State<'_, AppState>) -> Result<Project, String> {
    let mut project = state.with_storage(|db| db.get_project(&project_id))?;
    // Un volumen externo desmontado o un `canonicalize` que cambia de destino no
    // pueden costar el registro del proyecto: antes se borraba la fila y con ella
    // sus etiquetas, su historial y su estado de fijado. Se marca el fallo y el
    // usuario decide si lo borra desde el detalle.
    let root = match trusted_project_root(&project) {
        Ok(r) => r,
        Err(error) => {
            if let Some(recovered) = try_recover_renamed_project_root(&project, &state) {
                recovered
            } else {
                let _ = state.storage.lock().map(|db| db.mark_project_error(&project_id, &error));
                return Err(error);
            }
        }
    };
    let scan = scan_project(&root)?;
    let report = disk::disk_report(&project_id, &root)?;
    if let Some(folder_name) = root.file_name().and_then(|n| n.to_str()) {
        if !folder_name.trim().is_empty() {
            project.name = folder_name.trim().to_string();
        }
    }
    project.path = root.to_string_lossy().to_string();
    project.canonical_path = root.to_string_lossy().to_string();
    project.project_type = scan.project_type;
    project.kind = scan.kind;
    project.frameworks = scan.frameworks;
    project.package_manager = scan.package_manager;
    project.dev_command = scan.dev_command;
    project.build_command = scan.build_command;
    project.test_command = scan.test_command;
    project.local_url = scan.local_url;
    project.port = scan.port;
    project.disk_size_bytes = report.total_bytes;
    state.with_storage(|db| db.refresh_project_metadata(&project))?;
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
pub fn refresh_all_projects(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, String> {
    let projects = state.with_storage(|db| db.list_projects())?;
    for mut project in projects {
        let root = match trusted_project_root(&project) {
            Ok(r) => r,
            Err(_) => {
                if let Some(recovered) = try_recover_renamed_project_root(&project, &state) {
                    recovered
                } else {
                    continue;
                }
            }
        };
        let Ok(scan) = scan_project(&root) else { continue };
        if let Some(folder_name) = root.file_name().and_then(|n| n.to_str()) {
            if !folder_name.trim().is_empty() {
                project.name = folder_name.trim().to_string();
            }
        }
        project.path = root.to_string_lossy().to_string();
        project.canonical_path = root.to_string_lossy().to_string();
        project.project_type = scan.project_type;
        project.kind = scan.kind;
        project.frameworks = scan.frameworks;
        project.package_manager = scan.package_manager;
        project.dev_command = scan.dev_command;
        project.build_command = scan.build_command;
        project.test_command = scan.test_command;
        project.local_url = scan.local_url;
        project.port = scan.port;
        // `project.disk_size_bytes` viaja sin tocar, así que se reescribe con el
        // valor que ya tenía en la base.
        let _ = state.with_storage(|db| db.refresh_project_metadata(&project));
    }
    let mut refreshed = state.with_storage(|db| db.list_projects())?;
    storage::mark_unavailable_projects(&mut refreshed);
    update_projects_status_batch(&mut refreshed, &state.processes);
    Ok(refreshed)
}

#[tauri::command(async)]
pub fn delete_project(request: DeleteProjectRequest, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.with_storage(|db| db.get_project(&request.project_id))?;
    let _ = state.processes.stop(&app, &state.storage, &request.project_id);
    // Antes de tocar nada: las variables de entorno de la bóveda pasan a
    // huérfanas con el nombre y la ruta de este proyecto grabados. Se hace aquí
    // y no en `Storage::delete_project` porque quien borra necesita saber de
    // quién eran, y la clave ajena ya se habrá puesto a NULL después.
    let _ = state.with_storage(|db| db.stamp_env_var_origin(&request.project_id));
    if request.delete_files {
        let path = Path::new(&project.canonical_path);
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|e| format!("No se pudo borrar la carpeta del disco: {e}"))?;
        }
    }
    state.with_storage(|db| db.delete_project(&request.project_id))?;
    Ok(())
}

#[tauri::command(async)]
pub fn unregister_project(project_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let _ = state.with_storage(|db| db.stamp_env_var_origin(&project_id));
    state.with_storage(|db| db.delete_project(&project_id))?;
    Ok(())
}

#[tauri::command(async)]
pub fn toggle_pin_project(project_id: String, is_pinned: bool, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    state.with_storage(|db| db.toggle_project_pin(&project_id, is_pinned))
}

#[tauri::command(async)]
pub fn toggle_archive_project(project_id: String, is_archived: bool, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    state.with_storage(|db| db.toggle_project_archive(&project_id, is_archived))
}
