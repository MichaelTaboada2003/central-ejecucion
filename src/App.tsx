import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle, AppWindow, ArrowLeft, ArrowUpRight, Bot, Box, Check,
  ChevronRight, CircleStop, Cloud, CloudOff, Command, Copy, Database,
  DownloadCloud, FileCode2, FolderOpen, GitFork, Globe, HardDrive, Layers,
  LayoutDashboard, LoaderCircle, Lock, PackageOpen, Play, Plus, Radio,
  RefreshCw, RotateCcw, Search, Settings2, ShieldCheck, SquareTerminal,
  Star, Terminal, Trash2, Wrench, X,
} from 'lucide-react'
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, isTauri, mockLogs } from './api'
import type {
  CleanupPreview, DiskReport, GitHubAccountStatus, GitHubRepo,
  IdeSettings, LogEntry, ProcessInfo, Project, ProjectDetail, ProjectStatus,
} from './types'
import './App.css'

type Tab = 'summary' | 'processes' | 'dependencies' | 'disk' | 'scripts' | 'configuration'
type Modal = 'register' | 'settings' | 'palette' | null

const statusLabels: Record<ProjectStatus, string> = {
  running: 'En ejecución',
  stopped: 'Detenido',
  starting: 'Iniciando…',
  error: 'Requiere atención',
}

function GitHubLogo({ size = 16, className = '', color = 'currentColor' }: { size?: number; className?: string; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'summary', label: 'Resumen', icon: LayoutDashboard },
  { id: 'processes', label: 'Procesos y logs', icon: Terminal },
  { id: 'dependencies', label: 'Dependencias', icon: PackageOpen },
  { id: 'disk', label: 'Disco y limpieza', icon: HardDrive },
  { id: 'scripts', label: 'Scripts', icon: FileCode2 },
  { id: 'configuration', label: 'Configuración', icon: Settings2 },
]

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [tab, setTab] = useState<Tab>('summary')
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [modal, setModal] = useState<Modal>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [disk, setDisk] = useState<DiskReport | null>(null)
  const [cleanup, setCleanup] = useState<CleanupPreview | null>(null)
  const [ideSettings, setIdeSettings] = useState<IdeSettings | null>(null)
  const [viewMode, setViewMode] = useState<'local' | 'github'>('local')
  const [githubStatus, setGithubStatus] = useState<GitHubAccountStatus | null>(null)
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([])
  const [loadingGithub, setLoadingGithub] = useState(false)
  const [offloadCandidate, setOffloadCandidate] = useState<Project | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const loadProjects = useCallback(async (preserveSelection = true) => {
    try {
      const next = await api.listProjects()
      setProjects(next)
      if (!preserveSelection && next[0]) setSelectedId(next[0].id)
    } catch (error) {
      showError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadGitHub = useCallback(async () => {
    setLoadingGithub(true)
    try {
      const status = await api.getGitHubStatus()
      setGithubStatus(status)
      if (status.authenticated) {
        const repos = await api.listGitHubRepos()
        setGithubRepos(repos)
      }
    } catch (error) {
      console.warn('No se pudo cargar estado de GitHub:', error)
    } finally {
      setLoadingGithub(false)
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const next = await api.getProjectDetail(id)
      setDetail(next)
    } catch (error) {
      setDetail(null)
      setSelectedId(null)
      await loadProjects(true)
      const message = error instanceof Error ? error.message : String(error)
      setNotice({ kind: 'info', text: message })
    }
  }, [loadProjects])

  useEffect(() => {
    void loadProjects(false)
    void loadGitHub()
  }, [loadProjects, loadGitHub])

  useEffect(() => {
    const handler = (event: Event) =>
      setNotice({ kind: 'error', text: (event as CustomEvent<string>).detail })
    window.addEventListener('dev-command-error', handler)
    return () => window.removeEventListener('dev-command-error', handler)
  }, [])

  useEffect(() => {
    if (selectedId) {
      setTab('summary')
      setLogs([])
      setDisk(null)
      void loadDetail(selectedId)
    } else {
      setDetail(null)
      setDisk(null)
    }
  }, [selectedId, loadDetail])

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setModal('palette')
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setModal('register')
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    if (isTauri) {
      void listen<LogEntry>('project://log', ({ payload }) => {
        if (payload.projectId === selectedId) {
          setLogs(current => [...current.slice(-499), payload])
        }
      }).then(value => {
        unlisten = value
      })
    } else if (selectedId && mockLogs[selectedId]) {
      setLogs(mockLogs[selectedId])
    }
    return () => unlisten?.()
  }, [selectedId])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    if (isTauri) {
      void listen('project://status', () => {
        void loadProjects()
        if (selectedId) void loadDetail(selectedId)
      }).then(value => {
        unlisten = value
      })
    }
    return () => unlisten?.()
  }, [loadDetail, loadProjects, selectedId])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadProjects(true)
    }, 6000)
    const onFocus = () => {
      void loadProjects(true)
      if (selectedId) void loadDetail(selectedId)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [loadProjects, loadDetail, selectedId])

  const visibleProjects = useMemo(() => {
    return projects.filter(project => {
      const haystack = `${project.name} ${project.path} ${project.projectType} ${project.frameworks.join(' ')} ${project.tags.join(' ')}`.toLowerCase()
      return haystack.includes(filter.toLowerCase()) && (statusFilter === 'all' || project.status === statusFilter)
    })
  }, [filter, projects, statusFilter])

  const stats = useMemo(
    () => ({
      running: projects.filter(project => project.status === 'running').length,
      stopped: projects.filter(project => project.status === 'stopped').length,
      error: projects.filter(project => project.status === 'error').length,
    }),
    [projects]
  )

  const action = async (name: string, operation: () => Promise<unknown>) => {
    setBusy(name)
    try {
      await operation()
      await loadProjects()
      if (selectedId) await loadDetail(selectedId)
    } catch (error) {
      showError(error)
    } finally {
      setBusy(null)
    }
  }

  const handleRun = (
    actionName: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script',
    script?: string
  ) => {
    if (!detail) return
    return action(`run:${actionName}`, async () => {
      await api.runProject({
        projectId: detail.project.id,
        action: actionName,
        script,
      })
      if (actionName === 'install') {
        await api.refreshProject(detail.project.id)
        await loadDetail(detail.project.id)
        setNotice({ kind: 'success', text: 'Dependencias instaladas con éxito. Ya puedes iniciar el servidor.' })
      } else {
        setNotice({ kind: 'success', text: `Comando '${actionName}' iniciado con éxito.` })
      }
    })
  }

  const handleQuickRun = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    return action(`run:quick:${project.id}`, async () => {
      await api.runProject({ projectId: project.id, action: 'dev' })
      setNotice({ kind: 'success', text: `Iniciado ${project.name}` })
    })
  }

  const handleQuickStop = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    return action(`stop:quick:${project.id}`, async () => {
      await api.stopProject(project.id)
      setNotice({ kind: 'success', text: `Detenido ${project.name}` })
    })
  }

  const handleUnregister = (projectId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const proj = projects.find(p => p.id === projectId)
    const name = proj?.name || 'este proyecto'
    if (!window.confirm(`¿Deseas desvincular «${name}» del Centro de Mando?\n\n(No se eliminarán archivos en el disco, solo se quitará de la lista).`)) {
      return
    }
    return action(`unregister:${projectId}`, async () => {
      await api.unregisterProject(projectId)
      if (selectedId === projectId) {
        setSelectedId(null)
      }
      await loadProjects(true)
      setNotice({ kind: 'success', text: `Proyecto «${name}» desvinculado con éxito.` })
    })
  }

  const handleRefresh = () =>
    detail &&
    action('refresh', async () => {
      await api.refreshProject(detail.project.id)
      setNotice({ kind: 'success', text: 'Metadatos y uso de disco actualizados.' })
    })

  const handleDisk = useCallback(async () => {
    if (!detail) return
    setBusy('disk')
    try {
      const report = await api.getDiskReport(detail.project.id)
      setDisk(report)
    } catch (error) {
      showError(error)
    } finally {
      setBusy(null)
    }
  }, [detail])

  const previewCleanup = () =>
    detail && action('preview', async () => setCleanup(await api.previewCleanup(detail.project.id)))

  const performCleanup = (targets: string[]) =>
    detail &&
    action('cleanup', async () => {
      const deleted = await api.cleanProject(detail.project.id, targets)
      setCleanup(null)
      setDisk(await api.getDiskReport(detail.project.id))
      setNotice({ kind: 'success', text: `${deleted.length} directorio(s) regenerable(s) eliminado(s).` })
    })

  const launchTool = (tool: string) =>
    detail && action(`tool:${tool}`, () => api.launchTool(detail.project.id, tool))

  const refreshSettings = async () => {
    const settings = await api.getIdeSettings()
    setIdeSettings(settings)
    setModal('settings')
  }

  const register = async (path: string, name: string, tags: string[]) => {
    await action('register', async () => {
      const project = await api.registerProject(path, name, tags)
      setSelectedId(project.id)
      setModal(null)
      setNotice({ kind: 'success', text: `${project.name} quedó registrado localmente.` })
    })
  }

  const handleCloneRepo = (repo: GitHubRepo) => {
    return action(`clone:${repo.name}`, async () => {
      const project = await api.cloneGitHubRepo({
        repoName: repo.name,
        cloneUrl: repo.cloneUrl,
        isPrivate: repo.isPrivate,
      })
      await loadProjects(true)
      await loadGitHub()
      setSelectedId(project.id)
      setViewMode('local')
      setNotice({ kind: 'success', text: `Repositorio «${repo.name}» clonado y registrado exitosamente.` })
    })
  }

  const handleSafeOffload = (repo: GitHubRepo) => {
    const proj = projects.find(p => p.id === repo.localProjectId || p.name.toLowerCase() === repo.name.toLowerCase())
    if (proj) {
      setOffloadCandidate(proj)
    } else {
      setNotice({ kind: 'error', text: 'No se encontró el proyecto local asociado.' })
    }
  }

  const performSafeOffload = (candidate: Project, force: boolean) => {
    return action(`offload:${candidate.id}`, async () => {
      const result = await api.safeOffloadProject(candidate.id, force)
      setOffloadCandidate(null)
      if (selectedId === candidate.id) {
        setSelectedId(null)
      }
      await loadProjects(true)
      await loadGitHub()
      setNotice({ kind: 'success', text: result.message })
    })
  }

  const handleSaveGitHubToken = async (token: string) => {
    const status = await api.saveGitHubToken(token)
    setGithubStatus(status)
    if (status.authenticated) {
      const repos = await api.listGitHubRepos(token)
      setGithubRepos(repos)
    }
  }

  const isGitHubConnected = useCallback(
    (project: Project) => {
      if (project.tags.includes('github')) return true
      return githubRepos.some(
        r =>
          (r.localProjectId && r.localProjectId === project.id) ||
          (r.localPath && r.localPath === project.canonicalPath) ||
          r.name.toLowerCase() === project.name.toLowerCase()
      )
    },
    [githubRepos]
  )

  const getGitHubRepo = useCallback(
    (project: Project) => {
      return githubRepos.find(
        r =>
          (r.localProjectId && r.localProjectId === project.id) ||
          (r.localPath && r.localPath === project.canonicalPath) ||
          r.name.toLowerCase() === project.name.toLowerCase()
      )
    },
    [githubRepos]
  )

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Command size={18} />
          </div>
          <div className="brand-text">
            <strong>Dev Command</strong>
            <span>Center</span>
          </div>
          <span className="brand-version">v0.1.0</span>
        </div>

        <button className="add-project" onClick={() => setModal('register')}>
          <Plus size={16} /> Registrar proyecto <kbd>⌘N</kbd>
        </button>

        <nav className="nav-group" aria-label="Navegación principal">
          <button
            className={viewMode === 'local' && !selectedId ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setSelectedId(null)
              setViewMode('local')
            }}
          >
            <LayoutDashboard size={16} /> Panel Local
          </button>
          <button
            className={viewMode === 'github' && !selectedId ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setSelectedId(null)
              setViewMode('github')
            }}
          >
            <GitHubLogo size={16} /> GitHub Cloud Hub
            {githubStatus?.totalRepos ? (
              <span className="badge-count" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--bg-surface-2)', padding: '2px 7px', borderRadius: 10, color: 'var(--accent-cyan)' }}>
                {githubStatus.totalRepos}
              </span>
            ) : null}
          </button>
        </nav>

        <section className="project-nav">
          <div className="nav-heading">
            <span>PROYECTOS</span>
            <span>{projects.length}</span>
          </div>
          <div className="project-list">
            {projects.map(project => {
              const onGithub = isGitHubConnected(project)
              return (
                <button
                  className={`project-nav-item ${selectedId === project.id ? 'selected' : ''}`}
                  key={project.id}
                  onClick={() => {
                    setSelectedId(project.id)
                    setViewMode('local')
                  }}
                  title={`${project.name} · ${onGithub ? 'Sincronizado con GitHub' : 'Solo en almacenamiento local'}`}
                >
                  <StatusDot status={project.status} />
                  <span className="project-nav-name">{project.name}</span>
                  {onGithub ? (
                    <GitHubLogo size={13} color="var(--accent-cyan)" className="github-indicator-icon" />
                  ) : (
                    <HardDrive size={12} color="var(--text-tertiary)" className="local-indicator-icon" />
                  )}
                  {project.status === 'error' && <AlertTriangle size={13} color="var(--accent-rose)" />}
                </button>
              )
            })}
          </div>
        </section>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => void refreshSettings()}>
            <Settings2 size={16} /> Ajustes y Token
          </button>
          <div className="local-first-card">
            <CloudOff size={16} />
            <div>
              <strong>On-Demand Workspaces</strong>
              <small>SQLite local · GitHub Cloud</small>
            </div>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="system-status-chip">
              <Database size={13} color="var(--accent-primary)" />
              <span>SQLite Conectado</span>
            </div>
            {githubStatus?.authenticated ? (
              <div
                className="system-status-chip github"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setSelectedId(null)
                  setViewMode('github')
                }}
                title="Ver repositorios en GitHub Cloud Hub"
              >
                <GitHubLogo size={13} color="var(--accent-cyan)" />
                <span>GitHub: @{githubStatus.username} ({githubStatus.totalRepos} repos)</span>
              </div>
            ) : (
              <div
                className="system-status-chip"
                style={{ cursor: 'pointer', opacity: 0.7 }}
                onClick={() => void refreshSettings()}
                title="Configurar conexión con GitHub"
              >
                <GitHubLogo size={13} />
                <span>Vincular GitHub</span>
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <div className="search">
              <Search size={15} />
              <input
                ref={searchRef}
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder="Buscar proyectos, stacks o etiquetas…"
                aria-label="Buscar proyectos"
              />
              <kbd>⌘F</kbd>
            </div>
            <button className="command-button" onClick={() => setModal('palette')}>
              <Command size={14} /> Comandos <kbd>⌘K</kbd>
            </button>
            <button className="avatar" aria-label="Ajustes" onClick={() => void refreshSettings()}>
              DC
            </button>
          </div>
        </header>

        <div className="content">
          {loading ? (
            <LoadingScreen />
          ) : detail ? (
            <ProjectWorkspace
              detail={detail}
              gitHubRepo={getGitHubRepo(detail.project)}
              tab={tab}
              setTab={setTab}
              logs={logs}
              setLogs={setLogs}
              disk={disk}
              busy={busy}
              onBack={() => setSelectedId(null)}
              onRun={handleRun}
              onStop={() => action('stop', () => api.stopProject(detail.project.id))}
              onRestart={() => action('restart', () => api.restartProject(detail.project.id))}
              onRefresh={handleRefresh}
              onDisk={handleDisk}
              onPreviewCleanup={previewCleanup}
              onLaunchTool={launchTool}
              onOpenUrl={() => action('url', () => api.openProjectUrl(detail.project.id))}
              onUnregister={handleUnregister}
              onNotify={(text, kind) => setNotice({ kind, text })}
            />
          ) : viewMode === 'github' ? (
            <GitHubHubView
              status={githubStatus}
              repos={githubRepos}
              loading={loadingGithub}
              onRefresh={loadGitHub}
              onClone={handleCloneRepo}
              onOpenLocal={id => {
                setSelectedId(id)
                setViewMode('local')
              }}
              onSafeOffload={handleSafeOffload}
              onOpenSettings={() => void refreshSettings()}
              busy={busy}
            />
          ) : (
            <Dashboard
              projects={visibleProjects}
              stats={stats}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              isGitHubConnected={isGitHubConnected}
              onSelect={id => {
                setSelectedId(id)
                setViewMode('local')
              }}
              onRegister={() => setModal('register')}
              onQuickRun={handleQuickRun}
              onQuickStop={handleQuickStop}
              onUnregister={handleUnregister}
              busy={busy}
            />
          )}
        </div>
      </section>

      {notice && (
        <div className={`toast ${notice.kind}`} role="status">
          {notice.kind === 'success' ? (
            <Check size={16} color="var(--accent-primary)" />
          ) : notice.kind === 'info' ? (
            <Radio size={16} color="var(--accent-cyan)" />
          ) : (
            <AlertTriangle size={16} color="var(--accent-rose)" />
          )}
          <span>{notice.text}</span>
          <button aria-label="Cerrar mensaje" onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}

      {offloadCandidate && (
        <SafeOffloadModal
          candidate={offloadCandidate}
          onClose={() => setOffloadCandidate(null)}
          onConfirm={performSafeOffload}
          busy={busy === `offload:${offloadCandidate.id}`}
        />
      )}

      {modal === 'register' && (
        <RegisterModal
          busy={busy === 'register'}
          onClose={() => setModal(null)}
          onSubmit={register}
        />
      )}

      {modal === 'settings' && (
        <SettingsModal
          settings={ideSettings}
          githubStatus={githubStatus}
          onClose={() => setModal(null)}
          onSaveIde={async settings => {
            await action('settings', async () => {
              const saved = await api.saveIdeSettings(settings)
              setIdeSettings(saved)
              setNotice({ kind: 'success', text: 'Configuración de herramientas guardada.' })
              setModal(null)
            })
          }}
          onSaveGitHubToken={handleSaveGitHubToken}
        />
      )}

      {modal === 'palette' && (
        <Palette
          onClose={() => setModal(null)}
          onRegister={() => setModal('register')}
          onSettings={() => void refreshSettings()}
          onDashboard={() => {
            setSelectedId(null)
            setModal(null)
          }}
        />
      )}

      {cleanup && (
        <CleanupModal
          preview={cleanup}
          onClose={() => setCleanup(null)}
          onConfirm={performCleanup}
          busy={busy === 'cleanup'}
        />
      )}
    </main>
  )
}

function ProjectWorkspace({
  detail,
  gitHubRepo,
  tab,
  setTab,
  logs,
  setLogs,
  disk,
  busy,
  onBack,
  onRun,
  onStop,
  onRestart,
  onRefresh,
  onDisk,
  onPreviewCleanup,
  onLaunchTool,
  onOpenUrl,
  onUnregister,
  onNotify,
}: {
  detail: ProjectDetail
  gitHubRepo?: GitHubRepo
  tab: Tab
  setTab: (tab: Tab) => void
  logs: LogEntry[]
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>
  disk: DiskReport | null
  busy: string | null
  onBack: () => void
  onRun: (
    action: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script',
    script?: string
  ) => Promise<void> | undefined
  onStop: () => void
  onRestart: () => void
  onRefresh: () => void
  onDisk: () => void
  onPreviewCleanup: () => void
  onLaunchTool: (tool: string) => void
  onOpenUrl: () => void
  onUnregister: (projectId: string) => void
  onNotify: (text: string, kind: 'success' | 'error') => void
}) {
  const { project, scan, process, recentCommands } = detail
  const isRunning = project.status === 'running'
  const isMissingDeps = !scan.installedDependencies && scan.declaredDependencies > 0
  const toolButtons = [
    ['finder', 'Finder', FolderOpen],
    ['terminal', 'Terminal', SquareTerminal],
    ['antigravity', 'Antigravity IDE', AppWindow],
    ['codex', 'Codex', Bot],
  ] as const

  return (
    <>
      <div className="project-header">
        <div className="breadcrumb">
          <button className="breadcrumb-back" onClick={onBack}>
            <ArrowLeft size={14} /> Dashboard
          </button>
          <ChevronRight size={14} />
          <strong>{project.name}</strong>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={onRefresh} disabled={!!busy}>
            <RefreshCw size={15} className={busy === 'refresh' ? 'spin' : ''} /> Actualizar
          </button>
          {project.localUrl && (
            <button
              className="secondary"
              onClick={onOpenUrl}
              disabled={!isRunning || !!busy}
              title={isRunning ? `Abrir ${project.localUrl}` : 'El proyecto debe estar en ejecución para abrir la URL'}
              style={{ opacity: isRunning ? 1 : 0.45, cursor: isRunning ? 'pointer' : 'not-allowed' }}
            >
              <ArrowUpRight size={15} /> Abrir {project.localUrl}
            </button>
          )}
          <button
            className="danger-outline"
            onClick={() => onUnregister(project.id)}
            disabled={!!busy}
            title="Desvincular proyecto de la lista"
          >
            <Trash2 size={15} /> Desvincular
          </button>
        </div>
      </div>

      <div className="project-title">
        <div>
          <div className="stack-icon">
            <Terminal size={24} />
          </div>
          <div>
            <h1>{project.name}</h1>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{project.projectType}</span>
              <span>·</span>
              {gitHubRepo ? (
                <a
                  href={gitHubRepo.htmlUrl || `https://github.com/MichaelTaboada2003/${project.name}`}
                  target="_blank"
                  rel="noreferrer"
                  className="github-link-pill"
                  title="Abrir repositorio en GitHub"
                >
                  <GitHubLogo size={13} color="var(--accent-cyan)" />
                  <span>GitHub: {gitHubRepo.fullName || `MichaelTaboada2003/${project.name}`}</span>
                  <ArrowUpRight size={12} />
                </a>
              ) : project.tags.includes('github') ? (
                <a
                  href={`https://github.com/MichaelTaboada2003/${project.name}`}
                  target="_blank"
                  rel="noreferrer"
                  className="github-link-pill"
                  title="Abrir repositorio en GitHub"
                >
                  <GitHubLogo size={13} color="var(--accent-cyan)" />
                  <span>GitHub</span>
                  <ArrowUpRight size={12} />
                </a>
              ) : (
                <span className="local-only-pill" title="Proyecto almacenado únicamente en este equipo local">
                  <HardDrive size={13} color="var(--text-tertiary)" />
                  <span>Solo Local</span>
                </span>
              )}
              <span>·</span>
              <code>{project.path}</code>
            </p>
          </div>
        </div>
        <div className="run-actions">
          {isRunning ? (
            <>
              <button className="danger-outline" disabled={!!busy} onClick={onStop}>
                <CircleStop size={16} /> Detener
              </button>
              <button className="primary" disabled={!!busy} onClick={onRestart}>
                <RotateCcw size={16} /> Reiniciar
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={!!busy || !scan.devCommand || isMissingDeps}
              onClick={() => void onRun('dev')}
              title={
                isMissingDeps
                  ? 'Primero instala las dependencias para desbloquear este botón'
                  : !scan.devCommand
                  ? 'No hay comando de desarrollo detectado'
                  : 'Iniciar Dev Server'
              }
              style={{
                opacity: isMissingDeps ? 0.45 : 1,
                cursor: isMissingDeps ? 'not-allowed' : 'pointer',
              }}
            >
              {busy === 'run:dev' ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              Iniciar Dev Server
            </button>
          )}
        </div>
      </div>

      <div className="status-strip">
        <StatusPill status={project.status} />
        {process && (
          <>
            <span className="divider" />
            <span>
              PID: <strong>{process.pid}</strong>
            </span>
          </>
        )}
        {project.port && (
          <>
            <span className="divider" />
            <span>
              Puerto: <strong>:{project.port}</strong>
            </span>
          </>
        )}
        <span className="divider" />
        <span>Última actividad: {formatDate(project.lastUsedAt || project.createdAt)}</span>
      </div>

      {isMissingDeps && !isRunning && (
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            padding: '14px 20px',
            marginTop: '16px',
            marginBottom: '20px',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            background: 'rgba(239, 68, 68, 0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AlertTriangle size={20} color="var(--accent-rose, #ef4444)" />
            <div>
              <strong style={{ color: 'var(--text-primary)', display: 'block', fontSize: '0.925rem' }}>
                Dependencias pendientes de instalación
              </strong>
              <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                Este proyecto tiene {scan.declaredDependencies} dependencias declaradas. Instálalas primero para desbloquear el servidor de desarrollo.
              </span>
            </div>
          </div>
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => void onRun('install')}
            style={{ whiteSpace: 'nowrap' }}
          >
            {busy === 'run:install' ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <PackageOpen size={15} />
            )}
            Instalar
          </button>
        </div>
      )}

      <div className="tool-row">
        {toolButtons.map(([id, label, Icon]) => (
          <button key={id} onClick={() => onLaunchTool(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            role="tab"
            aria-selected={tab === id}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <SummaryTab
          project={project}
          scan={scan}
          process={process}
          recentCommands={recentCommands}
          onRun={onRun}
          onNotify={onNotify}
        />
      )}
      {tab === 'processes' && (
        <ProcessesTab
          project={project}
          logs={logs}
          setLogs={setLogs}
          process={process}
          onNotify={onNotify}
        />
      )}
      {tab === 'dependencies' && <DependenciesTab scan={scan} onRun={onRun} busy={busy} />}
      {tab === 'disk' && (
        <DiskTab disk={disk} onLoad={onDisk} onPreviewCleanup={onPreviewCleanup} busy={busy} />
      )}
      {tab === 'scripts' && <ScriptsTab scripts={scan.scripts} onRun={onRun} busy={busy} />}
      {tab === 'configuration' && <ConfigurationTab project={project} scan={scan} onNotify={onNotify} />}
    </>
  )
}

function Dashboard({
  projects,
  stats,
  statusFilter,
  setStatusFilter,
  isGitHubConnected,
  onSelect,
  onRegister,
  onQuickRun,
  onQuickStop,
  onUnregister,
  busy,
}: {
  projects: Project[]
  stats: { running: number; stopped: number; error: number }
  statusFilter: ProjectStatus | 'all'
  setStatusFilter: (value: ProjectStatus | 'all') => void
  isGitHubConnected: (project: Project) => boolean
  onSelect: (id: string) => void
  onRegister: () => void
  onQuickRun: (project: Project, e: React.MouseEvent) => void
  onQuickStop: (project: Project, e: React.MouseEvent) => void
  onUnregister: (projectId: string, e: React.MouseEvent) => void
  busy: string | null
}) {
  return (
    <>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">CENTRO DE MANDO</p>
          <h1>Panel de Control</h1>
          <p>Supervisa, ejecuta y optimiza tus entornos locales de desarrollo.</p>
        </div>
        <button className="primary" onClick={onRegister}>
          <Plus size={16} /> Registrar proyecto
        </button>
      </div>

      <section className="stat-grid">
        <StatCard
          label="En ejecución"
          value={stats.running}
          status="running"
          icon={<Play size={18} />}
        />
        <StatCard
          label="Detenidos"
          value={stats.stopped}
          status="stopped"
          icon={<CircleStop size={18} />}
        />
        <StatCard
          label="Requieren atención"
          value={stats.error}
          status="error"
          icon={<AlertTriangle size={18} />}
        />
        <StatCard
          label="Total de proyectos"
          value={projects.length}
          status="neutral"
          icon={<Layers size={18} />}
        />
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <h2>Proyectos Registrados</h2>
            <p>
              {projects.length
                ? `${projects.length} proyecto(s) listados en SQLite local`
                : 'Sin proyectos registrados todavía'}
            </p>
          </div>
          <div className="filter-group">
            {(['all', 'running', 'stopped', 'error'] as const).map(status => (
              <button
                className={statusFilter === status ? 'active' : ''}
                key={status}
                onClick={() => setStatusFilter(status)}
              >
                {status === 'all' ? 'Todos' : statusLabels[status]}
              </button>
            ))}
          </div>
        </div>

        {projects.length ? (
          <div className="project-table" role="table">
            <div className="table-head" role="row">
              <span>Proyecto</span>
              <span>Stack / Frameworks</span>
              <span>Estado</span>
              <span>Puerto</span>
              <span>Disco</span>
              <span />
            </div>
            {projects.map(project => {
              const isRunning = project.status === 'running'
              const onGithub = isGitHubConnected(project)
              return (
                <div
                  className="table-row"
                  key={project.id}
                  onClick={() => onSelect(project.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="project-cell">
                    <span className="mini-icon">
                      <Terminal size={17} />
                    </span>
                    <span className="project-info">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong>{project.name}</strong>
                        {onGithub ? (
                          <span className="github-tag-badge" title="Proyecto vinculado a GitHub">
                            <GitHubLogo size={11} color="var(--accent-cyan)" /> GitHub
                          </span>
                        ) : (
                          <span className="local-tag-badge" title="Proyecto únicamente en disco local">
                            <HardDrive size={10} /> Local
                          </span>
                        )}
                      </span>
                      <small title={project.path}>{project.path}</small>
                    </span>
                  </span>

                  <span className="stack-list">
                    {project.frameworks.length ? (
                      project.frameworks.map(item => (
                        <em key={item} className={`stack-badge ${getStackClass(item)}`}>
                          {item}
                        </em>
                      ))
                    ) : (
                      <em className="stack-badge">{project.projectType}</em>
                    )}
                  </span>

                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusPill status={project.status} />
                    {isRunning ? (
                      <button
                        className="danger-outline"
                        style={{ height: 26, padding: '0 8px', fontSize: 11, borderRadius: 4 }}
                        title="Detener servidor"
                        disabled={busy === `stop:quick:${project.id}`}
                        onClick={e => onQuickStop(project, e)}
                      >
                        <CircleStop size={13} />
                      </button>
                    ) : project.devCommand ? (
                      <button
                        className="secondary"
                        style={{ height: 26, padding: '0 8px', fontSize: 11, borderRadius: 4 }}
                        title="Iniciar servidor"
                        disabled={busy === `run:quick:${project.id}`}
                        onClick={e => onQuickRun(project, e)}
                      >
                        <Play size={13} fill="currentColor" />
                      </button>
                    ) : null}
                  </span>

                  <span>{project.port ? `:${project.port}` : '—'}</span>

                  <span>{formatBytes(project.diskSizeBytes)}</span>

                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      className="icon-btn"
                      style={{ height: 26, width: 26, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, opacity: 0.6, border: 'none', background: 'transparent', color: 'var(--text-secondary)' }}
                      title="Desvincular proyecto de la lista"
                      disabled={busy === `unregister:${project.id}`}
                      onClick={e => onUnregister(project.id, e)}
                    >
                      <Trash2 size={13} />
                    </button>
                    <ChevronRight size={18} />
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState onRegister={onRegister} />
        )}
      </section>
    </>
  )
}

function SummaryTab({
  project,
  scan,
  process,
  recentCommands,
  onRun,
  onNotify,
}: {
  project: Project
  scan: ProjectDetail['scan']
  process: ProjectDetail['process']
  recentCommands: ProjectDetail['recentCommands']
  onRun: (
    action: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script',
    script?: string
  ) => Promise<void> | undefined
  onNotify: (text: string, kind: 'success' | 'error') => void
}) {
  const activeCmd = process?.command || project.devCommand || 'No se detectó un comando de desarrollo'
  return (
    <div className="detail-grid">
      <section className="card overview-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">COMANDO PRINCIPAL</p>
            <h2>{project.status === 'running' ? 'Proceso Activo' : 'Comando de Inicio'}</h2>
          </div>
          <StatusPill status={project.status} />
        </div>

        <div className="command-display">
          <span>$</span>
          <code>{activeCmd}</code>
          {activeCmd && (
            <CopyButton
              value={activeCmd}
              onCopy={() => onNotify('Comando copiado al portapapeles', 'success')}
            />
          )}
        </div>

        <div className="metadata-grid">
          <Meta label="Gestor" value={scan.packageManager || 'No detectado'} />
          <Meta label="Lockfile" value={scan.lockfile || 'No detectado'} />
          <Meta label="Dependencias" value={`${scan.declaredDependencies} declaradas`} />
          <Meta label="Entorno instalado" value={scan.installedDependencies ? 'Sí' : 'No'} />
        </div>
      </section>

      <section className="card quick-actions">
        <div className="card-heading">
          <div>
            <p className="eyebrow">ACCIONES SEGURAS</p>
            <h2>Scripts Rápidos</h2>
          </div>
        </div>
        <div className="action-list">
          {(['build', 'test', 'lint', 'format', 'typecheck'] as const).map(actionName => {
            const hasScript = scan.scripts.some(script => script.name === actionName)
            return (
              <button
                key={actionName}
                disabled={!hasScript}
                onClick={() => void onRun(actionName)}
              >
                <span>
                  <Wrench size={15} />
                  {actionName}
                </span>
                <ChevronRight size={15} />
              </button>
            )
          })}
        </div>
      </section>

      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">HISTORIAL</p>
            <h2>Últimas Ejecuciones</h2>
          </div>
        </div>
        {recentCommands.length ? (
          <div className="history-list">
            {recentCommands.map(command => (
              <div key={command.id}>
                <StatusDot
                  status={
                    command.status === 'running'
                      ? 'running'
                      : command.status === 'error'
                        ? 'error'
                        : 'stopped'
                  }
                />
                <code>{command.command}</code>
                <span className="mono">{command.status}</span>
                <time>{formatDate(command.startedAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-inline">Aún no hay ejecuciones registradas para este proyecto.</p>
        )}
      </section>
    </div>
  )
}

function ProcessesTab({
  project,
  logs,
  setLogs,
  process,
  onNotify,
}: {
  project: Project
  logs: LogEntry[]
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>
  process: ProcessInfo | null
  onNotify: (text: string, kind: 'success' | 'error') => void
}) {
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all')
  const terminalEndRef = useRef<HTMLDivElement>(null)

  const filteredLogs = useMemo(() => {
    if (streamFilter === 'all') return logs
    return logs.filter(l => l.stream === streamFilter)
  }, [logs, streamFilter])

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filteredLogs.length])

  const copyAllLogs = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.stream}] ${l.line}`).join('\n')
    void navigator.clipboard.writeText(text)
    onNotify('Logs copiados al portapapeles', 'success')
  }

  return (
    <div className="process-layout">
      <section className="card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">CONTROL DE PROCESO</p>
            <h2>{process ? `PID: ${process.pid}` : 'Sin proceso activo'}</h2>
          </div>
        </div>
        {process ? (
          <div className="process-data">
            <Meta label="Hora de inicio" value={formatDate(process.startedAt)} />
            <Meta label="Comando en ejecución" value={process.command} />
          </div>
        ) : (
          <p className="empty-inline">
            El Centro de Mando administra de manera aislada los subprocesos iniciados desde el panel.
          </p>
        )}
      </section>

      <section className="terminal-log">
        <div className="terminal-header">
          <div className="terminal-window-controls">
            <span className="terminal-dot close" />
            <span className="terminal-dot minimize" />
            <span className="terminal-dot expand" />
          </div>
          <div className="terminal-title">
            <Terminal size={14} />
            <span>Terminal Output</span>
            {project.status === 'running' && (
              <span className="live-beacon">
                <Radio size={11} className="spin" /> LIVE
              </span>
            )}
          </div>
          <div className="terminal-actions">
            <div className="terminal-stream-filters">
              <button
                className={streamFilter === 'all' ? 'active' : ''}
                onClick={() => setStreamFilter('all')}
              >
                Todos
              </button>
              <button
                className={streamFilter === 'stdout' ? 'active' : ''}
                onClick={() => setStreamFilter('stdout')}
              >
                stdout
              </button>
              <button
                className={streamFilter === 'stderr' ? 'active' : ''}
                onClick={() => setStreamFilter('stderr')}
              >
                stderr
              </button>
            </div>
            {logs.length > 0 && (
              <>
                <button
                  className="icon-button"
                  title="Copiar todos los logs"
                  onClick={copyAllLogs}
                >
                  <Copy size={13} />
                </button>
                <button
                  className="icon-button"
                  title="Limpiar vista de logs"
                  onClick={() => setLogs([])}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="terminal-body" aria-live="polite">
          {filteredLogs.length ? (
            filteredLogs.map((entry, index) => (
              <p key={`${entry.timestamp}-${index}`} className={entry.stream}>
                <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                <span className="terminal-line-content">{entry.line}</span>
              </p>
            ))
          ) : (
            <p className="muted-log">
              {project.status === 'running'
                ? 'Esperando salida estándar del proceso…'
                : 'Inicia el servidor de desarrollo o un script para ver los logs en tiempo real.'}
            </p>
          )}
          <div ref={terminalEndRef} />
        </div>
      </section>
    </div>
  )
}

function DependenciesTab({
  scan,
  onRun,
  busy,
}: {
  scan: ProjectDetail['scan']
  onRun: (action: 'install') => Promise<void> | undefined
  busy: string | null
}) {
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'prod' | 'dev'>('all')
  const [copiedDep, setCopiedDep] = useState<string | null>(null)

  const dependencies = scan.dependencies || []

  const filteredDeps = useMemo(() => {
    return dependencies.filter(dep => {
      const matchesSearch =
        dep.name.toLowerCase().includes(search.toLowerCase()) ||
        dep.source.toLowerCase().includes(search.toLowerCase()) ||
        (dep.version && dep.version.toLowerCase().includes(search.toLowerCase()))
      if (!matchesSearch) return false
      if (filterType === 'prod') return !dep.isDev
      if (filterType === 'dev') return dep.isDev
      return true
    })
  }, [dependencies, search, filterType])

  const prodCount = useMemo(() => dependencies.filter(d => !d.isDev).length, [dependencies])
  const devCount = useMemo(() => dependencies.filter(d => d.isDev).length, [dependencies])

  const copyDep = (name: string) => {
    void navigator.clipboard.writeText(name)
    setCopiedDep(name)
    setTimeout(() => setCopiedDep(null), 1500)
  }

  return (
    <div className="detail-grid">
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">ENTORNO Y DEPENDENCIAS</p>
            <h2>Gestión de Paquetes</h2>
          </div>
          <button
            className="primary"
            onClick={() => void onRun('install')}
            disabled={!!busy || !scan.packageManager}
          >
            {busy === 'run:install' ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <PackageOpen size={15} />
            )}
            Instalar dependencias
          </button>
        </div>

        <div className="dependency-status">
          <div className={scan.installedDependencies ? 'status-check good' : 'status-check'}>
            {scan.installedDependencies ? <Check size={18} /> : <AlertTriangle size={18} />}
            <span>
              {scan.installedDependencies
                ? 'Entorno local instalado y verificado.'
                : 'No se detectó el directorio de dependencias (node_modules o .venv).'}
            </span>
          </div>

          <div className="metadata-grid">
            <Meta label="Gestor de paquetes" value={scan.packageManager || 'No detectado'} />
            <Meta label="Lockfile" value={scan.lockfile || 'No detectado'} />
            <Meta label="Dependencias declaradas" value={String(scan.declaredDependencies)} />
            <Meta label="Manifiestos detectados" value={scan.manifests.join(', ') || 'Ninguno'} />
          </div>
        </div>
      </section>

      {/* Catálogo detallado de dependencias */}
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">CATÁLOGO DE PAQUETES</p>
            <h2>Dependencias Declaradas ({dependencies.length})</h2>
            <p>Lista de módulos, bibliotecas y herramientas declaradas en los manifiestos del proyecto.</p>
          </div>
        </div>

        <div className="deps-toolbar">
          <div className="deps-search-wrapper">
            <Search size={15} />
            <input
              type="text"
              placeholder="Buscar por paquete, versión o archivo..."
              className="deps-search-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="deps-filter-chips">
            <button
              className={`deps-filter-chip ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              Todas ({dependencies.length})
            </button>
            {prodCount > 0 && (
              <button
                className={`deps-filter-chip ${filterType === 'prod' ? 'active' : ''}`}
                onClick={() => setFilterType('prod')}
              >
                Producción ({prodCount})
              </button>
            )}
            {devCount > 0 && (
              <button
                className={`deps-filter-chip ${filterType === 'dev' ? 'active' : ''}`}
                onClick={() => setFilterType('dev')}
              >
                Desarrollo ({devCount})
              </button>
            )}
          </div>
        </div>

        {filteredDeps.length > 0 ? (
          <div className="deps-grid">
            {filteredDeps.map((dep, index) => (
              <div key={`${dep.name}-${dep.source}-${index}`} className="dep-card">
                <div className="dep-info">
                  <div className={`dep-icon-box ${dep.isDev ? 'dev' : ''}`}>
                    <Box size={14} />
                  </div>
                  <div className="dep-text">
                    <span className="dep-name" title={dep.name}>
                      {dep.name}
                    </span>
                    <span className="dep-source">{dep.source}</span>
                  </div>
                </div>

                <div className="dep-meta-tags">
                  {dep.version && (
                    <span className="dep-version-tag" title={`Versión: ${dep.version}`}>
                      {dep.version}
                    </span>
                  )}
                  <span className={`dep-kind-tag ${dep.isDev ? 'dev' : 'prod'}`}>
                    {dep.isDev ? 'dev' : 'prod'}
                  </span>
                  <button
                    className="icon-button"
                    title={copiedDep === dep.name ? '¡Copiado!' : 'Copiar nombre del paquete'}
                    onClick={() => copyDep(dep.name)}
                    style={{ width: '26px', height: '26px' }}
                  >
                    {copiedDep === dep.name ? (
                      <Check size={12} color="var(--accent-primary)" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-deps-state">
            <p>
              {search
                ? `No se encontraron dependencias que coincidan con "${search}".`
                : 'No se encontraron dependencias declaradas en este proyecto.'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function DiskTab({
  disk,
  onLoad,
  onPreviewCleanup,
  busy,
}: {
  disk: DiskReport | null
  onLoad: () => void
  onPreviewCleanup: () => void
  busy: string | null
}) {
  useEffect(() => {
    if (!disk && !busy) {
      onLoad()
    }
  }, [disk, onLoad, busy])

  const colorPalette = ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#f43f5e', '#ec4899']

  return (
    <div className="detail-grid">
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">ESPACIO EN DISCO</p>
            <h2>{disk ? formatBytes(disk.totalBytes) : 'Calculando uso de almacenamiento…'}</h2>
            <p>Análisis de directorios regenerables dentro de este proyecto.</p>
          </div>
          <button
            className="danger-outline"
            onClick={onPreviewCleanup}
            disabled={!!busy || !disk?.entries.length}
          >
            <Trash2 size={15} /> Revisar limpieza
          </button>
        </div>

        {disk && disk.entries.length > 0 && (
          <div className="disk-meter-container">
            <div className="disk-meter-bar">
              {disk.entries.map((entry, index) => {
                const percentage = disk.totalBytes > 0 ? (entry.bytes / disk.totalBytes) * 100 : 0
                return (
                  <div
                    key={entry.target}
                    className="disk-meter-segment"
                    style={{
                      width: `${Math.max(percentage, 1)}%`,
                      backgroundColor: colorPalette[index % colorPalette.length],
                    }}
                    title={`${entry.label}: ${formatBytes(entry.bytes)} (${percentage.toFixed(1)}%)`}
                  />
                )
              })}
            </div>
            <div className="disk-legend">
              {disk.entries.map((entry, index) => (
                <div key={entry.target} className="disk-legend-item">
                  <span
                    className="disk-legend-color"
                    style={{ backgroundColor: colorPalette[index % colorPalette.length] }}
                  />
                  <span>
                    {entry.label} ({formatBytes(entry.bytes)})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {disk ? (
          <div className="disk-list">
            {disk.entries.length ? (
              disk.entries.map(entry => (
                <div key={entry.target}>
                  <div>
                    <HardDrive size={16} />
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.path}</small>
                    </span>
                  </div>
                  <b>{formatBytes(entry.bytes)}</b>
                </div>
              ))
            ) : (
              <p className="empty-inline">No se detectaron carpetas regenerables en este proyecto.</p>
            )}
          </div>
        ) : (
          <LoadingInline />
        )}
      </section>

      <section className="card safety-note span-two">
        <ShieldCheck size={22} />
        <div>
          <h3>Garantía de limpieza segura con Dry-Run</h3>
          <p>
            Dev Command Center verifica rutas canónicas, prohíbe symlinks y nunca eliminará archivos
            de configuración sensible como <code>.env</code>, llaves o código fuente.
          </p>
        </div>
      </section>
    </div>
  )
}

function ScriptsTab({
  scripts,
  onRun,
  busy,
}: {
  scripts: ProjectDetail['scan']['scripts']
  onRun: (action: 'script', script: string) => Promise<void> | undefined
  busy: string | null
}) {
  return (
    <section className="card scripts-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">SCRIPTS DEL MANIFIESTO</p>
          <h2>Comandos de Ejecución</h2>
          <p>Comandos declarados oficialmente en package.json o configuraciones del proyecto.</p>
        </div>
      </div>
      {scripts.length ? (
        <div className="script-list">
          {scripts.map(script => (
            <div key={script.name}>
              <div>
                <strong>{script.name}</strong>
                <code>{script.command}</code>
              </div>
              <div>
                <CopyButton value={script.command} />
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void onRun('script', script.name)}
                >
                  <Play size={14} /> Ejecutar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-inline">No se encontraron scripts configurados.</p>
      )}
    </section>
  )
}

function ConfigurationTab({
  project,
  scan,
  onNotify,
}: {
  project: Project
  scan: ProjectDetail['scan']
  onNotify: (text: string, kind: 'success' | 'error') => void
}) {
  return (
    <div className="detail-grid">
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">METADATOS DEL PROYECTO</p>
            <h2>Registro en Base de Datos</h2>
          </div>
        </div>
        <div className="configuration-list">
          <div>
            <Meta label="Ruta original" value={project.path} />
            <div style={{ marginTop: 6 }}>
              <CopyButton
                value={project.path}
                onCopy={() => onNotify('Ruta copiada al portapapeles', 'success')}
              />
            </div>
          </div>
          <div>
            <Meta label="Ruta canónica" value={project.canonicalPath} />
            <div style={{ marginTop: 6 }}>
              <CopyButton
                value={project.canonicalPath}
                onCopy={() => onNotify('Ruta canónica copiada', 'success')}
              />
            </div>
          </div>
          <Meta label="Tipo de proyecto" value={scan.projectType} />
          <Meta label="Frameworks" value={scan.frameworks.join(', ') || 'No detectados'} />
          <Meta label="Etiquetas" value={project.tags.join(', ') || 'Sin etiquetas'} />
          <Meta label="Fecha de registro" value={formatDate(project.createdAt)} />
        </div>
      </section>

      <section className="card safety-note span-two">
        <ShieldCheck size={22} />
        <div>
          <h3>Inmutabilidad de alcance</h3>
          <p>
            La aplicación restringe las operaciones al árbol del proyecto. Si la ruta es alterada o
            apunta fuera, las acciones se bloquean preventivamente.
          </p>
        </div>
      </section>
    </div>
  )
}

function RegisterModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean
  onClose: () => void
  onSubmit: (path: string, name: string, tags: string[]) => Promise<void>
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')

  const chooseFolder = async () => {
    if (isTauri) {
      try {
        const result = await open({
          directory: true,
          multiple: false,
          title: 'Selecciona la carpeta del proyecto',
        })
        if (typeof result === 'string') setPath(result)
      } catch (err) {
        console.warn('Dialog error in Tauri:', err)
      }
    } else {
      setPath('')
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (path.trim()) {
      void onSubmit(
        path.trim(),
        name.trim(),
        tags
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean)
      )
    }
  }

  return (
    <Modal title="Registrar Proyecto Local" onClose={onClose}>
      <form onSubmit={submit} className="form-stack">
        <p className="modal-copy">
          Selecciona una carpeta en tu disco. Dev Command Center analizará los manifiestos de
          configuración para detectar el stack automáticamente.
        </p>
        <label>
          Carpeta del proyecto
          <span className="input-with-button">
            <input
              autoFocus
              value={path}
              onChange={event => setPath(event.target.value)}
              placeholder="/Users/usuario/Proyectos/mi-app"
              required
            />
            <button type="button" className="secondary" onClick={() => void chooseFolder()}>
              <FolderOpen size={15} /> Explorar
            </button>
          </span>
        </label>
        <label>
          Nombre para mostrar (opcional)
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Se usará el nombre de la carpeta por defecto"
          />
        </label>
        <label>
          Etiquetas (separadas por coma)
          <input
            value={tags}
            onChange={event => setTags(event.target.value)}
            placeholder="saas, ai, cliente, frontend"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
            Registrar proyecto
          </button>
        </div>
      </form>
    </Modal>
  )
}

function SettingsModal({
  settings,
  githubStatus,
  onClose,
  onSaveIde,
  onSaveGitHubToken,
}: {
  settings: IdeSettings | null
  githubStatus: GitHubAccountStatus | null
  onClose: () => void
  onSaveIde: (settings: IdeSettings) => Promise<void>
  onSaveGitHubToken: (token: string) => Promise<void>
}) {
  const [tools, setTools] = useState(settings?.tools || [])
  const [tokenInput, setTokenInput] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [tokenMessage, setTokenMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => setTools(settings?.tools || []), [settings])

  const handleTokenSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!tokenInput.trim()) return
    setSavingToken(true)
    setTokenMessage(null)
    try {
      await onSaveGitHubToken(tokenInput.trim())
      setTokenMessage({ kind: 'success', text: 'Token de GitHub guardado y verificado.' })
      setTokenInput('')
    } catch (err) {
      setTokenMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Error al verificar token con GitHub.',
      })
    } finally {
      setSavingToken(false)
    }
  }

  return (
    <Modal title="Ajustes de Herramientas y Nube" onClose={onClose}>
      <div className="form-stack">
        {/* GitHub Cloud Connection */}
        <div style={{ padding: 14, background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <GitHubLogo size={16} color="var(--accent-cyan)" /> Integración GitHub
            </strong>
            {githubStatus?.authenticated ? (
              <span className="status-pill status-running" style={{ fontSize: 11 }}>
                Conectado (@{githubStatus.username})
              </span>
            ) : (
              <span className="status-pill status-stopped" style={{ fontSize: 11 }}>
                No conectado
              </span>
            )}
          </div>
          <p className="modal-copy" style={{ margin: '4px 0 10px' }}>
            Accede a tus repositorios remotos y clónalos bajo demanda. Ingresa un Personal Access Token (PAT) de GitHub.
          </p>

          {githubStatus?.authenticated && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0', padding: 8, background: 'var(--bg-card)', borderRadius: 6 }}>
              {githubStatus.avatarUrl && (
                <img src={githubStatus.avatarUrl} alt="Avatar" style={{ width: 32, height: 32, borderRadius: '50%' }} />
              )}
              <div>
                <strong style={{ fontSize: 13, display: 'block' }}>{githubStatus.name || githubStatus.username}</strong>
                <small style={{ color: 'var(--text-tertiary)' }}>{githubStatus.totalRepos} repositorios disponibles · Token: {githubStatus.tokenPreview || 'Guardado'}</small>
              </div>
            </div>
          )}

          <form onSubmit={handleTokenSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="github_pat_... o ghp_..."
              style={{ flex: 1 }}
            />
            <button className="secondary" type="submit" disabled={!tokenInput.trim() || savingToken}>
              {savingToken ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Guardar Token
            </button>
          </form>

          {tokenMessage && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: tokenMessage.kind === 'success' ? 'var(--accent-primary)' : 'var(--accent-rose)' }}>
              {tokenMessage.text}
            </p>
          )}
        </div>

        {/* IDE & Editor Tools */}
        {settings ? (
          <form
            className="form-stack"
            style={{ marginTop: 8 }}
            onSubmit={event => {
              event.preventDefault()
              void onSaveIde({ tools })
            }}
          >
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <Settings2 size={16} /> Editores e IDEs Locales
            </strong>
            <p className="modal-copy">
              Configura el comando o ruta para Antigravity IDE (ej: <code>agy</code>) y Codex (ej: <code>codex</code>).
            </p>
            {tools.map((tool, index) => (
              <label key={tool.id}>
                {tool.label}
                <span className="tool-input">
                  <input
                    value={tool.command || ''}
                    onChange={event =>
                      setTools(current =>
                        current.map((item, position) =>
                          position === index ? { ...item, command: event.target.value || null } : item
                        )
                      )
                    }
                    placeholder={tool.id === 'antigravity' ? 'agy o ruta de app' : tool.id === 'codex' ? 'codex' : tool.id}
                  />
                  <span className={tool.available ? 'available' : 'unavailable'}>
                    {tool.available ? 'Disponible' : 'No detectado'}
                  </span>
                </span>
              </label>
            ))}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>
                Cerrar
              </button>
              <button className="primary" type="submit">
                <Check size={16} /> Guardar editores
              </button>
            </div>
          </form>
        ) : (
          <LoadingInline />
        )}
      </div>
    </Modal>
  )
}

function Palette({
  onClose,
  onRegister,
  onSettings,
  onDashboard,
}: {
  onClose: () => void
  onRegister: () => void
  onSettings: () => void
  onDashboard: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  return (
    <Modal title="Paleta de Comandos Rápidos" onClose={onClose}>
      <div className="palette">
        <div className="search">
          <Search size={16} />
          <input ref={input} placeholder="Escribe para filtrar acciones…" aria-label="Buscar acción" />
        </div>
        <button
          onClick={() => {
            onClose()
            onRegister()
          }}
        >
          <Plus size={15} /> Registrar nuevo proyecto <kbd>⌘N</kbd>
        </button>
        <button
          onClick={() => {
            onDashboard()
            onClose()
          }}
        >
          <LayoutDashboard size={15} /> Ir al Dashboard principal
        </button>
        <button
          onClick={() => {
            onClose()
            onSettings()
          }}
        >
          <Settings2 size={15} /> Configurar editores e IDEs
        </button>
      </div>
    </Modal>
  )
}

function CleanupModal({
  preview,
  onClose,
  onConfirm,
  busy,
}: {
  preview: CleanupPreview
  onClose: () => void
  onConfirm: (targets: string[]) => void
  busy: boolean
}) {
  const [selected, setSelected] = useState(preview.entries.map(entry => entry.target))
  const total = preview.entries
    .filter(entry => selected.includes(entry.target))
    .reduce((sum, entry) => sum + entry.bytes, 0)

  return (
    <Modal title="Confirmar Limpieza de Directorios" onClose={onClose}>
      <div className="cleanup-modal">
        <div className="cleanup-list">
          {preview.entries.map(entry => (
            <label key={entry.target}>
              <input
                type="checkbox"
                checked={selected.includes(entry.target)}
                onChange={() =>
                  setSelected(current =>
                    current.includes(entry.target)
                      ? current.filter(target => target !== entry.target)
                      : [...current, entry.target]
                  )
                }
              />
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.path}</small>
              </span>
              <b>{formatBytes(entry.bytes)}</b>
            </label>
          ))}
        </div>

        <p className="cleanup-total">
          Espacio total a recuperar: <strong>{formatBytes(total)}</strong>
        </p>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="danger"
            disabled={!selected.length || busy}
            onClick={() => onConfirm(selected)}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            Confirmar eliminación definitiva
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

function StatusPill({ status }: { status: ProjectStatus }) {
  return (
    <span className={`status-pill ${status}`}>
      <StatusDot status={status} />
      {statusLabels[status]}
    </span>
  )
}

function StatusDot({ status }: { status: ProjectStatus }) {
  return <i className={`status-dot ${status}`} aria-hidden="true" />
}

function StatCard({
  label,
  value,
  status,
  icon,
}: {
  label: string
  value: number
  status: ProjectStatus | 'neutral'
  icon: ReactNode
}) {
  return (
    <article className={`stat-card ${status}`}>
      <div className="stat-top">
        <div className="stat-icon">{icon}</div>
        <span className="stat-value">{value}</span>
      </div>
      <div className="stat-bottom">
        <span className="stat-label">{label}</span>
      </div>
    </article>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  )
}

function CopyButton({ value, onCopy }: { value: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    onCopy?.()
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button className="copy-button" aria-label="Copiar comando" onClick={handleCopy}>
      {copied ? <Check size={14} color="var(--accent-primary)" /> : <Copy size={14} />}
    </button>
  )
}

function EmptyState({ onRegister }: { onRegister: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FolderOpen size={26} />
      </div>
      <h3>Registra tu primer proyecto</h3>
      <p>
        Selecciona una carpeta o pega una ruta local. Dev Command Center detectará de forma
        automática su stack, dependencias y comandos.
      </p>
      <button className="primary" onClick={onRegister}>
        <Plus size={16} /> Registrar proyecto
      </button>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <LoaderCircle className="spin" size={32} />
      <span>Cargando datos locales…</span>
    </div>
  )
}

function LoadingInline() {
  return (
    <div className="loading-inline">
      <LoaderCircle className="spin" size={18} /> Calculando información…
    </div>
  )
}

function getStackClass(framework: string): string {
  const f = framework.toLowerCase()
  if (f.includes('react')) return 'react'
  if (f.includes('vite')) return 'vite'
  if (f.includes('rust')) return 'rust'
  if (f.includes('python') || f.includes('django') || f.includes('fastapi')) return 'python'
  if (f.includes('astro')) return 'astro'
  return ''
}

function showError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  window.dispatchEvent(new CustomEvent('dev-command-error', { detail: text }))
  console.error(error)
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function GitHubHubView({
  status,
  repos,
  loading,
  onRefresh,
  onClone,
  onOpenLocal,
  onSafeOffload,
  onOpenSettings,
  busy,
}: {
  status: GitHubAccountStatus | null
  repos: GitHubRepo[]
  loading: boolean
  onRefresh: () => void
  onClone: (repo: GitHubRepo) => void
  onOpenLocal: (projectId: string) => void
  onSafeOffload: (repo: GitHubRepo) => void
  onOpenSettings: () => void
  busy: string | null
}) {
  const [filter, setFilter] = useState<'all' | 'cloud' | 'local' | 'public' | 'private'>('all')
  const [query, setQuery] = useState('')

  const stats = useMemo(() => {
    const total = repos.length
    const cloned = repos.filter(r => r.isCloned).length
    const cloudOnly = total - cloned
    const totalStars = repos.reduce((sum, r) => sum + r.stars, 0)
    return { total, cloned, cloudOnly, totalStars }
  }, [repos])

  const filteredRepos = useMemo(() => {
    return repos.filter(r => {
      const matchQuery = `${r.name} ${r.fullName} ${r.language || ''} ${r.description || ''}`
        .toLowerCase()
        .includes(query.toLowerCase())
      if (!matchQuery) return false

      if (filter === 'cloud') return !r.isCloned
      if (filter === 'local') return r.isCloned
      if (filter === 'public') return !r.isPrivate
      if (filter === 'private') return r.isPrivate
      return true
    })
  }, [repos, filter, query])

  return (
    <div className="github-hub-layout">
      <div className="dashboard-title">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <p className="eyebrow">WORKSPACE EN LA NUBE</p>
            {status?.authenticated && (
              <span className="status-pill status-running" style={{ fontSize: 11 }}>
                Conectado como @{status.username}
              </span>
            )}
          </div>
          <h1>GitHub Cloud Hub</h1>
          <p>
            Explora tus repositorios remotos, clónalos bajo demanda con un clic y libéralos de tu disco de forma segura cuando termines de trabajar.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={onRefresh} disabled={loading || !!busy}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? 'Sincronizando…' : 'Actualizar Repos'}
          </button>
          <button className="primary" onClick={onOpenSettings}>
            <Settings2 size={16} /> {status?.authenticated ? 'Ajustes y Token' : 'Conectar GitHub'}
          </button>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard
          label="Total en GitHub"
          value={stats.total || (status?.totalRepos ?? 0)}
          status="neutral"
          icon={<GitHubLogo size={18} color="var(--accent-cyan)" />}
        />
        <StatCard
          label="Solo en Nube (0 MB)"
          value={stats.cloudOnly}
          status="stopped"
          icon={<DownloadCloud size={18} />}
        />
        <StatCard
          label="Clonados en tu Mac"
          value={stats.cloned}
          status="running"
          icon={<FolderOpen size={18} />}
        />
        <StatCard
          label="Estrellas Totales"
          value={stats.totalStars}
          status="neutral"
          icon={<Star size={18} />}
        />
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <div className="search" style={{ maxWidth: 360, width: '100%' }}>
            <Search size={15} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar en tus repositorios de GitHub…"
              aria-label="Buscar repositorios"
            />
          </div>
          <div className="filter-group">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              Todos ({stats.total})
            </button>
            <button className={filter === 'cloud' ? 'active' : ''} onClick={() => setFilter('cloud')}>
              Solo en Nube ({stats.cloudOnly})
            </button>
            <button className={filter === 'local' ? 'active' : ''} onClick={() => setFilter('local')}>
              Clonados ({stats.cloned})
            </button>
            <button className={filter === 'public' ? 'active' : ''} onClick={() => setFilter('public')}>
              Públicos
            </button>
            <button className={filter === 'private' ? 'active' : ''} onClick={() => setFilter('private')}>
              Privados
            </button>
          </div>
        </div>

        {loading && !repos.length ? (
          <div className="empty-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
            <LoaderCircle size={28} className="spin" style={{ margin: '0 auto 12px', display: 'block' }} />
            <h3>Sincronizando repositorios con GitHub…</h3>
            <p>Consultando el catálogo de @{status?.username || 'tu cuenta'}…</p>
          </div>
        ) : filteredRepos.length ? (
          <div className="github-grid">
            {filteredRepos.map(repo => {
              const isCloning = busy === `clone:${repo.name}`
              return (
                <div className={`github-card ${repo.isCloned ? 'is-cloned' : ''}`} key={repo.id}>
                  <div className="github-card-header">
                    <div className="github-repo-name">
                      <a
                        href={repo.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="github-title-link"
                        title="Ver en GitHub"
                      >
                        <strong>{repo.name}</strong>
                        <ArrowUpRight size={14} />
                      </a>
                      <span className="github-full-name">{repo.fullName}</span>
                    </div>
                    <div className="github-badges">
                      {repo.isPrivate ? (
                        <span className="vis-badge private" title="Repositorio privado">
                          <Lock size={11} /> Privado
                        </span>
                      ) : (
                        <span className="vis-badge public" title="Repositorio público">
                          <Globe size={11} /> Público
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="github-desc">{repo.description || 'Sin descripción en GitHub.'}</p>

                  <div className="github-meta-row">
                    {repo.language && (
                      <span className="github-lang">
                        <span className="lang-dot" />
                        {repo.language}
                      </span>
                    )}
                    {repo.stars > 0 && (
                      <span className="github-stat">
                        <Star size={12} /> {repo.stars}
                      </span>
                    )}
                    {repo.forks > 0 && (
                      <span className="github-stat">
                        <GitFork size={12} /> {repo.forks}
                      </span>
                    )}
                    <span className="github-updated">
                      Actualizado: {new Date(repo.updatedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="github-card-actions">
                    {repo.isCloned ? (
                      <>
                        <div className="cloned-badge">
                          <Check size={13} color="var(--accent-primary)" />
                          <span>En tu Mac (Listo)</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="secondary"
                            onClick={() => repo.localProjectId && onOpenLocal(repo.localProjectId)}
                            style={{ height: 28, fontSize: 12, padding: '0 10px' }}
                          >
                            Abrir en Panel
                          </button>
                          <button
                            className="danger-outline"
                            onClick={() => onSafeOffload(repo)}
                            style={{ height: 28, fontSize: 12, padding: '0 10px' }}
                            title="Liberar espacio en disco eliminando la copia local de forma segura"
                          >
                            Archivar a Nube
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="cloud-badge">
                          <Cloud size={13} color="var(--text-tertiary)" />
                          <span>Solo en Nube (0 MB)</span>
                        </div>
                        <button
                          className="primary"
                          onClick={() => onClone(repo)}
                          disabled={isCloning || !!busy}
                          style={{ height: 28, fontSize: 12, padding: '0 12px' }}
                        >
                          {isCloning ? (
                            <>
                              <LoaderCircle size={13} className="spin" /> Clonando…
                            </>
                          ) : (
                            <>
                              <DownloadCloud size={13} /> Clonar y Registrar
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-card" style={{ padding: '36px 20px', textAlign: 'center' }}>
            <Cloud size={32} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
            <h3>No se encontraron repositorios con los filtros seleccionados</h3>
            <p>Prueba buscando con otro término o cambiando los filtros superiores.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function SafeOffloadModal({
  candidate,
  onClose,
  onConfirm,
  busy,
}: {
  candidate: Project
  onClose: () => void
  onConfirm: (candidate: Project, force: boolean) => void
  busy: boolean
}) {
  const [force, setForce] = useState(false)

  return (
    <Modal title="Archivar a la Nube y Liberar Disco" onClose={onClose}>
      <div className="cleanup-modal">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ padding: 10, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 8, color: 'var(--accent-rose)' }}>
            <Cloud size={28} />
          </div>
          <div>
            <h3 style={{ margin: '0 0 6px' }}>¿Deseas archivar «{candidate.name}»?</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Esta acción verificará con Git que <strong>todos tus cambios locales y commits estén subidos a GitHub (git push)</strong>. Si todo está limpio, se eliminará la carpeta física local:
            </p>
            <code style={{ display: 'block', marginTop: 8, padding: '6px 10px', background: 'var(--bg-canvas)', borderRadius: 6, fontSize: 12 }}>
              {candidate.path}
            </code>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 12, background: 'rgba(59, 130, 246, 0.08)', borderRadius: 8, border: '1px solid rgba(59, 130, 246, 0.2)', fontSize: 12, color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0 }}>
            💾 <strong>Liberarás espacio en tu disco local.</strong> El repositorio seguirá disponible en GitHub y podrás volver a clonarlo cuando quieras desde el Cloud Hub con 1 clic.
          </p>
        </div>

        <label style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={force}
            onChange={e => setForce(e.target.checked)}
          />
          <span>Forzar eliminación incluso si hay cambios o ramas no rastreadas</span>
        </label>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => onConfirm(candidate, force)}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            {busy ? 'Verificando Git y Archivando…' : 'Verificar y Archivar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
