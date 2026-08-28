//! Ajustes: herramientas de edición y carpeta por omisión para clonar.
use crate::domain::IdeSettings;
use crate::{github, AppState, DEFAULT_CLONE_DIR_KEY};
use std::path::{Path, PathBuf};

#[tauri::command(async)]
pub fn get_ide_settings(state: tauri::State<'_, AppState>) -> Result<IdeSettings, String> {
    state.with_storage(|db| db.ide_settings())
}

#[tauri::command(async)]
pub fn save_ide_settings(settings: IdeSettings, state: tauri::State<'_, AppState>) -> Result<IdeSettings, String> {
    state.with_storage(|db| db.save_ide_settings(&settings))?;
    state.with_storage(|db| db.ide_settings())
}

#[tauri::command(async)]
pub fn get_default_clone_dir(state: tauri::State<'_, AppState>) -> Result<String, String> {
        let (saved, local_projects) = state.with_storage(|db| {
        Ok((db.get_setting(DEFAULT_CLONE_DIR_KEY).ok().flatten(), db.list_projects().unwrap_or_default()))
    })?;
    if let Some(saved) = saved {
        if !saved.trim().is_empty() {
            return Ok(saved);
        }
    }
    let default_dest = github::GitHubService::resolve_default_clone_destination("", &local_projects)?;
    Ok(default_dest.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn set_default_clone_dir(path: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("La ruta no puede estar vacía.".to_string());
    }
    let p = Path::new(trimmed);
    if !p.exists() {
        std::fs::create_dir_all(p).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    }
        state.with_storage(|db| db.set_setting(DEFAULT_CLONE_DIR_KEY, trimmed))?;
    Ok(trimmed.to_string())
}

#[tauri::command(async)]
pub async fn pick_folder(title: Option<String>, default_path: Option<String>) -> Result<Option<String>, String> {
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
