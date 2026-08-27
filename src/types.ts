export type ProjectStatus = 'stopped' | 'starting' | 'running' | 'error'

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
  action: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script'
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
