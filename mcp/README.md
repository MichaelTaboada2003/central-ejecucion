# Dev Command Center — Protocolo y Servidor MCP

Servidor **Model Context Protocol (MCP)** local por `stdio` para permitir que asistentes de IA (Antigravity IDE, Claude Desktop, Cursor, Codex, VS Code) inspeccionen, ejecuten, administren y limpien proyectos de forma segura reutilizando el registro SQLite local de Dev Command Center.

---

## 🔒 Principios de Seguridad

1. **Local-First por Stdio**: No abre puertos de red ni servicios HTTP. La comunicación se realiza exclusivamente por `stdin`/`stdout`.
2. **Sin Ejecución Arbitraria**: No permite inyectar cadenas de shell (`sh -c`). Solo ejecuta programas y scripts estructurados detectados a partir de los manifiestos del proyecto (`package.json`, `manage.py`, `pyproject.toml`, `Cargo.toml`, etc.).
3. **Dry-Run Obligatorio**: Incluye `dev_command_center_plan_command` para planificar y previsualizar comandos antes de ejecutarlos.
4. **Protección Destructiva**: La limpieza de disco requiere un preview previo (`cleanup_preview`) con un token criptográfico de 5 minutos y confirmación explícita (`confirmed_by_user=true`). Únicamente se tocan directorios regenerables predefinidos (`node_modules`, `.venv`, `dist`, `build`, `.next`, `target`, etc.). Jamás se tocan `.env`, archivos de configuración ni código fuente.

---

## 📦 Compilación e Instalación

### Opción 1: Instalación Global en PATH (Recomendada)

Instala el binario directamente en tu `$CARGO_HOME/bin` (habitualmente `~/.cargo/bin`, presente en tu `PATH`):

```bash
cargo install --path src-tauri --bin dev-command-center-mcp
```

Una vez instalado, el comando `dev-command-center-mcp` estará disponible globalmente en cualquier terminal o cliente MCP.

### Opción 2: Compilación Local

```bash
# Compilar binario optimizado
cargo build --release --manifest-path src-tauri/Cargo.toml --features mcp --bin dev-command-center-mcp

# El ejecutable quedará en:
# ./src-tauri/target/release/dev-command-center-mcp
```

---

## ⚙️ Configuración en Clientes MCP

### 1. Antigravity IDE / Gemini

Agrega la configuración en `~/.gemini/config/mcp_config.json` o en el archivo de configuración de tu workspace:

```json
{
  "mcpServers": {
    "dev-command-center": {
      "command": "dev-command-center-mcp",
      "args": []
    }
  }
}
```

### 2. Claude Desktop

En macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`  
En Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dev-command-center": {
      "command": "dev-command-center-mcp",
      "args": []
    }
  }
}
```

> **Nota para entornos con Cargo fuera de PATH:**  
> Si tu cliente no carga tu `PATH` de usuario, especifica la ruta a tu binario en Cargo (por ejemplo: `/Users/TU_USUARIO/.cargo/bin/dev-command-center-mcp`).

### 3. Cursor

En `.cursor/mcp.json` o en la configuración de MCP de Cursor:

```json
{
  "mcpServers": {
    "dev-command-center": {
      "command": "dev-command-center-mcp"
    }
  }
}
```

### 4. Ejecución Directa con `cargo run` (Para Desarrollo)

Si prefieres ejecutar el código fuente directamente sin instalar el binario:

```json
{
  "mcpServers": {
    "dev-command-center": {
      "command": "cargo",
      "args": [
        "run",
        "--release",
        "--manifest-path",
        "/RUTA/ABSOLUTA/A/central-ejecucion/src-tauri/Cargo.toml",
        "--features",
        "mcp",
        "--bin",
        "dev-command-center-mcp"
      ]
    }
  }
}
```

---

## 🌐 Variables de Entorno

| Variable | Tipo | Descripción |
| :--- | :--- | :--- |
| `DEV_COMMAND_CENTER_DB` | Ruta absoluta | *(Opcional)* Sobrescribe la ubicación del archivo `dev-command-center.sqlite3`. Si no se define, se usa automáticamente la base de datos de la app de escritorio en `app_data_dir`. |

---

## 🛠️ Catálogo de Herramientas MCP

### 📂 Registro e Inspección

#### `dev_command_center_list_projects`
Lista todos los proyectos registrados con su estado en tiempo real (proceso activo, puerto en escucha, PID, tamaño en disco y tags).
- **Parámetros**: Ninguno.

#### `dev_command_center_register_project`
Registra un nuevo proyecto local en el panel. La ruta es canonizada y analizada; no se ejecuta ningún comando.
- **Parámetros**:
  - `path` *(string, obligatorio)*: Ruta absoluta o relativa al proyecto.
  - `name` *(string, opcional)*: Nombre personalizado del proyecto.
  - `tags` *(array de strings, opcional)*: Etiquetas asociadas.

#### `dev_command_center_inspect_project`
Obtiene los detalles profundos de un proyecto: scripts disponibles, stack detectado, historial de comandos recientes y estado del proceso en tiempo real.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto (ej. `proj-7482b977`).

#### `dev_command_center_refresh_project`
Vuelve a escanear los archivos del proyecto desde el disco y actualiza sus metadatos (puerto, scripts, dependencias, frameworks y tamaño) en SQLite.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.

---

### ⚡ Planificación y Ejecución de Comandos

#### `dev_command_center_plan_command`
Retorna el plan exacto y estructurado (ejecutable + lista de argumentos + variables de entorno) que se utilizaría para una acción, sin ejecutarlo (Dry-run).
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.
  - `action` *(string, obligatorio)*: `dev`, `build`, `test`, `lint`, `format`, `typecheck`, `install` o `script`.
  - `script` *(string, opcional)*: Nombre del script si `action="script"`.

#### `dev_command_center_execute`
Ejecuta una acción finita (`build`, `test`, `lint`, `format`, `typecheck`, `install` o `script`) y espera su finalización, retornando el código de salida, `stdout` y `stderr`. *Rechaza intencionalmente `action="dev"`*.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.
  - `action` *(string, obligatorio)*: Acción finita a ejecutar.
  - `script` *(string, opcional)*: Nombre del script si corresponde.

---

### 🚀 Procesos de Fondo (`dev`)

#### `dev_command_center_start_dev_process`
Inicia el servidor de desarrollo en segundo plano supervisado por la sesión MCP. Resuelve colisiones de puertos automáticamente asignando el siguiente puerto libre.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.

#### `dev_command_center_stop_dev_process`
Detiene de forma segura el proceso de desarrollo en segundo plano iniciado por la sesión MCP.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.

#### `dev_command_center_get_process_logs`
Obtiene las últimas líneas de log (`stdout` y `stderr`) del proceso en segundo plano administrado por la sesión.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.

---

### 🧹 Diagnóstico de Disco y Limpieza Segura

#### `dev_command_center_disk_report`
Genera un informe detallado del uso de espacio en disco del proyecto y el desglose de carpetas regenerables.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.

#### `dev_command_center_cleanup_preview`
Genera una previsualización de limpieza con expiración de 5 minutos, listando las carpetas que se eliminarán, los bytes que se liberarán y un token de confirmación.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.

#### `dev_command_center_cleanup_apply`
Aplica la eliminación física de las carpetas previamente previsualizadas.
- **Parámetros**:
  - `confirmation_token` *(string, obligatorio)*: Token emitido por `cleanup_preview`.
  - `confirmed_by_user` *(boolean, obligatorio)*: Debe ser `true`, confirmando que el usuario revisó y aprobó los directorios a borrar.

---

### 🖥️ Herramientas Externas

#### `dev_command_center_open_tool`
Abre el proyecto en una herramienta externa configurada:
- `finder`: Abre la carpeta en el explorador de archivos.
- `terminal`: Abre una nueva ventana de terminal en el directorio del proyecto.
- `antigravity`: Abre el proyecto en Antigravity IDE.
- `codex`: Abre el proyecto con Codex CLI / App.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: ID del proyecto.
  - `tool_id` *(string, obligatorio)*: `finder`, `terminal`, `antigravity` o `codex`.

---

### ☁️ Integración con GitHub (Cloud Workspaces)

#### `dev_command_center_github_status`
Consulta el estado de autenticación con GitHub, el usuario conectado, nombre, foto de perfil y número total de repositorios.
- **Parámetros**: Ninguno.

#### `dev_command_center_list_github_repos`
Lista todos los repositorios remotos del usuario en GitHub y detecta dinámicamente cuáles ya están clonados en el disco local y cuáles están solo en la nube.
- **Parámetros**: Ninguno.

#### `dev_command_center_clone_github_repo`
Clona un repositorio de GitHub al disco local y lo registra/escanea automáticamente en Dev Command Center.
- **Parámetros**:
  - `repo_name` *(string, obligatorio)*: Nombre del repositorio.
  - `clone_url` *(string, obligatorio)*: URL de clonación de Git (HTTPS o SSH).
  - `is_private` *(boolean, obligatorio)*: Si el repositorio es privado.
  - `target_path` *(string, opcional)*: Ruta destino personalizada. Si se omite, usa la ruta por defecto configurada.

#### `dev_command_center_safe_offload_project`
Archiva un proyecto de forma segura: verifica que no existan cambios locales sin commitear ni commits sin pushear a GitHub, detiene sus procesos, elimina la carpeta local y lo desregistra para liberar espacio en disco.
- **Parámetros**:
  - `project_id` *(string, obligatorio)*: UUID del proyecto.
  - `force` *(boolean, opcional)*: Forzar eliminación incluso con cambios pendientes (por defecto `false`).

---

### ⚙️ Ajustes y Configuración de la App

#### `dev_command_center_get_settings`
Obtiene toda la configuración actual de la aplicación: herramientas IDE configuradas, estado de conexión de GitHub y la carpeta de clonación por defecto.
- **Parámetros**: Ninguno.

#### `dev_command_center_set_github_token`
Guarda y verifica un Personal Access Token (PAT) de GitHub en la base de datos local SQLite.
- **Parámetros**:
  - `token` *(string, obligatorio)*: Token de acceso personal (`ghp_...` o `github_pat_...`).

#### `dev_command_center_set_default_clone_dir`
Establece la ruta del directorio base predeterminado donde se clonarán los proyectos de GitHub.
- **Parámetros**:
  - `path` *(string, obligatorio)*: Ruta absoluta de la carpeta base (ej. `/Users/usuario/Projects`).

#### `dev_command_center_save_ide_settings`
Configura los ejecutables y comandos de herramientas externas (Antigravity IDE, Codex, VS Code, etc.).
- **Parámetros**:
  - `tools` *(array de objetos, obligatorio)*: Lista de configuraciones con `id`, `label`, `command` y `available`.

