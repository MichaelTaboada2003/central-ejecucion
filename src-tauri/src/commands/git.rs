//! Operaciones de git sobre el proyecto abierto y publicación en GitHub.
use crate::domain::{GitActionResult, GitStatusInfo, PublishToGitHubRequest};
use crate::{github, trusted_project_root, AppState};

#[tauri::command(async)]
pub fn get_project_git_status(project_id: String, state: tauri::State<'_, AppState>) -> Result<GitStatusInfo, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let token = state.github_token(None);
    let root = trusted_project_root(&project)?;
    github::GitHubService::get_project_git_status(&root, token.as_deref())
}

#[tauri::command(async)]
pub fn project_git_pull(project_id: String, state: tauri::State<'_, AppState>) -> Result<GitActionResult, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let token = state.github_token(None);
    let root = trusted_project_root(&project)?;
    github::GitHubService::git_pull(&root, token.as_deref())
}

#[tauri::command(async)]
pub fn project_git_push(project_id: String, state: tauri::State<'_, AppState>) -> Result<GitActionResult, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let token = state.github_token(None);
    let root = trusted_project_root(&project)?;
    github::GitHubService::git_push(&root, token.as_deref())
}

/// Solo commit. Subir es otra accion, con su propio boton: juntarlas hacia que
/// un fallo de red diera por fracasado un commit que si se habia hecho.
#[tauri::command(async)]
pub fn project_git_commit(
    project_id: String,
    message: String,
    files: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<GitActionResult, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let root = trusted_project_root(&project)?;
    let files = files.unwrap_or_default();
    github::GitHubService::git_commit(&root, &message, &files)
}

#[tauri::command(async)]
pub fn project_git_commit_and_push(project_id: String, message: String, state: tauri::State<'_, AppState>) -> Result<GitActionResult, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let token = state.github_token(None);
    let root = trusted_project_root(&project)?;
    github::GitHubService::git_commit_and_push(&root, &message, token.as_deref())
}

#[tauri::command(async)]
pub fn publish_project_to_github(request: PublishToGitHubRequest, state: tauri::State<'_, AppState>) -> Result<GitActionResult, String> {
    let mut project = state.with_storage(|db| db.get_project(&request.project_id))?;
    let token = state.github_token(None)
        .ok_or_else(|| "Debes configurar un GitHub Token (PAT) en los Ajustes para publicar proyectos en tu cuenta.".to_string())?;
    let root = trusted_project_root(&project)?;
    let result = github::GitHubService::publish_project_to_github(&root, &project.name, request, &token)?;

    // Añadir tag "github" al proyecto si no lo tenía y persistir
    if !project.tags.contains(&"github".to_string()) {
        project.tags.push("github".to_string());
        let _ = state.storage.lock().map(|db| db.refresh_project_metadata(&project));
    }

    Ok(result)
}
