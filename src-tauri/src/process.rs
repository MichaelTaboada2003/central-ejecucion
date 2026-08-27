use crate::domain::{CommandRecord, CommandSpec, LogEntry, ProcessInfo, Project, ProjectStatus};
use crate::storage::Storage;
use chrono::Utc;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Evento de logs. La carga útil es un lote (`Vec<LogEntry>`): un servidor de
/// desarrollo puede escupir cientos de líneas por segundo y emitir un evento
/// IPC por línea saturaba el hilo del webview y forzaba un render por línea.
pub const LOG_EVENT: &str = "project://log";
pub const STATUS_EVENT: &str = "project://status";

/// Cadencia máxima de emisión de lotes de log.
const LOG_FLUSH_INTERVAL: Duration = Duration::from_millis(120);
/// Tamaño a partir del cual se emite el lote sin esperar al temporizador.
const LOG_BATCH_SIZE: usize = 200;

#[derive(Clone, Default)]
pub struct ProcessManager {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
}

struct ManagedProcess {
    child: Child,
    info: ProcessInfo,
    command_record_id: String,
}

impl ProcessManager {
    pub fn start(
        &self,
        app: AppHandle,
        storage: Arc<Mutex<Storage>>,
        project: Project,
        action: String,
        spec: CommandSpec,
    ) -> Result<ProcessInfo, String> {
        if self.get(&project.id).is_some() {
            return Err("Este proyecto ya tiene un proceso administrado en ejecución.".into());
        }
        let project_dir = Path::new(&project.canonical_path);
        if !command_available(&spec.program, project_dir) {
            return Err(format!("No se encontró «{}» en PATH ni en el proyecto. Instálalo o ajusta tu entorno antes de ejecutar el comando.", spec.program));
        }
        let started_at = Utc::now().to_rfc3339();
        let command_record_id = Uuid::new_v4().to_string();
        let record = CommandRecord {
            id: command_record_id.clone(), project_id: project.id.clone(), action, command: spec.display.clone(), started_at: started_at.clone(), ended_at: None, exit_code: None, status: "running".into(), error_message: None,
        };
        storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.command_started(&record)?;
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
                let _ = storage.lock().ok().and_then(|database| database.command_finished(&command_record_id, "error", None, Some(&message)).ok());
                message
            })?;
        let info = ProcessInfo { project_id: project.id.clone(), pid: child.id(), started_at, command: spec.display };
        if let Some(stdout) = child.stdout.take() { emit_reader(app.clone(), project.id.clone(), "stdout", stdout); }
        if let Some(stderr) = child.stderr.take() { emit_reader(app.clone(), project.id.clone(), "stderr", stderr); }
        self.processes.lock().map_err(|_| "El administrador de procesos está ocupado.".to_string())?.insert(project.id.clone(), ManagedProcess { child, info: info.clone(), command_record_id });
        storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.update_status(&project.id, ProjectStatus::Running, None)?;
        let _ = app.emit(STATUS_EVENT, &info);
        self.monitor(app, storage, project.id);
        Ok(info)
    }

    pub fn stop(&self, app: &AppHandle, storage: &Arc<Mutex<Storage>>, project_id: &str) -> Result<(), String> {
        let (managed, status) = self.stop_managed(project_id)?;
        let code = status.code();
        storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.update_status(project_id, ProjectStatus::Stopped, None)?;
        storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string())?.command_finished(&managed.command_record_id, "stopped", code, None)?;
        let _ = app.emit(STATUS_EVENT, project_id);
        Ok(())
    }

    fn stop_managed(&self, project_id: &str) -> Result<(ManagedProcess, std::process::ExitStatus), String> {
        let mut managed = self.processes.lock().map_err(|_| "El administrador de procesos está ocupado.".to_string())?
            .remove(project_id)
            .ok_or_else(|| "No hay un proceso administrado activo para este proyecto. No se terminarán procesos externos.".to_string())?;
        let _ = managed.child.kill();
        let status = managed.child.wait().map_err(|error| format!("No se pudo esperar el proceso terminado: {error}"))?;
        Ok((managed, status))
    }

    pub fn get(&self, project_id: &str) -> Option<ProcessInfo> {
        self.processes.lock().ok()?.get(project_id).map(|process| process.info.clone())
    }

    fn monitor(&self, app: AppHandle, storage: Arc<Mutex<Storage>>, project_id: String) {
        let registry = self.processes.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(750));
            let completed = {
                let mut processes = match registry.lock() { Ok(value) => value, Err(_) => return };
                let Some(process) = processes.get_mut(&project_id) else { return };
                match process.child.try_wait() {
                    Ok(Some(status)) => processes.remove(&project_id).map(|process| (process, status)),
                    Ok(None) => None,
                    Err(_) => None
                }
            };
            if let Some((process, status)) = completed {
                let success = status.success();
                let code = status.code();
                let database_result = storage.lock().map_err(|_| "El almacenamiento local está ocupado.".to_string()).and_then(|database| {
                    database.update_status(&project_id, if success { ProjectStatus::Stopped } else { ProjectStatus::Error }, if success { None } else { Some("El último proceso terminó con error.") })?;
                    database.command_finished(&process.command_record_id, if success { "completed" } else { "error" }, code, if success { None } else { Some("El proceso terminó con código distinto de cero.") })
                });
                if database_result.is_err() { return; }
                let _ = app.emit(STATUS_EVENT, &project_id);
                return;
            }
        });
    }
}

fn emit_reader<R: Read + Send + 'static>(app: AppHandle, project_id: String, stream: &'static str, reader: R) {
    let (sender, receiver) = mpsc::channel::<LogEntry>();

    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let entry = LogEntry { project_id: project_id.clone(), stream: stream.into(), line, timestamp: Utc::now().to_rfc3339() };
            if sender.send(entry).is_err() {
                return;
            }
        }
    });

    thread::spawn(move || {
        let mut batch: Vec<LogEntry> = Vec::with_capacity(LOG_BATCH_SIZE);
        let mut last_flush = Instant::now();
        loop {
            match receiver.recv_timeout(LOG_FLUSH_INTERVAL) {
                Ok(entry) => {
                    batch.push(entry);
                    if batch.len() >= LOG_BATCH_SIZE || last_flush.elapsed() >= LOG_FLUSH_INTERVAL {
                        let _ = app.emit(LOG_EVENT, &batch);
                        batch.clear();
                        last_flush = Instant::now();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !batch.is_empty() {
                        let _ = app.emit(LOG_EVENT, &batch);
                        batch.clear();
                    }
                    last_flush = Instant::now();
                }
                Err(RecvTimeoutError::Disconnected) => {
                    if !batch.is_empty() {
                        let _ = app.emit(LOG_EVENT, &batch);
                    }
                    return;
                }
            }
        }
    });
}

pub fn enhanced_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let common_paths = [
        format!("{home}/.cargo/bin"),
        format!("{home}/.local/bin"),
        "/opt/homebrew/bin".into(),
        "/opt/homebrew/sbin".into(),
        "/usr/local/bin".into(),
        "/usr/local/sbin".into(),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
        "/sbin".into(),
    ];
    let mut current_paths = std::env::var("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.to_string_lossy().to_string()).collect::<Vec<_>>())
        .unwrap_or_default();
    for cp in common_paths {
        if !current_paths.contains(&cp) && Path::new(&cp).is_dir() {
            current_paths.push(cp);
        }
    }
    current_paths.join(":")
}

fn command_available(program: &str, cwd: &Path) -> bool {
    let candidate = std::path::Path::new(program);
    if candidate.is_file() || cwd.join(candidate).is_file() {
        return true;
    }
    if candidate.components().count() > 1 {
        return false;
    }
    let paths = enhanced_path();
    std::env::split_paths(&paths).any(|dir| dir.join(program).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_only_a_child_owned_by_the_manager() {
        let manager = ProcessManager::default();
        let child = Command::new("/bin/sleep").arg("30").spawn().expect("start fixture child");
        let pid = child.id();
        manager.processes.lock().expect("registry").insert("project-a".into(), ManagedProcess {
            child,
            info: ProcessInfo { project_id: "project-a".into(), pid, started_at: "now".into(), command: "/bin/sleep 30".into() },
            command_record_id: "record-a".into(),
        });
        let (_, status) = manager.stop_managed("project-a").expect("stop owned child");
        assert!(!status.success());
        assert!(manager.get("project-a").is_none());
        assert!(manager.stop_managed("external-project").is_err());
    }
}
