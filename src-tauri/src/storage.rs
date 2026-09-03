use crate::domain::{CommandRecord, EnvVar, IdeConfig, IdeSettings, ImportEnvResult, Project, ProjectKind, ProjectStatus};
use crate::env_vars::{self, ParsedEnvVar};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub struct Storage {
    connection: Connection,
}

impl Storage {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("No se pudo crear el directorio de datos: {error}"))?;
        }
        let connection = Connection::open(path).map_err(|error| format!("No se pudo abrir SQLite: {error}"))?;
        // El binario del servidor MCP abre este mismo fichero, asi que hay dos
        // procesos escribiendo. Con el journal por defecto y `busy_timeout` a 0,
        // cualquier solape devuelve «database is locked» de inmediato en vez de
        // esperar: WAL permite lector+escritor a la vez y el timeout absorbe el
        // resto.
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|error| format!("No se pudo configurar el tiempo de espera de SQLite: {error}"))?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| format!("No se pudo activar el modo WAL de SQLite: {error}"))?;
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(|error| format!("No se pudo configurar la sincronia de SQLite: {error}"))?;
        let storage = Self { connection };
        storage.migrate()?;
        storage.recover_interrupted_processes()?;
        Ok(storage)
    }

    fn migrate(&self) -> Result<(), String> {
        self.connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              path TEXT NOT NULL,
              canonical_path TEXT NOT NULL UNIQUE,
              project_type TEXT NOT NULL,
              frameworks_json TEXT NOT NULL DEFAULT '[]',
              package_manager TEXT,
              dev_command TEXT,
              build_command TEXT,
              test_command TEXT,
              local_url TEXT,
              port INTEGER,
              status TEXT NOT NULL DEFAULT 'stopped',
              last_used_at TEXT,
              disk_size_bytes INTEGER NOT NULL DEFAULT 0,
              tags_json TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL,
              last_error TEXT,
              is_pinned INTEGER NOT NULL DEFAULT 0,
              is_archived INTEGER NOT NULL DEFAULT 0,
              kind TEXT NOT NULL DEFAULT 'service'
            );
            CREATE TABLE IF NOT EXISTS command_history (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              action TEXT NOT NULL,
              command TEXT NOT NULL,
              started_at TEXT NOT NULL,
              ended_at TEXT,
              exit_code INTEGER,
              status TEXT NOT NULL,
              error_message TEXT
            );
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS command_history_project_started_idx ON command_history(project_id, started_at DESC);
            -- Bóveda de variables de entorno. `ON DELETE SET NULL` en vez del
            -- `ON DELETE CASCADE` que usa `command_history`: al borrar un
            -- proyecto se hace `remove_dir_all` de su carpeta y el `.env` está
            -- en el `.gitignore` que genera este panel, así que tampoco está en
            -- GitHub. Arrastrar la fila haría irrecuperable la credencial; la
            -- variable se queda huérfana y el usuario decide.
            CREATE TABLE IF NOT EXISTS project_env_vars (
              id TEXT PRIMARY KEY,
              project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
              scope TEXT NOT NULL DEFAULT '.env',
              key TEXT NOT NULL,
              value TEXT NOT NULL DEFAULT '',
              is_secret INTEGER NOT NULL DEFAULT 0,
              is_enabled INTEGER NOT NULL DEFAULT 1,
              comment TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              origin_project_name TEXT,
              origin_project_path TEXT,
              orphaned_at TEXT
            );
            -- SQLite considera cada NULL distinto de los demás, así que este
            -- índice impide claves repetidas dentro de un proyecto y a la vez
            -- deja convivir huérfanas homónimas venidas de proyectos distintos.
            CREATE UNIQUE INDEX IF NOT EXISTS project_env_vars_unique_idx ON project_env_vars(project_id, scope, key);
            CREATE INDEX IF NOT EXISTS project_env_vars_project_idx ON project_env_vars(project_id, scope, key);
            ",
        ).map_err(|error| format!("No se pudo crear el esquema SQLite: {error}"))?;

        // Compatibilidad con bases de datos ya existentes. `ALTER TABLE ADD
        // COLUMN` falla si la columna ya existe, y ese error se ignora a
        // proposito: es la forma barata de migrar sin tabla de versiones.
        let _ = self.connection.execute("ALTER TABLE projects ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0", []);
        let _ = self.connection.execute("ALTER TABLE projects ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0", []);
        let _ = self.connection.execute("ALTER TABLE projects ADD COLUMN disk_size_bytes INTEGER NOT NULL DEFAULT 0", []);
        let _ = self.connection.execute("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'service'", []);
        Ok(())
    }

    fn recover_interrupted_processes(&self) -> Result<(), String> {
        self.connection.execute(
            "UPDATE projects SET status = 'stopped', last_error = COALESCE(last_error, 'El proceso anterior terminó al cerrar Dev Command Center.') WHERE status IN ('starting', 'running')",
            [],
        ).map_err(|error| format!("No se pudo recuperar el estado de procesos: {error}"))?;
        Ok(())
    }

    /// Lectura pura de SQLite. La comprobación de que la carpeta sigue en el
    /// disco vive en [`mark_unavailable_projects`] porque hace E/S y esta
    /// función se llama con el mutex del almacenamiento tomado.
    pub fn list_projects(&self) -> Result<Vec<Project>, String> {
        let mut statement = self.connection.prepare("SELECT * FROM projects ORDER BY is_pinned DESC, is_archived ASC, COALESCE(last_used_at, created_at) DESC, name COLLATE NOCASE")
            .map_err(|error| format!("No se pudo consultar proyectos: {error}"))?;
        let rows = statement
            .query_map([], map_project)
            .map_err(|error| format!("No se pudo leer proyectos: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("No se pudo convertir proyectos: {error}"))
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        self.connection.execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(|error| format!("No se pudo eliminar el proyecto: {error}"))?;
        Ok(())
    }

    pub fn toggle_project_pin(&self, id: &str, is_pinned: bool) -> Result<bool, String> {
        if is_pinned {
            self.connection.execute(
                "UPDATE projects SET is_pinned = 1, is_archived = 0 WHERE id = ?1",
                params![id],
            ).map_err(|error| format!("No se pudo fijar el proyecto: {error}"))?;
        } else {
            self.connection.execute(
                "UPDATE projects SET is_pinned = 0 WHERE id = ?1",
                params![id],
            ).map_err(|error| format!("No se pudo desfijar el proyecto: {error}"))?;
        }
        Ok(is_pinned)
    }

    pub fn toggle_project_archive(&self, id: &str, is_archived: bool) -> Result<bool, String> {
        if is_archived {
            self.connection.execute(
                "UPDATE projects SET is_archived = 1, is_pinned = 0 WHERE id = ?1",
                params![id],
            ).map_err(|error| format!("No se pudo archivar el proyecto: {error}"))?;
        } else {
            self.connection.execute(
                "UPDATE projects SET is_archived = 0 WHERE id = ?1",
                params![id],
            ).map_err(|error| format!("No se pudo desarchivar el proyecto: {error}"))?;
        }
        Ok(is_archived)
    }

    pub fn get_project(&self, id: &str) -> Result<Project, String> {
        self.connection.query_row("SELECT * FROM projects WHERE id = ?1", params![id], map_project)
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => "No se encontró el proyecto registrado.".to_string(),
                _ => format!("No se pudo leer el proyecto: {error}"),
            })
    }

    pub fn insert_project(&self, project: &Project) -> Result<(), String> {
        self.connection.execute(
            "INSERT INTO projects (id, name, path, canonical_path, project_type, frameworks_json, package_manager, dev_command, build_command, test_command, local_url, port, status, last_used_at, disk_size_bytes, tags_json, created_at, last_error, is_pinned, is_archived, kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            params![
                project.id, project.name, project.path, project.canonical_path, project.project_type,
                json(&project.frameworks), project.package_manager, project.dev_command, project.build_command,
                project.test_command, project.local_url, project.port, project.status.as_str(), project.last_used_at,
                project.disk_size_bytes, json(&project.tags), project.created_at, project.last_error,
                if project.is_pinned { 1 } else { 0 }, if project.is_archived { 1 } else { 0 },
                project.kind.as_str(),
            ],
        ).map_err(|error| {
            if error.to_string().contains("UNIQUE") { "Esta carpeta ya está registrada usando su ruta canónica.".into() }
            else { format!("No se pudo guardar el proyecto: {error}") }
        })?;
        Ok(())
    }

    pub fn refresh_project_metadata(&self, project: &Project) -> Result<(), String> {
        self.connection.execute(
            "UPDATE projects SET project_type=?2, frameworks_json=?3, package_manager=?4, dev_command=?5, build_command=?6, test_command=?7, local_url=?8, port=?9, disk_size_bytes=?10, kind=?11 WHERE id=?1",
            params![project.id, project.project_type, json(&project.frameworks), project.package_manager, project.dev_command, project.build_command, project.test_command, project.local_url, project.port, project.disk_size_bytes, project.kind.as_str()],
        ).map_err(|error| format!("No se pudo actualizar los metadatos del proyecto: {error}"))?;
        Ok(())
    }

    /// Marca un fallo sin tocar `last_used_at`: al contrario que
    /// [`Self::update_status`], no reordena la lista de proyectos por el simple
    /// hecho de haber abierto uno cuya carpeta no está disponible.
    pub fn mark_project_error(&self, id: &str, message: &str) -> Result<(), String> {
        self.connection.execute(
            "UPDATE projects SET status='error', last_error=?2 WHERE id=?1",
            params![id, message],
        ).map_err(|error| format!("No se pudo marcar el fallo del proyecto: {error}"))?;
        Ok(())
    }

    pub fn update_status(&self, id: &str, status: ProjectStatus, last_error: Option<&str>) -> Result<(), String> {
        self.connection.execute(
            "UPDATE projects SET status=?2, last_error=?3, last_used_at=datetime('now') WHERE id=?1",
            params![id, status.as_str(), last_error],
        ).map_err(|error| format!("No se pudo actualizar el estado: {error}"))?;
        Ok(())
    }

    pub fn command_started(&self, record: &CommandRecord) -> Result<(), String> {
        self.connection.execute(
            "INSERT INTO command_history (id, project_id, action, command, started_at, ended_at, exit_code, status, error_message) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, NULL)",
            params![record.id, record.project_id, record.action, record.command, record.started_at, record.status],
        ).map_err(|error| format!("No se pudo registrar el comando: {error}"))?;
        Ok(())
    }

    pub fn command_finished(&self, id: &str, status: &str, exit_code: Option<i32>, error_message: Option<&str>) -> Result<(), String> {
        self.connection.execute(
            "UPDATE command_history SET ended_at=datetime('now'), exit_code=?3, status=?2, error_message=?4 WHERE id=?1",
            params![id, status, exit_code, error_message],
        ).map_err(|error| format!("No se pudo finalizar el historial de comandos: {error}"))?;
        Ok(())
    }

    pub fn recent_commands(&self, project_id: &str) -> Result<Vec<CommandRecord>, String> {
        let mut statement = self.connection.prepare(
            "SELECT id, project_id, action, command, started_at, ended_at, exit_code, status, error_message FROM command_history WHERE project_id = ?1 ORDER BY started_at DESC LIMIT 20"
        ).map_err(|error| format!("No se pudo consultar el historial: {error}"))?;
        let rows = statement
            .query_map(params![project_id], |row| Ok(CommandRecord {
                id: row.get(0)?, project_id: row.get(1)?, action: row.get(2)?, command: row.get(3)?, started_at: row.get(4)?, ended_at: row.get(5)?, exit_code: row.get(6)?, status: row.get(7)?, error_message: row.get(8)?,
            }))
            .map_err(|error| format!("No se pudo leer el historial: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("No se pudo convertir el historial: {error}"))
    }

    pub fn ide_settings(&self) -> Result<IdeSettings, String> {
        let configured: Option<String> = self.connection.query_row("SELECT value FROM settings WHERE key='ide_settings'", [], |row| row.get(0))
            .optional().map_err(|error| format!("No se pudo leer los ajustes de IDE: {error}"))?;
        let tools = configured
            .and_then(|value| serde_json::from_str::<Vec<IdeConfig>>(&value).ok())
            .unwrap_or_else(default_ide_configs)
            .into_iter()
            .map(|mut tool| {
                if tool.id == "antigravity" {
                    tool.available = tool.command.as_deref().is_some_and(command_available)
                        || Path::new("/Applications/Antigravity IDE.app").exists()
                        || Path::new("/Applications/Dev/Antigravity.app").exists();
                } else {
                    tool.available = tool.command.as_deref().is_some_and(command_available);
                }
                tool
            })
            .collect();
        Ok(IdeSettings { tools })
    }

    pub fn save_ide_settings(&self, settings: &IdeSettings) -> Result<(), String> {
        for tool in &settings.tools {
            if let Some(command) = &tool.command { validate_ide_command(command)?; }
        }
        let serialized = serde_json::to_string(&settings.tools).map_err(|error| format!("No se pudieron serializar los ajustes: {error}"))?;
        self.connection.execute(
            "INSERT INTO settings(key, value) VALUES('ide_settings', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![serialized],
        ).map_err(|error| format!("No se pudieron guardar los ajustes: {error}"))?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        self.connection.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
            .optional()
            .map_err(|error| format!("No se pudo leer el ajuste '{key}': {error}"))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        ).map_err(|error| format!("No se pudo guardar el ajuste '{key}': {error}"))?;
        Ok(())
    }

    // ------------------------------------------------------------- bóveda de entorno

    pub fn list_env_vars_for_project(&self, project_id: &str) -> Result<Vec<EnvVar>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT * FROM project_env_vars WHERE project_id = ?1 ORDER BY scope, key COLLATE NOCASE")
            .map_err(|error| format!("No se pudo consultar las variables de entorno: {error}"))?;
        let rows = statement
            .query_map(params![project_id], map_env_var)
            .map_err(|error| format!("No se pudo leer las variables de entorno: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("No se pudo convertir las variables de entorno: {error}"))
    }

    /// Variables cuyo proyecto ya no existe. Se ordenan por cuándo quedaron
    /// huérfanas para que lo último que se borró esté arriba.
    pub fn list_orphan_env_vars(&self) -> Result<Vec<EnvVar>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT * FROM project_env_vars WHERE project_id IS NULL ORDER BY orphaned_at DESC, origin_project_name COLLATE NOCASE, scope, key COLLATE NOCASE")
            .map_err(|error| format!("No se pudo consultar la bóveda de variables huérfanas: {error}"))?;
        let rows = statement
            .query_map([], map_env_var)
            .map_err(|error| format!("No se pudo leer la bóveda de variables huérfanas: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("No se pudo convertir la bóveda de variables huérfanas: {error}"))
    }

    pub fn count_orphan_env_vars(&self) -> Result<usize, String> {
        self.connection
            .query_row("SELECT COUNT(*) FROM project_env_vars WHERE project_id IS NULL", [], |row| row.get::<_, i64>(0))
            .map(|count| count.max(0) as usize)
            .map_err(|error| format!("No se pudo contar las variables huérfanas: {error}"))
    }

    pub fn get_env_var(&self, id: &str) -> Result<EnvVar, String> {
        self.connection
            .query_row("SELECT * FROM project_env_vars WHERE id = ?1", params![id], map_env_var)
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => "Esa variable de entorno ya no está en la bóveda.".to_string(),
                _ => format!("No se pudo leer la variable de entorno: {error}"),
            })
    }

    /// Crea o reemplaza una fila por su identificador. El conflicto sobre
    /// `(project_id, scope, key)` se traduce a un mensaje entendible: es lo que
    /// pasa al renombrar una clave encima de otra que ya existe.
    pub fn upsert_env_var(&self, variable: &EnvVar) -> Result<EnvVar, String> {
        self.connection.execute(
            "INSERT INTO project_env_vars (id, project_id, scope, key, value, is_secret, is_enabled, comment, created_at, updated_at, origin_project_name, origin_project_path, orphaned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               scope = excluded.scope, key = excluded.key, value = excluded.value,
               is_secret = excluded.is_secret, is_enabled = excluded.is_enabled,
               comment = excluded.comment, updated_at = excluded.updated_at",
            params![
                variable.id, variable.project_id, variable.scope, variable.key, variable.value,
                if variable.is_secret { 1 } else { 0 }, if variable.is_enabled { 1 } else { 0 },
                variable.comment, variable.created_at, variable.updated_at,
                variable.origin_project_name, variable.origin_project_path, variable.orphaned_at,
            ],
        ).map_err(|error| {
            if error.to_string().contains("UNIQUE") {
                format!("«{}» ya existe en {}. Edita la que hay o usa otro nombre.", variable.key, variable.scope)
            } else {
                format!("No se pudo guardar la variable de entorno: {error}")
            }
        })?;
        self.get_env_var(&variable.id)
    }

    pub fn delete_env_vars(&self, ids: &[String]) -> Result<usize, String> {
        if ids.is_empty() { return Ok(0); }
        let transaction = self.connection.unchecked_transaction()
            .map_err(|error| format!("No se pudo abrir la transacción: {error}"))?;
        let mut removed = 0;
        {
            let mut statement = transaction.prepare("DELETE FROM project_env_vars WHERE id = ?1")
                .map_err(|error| format!("No se pudo preparar el borrado: {error}"))?;
            for id in ids {
                removed += statement.execute(params![id])
                    .map_err(|error| format!("No se pudo borrar la variable de entorno: {error}"))?;
            }
        }
        transaction.commit().map_err(|error| format!("No se pudo confirmar el borrado: {error}"))?;
        Ok(removed)
    }

    /// Importa variables interpretadas en un ámbito, fusionando: añade las que
    /// faltan y actualiza el valor de las que ya están. Nunca borra, porque una
    /// clave que solo vive en la bóveda —el proyecto ya no tiene el fichero— se
    /// perdería sin que nadie lo pidiera.
    pub fn import_env_vars(&self, project_id: &str, scope: &str, parsed: &[ParsedEnvVar]) -> Result<ImportEnvResult, String> {
        let existing: std::collections::HashMap<String, String> = self
            .list_env_vars_for_project(project_id)?
            .into_iter()
            .filter(|variable| variable.scope == scope)
            .map(|variable| (variable.key, variable.value))
            .collect();

        let now = Utc::now().to_rfc3339();
        let transaction = self.connection.unchecked_transaction()
            .map_err(|error| format!("No se pudo abrir la transacción: {error}"))?;
        let mut result = ImportEnvResult { scope: scope.to_string(), added: 0, updated: 0, unchanged: 0 };
        {
            let mut statement = transaction.prepare(
                "INSERT INTO project_env_vars (id, project_id, scope, key, value, is_secret, is_enabled, comment, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?8)
                 ON CONFLICT(project_id, scope, key) DO UPDATE SET
                   value = excluded.value,
                   updated_at = excluded.updated_at,
                   comment = COALESCE(excluded.comment, comment),
                   is_secret = MAX(is_secret, excluded.is_secret)"
            ).map_err(|error| format!("No se pudo preparar la importación: {error}"))?;
            for variable in parsed {
                match existing.get(&variable.key) {
                    None => result.added += 1,
                    Some(current) if *current != variable.value => result.updated += 1,
                    Some(_) => { result.unchanged += 1; continue; }
                }
                statement.execute(params![
                    uuid::Uuid::new_v4().to_string(), project_id, scope, variable.key, variable.value,
                    if env_vars::is_secret_key(&variable.key, &variable.value) { 1 } else { 0 },
                    variable.comment, now,
                ]).map_err(|error| format!("No se pudo importar «{}»: {error}", variable.key))?;
            }
        }
        transaction.commit().map_err(|error| format!("No se pudo confirmar la importación: {error}"))?;
        Ok(result)
    }

    /// Graba en las variables de quién eran, justo antes de que el borrado del
    /// proyecto ponga `project_id` a `NULL`. Sin esto una huérfana sería un
    /// puñado de claves sin dueño: `DATABASE_URL` no dice de qué proyecto.
    pub fn stamp_env_var_origin(&self, project_id: &str) -> Result<usize, String> {
        let project = self.get_project(project_id)?;
        self.connection.execute(
            "UPDATE project_env_vars SET origin_project_name = ?2, origin_project_path = ?3, orphaned_at = ?4 WHERE project_id = ?1",
            params![project_id, project.name, project.path, Utc::now().to_rfc3339()],
        ).map_err(|error| format!("No se pudo registrar el origen de las variables: {error}"))
    }

    /// Devuelve variables huérfanas a un proyecto. Con `scope` se fuerza el
    /// fichero de destino; sin él, cada variable conserva el que tenía.
    pub fn adopt_env_vars(&self, ids: &[String], project_id: &str, scope: Option<&str>) -> Result<usize, String> {
        if ids.is_empty() { return Ok(0); }
        // El proyecto debe existir: sin esta comprobación la clave ajena falla
        // con «FOREIGN KEY constraint failed», que no dice nada al usuario.
        self.get_project(project_id)?;
        let transaction = self.connection.unchecked_transaction()
            .map_err(|error| format!("No se pudo abrir la transacción: {error}"))?;
        let mut adopted = 0;
        {
            let mut statement = transaction.prepare(
                "UPDATE project_env_vars
                 SET project_id = ?2, scope = COALESCE(?3, scope), orphaned_at = NULL, updated_at = ?4
                 WHERE id = ?1 AND project_id IS NULL"
            ).map_err(|error| format!("No se pudo preparar la restauración: {error}"))?;
            let now = Utc::now().to_rfc3339();
            for id in ids {
                adopted += statement.execute(params![id, project_id, scope, now]).map_err(|error| {
                    if error.to_string().contains("UNIQUE") {
                        "Alguna de esas claves ya existe en el proyecto de destino. Bórrala allí primero o restaura las variables una a una.".to_string()
                    } else {
                        format!("No se pudo restaurar la variable de entorno: {error}")
                    }
                })?;
            }
        }
        transaction.commit().map_err(|error| format!("No se pudo confirmar la restauración: {error}"))?;
        Ok(adopted)
    }
}

/// Ventana durante la cual se reutiliza el resultado de comprobar si la carpeta
/// de un proyecto sigue montada. El sondeo de la interfaz ocurre cada 6 s.
const AVAILABILITY_TTL: Duration = Duration::from_secs(30);

type AvailabilityCache = HashMap<String, (Instant, bool)>;

fn availability_cache() -> &'static Mutex<AvailabilityCache> {
    static CACHE: OnceLock<Mutex<AvailabilityCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Marca como «requiere atención» los proyectos cuya carpeta no está montada.
///
/// Una carpeta ausente no implica que el proyecto deba desaparecer del
/// registro: basta con un volumen externo desmontado para perder todos los
/// proyectos que viven en él. Se marca el problema y se deja que el usuario
/// decida borrarlo desde el detalle.
///
/// Se llama FUERA del mutex del almacenamiento: en un volumen de red o en un
/// disco dormido cada `is_dir` puede tardar segundos, y hacerlo con el mutex
/// tomado congelaba el resto de comandos (arrancar, detener, fijar) detrás del
/// sondeo periódico. El resultado además se memoiza con un TTL corto para no
/// repetir la E/S en cada sondeo.
pub fn mark_unavailable_projects(projects: &mut [Project]) {
    let mut cache = availability_cache().lock().unwrap_or_else(|error| error.into_inner());
    cache.retain(|_, (captured_at, _)| captured_at.elapsed() < AVAILABILITY_TTL);
    for project in projects.iter_mut() {
        let available = match cache.get(&project.canonical_path) {
            Some((_, available)) => *available,
            None => {
                let available = Path::new(&project.canonical_path).is_dir();
                cache.insert(project.canonical_path.clone(), (Instant::now(), available));
                available
            }
        };
        if !available {
            project.status = ProjectStatus::Error;
            project.last_error = Some("La carpeta registrada no está disponible en el disco.".into());
        }
    }
}

/// Olvida la disponibilidad memoizada. Se llama al registrar, borrar o mover
/// proyectos para que el siguiente listado refleje el cambio sin esperar el TTL.
pub fn invalidate_availability_cache() {
    if let Ok(mut cache) = availability_cache().lock() {
        cache.clear();
    }
}

fn map_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    let frameworks: String = row.get("frameworks_json")?;
    let tags: String = row.get("tags_json")?;
    let disk_size_bytes: i64 = row.get("disk_size_bytes")?;
    let is_pinned: i64 = row.get("is_pinned").unwrap_or(0);
    let is_archived: i64 = row.get("is_archived").unwrap_or(0);
    Ok(Project {
        id: row.get("id")?, name: row.get("name")?, path: row.get("path")?, canonical_path: row.get("canonical_path")?, project_type: row.get("project_type")?,
        frameworks: serde_json::from_str(&frameworks).unwrap_or_default(), package_manager: row.get("package_manager")?, dev_command: row.get("dev_command")?, build_command: row.get("build_command")?, test_command: row.get("test_command")?, local_url: row.get("local_url")?,
        port: row.get("port")?, status: ProjectStatus::from_db(&row.get::<_, String>("status")?), last_used_at: row.get("last_used_at")?, disk_size_bytes: disk_size_bytes.max(0) as u64,
        tags: serde_json::from_str(&tags).unwrap_or_default(), created_at: row.get("created_at")?, last_error: row.get("last_error")?,
        is_pinned: is_pinned != 0,
        is_archived: is_archived != 0,
        kind: row.get::<_, String>("kind").map(|value| ProjectKind::from_db(&value)).unwrap_or_default(),
    })
}

fn map_env_var(row: &Row<'_>) -> rusqlite::Result<EnvVar> {
    Ok(EnvVar {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        scope: row.get("scope")?,
        key: row.get("key")?,
        value: row.get("value")?,
        is_secret: row.get::<_, i64>("is_secret")? != 0,
        is_enabled: row.get::<_, i64>("is_enabled")? != 0,
        comment: row.get("comment")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        origin_project_name: row.get("origin_project_name")?,
        origin_project_path: row.get("origin_project_path")?,
        orphaned_at: row.get("orphaned_at")?,
    })
}

fn json<T: serde::Serialize>(value: &T) -> String { serde_json::to_string(value).unwrap_or_else(|_| "[]".into()) }

pub fn default_ide_configs() -> Vec<IdeConfig> {
    vec![
        IdeConfig {
            id: "antigravity".into(),
            label: "Antigravity IDE".into(),
            command: Some("agy".into()),
            available: Path::new("/Applications/Antigravity IDE.app").exists() || Path::new("/Applications/Dev/Antigravity.app").exists() || command_available("agy"),
        },
        IdeConfig {
            id: "codex".into(),
            label: "Codex".into(),
            command: Some("codex".into()),
            available: Path::new("/Applications/Codex.app").exists() || Path::new("/opt/homebrew/bin/codex").exists() || command_available("codex"),
        },
    ]
}

pub fn command_available(command: &str) -> bool {
    let candidate = Path::new(command);
    if candidate.components().count() > 1 { return candidate.is_file(); }
    // Una app lanzada desde Finder hereda un `PATH` mínimo (`/usr/bin:/bin:…`),
    // así que las herramientas instaladas en Homebrew o `~/.local/bin` se
    // reportaban siempre como «No detectado». Se usa el mismo `PATH` ampliado
    // con el que después se lanzan los procesos.
    let paths = crate::process::enhanced_path();
    std::env::split_paths(&paths).any(|dir| dir.join(command).is_file())
}

pub fn validate_ide_command(command: &str) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() { return Ok(()); }
    if trimmed.split_whitespace().count() != 1 {
        return Err("El comando del IDE debe ser solo un ejecutable, sin argumentos ni shell.".into());
    }
    if ["sh", "bash", "zsh", "fish", "rm", "sudo", "env"].contains(&trimmed) {
        return Err("Ese ejecutable no se permite en la configuración de IDEs.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ProjectStatus;
    use tempfile::tempdir;

    fn parsed(key: &str, value: &str) -> ParsedEnvVar {
        ParsedEnvVar { key: key.into(), value: value.into(), comment: None }
    }

    fn fixture(id: &str, path: &str) -> Project {
        Project {
            id: id.into(),
            name: "fixture".into(),
            path: path.into(),
            canonical_path: path.into(),
            project_type: "Node.js".into(),
            frameworks: vec!["React".into()],
            package_manager: Some("pnpm".into()),
            dev_command: Some("pnpm dev".into()),
            build_command: None,
            test_command: None,
            local_url: None,
            port: Some(5173),
            status: ProjectStatus::Stopped,
            last_used_at: None,
            disk_size_bytes: 4_096,
            tags: vec!["web".into()],
            created_at: "2026-01-01T00:00:00Z".into(),
            last_error: None,
            is_pinned: false,
            is_archived: false,
            kind: ProjectKind::Service,
        }
    }

    /// Regresión: el commit que añadió el archivado borró por accidente
    /// `disk_size_bytes` del `CREATE TABLE`. Las bases existentes ya tenían la
    /// columna, así que el fallo solo aparecía en una instalación nueva: el
    /// registro de proyectos fallaba con «table projects has no column named
    /// disk_size_bytes». Este test crea la base desde cero a propósito.
    #[test]
    fn fresh_database_accepts_and_returns_a_project() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("nested").join("registry.sqlite3")).expect("open storage");

        storage.insert_project(&fixture("p1", directory.path().to_str().expect("path"))).expect("insert project");

        let projects = storage.list_projects().expect("list projects");
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].disk_size_bytes, 4_096);
        assert_eq!(projects[0].tags, vec!["web".to_string()]);
        assert!(!projects[0].is_pinned);
    }

    /// Fijar y archivar son mutuamente excluyentes en la interfaz, y la base es
    /// la que debe garantizarlo.
    #[test]
    fn pinning_clears_archived_and_archiving_clears_pinned() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("p1", directory.path().to_str().expect("path"))).expect("insert project");

        storage.toggle_project_archive("p1", true).expect("archive");
        storage.toggle_project_pin("p1", true).expect("pin");
        let project = storage.get_project("p1").expect("get project");
        assert!(project.is_pinned && !project.is_archived);

        storage.toggle_project_archive("p1", true).expect("archive again");
        let project = storage.get_project("p1").expect("get project");
        assert!(project.is_archived && !project.is_pinned);
    }

    /// El registro no debe perderse porque el volumen esté desmontado: solo se
    /// marca el fallo.
    #[test]
    fn missing_folder_is_flagged_not_deleted() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("p1", "/volumen/desmontado/proyecto")).expect("insert project");

        let mut projects = storage.list_projects().expect("list projects");
        assert_eq!(projects[0].status, ProjectStatus::Stopped, "list_projects no debe hacer E/S");

        invalidate_availability_cache();
        mark_unavailable_projects(&mut projects);
        assert_eq!(projects[0].status, ProjectStatus::Error);
        assert!(projects[0].last_error.is_some());
        assert_eq!(storage.list_projects().expect("list again").len(), 1, "la fila sigue registrada");
    }

    /// La naturaleza se guarda con el proyecto y la reescribe cada reescaneo. No
    /// se puede forzar a mano: es una lectura del contenido de la carpeta.
    #[test]
    fn the_detected_kind_is_stored_and_rewritten_by_a_rescan() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        let mut project = fixture("p1", directory.path().to_str().expect("path"));
        project.kind = ProjectKind::Script;
        storage.insert_project(&project).expect("insert project");

        assert_eq!(storage.get_project("p1").expect("get project").kind, ProjectKind::Script);

        let mut rescanned = storage.get_project("p1").expect("get project");
        rescanned.kind = ProjectKind::Service;
        storage.refresh_project_metadata(&rescanned).expect("refresh");
        assert_eq!(storage.get_project("p1").expect("get project").kind, ProjectKind::Service);
    }

    /// WAL es lo que permite que el servidor MCP y la app usen el mismo fichero
    /// a la vez sin «database is locked».
    #[test]
    fn opens_the_database_in_wal_mode() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        let mode: String = storage
            .connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal mode");
        assert_eq!(mode.to_lowercase(), "wal");
    }

    /// La decisión central de la bóveda: borrar un proyecto NO se lleva sus
    /// variables. `command_history` sí usa `ON DELETE CASCADE`; aquí sería
    /// perder una credencial que no está ni en el disco ni en GitHub.
    #[test]
    fn deleting_a_project_orphans_its_variables_instead_of_erasing_them() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("p1", directory.path().to_str().expect("path"))).expect("insert project");
        storage.import_env_vars("p1", ".env", &[parsed("DATABASE_URL", "postgres://x"), parsed("PORT", "3000")]).expect("import");

        storage.stamp_env_var_origin("p1").expect("stamp");
        storage.delete_project("p1").expect("delete project");

        assert!(storage.list_env_vars_for_project("p1").expect("list").is_empty());
        let orphans = storage.list_orphan_env_vars().expect("orphans");
        assert_eq!(orphans.len(), 2);
        assert_eq!(storage.count_orphan_env_vars().expect("count"), 2);
        // El nombre y la ruta del proyecto original son lo que hace legible una
        // huérfana: sin ellos son claves sin dueño.
        assert_eq!(orphans[0].origin_project_name.as_deref(), Some("fixture"));
        assert!(orphans[0].origin_project_path.is_some());
        assert!(orphans[0].orphaned_at.is_some());
        assert!(orphans[0].project_id.is_none());
    }

    /// Importar fusiona: actualiza lo que cambió y jamás borra una clave que ya
    /// solo vive en la bóveda porque el fichero del disco desapareció.
    #[test]
    fn importing_merges_and_never_removes_what_the_file_no_longer_has() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("p1", directory.path().to_str().expect("path"))).expect("insert project");

        let first = storage.import_env_vars("p1", ".env", &[parsed("A", "1"), parsed("B", "2")]).expect("import");
        assert_eq!((first.added, first.updated, first.unchanged), (2, 0, 0));

        let second = storage.import_env_vars("p1", ".env", &[parsed("A", "1"), parsed("B", "cambiada"), parsed("C", "3")]).expect("reimport");
        assert_eq!((second.added, second.updated, second.unchanged), (1, 1, 1));

        let stored = storage.list_env_vars_for_project("p1").expect("list");
        assert_eq!(stored.len(), 3, "A no debe desaparecer nunca");
        let by_key: HashMap<&str, &str> = stored.iter().map(|v| (v.key.as_str(), v.value.as_str())).collect();
        assert_eq!(by_key.get("B").copied(), Some("cambiada"));
    }

    /// La heurística de secretos se aplica al importar, y una reimportación no
    /// puede deshacer lo que el usuario marcó a mano.
    #[test]
    fn the_secret_flag_is_detected_on_import_and_never_downgraded() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("p1", directory.path().to_str().expect("path"))).expect("insert project");
        storage.import_env_vars("p1", ".env", &[parsed("API_TOKEN", "abc"), parsed("LOG_LEVEL", "debug")]).expect("import");

        let mut manual = storage.list_env_vars_for_project("p1").expect("list").into_iter().find(|v| v.key == "LOG_LEVEL").expect("LOG_LEVEL");
        assert!(!manual.is_secret);
        manual.is_secret = true;
        storage.upsert_env_var(&manual).expect("marcar como secreta");

        storage.import_env_vars("p1", ".env", &[parsed("LOG_LEVEL", "info")]).expect("reimport");
        let stored = storage.list_env_vars_for_project("p1").expect("list");
        assert!(stored.iter().find(|v| v.key == "API_TOKEN").expect("API_TOKEN").is_secret);
        assert!(stored.iter().find(|v| v.key == "LOG_LEVEL").expect("LOG_LEVEL").is_secret, "reimportar no debe desmarcarla");
    }

    /// Dos proyectos distintos pueden tener `DATABASE_URL`, y sus huérfanas
    /// tienen que poder convivir en la bóveda. El índice único es sobre
    /// `(project_id, scope, key)` y SQLite trata cada NULL como distinto.
    #[test]
    fn the_same_key_can_live_in_several_projects_and_as_several_orphans() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("p1", directory.path().join("uno").to_str().expect("path"))).expect("insert p1");
        storage.insert_project(&fixture("p2", directory.path().join("dos").to_str().expect("path"))).expect("insert p2");
        storage.import_env_vars("p1", ".env", &[parsed("DATABASE_URL", "uno")]).expect("import p1");
        storage.import_env_vars("p2", ".env", &[parsed("DATABASE_URL", "dos")]).expect("import p2");

        for id in ["p1", "p2"] {
            storage.stamp_env_var_origin(id).expect("stamp");
            storage.delete_project(id).expect("delete");
        }
        assert_eq!(storage.list_orphan_env_vars().expect("orphans").len(), 2);
    }

    #[test]
    fn a_repeated_key_inside_one_project_is_rejected_with_a_readable_message() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("p1", directory.path().to_str().expect("path"))).expect("insert project");
        storage.import_env_vars("p1", ".env", &[parsed("A", "1"), parsed("B", "2")]).expect("import");

        let mut duplicate = storage.list_env_vars_for_project("p1").expect("list").into_iter().find(|v| v.key == "B").expect("B");
        duplicate.key = "A".into();
        let error = storage.upsert_env_var(&duplicate).expect_err("debe rechazarse");
        assert!(error.contains("«A» ya existe"), "{error}");
    }

    /// Rescatar una huérfana la devuelve a un proyecto vivo, opcionalmente en
    /// otro fichero de entorno.
    #[test]
    fn an_orphan_can_be_restored_into_another_project() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        storage.insert_project(&fixture("viejo", directory.path().join("viejo").to_str().expect("path"))).expect("insert viejo");
        storage.insert_project(&fixture("nuevo", directory.path().join("nuevo").to_str().expect("path"))).expect("insert nuevo");
        storage.import_env_vars("viejo", ".env", &[parsed("API_TOKEN", "abc")]).expect("import");
        storage.stamp_env_var_origin("viejo").expect("stamp");
        storage.delete_project("viejo").expect("delete");

        let orphan = storage.list_orphan_env_vars().expect("orphans").remove(0);
        assert_eq!(storage.adopt_env_vars(&[orphan.id.clone()], "nuevo", Some(".env.local")).expect("adopt"), 1);

        assert!(storage.list_orphan_env_vars().expect("orphans").is_empty());
        let restored = storage.list_env_vars_for_project("nuevo").expect("list");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].scope, ".env.local");
        assert!(restored[0].orphaned_at.is_none(), "ya no es huérfana");
        // El origen se conserva: sigue siendo útil saber de dónde salió.
        assert_eq!(restored[0].origin_project_name.as_deref(), Some("fixture"));
    }

    #[test]
    fn restoring_into_a_project_that_no_longer_exists_fails_before_touching_anything() {
        let directory = tempdir().expect("tempdir");
        let storage = Storage::open(&directory.path().join("registry.sqlite3")).expect("open storage");
        let error = storage.adopt_env_vars(&["cualquiera".into()], "no-existe", None).expect_err("debe fallar");
        assert!(error.contains("No se encontró el proyecto"), "{error}");
    }
}
