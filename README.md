# Dev Command Center

Aplicación de escritorio **local-first** para registrar, supervisar, ejecutar y mantener proyectos de desarrollo desde un único panel centralizado. Construida con **Tauri v2**, **React 19**, **TypeScript estricto**, **Rust** y **SQLite local**.

> La aplicación funciona 100% de manera local. No sube rutas, logs ni configuración a servidores externos. Tu token de GitHub (PAT) se almacena localmente y solo se comunica con la API oficial de GitHub cuando ejecutas acciones explícitas.

---

## ✨ Funcionalidades Principales

### 📁 Gestión Local de Proyectos
- **Registro Flexible**: Añade proyectos pegando la ruta absoluta o mediante el selector nativo de carpetas de macOS (`rfd`); las rutas se normalizan, canonizan y deduplican automáticamente en SQLite.
- **Detección Automática de Stacks**: Identifica manifiestos y configuraciones de:
  - **JavaScript / TypeScript**: Node.js, npm, pnpm, yarn, bun, Vite, Next.js, Astro, React, Vue, Svelte, NestJS, Express.
  - **Python**: pip, poetry, uv, pipenv, FastAPI, Django, Flask, Streamlit o scripts directos con entrypoints (`main.py`, `app.py`).
  - **Rust**: Cargo, workspaces y crates binarios.
  - **PHP**: Composer, Laravel, Symfony.
  - **Docker**: Dockerfile y Docker Compose.
- **Resolución Inteligente de Puertos**: Extrae puertos declarados en `.env` (`PORT`, `VITE_PORT`, etc.), archivos de configuración (`vite.config`, `astro.config`, `next.config`) o scripts detectados.
- **📌 Proyectos Fijados**: Marca proyectos favoritos con 1 clic para mantenerlos siempre visibles al inicio de la barra lateral y filtrables en el dashboard.
- **📦 Proyectos Archivados**: Oculta proyectos inactivos en una sección colapsable sin eliminarlos de tu disco, manteniendo tu espacio de trabajo limpio.

### 🌿 Integración Completa de Git y GitHub
- **Pestaña `Git & GitHub`**: Panel de control Git dedicado dentro del workspace de cada proyecto.
- **Estado en Tiempo Real**:
  - Rama activa actual (`🌿 main`, `🌿 feature/...`).
  - Lista de ramas locales y ramas remotas en GitHub.
  - Archivos con cambios pendientes sin commitear (`M` modificados, `+` untracked/nuevos, `D` eliminados).
  - Conteo de sincronización: `⬆ N commits por subir (Ahead)` y `⬇ N commits por bajar (Behind)`.
  - Último commit registrado (mensaje, hash y fecha).
- **Acciones Rápidas de Git**:
  - **`[⬇ Pull]`**: Descarga y fusiona los últimos cambios de GitHub en 1 clic.
  - **`[⬆ Push]`**: Sube commits locales pendientes a la rama remota con autenticación por token.
  - **`Commit & Push Rápido`**: Formulario integrado para escribir el mensaje de commit, hacer `git add -A`, commitear y subir a GitHub en un único paso.
  - **`🚀 Publicar en GitHub`**: Asistente para proyectos locales que crea el repositorio en tu cuenta de GitHub (público o privado), inicializa Git, crea un `.gitignore` por defecto y realiza el push inicial automáticamente.

### ☁️ GitHub Hub & Safe Offload
- **Explorador de Repositorios**: Lista todos los repositorios de tu cuenta de GitHub, indicando si ya están clonados localmente o disponibles en la nube.
- **Clonado en 1 Clic**: Clona repositorios en una carpeta de trabajo configurada con resolución automática de dependencias.
- **Safe Offload (Archivar a la Nube)**: Libera espacio en disco eliminando la copia local de forma segura únicamente tras verificar que todos los cambios locales y ramas estén sincronizados y subidos a GitHub (`git status` limpio y `git push` al día).

### ⚡ Ejecución y Supervisión de Procesos
- **Control de Servidores**: Inicia (`Run`), detiene y reinicia servidores de desarrollo en segundo plano.
- **Logs en Tiempo Real**: Consola integrada con salida `stdout`/`stderr`, auto-scroll, filtrado y conteo de líneas.
- **Lanzadores de Herramientas**: Abre cualquier proyecto directamente en **Finder**, **Terminal**, **VS Code**, **Cursor**, **Codex** o **Antigravity IDE**.
- **Gestión de Dependencias**: Visualiza dependencias instaladas y faltantes, con comandos de instalación inteligentes y fallbacks automáticos (`pnpm`, `npm`, `yarn`, `bun`, `pip`).
- **Limpieza de Disco Segura**: Calcula el tamaño en disco de carpetas temporales (`node_modules`, `target`, `.venv`, `.next`, `dist`, `.cache`) y permite liberarlas con dry-run y confirmación explícita.

---

## 🏛️ Arquitectura del Proyecto

```text
src/                         Frontend (React 19 + TypeScript + CSS modular)
  api.ts                     Capa de transporte e invocaciones IPC tipadas hacia Tauri
  types.ts                   Contratos de datos, DTOs y tipos del dominio
  App.tsx                    Vistas principales (Dashboard, Workspace, GitHub Hub, GitTab, Modales)
  App.css                    Variables de diseño, paleta HSL/dark mode y componentes

src-tauri/src/               Backend (Rust nativo + Tauri v2)
  domain.rs                  Estructuras serializables (Project, GitStatusInfo, ProcessInfo, etc.)
  storage.rs                 Capa de persistencia SQLite en modo WAL con migraciones automáticas
  scanner.rs                 Motor de detección de frameworks, package managers y puertos
  github.rs                  Servicio de integración con GitHub API y comandos Git CLI
  process.rs                 Gestor de ciclo de vida de procesos hijos y captura de logs
  disk.rs                    Analizador de uso de almacenamiento y limpiador protegido
  ide.rs                     Lanzador de editores y herramientas externas del sistema
  lib.rs                     Registro de comandos Tauri y composición del estado de la app
```

### Base de Datos SQLite Local
El archivo de base de datos se ubica en el directorio de datos de la aplicación (`app_data_dir`) como `dev-command-center.sqlite3` con modo **WAL (Write-Ahead Logging)** habilitado para soportar lecturas y escrituras concurrentes sin bloqueos:
- `projects`: Almacena metadatos del proyecto, ruta canónica, tags, puertos, estado, `is_pinned` e `is_archived`.
- `command_history`: Historial de ejecuciones con comandos, marcas de tiempo, códigos de salida y errores.
- `settings`: Clave-valor para preferencias de usuario (token PAT de GitHub, directorio por defecto de clonado, etc.).

---

## 🛡️ Seguridad y Buenas Prácticas

1. **Rutas Confiables**: Todas las operaciones se validan contra la ruta canónica en disco para evitar accesos fuera del árbol del proyecto.
2. **Ejecución Segura de Comandos**: Los procesos se ejecutan pasando el ejecutable y sus argumentos estructurados por separado con `std::process::Command`, sin invocar shells intermedias ni interpolación insegura.
3. **Limpieza Segura**: Solo se permite eliminar directorios temporales regenerables previamente definidos (`CLEANABLE_DIRECTORIES`). Nunca se tocan archivos `.env`, credenciales ni fuentes.
4. **Protección de Credenciales**: Las operaciones de Git usan autenticación HTTPS temporal con el token en memoria (`x-access-token`), asegurando que las URLs en `.git/config` queden siempre limpias y sin tokens en texto plano.

---

## 🛠️ Instalación y Desarrollo Local

### Requisitos
- **Node.js**: v18+ con `pnpm`
- **Rust**: Toolchain estable (`rustc` y `cargo`)
- **macOS**: Compatible con Apple Silicon (M1/M2/M3/M4) y procesadores Intel

### Ejecutar en Desarrollo

```bash
# 1. Instalar dependencias del frontend
pnpm install

# 2. Iniciar en modo desarrollo con Tauri (HMR frontend + recarga Rust)
export PATH="$HOME/.cargo/bin:$PATH"
pnpm tauri dev
```

### Validación y Pruebas

```bash
# Compilación y chequeo de tipos TypeScript
pnpm build

# Ejecutar suite de pruebas unitarias en Rust (24 tests)
cargo test --manifest-path src-tauri/Cargo.toml

# Generar binario de producción (.app y .dmg)
pnpm tauri build
```

---

## 🤖 Servidor MCP Local para Agentes de IA

Dev Command Center incluye un servidor **MCP (Model Context Protocol)** integrado que permite a asistentes como **Antigravity IDE**, **Claude Desktop**, **Cursor** o **Codex** inspeccionar y controlar tus proyectos locales a través de `stdio`.

Consulta la documentación detallada en [`mcp/README.md`](mcp/README.md).

---

## 📄 Licencia

Desarrollado bajo licencia privada para uso en entornos de desarrollo ágiles y control de ejecución local.
