use crate::domain::{CommandSpec, DeclaredDependency, DetectedScript, ProjectScan};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn canonical_project_path(raw: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(raw);
    if !candidate.exists() {
        return Err(format!("La ruta no existe: {raw}"));
    }
    let canonical = fs::canonicalize(candidate)
        .map_err(|error| format!("No se pudo resolver la ruta: {error}"))?;
    if !canonical.is_dir() {
        return Err("La ruta debe apuntar a una carpeta de proyecto.".into());
    }
    Ok(canonical)
}

pub fn scan_project(path: &Path) -> Result<ProjectScan, String> {
    let mut scan = ProjectScan::default();
    let mut types = Vec::new();
    let mut frameworks = BTreeSet::new();
    let mut manifests = Vec::new();
    let mut lockfile = None;

    // Check for monorepo / workspace files
    if path.join("pnpm-workspace.yaml").is_file() {
        manifests.push("pnpm-workspace.yaml".to_string());
        frameworks.insert("pnpm Workspace".to_string());
        frameworks.insert("Monorepo".to_string());
        if scan.package_manager.is_none() { scan.package_manager = Some("pnpm".into()); }
    }
    if path.join("moon.yml").is_file() {
        manifests.push("moon.yml".to_string());
        frameworks.insert("Moonrepo".to_string());
        frameworks.insert("Monorepo".to_string());
        scan.scripts.push(DetectedScript { name: "dev".into(), command: "moon dev".into(), source: "moon.yml".into() });
        scan.scripts.push(DetectedScript { name: "build".into(), command: "moon run :build".into(), source: "moon.yml".into() });
        scan.scripts.push(DetectedScript { name: "test".into(), command: "moon run :test".into(), source: "moon.yml".into() });
        scan.dev_command = Some("moon dev".into());
    }
    if path.join("turbo.json").is_file() {
        manifests.push("turbo.json".to_string());
        frameworks.insert("Turborepo".to_string());
        frameworks.insert("Monorepo".to_string());
    }
    if path.join("nx.json").is_file() {
        manifests.push("nx.json".to_string());
        frameworks.insert("Nx".to_string());
        frameworks.insert("Monorepo".to_string());
    }
    if path.join("render.yaml").is_file() {
        manifests.push("render.yaml".to_string());
    }
    if path.join("vercel.json").is_file() {
        manifests.push("vercel.json".to_string());
    }

    // 1. Root Node.js scan
    let package_path = path.join("package.json");
    if package_path.is_file() {
        if !types.contains(&"Node.js".to_string()) { types.push("Node.js".to_string()); }
        manifests.push("package.json".to_string());
        if let Ok(package_json) = read_json(&package_path) {
            let manager = detect_node_manager(path);
            lockfile = manager.as_ref().and_then(|value| lockfile_name(value)).filter(|name| path.join(name).is_file()).map(str::to_string);
            if scan.package_manager.is_none() { scan.package_manager = manager.clone(); }
            if let Some(scripts) = package_json.get("scripts").and_then(|s| s.as_object()) {
                for (name, _) in scripts {
                    if let Some((sname, cmd)) = command_for_node_script(manager.as_deref(), name) {
                        scan.scripts.push(DetectedScript { name: sname, command: cmd, source: "package.json".into() });
                    }
                }
            }

            if let Some(deps) = package_json.get("dependencies").and_then(|value| value.as_object()) {
                for (name, val) in deps {
                    scan.dependencies.push(DeclaredDependency {
                        name: name.clone(),
                        version: val.as_str().map(str::to_string),
                        is_dev: false,
                        source: "package.json".into(),
                    });
                }
            }
            if let Some(dev_deps) = package_json.get("devDependencies").and_then(|value| value.as_object()) {
                for (name, val) in dev_deps {
                    scan.dependencies.push(DeclaredDependency {
                        name: name.clone(),
                        version: val.as_str().map(str::to_string),
                        is_dev: true,
                        source: "package.json".into(),
                    });
                }
            }

            let dependency_names = package_json
                .get("dependencies")
                .and_then(|value| value.as_object())
                .into_iter()
                .flat_map(|value| value.keys())
                .chain(
                    package_json
                        .get("devDependencies")
                        .and_then(|value| value.as_object())
                        .into_iter()
                        .flat_map(|value| value.keys()),
                )
                .cloned()
                .collect::<Vec<_>>();
            add_node_frameworks(&dependency_names, &mut frameworks);
            if scan.dev_command.is_none() { scan.dev_command = script_command(&scan.scripts, &["dev", "web", "start", "serve"]); }
            if scan.build_command.is_none() { scan.build_command = script_command(&scan.scripts, &["build"]); }
            if scan.test_command.is_none() { scan.test_command = script_command(&scan.scripts, &["test"]); }
            let scripts_text = package_json
                .get("scripts")
                .and_then(|value| value.as_object())
                .map(|scripts| scripts.values().filter_map(|value| value.as_str()).collect::<Vec<_>>().join(" "))
                .unwrap_or_default();
            if scan.port.is_none() { scan.port = detect_port(&scripts_text); }
        }
    }

    // 2. Root Python scan
    let pyproject = path.join("pyproject.toml");
    let requirements = path.join("requirements.txt");
    let poetry_lock = path.join("poetry.lock");
    let uv_lock = path.join("uv.lock");
    if pyproject.is_file() || requirements.is_file() || path.join("manage.py").is_file() {
        if !types.contains(&"Python".to_string()) { types.push("Python".to_string()); }
        if pyproject.is_file() {
            manifests.push("pyproject.toml".to_string());
            if let Ok(content) = fs::read_to_string(&pyproject) {
                parse_pyproject_dependencies(&content, &mut scan.dependencies, "pyproject.toml");
            }
        }
        if requirements.is_file() {
            manifests.push("requirements.txt".to_string());
            if let Ok(req_content) = fs::read_to_string(&requirements) {
                for line in req_content.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with('#') {
                        let (name, ver) = parse_python_requirement(trimmed);
                        scan.dependencies.push(DeclaredDependency {
                            name,
                            version: ver,
                            is_dev: false,
                            source: "requirements.txt".into(),
                        });
                    }
                }
            }
        }
        let python_text = [pyproject.as_path(), requirements.as_path()]
            .iter()
            .filter(|file| file.is_file())
            .filter_map(|file| fs::read_to_string(file).ok())
            .collect::<Vec<_>>()
            .join("\n")
            .to_lowercase();
        for (needle, framework) in [("streamlit", "Streamlit"), ("fastapi", "FastAPI"), ("django", "Django"), ("flask", "Flask")]
        {
            if python_text.contains(needle) { frameworks.insert(framework.to_string()); }
        }
        if uv_lock.is_file() {
            if scan.package_manager.is_none() { scan.package_manager = Some("uv".into()); }
            if lockfile.is_none() { lockfile = Some("uv.lock".into()); }
        } else if poetry_lock.is_file() {
            if scan.package_manager.is_none() { scan.package_manager = Some("poetry".into()); }
            if lockfile.is_none() { lockfile = Some("poetry.lock".into()); }
        } else if requirements.is_file() && scan.package_manager.is_none() {
            scan.package_manager = Some("pip".into());
        }

        if path.join("manage.py").is_file() {
            frameworks.insert("Django".into());
            scan.scripts.push(DetectedScript { name: "dev".into(), command: "python manage.py runserver".into(), source: "manage.py".into() });
            scan.scripts.push(DetectedScript { name: "test".into(), command: "python manage.py test".into(), source: "manage.py".into() });
            scan.scripts.push(DetectedScript { name: "migrate".into(), command: "python manage.py migrate".into(), source: "manage.py".into() });
            if scan.dev_command.is_none() { scan.dev_command = Some("python manage.py runserver".into()); }
            if scan.test_command.is_none() { scan.test_command = Some("python manage.py test".into()); }
            if scan.port.is_none() { scan.port = Some(8000); }
        } else if frameworks.contains("Streamlit") {
            let target = if path.join("app.py").is_file() { "app.py" } else { "main.py" };
            scan.scripts.push(DetectedScript { name: "dev".into(), command: format!("streamlit run {target}"), source: "Streamlit".into() });
            if scan.dev_command.is_none() { scan.dev_command = Some(format!("streamlit run {target}")); }
            if scan.port.is_none() { scan.port = Some(8501); }
        } else if frameworks.contains("FastAPI") {
            scan.scripts.push(DetectedScript { name: "dev".into(), command: "uvicorn app:app --reload".into(), source: "FastAPI".into() });
            if scan.dev_command.is_none() { scan.dev_command = Some("uvicorn app:app --reload".into()); }
            if scan.port.is_none() { scan.port = Some(8000); }
        } else if frameworks.contains("Flask") {
            scan.scripts.push(DetectedScript { name: "dev".into(), command: "flask run".into(), source: "Flask".into() });
            if scan.dev_command.is_none() { scan.dev_command = Some("flask run".into()); }
            if scan.port.is_none() { scan.port = Some(5000); }
        }
    }

    // 3. Root Rust scan
    if path.join("Cargo.toml").is_file() {
        if !types.contains(&"Rust".to_string()) { types.push("Rust".to_string()); }
        manifests.push("Cargo.toml".to_string());
        if path.join("Cargo.lock").is_file() && lockfile.is_none() { lockfile = Some("Cargo.lock".into()); }
        frameworks.insert("Rust".to_string());
        if let Ok(cargo_text) = fs::read_to_string(path.join("Cargo.toml")) {
            parse_cargo_dependencies(&cargo_text, &mut scan.dependencies, "Cargo.toml");
        }
    }

    // 4. Root Docker scan
    if path.join("Dockerfile").is_file() {
        manifests.push("Dockerfile".to_string());
        frameworks.insert("Docker".to_string());
    }
    if path.join("docker-compose.yml").is_file() || path.join("compose.yml").is_file() || path.join("docker-compose.yaml").is_file() {
        let dc_name = if path.join("docker-compose.yml").is_file() {
            "docker-compose.yml"
        } else if path.join("docker-compose.yaml").is_file() {
            "docker-compose.yaml"
        } else {
            "compose.yml"
        };
        manifests.push(dc_name.into());
        frameworks.insert("Docker Compose".to_string());
    }

    // 5. Root PHP scan
    if path.join("composer.json").is_file() {
        if !types.contains(&"PHP".to_string()) { types.push("PHP".to_string()); }
        manifests.push("composer.json".to_string());
        if path.join("artisan").is_file() { frameworks.insert("Laravel".to_string()); }
    }

    // 6. Subproject & Workspace discovery (apps/*, packages/*, services/*, frontend/, backend/, etc.)
    let subprojects = discover_subprojects(path);
    for (rel_dir, sub_path) in &subprojects {
        let sub_pkg = sub_path.join("package.json");
        if sub_pkg.is_file() {
            if !types.contains(&"Node.js".to_string()) { types.push("Node.js".to_string()); }
            let manifest_label = format!("{rel_dir}/package.json");
            if !manifests.contains(&manifest_label) { manifests.push(manifest_label.clone()); }
            if let Ok(package_json) = read_json(&sub_pkg) {
                if let Some(deps) = package_json.get("dependencies").and_then(|value| value.as_object()) {
                    for (name, val) in deps {
                        scan.dependencies.push(DeclaredDependency {
                            name: name.clone(),
                            version: val.as_str().map(str::to_string),
                            is_dev: false,
                            source: manifest_label.clone(),
                        });
                    }
                }
                if let Some(dev_deps) = package_json.get("devDependencies").and_then(|value| value.as_object()) {
                    for (name, val) in dev_deps {
                        scan.dependencies.push(DeclaredDependency {
                            name: name.clone(),
                            version: val.as_str().map(str::to_string),
                            is_dev: true,
                            source: manifest_label.clone(),
                        });
                    }
                }
                let dep_names = package_json
                    .get("dependencies")
                    .and_then(|v| v.as_object())
                    .into_iter()
                    .flat_map(|v| v.keys())
                    .chain(
                        package_json
                            .get("devDependencies")
                            .and_then(|v| v.as_object())
                            .into_iter()
                            .flat_map(|v| v.keys()),
                    )
                    .cloned()
                    .collect::<Vec<_>>();
                add_node_frameworks(&dep_names, &mut frameworks);
                if sub_path.join("nuxt.config.ts").is_file() || sub_path.join("nuxt.config.js").is_file() {
                    frameworks.insert("Nuxt".to_string());
                }
            }
        }

        let sub_pyproject = sub_path.join("pyproject.toml");
        if sub_pyproject.is_file() {
            if !types.contains(&"Python".to_string()) { types.push("Python".to_string()); }
            let manifest_label = format!("{rel_dir}/pyproject.toml");
            if !manifests.contains(&manifest_label) { manifests.push(manifest_label.clone()); }
            if let Ok(content) = fs::read_to_string(&sub_pyproject) {
                parse_pyproject_dependencies(&content, &mut scan.dependencies, &manifest_label);
                let content_lower = content.to_lowercase();
                for (needle, framework) in [("streamlit", "Streamlit"), ("fastapi", "FastAPI"), ("django", "Django"), ("flask", "Flask")] {
                    if content_lower.contains(needle) { frameworks.insert(framework.to_string()); }
                }
            }
        }

        let sub_req = sub_path.join("requirements.txt");
        if sub_req.is_file() {
            if !types.contains(&"Python".to_string()) { types.push("Python".to_string()); }
            let manifest_label = format!("{rel_dir}/requirements.txt");
            if !manifests.contains(&manifest_label) { manifests.push(manifest_label.clone()); }
            if let Ok(req_content) = fs::read_to_string(&sub_req) {
                for line in req_content.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with('#') {
                        let (name, ver) = parse_python_requirement(trimmed);
                        scan.dependencies.push(DeclaredDependency {
                            name,
                            version: ver,
                            is_dev: false,
                            source: manifest_label.clone(),
                        });
                    }
                }
            }
        }

        let sub_cargo = sub_path.join("Cargo.toml");
        if sub_cargo.is_file() {
            if !types.contains(&"Rust".to_string()) { types.push("Rust".to_string()); }
            let manifest_label = format!("{rel_dir}/Cargo.toml");
            if !manifests.contains(&manifest_label) { manifests.push(manifest_label.clone()); }
            if let Ok(cargo_text) = fs::read_to_string(&sub_cargo) {
                parse_cargo_dependencies(&cargo_text, &mut scan.dependencies, &manifest_label);
            }
        }
    }

    // Deduplicate and sort dependencies
    scan.dependencies.sort_by(|left, right| {
        if left.is_dev == right.is_dev {
            left.name.to_lowercase().cmp(&right.name.to_lowercase())
        } else if !left.is_dev {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    scan.dependencies.dedup_by(|a, b| a.name == b.name && a.source == b.source && a.is_dev == b.is_dev);

    scan.scripts.sort_by(|left, right| left.name.cmp(&right.name));
    scan.scripts.dedup_by(|a, b| a.name == b.name && a.command == b.command);

    scan.declared_dependencies = scan.dependencies.len();

    // Verify installed dependencies
    let has_node = types.iter().any(|t| t == "Node.js");
    let has_python = types.iter().any(|t| t == "Python");
    let has_php = types.iter().any(|t| t == "PHP");
    let has_rust = types.iter().any(|t| t == "Rust");

    scan.installed_dependencies = if scan.declared_dependencies == 0 {
        true
    } else {
        let mut node_ok = !has_node;
        if has_node {
            if path.join("node_modules").is_dir() {
                node_ok = true;
            } else {
                for (_, sub) in &subprojects {
                    if sub.join("node_modules").is_dir() {
                        node_ok = true;
                        break;
                    }
                }
            }
        }

        let mut python_ok = !has_python;
        if has_python {
            if path.join(".venv").is_dir()
                || path.join(".venv312").is_dir()
                || path.join(".venv311").is_dir()
                || path.join(".venv310").is_dir()
                || path.join("venv").is_dir()
                || path.join("env").is_dir()
                || find_python_executable(path) != "python3"
            {
                python_ok = true;
            } else {
                for (_, sub) in &subprojects {
                    if sub.join(".venv").is_dir()
                        || sub.join(".venv312").is_dir()
                        || sub.join(".venv311").is_dir()
                        || sub.join(".venv310").is_dir()
                        || sub.join("venv").is_dir()
                        || sub.join("env").is_dir()
                        || find_python_executable(sub) != "python3"
                    {
                        python_ok = true;
                        break;
                    }
                }
            }
        }

        let mut php_ok = !has_php;
        if has_php {
            if path.join("vendor").is_dir() {
                php_ok = true;
            } else {
                for (_, sub) in &subprojects {
                    if sub.join("vendor").is_dir() {
                        php_ok = true;
                        break;
                    }
                }
            }
        }

        let mut rust_ok = !has_rust;
        if has_rust {
            rust_ok = path.join("Cargo.lock").is_file() || path.join("target").is_dir();
        }

        node_ok && python_ok && php_ok && rust_ok
    };

    scan.project_type = if types.is_empty() { "Desconocido".into() } else { types.join(" + ") };
    scan.frameworks = frameworks.into_iter().collect();
    scan.manifests = manifests;
    scan.lockfile = lockfile;

    if scan.port.is_none() {
        if scan.frameworks.iter().any(|f| f == "Next.js" || f == "Nuxt" || f == "Remix") {
            scan.port = Some(3000);
        } else if scan.frameworks.iter().any(|f| f == "Vite" || f == "Svelte" || f == "SvelteKit") {
            scan.port = Some(5173);
        } else if scan.frameworks.iter().any(|f| f == "Astro") {
            scan.port = Some(4321);
        } else if scan.frameworks.iter().any(|f| f == "Expo" || f == "React Native") {
            scan.port = Some(8081);
        } else if scan.frameworks.iter().any(|f| f == "Angular") {
            scan.port = Some(4200);
        } else if scan.frameworks.iter().any(|f| f == "Streamlit") {
            scan.port = Some(8501);
        } else if scan.frameworks.iter().any(|f| f == "Django" || f == "FastAPI" || f == "Uvicorn") {
            scan.port = Some(8000);
        } else if scan.frameworks.iter().any(|f| f == "Flask") {
            scan.port = Some(5000);
        }
    }

    if let Some(port) = scan.port { scan.local_url = Some(format!("http://localhost:{port}")); }
    Ok(scan)
}

pub fn is_port_in_use(port: u16) -> bool {
    use std::net::{SocketAddr, TcpListener};
    if TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).is_err() {
        return true;
    }
    if TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).is_err() {
        return true;
    }
    false
}

pub fn find_next_available_port(start_port: u16) -> u16 {
    for candidate in start_port..(start_port.saturating_add(100)) {
        if !is_port_in_use(candidate) {
            return candidate;
        }
    }
    start_port
}

pub fn adapt_command_for_available_port(mut spec: CommandSpec, port: u16) -> CommandSpec {
    let port_str = port.to_string();
    spec.env.insert("PORT".into(), port_str.clone());
    spec.env.insert("VITE_PORT".into(), port_str.clone());
    spec.env.insert("NEXT_PUBLIC_PORT".into(), port_str.clone());

    if spec.program == "npm" {
        spec.args.push("--".into());
        spec.args.push("--port".into());
        spec.args.push(port_str.clone());
    } else if spec.program == "pnpm" || spec.program == "yarn" || spec.program == "bun" {
        spec.args.push("--port".into());
        spec.args.push(port_str.clone());
    } else if spec.program == "streamlit" || spec.args.iter().any(|arg| arg == "streamlit") {
        spec.args.push("--server.port".into());
        spec.args.push(port_str.clone());
        spec.env.insert("STREAMLIT_SERVER_PORT".into(), port_str.clone());
    } else if spec.args.iter().any(|arg| arg == "uvicorn") {
        spec.args.push("--port".into());
        spec.args.push(port_str.clone());
    } else if spec.args.iter().any(|arg| arg == "runserver") {
        spec.args.push(port_str.clone());
    } else if spec.program == "flask" {
        spec.args.push("--port".into());
        spec.args.push(port_str.clone());
    }

    spec.display = std::iter::once(spec.program.clone()).chain(spec.args.iter().cloned()).collect::<Vec<_>>().join(" ");
    spec
}

pub fn find_python_executable(path: &Path) -> String {
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if (name.starts_with(".venv") || name.starts_with("venv") || name == "env") && entry.path().join("bin/python").is_file() {
                        let py_bin = entry.path().join("bin/python");
                        let site_packages_count = entry.path().join("lib")
                            .read_dir()
                            .ok()
                            .into_iter()
                            .flat_map(|dirs| dirs.flatten())
                            .filter_map(|py_dir| py_dir.path().join("site-packages").read_dir().ok())
                            .flat_map(|sp| sp.flatten())
                            .count();
                        candidates.push((site_packages_count, py_bin.to_string_lossy().to_string()));
                    }
                }
            }
        }
    }
    if let Some((_, best_bin)) = candidates.into_iter().max_by_key(|(count, _)| *count) {
        return best_bin;
    }
    "python3".into()
}

fn python_script_to_spec(root: &Path, scan: &ProjectScan, script_name: &str) -> Result<CommandSpec, String> {
    let py_bin = find_python_executable(root);
    let is_uv = scan.package_manager.as_deref() == Some("uv") && py_bin == "python3";
    let mut command_spec = match script_name {
        "dev" => {
            if scan.frameworks.iter().any(|f| f == "Django") {
                if is_uv {
                    spec("uv", &["run", "python", "manage.py", "runserver"])
                } else {
                    spec(&py_bin, &["manage.py", "runserver"])
                }
            } else if scan.frameworks.iter().any(|f| f == "Streamlit") {
                let target = if root.join("app.py").is_file() { "app.py" } else { "main.py" };
                let mut s = if is_uv {
                    spec("uv", &["run", "streamlit", "run", target, "--server.headless=true", "--browser.gatherUsageStats=false"])
                } else {
                    spec(&py_bin, &["-m", "streamlit", "run", target, "--server.headless=true", "--browser.gatherUsageStats=false"])
                };
                s.env.insert("STREAMLIT_SERVER_HEADLESS".into(), "true".into());
                s.env.insert("STREAMLIT_BROWSER_GATHER_USAGE_STATS".into(), "false".into());
                s
            } else if scan.frameworks.iter().any(|f| f == "FastAPI") {
                if is_uv {
                    spec("uv", &["run", "uvicorn", "app:app", "--reload"])
                } else {
                    spec(&py_bin, &["-m", "uvicorn", "app:app", "--reload"])
                }
            } else if scan.frameworks.iter().any(|f| f == "Flask") {
                if is_uv {
                    spec("uv", &["run", "flask", "run"])
                } else {
                    spec(&py_bin, &["-m", "flask", "run"])
                }
            } else {
                spec(&py_bin, &["main.py"])
            }
        }
        "test" => {
            if scan.frameworks.iter().any(|f| f == "Django") {
                if is_uv {
                    spec("uv", &["run", "python", "manage.py", "test"])
                } else {
                    spec(&py_bin, &["manage.py", "test"])
                }
            } else if is_uv {
                spec("uv", &["run", "pytest"])
            } else {
                spec(&py_bin, &["-m", "pytest"])
            }
        }
        "migrate" => {
            if is_uv {
                spec("uv", &["run", "python", "manage.py", "migrate"])
            } else {
                spec(&py_bin, &["manage.py", "migrate"])
            }
        }
        _ => {
            if is_uv {
                spec("uv", &["run", "python", script_name])
            } else {
                spec(&py_bin, &[script_name])
            }
        }
    };
    command_spec.env.insert("PYTHONUNBUFFERED".into(), "1".into());
    Ok(command_spec)
}

/// Puerto que realmente debe usar un servidor de desarrollo: el declarado, o el
/// siguiente libre si el declarado ya está ocupado. Se resuelve una sola vez por
/// arranque para que el comando lanzado y el puerto persistido no discrepen.
pub fn resolve_dev_port(scan: &ProjectScan) -> Option<u16> {
    let port = scan.port?;
    if is_port_in_use(port) {
        Some(find_next_available_port(port))
    } else {
        Some(port)
    }
}

pub fn command_for_action(root: &Path, scan: &ProjectScan, action: &str, requested_script: Option<&str>) -> Result<CommandSpec, String> {
    command_for_action_on_port(root, scan, action, requested_script, None)
}

/// Igual que `command_for_action`, pero con el puerto ya resuelto por quien
/// llama. Evita que el puerto se calcule dos veces (una para el registro y otra
/// para el comando) y termine aplicándose en ninguna de las dos.
pub fn command_for_action_on_port(
    root: &Path,
    scan: &ProjectScan,
    action: &str,
    requested_script: Option<&str>,
    desired_port: Option<u16>,
) -> Result<CommandSpec, String> {
    if action == "install" {
        return install_command(root, scan);
    }
    let script = match action {
        "dev" => ["dev", "web", "start", "serve"].iter().find_map(|candidate| scan.scripts.iter().find(|script| script.name == *candidate)),
        "build" | "test" | "lint" | "format" | "typecheck" => scan.scripts.iter().find(|script| script.name == action),
        "script" => requested_script.and_then(|name| scan.scripts.iter().find(|script| script.name == name)),
        _ => return Err("Acción no admitida. Solo se ejecutan scripts detectados o instalaciones del gestor detectado.".into()),
    }
    .ok_or_else(|| format!("No se detectó un script ejecutable para «{action}»."))?;
    
    let base_spec = if script.source == "moon.yml" || script.command.starts_with("moon ") {
        let parts: Vec<&str> = script.command.split_whitespace().collect();
        if parts.is_empty() {
            spec("moon", &[&script.name])
        } else {
            spec(parts[0], &parts[1..])
        }
    } else if scan.package_manager.as_deref() == Some("pnpm")
        || scan.package_manager.as_deref() == Some("npm")
        || scan.package_manager.as_deref() == Some("yarn")
        || scan.package_manager.as_deref() == Some("bun")
    {
        script_to_spec(scan.package_manager.as_deref(), &script.name)?
    } else {
        python_script_to_spec(root, scan, &script.name)?
    };

    if action == "dev" {
        let target = desired_port.or_else(|| resolve_dev_port(scan));
        if let Some(port) = target {
            if Some(port) != scan.port {
                return Ok(adapt_command_for_available_port(base_spec, port));
            }
        }
    }
    Ok(base_spec)
}

fn install_command(root: &Path, scan: &ProjectScan) -> Result<CommandSpec, String> {
    match scan.package_manager.as_deref() {
        Some("pnpm") => Ok(spec("pnpm", &["install"])),
        Some("npm") => Ok(spec("npm", &["install"])),
        Some("yarn") => Ok(spec("yarn", &["install"])),
        Some("bun") => Ok(spec("bun", &["install"])),
        Some("uv") => Ok(spec("uv", &["sync"])),
        Some("poetry") => Ok(spec("poetry", &["install"])),
        // Instalar con el `python3` del sistema deja las dependencias fuera del
        // entorno virtual del proyecto (y en macOS falla por
        // «externally-managed-environment»): se usa el intérprete detectado.
        Some("pip") => Ok(spec(&find_python_executable(root), &["-m", "pip", "install", "-r", "requirements.txt"])),
        _ => Err("No se detectó un gestor de dependencias con un comando de instalación seguro.".into()),
    }
}

fn script_to_spec(manager: Option<&str>, script: &str) -> Result<CommandSpec, String> {
    match manager {
        Some("pnpm") => Ok(spec("pnpm", &["run", script])),
        Some("npm") => Ok(spec("npm", &["run", script])),
        Some("yarn") => Ok(spec("yarn", &[script])),
        Some("bun") => Ok(spec("bun", &["run", script])),
        _ => Err("El proyecto no tiene un gestor Node compatible para ejecutar este script.".into()),
    }
}

fn spec(program: &str, args: &[&str]) -> CommandSpec {
    let args = args.iter().map(|value| (*value).to_string()).collect::<Vec<_>>();
    let display = std::iter::once(program.to_string()).chain(args.iter().cloned()).collect::<Vec<_>>().join(" ");
    CommandSpec { program: program.into(), args, env: std::collections::HashMap::new(), display }
}

fn detect_node_manager(path: &Path) -> Option<String> {
    [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("package-lock.json", "npm"), ("bun.lock", "bun"), ("bun.lockb", "bun")]
        .iter()
        .find(|(lockfile, _)| path.join(lockfile).is_file())
        .map(|(_, manager)| (*manager).to_string())
        .or(Some("npm".into()))
}

fn lockfile_name(manager: &str) -> Option<&'static str> {
    match manager {
        "pnpm" => Some("pnpm-lock.yaml"),
        "yarn" => Some("yarn.lock"),
        "npm" => Some("package-lock.json"),
        "bun" => Some("bun.lock"),
        _ => None,
    }
}

fn command_for_node_script(manager: Option<&str>, name: &str) -> Option<(String, String)> {
    script_to_spec(manager, name).ok().map(|spec| (name.to_string(), spec.display))
}

fn script_command(scripts: &[DetectedScript], choices: &[&str]) -> Option<String> {
    choices.iter().find_map(|choice| scripts.iter().find(|script| script.name == *choice).map(|script| script.command.clone()))
}

fn add_node_frameworks(dependencies: &[String], frameworks: &mut BTreeSet<String>) {
    for (dependency, framework) in [
        ("astro", "Astro"),
        ("react", "React"),
        ("next", "Next.js"),
        ("nuxt", "Nuxt"),
        ("@nuxt/eslint", "Nuxt"),
        ("vite", "Vite"),
        ("@angular/core", "Angular"),
        ("vue", "Vue"),
        ("svelte", "Svelte"),
        ("tailwindcss", "Tailwind CSS"),
        ("@tailwindcss/vite", "Tailwind CSS"),
        ("three", "Three.js"),
        ("fastify", "Fastify"),
        ("express", "Express"),
        ("nestjs", "NestJS"),
        ("expo", "Expo"),
        ("react-native", "React Native"),
        ("remix", "Remix"),
        ("@remix-run/react", "Remix"),
        ("@sveltejs/kit", "SvelteKit"),
    ] {
        if dependencies.iter().any(|name| dependency_matches(name, dependency)) {
            frameworks.insert(framework.into());
        }
    }
}

/// Coincidencia por nombre exacto, sufijo de paquete (`expo-router`) o ámbito
/// (`@nuxt/kit`). Una comparación por subcadena marcaba `vitest` como Vite y
/// `preact` como React, y con ello el proyecto heredaba un puerto equivocado.
fn dependency_matches(name: &str, dependency: &str) -> bool {
    name == dependency
        || name.starts_with(&format!("{dependency}-"))
        || name.starts_with(&format!("{dependency}/"))
        || name.starts_with(&format!("@{dependency}/"))
}

fn detect_port(input: &str) -> Option<u16> {
    let tokens = input.split_whitespace().collect::<Vec<_>>();
    for (index, token) in tokens.iter().enumerate() {
        if (*token == "--port" || *token == "-p") && tokens.get(index + 1).is_some_and(|candidate| candidate.parse::<u16>().is_ok()) {
            return tokens[index + 1].parse().ok();
        }
        if let Some(value) = token.strip_prefix("--port=") {
            if let Ok(port) = value.parse() { return Some(port); }
        }
    }
    None
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(path).map_err(|error| format!("No se pudo leer {}: {error}", path.display()))?;
    serde_json::from_str(&content).map_err(|error| format!("package.json no contiene JSON válido: {error}"))
}

fn parse_python_requirement(line: &str) -> (String, Option<String>) {
    let delimiters = ["==", ">=", "<=", "~=", "!=", ">", "<"];
    for delim in delimiters {
        if let Some((pkg, ver)) = line.split_once(delim) {
            return (pkg.trim().to_string(), Some(format!("{delim}{}", ver.trim())));
        }
    }
    (line.trim().to_string(), None)
}

fn parse_pyproject_dependencies(content: &str, dependencies: &mut Vec<DeclaredDependency>, source: &str) {
    if let Ok(toml_val) = content.parse::<toml::Value>() {
        if let Some(deps) = toml_val.get("project").and_then(|p| p.get("dependencies")).and_then(|d| d.as_array()) {
            for item in deps {
                if let Some(s) = item.as_str() {
                    let (name, ver) = parse_python_requirement(s);
                    dependencies.push(DeclaredDependency {
                        name,
                        version: ver,
                        is_dev: false,
                        source: source.into(),
                    });
                }
            }
        }
        if let Some(opt_deps) = toml_val.get("project").and_then(|p| p.get("optional-dependencies")).and_then(|d| d.as_table()) {
            for (_group, list) in opt_deps {
                if let Some(arr) = list.as_array() {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            let (name, ver) = parse_python_requirement(s);
                            dependencies.push(DeclaredDependency {
                                name,
                                version: ver,
                                is_dev: true,
                                source: source.into(),
                            });
                        }
                    }
                }
            }
        }
        if let Some(poetry_deps) = toml_val.get("tool").and_then(|t| t.get("poetry")).and_then(|p| p.get("dependencies")).and_then(|d| d.as_table()) {
            for (name, ver_val) in poetry_deps {
                if name == "python" { continue; }
                let ver = ver_val.as_str().map(str::to_string);
                dependencies.push(DeclaredDependency {
                    name: name.clone(),
                    version: ver,
                    is_dev: false,
                    source: source.into(),
                });
            }
        }
    }
}

fn parse_cargo_dependencies(content: &str, dependencies: &mut Vec<DeclaredDependency>, source: &str) {
    let mut in_deps = false;
    let mut is_dev = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let section = trimmed.trim_matches(|c| c == '[' || c == ']').trim();
            if section == "dependencies" {
                in_deps = true;
                is_dev = false;
            } else if section == "dev-dependencies" {
                in_deps = true;
                is_dev = true;
            } else {
                in_deps = false;
            }
            continue;
        }
        if in_deps && !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some((pkg, rest)) = trimmed.split_once('=') {
                let pkg_name = pkg.trim().to_string();
                let ver = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                dependencies.push(DeclaredDependency {
                    name: pkg_name,
                    version: if ver.is_empty() || ver.starts_with('{') { None } else { Some(ver) },
                    is_dev,
                    source: source.into(),
                });
            }
        }
    }
}

fn discover_subprojects(path: &Path) -> Vec<(String, PathBuf)> {
    let mut results = Vec::new();
    let ignored_names = [
        ".git", ".venv", ".venv312", ".venv311", ".venv310", ".moon", ".vscode", "node_modules", "target", "dist", "build", ".turbo", ".output", "vendor", ".idea"
    ];

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let file_type = entry.file_type();
            if file_type.is_ok_and(|ft| ft.is_dir()) {
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if ignored_names.contains(&dir_name.as_str()) || dir_name.starts_with('.') {
                    continue;
                }
                let sub_path = entry.path();
                
                if ["apps", "packages", "services", "modules", "crates"].contains(&dir_name.as_str()) {
                    if let Ok(sub_entries) = fs::read_dir(&sub_path) {
                        for sub_entry in sub_entries.flatten() {
                            if sub_entry.file_type().is_ok_and(|ft| ft.is_dir()) {
                                let child_name = sub_entry.file_name().to_string_lossy().to_string();
                                if ignored_names.contains(&child_name.as_str()) || child_name.starts_with('.') {
                                    continue;
                                }
                                let child_path = sub_entry.path();
                                let rel = format!("{dir_name}/{child_name}");
                                results.push((rel, child_path));
                            }
                        }
                    }
                } else {
                    results.push((dir_name, sub_path));
                }
            }
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn detects_node_stack_and_uses_lockfile_manager() {
        let directory = tempdir().expect("tempdir");
        fs::write(directory.path().join("package.json"), r#"{"scripts":{"dev":"vite --port 5174","test":"vitest run"},"dependencies":{"react":"19","vite":"7"}}"#).expect("package");
        fs::write(directory.path().join("pnpm-lock.yaml"), "lockfileVersion: '9.0'").expect("lock");
        let scan = scan_project(directory.path()).expect("scan");
        assert_eq!(scan.package_manager.as_deref(), Some("pnpm"));
        assert!(scan.frameworks.contains(&"React".to_string()));
        assert!(scan.frameworks.contains(&"Vite".to_string()));
        assert_eq!(scan.port, Some(5174));
        assert_eq!(scan.dev_command.as_deref(), Some("pnpm run dev"));
    }

    #[test]
    fn refuses_actions_that_are_not_detected() {
        let scan = ProjectScan::default();
        assert!(command_for_action(Path::new("."), &scan, "dev", None).is_err());
        assert!(command_for_action(Path::new("."), &scan, "anything", None).is_err());
    }

    #[test]
    fn rejects_non_directory_project_paths() {
        let directory = tempdir().expect("tempdir");
        let file = directory.path().join("not-a-project.txt");
        fs::write(&file, "fixture").expect("file");
        assert!(canonical_project_path(file.to_string_lossy().as_ref()).is_err());
        assert!(canonical_project_path(directory.path().join("missing").to_string_lossy().as_ref()).is_err());
    }

    #[test]
    fn does_not_claim_a_lockfile_when_only_package_json_exists() {
        let directory = tempdir().expect("tempdir");
        fs::write(directory.path().join("package.json"), r#"{"scripts":{"dev":"vite"}}"#).expect("package");
        let scan = scan_project(directory.path()).expect("scan");
        assert_eq!(scan.package_manager.as_deref(), Some("npm"));
        assert_eq!(scan.lockfile, None);
    }

    #[test]
    fn builds_structured_script_arguments_without_a_shell() {
        let scan = ProjectScan { package_manager: Some("pnpm".into()), scripts: vec![DetectedScript { name: "dev".into(), command: "pnpm run dev".into(), source: "package.json".into() }], ..ProjectScan::default() };
        let command = command_for_action(Path::new("."), &scan, "dev", None).expect("command");
        assert_eq!(command.program, "pnpm");
        assert_eq!(command.args, vec!["run", "dev"]);
        assert!(!command.display.contains("sh -c"));
    }

    #[test]
    fn adapts_command_when_port_is_shifted() {
        let base = spec("pnpm", &["run", "dev"]);
        let adapted = adapt_command_for_available_port(base, 8001);
        assert_eq!(adapted.args, vec!["run", "dev", "--port", "8001"]);
        assert_eq!(adapted.env.get("PORT").map(String::as_str), Some("8001"));
        assert!(adapted.display.contains("8001"));
    }

    #[test]
    fn does_not_confuse_lookalike_packages_with_frameworks() {
        let mut frameworks = BTreeSet::new();
        add_node_frameworks(&["vitest".into(), "preact".into()], &mut frameworks);
        assert!(!frameworks.contains("Vite"));
        assert!(!frameworks.contains("React"));

        let mut real = BTreeSet::new();
        add_node_frameworks(&["vite".into(), "react".into(), "expo-router".into(), "@nuxt/kit".into()], &mut real);
        assert!(real.contains("Vite"));
        assert!(real.contains("React"));
        assert!(real.contains("Expo"));
        assert!(real.contains("Nuxt"));
    }

    #[test]
    fn applies_the_port_resolved_by_the_caller() {
        let scan = ProjectScan {
            package_manager: Some("pnpm".into()),
            port: Some(5173),
            scripts: vec![DetectedScript { name: "dev".into(), command: "pnpm run dev".into(), source: "package.json".into() }],
            ..ProjectScan::default()
        };
        let shifted = command_for_action_on_port(Path::new("."), &scan, "dev", None, Some(5174)).expect("command");
        assert_eq!(shifted.args, vec!["run", "dev", "--port", "5174"]);
        assert_eq!(shifted.env.get("PORT").map(String::as_str), Some("5174"));

        let untouched = command_for_action_on_port(Path::new("."), &scan, "dev", None, Some(5173)).expect("command");
        assert_eq!(untouched.args, vec!["run", "dev"]);
    }

    #[test]
    fn scans_monorepo_with_multiple_apps_and_manifests() {
        let directory = tempdir().expect("tempdir");
        let root = directory.path();
        fs::write(root.join("pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n").expect("workspace");
        fs::write(root.join("package.json"), r#"{"name":"@source/root"}"#).expect("root pkg");

        let app_web = root.join("apps").join("web");
        fs::create_dir_all(&app_web).expect("mkdir web");
        fs::write(app_web.join("package.json"), r#"{"name":"@source/web","dependencies":{"nuxt":"^4.1.2","vue":"^3.5.22"}}"#).expect("web pkg");

        let app_server = root.join("apps").join("server");
        fs::create_dir_all(&app_server).expect("mkdir server");
        fs::write(app_server.join("pyproject.toml"), "[project]\nname=\"server\"\ndependencies = [\"fastapi>=0.118.0\", \"uvicorn>=0.37.0\"]\n").expect("server pyproject");

        let scan = scan_project(root).expect("scan");
        assert!(scan.frameworks.contains(&"Monorepo".to_string()));
        assert!(scan.frameworks.contains(&"pnpm Workspace".to_string()));
        assert!(scan.frameworks.contains(&"Nuxt".to_string()));
        assert!(scan.frameworks.contains(&"FastAPI".to_string()));
        assert_eq!(scan.project_type, "Node.js + Python");
        assert_eq!(scan.declared_dependencies, 4);
        assert!(scan.dependencies.iter().any(|d| d.name == "nuxt" && d.source == "apps/web/package.json"));
        assert!(scan.dependencies.iter().any(|d| d.name == "fastapi" && d.source == "apps/server/pyproject.toml"));
    }
}
