# Dev Command Center

Aplicación de escritorio **local-first** para registrar, ejecutar y mantener proyectos de desarrollo desde un único panel. Este repositorio implementa la **Fase 1** con Tauri v2, React estricto, Rust y SQLite local.

> La aplicación no sube rutas, logs ni configuración a la nube. El dominio se mantiene separado del almacenamiento para admitir una sincronización opcional futura.

## Funciones implementadas

- Registro manual por ruta pegada o selector nativo de carpetas; la ruta se canoniza y se deduplica en SQLite.
- Detección local de `package.json`, lockfiles de Node, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, Docker/Docker Compose y `composer.json`/Laravel.
- Detección de Astro, React, Next.js, Vite, Vue, Svelte, Streamlit, FastAPI, Django, Flask y otros metadatos disponibles.
- Inicio, detención y reinicio de scripts detectados; logs `stdout`/`stderr` en tiempo real, PID y el historial local de comandos.
- Ejecución con `std::process::Command` y argumentos estructurados; no se interpola un comando en una shell.
- Apertura de Finder, Terminal, VS Code, Cursor, Codex y una herramienta Antigravity configurable. La disponibilidad se verifica antes de lanzar.
- Vista de dependencias y de uso de disco (incluye `node_modules`, `.venv`, `dist`, `build`, `.next`, `.astro`, `target`, `.cache` y `.pytest_cache`).
- Limpieza destructiva con dry-run, selección explícita y confirmación; se rechazan symlinks, rutas fuera del proyecto y destinos no conocidos.

## Arquitectura

```text
src/                         React UI y puente tipado de Tauri
  api.ts                     Invocaciones tipadas al backend
  types.ts                   Contratos del dominio compartidos por la UI
  App.tsx                    Dashboard, detalle del proyecto y diálogos
src-tauri/src/
  domain.rs                  Entidades serializables y DTOs del dominio
  storage.rs                 Repositorio SQLite y migraciones
  scanner.rs                 Detección de stacks y construcción de comandos
  process.rs                 Ciclo de vida de procesos hijos y logs
  disk.rs                    Análisis de tamaño y limpieza segura
  ide.rs                     Lanzadores externos configurables
  lib.rs                     Comandos Tauri y composición de módulos
```

### Modelo local

- `projects`: identidad, ruta absoluta/canónica, stack, comandos detectados, puerto/URL, estado, etiquetas y uso de disco.
- `command_history`: comando, inicio, fin, código de salida y error del último proceso.
- `settings`: configuración de ejecutables de IDEs.

SQLite se abre dentro de `app_data_dir` de Tauri como `dev-command-center.sqlite3`; el resto de módulos depende de DTOs y del repositorio, no de la interfaz, para no acoplar una futura sincronización.

## Seguridad

1. Solo se opera sobre una ruta previamente registrada y cuya canonicalización sigue siendo idéntica.
2. Los scripts se derivan de manifiestos detectados; no hay un campo para ejecutar texto arbitrario.
3. `Command` recibe programa y argumentos separados.
4. Dev Command Center solo detiene procesos hijos que inició y conserva sus PID en memoria.
5. La limpieza solo conoce directorios regenerables predefinidos; no usa `rm -rf`, no sigue symlinks y nunca incluye `.env`, claves o credenciales.
6. Cada eliminación necesita primero un dry-run y luego una confirmación explícita en la UI.

## Desarrollo (macOS)

```bash
# El entorno actual tiene el toolchain Rust fuera de PATH:
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"

pnpm install
pnpm tauri dev
```

### Validación

```bash
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug
```

El último comando genera en macOS el `.app` y el `.dmg` en `src-tauri/target/debug/bundle/`.

## Añadir soporte para un stack

1. Amplía `scan_project` en `src-tauri/src/scanner.rs` para reconocer únicamente archivos y convenciones comprobables.
2. Añade el framework al conjunto detectado y, si corresponde, un gestor y lockfile en `detect_node_manager`/`install_command`.
3. Si habilitas una acción, constrúyela en `command_for_action` como `CommandSpec { program, args }`; no aceptes texto de shell ni interpolación de argumentos.
4. Añade una prueba de fixture en `scanner.rs` que cubra detección y el comando resultante.
5. Si aparecen directorios regenerables propios del stack, añádelos a `CLEANABLE_DIRECTORIES` en `disk.rs`, junto con una prueba que confirme que no puede borrar rutas externas ni `.env`.

## MCP local para agentes

El binario `dev-command-center-mcp` expone un servidor MCP **solo por stdio**. No abre un puerto HTTP, no transmite datos fuera del dispositivo y usa el mismo registro SQLite que la app de escritorio.

Para la guía completa de herramientas, integración y configuración paso a paso, consulta [`mcp/README.md`](mcp/README.md).

### Instalación y Conexión

```bash
# Instalación global en ~/.cargo/bin (portable para cualquier cliente MCP):
cargo install --path src-tauri --bin dev-command-center-mcp
```

Importa o adapta [`mcp/dev-command-center.mcp.json`](mcp/dev-command-center.mcp.json) en tu cliente MCP (Antigravity IDE, Claude Desktop, Cursor o VS Code). Si el agente debe usar otra base local, declara `DEV_COMMAND_CENTER_DB` como una **ruta absoluta** a `dev-command-center.sqlite3`.

### Herramientas disponibles

| Grupo | Herramientas |
| --- | --- |
| Registro | `dev_command_center_list_projects`, `dev_command_center_register_project`, `dev_command_center_inspect_project`, `dev_command_center_refresh_project` |
| Comandos | `dev_command_center_plan_command`, `dev_command_center_execute` |
| Procesos | `dev_command_center_start_dev_process`, `dev_command_center_stop_dev_process`, `dev_command_center_get_process_logs` |
| Mantenimiento | `dev_command_center_disk_report`, `dev_command_center_cleanup_preview`, `dev_command_center_cleanup_apply` |
| Integración | `dev_command_center_open_tool`, `dev_command_center_status` |

`plan_command` debe usarse antes de ejecutar una acción. `execute` solo admite acciones finitas detectadas (`build`, `test`, `lint`, `format`, `typecheck`, `install` o un script declarado); nunca recibe texto arbitrario ni invoca una shell.

Los procesos `dev` iniciados por el MCP pertenecen únicamente a la sesión stdio viva: el puente no interfiere con procesos que haya iniciado la UI u otro agente, y los detiene al cerrar su propia sesión. Para limpieza, el agente debe generar un preview nuevo, mostrar sus rutas/tamaños al usuario y después usar su token de cinco minutos con `confirmed_by_user: true`.

### Validación del puente

```bash
cargo test --manifest-path src-tauri/Cargo.toml --features mcp --lib
cargo build --manifest-path src-tauri/Cargo.toml --features mcp --bin dev-command-center-mcp
```

El smoke test de esta implementación verificó el handshake MCP por stdio, `tools/list` y `dev_command_center_status`, con 14 herramientas anunciadas.

## Próximas fases

- Escaneo de raíces elegidas por el usuario, etiquetas/favoritos avanzados y command palette con más acciones.
- Docker Compose, registro histórico de logs, monitor de CPU/RAM y correlación de puertos.
- Perfiles, backup y sincronización opcional detrás de un puerto de almacenamiento remoto.
