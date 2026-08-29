pub mod disk;
pub mod domain;
pub mod github;
pub mod ide;
#[cfg(feature = "mcp")]
pub mod mcp;
pub mod commands;
pub mod probe;
pub mod process;
pub mod scanner;
pub mod storage;

use crate::domain::Project;
use crate::process::ProcessManager;
use crate::storage::Storage;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;



/// Clave del token de GitHub en la tabla `settings`. Una sola constante: cuando
/// estas lineas estaban copiadas en cinco comandos, uno leia `github_pat` —una
/// clave que nadie escribe nunca— y por eso «Publicar en GitHub» pedia un token
/// que ya estaba configurado.
pub(crate) const GITHUB_TOKEN_KEY: &str = "github_token";
/// Carpeta por omision donde se clonan los repositorios.
pub(crate) const DEFAULT_CLONE_DIR_KEY: &str = "default_clone_dir";

pub struct AppState {
    pub(crate) storage: Arc<Mutex<Storage>>,
    pub(crate) processes: ProcessManager,
}

impl AppState {
    /// Ejecuta una operacion con el almacenamiento tomado y lo libera al salir.
    ///
    /// Estas tres lineas estaban repetidas 44 veces en este fichero. Ademas de
    /// ruido, cada copia era una oportunidad de equivocarse: el cerrojo se debe
    /// mantener el menor tiempo posible y NUNCA durante E/S de disco o de red.
    pub(crate) fn with_storage<T>(&self, operation: impl FnOnce(&Storage) -> Result<T, String>) -> Result<T, String> {
        let storage = self
            .storage
            .lock()
            .map_err(|_| "El almacenamiento local está ocupado.".to_string())?;
        operation(&storage)
    }

    /// Token de GitHub efectivo: el que se pase, el guardado, o el del entorno.
    /// Que un almacenamiento ocupado no de token es aceptable —git y la API
    /// fallaran con su propio mensaje— y evita propagar el error a comandos que
    /// funcionan igual sin credenciales.
    pub(crate) fn github_token(&self, custom_token: Option<&str>) -> Option<String> {
        let stored = self
            .storage
            .lock()
            .ok()
            .and_then(|storage| storage.get_setting(GITHUB_TOKEN_KEY).ok().flatten());
        github::GitHubService::resolve_token(custom_token, stored)
    }
}






#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectRequest {
    pub project_id: String,
    pub delete_files: bool,
}



















pub(crate) fn absolute_input_path(raw: &str) -> Result<PathBuf, String> {
    let input = Path::new(raw);
    if input.is_absolute() { return Ok(input.to_path_buf()); }
    std::env::current_dir().map(|cwd| cwd.join(input)).map_err(|error| format!("No se pudo resolver la ruta absoluta: {error}"))
}

pub(crate) fn trusted_project_root(project: &Project) -> Result<PathBuf, String> {
    let root = Path::new(&project.canonical_path);
    let canonical = std::fs::canonicalize(root).map_err(|_| format!("La carpeta registrada ya no está disponible: {}", project.path))?;
    if canonical != root {
        return Err("Operación bloqueada: la ruta canónica del proyecto cambió. Vuelve a registrar la carpeta para continuar.".into());
    }
    if !canonical.is_dir() { return Err("Operación bloqueada: la ruta registrada no es una carpeta.".into()); }
    Ok(canonical)
}















pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            let database_path = data_dir.join("dev-command-center.sqlite3");
            let storage = Storage::open(&database_path).map_err(|error| -> Box<dyn std::error::Error> { Box::new(std::io::Error::other(error)) })?;
            app.manage(AppState { storage: Arc::new(Mutex::new(storage)), processes: ProcessManager::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // projects
            commands::projects::list_projects,
            commands::projects::register_project,
            commands::projects::get_project_detail,
            commands::projects::refresh_project,
            commands::projects::refresh_all_projects,
            commands::projects::delete_project,
            commands::projects::unregister_project,
            commands::projects::toggle_pin_project,
            commands::projects::toggle_archive_project,
            // run
            commands::run::run_project,
            commands::run::stop_project,
            commands::run::restart_project,
            commands::run::inspect_project_port,
            commands::run::open_project_url,
            commands::run::launch_project_tool,
            commands::run::open_external_url,
            // disk
            commands::disk::get_disk_report,
            commands::disk::preview_cleanup,
            commands::disk::clean_project,
            // settings
            commands::settings::get_ide_settings,
            commands::settings::save_ide_settings,
            commands::settings::get_default_clone_dir,
            commands::settings::set_default_clone_dir,
            commands::settings::pick_folder,
            // github
            commands::github::get_github_status,
            commands::github::save_github_token,
            commands::github::list_github_repos,
            commands::github::clone_github_repo,
            commands::github::safe_offload_project,
            // git
            commands::git::get_project_git_status,
            commands::git::project_git_fetch,
            commands::git::project_git_pull,
            commands::git::project_git_push,
            commands::git::project_git_commit,
            commands::git::project_git_commit_and_push,
            commands::git::publish_project_to_github,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dev Command Center");
}
