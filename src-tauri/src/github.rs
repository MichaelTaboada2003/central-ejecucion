use crate::domain::{GitHubAccountStatus, GitHubRepo, Project, ProjectStatus};
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
        // Fallback: look for .env in current directory or known project path
        let env_paths = [
            PathBuf::from(".env"),
            PathBuf::from("/Users/apple/Desktop/Programacion/central-ejecucion/.env"),
        ];
        for env_path in env_paths {
            if let Ok(content) = std::fs::read_to_string(env_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("token=") || trimmed.starts_with("GITHUB_TOKEN=") {
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

        let token_preview = if token.len() > 8 {
            Some(format!("{}...{}", &token[..4], &token[token.len() - 4..]))
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

        let response = ureq::get("https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&sort=updated")
            .set("Authorization", &format!("Bearer {token}"))
            .set("User-Agent", "DevCommandCenter/1.0")
            .call()
            .map_err(|error| format!("Error al consultar repositorios de GitHub: {error}"))?;

        let body: Vec<Value> = response
            .into_json()
            .map_err(|error| format!("Error al decodificar lista de repositorios: {error}"))?;

        // Recursively discover all git repositories on disk across Programacion, Universidad, Zenoex
        let mut discovered_disk_repos: Vec<(String, Option<String>, String)> = Vec::new();
        if let Some(home) = dirs::home_dir() {
            let roots = [
                home.join("Desktop").join("Programacion"),
                home.join("Desktop").join("Universidad"),
                home.join("Desktop").join("Zenoex"),
            ];
            for root in &roots {
                if root.is_dir() {
                    Self::scan_disk_repos(root, 1, 4, &mut discovered_disk_repos);
                }
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
    ) -> Result<Project, String> {
        let destination = match target_path {
            Some(p) if !p.trim().is_empty() => PathBuf::from(p),
            _ => {
                let home = dirs::home_dir().ok_or_else(|| "No se pudo determinar el directorio de usuario ($HOME).".to_string())?;
                home.join("Desktop").join("Programacion").join(repo_name)
            }
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
                .output();

            if let Ok(out) = log_output {
                if out.status.success() {
                    let log_text = String::from_utf8_lossy(&out.stdout);
                    if !log_text.trim().is_empty() {
                        return Err(format!(
                            "Operación cancelada: Hay commits locales pendientes de subir a GitHub (git push):\n\n{}",
                            log_text.lines().take(3).collect::<Vec<_>>().join("\n")
                        ));
                    }
                }
            }
        }

        // Delete the directory safely
        std::fs::remove_dir_all(project_path)
            .map_err(|error| format!("No se pudo eliminar la carpeta local del proyecto: {error}"))?;

        Ok(())
    }
}
