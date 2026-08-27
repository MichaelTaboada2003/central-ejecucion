use crate::domain::{IdeConfig, IdeSettings};
use crate::storage::{command_available, validate_ide_command};
use std::path::Path;
use std::process::Command;

pub fn launch_tool(settings: &IdeSettings, tool_id: &str, project_path: &Path) -> Result<(), String> {
    match tool_id {
        "finder" => launch_finder(project_path),
        "terminal" => launch_terminal(project_path),
        "antigravity" => launch_antigravity(settings, project_path),
        "codex" => launch_codex(settings, project_path),
        _ => launch_ide(settings, tool_id, project_path),
    }
}

fn launch_antigravity(settings: &IdeSettings, project_path: &Path) -> Result<(), String> {
    if let Some(tool) = settings.tools.iter().find(|tool| tool.id == "antigravity") {
        if let Some(command) = &tool.command {
            let trimmed = command.trim();
            if !trimmed.is_empty() && command_available(trimmed) {
                return spawn(trimmed, &[project_path.to_string_lossy().as_ref()], project_path);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if Path::new("/Applications/Antigravity IDE.app").exists() {
            return spawn("open", &["-a", "Antigravity IDE", project_path.to_string_lossy().as_ref()], project_path);
        }
        if Path::new("/Applications/Dev/Antigravity.app").exists() {
            return spawn("open", &["-a", "/Applications/Dev/Antigravity.app", project_path.to_string_lossy().as_ref()], project_path);
        }
        return spawn("open", &["-a", "Antigravity", project_path.to_string_lossy().as_ref()], project_path);
    }
    #[cfg(not(target_os = "macos"))]
    Err("Abrir Antigravity no está configurado para este sistema operativo.".into())
}

fn launch_codex(settings: &IdeSettings, project_path: &Path) -> Result<(), String> {
    if let Some(tool) = settings.tools.iter().find(|tool| tool.id == "codex") {
        if let Some(command) = &tool.command {
            let trimmed = command.trim();
            if !trimmed.is_empty() && (command_available(trimmed) || Path::new(trimmed).is_file()) {
                return spawn(trimmed, &[project_path.to_string_lossy().as_ref()], project_path);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if Path::new("/Applications/Codex.app").exists() {
            return spawn("open", &["-a", "Codex", project_path.to_string_lossy().as_ref()], project_path);
        }
        if Path::new("/opt/homebrew/bin/codex").exists() {
            return spawn("/opt/homebrew/bin/codex", &[project_path.to_string_lossy().as_ref()], project_path);
        }
        if command_available("codex") {
            return spawn("codex", &[project_path.to_string_lossy().as_ref()], project_path);
        }
    }
    launch_ide(settings, "codex", project_path)
}

fn launch_finder(project_path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return spawn("open", &[project_path.to_string_lossy().as_ref()], project_path);
    #[cfg(target_os = "windows")]
    return spawn("explorer", &[project_path.to_string_lossy().as_ref()], project_path);
    #[cfg(target_os = "linux")]
    return spawn("xdg-open", &[project_path.to_string_lossy().as_ref()], project_path);
    #[allow(unreachable_code)]
    Err("Abrir el explorador no está configurado para este sistema operativo.".into())
}

fn launch_terminal(project_path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return spawn("open", &["-a", "Terminal", project_path.to_string_lossy().as_ref()], project_path);
    #[cfg(target_os = "linux")]
    return spawn("x-terminal-emulator", &["--working-directory", project_path.to_string_lossy().as_ref()], project_path);
    #[cfg(target_os = "windows")]
    return spawn("wt", &["-d", project_path.to_string_lossy().as_ref()], project_path);
    #[allow(unreachable_code)]
    Err("Abrir la terminal no está configurado para este sistema operativo.".into())
}

fn launch_ide(settings: &IdeSettings, tool_id: &str, project_path: &Path) -> Result<(), String> {
    let tool: &IdeConfig = settings.tools.iter().find(|tool| tool.id == tool_id)
        .ok_or_else(|| "La herramienta solicitada no existe en Ajustes.".to_string())?;
    let command = tool.command.as_deref().ok_or_else(|| format!("Configura el comando para {} en Ajustes.", tool.label))?;
    validate_ide_command(command)?;
    if !command_available(command) { return Err(format!("No se encontró «{command}» en PATH. Configúralo en Ajustes o instala la herramienta.")); }
    spawn(command, &[project_path.to_string_lossy().as_ref()], project_path)
}

fn spawn(program: &str, args: &[&str], working_directory: &Path) -> Result<(), String> {
    Command::new(program).args(args).current_dir(working_directory).spawn()
        .map(|_| ())
        .map_err(|error| format!("No se pudo abrir la herramienta: {error}"))
}

pub fn open_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("Solo se pueden abrir URLs HTTP(S) locales o explícitamente registradas.".into()); }
    #[cfg(target_os = "macos")]
    return Command::new("open").arg(url).spawn().map(|_| ()).map_err(|error| format!("No se pudo abrir el navegador: {error}"));
    #[cfg(target_os = "linux")]
    return Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|error| format!("No se pudo abrir el navegador: {error}"));
    #[cfg(target_os = "windows")]
    return Command::new("explorer").arg(url).spawn().map(|_| ()).map_err(|error| format!("No se pudo abrir el navegador: {error}"));
    #[allow(unreachable_code)]
    Err("Abrir URLs no está configurado para este sistema operativo.".into())
}
