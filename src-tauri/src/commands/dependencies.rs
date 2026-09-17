//! Comandos Tauri para auditar y gestionar dependencias de proyectos.
use crate::deps_audit;
use crate::domain::DependencyAuditResult;
use crate::scanner::scan_project;
use crate::{trusted_project_root, AppState};
use super::projects::refresh_project;

#[tauri::command(async)]
pub fn audit_project_dependencies(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<DependencyAuditResult, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let root = trusted_project_root(&project)?;
    let scan = scan_project(&root)?;
    deps_audit::audit_dependencies(&root, &scan)
}

#[tauri::command(async)]
pub fn remove_project_dependency(
    project_id: String,
    dependency_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let root = trusted_project_root(&project)?;
    let scan = scan_project(&root)?;
    let message = deps_audit::remove_dependency(&root, &scan, &dependency_name)?;
    let _ = refresh_project(project_id, state)?;
    Ok(message)
}
