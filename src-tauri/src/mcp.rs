//! Local stdio MCP bridge for Dev Command Center.
//!
//! This module intentionally has no HTTP listener. It reuses the same SQLite
//! registry and safe scanner as the desktop app. A background process started
//! through this bridge is owned only while the stdio MCP session is alive.

use crate::disk;
use crate::domain::{
    CleanupPreview, CommandRecord, CommandSpec, DiskReport, EnvFileInfo, EnvVar,
    LogEntry, ProcessInfo, Project, ProjectDetail, ProjectScan, ProjectStatus,
};
use crate::ide;
use crate::process::enhanced_path;
use crate::scanner::{self, canonical_project_path, command_for_action, scan_project};
use crate::storage::Storage;
use chrono::Utc;
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    schemars, tool, tool_handler, tool_router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

const LOG_LIMIT: usize = 400;
const CLEANUP_GRANT_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
pub struct DevCommandCenterMcp {
    tool_router: ToolRouter<Self>,
    state: Arc<Mutex<McpState>>,
}

struct McpState {
    storage: Storage,
    database_path: PathBuf,
    processes: McpProcessRegistry,
    cleanup_grants: HashMap<String, CleanupGrant>,
}

struct CleanupGrant {
    project_id: String,
    preview: CleanupPreview,
    expires_at: Instant,
}

struct McpProcessRegistry {
    processes: HashMap<String, McpManagedProcess>,
}

struct McpManagedProcess {
    child: Child,
    info: ProcessInfo,
    command_record_id: String,
    logs: Arc<Mutex<Vec<LogEntry>>>,
}

impl Drop for McpProcessRegistry {
    fn drop(&mut self) {
        for (_, process) in self.processes.iter_mut() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ProjectIdRequest {
    #[schemars(description = "UUID of a project already registered in Dev Command Center")]
    pub project_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RegisterRequest {
    #[schemars(description = "Absolute or relative local path to an existing project directory")]
    pub path: String,
    #[schemars(description = "Optional display name. The folder name is used when omitted.")]
    pub name: Option<String>,
    #[schemars(description = "Optional user labels for filtering, for example [client, SaaS]")]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CommandRequest {
    pub project_id: String,
    #[schemars(description = "One of dev, build, test, lint, format, typecheck, install or script")]
    pub action: String,
    #[schemars(description = "Required only when action is script; must be a script detected in package.json")]
    pub script: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct OpenToolRequest {
    pub project_id: String,
    #[schemars(description = "finder, terminal, antigravity, or codex")]
    pub tool_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CleanupApplyRequest {
    #[schemars(description = "Token returned by dev_command_center_cleanup_preview and valid for five minutes")]
    pub confirmation_token: String,
    #[schemars(description = "Set true only after the user has explicitly reviewed and approved the previewed paths")]
    pub confirmed_by_user: bool,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CloneRepoMcpRequest {
    #[schemars(description = "Name of the repository to clone")]
    pub repo_name: String,
    #[schemars(description = "Git clone URL (HTTPS or SSH)")]
    pub clone_url: String,
    #[schemars(description = "Whether the repository is private")]
    pub is_private: bool,
    #[schemars(description = "Optional custom destination directory. Defaults to standard project workspace directory.")]
    pub target_path: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SafeOffloadMcpRequest {
    #[schemars(description = "UUID of the project to safely offload and delete locally")]
    pub project_id: String,
    #[schemars(description = "Force deletion even if git status has uncommitted changes (defaults to false)")]
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetGitHubTokenMcpRequest {
    #[schemars(description = "GitHub Personal Access Token (classic or fine-grained)")]
    pub token: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetDefaultCloneDirMcpRequest {
    #[schemars(description = "Base absolute directory path where projects will be cloned by default")]
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IdeConfigMcp {
    pub id: String,
    pub label: String,
    pub command: Option<String>,
    pub available: bool,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SaveIdeSettingsMcpRequest {
    #[schemars(description = "List of IDE and editor tool configurations")]
    pub tools: Vec<IdeConfigMcp>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListEnvVarsMcpRequest {
    #[schemars(description = "UUID, folder path, or name of a project registered in Dev Command Center")]
    pub project_id: String,
    #[schemars(description = "If true, reveals unmasked secret values instead of masking them (defaults to false)")]
    pub reveal_secrets: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetEnvVarMcpRequest {
    #[schemars(description = "UUID, folder path, or name of a project registered in Dev Command Center")]
    pub project_id: String,
    #[schemars(description = "Variable key name, e.g. 'DATABASE_URL' or 'VITE_API_KEY'")]
    pub key: String,
    #[schemars(description = "Variable string value")]
    pub value: String,
    #[schemars(description = "Target file scope, e.g. '.env' (default) or '.env.local'")]
    pub scope: Option<String>,
    #[schemars(description = "Whether to treat as secret (masked in UI/logs). Auto-detected from key/value if omitted.")]
    pub is_secret: Option<bool>,
    #[schemars(description = "Whether the variable is enabled (injected on execution). Default true.")]
    pub is_enabled: Option<bool>,
    #[schemars(description = "Optional note or comment explaining this variable")]
    pub comment: Option<String>,
    #[schemars(description = "Whether to immediately write and sync the scope file (.env) to disk in the project folder. Defaults to true.")]
    pub write_to_disk: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct WriteEnvFileMcpRequest {
    #[schemars(description = "UUID, folder path, or name of a project registered in Dev Command Center")]
    pub project_id: String,
    #[schemars(description = "File scope to write, e.g. '.env' (default) or '.env.local'")]
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ImportEnvFileMcpRequest {
    #[schemars(description = "UUID, folder path, or name of a project registered in Dev Command Center")]
    pub project_id: String,
    #[schemars(description = "File scope in project root to read, e.g. '.env' (default) or '.env.local'")]
    pub scope: Option<String>,
    #[schemars(description = "Optional raw text content. If omitted, reads the file directly from project root on disk.")]
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SetEnvVarMcpResponse {
    pub variable: EnvVar,
    pub written_to_disk: bool,
    pub disk_write: Option<WriteEnvFileMcpResult>,
}

#[derive(Debug, Serialize)]
pub struct WriteEnvFileMcpResult {
    pub path: String,
    pub scope: String,
    pub written_count: usize,
    pub backup_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EnvVarViewMcp {
    pub id: String,
    pub scope: String,
    pub key: String,
    pub value: String,
    pub is_secret: bool,
    pub is_enabled: bool,
    pub comment: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ListEnvVarsMcpResponse {
    pub project_id: String,
    pub project_name: String,
    pub project_path: String,
    pub total_vault_vars: usize,
    pub unprotected_disk_keys: usize,
    pub disk_files: Vec<EnvFileInfo>,
    pub vars: Vec<EnvVarViewMcp>,
}

#[derive(Debug, Serialize)]
struct CommandPlan<'a> {
    project: &'a Project,
    scan: &'a ProjectScan,
    command: &'a CommandSpec,
    note: &'static str,
}

#[derive(Debug, Serialize)]
struct ExecuteResult {
    project_id: String,
    action: String,
    command: String,
    exit_code: Option<i32>,
    success: bool,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
struct CleanupPreviewResponse {
    confirmation_token: String,
    expires_in_seconds: u64,
    preview: CleanupPreview,
    instruction: &'static str,
}

#[derive(Debug, Serialize)]
struct McpProcessSnapshot {
    process: Option<ProcessInfo>,
    logs: Vec<LogEntry>,
    lifecycle: &'static str,
}

impl DevCommandCenterMcp {
    pub fn open_default() -> Result<Self, String> {
        let database_path = database_path_from_environment()?;
        let storage = Storage::open(&database_path)?;
        Ok(Self {
            tool_router: Self::tool_router(),
            state: Arc::new(Mutex::new(McpState {
                storage,
                database_path,
                processes: McpProcessRegistry { processes: HashMap::new() },
                cleanup_grants: HashMap::new(),
            })),
        })
    }

    pub async fn serve_stdio(self) -> Result<(), String> {
        let server = self.serve(rmcp::transport::stdio()).await.map_err(|error| error.to_string())?;
        server.waiting().await.map_err(|error| error.to_string())?;
        Ok(())
    }

    fn with_state<T>(&self, operation: impl FnOnce(&mut McpState) -> Result<T, String>) -> Result<T, String> {
        let mut state = self.state.lock().map_err(|_| "El puente MCP está ocupado.".to_string())?;
        operation(&mut state)
    }

    fn project_and_scan<'a>(state: &'a mut McpState, project_id: &str) -> Result<(Project, PathBuf, ProjectScan), String> {
        let project = state.storage.get_project(project_id)?;
        let root = match trusted_project_root(&project) {
            Ok(r) => r,
            Err(_) => {
                let _ = state.storage.delete_project(project_id);
                return Err("La carpeta del proyecto ya no existe en el disco y ha sido removida de la lista.".into());
            }
        };
        let scan = scan_project(&root)?;
        Ok((project, root, scan))
    }

    fn sync_mcp_process(state: &mut McpState, project_id: &str) -> Result<Option<ProcessInfo>, String> {
        let finished = if let Some(process) = state.processes.processes.get_mut(project_id) {
            match process.child.try_wait() {
                Ok(Some(status)) => Some((status, process.command_record_id.clone())),
                Ok(None) => return Ok(Some(process.info.clone())),
                Err(error) => return Err(format!("No se pudo consultar el proceso MCP: {error}")),
            }
        } else {
            return Ok(None);
        };
        if let Some((status, record_id)) = finished {
            state.processes.processes.remove(project_id);
            let success = status.success();
            state.storage.update_status(project_id, if success { ProjectStatus::Stopped } else { ProjectStatus::Error }, if success { None } else { Some("El proceso MCP terminó con error.") })?;
            state.storage.command_finished(&record_id, if success { "completed" } else { "error" }, status.code(), if success { None } else { Some("El proceso MCP terminó con código distinto de cero.") })?;
        }
        Ok(None)
    }

    fn start_dev_process(state: &mut McpState, request: CommandRequest) -> Result<ProcessInfo, String> {
        if state.processes.processes.contains_key(&request.project_id) {
            return Err("Este puente MCP ya administra un proceso para el proyecto solicitado.".into());
        }
        let (mut project, _, scan) = Self::project_and_scan(state, &request.project_id)?;
        if project.status == ProjectStatus::Running {
            return Err("El proyecto figura en ejecución. Para evitar interferir con un proceso de la UI u otro agente, este MCP no iniciará un segundo proceso.".into());
        }
        if !scan.installed_dependencies && scan.declared_dependencies > 0 {
            return Err("Primero debes instalar las dependencias del proyecto antes de iniciar el servidor de desarrollo.".into());
        }
        // El puerto se resuelve una vez y se pasa al constructor del comando: al
        // sobrescribir `scan.port` antes de construirlo, la comprobación interna
        // ya veía el puerto libre y nunca añadía el `--port` correspondiente.
        let mut desired_port = None;
        if let Some(port) = scan.port {
            let resolved = scanner::resolve_dev_port(&scan).unwrap_or(port);
            if resolved != port {
                desired_port = Some(resolved);
                project.port = Some(resolved);
                project.local_url = Some(format!("http://localhost:{resolved}"));
                let _ = state.storage.refresh_project_metadata(&project);
            }
        }
        let root = std::path::Path::new(&project.canonical_path);
        let spec = scanner::command_for_action_on_port(root, &scan, "dev", None, desired_port)?;
        if !command_available(&spec.program, root) {
            return Err(format!("No se encontró «{}» en PATH ni en el proyecto.", spec.program));
        }
        let started_at = Utc::now().to_rfc3339();
        let record = CommandRecord {
            id: Uuid::new_v4().to_string(),
            project_id: project.id.clone(),
            action: "dev".into(),
            command: spec.display.clone(),
            started_at: started_at.clone(),
            ended_at: None,
            exit_code: None,
            status: "running".into(),
            error_message: None,
        };
        state.storage.command_started(&record)?;
        let mut child = Command::new(&spec.program)
            .args(&spec.args)
            .envs(&spec.env)
            .env("PATH", enhanced_path())
            .current_dir(&project.canonical_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                let message = format!("No se pudo iniciar «{}»: {error}", spec.display);
                let _ = state.storage.command_finished(&record.id, "error", None, Some(&message));
                message
            })?;
        let info = ProcessInfo { project_id: project.id.clone(), pid: child.id(), started_at, command: spec.display };
        let logs = Arc::new(Mutex::new(Vec::new()));
        if let Some(stdout) = child.stdout.take() { collect_logs(project.id.clone(), "stdout", stdout, logs.clone()); }
        if let Some(stderr) = child.stderr.take() { collect_logs(project.id.clone(), "stderr", stderr, logs.clone()); }
        state.processes.processes.insert(project.id.clone(), McpManagedProcess { child, info: info.clone(), command_record_id: record.id, logs });
        state.storage.update_status(&project.id, ProjectStatus::Running, None)?;
        Ok(info)
    }

    fn stop_dev_process(state: &mut McpState, project_id: &str) -> Result<(), String> {
        let mut process = state.processes.processes.remove(project_id).ok_or_else(|| "Este MCP no administra un proceso activo para el proyecto. Nunca terminará procesos iniciados por otra aplicación.".to_string())?;
        let _ = process.child.kill();
        let status = process.child.wait().map_err(|error| format!("No se pudo esperar el proceso detenido: {error}"))?;
        state.storage.update_status(project_id, ProjectStatus::Stopped, None)?;
        state.storage.command_finished(&process.command_record_id, "stopped", status.code(), None)?;
        Ok(())
    }
}

#[tool_router(router = tool_router)]
impl DevCommandCenterMcp {
    #[tool(description = "Get MCP bridge status, its SQLite database path, and the explicit safety policy.")]
    fn dev_command_center_status(&self) -> Result<String, String> {
        self.with_state(|state| as_json(serde_json::json!({
            "server": "dev-command-center-mcp",
            "transport": "stdio-only",
            "database_path": state.database_path,
            "safety": {
                "commands": "Only detected scripts and dependency managers are allowed; no shell strings.",
                "background_processes": "Owned only while this live MCP session is connected; the bridge never stops processes it did not start.",
                "cleanup": "Requires a five-minute preview token and confirmed_by_user=true."
            }
        })))
    }

    #[tool(description = "List all projects registered in the local Dev Command Center SQLite registry with real-time running process status.")]
    fn dev_command_center_list_projects(&self) -> Result<String, String> {
        self.with_state(|state| {
            let mut projects = state.storage.list_projects()?;
            crate::storage::mark_unavailable_projects(&mut projects);
            let listening_ports = detect_all_listening_ports();
            let mut cwd_cache: HashMap<u32, Option<String>> = HashMap::new();

            for project in &mut projects {
                if state.processes.processes.contains_key(&project.id) {
                    project.status = ProjectStatus::Running;
                    continue;
                }
                if let Some(port) = project.port {
                    if let Some(listeners) = listening_ports.get(&port) {
                        let canonical = Path::new(&project.canonical_path);
                        for &(pid, _) in listeners {
                            let cwd = cwd_cache.entry(pid).or_insert_with(|| get_process_cwd(pid));
                            if let Some(cwd_str) = cwd {
                                let cwd_path = Path::new(cwd_str);
                                if cwd_path == canonical || cwd_path.starts_with(canonical) || canonical.starts_with(cwd_path) {
                                    project.status = ProjectStatus::Running;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            as_json(projects)
        })
    }

    #[tool(description = "Register an existing local project path. The path is canonicalized, scanned, and stored locally; no project command is executed.")]
    fn dev_command_center_register_project(&self, Parameters(request): Parameters<RegisterRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let requested_path = absolute_input_path(&request.path)?;
            let root = canonical_project_path(&request.path)?;
            let scan = scan_project(&root)?;
            let report = disk::disk_report("pending", &root)?;
            let name = request.name.filter(|name| !name.trim().is_empty()).unwrap_or_else(|| root.file_name().and_then(|value| value.to_str()).unwrap_or("Proyecto sin nombre").to_string());
            let mut project = Project {
                id: Uuid::new_v4().to_string(), name: name.trim().to_string(), path: requested_path.to_string_lossy().to_string(), canonical_path: root.to_string_lossy().to_string(),
                project_type: scan.project_type, kind: scan.kind, frameworks: scan.frameworks, package_manager: scan.package_manager, dev_command: scan.dev_command, build_command: scan.build_command, test_command: scan.test_command,
                local_url: scan.local_url, port: scan.port, status: ProjectStatus::Stopped, last_used_at: None, disk_size_bytes: report.total_bytes,
                tags: request.tags.unwrap_or_default().into_iter().map(|tag| tag.trim().to_string()).filter(|tag| !tag.is_empty()).collect(), created_at: Utc::now().to_rfc3339(), last_error: None,
                is_pinned: false, is_archived: false,
            };
            if is_project_running(&project).is_some() {
                project.status = ProjectStatus::Running;
            }
            state.storage.insert_project(&project)?;
            as_json(project)
        })
    }

    #[tool(description = "Unregister or remove a project from Dev Command Center. Does not delete any files on disk.")]
    fn dev_command_center_unregister_project(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| {
            if let Some(mut managed) = state.processes.processes.remove(&request.project_id) {
                let _ = managed.child.kill();
                let _ = managed.child.wait();
            }
            state.storage.delete_project(&request.project_id)?;
            as_json(serde_json::json!({
                "success": true,
                "project_id": request.project_id,
                "message": "Proyecto desvinculado de Dev Command Center."
            }))
        })
    }

    #[tool(description = "Inspect a registered project, re-detect its stack/scripts from disk, include recent command history, and report any process owned by this MCP session or active on its port.")]
    fn dev_command_center_inspect_project(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let mut process = Self::sync_mcp_process(state, &request.project_id)?;
            let (mut project, _, scan) = Self::project_and_scan(state, &request.project_id)?;
            if process.is_none() {
                if let Some(pid) = is_project_running(&project) {
                    project.status = ProjectStatus::Running;
                    process = Some(ProcessInfo {
                        project_id: project.id.clone(),
                        pid,
                        started_at: project.created_at.clone(),
                        command: project.dev_command.clone().unwrap_or_else(|| {
                            project.port.map(|p| format!("Servidor activo en puerto {p}")).unwrap_or_else(|| "Proceso activo".into())
                        }),
                    });
                }
            } else {
                project.status = ProjectStatus::Running;
            }
            let recent_commands = state.storage.recent_commands(&request.project_id)?;
            let detail = ProjectDetail { project, scan, process, recent_commands };
            as_json(detail)
        })
    }

    #[tool(description = "Re-scan a registered project and persist updated stack, scripts, URL/port and disk-size metadata. Does not execute commands.")]
    fn dev_command_center_refresh_project(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let (mut project, root, scan) = Self::project_and_scan(state, &request.project_id)?;
            let report = disk::disk_report(&project.id, &root)?;
            project.project_type = scan.project_type;
            project.frameworks = scan.frameworks;
            project.package_manager = scan.package_manager;
            project.dev_command = scan.dev_command;
            project.build_command = scan.build_command;
            project.test_command = scan.test_command;
            project.local_url = scan.local_url;
            project.port = scan.port;
            project.disk_size_bytes = report.total_bytes;
            state.storage.refresh_project_metadata(&project)?;
            as_json(project)
        })
    }

    #[tool(description = "Return the exact structured program and argument list that Dev Command Center would use. This only plans; it never executes.")]
    fn dev_command_center_plan_command(&self, Parameters(request): Parameters<CommandRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let (project, _, scan) = Self::project_and_scan(state, &request.project_id)?;
            let command = command_for_action(std::path::Path::new(&project.canonical_path), &scan, &request.action, request.script.as_deref())?;
            as_json(CommandPlan { project: &project, scan: &scan, command: &command, note: "Review this plan before executing. Commands are program plus structured arguments, never a shell string." })
        })
    }

    #[tool(description = "Execute a finite detected action: build, test, lint, format, typecheck, install or script. It waits for completion and returns truncated stdout/stderr. It intentionally refuses dev; use start_dev_process for a session-owned background server.")]
    fn dev_command_center_execute(&self, Parameters(request): Parameters<CommandRequest>) -> Result<String, String> {
        if request.action == "dev" { return Err("dev es un proceso de fondo. Usa dev_command_center_start_dev_process; será propiedad de esta sesión MCP.".into()); }
        self.with_state(|state| {
            let (project, _, scan) = Self::project_and_scan(state, &request.project_id)?;
            if project.status == ProjectStatus::Running { return Err("El proyecto figura en ejecución. Este MCP no lanzará una acción finita concurrente sobre un proceso activo.".into()); }
            let root = std::path::Path::new(&project.canonical_path);
            let command = command_for_action(root, &scan, &request.action, request.script.as_deref())?;
            if !command_available(&command.program, root) { return Err(format!("No se encontró «{}» en PATH ni en el proyecto.", command.program)); }
            let record = CommandRecord { id: Uuid::new_v4().to_string(), project_id: project.id.clone(), action: request.action.clone(), command: command.display.clone(), started_at: Utc::now().to_rfc3339(), ended_at: None, exit_code: None, status: "running".into(), error_message: None };
            state.storage.command_started(&record)?;
            let result = Command::new(&command.program).args(&command.args).env("PATH", enhanced_path()).current_dir(&project.canonical_path).stdin(Stdio::null()).output();
            match result {
                Ok(output) => {
                    let success = output.status.success();
                    let exit_code = output.status.code();
                    let stderr = truncate_output(&String::from_utf8_lossy(&output.stderr));
                    state.storage.command_finished(&record.id, if success { "completed" } else { "error" }, exit_code, if success { None } else { Some(&stderr) })?;
                    state.storage.update_status(&project.id, if success { ProjectStatus::Stopped } else { ProjectStatus::Error }, if success { None } else { Some("La última acción MCP terminó con error.") })?;
                    as_json(ExecuteResult { project_id: project.id, action: request.action, command: command.display, exit_code, success, stdout: truncate_output(&String::from_utf8_lossy(&output.stdout)), stderr })
                }
                Err(error) => {
                    let message = format!("No se pudo ejecutar «{}»: {error}", command.display);
                    let _ = state.storage.command_finished(&record.id, "error", None, Some(&message));
                    let _ = state.storage.update_status(&project.id, ProjectStatus::Error, Some(&message));
                    Err(message)
                }
            }
        })
    }

    #[tool(description = "Start the detected dev/start script as a background child owned only by this live MCP stdio session. It refuses to interfere if the project already reports running.")]
    fn dev_command_center_start_dev_process(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| as_json(Self::start_dev_process(state, CommandRequest { project_id: request.project_id, action: "dev".into(), script: None })?))
    }

    #[tool(description = "Stop only a background process that this exact live MCP session started. It never signals processes owned by the desktop app or another agent.")]
    fn dev_command_center_stop_dev_process(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| { Self::stop_dev_process(state, &request.project_id)?; as_json(serde_json::json!({ "project_id": request.project_id, "status": "stopped" })) })
    }

    #[tool(description = "Return recent stdout/stderr collected from a live dev process owned by this MCP session. Also reconciles a process that has exited.")]
    fn dev_command_center_get_process_logs(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let process = Self::sync_mcp_process(state, &request.project_id)?;
            let logs = state.processes.processes.get(&request.project_id).and_then(|managed| managed.logs.lock().ok().map(|entries| entries.clone())).unwrap_or_default();
            as_json(McpProcessSnapshot { process, logs, lifecycle: "Background processes are owned by the current live MCP session only." })
        })
    }

    #[tool(description = "Analyze current disk use for a registered project. This is read-only and never deletes files.")]
    fn dev_command_center_disk_report(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = state.storage.get_project(&request.project_id)?;
            let report: DiskReport = disk::disk_report(&request.project_id, &trusted_project_root(&project)?)?;
            as_json(report)
        })
    }

    #[tool(description = "Create a five-minute, read-only cleanup preview. It returns exact regenerable paths, bytes, and a confirmation token. Do not call cleanup_apply until the human has reviewed this preview.")]
    fn dev_command_center_cleanup_preview(&self, Parameters(request): Parameters<ProjectIdRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = state.storage.get_project(&request.project_id)?;
            let preview = disk::cleanup_preview(&request.project_id, &trusted_project_root(&project)?)?;
            let token = Uuid::new_v4().to_string();
            state.cleanup_grants.retain(|_, grant| grant.expires_at > Instant::now());
            state.cleanup_grants.insert(token.clone(), CleanupGrant { project_id: request.project_id, preview: preview.clone(), expires_at: Instant::now() + CLEANUP_GRANT_TTL });
            as_json(CleanupPreviewResponse { confirmation_token: token, expires_in_seconds: CLEANUP_GRANT_TTL.as_secs(), preview, instruction: "Ask the user to review the exact paths and bytes. Then call cleanup_apply with this token and confirmed_by_user=true." })
        })
    }

    #[tool(description = "DESTRUCTIVE: delete exactly the regenerable directories from a fresh cleanup preview. Requires a non-expired confirmation token and confirmed_by_user=true after explicit human approval. The token becomes invalid after one use.")]
    fn dev_command_center_cleanup_apply(&self, Parameters(request): Parameters<CleanupApplyRequest>) -> Result<String, String> {
        if !request.confirmed_by_user { return Err("Limpieza bloqueada: confirmed_by_user debe ser true únicamente después de aprobación explícita del usuario.".into()); }
        self.with_state(|state| {
            let grant = state.cleanup_grants.remove(&request.confirmation_token).ok_or_else(|| "Token de confirmación desconocido o ya utilizado. Genera un preview nuevo.".to_string())?;
            if grant.expires_at <= Instant::now() { return Err("El token de confirmación expiró. Genera un preview nuevo.".into()); }
            let project = state.storage.get_project(&grant.project_id)?;
            let root = trusted_project_root(&project)?;
            let current = disk::cleanup_preview(&grant.project_id, &root)?;
            let preview_matches = current.entries.len() == grant.preview.entries.len() && current.entries.iter().zip(&grant.preview.entries).all(|(now, then)| now.target == then.target && now.path == then.path && now.bytes == then.bytes);
            if !preview_matches { return Err("Los directorios o tamaños cambiaron desde el preview. Genera y revisa un preview nuevo antes de eliminar.".into()); }
            let targets = grant.preview.entries.iter().map(|entry| entry.target.clone()).collect::<Vec<_>>();
            let (deleted, released_bytes) = disk::clean_targets(&root, &targets)?;
            let mut refreshed = state.storage.get_project(&grant.project_id)?;
            refreshed.disk_size_bytes = disk::disk_report(&grant.project_id, &root)?.total_bytes;
            state.storage.refresh_project_metadata(&refreshed)?;
            as_json(serde_json::json!({ "project_id": grant.project_id, "deleted": deleted, "released_bytes": released_bytes }))
        })
    }

    #[tool(description = "Open a registered project in Finder, Terminal or a configured IDE. Availability and command validation use the same local settings as the desktop app.")]
    fn dev_command_center_open_tool(&self, Parameters(request): Parameters<OpenToolRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = state.storage.get_project(&request.project_id)?;
            let settings = state.storage.ide_settings()?;
            ide::launch_tool(&settings, &request.tool_id, &trusted_project_root(&project)?)?;
            as_json(serde_json::json!({ "project_id": request.project_id, "tool_id": request.tool_id, "launched": true }))
        })
    }

    #[tool(description = "Check GitHub authentication status, connected username and total repositories.")]
    fn dev_command_center_github_status(&self) -> Result<String, String> {
        self.with_state(|state| {
            let storage_token = state.storage.get_setting("github_token")?;
            let token = crate::github::GitHubService::resolve_token(None, storage_token);
            let status = crate::github::GitHubService::get_account_status(token.as_deref())?;
            as_json(status)
        })
    }

    #[tool(description = "List all repositories from the connected GitHub account and see which ones are already cloned locally.")]
    fn dev_command_center_list_github_repos(&self) -> Result<String, String> {
        self.with_state(|state| {
            let storage_token = state.storage.get_setting("github_token")?;
            let token = crate::github::GitHubService::resolve_token(None, storage_token);
            let local_projects = state.storage.list_projects()?;
            let repos = crate::github::GitHubService::list_repos(token.as_deref(), &local_projects)?;
            as_json(repos)
        })
    }

    #[tool(description = "Clone a repository from GitHub to local disk and automatically register/scan it in Dev Command Center.")]
    fn dev_command_center_clone_github_repo(&self, Parameters(request): Parameters<CloneRepoMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let storage_token = state.storage.get_setting("github_token")?;
            let local_projects = state.storage.list_projects()?;
            let token = crate::github::GitHubService::resolve_token(None, storage_token);
            let project = crate::github::GitHubService::clone_and_register(
                &request.repo_name,
                &request.clone_url,
                request.is_private,
                token.as_deref(),
                request.target_path.as_deref(),
                &local_projects,
            )?;
            state.storage.insert_project(&project)?;
            as_json(project)
        })
    }

    #[tool(description = "Safely offload a project to cloud: verifies git status (no uncommitted changes / unpushed commits), deletes local folder, and unregisters it to free up disk space.")]
    fn dev_command_center_safe_offload_project(&self, Parameters(request): Parameters<SafeOffloadMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = state.storage.get_project(&request.project_id)?;
            if let Some(mut managed) = state.processes.processes.remove(&request.project_id) {
                let _ = managed.child.kill();
                let _ = managed.child.wait();
            }
            let path = Path::new(&project.canonical_path);
            crate::github::GitHubService::safe_offload_project(path, request.force.unwrap_or(false))?;
            state.storage.delete_project(&request.project_id)?;
            as_json(serde_json::json!({
                "success": true,
                "project_id": request.project_id,
                "project_name": project.name,
                "message": "Proyecto archivado y carpeta local liberada de forma segura."
            }))
        })
    }

    #[tool(description = "Get all application settings, including IDE tools, GitHub integration status, and default clone directory.")]
    fn dev_command_center_get_settings(&self) -> Result<String, String> {
        self.with_state(|state| {
            let ide_settings = state.storage.ide_settings().ok();
            let storage_token = state.storage.get_setting("github_token").ok().flatten();
            let token = crate::github::GitHubService::resolve_token(None, storage_token);
            let github_status = crate::github::GitHubService::get_account_status(token.as_deref()).ok();
            let default_clone_dir = state.storage.get_setting("default_clone_dir").ok().flatten()
                .unwrap_or_else(|| {
                    let local_projects = state.storage.list_projects().unwrap_or_default();
                    crate::github::GitHubService::resolve_default_clone_destination("", &local_projects)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| "/workspace".to_string())
                });

            as_json(serde_json::json!({
                "ide_settings": ide_settings,
                "github_status": github_status,
                "default_clone_dir": default_clone_dir
            }))
        })
    }

    #[tool(description = "Save and verify a GitHub Personal Access Token in the local SQLite settings.")]
    fn dev_command_center_set_github_token(&self, Parameters(request): Parameters<SetGitHubTokenMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let token = request.token.trim();
            if token.is_empty() {
                return Err("El token de GitHub no puede estar vacío.".into());
            }
            let status = crate::github::GitHubService::get_account_status(Some(token))?;
            state.storage.set_setting("github_token", token)?;
            as_json(status)
        })
    }

    #[tool(description = "Set the default workspace base directory for cloning GitHub repositories.")]
    fn dev_command_center_set_default_clone_dir(&self, Parameters(request): Parameters<SetDefaultCloneDirMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let trimmed = request.path.trim();
            if trimmed.is_empty() {
                return Err("La ruta no puede estar vacía.".into());
            }
            let p = Path::new(trimmed);
            if !p.exists() {
                std::fs::create_dir_all(p).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
            }
            state.storage.set_setting("default_clone_dir", trimmed)?;
            as_json(serde_json::json!({ "default_clone_dir": trimmed, "updated": true }))
        })
    }

    #[tool(description = "Configure and validate external IDE and terminal launcher commands in Dev Command Center.")]
    fn dev_command_center_save_ide_settings(&self, Parameters(request): Parameters<SaveIdeSettingsMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let tools = request.tools.into_iter().map(|t| crate::domain::IdeConfig {
                id: t.id,
                label: t.label,
                command: t.command,
                available: t.available,
            }).collect();
            let settings = crate::domain::IdeSettings { tools };
            state.storage.save_ide_settings(&settings)?;
            let updated = state.storage.ide_settings()?;
            as_json(updated)
        })
    }

    #[tool(description = "Save or update an environment variable in the Dev Command Center vault, and by default (write_to_disk=true) writes and syncs it immediately to the disk .env file in the project root.")]
    fn dev_command_center_set_env_var(&self, Parameters(request): Parameters<SetEnvVarMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = resolve_project(&state.storage, &request.project_id)?;
            let key = request.key.trim().to_string();
            if !crate::env_vars::is_valid_key(&key) {
                return Err("El nombre debe empezar por una letra o «_» y seguir con letras, números o «_».".into());
            }
            let scope = request.scope.as_deref().unwrap_or(".env").trim().to_string();
            if !crate::env_vars::is_valid_scope(&scope) {
                return Err(format!("«{scope}» no es un nombre de fichero de entorno válido."));
            }

            let existing_vars = state.storage.list_env_vars_for_project(&project.id)?;
            let existing = existing_vars.into_iter().find(|v| v.scope == scope && v.key == key);

            let now = Utc::now().to_rfc3339();
            let comment = request.comment.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());

            let variable = match existing {
                Some(prev) => EnvVar {
                    value: request.value,
                    is_secret: request.is_secret.unwrap_or(prev.is_secret),
                    is_enabled: request.is_enabled.unwrap_or(prev.is_enabled),
                    comment: comment.or(prev.comment),
                    updated_at: now,
                    ..prev
                },
                None => {
                    let is_secret = request.is_secret.unwrap_or_else(|| crate::env_vars::is_secret_key(&key, &request.value));
                    EnvVar {
                        id: Uuid::new_v4().to_string(),
                        project_id: Some(project.id.clone()),
                        scope: scope.clone(),
                        key: key.clone(),
                        value: request.value,
                        is_secret,
                        is_enabled: request.is_enabled.unwrap_or(true),
                        comment,
                        created_at: now.clone(),
                        updated_at: now,
                        origin_project_name: None,
                        origin_project_path: None,
                        orphaned_at: None,
                    }
                }
            };

            state.storage.upsert_env_var(&variable)?;

            let should_write = request.write_to_disk.unwrap_or(true);
            let disk_write = if should_write {
                Some(write_scope_to_disk_with_backup(&state.storage, &state.database_path, &project, &scope)?)
            } else {
                None
            };

            as_json(SetEnvVarMcpResponse {
                variable,
                written_to_disk: disk_write.is_some(),
                disk_write,
            })
        })
    }

    #[tool(description = "Write all environment variables for a given scope (e.g. '.env') from the vault directly to disk in the project root. Automatically backs up any previous file.")]
    fn dev_command_center_write_env_file(&self, Parameters(request): Parameters<WriteEnvFileMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = resolve_project(&state.storage, &request.project_id)?;
            let scope = request.scope.as_deref().unwrap_or(".env").trim();
            let result = write_scope_to_disk_with_backup(&state.storage, &state.database_path, &project, scope)?;
            as_json(result)
        })
    }

    #[tool(description = "List environment variables for a project from the vault and report real-time status of .env files on disk (missing keys, sync state).")]
    fn dev_command_center_list_env_vars(&self, Parameters(request): Parameters<ListEnvVarsMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = resolve_project(&state.storage, &request.project_id)?;
            let vars = state.storage.list_env_vars_for_project(&project.id)?;
            let disk_files = match trusted_project_root(&project) {
                Ok(root) => crate::env_vars::inspect_env_files(&root, &vars),
                Err(_) => Vec::new(),
            };

            let mut unprotected: Vec<&str> = disk_files
                .iter()
                .filter(|file| !file.is_template)
                .flat_map(|file| file.missing_in_vault.iter().map(String::as_str))
                .collect();
            unprotected.sort_unstable();
            unprotected.dedup();
            let unprotected_disk_keys = unprotected.len();

            let reveal = request.reveal_secrets.unwrap_or(false);
            let views: Vec<EnvVarViewMcp> = vars.into_iter().map(|v| {
                let display_val = if v.is_secret && !reveal {
                    mask_env_value(&v.value)
                } else {
                    v.value
                };
                EnvVarViewMcp {
                    id: v.id,
                    scope: v.scope,
                    key: v.key,
                    value: display_val,
                    is_secret: v.is_secret,
                    is_enabled: v.is_enabled,
                    comment: v.comment,
                    created_at: v.created_at,
                    updated_at: v.updated_at,
                }
            }).collect();

            as_json(ListEnvVarsMcpResponse {
                project_id: project.id,
                project_name: project.name,
                project_path: project.path,
                total_vault_vars: views.len(),
                unprotected_disk_keys,
                disk_files,
                vars: views,
            })
        })
    }

    #[tool(description = "Import environment variables from a disk .env file or raw content into the Dev Command Center vault.")]
    fn dev_command_center_import_env_file(&self, Parameters(request): Parameters<ImportEnvFileMcpRequest>) -> Result<String, String> {
        self.with_state(|state| {
            let project = resolve_project(&state.storage, &request.project_id)?;
            let scope = request.scope.as_deref().unwrap_or(".env").trim();
            if !crate::env_vars::is_valid_scope(scope) {
                return Err(format!("«{scope}» no es un nombre de fichero de entorno válido."));
            }
            let content = match request.content {
                Some(c) => c,
                None => {
                    let root = trusted_project_root(&project)?;
                    let path = root.join(scope);
                    std::fs::read_to_string(&path)
                        .map_err(|e| format!("No se pudo leer {}: {e}", path.display()))?
                }
            };
            let parsed = crate::env_vars::parse_env_content(&content);
            if parsed.is_empty() {
                return Err("No se encontró ninguna variable con formato CLAVE=valor en ese contenido.".into());
            }
            let result = state.storage.import_env_vars(&project.id, scope, &parsed)?;
            as_json(result)
        })
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for DevCommandCenterMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions("Use dev_command_center_plan_command before execution. Never call cleanup_apply unless the user explicitly approves the paths from cleanup_preview. This server is local stdio only.")
    }
}

fn database_path_from_environment() -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os("DEV_COMMAND_CENTER_DB") {
        let path = PathBuf::from(value);
        if !path.is_absolute() { return Err("DEV_COMMAND_CENTER_DB debe ser una ruta absoluta.".into()); }
        return Ok(path);
    }
    let base = dirs::data_dir().ok_or_else(|| "No se pudo resolver el directorio de datos local.".to_string())?;
    Ok(base.join("com.devcommandcenter.desktop").join("dev-command-center.sqlite3"))
}

fn absolute_input_path(raw: &str) -> Result<PathBuf, String> {
    let input = Path::new(raw);
    if input.is_absolute() { return Ok(input.to_path_buf()); }
    std::env::current_dir().map(|cwd| cwd.join(input)).map_err(|error| format!("No se pudo resolver la ruta absoluta: {error}"))
}

fn trusted_project_root(project: &Project) -> Result<PathBuf, String> {
    let root = Path::new(&project.canonical_path);
    let canonical = std::fs::canonicalize(root).map_err(|_| format!("La carpeta registrada ya no está disponible: {}", project.path))?;
    if canonical != root { return Err("Operación bloqueada: la ruta canónica del proyecto cambió. Vuelve a registrar la carpeta para continuar.".into()); }
    if !canonical.is_dir() { return Err("Operación bloqueada: la ruta registrada no es una carpeta.".into()); }
    Ok(canonical)
}

fn resolve_project(storage: &Storage, id_or_path: &str) -> Result<Project, String> {
    if let Ok(project) = storage.get_project(id_or_path) {
        return Ok(project);
    }
    if let Ok(projects) = storage.list_projects() {
        if let Some(found) = projects.into_iter().find(|p| {
            p.id == id_or_path
                || p.name.eq_ignore_ascii_case(id_or_path)
                || p.path == id_or_path
                || p.canonical_path == id_or_path
        }) {
            return Ok(found);
        }
    }
    if let Ok(canonical) = std::fs::canonicalize(id_or_path) {
        let canonical_str = canonical.to_string_lossy();
        if let Ok(projects) = storage.list_projects() {
            if let Some(found) = projects.into_iter().find(|p| p.canonical_path == canonical_str) {
                return Ok(found);
            }
        }
    }
    Err(format!(
        "No se encontró ningún proyecto con identificador, nombre o ruta «{id_or_path}»."
    ))
}

fn write_scope_to_disk_with_backup(
    storage: &Storage,
    database_path: &Path,
    project: &Project,
    scope: &str,
) -> Result<WriteEnvFileMcpResult, String> {
    if !crate::env_vars::is_valid_scope(scope) {
        return Err(format!("«{scope}» no es un nombre de fichero de entorno válido."));
    }
    let root = trusted_project_root(project)?;
    let target = root.join(scope);
    if target.parent() != Some(root.as_path()) {
        return Err("Operación bloqueada: el fichero de entorno debe estar en la raíz del proyecto.".into());
    }

    let mut vars: Vec<EnvVar> = storage
        .list_env_vars_for_project(&project.id)?
        .into_iter()
        .filter(|variable| variable.scope == scope)
        .collect();
    if vars.is_empty() {
        return Err(format!("La bóveda no tiene ninguna variable en {scope}."));
    }
    vars.sort_by(|left, right| left.key.to_lowercase().cmp(&right.key.to_lowercase()));

    let backup_path = if target.is_file() {
        let base_data_dir = database_path.parent().unwrap_or(Path::new("."));
        let backup_dir = base_data_dir.join("env-backups").join(&project.id);
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("No se pudo crear el directorio de respaldos: {e}"))?;
        let stamp = Utc::now().format("%Y%m%d-%H%M%S");
        let backup = backup_dir.join(format!("{scope}.{stamp}{}", crate::env_vars::BACKUP_SUFFIX));
        std::fs::copy(&target, &backup)
            .map_err(|e| format!("No se pudo respaldar {}: {e}", target.display()))?;
        Some(backup.to_string_lossy().to_string())
    } else {
        None
    };

    let mut content = format!(
        "# Generado por Dev Command Center desde la bóveda de «{}».\n# {}\n\n",
        project.name,
        Utc::now().to_rfc3339()
    );
    content.push_str(&crate::env_vars::serialize_env_vars(&vars));
    std::fs::write(&target, content)
        .map_err(|e| format!("No se pudo escribir {}: {e}", target.display()))?;

    Ok(WriteEnvFileMcpResult {
        path: target.to_string_lossy().to_string(),
        scope: scope.to_string(),
        written_count: vars.len(),
        backup_path,
    })
}

fn mask_env_value(val: &str) -> String {
    if val.is_empty() {
        String::new()
    } else if val.len() <= 6 {
        "••••••••".to_string()
    } else {
        format!("{}••••{}", &val[..2], &val[val.len() - 2..])
    }
}

fn command_available(program: &str, cwd: &Path) -> bool {
    let candidate = Path::new(program);
    if candidate.is_file() || cwd.join(candidate).is_file() {
        return true;
    }
    if candidate.components().count() > 1 {
        return false;
    }
    let paths = enhanced_path();
    std::env::split_paths(&paths).any(|directory| directory.join(program).is_file())
}

fn detect_all_listening_ports() -> HashMap<u16, Vec<(u32, String)>> {
    let mut map: HashMap<u16, Vec<(u32, String)>> = HashMap::new();
    let Ok(output) = Command::new("lsof").args(["-iTCP", "-sTCP:LISTEN", "-n", "-P", "-F", "pcn"]).output() else {
        return map;
    };
    let Ok(stdout) = String::from_utf8(output.stdout) else {
        return map;
    };
    
    let mut current_pid: Option<u32> = None;
    let mut current_cmd = String::new();

    for line in stdout.lines() {
        if let Some(pid_str) = line.strip_prefix('p') {
            current_pid = pid_str.trim().parse::<u32>().ok();
        } else if let Some(cmd) = line.strip_prefix('c') {
            current_cmd = cmd.trim().to_string();
        } else if let Some(name) = line.strip_prefix('n') {
            if let Some(port_str) = name.rsplit(':').next() {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    if let Some(pid) = current_pid {
                        map.entry(port).or_default().push((pid, current_cmd.clone()));
                    }
                }
            }
        }
    }
    map
}

fn is_project_running(project: &Project) -> Option<u32> {
    let port = project.port?;
    let output = Command::new("lsof").args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"]).output().ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    let canonical = Path::new(&project.canonical_path);
    for line in stdout.lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            if let Some(cwd) = get_process_cwd(pid) {
                let cwd_path = Path::new(&cwd);
                if cwd_path == canonical || cwd_path.starts_with(canonical) || canonical.starts_with(cwd_path) {
                    return Some(pid);
                }
            }
        }
    }
    None
}

fn get_process_cwd(pid: u32) -> Option<String> {
    let output = Command::new("lsof").args(["-p", &pid.to_string(), "-a", "-d", "cwd", "-Fn"]).output().ok()?;
    let stdout = String::from_utf8(output.stdout).ok()?;
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix('n') {
            return Some(path.to_string());
        }
    }
    None
}

fn collect_logs<R: Read + Send + 'static>(project_id: String, stream: &'static str, reader: R, logs: Arc<Mutex<Vec<LogEntry>>>) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Ok(mut entries) = logs.lock() {
                if entries.len() >= LOG_LIMIT { entries.remove(0); }
                entries.push(LogEntry { project_id: project_id.clone(), stream: stream.into(), line, timestamp: Utc::now().to_rfc3339() });
            }
        }
    });
}

fn truncate_output(value: &str) -> String {
    const LIMIT: usize = 16 * 1024;
    if value.len() <= LIMIT { return value.to_string(); }
    format!("{}\n… salida truncada por Dev Command Center MCP ({} bytes omitidos)", &value[..LIMIT], value.len() - LIMIT)
}

fn as_json<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string_pretty(&value).map_err(|error| format!("No se pudo serializar la respuesta MCP: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_large_command_output() {
        let input = "x".repeat(16 * 1024 + 20);
        let result = truncate_output(&input);
        assert!(result.contains("salida truncada"));
        assert!(result.len() > 16 * 1024);
    }

    #[test]
    fn rejects_relative_database_override() {
        let original = std::env::var_os("DEV_COMMAND_CENTER_DB");
        std::env::set_var("DEV_COMMAND_CENTER_DB", "relative.sqlite3");
        assert!(database_path_from_environment().is_err());
        match original { Some(value) => std::env::set_var("DEV_COMMAND_CENTER_DB", value), None => std::env::remove_var("DEV_COMMAND_CENTER_DB") }
    }

    fn test_server(dir: &Path) -> (DevCommandCenterMcp, Project) {
        let db_path = dir.join("test.sqlite3");
        let storage = Storage::open(&db_path).unwrap();
        let proj_dir = dir.join("sample-project");
        std::fs::create_dir_all(&proj_dir).unwrap();
        let canonical_proj = std::fs::canonicalize(&proj_dir).unwrap();
        let canonical_str = canonical_proj.to_string_lossy().to_string();
        let project = Project {
            id: "proj-1".into(),
            name: "Sample App".into(),
            path: canonical_str.clone(),
            canonical_path: canonical_str,
            project_type: "Node.js".into(),
            frameworks: vec![],
            package_manager: Some("pnpm".into()),
            dev_command: Some("pnpm dev".into()),
            build_command: None,
            test_command: None,
            local_url: None,
            port: Some(3000),
            status: ProjectStatus::Stopped,
            last_used_at: None,
            disk_size_bytes: 1024,
            tags: vec![],
            created_at: "2026-01-01T00:00:00Z".into(),
            last_error: None,
            is_pinned: false,
            is_archived: false,
            kind: crate::domain::ProjectKind::Service,
        };
        storage.insert_project(&project).unwrap();
        let server = DevCommandCenterMcp {
            tool_router: DevCommandCenterMcp::tool_router(),
            state: Arc::new(Mutex::new(McpState {
                storage,
                database_path: db_path,
                processes: McpProcessRegistry { processes: HashMap::new() },
                cleanup_grants: HashMap::new(),
            })),
        };
        (server, project)
    }

    #[test]
    fn set_env_var_writes_to_disk_and_masks_secrets() {
        let temp = tempfile::tempdir().unwrap();
        let (server, project) = test_server(temp.path());

        // Set secret variable by name resolution with write_to_disk = true
        let resp = server.dev_command_center_set_env_var(Parameters(SetEnvVarMcpRequest {
            project_id: "Sample App".into(),
            key: "API_SECRET".into(),
            value: "supersecret123".into(),
            scope: None,
            is_secret: None,
            is_enabled: None,
            comment: Some("Test secret".into()),
            write_to_disk: Some(true),
        })).unwrap();

        assert!(resp.contains("\"written_to_disk\": true"));

        // Verify disk file
        let env_path = PathBuf::from(&project.canonical_path).join(".env");
        assert!(env_path.exists());
        let disk_content = std::fs::read_to_string(&env_path).unwrap();
        assert!(disk_content.contains("API_SECRET=supersecret123"));

        // List env vars without reveal
        let list_masked = server.dev_command_center_list_env_vars(Parameters(ListEnvVarsMcpRequest {
            project_id: project.id.clone(),
            reveal_secrets: Some(false),
        })).unwrap();
        assert!(list_masked.contains("••••"));
        assert!(!list_masked.contains("supersecret123"));

        // List env vars with reveal
        let list_revealed = server.dev_command_center_list_env_vars(Parameters(ListEnvVarsMcpRequest {
            project_id: project.id.clone(),
            reveal_secrets: Some(true),
        })).unwrap();
        assert!(list_revealed.contains("supersecret123"));
    }

    #[test]
    fn write_env_file_creates_backup_on_overwrite() {
        let temp = tempfile::tempdir().unwrap();
        let (server, project) = test_server(temp.path());

        // Write manual file to disk first
        let env_path = PathBuf::from(&project.canonical_path).join(".env");
        std::fs::write(&env_path, "PREVIOUS_KEY=prev_val\n").unwrap();

        // Save var to vault without writing to disk
        server.dev_command_center_set_env_var(Parameters(SetEnvVarMcpRequest {
            project_id: project.id.clone(),
            key: "NEW_KEY".into(),
            value: "new_val".into(),
            scope: None,
            is_secret: None,
            is_enabled: None,
            comment: None,
            write_to_disk: Some(false),
        })).unwrap();

        // Call write_env_file
        let write_resp = server.dev_command_center_write_env_file(Parameters(WriteEnvFileMcpRequest {
            project_id: project.id.clone(),
            scope: Some(".env".into()),
        })).unwrap();

        assert!(write_resp.contains("backup_path"));
        assert!(write_resp.contains(".env."));

        // Check new disk content
        let new_content = std::fs::read_to_string(&env_path).unwrap();
        assert!(new_content.contains("NEW_KEY=new_val"));

        // Check backup exists and contains previous content
        let backup_dir = temp.path().join("env-backups").join(&project.id);
        assert!(backup_dir.is_dir());
        let mut entries = std::fs::read_dir(&backup_dir).unwrap();
        let backup_entry = entries.next().unwrap().unwrap();
        let backup_content = std::fs::read_to_string(backup_entry.path()).unwrap();
        assert_eq!(backup_content, "PREVIOUS_KEY=prev_val\n");
    }

    #[test]
    fn import_env_file_from_disk() {
        let temp = tempfile::tempdir().unwrap();
        let (server, project) = test_server(temp.path());

        // Put a .env file on disk
        let env_path = PathBuf::from(&project.canonical_path).join(".env");
        std::fs::write(&env_path, "IMPORTED_KEY=imported_val\n").unwrap();

        // Import by folder path
        let import_resp = server.dev_command_center_import_env_file(Parameters(ImportEnvFileMcpRequest {
            project_id: project.path.clone(),
            scope: None,
            content: None,
        })).unwrap();

        assert!(import_resp.contains("\"added\": 1"));

        // Verify in vault
        let list_resp = server.dev_command_center_list_env_vars(Parameters(ListEnvVarsMcpRequest {
            project_id: project.id.clone(),
            reveal_secrets: Some(true),
        })).unwrap();

        assert!(list_resp.contains("IMPORTED_KEY"));
        assert!(list_resp.contains("imported_val"));
    }
}
