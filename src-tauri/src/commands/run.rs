//! Ejecución de comandos del proyecto y apertura de herramientas externas.
use crate::domain::{PortInfo, ProcessInfo, ProjectStatus, RunProjectRequest};
use crate::probe::{invalidate_probe_cache, is_project_running};
use crate::scanner;
use crate::{ide, scanner::scan_project, trusted_project_root, AppState};

#[tauri::command(async)]
pub fn run_project(request: RunProjectRequest, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<ProcessInfo, String> {
    let mut project = state.with_storage(|db| db.get_project(&request.project_id))?;
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
                let _ = state.with_storage(|db| db.refresh_project_metadata(&project));
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
            let _ = state.with_storage(|db| db.update_status(&project.id, ProjectStatus::Error, Some(&error)));
            Err(error)
        }
    }
}

#[tauri::command(async)]
pub fn stop_project(project_id: String, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let result = state.processes.stop(&app, &state.storage, &project_id);
    invalidate_probe_cache();
    result
}

#[tauri::command(async)]
pub fn restart_project(project_id: String, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<ProcessInfo, String> {
    let _ = state.processes.stop(&app, &state.storage, &project_id);
    run_project(RunProjectRequest { project_id, action: "dev".into(), script: None }, app, state)
}

#[tauri::command(async)]
pub fn inspect_project_port(project_id: String, state: tauri::State<'_, AppState>) -> Result<Option<PortInfo>, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let Some(port) = project.port else { return Ok(None); };
    let pid = is_project_running(&project);
    Ok(Some(PortInfo { port, pid, listening: pid.is_some() }))
}

#[tauri::command(async)]
pub fn open_project_url(project_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    if project.status != ProjectStatus::Running && is_project_running(&project).is_none() {
        return Err("El proyecto no está en ejecución. Inicia el proyecto antes de abrir su URL.".into());
    }
    let url = project.local_url.ok_or_else(|| "No hay una URL local detectada. Declara un puerto en el script, por ejemplo --port 5173.".to_string())?;
    ide::open_url(&url)
}

#[tauri::command(async)]
pub fn launch_project_tool(project_id: String, tool_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let root = trusted_project_root(&project)?;
    let settings = state.with_storage(|db| db.ide_settings())?;
    ide::launch_tool(&settings, &tool_id, &root)
}

#[tauri::command(async)]
pub fn open_external_url(url: String) -> Result<(), String> {
    ide::open_url(&url)
}
