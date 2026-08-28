use crate::domain::{CleanupPreview, DiskEntry, DiskReport};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

/// Nombres que siempre se pueden volver a generar. Se comparte con el borrado
/// seguro de proyectos: un fichero ignorado por git que NO esté en esta lista
/// (un `.env`, unas credenciales, una base de datos local) no está en GitHub y
/// no se puede recuperar.
pub const REGENERABLE_NAMES: [&str; 12] = [
    "node_modules", ".venv", "venv", "dist", "build", ".next", ".astro", "target", ".cache",
    ".pytest_cache", "__pycache__", ".turbo",
];

const CLEANABLE_DIRECTORIES: [(&str, &str); 10] = [
    ("node_modules", "Dependencias Node"),
    (".venv", "Entorno virtual Python"),
    ("venv", "Entorno virtual Python"),
    ("dist", "Salida de distribución"),
    ("build", "Salida de build"),
    (".next", "Caché y build de Next.js"),
    (".astro", "Caché de Astro"),
    ("target", "Artefactos de Rust"),
    (".cache", "Caché del proyecto"),
    (".pytest_cache", "Caché de pruebas Python"),
];

pub fn disk_report(project_id: &str, root: &Path) -> Result<DiskReport, String> {
    let entries = cleanable_entries(root)?;
    let cleanable_sum: u64 = entries.iter().map(|entry| entry.bytes).sum();
    let total_bytes = project_total_size(root, &entries, cleanable_sum)?;
    Ok(DiskReport { project_id: project_id.into(), total_bytes, entries })
}

pub fn cleanup_preview(project_id: &str, root: &Path) -> Result<CleanupPreview, String> {
    let entries = cleanable_entries(root)?;
    let total_bytes = entries.iter().map(|entry| entry.bytes).sum();
    Ok(CleanupPreview { project_id: project_id.into(), total_bytes, entries, dry_run: true })
}

pub fn clean_targets(root: &Path, requested_targets: &[String]) -> Result<(Vec<String>, u64), String> {
    if requested_targets.is_empty() {
        return Err("Selecciona al menos un directorio regenerable para limpiar.".into());
    }
    let entries = cleanable_entries(root)?;
    // Se comparan conjuntos, no longitudes: un destino repetido en la petición
    // hacía fallar la limpieza como si fuera un destino desconocido.
    let mut requested: Vec<&String> = requested_targets.iter().collect();
    requested.sort();
    requested.dedup();
    if let Some(unknown) = requested.iter().find(|target| !entries.iter().any(|entry| entry.target == ***target)) {
        return Err(format!(
            "La solicitud contiene un destino que no pertenece a la vista previa segura del proyecto: {unknown}"
        ));
    }
    let selected = entries
        .iter()
        .filter(|entry| requested.iter().any(|target| **target == entry.target))
        .collect::<Vec<_>>();

    let mut deleted = Vec::new();
    let mut released = 0_u64;
    for entry in selected {
        let path = root.join(&entry.target);
        validate_deletion_target(root, &path)?;
        fs::remove_dir_all(&path).map_err(|error| format!("No se pudo eliminar {}: {error}", path.display()))?;
        deleted.push(entry.path.clone());
        released += entry.bytes;
    }
    Ok((deleted, released))
}

fn cleanable_entries(root: &Path) -> Result<Vec<DiskEntry>, String> {
    let mut entries = Vec::new();
    for (target, label) in CLEANABLE_DIRECTORIES {
        let candidate = root.join(target);
        if candidate.exists() {
            validate_deletion_target(root, &candidate)?;
            entries.push(DiskEntry {
                target: target.to_string(),
                label: label.to_string(),
                path: candidate.to_string_lossy().to_string(),
                bytes: directory_size(&candidate)?,
                regenerable: true,
            });
        }
    }
    Ok(entries)
}

fn validate_deletion_target(root: &Path, candidate: &Path) -> Result<(), String> {
    if !candidate.starts_with(root) || candidate == root {
        return Err("Operación bloqueada: la ruta está fuera del proyecto registrado.".into());
    }
    let metadata = fs::symlink_metadata(candidate)
        .map_err(|error| format!("No se pudo inspeccionar {}: {error}", candidate.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Operación bloqueada: {} es un enlace simbólico.", candidate.display()));
    }
    if !metadata.is_dir() {
        return Err(format!("Operación bloqueada: {} no es un directorio.", candidate.display()));
    }
    let canonical_root = fs::canonicalize(root).map_err(|error| format!("No se pudo validar la raíz: {error}"))?;
    let canonical_candidate = fs::canonicalize(candidate).map_err(|error| format!("No se pudo validar la ruta candidata: {error}"))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err("Operación bloqueada: un enlace resolvió fuera de la raíz registrada.".into());
    }
    Ok(())
}

fn project_total_size(root: &Path, cleanable_entries: &[DiskEntry], cleanable_sum: u64) -> Result<u64, String> {
    if !root.exists() { return Ok(0); }
    let cleanable_targets: std::collections::HashSet<&str> = cleanable_entries.iter().map(|e| e.target.as_str()).collect();
    let mut total = cleanable_sum;
    let read_dir = fs::read_dir(root).map_err(|error| format!("No se pudo leer el directorio {}: {error}", root.display()))?;
    for item in read_dir.filter_map(Result::ok) {
        let name = item.file_name();
        let name_str = name.to_string_lossy();
        if cleanable_targets.contains(name_str.as_ref()) {
            continue;
        }
        let path = item.path();
        if path.is_file() {
            if let Ok(meta) = item.metadata() {
                total = total.saturating_add(meta.len());
            }
        } else if path.is_dir() {
            total = total.saturating_add(directory_size(&path)?);
        }
    }
    Ok(total)
}

pub fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() { return Ok(0); }
    let mut bytes = 0_u64;
    for entry in WalkDir::new(path).follow_links(false).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() {
            bytes = bytes.saturating_add(entry.metadata().map_err(|error| format!("No se pudo medir {}: {error}", entry.path().display()))?.len());
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn only_known_regenerable_directories_can_be_cleaned() {
        let directory = tempdir().expect("tempdir");
        let node_modules = directory.path().join("node_modules");
        fs::create_dir(&node_modules).expect("node_modules");
        fs::write(node_modules.join("fixture.txt"), "content").expect("fixture");
        fs::write(directory.path().join(".env"), "SECRET=never-touch").expect("env");
        let preview = cleanup_preview("project", directory.path()).expect("preview");
        assert_eq!(preview.entries.len(), 1);
        assert!(clean_targets(directory.path(), &[".env".into()]).is_err());
        assert!(clean_targets(directory.path(), &["node_modules".into(), "dist".into()]).is_err());
        // Un destino repetido sigue siendo un único borrado válido.
        clean_targets(directory.path(), &["node_modules".into(), "node_modules".into()]).expect("clean node modules");
        assert!(directory.path().join(".env").exists());
        assert!(!directory.path().join("node_modules").exists());
    }
}
