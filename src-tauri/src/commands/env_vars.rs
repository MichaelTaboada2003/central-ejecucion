//! Bóveda de variables de entorno: importar de los `.env` del proyecto,
//! editarlas, escribirlas de vuelta al disco y rescatar las que quedaron
//! huérfanas al borrar un proyecto.
use crate::domain::{
    AdoptEnvVarsRequest, EnvVar, ImportEnvRequest, ImportEnvResult, ProjectEnvVars, SaveEnvVarRequest,
    WriteEnvFileRequest, WriteEnvFileResult,
};
use crate::env_vars;
use crate::{trusted_project_root, AppState};
use chrono::Utc;
use std::path::{Path, PathBuf};
use tauri::Manager;
use uuid::Uuid;

/// Variables del proyecto y estado de sus ficheros `.env`.
///
/// Si la carpeta ya no está montada se devuelve la bóveda sin la parte de
/// disco: justo cuando el proyecto no está disponible es cuando más falta hace
/// poder ver y copiar sus credenciales.
#[tauri::command(async)]
pub fn get_project_env_vars(project_id: String, state: tauri::State<'_, AppState>) -> Result<ProjectEnvVars, String> {
    let project = state.with_storage(|db| db.get_project(&project_id))?;
    let vars = state.with_storage(|db| db.list_env_vars_for_project(&project_id))?;
    let files = match trusted_project_root(&project) {
        Ok(root) => env_vars::inspect_env_files(&root, &vars),
        Err(_) => Vec::new(),
    };
    // Claves distintas que están en algún fichero real y no en la bóveda: son
    // exactamente las que se perderían al borrar la carpeta.
    let mut unprotected: Vec<&str> = files
        .iter()
        .filter(|file| !file.is_template)
        .flat_map(|file| file.missing_in_vault.iter().map(String::as_str))
        .collect();
    unprotected.sort_unstable();
    unprotected.dedup();
    let unprotected_keys = unprotected.len();

    Ok(ProjectEnvVars { project_id, vars, files, unprotected_keys })
}

/// Importa un fichero del proyecto o un bloque pegado a mano.
///
/// Fusiona: añade lo que falta y actualiza los valores que cambiaron, pero no
/// borra nada. Importar no puede ser una forma accidental de perder una clave
/// que ya solo existe en la bóveda.
#[tauri::command(async)]
pub fn import_env_vars(request: ImportEnvRequest, state: tauri::State<'_, AppState>) -> Result<ImportEnvResult, String> {
    if !env_vars::is_valid_scope(&request.scope) {
        return Err(format!("«{}» no es un nombre de fichero de entorno válido.", request.scope));
    }
    let content = match request.content {
        Some(content) => content,
        None => {
            let project = state.with_storage(|db| db.get_project(&request.project_id))?;
            let root = trusted_project_root(&project)?;
            let path = root.join(&request.scope);
            std::fs::read_to_string(&path)
                .map_err(|error| format!("No se pudo leer {}: {error}", path.display()))?
        }
    };
    let parsed = env_vars::parse_env_content(&content);
    if parsed.is_empty() {
        return Err("No se encontró ninguna variable con formato CLAVE=valor en ese contenido.".into());
    }
    state.with_storage(|db| db.import_env_vars(&request.project_id, &request.scope, &parsed))
}

/// Crea o edita una variable. Sin `id` es un alta; con `id`, la fila existente
/// se reescribe conservando su fecha de creación y su origen.
#[tauri::command(async)]
pub fn save_env_var(request: SaveEnvVarRequest, state: tauri::State<'_, AppState>) -> Result<EnvVar, String> {
    let key = request.key.trim().to_string();
    if !env_vars::is_valid_key(&key) {
        return Err("El nombre debe empezar por una letra o «_» y seguir con letras, números o «_».".into());
    }
    if !env_vars::is_valid_scope(&request.scope) {
        return Err(format!("«{}» no es un nombre de fichero de entorno válido.", request.scope));
    }
    let now = Utc::now().to_rfc3339();
    let comment = request.comment.map(|text| text.trim().to_string()).filter(|text| !text.is_empty());

    let variable = match request.id {
        Some(id) => {
            let existing = state.with_storage(|db| db.get_env_var(&id))?;
            EnvVar {
                scope: request.scope,
                key,
                // La heurística solo decide en el alta; después manda lo que
                // haya elegido el usuario en la interfaz.
                is_secret: request.is_secret.unwrap_or(existing.is_secret),
                is_enabled: request.is_enabled.unwrap_or(existing.is_enabled),
                comment,
                updated_at: now,
                value: request.value,
                ..existing
            }
        }
        None => {
            let project_id = request
                .project_id
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "Falta el proyecto al que pertenece la variable.".to_string())?;
            state.with_storage(|db| db.get_project(&project_id))?;
            EnvVar {
                id: Uuid::new_v4().to_string(),
                project_id: Some(project_id),
                is_secret: request
                    .is_secret
                    .unwrap_or_else(|| env_vars::is_secret_key(&key, &request.value)),
                is_enabled: request.is_enabled.unwrap_or(true),
                scope: request.scope,
                key,
                value: request.value,
                comment,
                created_at: now.clone(),
                updated_at: now,
                origin_project_name: None,
                origin_project_path: None,
                orphaned_at: None,
            }
        }
    };
    state.with_storage(|db| db.upsert_env_var(&variable))
}

#[tauri::command(async)]
pub fn delete_env_vars(ids: Vec<String>, state: tauri::State<'_, AppState>) -> Result<usize, String> {
    state.with_storage(|db| db.delete_env_vars(&ids))
}

/// Escribe un ámbito de la bóveda al fichero correspondiente del proyecto.
///
/// Es la única operación de esta pestaña que pisa el disco, así que exige
/// confirmación explícita y deja una copia del contenido anterior: las claves
/// que estaban en el fichero y no en la bóveda desaparecerían del `.env`, y la
/// copia es la única forma de recuperarlas.
#[tauri::command(async)]
pub fn write_env_file(request: WriteEnvFileRequest, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<WriteEnvFileResult, String> {
    if !request.confirmed {
        return Err("Falta confirmar la escritura del fichero de entorno.".into());
    }
    if !env_vars::is_valid_scope(&request.scope) {
        return Err(format!("«{}» no es un nombre de fichero de entorno válido.", request.scope));
    }
    let project = state.with_storage(|db| db.get_project(&request.project_id))?;
    let root = trusted_project_root(&project)?;
    let target = root.join(&request.scope);
    // `is_valid_scope` ya descarta separadores y `..`, pero la comprobación
    // sobre la ruta ya construida es la que de verdad garantiza que no se
    // escribe fuera del árbol del proyecto.
    if target.parent() != Some(root.as_path()) {
        return Err("Operación bloqueada: el fichero de entorno debe estar en la raíz del proyecto.".into());
    }

    let mut vars: Vec<EnvVar> = state
        .with_storage(|db| db.list_env_vars_for_project(&request.project_id))?
        .into_iter()
        .filter(|variable| variable.scope == request.scope)
        .collect();
    if vars.is_empty() {
        return Err(format!("La bóveda no tiene ninguna variable en {}.", request.scope));
    }
    vars.sort_by(|left, right| left.key.to_lowercase().cmp(&right.key.to_lowercase()));

    let backup_path = back_up_existing(&app, &request.project_id, &request.scope, &target)?;
    let mut content = format!(
        "# Generado por Dev Command Center desde la bóveda de «{}».\n# {}\n\n",
        project.name,
        Utc::now().to_rfc3339()
    );
    content.push_str(&env_vars::serialize_env_vars(&vars));
    std::fs::write(&target, content)
        .map_err(|error| format!("No se pudo escribir {}: {error}", target.display()))?;

    Ok(WriteEnvFileResult {
        path: target.to_string_lossy().to_string(),
        scope: request.scope,
        written: vars.len(),
        backup_path,
    })
}

/// Copia el fichero actual antes de pisarlo. Devuelve `None` si no había nada
/// que copiar.
///
/// La copia se guarda en el directorio de datos de la aplicación, NO al lado
/// del original. El `.gitignore` que genera este panel lleva `.env`, y en git
/// ese patrón no cubre `.env.bak`: un respaldo dentro del repositorio se podría
/// commitear con las credenciales dentro. Fuera del árbol del proyecto también
/// sobrevive a borrar la carpeta, que es justo cuando hace falta.
fn back_up_existing(
    app: &tauri::AppHandle,
    project_id: &str,
    scope: &str,
    target: &Path,
) -> Result<Option<String>, String> {
    if !target.is_file() {
        return Ok(None);
    }
    let directory: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo resolver el directorio de datos: {error}"))?
        .join("env-backups")
        .join(project_id);
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo crear el directorio de respaldos: {error}"))?;
    // Marca de tiempo en el nombre: sobrescribir siempre la misma copia haría
    // que la segunda escritura seguida borrase el único original que quedaba.
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let backup = directory.join(format!("{scope}.{stamp}{}", env_vars::BACKUP_SUFFIX));
    std::fs::copy(target, &backup)
        .map_err(|error| format!("No se pudo respaldar {}: {error}", target.display()))?;
    Ok(Some(backup.to_string_lossy().to_string()))
}

#[tauri::command(async)]
pub fn list_orphan_env_vars(state: tauri::State<'_, AppState>) -> Result<Vec<EnvVar>, String> {
    state.with_storage(|db| db.list_orphan_env_vars())
}

#[tauri::command(async)]
pub fn count_orphan_env_vars(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    state.with_storage(|db| db.count_orphan_env_vars())
}

/// Devuelve variables huérfanas a un proyecto registrado.
#[tauri::command(async)]
pub fn adopt_env_vars(request: AdoptEnvVarsRequest, state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let scope = match request.scope.as_deref().map(str::trim).filter(|scope| !scope.is_empty()) {
        Some(scope) if !env_vars::is_valid_scope(scope) => {
            return Err(format!("«{scope}» no es un nombre de fichero de entorno válido."))
        }
        other => other,
    };
    state.with_storage(|db| db.adopt_env_vars(&request.ids, &request.project_id, scope))
}

/// Serializa variables en formato dotenv para copiarlas o pegarlas en otro
/// sitio. Con `ids` se exporta esa selección; sin ellos, todo el proyecto.
#[tauri::command(async)]
pub fn export_env_vars(
    project_id: Option<String>,
    ids: Option<Vec<String>>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let mut vars = match (&project_id, &ids) {
        (_, Some(ids)) => ids
            .iter()
            .map(|id| state.with_storage(|db| db.get_env_var(id)))
            .collect::<Result<Vec<_>, _>>()?,
        (Some(project_id), None) => state.with_storage(|db| db.list_env_vars_for_project(project_id))?,
        (None, None) => return Err("Indica un proyecto o una selección de variables que exportar.".into()),
    };
    if vars.is_empty() {
        return Err("No hay variables que exportar.".into());
    }
    vars.sort_by(|left, right| {
        env_vars::scope_rank(&left.scope)
            .cmp(&env_vars::scope_rank(&right.scope))
            .then(left.scope.cmp(&right.scope))
            .then(left.key.to_lowercase().cmp(&right.key.to_lowercase()))
    });

    // Un solo ámbito sale limpio; varios se separan con una cabecera para que
    // se vea de qué fichero venía cada bloque.
    let mut output = String::new();
    let mut current_scope = String::new();
    let multiple_scopes = vars.iter().any(|variable| variable.scope != vars[0].scope);
    for variable in &vars {
        if multiple_scopes && variable.scope != current_scope {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&format!("# ---- {} ----\n", variable.scope));
            current_scope = variable.scope.clone();
        }
        output.push_str(&env_vars::serialize_env_vars(std::slice::from_ref(variable)));
    }
    Ok(output)
}
