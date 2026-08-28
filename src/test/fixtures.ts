/** Datos de prueba compartidos. Un proyecto y un estado de git realistas, con
 *  los campos que de verdad usan los componentes. */
import type { GitStatusInfo, Project, ProjectDetail } from '../types'

export function proyecto(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'panel-web',
    path: '/proyectos/panel-web',
    canonicalPath: '/proyectos/panel-web',
    projectType: 'Next.js App',
    frameworks: ['React', 'Next.js'],
    packageManager: 'pnpm',
    devCommand: 'pnpm run dev',
    buildCommand: 'pnpm run build',
    testCommand: null,
    localUrl: 'http://localhost:3000',
    port: 3000,
    status: 'stopped',
    lastUsedAt: '2026-01-01T10:00:00Z',
    diskSizeBytes: 1024 * 1024,
    tags: [],
    createdAt: '2026-01-01T10:00:00Z',
    lastError: null,
    kind: 'service',
    ...overrides,
  }
}

export function estadoGit(overrides: Partial<GitStatusInfo> = {}): GitStatusInfo {
  return {
    isRepo: true,
    currentBranch: 'main',
    remoteUrl: 'https://github.com/usuario/panel-web.git',
    remoteName: 'origin',
    branches: ['main'],
    remoteBranches: ['origin/main'],
    uncommittedChanges: [
      { path: 'src/App.tsx', status: 'modified', staged: false },
      { path: 'notas/borrador temporal.md', status: 'untracked', staged: false },
      { path: 'src/viejo.ts', status: 'deleted', staged: false },
    ],
    aheadCount: 0,
    behindCount: 0,
    lastCommitMessage: 'feat: primera versión',
    lastCommitHash: 'abc1234',
    lastCommitDate: 'hace 5 minutos',
    isClean: false,
    ...overrides,
  }
}

/** Detalle mínimo pero completo para montar la vista del proyecto. */
export function detalle(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  const base = proyecto(overrides.project ? {} : {})
  return {
    project: overrides.project ?? base,
    scan: {
      projectType: 'Next.js App',
      kind: 'service',
      frameworks: ['Next.js'],
      packageManager: 'pnpm',
      manifests: ['package.json'],
      lockfile: 'pnpm-lock.yaml',
      scripts: [
        { name: 'dev', command: 'pnpm run dev', source: 'package.json' },
        { name: 'build', command: 'pnpm run build', source: 'package.json' },
      ],
      devCommand: 'pnpm run dev',
      buildCommand: 'pnpm run build',
      testCommand: null,
      localUrl: 'http://localhost:3000',
      port: 3000,
      declaredDependencies: 12,
      dependencies: [],
      installedDependencies: true,
      ...overrides.scan,
    },
    process: null,
    recentCommands: [],
    ...overrides,
  }
}
