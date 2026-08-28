//! Sondeo de puertos: saber qué proyecto está de verdad en ejecución.
//!
//! El estado guardado en SQLite sobrevive a un cierre abrupto, así que la única
//! fuente fiable es quién escucha el puerto y desde qué directorio.
use crate::domain::{Project, ProjectStatus};
use crate::process::ProcessManager;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Ventana durante la cual se reutiliza el resultado de `lsof` en lugar de
/// volver a lanzar el subproceso. El sondeo de la interfaz ocurre cada 6 s y
/// varias rutas (foco de ventana, eventos de estado, detalle) pueden coincidir
/// en el mismo instante: la caché evita multiplicar procesos externos.
const PROBE_TTL: Duration = Duration::from_millis(2_500);

pub type PortMap = HashMap<u16, Vec<(u32, String)>>;

pub fn detect_all_listening_ports() -> PortMap {
    let mut map: PortMap = HashMap::new();
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

pub(crate) fn port_cache() -> &'static Mutex<Option<(Instant, Arc<PortMap>)>> {
    static CACHE: OnceLock<Mutex<Option<(Instant, Arc<PortMap>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn cwd_cache() -> &'static Mutex<HashMap<u32, (Instant, Option<String>)>> {
    static CACHE: OnceLock<Mutex<HashMap<u32, (Instant, Option<String>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Escaneo de puertos con TTL corto. El bloqueo se mantiene durante la consulta
/// para que dos llamadas simultáneas compartan un único `lsof` en vez de
/// lanzar uno cada una.
pub(crate) fn listening_ports() -> Arc<PortMap> {
    let mut guard = port_cache().lock().unwrap_or_else(|error| error.into_inner());
    if let Some((captured_at, map)) = guard.as_ref() {
        if captured_at.elapsed() < PROBE_TTL {
            return Arc::clone(map);
        }
    }
    let map = Arc::new(detect_all_listening_ports());
    *guard = Some((Instant::now(), Arc::clone(&map)));
    map
}

/// Invalida las cachés de sondeo tras arrancar o detener un proceso, para que
/// el siguiente refresco de la interfaz refleje el cambio de inmediato.
pub(crate) fn invalidate_probe_cache() {
    if let Ok(mut guard) = port_cache().lock() {
        *guard = None;
    }
    if let Ok(mut guard) = cwd_cache().lock() {
        guard.clear();
    }
}

/// Resuelve el directorio de trabajo de varios PID con una sola invocación de
/// `lsof`, en lugar de un subproceso por PID.
pub(crate) fn process_cwds(pids: &[u32]) -> HashMap<u32, String> {
    let mut resolved = HashMap::new();
    if pids.is_empty() {
        return resolved;
    }

    let mut missing = Vec::new();
    {
        let mut cache = cwd_cache().lock().unwrap_or_else(|error| error.into_inner());
        cache.retain(|_, (captured_at, _)| captured_at.elapsed() < PROBE_TTL);
        for pid in pids {
            match cache.get(pid) {
                Some((_, Some(path))) => {
                    resolved.insert(*pid, path.clone());
                }
                Some((_, None)) => {}
                None => missing.push(*pid),
            }
        }
    }

    if missing.is_empty() {
        return resolved;
    }

    let joined = missing.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let queried = Command::new("lsof")
        .args(["-p", &joined, "-a", "-d", "cwd", "-Fpn"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|stdout| {
            let mut found: HashMap<u32, String> = HashMap::new();
            let mut current_pid: Option<u32> = None;
            for line in stdout.lines() {
                if let Some(pid_str) = line.strip_prefix('p') {
                    current_pid = pid_str.trim().parse::<u32>().ok();
                } else if let Some(path) = line.strip_prefix('n') {
                    if let Some(pid) = current_pid {
                        found.entry(pid).or_insert_with(|| path.to_string());
                    }
                }
            }
            found
        })
        .unwrap_or_default();

    let mut cache = cwd_cache().lock().unwrap_or_else(|error| error.into_inner());
    let now = Instant::now();
    for pid in missing {
        let value = queried.get(&pid).cloned();
        if let Some(path) = value.clone() {
            resolved.insert(pid, path);
        }
        cache.insert(pid, (now, value));
    }
    resolved
}

pub(crate) fn paths_overlap(left: &Path, right: &Path) -> bool {
    left == right || left.starts_with(right) || right.starts_with(left)
}

pub fn update_projects_status_batch(
    projects: &mut [Project],
    process_manager: &ProcessManager,
) {
    let mut pending = Vec::new();
    for (index, project) in projects.iter_mut().enumerate() {
        if process_manager.get(&project.id).is_some() {
            project.status = ProjectStatus::Running;
            continue;
        }
        // El estado «en ejecución» guardado en SQLite sobrevive a un cierre
        // abrupto de la app o del servidor. Si aquí no hay proceso administrado,
        // se parte de «detenido» y solo se vuelve a marcar en ejecución cuando el
        // sondeo de puertos confirma un servidor propio del proyecto.
        if matches!(project.status, ProjectStatus::Running | ProjectStatus::Starting) {
            project.status = ProjectStatus::Stopped;
        }
        if project.port.is_some() {
            pending.push(index);
        }
    }
    if pending.is_empty() {
        return;
    }

    let ports_map = listening_ports();
    let mut candidate_pids: Vec<u32> = Vec::new();
    for &index in &pending {
        let Some(port) = projects[index].port else { continue };
        let Some(listeners) = ports_map.get(&port) else { continue };
        for &(pid, _) in listeners {
            if !candidate_pids.contains(&pid) {
                candidate_pids.push(pid);
            }
        }
    }
    if candidate_pids.is_empty() {
        return;
    }

    let cwds = process_cwds(&candidate_pids);
    for index in pending {
        let Some(port) = projects[index].port else { continue };
        let Some(listeners) = ports_map.get(&port) else { continue };
        let canonical = Path::new(&projects[index].canonical_path);
        let is_match = listeners.iter().any(|(pid, _)| {
            cwds.get(pid).is_some_and(|cwd| paths_overlap(Path::new(cwd), canonical))
        });
        if is_match {
            projects[index].status = ProjectStatus::Running;
        }
    }
}

pub(crate) fn is_project_running(project: &Project) -> Option<u32> {
    let port = project.port?;
    let ports_map = listening_ports();
    let listeners = ports_map.get(&port)?;
    let pids = listeners.iter().map(|(pid, _)| *pid).collect::<Vec<_>>();
    let cwds = process_cwds(&pids);
    let canonical = Path::new(&project.canonical_path);
    pids.into_iter()
        .find(|pid| cwds.get(pid).is_some_and(|cwd| paths_overlap(Path::new(cwd), canonical)))
}
