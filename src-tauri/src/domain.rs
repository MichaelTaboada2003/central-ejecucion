use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub canonical_path: String,
    pub project_type: String,
    pub frameworks: Vec<String>,
    pub package_manager: Option<String>,
    pub dev_command: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub local_url: Option<String>,
    pub port: Option<u16>,
    pub status: ProjectStatus,
    pub last_used_at: Option<String>,
    pub disk_size_bytes: u64,
    pub tags: Vec<String>,
    pub created_at: String,
    pub last_error: Option<String>,
    #[serde(default)]
    pub is_pinned: bool,
    #[serde(default)]
    pub is_archived: bool,
    /// Naturaleza deducida por el detector en el último escaneo.
    #[serde(default)]
    pub kind: ProjectKind,
    /// Naturaleza forzada por el usuario. Ningún clasificador automático acierta
    /// siempre —hay scripts que arrancan un servidor— así que la deducción es un
    /// valor por omisión, no una jaula.
    #[serde(default)]
    pub kind_override: Option<ProjectKind>,
}

impl Project {
    /// Naturaleza que manda de verdad: la elegida por el usuario si la hay.
    pub fn effective_kind(&self) -> ProjectKind {
        self.kind_override.unwrap_or(self.kind)
    }
}

/// Cómo debe tratarse un proyecto. El panel asumía que todo era un servidor de
/// desarrollo: un script de Python que corre y termina no tiene puerto, y su
/// estado «en ejecución» —que se deduce de quién escucha el puerto— era una
/// ficción.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    /// Servidor de larga duración: tiene puerto, URL y arrancar/detener.
    #[default]
    Service,
    /// Tarea de una pasada: importa el código de salida y la duración, no el puerto.
    Script,
    /// Cuadernos Jupyter: la acción útil es abrir Jupyter Lab.
    Notebook,
    /// Nada ejecutable en la raíz (repos de documentación, monorepos sin scripts).
    Inert,
}

impl ProjectKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Script => "script",
            Self::Notebook => "notebook",
            Self::Inert => "inert",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "script" => Self::Script,
            "notebook" => Self::Notebook,
            "inert" => Self::Inert,
            _ => Self::Service,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

impl ProjectStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Error => "error",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "starting" => Self::Starting,
            "running" => Self::Running,
            "error" => Self::Error,
            _ => Self::Stopped,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedScript {
    pub name: String,
    pub command: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredDependency {
    pub name: String,
    pub version: Option<String>,
    pub is_dev: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScan {
    pub project_type: String,
    #[serde(default)]
    pub kind: ProjectKind,
    pub frameworks: Vec<String>,
    pub package_manager: Option<String>,
    pub manifests: Vec<String>,
    pub lockfile: Option<String>,
    pub scripts: Vec<DetectedScript>,
    pub dev_command: Option<String>,
    pub build_command: Option<String>,
    pub test_command: Option<String>,
    pub local_url: Option<String>,
    pub port: Option<u16>,
    pub declared_dependencies: usize,
    pub dependencies: Vec<DeclaredDependency>,
    pub installed_dependencies: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
    pub display: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub project_id: String,
    pub pid: u32,
    pub started_at: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub project_id: String,
    pub stream: String,
    pub line: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRecord {
    pub id: String,
    pub project_id: String,
    pub action: String,
    pub command: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub scan: ProjectScan,
    pub process: Option<ProcessInfo>,
    pub recent_commands: Vec<CommandRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskEntry {
    pub target: String,
    pub label: String,
    pub path: String,
    pub bytes: u64,
    pub regenerable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskReport {
    pub project_id: String,
    pub total_bytes: u64,
    pub entries: Vec<DiskEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupPreview {
    pub project_id: String,
    pub total_bytes: u64,
    pub entries: Vec<DiskEntry>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupRequest {
    pub project_id: String,
    pub targets: Vec<String>,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterProjectRequest {
    pub path: String,
    pub name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProjectRequest {
    pub project_id: String,
    pub action: String,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeConfig {
    pub id: String,
    pub label: String,
    pub command: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeSettings {
    pub tools: Vec<IdeConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port: u16,
    pub pid: Option<u32>,
    pub listening: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAccountStatus {
    pub authenticated: bool,
    pub username: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub total_repos: usize,
    pub token_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub html_url: String,
    pub clone_url: String,
    pub ssh_url: Option<String>,
    pub is_private: bool,
    pub language: Option<String>,
    pub stars: u32,
    pub forks: u32,
    pub updated_at: String,
    pub default_branch: String,
    pub is_cloned: bool,
    pub local_project_id: Option<String>,
    pub local_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepoRequest {
    pub repo_name: String,
    pub clone_url: String,
    pub is_private: bool,
    pub target_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafeOffloadResult {
    pub success: bool,
    pub project_id: String,
    pub project_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusInfo {
    pub is_repo: bool,
    pub current_branch: Option<String>,
    pub remote_url: Option<String>,
    pub remote_name: Option<String>,
    pub branches: Vec<String>,
    pub remote_branches: Vec<String>,
    pub uncommitted_changes: Vec<GitFileChange>,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub last_commit_message: Option<String>,
    pub last_commit_hash: Option<String>,
    pub last_commit_date: Option<String>,
    pub is_clean: bool,
    /// Cuándo se consultó GitHub por última vez. Sin esto, un «0 por bajar»
    /// mentiría: las cuentas se hacen contra la copia local de `origin/*`, que
    /// solo cambia al hacer `git fetch`.
    #[serde(default)]
    pub last_fetch_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionResult {
    pub success: bool,
    pub message: String,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishToGitHubRequest {
    pub project_id: String,
    pub repo_name: String,
    pub description: Option<String>,
    pub is_private: bool,
}
