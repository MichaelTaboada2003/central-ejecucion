use crate::domain::{
    GitActionResult, GitFileChange, GitStatusInfo, GitHubAccountStatus, GitHubRepo,
    Project, ProjectStatus, PublishToGitHubRequest,
};
use crate::scanner::scan_project;
use chrono::Utc;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

pub struct GitHubService;

impl GitHubService {
    pub fn resolve_token(custom_token: Option<&str>, storage_token: Option<String>) -> Option<String> {
        if let Some(t) = custom_token {
            if !t.trim().is_empty() {
                return Some(t.trim().to_string());
            }
        }
        if let Some(t) = storage_token {
            if !t.trim().is_empty() {
                return Some(t.trim().to_string());
            }
        }
        if let Ok(val) = std::env::var("GITHUB_TOKEN") {
            if !val.trim().is_empty() {
                return Some(val.trim().to_string());
            }
        }
        if let Ok(val) = std::env::var("token") {
            if !val.trim().is_empty() {
                return Some(val.trim().to_string());
            }
        }
        // Fallback: look for .env in current working directory
        if let Ok(content) = std::fs::read_to_string(".env") {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("token=") || trimmed.starts_with("GITHUB_TOKEN=") || trimmed.starts_with("GH_TOKEN=") {
                    if let Some((_, val)) = trimmed.split_once('=') {
                        let token = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        if !token.is_empty() {
                            return Some(token);
                        }
                    }
                }
            }
        }
        // Also check app configuration directory for .env
        if let Some(config_dir) = dirs::config_dir() {
            let app_env = config_dir.join("com.devcommandcenter.desktop").join(".env");
            if let Ok(content) = std::fs::read_to_string(app_env) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("token=") || trimmed.starts_with("GITHUB_TOKEN=") || trimmed.starts_with("GH_TOKEN=") {
                        if let Some((_, val)) = trimmed.split_once('=') {
                            let token = val.trim().trim_matches('"').trim_matches('\'').to_string();
                            if !token.is_empty() {
                                return Some(token);
                            }
                        }
                    }
                }
            }
        }
        None
    }

    pub fn get_git_remote_url(project_path: &Path) -> Option<String> {
        let git_config = project_path.join(".git").join("config");
        if let Ok(content) = std::fs::read_to_string(git_config) {
            let mut in_remote_origin = false;
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('[') {
                    in_remote_origin = trimmed.eq_ignore_ascii_case("[remote \"origin\"]");
                } else if in_remote_origin && trimmed.starts_with("url") {
                    if let Some((_, url)) = trimmed.split_once('=') {
                        let u = url.trim().trim_matches('"').trim_matches('\'').to_string();
                        if !u.is_empty() {
                            return Some(u);
                        }
                    }
                }
            }
        }
        None
    }

    pub fn get_workspace_search_roots(local_projects: &[Project]) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        let mut seen = std::collections::HashSet::new();

        // 1. Parent directories of all registered projects
        for proj in local_projects {
            let proj_path = Path::new(&proj.canonical_path);
            if let Some(parent) = proj_path.parent() {
                let parent_buf = parent.to_path_buf();
                if parent.is_dir() && seen.insert(parent_buf.clone()) {
                    roots.push(parent_buf);
                }
            }
        }

        // 2. Environment variable override if configured
        if let Ok(env_root) = std::env::var("DEV_COMMAND_CENTER_WORKSPACE_DIR") {
            let p = PathBuf::from(env_root);
            if p.is_dir() && seen.insert(p.clone()) {
                roots.push(p);
            }
        }

        // 3. Common developer folders in user home
        if let Some(home) = dirs::home_dir() {
            let candidates = [
                home.join("Projects"),
                home.join("Developer"),
                home.join("workspace"),
                home.join("Development"),
                home.join("Desktop"),
                home.join("Documents"),
            ];
            for candidate in &candidates {
                if candidate.is_dir() && seen.insert(candidate.clone()) {
                    roots.push(candidate.clone());
                }
            }
        }

        roots
    }

    pub fn resolve_default_clone_destination(repo_name: &str, local_projects: &[Project]) -> Result<PathBuf, String> {
        // 1. If user has registered projects, use the most frequent parent directory
        if !local_projects.is_empty() {
            let mut parent_counts = std::collections::HashMap::new();
            for p in local_projects {
                if let Some(parent) = Path::new(&p.canonical_path).parent() {
                    if parent.is_dir() {
                        *parent_counts.entry(parent.to_path_buf()).or_insert(0usize) += 1;
                    }
                }
            }
            // `max_by_key` sobre un HashMap resolvía los empates según el orden de
            // iteración, que varía entre ejecuciones: la ruta propuesta cambiaba
            // sola. Se desempata por ruta para que sea estable.
            let mut ranked = parent_counts.into_iter().collect::<Vec<_>>();
            ranked.sort_by(|(left_path, left_count), (right_path, right_count)| {
                right_count.cmp(left_count).then_with(|| left_path.cmp(right_path))
            });
            if let Some((best_parent, _)) = ranked.into_iter().next() {
                return Ok(best_parent.join(repo_name));
            }
        }

        // 2. Check environment variable
        if let Ok(env_root) = std::env::var("DEV_COMMAND_CENTER_WORKSPACE_DIR") {
            let p = PathBuf::from(env_root);
            if p.is_dir() {
                return Ok(p.join(repo_name));
            }
        }

        // 3. Fallback to standard cross-platform user directories
        let home = dirs::home_dir().ok_or_else(|| "No se pudo determinar el directorio de usuario ($HOME).".to_string())?;
        let project_dir = home.join("Projects");
        if project_dir.is_dir() {
            return Ok(project_dir.join(repo_name));
        }
        let dev_dir = home.join("Developer");
        if dev_dir.is_dir() {
            return Ok(dev_dir.join(repo_name));
        }
        if let Some(docs) = dirs::document_dir() {
            if docs.is_dir() {
                return Ok(docs.join(repo_name));
            }
        }
        Ok(home.join(repo_name))
    }

    pub fn scan_disk_repos(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<(String, Option<String>, String)>) {
        if depth > max_depth {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return; };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else { continue; };
            if !file_type.is_dir() {
                continue;
            }
            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();
            if name_str.starts_with('.')
                || matches!(
                    name_str.as_ref(),
                    "node_modules" | "target" | "dist" | "build" | ".venv" | "venv" | "__pycache__" | ".git" | ".Trash" | "Library"
                )
            {
                continue;
            }
            let sub_path = entry.path();
            if sub_path.join(".git").is_dir() {
                let remote = Self::get_git_remote_url(&sub_path);
                out.push((
                    name_str.to_string(),
                    remote,
                    sub_path.to_string_lossy().to_string(),
                ));
            }
            if depth < max_depth {
                Self::scan_disk_repos(&sub_path, depth + 1, max_depth, out);
            }
        }
    }

    pub fn get_account_status(token: Option<&str>) -> Result<GitHubAccountStatus, String> {
        let token = match token {
            Some(t) if !t.is_empty() => t,
            _ => {
                return Ok(GitHubAccountStatus {
                    authenticated: false,
                    username: None,
                    name: None,
                    avatar_url: None,
                    total_repos: 0,
                    token_preview: None,
                });
            }
        };

        let response = ureq::get("https://api.github.com/user")
            .set("Authorization", &format!("Bearer {token}"))
            .set("User-Agent", "DevCommandCenter/1.0")
            .call()
            .map_err(|error| format!("Error al autenticar con GitHub: {error}"))?;

        let body: Value = response
            .into_json()
            .map_err(|error| format!("Error al decodificar respuesta de GitHub: {error}"))?;

        let username = body.get("login").and_then(|v| v.as_str()).map(|s| s.to_string());
        let name = body.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
        let avatar_url = body.get("avatar_url").and_then(|v| v.as_str()).map(|s| s.to_string());
        let total_repos = body.get("public_repos").and_then(|v| v.as_u64()).unwrap_or(0) as usize
            + body.get("total_private_repos").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

        // Cortar por índices de bytes puede caer a mitad de un carácter y provocar
        // un pánico: la vista previa se construye sobre caracteres.
        let characters = token.chars().collect::<Vec<_>>();
        let token_preview = if characters.len() > 8 {
            let head = characters[..4].iter().collect::<String>();
            let tail = characters[characters.len() - 4..].iter().collect::<String>();
            Some(format!("{head}...{tail}"))
        } else {
            None
        };

        Ok(GitHubAccountStatus {
            authenticated: true,
            username,
            name,
            avatar_url,
            total_repos,
            token_preview,
        })
    }

    pub fn list_repos(token: Option<&str>, local_projects: &[Project]) -> Result<Vec<GitHubRepo>, String> {
        let token = match token {
            Some(t) if !t.is_empty() => t,
            _ => return Err("No se ha configurado un Token de GitHub.".into()),
        };

        // La API pagina de 100 en 100: pedir una sola página truncaba en silencio
        // el catálogo de cuentas con más de 100 repositorios.
        const PER_PAGE: usize = 100;
        const MAX_PAGES: usize = 20;
        let mut body: Vec<Value> = Vec::new();
        for page in 1..=MAX_PAGES {
            let url = format!(
                "https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page={PER_PAGE}&sort=updated&page={page}"
            );
            let response = ureq::get(&url)
                .set("Authorization", &format!("Bearer {token}"))
                .set("User-Agent", "DevCommandCenter/1.0")
                .call()
                .map_err(|error| format!("Error al consultar repositorios de GitHub: {error}"))?;
            let chunk: Vec<Value> = response
                .into_json()
                .map_err(|error| format!("Error al decodificar lista de repositorios: {error}"))?;
            let received = chunk.len();
            body.extend(chunk);
            if received < PER_PAGE {
                break;
            }
        }

        // Recursively discover all git repositories across dynamic workspace roots
        let search_roots = Self::get_workspace_search_roots(local_projects);
        let mut discovered_disk_repos: Vec<(String, Option<String>, String)> = Vec::new();
        for root in &search_roots {
            if root.is_dir() {
                Self::scan_disk_repos(root, 1, 4, &mut discovered_disk_repos);
            }
        }

        let mut repos = Vec::new();
        for item in body {
            let id = item.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let full_name = item.get("full_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let description = item.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
            let html_url = item.get("html_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let clone_url = item.get("clone_url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ssh_url = item.get("ssh_url").and_then(|v| v.as_str()).map(|s| s.to_string());
            let is_private = item.get("private").and_then(|v| v.as_bool()).unwrap_or(false);
            let language = item.get("language").and_then(|v| v.as_str()).map(|s| s.to_string());
            let stars = item.get("stargazers_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let forks = item.get("forks_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let updated_at = item.get("updated_at").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let default_branch = item.get("default_branch").and_then(|v| v.as_str()).unwrap_or("main").to_string();

            // Match against local projects (by project name, folder name, or git remote URL)
            let mut is_cloned = false;
            let mut local_project_id = None;
            let mut local_path = None;

            // 1. First check registered local projects (SQLite)
            for proj in local_projects {
                let proj_name_match = proj.name.eq_ignore_ascii_case(&name);
                let folder_name_match = Path::new(&proj.canonical_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.eq_ignore_ascii_case(&name))
                    .unwrap_or(false);

                let git_remote_match = Self::get_git_remote_url(Path::new(&proj.canonical_path))
                    .map(|remote| {
                        let r_lower = remote.to_lowercase();
                        let fn_lower = full_name.to_lowercase();
                        let n_lower = name.to_lowercase();
                        r_lower.contains(&fn_lower)
                            || r_lower.ends_with(&format!("/{}.git", n_lower))
                            || r_lower.ends_with(&format!("/{}", n_lower))
                    })
                    .unwrap_or(false);

                if proj_name_match || folder_name_match || git_remote_match {
                    is_cloned = true;
                    local_project_id = Some(proj.id.clone());
                    local_path = Some(proj.canonical_path.clone());
                    break;
                }
            }

            // 2. If not matched in registered projects, check all discovered disk repositories
            if !is_cloned {
                for (disk_folder, disk_remote, disk_path) in &discovered_disk_repos {
                    let folder_name_match = disk_folder.eq_ignore_ascii_case(&name);
                    let git_remote_match = disk_remote.as_ref()
                        .map(|remote| {
                            let r_lower = remote.to_lowercase();
                            let fn_lower = full_name.to_lowercase();
                            let n_lower = name.to_lowercase();
                            r_lower.contains(&fn_lower)
                                || r_lower.ends_with(&format!("/{}.git", n_lower))
                                || r_lower.ends_with(&format!("/{}", n_lower))
                        })
                        .unwrap_or(false);

                    if folder_name_match || git_remote_match {
                        is_cloned = true;
                        local_path = Some(disk_path.clone());
                        if let Some(p) = local_projects.iter().find(|p| p.canonical_path == *disk_path) {
                            local_project_id = Some(p.id.clone());
                        }
                        break;
                    }
                }
            }

            repos.push(GitHubRepo {
                id,
                name,
                full_name,
                description,
                html_url,
                clone_url,
                ssh_url,
                is_private,
                language,
                stars,
                forks,
                updated_at,
                default_branch,
                is_cloned,
                local_project_id,
                local_path,
            });
        }

        Ok(repos)
    }

    pub fn clone_and_register(
        repo_name: &str,
        clone_url: &str,
        _is_private: bool,
        token: Option<&str>,
        target_path: Option<&str>,
        local_projects: &[Project],
    ) -> Result<Project, String> {
        let destination = match target_path {
            Some(p) if !p.trim().is_empty() => PathBuf::from(p),
            _ => Self::resolve_default_clone_destination(repo_name, local_projects)?,
        };

        if destination.exists() {
            return Err(format!(
                "La carpeta destino «{}» ya existe en el disco.",
                destination.display()
            ));
        }

        // Format clone URL (inject token with proper auth prefix)
        let effective_clone_url = match token {
            Some(t) if !t.is_empty() && clone_url.starts_with("https://") => {
                let auth_prefix = if t.starts_with("github_pat_") {
                    format!("https://x-access-token:{}@", t)
                } else {
                    format!("https://{}@", t)
                };
                clone_url.replacen("https://", &auth_prefix, 1)
            }
            _ => clone_url.to_string(),
        };

        let output = Command::new("git")
            .arg("clone")
            .arg(&effective_clone_url)
            .arg(&destination)
            .output()
            .map_err(|error| format!("Error al ejecutar 'git clone': {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Falló la clonación del repositorio: {stderr}"));
        }

        // `git clone` guarda la URL usada en `.git/config`, así que clonar con el
        // token incrustado lo dejaba escrito en claro dentro del proyecto. Se
        // restaura el remoto limpio en cuanto termina la clonación.
        if effective_clone_url != clone_url {
            let _ = Command::new("git")
                .arg("remote")
                .arg("set-url")
                .arg("origin")
                .arg(clone_url)
                .current_dir(&destination)
                .output();
        }

        let canonical = destination
            .canonicalize()
            .map_err(|error| format!("No se pudo resolver la ruta canónica del proyecto clonado: {error}"))?;

        let scan = scan_project(&canonical)?;
        let report = crate::disk::disk_report("pending", &canonical)?;

        let project = Project {
            id: format!("proj-{}", &Uuid::new_v4().to_string()[..8]),
            name: repo_name.to_string(),
            path: destination.to_string_lossy().to_string(),
            canonical_path: canonical.to_string_lossy().to_string(),
            project_type: scan.project_type,
            kind: scan.kind,
            kind_override: None,
            frameworks: scan.frameworks,
            package_manager: scan.package_manager,
            dev_command: scan.dev_command,
            build_command: scan.build_command,
            test_command: scan.test_command,
            local_url: scan.local_url,
            port: scan.port,
            status: ProjectStatus::Stopped,
            last_used_at: None,
            disk_size_bytes: report.total_bytes,
            tags: vec!["github".to_string()],
            created_at: Utc::now().to_rfc3339(),
            last_error: None,
            is_pinned: false,
            is_archived: false,
        };

        Ok(project)
    }

    pub fn safe_offload_project(project_path: &Path, force: bool) -> Result<(), String> {
        if !project_path.exists() {
            return Ok(());
        }

        if !force {
            // Check git status --porcelain
            let status_output = Command::new("git")
                .arg("status")
                .arg("--porcelain")
                .current_dir(project_path)
                .output()
                .map_err(|error| format!("No se pudo verificar el estado de Git: {error}"))?;

            if !status_output.status.success() {
                return Err("La carpeta no es un repositorio Git válido o no se pudo consultar el estado.".into());
            }

            let status_text = String::from_utf8_lossy(&status_output.stdout);
            if !status_text.trim().is_empty() {
                return Err(format!(
                    "Operación cancelada: Hay archivos modificados o sin commitear en el proyecto:\n\n{}",
                    status_text.lines().take(5).collect::<Vec<_>>().join("\n")
                ));
            }

            // Check unpushed commits against remote tracking branch
            let log_output = Command::new("git")
                .arg("log")
                .arg("@{u}..HEAD")
                .arg("--oneline")
                .current_dir(project_path)
                .output()
                .map_err(|error| format!("No se pudo verificar los commits pendientes: {error}"))?;

            if log_output.status.success() {
                let log_text = String::from_utf8_lossy(&log_output.stdout);
                if !log_text.trim().is_empty() {
                    return Err(format!(
                        "Operación cancelada: Hay commits locales pendientes de subir a GitHub (git push):\n\n{}",
                        log_text.lines().take(3).collect::<Vec<_>>().join("\n")
                    ));
                }
            } else {
                // Sin rama de seguimiento no hay forma de comprobar que el trabajo
                // esté en GitHub. Antes se ignoraba el fallo y se borraba la
                // carpeta igualmente, perdiendo repositorios nunca publicados.
                return Err(
                    "Operación cancelada: la rama actual no tiene rama de seguimiento en GitHub, así que no se puede comprobar que tu trabajo esté publicado. Haz «git push -u origin <rama>» o marca la casilla de forzado si aun así deseas borrar la copia local."
                        .to_string(),
                );
            }
        }

        // Delete the directory safely
        std::fs::remove_dir_all(project_path)
            .map_err(|error| format!("No se pudo eliminar la carpeta local del proyecto: {error}"))?;

        Ok(())
    }

    pub fn inject_token_into_url(url: &str, token: &str) -> Option<String> {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            return None;
        }
        if url.starts_with("https://") {
            let auth_prefix = format!("https://x-access-token:{trimmed}@");
            Some(url.replacen("https://", &auth_prefix, 1))
        } else {
            None
        }
    }

    pub fn get_project_git_status(project_path: &Path, _token: Option<&str>) -> Result<GitStatusInfo, String> {
        if !project_path.exists() || !project_path.join(".git").exists() {
            return Ok(GitStatusInfo {
                is_repo: false,
                current_branch: None,
                remote_url: None,
                remote_name: None,
                branches: Vec::new(),
                remote_branches: Vec::new(),
                uncommitted_changes: Vec::new(),
                ahead_count: 0,
                behind_count: 0,
                last_commit_message: None,
                last_commit_hash: None,
                last_commit_date: None,
                is_clean: true,
            });
        }

        // 1. Current branch
        let branch_out = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(project_path)
            .output();
        let current_branch = match branch_out {
            Ok(out) if out.status.success() => {
                let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if name.is_empty() { None } else { Some(name) }
            }
            _ => None,
        };

        // 2. Remote URL
        let remote_url = Self::get_git_remote_url(project_path);
        let remote_name = if remote_url.is_some() { Some("origin".to_string()) } else { None };

        // 3. Local branches
        let mut branches = Vec::new();
        if let Ok(out) = Command::new("git")
            .args(["branch", "--format=%(refname:short)"])
            .current_dir(project_path)
            .output()
        {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    let b = line.trim();
                    if !b.is_empty() {
                        branches.push(b.to_string());
                    }
                }
            }
        }

        // 4. Remote branches
        let mut remote_branches = Vec::new();
        if let Ok(out) = Command::new("git")
            .args(["branch", "-r", "--format=%(refname:short)"])
            .current_dir(project_path)
            .output()
        {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    let b = line.trim();
                    if !b.is_empty() && !b.contains("HEAD ->") {
                        remote_branches.push(b.to_string());
                    }
                }
            }
        }

        // 5. Uncommitted changes (git status --porcelain=v1)
        let mut uncommitted_changes = Vec::new();
        if let Ok(out) = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(project_path)
            .output()
        {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    if line.len() >= 4 {
                        let staged_code = &line[0..1];
                        let unstaged_code = &line[1..2];
                        let path = line[3..].trim().to_string();
                        let (status, staged) = if staged_code != " " && staged_code != "?" {
                            let s = match staged_code {
                                "M" => "modified",
                                "A" => "added",
                                "D" => "deleted",
                                "R" => "renamed",
                                _ => "modified",
                            };
                            (s.to_string(), true)
                        } else {
                            let s = match unstaged_code {
                                "M" => "modified",
                                "D" => "deleted",
                                "?" => "untracked",
                                _ => "modified",
                            };
                            (s.to_string(), false)
                        };
                        uncommitted_changes.push(GitFileChange { path, status, staged });
                    }
                }
            }
        }

        // 6. Ahead / behind counts
        let mut ahead_count = 0;
        let mut behind_count = 0;
        if let Ok(out) = Command::new("git")
            .args(["rev-list", "--left-right", "--count", "HEAD...@{u}"])
            .current_dir(project_path)
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                let parts: Vec<&str> = text.split_whitespace().collect();
                if parts.len() == 2 {
                    ahead_count = parts[0].parse::<usize>().unwrap_or(0);
                    behind_count = parts[1].parse::<usize>().unwrap_or(0);
                }
            }
        }

        // 7. Last commit info
        let mut last_commit_message = None;
        let mut last_commit_hash = None;
        let mut last_commit_date = None;
        if let Ok(out) = Command::new("git")
            .args(["log", "-1", "--format=%h|%s|%cr"])
            .current_dir(project_path)
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                let parts: Vec<&str> = text.trim().splitn(3, '|').collect();
                if parts.len() == 3 {
                    last_commit_hash = Some(parts[0].to_string());
                    last_commit_message = Some(parts[1].to_string());
                    last_commit_date = Some(parts[2].to_string());
                }
            }
        }

        let is_clean = uncommitted_changes.is_empty() && ahead_count == 0;

        Ok(GitStatusInfo {
            is_repo: true,
            current_branch,
            remote_url,
            remote_name,
            branches,
            remote_branches,
            uncommitted_changes,
            ahead_count,
            behind_count,
            last_commit_message,
            last_commit_hash,
            last_commit_date,
            is_clean,
        })
    }

    pub fn git_pull(project_path: &Path, token: Option<&str>) -> Result<GitActionResult, String> {
        let auth_url = if let Some(t) = token {
            Self::get_git_remote_url(project_path).and_then(|url| Self::inject_token_into_url(&url, t))
        } else {
            None
        };

        let mut cmd = Command::new("git");
        cmd.arg("pull");
        if let Some(ref url) = auth_url {
            cmd.arg(url);
        }
        cmd.current_dir(project_path);

        let output = cmd.output().map_err(|error| format!("Error al ejecutar git pull: {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined = if stderr.trim().is_empty() { stdout } else { format!("{stdout}\n{stderr}") };

        if output.status.success() {
            Ok(GitActionResult {
                success: true,
                message: "Cambios descargados exitosamente (git pull).".to_string(),
                output: Some(combined.trim().to_string()),
            })
        } else {
            Err(format!("Fallo al hacer git pull:\n{}", combined.trim()))
        }
    }

    pub fn git_push(project_path: &Path, token: Option<&str>) -> Result<GitActionResult, String> {
        let branch_out = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(project_path)
            .output();
        let branch = match branch_out {
            Ok(out) if out.status.success() => {
                let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if name.is_empty() { "main".to_string() } else { name }
            }
            _ => "main".to_string(),
        };

        let auth_url = if let Some(t) = token {
            Self::get_git_remote_url(project_path).and_then(|url| Self::inject_token_into_url(&url, t))
        } else {
            None
        };

        let mut cmd = Command::new("git");
        cmd.arg("push");
        if let Some(ref url) = auth_url {
            cmd.args([url, &format!("HEAD:{branch}")]);
        }
        cmd.current_dir(project_path);

        let output = cmd.output().map_err(|error| format!("Error al ejecutar git push: {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined = if stderr.trim().is_empty() { stdout } else { format!("{stdout}\n{stderr}") };

        if output.status.success() {
            Ok(GitActionResult {
                success: true,
                message: "Commits subidos a GitHub exitosamente (git push).".to_string(),
                output: Some(combined.trim().to_string()),
            })
        } else {
            Err(format!("Fallo al hacer git push:\n{}", combined.trim()))
        }
    }

    pub fn git_commit_and_push(project_path: &Path, message: &str, token: Option<&str>) -> Result<GitActionResult, String> {
        if message.trim().is_empty() {
            return Err("El mensaje de commit no puede estar vacío.".to_string());
        }

        // 1. git add -A
        let add_out = Command::new("git")
            .args(["add", "-A"])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Error al ejecutar git add: {e}"))?;
        if !add_out.status.success() {
            return Err(format!("git add falló: {}", String::from_utf8_lossy(&add_out.stderr)));
        }

        // 2. git commit -m message
        let commit_out = Command::new("git")
            .args(["commit", "-m", message.trim()])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Error al ejecutar git commit: {e}"))?;
        if !commit_out.status.success() {
            let stderr = String::from_utf8_lossy(&commit_out.stderr);
            let stdout = String::from_utf8_lossy(&commit_out.stdout);
            if stdout.contains("nothing to commit") {
                return Err("No hay cambios pendientes para commitear.".to_string());
            }
            return Err(format!("git commit falló: {stdout}\n{stderr}"));
        }

        // 3. git push
        Self::git_push(project_path, token)
    }

    pub fn publish_project_to_github(
        project_path: &Path,
        project_name: &str,
        request: PublishToGitHubRequest,
        token: &str,
    ) -> Result<GitActionResult, String> {
        let repo_name = if request.repo_name.trim().is_empty() {
            project_name.trim().to_string()
        } else {
            request.repo_name.trim().to_string()
        };

        // 1. Create repo via GitHub API (POST https://api.github.com/user/repos)
        let body = serde_json::json!({
            "name": repo_name,
            "description": request.description.unwrap_or_default(),
            "private": request.is_private,
            "auto_init": false
        });

        let response = ureq::post("https://api.github.com/user/repos")
            .set("Authorization", &format!("Bearer {token}"))
            .set("User-Agent", "DevCommandCenter/1.0")
            .send_json(body)
            .map_err(|error| format!("Error al crear el repositorio en GitHub: {error}"))?;

        let created_repo: Value = response
            .into_json()
            .map_err(|error| format!("Error al procesar la respuesta de creación de repositorio: {error}"))?;

        let clone_url = created_repo
            .get("clone_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "GitHub no devolvió la URL de clonado.".to_string())?;
        let html_url = created_repo.get("html_url").and_then(|v| v.as_str()).unwrap_or("");

        // 2. If .git doesn't exist, git init
        if !project_path.join(".git").exists() {
            let _ = Command::new("git")
                .args(["init", "-b", "main"])
                .current_dir(project_path)
                .output();
        }

        // 3. Ensure a basic .gitignore if none exists
        let gitignore = project_path.join(".gitignore");
        if !gitignore.exists() {
            let sensible_ignores = "# Generado por Dev Command Center\nnode_modules/\ndist/\nbuild/\ntarget/\n.venv/\nvenv/\n__pycache__/\n*.pyc\n.env\n.DS_Store\n";
            let _ = std::fs::write(gitignore, sensible_ignores);
        }

        // 4. git remote add origin
        let _ = Command::new("git")
            .args(["remote", "remove", "origin"])
            .current_dir(project_path)
            .output();

        let _ = Command::new("git")
            .args(["remote", "add", "origin", clone_url])
            .current_dir(project_path)
            .output();

        // 5. git add -A & initial commit if needed
        let _ = Command::new("git")
            .args(["add", "-A"])
            .current_dir(project_path)
            .output();

        let _ = Command::new("git")
            .args(["commit", "-m", "Initial commit from Dev Command Center"])
            .current_dir(project_path)
            .output();

        // 6. git branch -M main
        let _ = Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(project_path)
            .output();

        // 7. git push -u origin main (authenticated)
        let auth_url = Self::inject_token_into_url(clone_url, token)
            .unwrap_or_else(|| clone_url.to_string());

        let push_out = Command::new("git")
            .args(["push", "-u", &auth_url, "main"])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Error al subir el repositorio inicial a GitHub: {e}"))?;

        if !push_out.status.success() {
            let stderr = String::from_utf8_lossy(&push_out.stderr);
            let stdout = String::from_utf8_lossy(&push_out.stdout);
            return Err(format!("Repositorio creado en GitHub, pero falló el push inicial:\n{stdout}\n{stderr}"));
        }

        Ok(GitActionResult {
            success: true,
            message: format!("¡Proyecto publicado con éxito en GitHub!: {html_url}"),
            output: Some(html_url.to_string()),
        })
    }
}
