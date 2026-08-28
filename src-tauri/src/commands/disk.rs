//! Informe de espacio y limpieza de directorios regenerables.
use crate::domain::{CleanupPreview, CleanupRequest};
use crate::{disk, trusted_project_root, AppState};
use super::projects::refresh_project;

#[tauri::command(async)]
pub fn get_disk_report(project_id: String, state: tauri::State<'_, AppState>) -> Result<crate::domain::DiskReport, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    disk::disk_report(&project_id, &trusted_project_root(&project)?)
}

#[tauri::command(async)]
pub fn preview_cleanup(project_id: String, state: tauri::State<'_, AppState>) -> Result<CleanupPreview, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    disk::cleanup_preview(&project_id, &trusted_project_root(&project)?)
}

#[tauri::command(async)]
pub fn clean_project(request: CleanupRequest, state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    if !request.confirmed { return Err("Limpieza bloqueada: primero revisa el dry-run y confirma explícitamente la acción.".into()); }
    let project = state.with_storage(|db| db.get_project(&request.project_id))?;
    let root = trusted_project_root(&project)?;
    let (deleted, _) = disk::clean_targets(&root, &request.targets)?;
    let _ = refresh_project(request.project_id, state)?;
    Ok(deleted)
}
