//! Auditoría de dependencias no utilizadas y desinstalación individual.
use crate::domain::{DependencyAuditResult, ProjectScan};
use crate::process::enhanced_path;
use chrono::Utc;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use walkdir::WalkDir;

/// Directorios que se deben ignorar para no escanear artefactos generados,
/// cachés o dependencias instaladas de terceros.
const IGNORED_DIRECTORIES: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "dist-ssr",
    "build",
    "target",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".output",
    ".venv",
    "venv",
    "env",
    ".turbo",
    ".cache",
    "coverage",
    ".docusaurus",
    ".astro",
    "out",
    ".pytest_cache",
    "__pycache__",
    ".idea",
    ".vscode",
];

/// Extensiones de archivos que contienen código fuente o estilos donde se
/// importan dependencias.
const SOURCE_EXTENSIONS: &[&str] = &[
    "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro", "html",
    "css", "scss", "less", "py", "rs",
];

/// Comprueba si una ruta o componente de ruta debe ignorarse durante el escaneo.
fn is_ignored_dir(name: &str) -> bool {
    (name.starts_with('.') && name != ".")
        || IGNORED_DIRECTORIES.contains(&name)
        || name == "vendor"
        || name == "bower_components"
        || name == "tmp"
        || name == "temp"
        || name == "coverage"
}

/// Extrae el nombre raíz de un paquete a partir de un especificador de importación.
/// Ejemplos:
/// - "react" -> "react"
/// - "lodash/debounce" -> "lodash"
/// - "@tauri-apps/api/core" -> "@tauri-apps/api"
/// - "./local/file" -> None
fn extract_package_root(specifier: &str) -> Option<String> {
    let clean = specifier.trim().trim_matches(['\'', '"', '`']);
    if clean.is_empty() || clean.starts_with('.') || clean.starts_with('/') || clean.starts_with('#') {
        return None;
    }
    if clean.starts_with('@') {
        let parts: Vec<&str> = clean.split('/').collect();
        if parts.len() >= 2 {
            return Some(format!("{}/{}", parts[0], parts[1]));
        }
        return Some(parts[0].to_string());
    }
    let parts: Vec<&str> = clean.split('/').collect();
    Some(parts[0].to_string())
}

/// Extrae todos los nombres de paquetes importados o requeridos en un contenido de código.
fn extract_imported_packages(content: &str, is_python: bool, is_rust: bool) -> HashSet<String> {
    let mut imported = HashSet::new();

    if is_python {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("import ") {
                for part in rest.split(',') {
                    let name = part.trim().split_whitespace().next().unwrap_or("");
                    let root = name.split('.').next().unwrap_or("");
                    if !root.is_empty() {
                        imported.insert(root.to_lowercase());
                        imported.insert(root.replace('_', "-").to_lowercase());
                    }
                }
            } else if let Some(rest) = trimmed.strip_prefix("from ") {
                let name = rest.split_whitespace().next().unwrap_or("");
                let root = name.split('.').next().unwrap_or("");
                if !root.is_empty() {
                    imported.insert(root.to_lowercase());
                    imported.insert(root.replace('_', "-").to_lowercase());
                }
            }
        }
        return imported;
    }

    if is_rust {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            if let Some(rest) = trimmed.strip_prefix("use ") {
                let root = rest.trim_start().split("::").next().unwrap_or("");
                let root = root.split_whitespace().next().unwrap_or("");
                if !root.is_empty() && root != "crate" && root != "super" && root != "self" && root != "std" && root != "core" {
                    imported.insert(root.to_lowercase());
                    imported.insert(root.replace('_', "-").to_lowercase());
                }
            } else if let Some(rest) = trimmed.strip_prefix("extern crate ") {
                let root = rest.trim().trim_end_matches(';').trim();
                if !root.is_empty() {
                    imported.insert(root.to_lowercase());
                    imported.insert(root.replace('_', "-").to_lowercase());
                }
            }
        }
        return imported;
    }

    // JavaScript / TypeScript / CSS / HTML
    // Búsqueda de patrones `from '...'`, `import '...'`, `require('...')`, `import('...')`
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
            continue;
        }

        // Búsqueda simple y rápida de comillas dentro de sentencias de importación
        if trimmed.contains("import") || trimmed.contains("require(") || trimmed.contains("export ") {
            let mut iter = trimmed.char_indices().peekable();
            while let Some((i, c)) = iter.next() {
                if c == '\'' || c == '"' || c == '`' {
                    let quote = c;
                    let start = i + 1;
                    let mut end = start;
                    for (j, inner) in iter.by_ref() {
                        if inner == quote {
                            end = j;
                            break;
                        }
                    }
                    if end > start {
                        let candidate = &trimmed[start..end];
                        if let Some(pkg) = extract_package_root(candidate) {
                            imported.insert(pkg.to_lowercase());
                        }
                    }
                }
            }
        }
    }

    imported
}

/// Audita las dependencias del proyecto comparándolas con el código fuente y
/// los archivos de configuración para identificar cuáles no tienen uso aparente.
pub fn audit_dependencies(root: &Path, scan: &ProjectScan) -> Result<DependencyAuditResult, String> {
    if scan.dependencies.is_empty() {
        return Ok(DependencyAuditResult {
            unused: Vec::new(),
            total_scanned_files: 0,
            timestamp: Utc::now().to_rfc3339(),
        });
    }

    let declared_names: HashSet<String> = scan
        .dependencies
        .iter()
        .map(|d| d.name.clone())
        .collect();

    let mut used_names: HashSet<String> = HashSet::new();

    // 1. Proteger herramientas y dependencias declaradas usadas en scripts de package.json
    let package_json_path = root.join("package.json");
    if package_json_path.is_file() {
        if let Ok(content) = fs::read_to_string(&package_json_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                    let scripts_text: String = scripts
                        .values()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ");

                    for dep in &declared_names {
                        // Si el comando o nombre de paquete aparece en los scripts
                        if scripts_text.contains(dep) {
                            used_names.insert(dep.clone());
                            continue;
                        }
                        // Binarios comunes conocidos
                        let dep_base = dep.split('/').last().unwrap_or(dep);
                        if scripts_text.contains(dep_base) {
                            used_names.insert(dep.clone());
                            continue;
                        }
                        if dep == "typescript" && (scripts_text.contains("tsc") || scripts_text.contains("typecheck")) {
                            used_names.insert(dep.clone());
                        }
                        if dep.contains("eslint") && scripts_text.contains("eslint") {
                            used_names.insert(dep.clone());
                        }
                        if dep.contains("prettier") && scripts_text.contains("prettier") {
                            used_names.insert(dep.clone());
                        }
                        if dep.contains("vitest") && scripts_text.contains("vitest") {
                            used_names.insert(dep.clone());
                        }
                        if dep.contains("jest") && scripts_text.contains("jest") {
                            used_names.insert(dep.clone());
                        }
                        if dep.contains("tailwind") && scripts_text.contains("tailwind") {
                            used_names.insert(dep.clone());
                        }
                    }
                }
            }
        }
    }

    // 2. Proteger herramientas declaradas referenciadas por archivos de configuración en la raíz
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let filename = entry.file_name().to_string_lossy().to_lowercase();
            if filename.starts_with("vite.config") {
                used_names.insert("vite".into());
                for dep in &declared_names {
                    if dep.starts_with("@vitejs/") || dep.contains("vite-plugin") {
                        used_names.insert(dep.clone());
                    }
                }
            } else if filename.starts_with("tailwind.config") {
                used_names.insert("tailwindcss".into());
                used_names.insert("postcss".into());
                used_names.insert("autoprefixer".into());
            } else if filename.starts_with("postcss.config") {
                used_names.insert("postcss".into());
                used_names.insert("autoprefixer".into());
            } else if filename.starts_with("eslint.config") || filename.starts_with(".eslintrc") {
                used_names.insert("eslint".into());
            } else if filename.starts_with("tsconfig") {
                used_names.insert("typescript".into());
            } else if filename.starts_with("babel.config") || filename.starts_with(".babelrc") {
                used_names.insert("@babel/core".into());
            }
        }
    }

    // 3. Recorrer archivos de código fuente y extraer importaciones
    let mut scanned_files = 0;

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                !is_ignored_dir(&name)
            } else {
                true
            }
        })
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
        if !SOURCE_EXTENSIONS.contains(&extension) {
            continue;
        }

        // Limitar tamaño para evitar colgarse en archivos gigantes minificados
        if let Ok(metadata) = entry.metadata() {
            if metadata.len() > 2 * 1024 * 1024 {
                continue;
            }
        }

        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };

        scanned_files += 1;
        let is_python = extension == "py";
        let is_rust = extension == "rs";
        let imports = extract_imported_packages(&content, is_python, is_rust);

        for imported in imports {
            if declared_names.contains(&imported) {
                used_names.insert(imported.clone());
            } else {
                // Comprobar si hay paquetes @types/ correspondientes
                let types_name = format!("@types/{imported}");
                if declared_names.contains(&types_name) {
                    used_names.insert(types_name);
                }
                // Comprobar coincidencia con guiones vs guiones bajos (ej: python / rust)
                let dashed = imported.replace('_', "-");
                if declared_names.contains(&dashed) {
                    used_names.insert(dashed);
                }
            }
        }

        // También búsqueda textual directa para patrones raros o dependencias de css/assets:
        // Solo verificamos comillas si el archivo al menos contiene el nombre del paquete como subcadena.
        for dep in &declared_names {
            if !used_names.contains(dep) && content.contains(dep.as_str()) {
                let single = format!("'{dep}'");
                let double = format!("\"{dep}\"");
                let backtick = format!("`{dep}`");
                let slash_single = format!("'{dep}/");
                let slash_double = format!("\"{dep}/");
                if content.contains(&single)
                    || content.contains(&double)
                    || content.contains(&backtick)
                    || content.contains(&slash_single)
                    || content.contains(&slash_double)
                {
                    used_names.insert(dep.clone());
                }
            }
        }

        // Si ya encontramos todas las dependencias declaradas o alcanzamos el límite, terminar
        if used_names.len() == declared_names.len() || scanned_files >= 10_000 {
            break;
        }
    }

    // 4. Si `@types/node` o `@types/react` etc. están presentes y el paquete base está en uso
    for dep in declared_names.iter().filter(|d| d.starts_with("@types/")) {
        let base = dep.trim_start_matches("@types/");
        if base == "node" && (used_names.contains("typescript") || package_json_path.is_file()) {
            used_names.insert(dep.clone());
        } else if used_names.contains(base) {
            used_names.insert(dep.clone());
        }
    }

    // 5. Las dependencias que no están en used_names son las que no tienen uso aparente
    let mut unused: Vec<String> = declared_names
        .difference(&used_names)
        .cloned()
        .collect();
    unused.sort();

    Ok(DependencyAuditResult {
        unused,
        total_scanned_files: scanned_files,
        timestamp: Utc::now().to_rfc3339(),
    })
}

/// Elimina una dependencia del proyecto utilizando el gestor de paquetes correspondiente
/// o modificando directamente el archivo de manifiesto si no hay gestor disponible.
pub fn remove_dependency(root: &Path, scan: &ProjectScan, dependency: &str) -> Result<String, String> {
    let clean_dep = dependency.trim();
    if clean_dep.is_empty() {
        return Err("El nombre de la dependencia no puede estar vacío.".into());
    }

    // Validación de seguridad para evitar inyección en comandos
    if clean_dep.contains(';') || clean_dep.contains('&') || clean_dep.contains('|') || clean_dep.contains('`') || clean_dep.contains('$') || clean_dep.contains('\n') || clean_dep.contains(' ') {
        return Err("El nombre de la dependencia contiene caracteres no válidos.".into());
    }

    let pm = scan.package_manager.as_deref().unwrap_or("").to_lowercase();

    // 1. Proyectos Node.js con gestor de paquetes
    if pm == "pnpm" || pm == "npm" || pm == "yarn" || pm == "bun" {
        let (prog, args) = match pm.as_str() {
            "pnpm" => ("pnpm", vec!["remove", clean_dep]),
            "npm" => ("npm", vec!["uninstall", clean_dep]),
            "yarn" => ("yarn", vec!["remove", clean_dep]),
            "bun" => ("bun", vec!["remove", clean_dep]),
            _ => unreachable!(),
        };

        let mut cmd = Command::new(prog);
        cmd.args(&args)
            .current_dir(root)
            .env("PATH", enhanced_path())
            .stdin(Stdio::null());

        match cmd.output() {
            Ok(output) if output.status.success() => {
                return Ok(format!("Dependencia «{clean_dep}» desinstalada correctamente con {prog}."));
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Si el comando falló, intentar fallback modificando package.json directamente
                if remove_from_package_json(root, clean_dep).is_ok() {
                    return Ok(format!("Dependencia «{clean_dep}» eliminada de package.json."));
                }
                return Err(format!("Error al desinstalar con {prog}: {stderr}\n{stdout}"));
            }
            Err(_) => {
                // Si el ejecutable del gestor no se pudo arrancar, intentar fallback en package.json
                if remove_from_package_json(root, clean_dep).is_ok() {
                    return Ok(format!("Dependencia «{clean_dep}» eliminada de package.json."));
                }
                return Err(format!("No se encontró el ejecutable «{prog}» en el sistema."));
            }
        }
    }

    // 2. Proyectos Rust con cargo
    if pm == "cargo" || root.join("Cargo.toml").is_file() {
        let mut cmd = Command::new("cargo");
        cmd.args(["remove", clean_dep])
            .current_dir(root)
            .env("PATH", enhanced_path())
            .stdin(Stdio::null());

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                return Ok(format!("Dependencia «{clean_dep}» eliminada con cargo remove."));
            }
        }
        // Fallback a editar Cargo.toml si cargo remove falla
        if remove_from_cargo_toml(root, clean_dep).is_ok() {
            return Ok(format!("Dependencia «{clean_dep}» eliminada de Cargo.toml."));
        }
        return Err(format!("No se pudo eliminar «{clean_dep}» con cargo remove."));
    }

    // 3. Proyectos Python
    if pm == "poetry" {
        let mut cmd = Command::new("poetry");
        cmd.args(["remove", clean_dep])
            .current_dir(root)
            .env("PATH", enhanced_path())
            .stdin(Stdio::null());

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                return Ok(format!("Dependencia «{clean_dep}» desinstalada con poetry remove."));
            }
        }
    }

    if pm == "pipenv" {
        let mut cmd = Command::new("pipenv");
        cmd.args(["uninstall", clean_dep])
            .current_dir(root)
            .env("PATH", enhanced_path())
            .stdin(Stdio::null());

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                return Ok(format!("Dependencia «{clean_dep}» desinstalada con pipenv uninstall."));
            }
        }
    }

    // Fallback para requirements.txt
    if root.join("requirements.txt").is_file() {
        if remove_from_requirements_txt(root, clean_dep).is_ok() {
            return Ok(format!("Dependencia «{clean_dep}» eliminada de requirements.txt."));
        }
    }

    // Fallback general para package.json si existe
    if root.join("package.json").is_file() {
        if remove_from_package_json(root, clean_dep).is_ok() {
            return Ok(format!("Dependencia «{clean_dep}» eliminada de package.json."));
        }
    }

    Err(format!("No se encontró un método para desinstalar «{clean_dep}» en este tipo de proyecto."))
}

/// Elimina una clave de dependencias en package.json de forma segura preservando el formato.
fn remove_from_package_json(root: &Path, dep_name: &str) -> Result<(), String> {
    let path = root.join("package.json");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("No se pudo leer package.json: {e}"))?;

    let mut json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Error en JSON de package.json: {e}"))?;

    let mut removed = false;
    for section in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
        if let Some(obj) = json.get_mut(section).and_then(|v| v.as_object_mut()) {
            if obj.remove(dep_name).is_some() {
                removed = true;
            }
        }
    }

    if !removed {
        return Err(format!("«{dep_name}» no se encontró en package.json"));
    }

    let formatted = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Error al serializar package.json: {e}"))?;
    fs::write(&path, format!("{formatted}\n"))
        .map_err(|e| format!("No se pudo guardar package.json: {e}"))?;

    Ok(())
}

/// Elimina una línea de dependencia en requirements.txt.
fn remove_from_requirements_txt(root: &Path, dep_name: &str) -> Result<(), String> {
    let path = root.join("requirements.txt");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("No se pudo leer requirements.txt: {e}"))?;

    let target_clean = dep_name.to_lowercase().replace('_', "-");
    let mut new_lines = Vec::new();
    let mut found = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            new_lines.push(line);
            continue;
        }
        let pkg_part = trimmed.split(['=', '>', '<', '~', '!', ';']).next().unwrap_or("").trim().to_lowercase().replace('_', "-");
        if pkg_part == target_clean {
            found = true;
            // Omitir esta línea
        } else {
            new_lines.push(line);
        }
    }

    if !found {
        return Err(format!("«{dep_name}» no se encontró en requirements.txt"));
    }

    fs::write(&path, new_lines.join("\n") + "\n")
        .map_err(|e| format!("No se pudo guardar requirements.txt: {e}"))?;

    Ok(())
}

/// Elimina una dependencia en Cargo.toml bajo [dependencies] o [dev-dependencies].
fn remove_from_cargo_toml(root: &Path, dep_name: &str) -> Result<(), String> {
    let path = root.join("Cargo.toml");
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("No se pudo leer Cargo.toml: {e}"))?;

    let mut new_lines = Vec::new();
    let mut found = false;
    let target = dep_name.to_lowercase().replace('-', "_");
    let target_dashed = dep_name.to_lowercase().replace('_', "-");

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('[') {
            new_lines.push(line);
            continue;
        }
        let key = trimmed.split('=').next().unwrap_or("").trim().to_lowercase();
        if key == target || key == target_dashed {
            found = true;
        } else {
            new_lines.push(line);
        }
    }

    if !found {
        return Err(format!("«{dep_name}» no se encontró en Cargo.toml"));
    }

    fs::write(&path, new_lines.join("\n") + "\n")
        .map_err(|e| format!("No se pudo guardar Cargo.toml: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::DeclaredDependency;
    use tempfile::tempdir;

    #[test]
    fn extracts_package_roots_correctly() {
        assert_eq!(extract_package_root("react"), Some("react".into()));
        assert_eq!(extract_package_root("lodash/debounce"), Some("lodash".into()));
        assert_eq!(extract_package_root("@tauri-apps/api/core"), Some("@tauri-apps/api".into()));
        assert_eq!(extract_package_root("./local/component"), None);
        assert_eq!(extract_package_root("../utils"), None);
        assert_eq!(extract_package_root("/absolute/path"), None);
    }

    #[test]
    fn audits_used_and_unused_dependencies_in_node_project() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        // package.json con 3 dependencias
        fs::write(
            root.join("package.json"),
            r#"{
                "name": "test-app",
                "scripts": { "build": "vite build" },
                "dependencies": { "react": "^19.0.0", "lodash": "^4.17.21" },
                "devDependencies": { "vite": "^6.0.0" }
            }"#,
        ).expect("write package.json");

        // Archivo fuente que solo importa react
        fs::create_dir_all(root.join("src")).expect("mkdir src");
        fs::write(
            root.join("src/App.tsx"),
            r#"import React from 'react'; export function App() { return <div>Hola</div>; }"#,
        ).expect("write App.tsx");

        let scan = ProjectScan {
            dependencies: vec![
                DeclaredDependency { name: "react".into(), version: Some("19".into()), is_dev: false, source: "package.json".into() },
                DeclaredDependency { name: "lodash".into(), version: Some("4".into()), is_dev: false, source: "package.json".into() },
                DeclaredDependency { name: "vite".into(), version: Some("6".into()), is_dev: true, source: "package.json".into() },
            ],
            package_manager: Some("pnpm".into()),
            ..Default::default()
        };

        let result = audit_dependencies(root, &scan).expect("audit");
        // lodash no se usa. vite se usa en script build. react se usa en App.tsx.
        assert_eq!(result.unused, vec!["lodash"]);
        assert_eq!(result.total_scanned_files, 1);
    }

    #[test]
    fn removes_dependency_from_package_json() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        fs::write(
            root.join("package.json"),
            r#"{
                "name": "test-app",
                "dependencies": { "react": "^19.0.0", "lodash": "^4.17.21" }
            }"#,
        ).expect("write package.json");

        let result = remove_from_package_json(root, "lodash");
        assert!(result.is_ok());

        let updated = fs::read_to_string(root.join("package.json")).expect("read");
        assert!(!updated.contains("lodash"));
        assert!(updated.contains("react"));
    }

    #[test]
    fn removes_dependency_from_requirements_txt() {
        let dir = tempdir().expect("tempdir");
        let root = dir.path();

        fs::write(
            root.join("requirements.txt"),
            "fastapi==0.115.0\nuvicorn>=0.30.0\npydantic>=2.0.0\n",
        ).expect("write requirements.txt");

        let result = remove_from_requirements_txt(root, "uvicorn");
        assert!(result.is_ok());

        let updated = fs::read_to_string(root.join("requirements.txt")).expect("read");
        assert!(!updated.contains("uvicorn"));
        assert!(updated.contains("fastapi"));
        assert!(updated.contains("pydantic"));
    }
}
