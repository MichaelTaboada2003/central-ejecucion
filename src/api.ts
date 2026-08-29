import { invoke } from '@tauri-apps/api/core'
import type {
  CleanupPreview,
  CloneRepoRequest,
  DiskReport,
  GitActionResult,
  GitStatusInfo,
  GitHubAccountStatus,
  GitHubRepo,
  IdeSettings,
  LogEntry,
  PortInfo,
  ProcessInfo,
  Project,
  ProjectDetail,
  PublishToGitHubRequest,
  RunProjectRequest,
  SafeOffloadResult,
} from './types'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

// Mock Data for Browser Dev Mode
const mockProjects: Project[] = [
  {
    "id": "proj-d7e4c184",
    "name": "akorsis",
    "path": "/Users/apple/Desktop/Programacion/akorsis",
    "canonicalPath": "/Users/apple/Desktop/Programacion/akorsis",
    "projectType": "Flutter App",
    "frameworks": [
      "Flutter",
      "Dart"
    ],
    "packageManager": null,
    "devCommand": "flutter run",
    "buildCommand": "flutter build apk",
    "testCommand": null,
    "localUrl": null,
    "port": null,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.788874Z",
    "diskSizeBytes": 80119640,
    "tags": [
      "flutter",
      "dart"
    ],
    "createdAt": "2026-08-26T14:36:19.788874Z",
    "lastError": null
  },
  {
    "id": "proj-2ec442b1",
    "name": "app",
    "path": "/Users/apple/Desktop/Programacion/Shalom/app",
    "canonicalPath": "/Users/apple/Desktop/Programacion/Shalom/app",
    "projectType": "Next.js App",
    "frameworks": [
      "React",
      "Next.js",
      "Tailwind",
      "TypeScript"
    ],
    "packageManager": "pnpm",
    "devCommand": "pnpm dev",
    "buildCommand": "pnpm build",
    "testCommand": null,
    "localUrl": "http://localhost:3000",
    "port": 3000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.786895Z",
    "diskSizeBytes": 756248316,
    "tags": [
      "react",
      "next.js",
      "tailwind"
    ],
    "createdAt": "2026-08-26T14:36:19.786895Z",
    "lastError": null
  },
  {
    "id": "proj-a74bdb57",
    "name": "application-topology-graph",
    "path": "/Users/apple/Desktop/Programacion/application-topology-graph",
    "canonicalPath": "/Users/apple/Desktop/Programacion/application-topology-graph",
    "projectType": "Node.js",
    "frameworks": [],
    "packageManager": "npm",
    "devCommand": null,
    "buildCommand": null,
    "testCommand": null,
    "localUrl": null,
    "port": null,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.788923Z",
    "diskSizeBytes": 12479180,
    "tags": [],
    "createdAt": "2026-08-26T14:36:19.788923Z",
    "lastError": null
  },
  {
    "id": "proj-7482b977",
    "name": "auto-scan",
    "path": "/Users/apple/Desktop/Programacion/auto-scan",
    "canonicalPath": "/Users/apple/Desktop/Programacion/auto-scan",
    "projectType": "Python App",
    "frameworks": [
      "Python",
      "Django",
      "Docker"
    ],
    "packageManager": null,
    "devCommand": "python manage.py runserver",
    "buildCommand": null,
    "testCommand": null,
    "localUrl": "http://localhost:8000",
    "port": 8000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.788949Z",
    "diskSizeBytes": 787813053,
    "tags": [
      "python",
      "django",
      "docker"
    ],
    "createdAt": "2026-08-26T14:36:19.788949Z",
    "kind": "script",
    "lastError": null
  },
  {
    "id": "proj-9a265534",
    "name": "aworldaway_nasa_2025",
    "path": "/Users/apple/Desktop/Programacion/aworldaway_nasa_2025",
    "canonicalPath": "/Users/apple/Desktop/Programacion/aworldaway_nasa_2025",
    "projectType": "Node.js",
    "frameworks": [],
    "packageManager": "pnpm",
    "devCommand": null,
    "buildCommand": null,
    "testCommand": null,
    "localUrl": null,
    "port": null,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.788973Z",
    "diskSizeBytes": 316635453,
    "tags": [],
    "createdAt": "2026-08-26T14:36:19.788973Z",
    "lastError": null
  },
  {
    "id": "proj-9db40c8b",
    "name": "banrep-py",
    "path": "/Users/apple/Desktop/Programacion/banrep-py",
    "canonicalPath": "/Users/apple/Desktop/Programacion/banrep-py",
    "projectType": "Python App",
    "frameworks": [
      "Python",
      "Pandas"
    ],
    "packageManager": null,
    "devCommand": null,
    "buildCommand": null,
    "testCommand": null,
    "localUrl": null,
    "port": null,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.788993Z",
    "diskSizeBytes": 757075,
    "tags": [
      "python",
      "pandas"
    ],
    "createdAt": "2026-08-26T14:36:19.788993Z",
    "kind": "notebook",
    "lastError": null
  },
  {
    "id": "proj-3a2c47f3",
    "name": "central-ejecucion",
    "path": "/Users/apple/Desktop/Programacion/central-ejecucion",
    "canonicalPath": "/Users/apple/Desktop/Programacion/central-ejecucion",
    "projectType": "Tauri Desktop App",
    "frameworks": [
      "React",
      "Vite",
      "Tauri",
      "Rust",
      "TypeScript"
    ],
    "packageManager": "pnpm",
    "devCommand": "pnpm dev",
    "buildCommand": "pnpm build",
    "testCommand": "pnpm test",
    "localUrl": "http://localhost:1420",
    "port": 1420,
    "status": "running",
    "lastUsedAt": "2026-08-26T14:36:19.789013Z",
    "diskSizeBytes": 7330711738,
    "tags": [
      "react",
      "vite",
      "tauri"
    ],
    "createdAt": "2026-08-26T14:36:19.789013Z",
    "lastError": null
  },
  {
    "id": "proj-ff0f6a4a",
    "name": "dev-metrics",
    "path": "/Users/apple/Desktop/Programacion/dev-metrics",
    "canonicalPath": "/Users/apple/Desktop/Programacion/dev-metrics",
    "projectType": "Next.js App",
    "frameworks": [
      "React",
      "Next.js",
      "Tailwind",
      "TypeScript"
    ],
    "packageManager": "pnpm",
    "devCommand": "pnpm dev",
    "buildCommand": "pnpm build",
    "testCommand": null,
    "localUrl": "http://localhost:3000",
    "port": 3000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789033Z",
    "diskSizeBytes": 134206,
    "tags": [
      "github",
      "next.js"
    ],
    "createdAt": "2026-08-26T14:36:19.789033Z",
    "lastError": null
  },
  {
    "id": "proj-78a9f8da",
    "name": "exosky-nasa-space-app-2024",
    "path": "/Users/apple/Desktop/Programacion/exosky-nasa-space-app-2024",
    "canonicalPath": "/Users/apple/Desktop/Programacion/exosky-nasa-space-app-2024",
    "projectType": "Generic",
    "frameworks": [
      "Docker"
    ],
    "packageManager": null,
    "devCommand": null,
    "buildCommand": null,
    "testCommand": null,
    "localUrl": null,
    "port": null,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789051Z",
    "diskSizeBytes": 43960315,
    "tags": [
      "docker"
    ],
    "createdAt": "2026-08-26T14:36:19.789051Z",
    "kind": "inert",
    "lastError": null
  },
  {
    "id": "proj-54d63585",
    "name": "futures-radar",
    "path": "/Users/apple/Desktop/Programacion/futures-radar",
    "canonicalPath": "/Users/apple/Desktop/Programacion/futures-radar",
    "projectType": "Python App",
    "frameworks": [
      "Python",
      "Streamlit",
      "Pandas"
    ],
    "packageManager": null,
    "devCommand": "streamlit run app.py",
    "buildCommand": null,
    "testCommand": null,
    "localUrl": "http://localhost:8501",
    "port": 8501,
    "status": "running",
    "lastUsedAt": "2026-08-26T14:36:19.789070Z",
    "diskSizeBytes": 849354202,
    "tags": [
      "python",
      "streamlit",
      "pandas"
    ],
    "createdAt": "2026-08-26T14:36:19.789070Z",
    "lastError": null
  },
  {
    "id": "proj-e2571099",
    "name": "generador-catalogos",
    "path": "/Users/apple/Desktop/Programacion/generador-catalogos",
    "canonicalPath": "/Users/apple/Desktop/Programacion/generador-catalogos",
    "projectType": "Python App",
    "frameworks": [
      "Python",
      "Docker"
    ],
    "packageManager": null,
    "devCommand": "python main.py",
    "buildCommand": null,
    "testCommand": null,
    "localUrl": null,
    "port": null,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789089Z",
    "diskSizeBytes": 74306,
    "tags": [
      "python",
      "docker"
    ],
    "createdAt": "2026-08-26T14:36:19.789089Z",
    "kind": "script",
    "lastError": null
  },
  {
    "id": "proj-acff5a71",
    "name": "gestor-prestamos",
    "path": "/Users/apple/Desktop/Programacion/gestor-prestamos",
    "canonicalPath": "/Users/apple/Desktop/Programacion/gestor-prestamos",
    "projectType": "Next.js App",
    "frameworks": [
      "React",
      "Next.js",
      "Tailwind",
      "TypeScript"
    ],
    "packageManager": "pnpm",
    "devCommand": "pnpm dev",
    "buildCommand": "pnpm build",
    "testCommand": null,
    "localUrl": "http://localhost:3000",
    "port": 3000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789107Z",
    "diskSizeBytes": 931684147,
    "tags": [
      "react",
      "next.js",
      "tailwind"
    ],
    "createdAt": "2026-08-26T14:36:19.789107Z",
    "lastError": null
  },
  {
    "id": "proj-9d99ba42",
    "name": "gym-tracker",
    "path": "/Users/apple/Desktop/Programacion/gym-tracker",
    "canonicalPath": "/Users/apple/Desktop/Programacion/gym-tracker",
    "projectType": "Expo Mobile App",
    "frameworks": [
      "React",
      "Expo",
      "TypeScript"
    ],
    "packageManager": "npm",
    "devCommand": "npm start",
    "buildCommand": null,
    "testCommand": null,
    "localUrl": "http://localhost:8081",
    "port": 8081,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789126Z",
    "diskSizeBytes": 1855952,
    "tags": [
      "react",
      "expo",
      "typescript"
    ],
    "createdAt": "2026-08-26T14:36:19.789126Z",
    "lastError": null
  },
  {
    "id": "proj-48cedaee",
    "name": "impostor-game",
    "path": "/Users/apple/Desktop/Programacion/impostor-game",
    "canonicalPath": "/Users/apple/Desktop/Programacion/impostor-game",
    "projectType": "Expo Mobile App",
    "frameworks": [
      "React",
      "Expo",
      "TypeScript"
    ],
    "packageManager": "npm",
    "devCommand": "npm start",
    "buildCommand": null,
    "testCommand": null,
    "localUrl": "http://localhost:8081",
    "port": 8081,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789144Z",
    "diskSizeBytes": 977330,
    "tags": [
      "react",
      "expo",
      "typescript"
    ],
    "createdAt": "2026-08-26T14:36:19.789144Z",
    "lastError": null
  },
  {
    "id": "proj-f1d876d7",
    "name": "music-lab",
    "path": "/Users/apple/Desktop/Programacion/music-lab",
    "canonicalPath": "/Users/apple/Desktop/Programacion/music-lab",
    "projectType": "Python App",
    "frameworks": [
      "Python",
      "FastAPI",
      "AI/ML"
    ],
    "packageManager": null,
    "devCommand": "uv run python main.py",
    "buildCommand": null,
    "testCommand": null,
    "localUrl": "http://localhost:8000",
    "port": 8000,
    "status": "running",
    "lastUsedAt": "2026-08-26T14:36:19.789192Z",
    "diskSizeBytes": 1861420203,
    "tags": [
      "python",
      "fastapi",
      "ai/ml"
    ],
    "createdAt": "2026-08-26T14:36:19.789192Z",
    "lastError": null
  },
  {
    "id": "proj-cf5682ad",
    "name": "networking",
    "path": "/Users/apple/Desktop/Programacion/networking",
    "canonicalPath": "/Users/apple/Desktop/Programacion/networking",
    "projectType": "Node.js",
    "frameworks": [
      "React",
      "Vite",
      "Tailwind"
    ],
    "packageManager": "pnpm",
    "devCommand": "pnpm dev",
    "buildCommand": "pnpm build",
    "testCommand": null,
    "localUrl": "http://localhost:5173",
    "port": 5173,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789215Z",
    "diskSizeBytes": 218101694,
    "tags": [
      "react",
      "vite",
      "tailwind"
    ],
    "createdAt": "2026-08-26T14:36:19.789215Z",
    "lastError": null
  },
  {
    "id": "proj-d9ff4b25",
    "name": "novenas-app",
    "path": "/Users/apple/Desktop/Programacion/novenas-app",
    "canonicalPath": "/Users/apple/Desktop/Programacion/novenas-app",
    "projectType": "Next.js App",
    "frameworks": [
      "React",
      "Next.js",
      "Tailwind",
      "TypeScript"
    ],
    "packageManager": "npm",
    "devCommand": "npm run dev",
    "buildCommand": "npm run build",
    "testCommand": null,
    "localUrl": "http://localhost:3000",
    "port": 3000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789232Z",
    "diskSizeBytes": 5462425,
    "tags": [
      "react",
      "next.js",
      "tailwind"
    ],
    "createdAt": "2026-08-26T14:36:19.789232Z",
    "lastError": null
  },
  {
    "id": "proj-bad04f23",
    "name": "portafolio",
    "path": "/Users/apple/Desktop/Programacion/portafolio",
    "canonicalPath": "/Users/apple/Desktop/Programacion/portafolio",
    "projectType": "Astro Site",
    "frameworks": [
      "Astro",
      "Tailwind",
      "TypeScript"
    ],
    "packageManager": "pnpm",
    "devCommand": "pnpm dev",
    "buildCommand": "pnpm build",
    "testCommand": "pnpm test",
    "localUrl": "http://localhost:4321",
    "port": 4321,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789250Z",
    "diskSizeBytes": 30556261,
    "tags": [
      "astro",
      "tailwind",
      "typescript"
    ],
    "createdAt": "2026-08-26T14:36:19.789250Z",
    "lastError": null
  },
  {
    "id": "proj-052a4a14",
    "name": "shainy",
    "path": "/Users/apple/Desktop/Programacion/shainy",
    "canonicalPath": "/Users/apple/Desktop/Programacion/shainy",
    "projectType": "Next.js App",
    "frameworks": [
      "React",
      "Next.js",
      "Tailwind",
      "TypeScript",
      "Docker"
    ],
    "packageManager": "npm",
    "devCommand": "npm run dev",
    "buildCommand": "npm run build",
    "testCommand": null,
    "localUrl": "http://localhost:3000",
    "port": 3000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789268Z",
    "diskSizeBytes": 4076295,
    "tags": [
      "react",
      "next.js",
      "tailwind"
    ],
    "createdAt": "2026-08-26T14:36:19.789268Z",
    "lastError": null
  },
  {
    "id": "proj-fa2a2658",
    "name": "vacs-backend",
    "path": "/Users/apple/Desktop/Programacion/vacs/vacs-backend",
    "canonicalPath": "/Users/apple/Desktop/Programacion/vacs/vacs-backend",
    "projectType": "NestJS Backend",
    "frameworks": [
      "NestJS",
      "TypeScript"
    ],
    "packageManager": "yarn",
    "devCommand": "yarn start",
    "buildCommand": "yarn run build",
    "testCommand": "yarn test",
    "localUrl": "http://localhost:3000",
    "port": 3000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789286Z",
    "diskSizeBytes": 1993778,
    "tags": [
      "nestjs",
      "typescript"
    ],
    "createdAt": "2026-08-26T14:36:19.789286Z",
    "lastError": null
  },
  {
    "id": "proj-ee142d14",
    "name": "vacs-device-api",
    "path": "/Users/apple/Desktop/Programacion/vacs/vacs-device-api",
    "canonicalPath": "/Users/apple/Desktop/Programacion/vacs/vacs-device-api",
    "projectType": "Python App",
    "frameworks": [
      "Python",
      "AI/ML"
    ],
    "packageManager": null,
    "devCommand": "python main.py",
    "buildCommand": null,
    "testCommand": null,
    "localUrl": null,
    "port": null,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789303Z",
    "diskSizeBytes": 276899748,
    "tags": [
      "python",
      "ai/ml"
    ],
    "createdAt": "2026-08-26T14:36:19.789303Z",
    "lastError": null
  },
  {
    "id": "proj-35a616f5",
    "name": "vacs-frontend",
    "path": "/Users/apple/Desktop/Programacion/vacs/vacs-frontend",
    "canonicalPath": "/Users/apple/Desktop/Programacion/vacs/vacs-frontend",
    "projectType": "Next.js App",
    "frameworks": [
      "React",
      "Next.js",
      "Tailwind",
      "TypeScript"
    ],
    "packageManager": "bun",
    "devCommand": "bun run dev",
    "buildCommand": "bun run build",
    "testCommand": null,
    "localUrl": "http://localhost:3000",
    "port": 3000,
    "status": "stopped",
    "lastUsedAt": "2026-08-26T14:36:19.789321Z",
    "diskSizeBytes": 2937503,
    "tags": [
      "react",
      "next.js",
      "tailwind"
    ],
    "createdAt": "2026-08-26T14:36:19.789321Z",
    "lastError": null
  }
]

const MOCK_PROJECTS_STORAGE_KEY = 'dev-command-center-projects'

function loadMockProjects(): Project[] {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(MOCK_PROJECTS_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
  }
  return [...mockProjects]
}

function persistMockProjects() {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(MOCK_PROJECTS_STORAGE_KEY, JSON.stringify(memoryProjects))
    } catch {}
  }
}

let memoryProjects = loadMockProjects()

const mockIdeSettings: IdeSettings = {
  tools: [
    { id: 'antigravity', label: 'Antigravity IDE', command: 'agy', available: true },
    { id: 'codex', label: 'Codex', command: 'codex', available: true },
  ],
}

export const mockLogs: Record<string, LogEntry[]> = {
  'proj-1': [
    { projectId: 'proj-1', stream: 'stdout', line: '➜  Local:   http://localhost:1420/', timestamp: new Date(Date.now() - 60000).toISOString() },
    { projectId: 'proj-1', stream: 'stdout', line: '➜  Network: use --host to expose', timestamp: new Date(Date.now() - 59000).toISOString() },
    { projectId: 'proj-1', stream: 'stdout', line: '9:19:09 AM [vite] (client) hmr update /src/App.css', timestamp: new Date(Date.now() - 40000).toISOString() },
    { projectId: 'proj-1', stream: 'stdout', line: '9:20:42 AM [vite] (client) hmr update /src/App.tsx', timestamp: new Date(Date.now() - 20000).toISOString() },
    { projectId: 'proj-1', stream: 'stdout', line: '✨ Dev Command Center running smoothly in background (PID 88567)', timestamp: new Date(Date.now() - 5000).toISOString() },
  ],
  'proj-2': [
    { projectId: 'proj-2', stream: 'stdout', line: 'INFO:     Started server process [61245]', timestamp: new Date(Date.now() - 120000).toISOString() },
    { projectId: 'proj-2', stream: 'stdout', line: 'INFO:     Waiting for application startup.', timestamp: new Date(Date.now() - 119000).toISOString() },
    { projectId: 'proj-2', stream: 'stdout', line: 'INFO:     Application startup complete.', timestamp: new Date(Date.now() - 118000).toISOString() },
    { projectId: 'proj-2', stream: 'stdout', line: 'INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)', timestamp: new Date(Date.now() - 117000).toISOString() },
    { projectId: 'proj-2', stream: 'stderr', line: 'DEBUG:    [RadarEngine] Polling futures feeds stream (32 markets active)', timestamp: new Date(Date.now() - 30000).toISOString() },
  ]
}

export const api = {
  listProjects: async (): Promise<Project[]> => {
    if (isTauri) return invoke<Project[]>('list_projects')
    return new Promise(res => setTimeout(() => res([...memoryProjects]), 50))
  },

  registerProject: async (path: string, name?: string, tags: string[] = []): Promise<Project> => {
    if (isTauri) return invoke<Project>('register_project', { request: { path, name: name || null, tags } })
    const folderName = name || path.split('/').filter(Boolean).pop() || 'nuevo-proyecto'
    const newProj: Project = {
      id: `proj-${Date.now()}`,
      name: folderName,
      path,
      canonicalPath: path,
      projectType: 'Web Project',
      frameworks: ['TypeScript', 'React'],
      packageManager: 'pnpm',
      devCommand: 'pnpm dev',
      buildCommand: 'pnpm build',
      testCommand: 'pnpm test',
      localUrl: 'http://localhost:3000',
      port: 3000,
      status: 'stopped',
      lastUsedAt: new Date().toISOString(),
      diskSizeBytes: 245000000,
      tags,
      createdAt: new Date().toISOString(),
      lastError: null,
    }
    memoryProjects.unshift(newProj)
    persistMockProjects()
    return newProj
  },

  unregisterProject: async (projectId: string): Promise<void> => {
    if (isTauri) return invoke<void>('unregister_project', { projectId })
    memoryProjects = memoryProjects.filter(p => p.id !== projectId)
    persistMockProjects()
  },

  getProjectDetail: async (projectId: string): Promise<ProjectDetail> => {
    if (isTauri) return invoke<ProjectDetail>('get_project_detail', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId) || memoryProjects[0]
    const defaultDeps = [
      { name: 'react', version: '^19.0.0', isDev: false, source: 'package.json' },
      { name: 'react-dom', version: '^19.0.0', isDev: false, source: 'package.json' },
      { name: 'lucide-react', version: '^1.16.0', isDev: false, source: 'package.json' },
      { name: '@tauri-apps/api', version: '^2.2.0', isDev: false, source: 'package.json' },
      { name: '@tauri-apps/plugin-dialog', version: '^2.2.0', isDev: false, source: 'package.json' },
      { name: '@tauri-apps/plugin-fs', version: '^2.2.0', isDev: false, source: 'package.json' },
      { name: 'typescript', version: '^5.7.2', isDev: true, source: 'package.json' },
      { name: 'vite', version: '^6.0.7', isDev: true, source: 'package.json' },
      { name: '@vitejs/plugin-react', version: '^4.3.4', isDev: true, source: 'package.json' },
      { name: 'vitest', version: '^2.1.8', isDev: true, source: 'package.json' },
    ]

    return {
      project: proj,
      scan: {
        projectType: proj.projectType,
        frameworks: proj.frameworks,
        packageManager: proj.packageManager,
        manifests: ['package.json', 'tsconfig.json'],
        lockfile: proj.packageManager ? `${proj.packageManager}-lock.yaml` : null,
        scripts: [
          { name: 'dev', command: proj.devCommand || 'pnpm dev', source: 'package.json' },
          { name: 'build', command: proj.buildCommand || 'pnpm build', source: 'package.json' },
          { name: 'test', command: proj.testCommand || 'pnpm test', source: 'package.json' },
          { name: 'lint', command: 'eslint .', source: 'package.json' },
          { name: 'typecheck', command: 'tsc --noEmit', source: 'package.json' },
        ],
        devCommand: proj.devCommand,
        buildCommand: proj.buildCommand,
        testCommand: proj.testCommand,
        localUrl: proj.localUrl,
        port: proj.port,
        declaredDependencies: defaultDeps.length,
        dependencies: defaultDeps,
        // Los tres estados del entorno, para poder verlos en modo navegador.
        installedDependencies: (proj.diskSizeBytes ?? 0) > 100_000_000,
        environmentDir:
          (proj.diskSizeBytes ?? 0) > 100_000_000
            ? proj.packageManager === 'pnpm' || proj.packageManager === 'npm'
              ? 'node_modules'
              : '.venv'
            : null,
        missingEnvironment:
          (proj.diskSizeBytes ?? 0) > 100_000_000
            ? []
            : [proj.packageManager === 'pip' || proj.packageManager === 'uv' ? '.venv' : 'node_modules'],
      },
      process:
        proj.status === 'running'
          ? {
              projectId: proj.id,
              pid: 88567,
              startedAt: new Date(Date.now() - 3600000).toISOString(),
              command: proj.devCommand || 'pnpm dev',
            }
          : null,
      recentCommands: [
        {
          id: 'cmd-1',
          projectId: proj.id,
          action: 'dev',
          command: proj.devCommand || 'pnpm dev',
          startedAt: new Date(Date.now() - 3600000).toISOString(),
          endedAt: null,
          exitCode: null,
          status: proj.status === 'running' ? 'running' : 'stopped',
          errorMessage: null,
        },
        {
          id: 'cmd-2',
          projectId: proj.id,
          action: 'build',
          command: proj.buildCommand || 'pnpm build',
          startedAt: new Date(Date.now() - 86400000).toISOString(),
          endedAt: new Date(Date.now() - 86400000 + 4200).toISOString(),
          exitCode: 0,
          status: 'completed',
          errorMessage: null,
        },
      ],
    }
  },

  refreshAllProjects: async (): Promise<Project[]> => {
    if (isTauri) return invoke<Project[]>('refresh_all_projects')
    return new Promise(res => setTimeout(() => res([...memoryProjects]), 300))
  },

  refreshProject: async (projectId: string): Promise<Project> => {
    if (isTauri) return invoke<Project>('refresh_project', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId) || memoryProjects[0]
    return proj
  },

  deleteProject: async (projectId: string, deleteFiles: boolean): Promise<void> => {
    if (isTauri) return invoke<void>('delete_project', { request: { projectId, deleteFiles } })
    const idx = memoryProjects.findIndex(p => p.id === projectId)
    if (idx !== -1) {
      memoryProjects.splice(idx, 1)
      persistMockProjects()
    }
  },

  togglePinProject: async (projectId: string, isPinned: boolean): Promise<boolean> => {
    if (isTauri) return invoke<boolean>('toggle_pin_project', { projectId, isPinned })
    const proj = memoryProjects.find(p => p.id === projectId)
    if (proj) {
      proj.isPinned = isPinned
      if (isPinned) proj.isArchived = false
      persistMockProjects()
    }
    return isPinned
  },

  toggleArchiveProject: async (projectId: string, isArchived: boolean): Promise<boolean> => {
    if (isTauri) return invoke<boolean>('toggle_archive_project', { projectId, isArchived })
    const proj = memoryProjects.find(p => p.id === projectId)
    if (proj) {
      proj.isArchived = isArchived
      if (isArchived) proj.isPinned = false
      persistMockProjects()
    }
    return isArchived
  },



  runProject: async (request: RunProjectRequest): Promise<ProcessInfo> => {
    if (isTauri) return invoke<ProcessInfo>('run_project', { request })
    const proj = memoryProjects.find(p => p.id === request.projectId)
    if (proj) proj.status = 'running'
    return {
      projectId: request.projectId,
      pid: Math.floor(10000 + Math.random() * 80000),
      startedAt: new Date().toISOString(),
      command: request.script || proj?.devCommand || 'pnpm dev',
    }
  },

  stopProject: async (projectId: string): Promise<void> => {
    if (isTauri) return invoke<void>('stop_project', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId)
    if (proj) proj.status = 'stopped'
  },

  restartProject: async (projectId: string): Promise<ProcessInfo> => {
    if (isTauri) return invoke<ProcessInfo>('restart_project', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId)
    if (proj) proj.status = 'running'
    return {
      projectId,
      pid: Math.floor(10000 + Math.random() * 80000),
      startedAt: new Date().toISOString(),
      command: proj?.devCommand || 'pnpm dev',
    }
  },

  getDiskReport: async (projectId: string): Promise<DiskReport> => {
    if (isTauri) return invoke<DiskReport>('get_disk_report', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId)
    const total = proj?.diskSizeBytes || 845200000
    return {
      projectId,
      totalBytes: total,
      entries: [
        { target: 'node_modules', label: 'node_modules', path: `${proj?.path}/node_modules`, bytes: Math.round(total * 0.62), regenerable: true },
        { target: 'target', label: 'target (Rust build)', path: `${proj?.path}/src-tauri/target`, bytes: Math.round(total * 0.25), regenerable: true },
        { target: 'dist', label: 'dist (Vite bundle)', path: `${proj?.path}/dist`, bytes: Math.round(total * 0.08), regenerable: true },
        { target: '.cache', label: '.cache', path: `${proj?.path}/.cache`, bytes: Math.round(total * 0.05), regenerable: true },
      ],
    }
  },

  previewCleanup: async (projectId: string): Promise<CleanupPreview> => {
    if (isTauri) return invoke<CleanupPreview>('preview_cleanup', { projectId })
    const report = await api.getDiskReport(projectId)
    return {
      projectId,
      totalBytes: report.totalBytes,
      entries: report.entries,
      dryRun: true,
    }
  },

  cleanProject: async (projectId: string, targets: string[]): Promise<string[]> => {
    if (isTauri) return invoke<string[]>('clean_project', { request: { projectId, targets, confirmed: true } })
    return targets
  },

  getIdeSettings: async (): Promise<IdeSettings> => {
    if (isTauri) return invoke<IdeSettings>('get_ide_settings')
    return { ...mockIdeSettings }
  },

  saveIdeSettings: async (settings: IdeSettings): Promise<IdeSettings> => {
    if (isTauri) return invoke<IdeSettings>('save_ide_settings', { settings })
    return settings
  },

  launchTool: async (projectId: string, toolId: string): Promise<void> => {
    if (isTauri) return invoke<void>('launch_project_tool', { projectId, toolId })
    console.log(`[Dev Command Center] Lanza herramienta '${toolId}' para proyecto ${projectId}`)
  },

  openProjectUrl: async (projectId: string): Promise<void> => {
    if (isTauri) return invoke<void>('open_project_url', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId)
    if (proj?.status !== 'running') {
      throw new Error('El proyecto no está en ejecución. Inicia el proyecto antes de abrir su URL.')
    }
    if (proj?.localUrl && typeof window !== 'undefined') {
      window.open(proj.localUrl, '_blank')
    }
  },

  openExternalUrl: async (url: string): Promise<void> => {
    if (isTauri) return invoke<void>('open_external_url', { url })
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  },

  inspectPort: async (projectId: string): Promise<PortInfo | null> => {
    if (isTauri) return invoke<PortInfo | null>('inspect_project_port', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId)
    if (!proj?.port) return null
    return { port: proj.port, pid: 88567, listening: proj.status === 'running' }
  },

  getGitHubStatus: async (customToken?: string): Promise<GitHubAccountStatus> => {
    if (isTauri) return invoke<GitHubAccountStatus>('get_github_status', { customToken: customToken || null })
    // La identidad de demo debe ser inconfundible: antes decía «Open Source
    // Developer», que parecía una cuenta real y se confundía con la propia.
    return {
      authenticated: true,
      username: 'demo',
      name: 'Cuenta de demostración (datos ficticios)',
      avatarUrl: null,
      totalRepos: 3,
      tokenPreview: 'sin token real',
    }
  },

  saveGitHubToken: async (_token: string): Promise<GitHubAccountStatus> => {
    if (isTauri) return invoke<GitHubAccountStatus>('save_github_token', { token: _token })
    // Fingir que se guardó un token real descarta un secreto en silencio y deja
    // creer que la app quedó vinculada. En modo demo hay que fallar de frente.
    throw new Error(
      'Modo demo: el token no se guarda ni se verifica porque no hay backend. Arranca la app con «pnpm tauri dev» para vincular tu cuenta de GitHub.'
    )
  },

  listGitHubRepos: async (customToken?: string): Promise<GitHubRepo[]> => {
    if (isTauri) return invoke<GitHubRepo[]>('list_github_repos', { customToken: customToken || null })
    return [
      {
        id: 1,
        name: 'web-dashboard',
        fullName: 'demo/web-dashboard',
        description: 'Modern developer dashboard workspace',
        htmlUrl: 'https://github.com/demo/web-dashboard',
        cloneUrl: 'https://github.com/demo/web-dashboard.git',
        isPrivate: false,
        language: 'TypeScript',
        stars: 128,
        forks: 14,
        updatedAt: '2026-08-25T18:00:00Z',
        defaultBranch: 'main',
        isCloned: true,
        localProjectId: 'proj-1',
        localPath: '/workspace/web-dashboard',
      },
      {
        id: 2,
        name: 'api-service',
        fullName: 'demo/api-service',
        description: 'High-performance microservices API',
        htmlUrl: 'https://github.com/demo/api-service',
        cloneUrl: 'https://github.com/demo/api-service.git',
        isPrivate: false,
        language: 'Python',
        stars: 45,
        forks: 5,
        updatedAt: '2026-08-26T12:00:00Z',
        defaultBranch: 'main',
        isCloned: false,
      },
      {
        id: 3,
        name: 'core-engine',
        fullName: 'demo/core-engine',
        description: 'Native Rust processing engine',
        htmlUrl: 'https://github.com/demo/core-engine',
        cloneUrl: 'https://github.com/demo/core-engine.git',
        isPrivate: false,
        language: 'Rust',
        stars: 350,
        forks: 42,
        updatedAt: '2026-08-20T10:00:00Z',
        defaultBranch: 'main',
        isCloned: false,
      },
    ]
  },

  cloneGitHubRepo: async (request: CloneRepoRequest): Promise<Project> => {
    if (isTauri) return invoke<Project>('clone_github_repo', { request })
    const targetDir = request.targetPath || `/workspace/${request.repoName}`
    const newProj: Project = {
      id: `proj-gh-${Date.now()}`,
      name: request.repoName,
      path: targetDir,
      canonicalPath: targetDir,
      projectType: 'Web Project',
      frameworks: ['TypeScript'],
      packageManager: 'pnpm',
      devCommand: 'pnpm dev',
      buildCommand: 'pnpm build',
      testCommand: null,
      localUrl: 'http://localhost:3000',
      port: 3000,
      status: 'stopped',
      lastUsedAt: new Date().toISOString(),
      diskSizeBytes: 120000000,
      tags: ['github'],
      createdAt: new Date().toISOString(),
      lastError: null,
    }
    memoryProjects.unshift(newProj)
    persistMockProjects()
    return newProj
  },

  safeOffloadProject: async (projectId: string, force = false): Promise<SafeOffloadResult> => {
    if (isTauri) return invoke<SafeOffloadResult>('safe_offload_project', { projectId, force })
    const proj = memoryProjects.find(p => p.id === projectId)
    memoryProjects = memoryProjects.filter(p => p.id !== projectId)
    persistMockProjects()
    return {
      success: true,
      projectId,
      projectName: proj?.name || projectId,
      message: 'Proyecto archivado y carpeta local liberada de forma segura.',
    }
  },

  getDefaultCloneDir: async (): Promise<string> => {
    if (isTauri) return invoke<string>('get_default_clone_dir')
    return '/workspace'
  },

  setDefaultCloneDir: async (path: string): Promise<string> => {
    if (isTauri) return invoke<string>('set_default_clone_dir', { path })
    return path
  },

  pickFolder: async (options?: { title?: string; defaultPath?: string }): Promise<string | null> => {
    if (isTauri) {
      try {
        return await invoke<string | null>('pick_folder', {
          title: options?.title || null,
          defaultPath: options?.defaultPath || null,
        })
      } catch (err) {
        console.warn('pick_folder invoke error:', err)
      }
    }
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker()
        if (handle && handle.name) {
          return `/Users/${handle.name}`
        }
      } catch {
        return null
      }
    }
    return null
  },

  getProjectGitStatus: async (projectId: string): Promise<GitStatusInfo> => {
    if (isTauri) return invoke<GitStatusInfo>('get_project_git_status', { projectId })
    const proj = memoryProjects.find(p => p.id === projectId)
    const isGithub = proj?.tags.includes('github') ?? false
    return {
      isRepo: true,
      currentBranch: 'main',
      remoteUrl: isGithub ? `https://github.com/MichaelTaboada2003/${proj?.name || 'repo'}.git` : null,
      remoteName: isGithub ? 'origin' : null,
      branches: ['main', 'feature/login'],
      remoteBranches: isGithub ? ['origin/main'] : [],
      uncommittedChanges: [
        { path: 'src/App.tsx', status: 'modified', staged: false },
        { path: 'src/App.css', status: 'modified', staged: false },
        { path: 'src/componentes/NuevoPanel.tsx', status: 'untracked', staged: false },
        { path: 'notas/borrador temporal.md', status: 'untracked', staged: false },
        { path: 'src/viejo.ts', status: 'deleted', staged: false },
      ],
      aheadCount: 1,
      behindCount: 0,
      lastCommitMessage: 'feat: add git integration',
      lastCommitHash: '211df35',
      lastCommitDate: 'hace 5 minutos',
      isClean: false,
    }
  },

  gitFetch: async (projectId: string): Promise<GitStatusInfo> => {
    if (isTauri) return invoke<GitStatusInfo>('project_git_fetch', { projectId })
    const actual = await api.getProjectGitStatus(projectId)
    return { ...actual, behindCount: 3, lastFetchAt: new Date().toISOString(), remoteBranches: ['origin/main', 'origin/feature/login'] }
  },

  gitPull: async (projectId: string): Promise<GitActionResult> => {
    if (isTauri) return invoke<GitActionResult>('project_git_pull', { projectId })
    return { success: true, message: 'Cambios descargados exitosamente (git pull).' }
  },

  gitPush: async (projectId: string): Promise<GitActionResult> => {
    if (isTauri) return invoke<GitActionResult>('project_git_push', { projectId })
    return { success: true, message: 'Commits subidos a GitHub exitosamente (git push).' }
  },

  gitCommit: async (projectId: string, message: string, files: string[]): Promise<GitActionResult> => {
    if (isTauri) return invoke<GitActionResult>('project_git_commit', { projectId, message, files })
    const cuantos = files.length === 1 ? '1 archivo' : `${files.length} archivos`
    return { success: true, message: `Commit creado en local con ${cuantos}: 3f8a1c2 ${message}`, output: `3f8a1c2 ${message}` }
  },

  gitCommitAndPush: async (projectId: string, message: string): Promise<GitActionResult> => {
    if (isTauri) return invoke<GitActionResult>('project_git_commit_and_push', { projectId, message })
    return { success: true, message: 'Commit creado y subido a GitHub exitosamente.' }
  },

  publishToGitHub: async (request: PublishToGitHubRequest): Promise<GitActionResult> => {
    if (isTauri) return invoke<GitActionResult>('publish_project_to_github', { request })
    const proj = memoryProjects.find(p => p.id === request.projectId)
    if (proj && !proj.tags.includes('github')) proj.tags.push('github')
    return {
      success: true,
      message: `¡Proyecto publicado con éxito en GitHub!: https://github.com/usuario/${request.repoName}`,
      output: `https://github.com/usuario/${request.repoName}`,
    }
  },
}
