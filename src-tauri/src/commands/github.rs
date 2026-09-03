//! Cuenta de GitHub, catálogo de repositorios, clonado y liberación de espacio.
use crate::domain::{CloneRepoRequest, GitHubAccountStatus, GitHubRepo, Project, SafeOffloadResult};
use crate::{github, AppState, GITHUB_TOKEN_KEY};
use std::path::Path;

#[tauri::command(async)]
pub fn get_github_status(custom_token: Option<String>, state: tauri::State<'_, AppState>) -> Result<GitHubAccountStatus, String> {
    let token = state.github_token(custom_token.as_deref());
    github::GitHubService::get_account_status(token.as_deref())
}

#[tauri::command(async)]
pub fn save_github_token(token: String, state: tauri::State<'_, AppState>) -> Result<GitHubAccountStatus, String> {
    state.with_storage(|db| db.set_setting(GITHUB_TOKEN_KEY, &token))?;
    github::GitHubService::get_account_status(Some(&token))
}

#[tauri::command(async)]
pub fn list_github_repos(custom_token: Option<String>, state: tauri::State<'_, AppState>) -> Result<Vec<GitHubRepo>, String> {
    let token = state.github_token(custom_token.as_deref());
    let local_projects = state.with_storage(|db| db.list_projects())?;
    github::GitHubService::list_repos(token.as_deref(), &local_projects)
}

#[tauri::command(async)]
pub fn clone_github_repo(request: CloneRepoRequest, state: tauri::State<'_, AppState>) -> Result<Project, String> {
    // El bloqueo se libera antes de clonar: `git clone` puede tardar minutos y
    // mantener el mutex dejaba congelado todo el resto del panel mientras tanto.
    let local_projects = state.with_storage(|db| db.list_projects())?;
    let token = state.github_token(None);
    let project = github::GitHubService::clone_and_register(
        &request.repo_name,
        &request.clone_url,
        request.is_private,
        token.as_deref(),
        request.target_path.as_deref(),
        &local_projects,
    )?;
    state.with_storage(|db| db.insert_project(&project))?;
    Ok(project)
}

#[tauri::command(async)]
pub fn safe_offload_project(project_id: String, force: bool, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<SafeOffloadResult, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    if state.processes.get(&project_id).is_some() {
        let _ = state.processes.stop(&app, &state.storage, &project_id);
    }
    let path = Path::new(&project.canonical_path);
    github::GitHubService::safe_offload_project(path, force)?;
    // Con `force` la comprobación de ficheros ignorados se salta, así que un
    // `.env` que no está en GitHub se va con la carpeta: las variables que
    // hubiera en la bóveda son lo único que queda de él.
    let _ = state.with_storage(|db| db.stamp_env_var_origin(&project_id));
    state.with_storage(|db| db.delete_project(&project_id))?;
    Ok(SafeOffloadResult {
        success: true,
        project_id,
        project_name: project.name,
        message: "Proyecto archivado y carpeta local liberada de forma segura.".to_string(),
    })
}
