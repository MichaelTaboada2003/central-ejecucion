export type ProjectStatus = 'stopped' | 'starting' | 'running' | 'error'

/**
 * Cómo debe tratarse un proyecto. El panel asumía que todo era un servidor de
 * desarrollo: un script que corre y termina no tiene puerto, y su estado «en
 * ejecución» —que se deduce de quién escucha el puerto— era una ficción.
 */
export type ProjectKind = 'service' | 'script' | 'notebook' | 'inert'

export interface Project {
  id: string
  name: string
  path: string
  canonicalPath: string
  projectType: string
  frameworks: string[]
  packageManager: string | null
  devCommand: string | null
  buildCommand: string | null
  testCommand: string | null
  localUrl: string | null
  port: number | null
  status: ProjectStatus
  lastUsedAt: string | null
  diskSizeBytes: number
  tags: string[]
  createdAt: string
  lastError: string | null
  isPinned?: boolean
  isArchived?: boolean
  /** Cómo trata el panel al proyecto. Se deduce del contenido de la carpeta en
   *  cada escaneo; no se puede forzar a mano. */
  kind?: ProjectKind
}

export interface DetectedScript {
  name: string
  command: string
  source: string
}

export interface DeclaredDependency {
  name: string
  version?: string | null
  isDev: boolean
  source: string
}

export interface ProjectScan {
  projectType: string
  kind?: ProjectKind
  frameworks: string[]
  packageManager: string | null
  manifests: string[]
  lockfile: string | null
  scripts: DetectedScript[]
  devCommand: string | null
  buildCommand: string | null
  testCommand: string | null
  localUrl: string | null
  port: number | null
  declaredDependencies: number
  dependencies: DeclaredDependency[]
  installedDependencies: boolean
  /** Directorio donde están las dependencias instaladas, si se encontró. */
  environmentDir?: string | null
  /** Directorios que se buscaron y faltan, ya con el nombre de esta pila. */
  missingEnvironment?: string[]
}

export interface ProcessInfo {
  projectId: string
  pid: number
  startedAt: string
  command: string
}

export interface LogEntry {
  projectId: string
  stream: 'stdout' | 'stderr'
  line: string
  timestamp: string
}

export interface CommandRecord {
  id: string
  projectId: string
  action: string
  command: string
  startedAt: string
  endedAt: string | null
  exitCode: number | null
  status: 'running' | 'completed' | 'stopped' | 'error'
  errorMessage: string | null
}

export interface ProjectDetail {
  project: Project
  scan: ProjectScan
  process: ProcessInfo | null
  recentCommands: CommandRecord[]
}

export interface DiskEntry {
  target: string
  label: string
  path: string
  bytes: number
  regenerable: boolean
}

export interface DiskReport {
  projectId: string
  totalBytes: number
  entries: DiskEntry[]
}

export interface CleanupPreview {
  projectId: string
  totalBytes: number
  entries: DiskEntry[]
  dryRun: boolean
}

export interface IdeConfig {
  id: string
  label: string
  command: string | null
  available: boolean
}

export interface IdeSettings {
  tools: IdeConfig[]
}

export interface PortInfo {
  port: number
  pid: number | null
  listening: boolean
}

export interface RunProjectRequest {
  projectId: string
  action: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script' | 'notebook'
  script?: string
}

export interface GitHubAccountStatus {
  authenticated: boolean
  username?: string | null
  name?: string | null
  avatarUrl?: string | null
  totalRepos: number
  tokenPreview?: string | null
}

export interface GitHubRepo {
  id: number
  name: string
  fullName: string
  description?: string | null
  htmlUrl: string
  cloneUrl: string
  sshUrl?: string | null
  isPrivate: boolean
  language?: string | null
  stars: number
  forks: number
  updatedAt: string
  defaultBranch: string
  isCloned: boolean
  localProjectId?: string | null
  localPath?: string | null
}

export interface CloneRepoRequest {
  repoName: string
  cloneUrl: string
  isPrivate: boolean
  targetPath?: string | null
}

export interface SafeOffloadResult {
  success: boolean
  projectId: string
  projectName: string
  message: string
}

export interface GitStatusInfo {
  isRepo: boolean
  currentBranch?: string | null
  remoteUrl?: string | null
  remoteName?: string | null
  branches: string[]
  remoteBranches: string[]
  uncommittedChanges: GitFileChange[]
  aheadCount: number
  behindCount: number
  lastCommitMessage?: string | null
  lastCommitHash?: string | null
  lastCommitDate?: string | null
  isClean: boolean
  /** Cuándo se consultó GitHub por última vez. Sin esto, «0 por bajar» mentiría:
   *  las cuentas se hacen contra la copia local de las ramas remotas. */
  lastFetchAt?: string | null
}

export interface GitFileChange {
  path: string
  status: string
  staged: boolean
}

export interface GitActionResult {
  success: boolean
  message: string
  output?: string | null
}

export interface PublishToGitHubRequest {
  projectId: string
  repoName: string
  description?: string | null
  isPrivate: boolean
}
