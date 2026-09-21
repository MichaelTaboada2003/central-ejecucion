//! Portapapeles del sistema: lectura y escritura fiable en entornos de escritorio.
use std::process::Command;

/// Copia texto al portapapeles nativo del sistema operativo.
/// Intenta primero `arboard` (rápido, en memoria) y cae a utilidades del sistema
/// (`pbcopy` en macOS, `clip` en Windows, `wl-copy`/`xclip` en Linux) si falla.
#[tauri::command(async)]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if clipboard.set_text(&text).is_ok() {
            return Ok(());
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::Stdio;
        if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            if let Ok(status) = child.wait() {
                if status.success() {
                    return Ok(());
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        use std::process::Stdio;
        if let Ok(mut child) = Command::new("clip").stdin(Stdio::piped()).spawn() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            if let Ok(status) = child.wait() {
                if status.success() {
                    return Ok(());
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::Write;
        use std::process::Stdio;
        for (cmd, args) in [("wl-copy", vec![]), ("xclip", vec!["-selection", "clipboard"])] {
            if let Ok(mut child) = Command::new(cmd).args(&args).stdin(Stdio::piped()).spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(text.as_bytes());
                }
                if let Ok(status) = child.wait() {
                    if status.success() {
                        return Ok(());
                    }
                }
            }
        }
    }

    Err("No se pudo copiar el texto al portapapeles del sistema.".to_string())
}

/// Lee texto del portapapeles nativo del sistema operativo.
#[tauri::command(async)]
pub fn read_from_clipboard() -> Result<String, String> {
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            return Ok(text);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("pbpaste").output() {
            if output.status.success() {
                if let Ok(text) = String::from_utf8(output.stdout) {
                    return Ok(text);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for (cmd, args) in [("wl-paste", vec![]), ("xclip", vec!["-selection", "clipboard", "-o"])] {
            if let Ok(output) = Command::new(cmd).args(&args).output() {
                if output.status.success() {
                    if let Ok(text) = String::from_utf8(output.stdout) {
                        return Ok(text);
                    }
                }
            }
        }
    }

    Err("No se pudo leer del portapapeles del sistema.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_and_reads_text_from_clipboard() {
        let test_text = "DEV_COMMAND_CENTER_TEST_ENV=12345";
        let write_res = copy_to_clipboard(test_text.to_string());
        assert!(write_res.is_ok(), "Failed to copy to clipboard: {:?}", write_res);

        let read_res = read_from_clipboard();
        assert!(read_res.is_ok(), "Failed to read from clipboard: {:?}", read_res);
        assert_eq!(read_res.unwrap(), test_text);
    }
}

