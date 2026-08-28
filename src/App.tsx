import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Check,
  CloudOff,
  Command,
  Database,
  HardDrive,
  LayoutDashboard,
  Pin,
  Plus,
  Radio,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'

import { kindMeta } from './lib/kindMeta'
import { type StatusFilter } from './lib/projects'
import { useGitHub } from './hooks/useGitHub'
import { reportError, useNotices } from './hooks/useNotices'
import { useProjectDetail } from './hooks/useProjectDetail'
import { useProjects } from './hooks/useProjects'
import { useProjectSync } from './hooks/useProjectSync'
import { GitHubLogo } from './components/GitHubLogo'
import { Modal } from './components/Modal'
import { LoadingScreen } from './components/Primitives'
import { StatusDot } from './components/Status'
import { Dashboard } from './features/dashboard/Dashboard'
import { GitHubHubView } from './features/github/GitHubHubView'
import { CleanupModal } from './features/modals/CleanupModal'
import { CloneModal } from './features/modals/CloneModal'
import { DeleteProjectModal } from './features/modals/DeleteProjectModal'
import { Palette } from './features/modals/Palette'
import { RegisterModal } from './features/modals/RegisterModal'
import { SafeOffloadModal } from './features/modals/SafeOffloadModal'
import { SettingsModal } from './features/modals/SettingsModal'
import { ProjectWorkspace } from './features/project/ProjectWorkspace'
import type {
  GitHubRepo,
  IdeSettings,
  Project,
  ProjectKind,
} from './types'
import './App.css'

type Modal = 'register' | 'settings' | 'palette' | null


export default function App() {
  // Estado de la interfaz. Todo lo que es datos vive en su propio hook.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showArchivedSidebar, setShowArchivedSidebar] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [ideSettings, setIdeSettings] = useState<IdeSettings | null>(null)
  const [viewMode, setViewMode] = useState<'local' | 'github'>('local')
  const [offloadCandidate, setOffloadCandidate] = useState<Project | null>(null)
  const [cloneCandidate, setCloneCandidate] = useState<GitHubRepo | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Project | null>(null)
  const [defaultCloneDir, setDefaultCloneDir] = useState<string>('')
  const searchRef = useRef<HTMLInputElement>(null)

  const { notice, notify, dismiss } = useNotices()
  const clearSelection = useCallback(() => setSelectedId(null), [])
  const selectFirst = useCallback((projectId: string) => setSelectedId(projectId), [])

  const {
    projects, loading, loadProjects, togglePin, toggleArchive, setKind, refreshAll,
    groups: { pinnedProjects, activeProjects, archivedProjects },
    visibleProjects, stats,
  } = useProjects({ notify, onSelect: selectFirst, query: filter, statusFilter })

  const {
    detail, tab, setTab, logs, setLogs, disk, setDisk, cleanup, setCleanup, loadDetail, selectedIdRef,
  } = useProjectDetail({ selectedId, clearSelection, loadProjects, notify })

  useProjectSync({ loadProjects, loadDetail, selectedIdRef })
  const github = useGitHub()

  useEffect(() => {
    void loadProjects(false)
    void api.getDefaultCloneDir().then(dir => setDefaultCloneDir(dir)).catch(() => {})
  }, [loadProjects])

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

  // La lista es la única fuente de verdad de las banderas de un proyecto: el
  // detalle las leía por su cuenta y había que mantener las dos copias de
  // acuerdo a mano en cada acción de fijar, archivar o cambiar la naturaleza.
  const activeDetail = useMemo(() => {
    if (!detail) return null
    const fromList = projects.find(project => project.id === detail.project.id)
    return fromList ? { ...detail, project: fromList } : detail
  }, [detail, projects])

  // Los tres son envoltorios finos sobre el hook: lo único que añade la
  // interfaz es detener la propagación del clic —vienen de botones dentro de
  // filas— y abrir la sección de archivados al archivar.
  const handleTogglePin = (project: Project, e?: React.MouseEvent) => {
    e?.stopPropagation()
    return togglePin(project)
  }

  const handleToggleArchive = (project: Project, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!project.isArchived) setShowArchivedSidebar(true)
    return toggleArchive(project)
  }

  const handleKindChange = (project: Project, kind: ProjectKind | null) =>
    setKind(project, kind, kind ? kindMeta[kind].label : '')

  const action = async (name: string, operation: () => Promise<unknown>) => {
    setBusy(name)
    try {
      await operation()
      // Ambos refrescos son independientes: encadenarlos duplicaba la espera.
      await Promise.all([loadProjects(), selectedId ? loadDetail(selectedId) : null])
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  const handleRun = (
    actionName: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script' | 'notebook',
    script?: string
  ) => {
    if (!detail) return
    return action(`run:${actionName}`, async () => {
      await api.runProject({
        projectId: detail.project.id,
        action: actionName,
        script,
      })
      // `runProject` solo devuelve el proceso recién lanzado: la instalación aún
      // está corriendo. Anunciarla como terminada llevaba a intentar arrancar el
      // servidor con las dependencias a medio instalar.
      if (actionName === 'install') {
        notify('Instalación iniciada. Sigue su avance en «Procesos y logs»; al terminar se habilitará el servidor.', 'info')
      } else {
        notify(`Comando '${actionName}' iniciado con éxito.`)
      }
    })
  }

  const handleQuickRun = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    return action(`run:quick:${project.id}`, async () => {
      await api.runProject({ projectId: project.id, action: 'dev' })
      notify(`Iniciado ${project.name}`)
    })
  }

  const handleQuickStop = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    return action(`stop:quick:${project.id}`, async () => {
      await api.stopProject(project.id)
      notify(`Detenido ${project.name}`)
    })
  }

  // Los metadatos sólo se recalculan al registrar o al pulsar «Actualizar» en un
  // proyecto, así que al cambiar el detector quedaban etiquetas de versiones
  // anteriores. Esto los reescribe todos de una pasada.
  const handleRefreshAll = () =>
    action('refresh-all', async () => {
      const cuantos = await refreshAll()
      notify(`${cuantos} proyecto(s) reescaneados y sus metadatos actualizados.`)
    })

  const handleRefresh = () =>
    detail &&
    action('refresh', async () => {
      await api.refreshProject(detail.project.id)
      notify('Metadatos y uso de disco actualizados.')
    })

  const handleDisk = useCallback(async () => {
    if (!detail) return
    setBusy('disk')
    try {
      const report = await api.getDiskReport(detail.project.id)
      setDisk(report)
    } catch (error) {
      reportError(error)
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
      notify(`${deleted.length} directorio(s) regenerable(s) eliminado(s).`)
    })

  const launchTool = (tool: string) =>
    detail && action(`tool:${tool}`, () => api.launchTool(detail.project.id, tool))

  const refreshSettings = async () => {
    const [settings, cloneDir] = await Promise.all([
      api.getIdeSettings(),
      api.getDefaultCloneDir().catch(() => ''),
    ])
    setIdeSettings(settings)
    setDefaultCloneDir(cloneDir)
    setModal('settings')
  }

  const register = async (path: string, name: string, tags: string[]) => {
    await action('register', async () => {
      const project = await api.registerProject(path, name, tags)
      setSelectedId(project.id)
      setModal(null)
      notify(`${project.name} quedó registrado localmente.`)
    })
  }

  const handleCloneRepo = (repo: GitHubRepo) => {
    setCloneCandidate(repo)
  }

  const handleConfirmClone = async (repo: GitHubRepo, targetPath: string, makeDefault: boolean) => {
    return action(`clone:${repo.name}`, async () => {
      if (makeDefault) {
        const lastSlash = targetPath.lastIndexOf('/')
        const parentDir = lastSlash > 0 ? targetPath.substring(0, lastSlash) : targetPath
        if (parentDir) {
          const saved = await api.setDefaultCloneDir(parentDir)
          setDefaultCloneDir(saved)
        }
      }
      const project = await api.cloneGitHubRepo({
        repoName: repo.name,
        cloneUrl: repo.cloneUrl,
        isPrivate: repo.isPrivate,
        targetPath,
      })
      setCloneCandidate(null)
      await loadProjects(true)
      await github.load()
      setSelectedId(project.id)
      setViewMode('local')
      notify(`Repositorio «${repo.name}» clonado en «${project.path}» y registrado exitosamente.`)
    })
  }

  // El archivado borra la carpeta del disco, así que solo se acepta una
  // correspondencia inequívoca. Buscar por nombre podía apuntar a otro proyecto
  // que simplemente se llamara igual que el repositorio.
  const handleSafeOffload = (repo: GitHubRepo) => {
    const proj = projects.find(
      p => (repo.localProjectId && p.id === repo.localProjectId) || (repo.localPath && p.canonicalPath === repo.localPath)
    )
    if (proj) {
      setOffloadCandidate(proj)
    } else {
      notify(
`«${repo.name}» está en el disco pero no registrado en el panel. Regístralo primero para poder archivarlo desde aquí.`,
'error')
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
      await github.load()
      notify(result.message)
    })
  }

  const handleDeleteProject = (candidate: Project) => {
    return action(`delete:${candidate.id}`, async () => {
      await api.deleteProject(candidate.id, true)
      setDeleteCandidate(null)
      if (selectedId === candidate.id) {
        setSelectedId(null)
      }
      await loadProjects(true)
      await github.load()
      notify(
`Proyecto «${candidate.name}» y sus archivos locales eliminados de tu computador.`)
    })
  }

  const handleSaveGitHubToken = (token: string) => github.saveToken(token)

  // Un índice por clave evita recorrer la lista completa de repos una vez por
  // proyecto en cada render de la barra lateral y del dashboard.
  const githubIndex = useMemo(() => {
    const byProjectId = new Map<string, GitHubRepo>()
    const byPath = new Map<string, GitHubRepo>()
    const byName = new Map<string, GitHubRepo>()
    for (const repo of github.repos) {
      if (repo.localProjectId && !byProjectId.has(repo.localProjectId)) byProjectId.set(repo.localProjectId, repo)
      if (repo.localPath && !byPath.has(repo.localPath)) byPath.set(repo.localPath, repo)
      const name = repo.name.toLowerCase()
      if (!byName.has(name)) byName.set(name, repo)
    }
    return { byProjectId, byPath, byName }
  }, [github.repos])

  const getGitHubRepo = useCallback(
    (project: Project) =>
      githubIndex.byProjectId.get(project.id) ??
      githubIndex.byPath.get(project.canonicalPath) ??
      githubIndex.byName.get(project.name.toLowerCase()),
    [githubIndex]
  )

  const isGitHubConnected = useCallback(
    (project: Project) => project.tags.includes('github') || getGitHubRepo(project) !== undefined,
    [getGitHubRepo]
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

        <nav className="sidebar-nav">
          <button
            className={viewMode === 'local' && !selectedId ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setSelectedId(null)
              setViewMode('local')
            }}
          >
            <LayoutDashboard size={16} /> Panel Local
            {projects.length ? (
              <span className="badge-count" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--bg-surface-2)', padding: '2px 7px', borderRadius: 10, color: 'var(--accent-primary)' }}>
                {projects.length}
              </span>
            ) : null}
          </button>
          <button
            className={viewMode === 'github' && !selectedId ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setSelectedId(null)
              setViewMode('github')
            }}
          >
            <GitHubLogo size={16} /> GitHub
            {github.status?.totalRepos ? (
              <span className="badge-count" style={{ marginLeft: 'auto', fontSize: 11, background: 'var(--bg-surface-2)', padding: '2px 7px', borderRadius: 10, color: 'var(--accent-cyan)' }}>
                {github.status.totalRepos}
              </span>
            ) : null}
          </button>
        </nav>

        <section className="project-nav">
          {pinnedProjects.length > 0 && (
            <div className="project-section">
              <div className="nav-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-amber)' }}>
                  <Pin size={11} fill="currentColor" /> FIJADOS
                </span>
                <span className="badge-count" style={{ fontSize: 10, padding: '1px 6px', background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-amber)' }}>
                  {pinnedProjects.length}
                </span>
              </div>
              <div className="project-list">
                {pinnedProjects.map(project => {
                  const onGithub = isGitHubConnected(project)
                  return (
                    <div
                      className={`project-nav-item ${selectedId === project.id ? 'selected' : ''}`}
                      key={project.id}
                      title={`${project.name} · ${onGithub ? 'Sincronizado con GitHub' : 'Solo en almacenamiento local'}`}
                    >
                      <button
                        type="button"
                        className="project-nav-open"
                        onClick={() => {
                          setSelectedId(project.id)
                          setViewMode('local')
                        }}
                      >
                        <StatusDot status={project.status} />
                        <span className="project-nav-name">{project.name}</span>
                      </button>
                      <button
                        type="button"
                        className="sidebar-pin-btn active"
                        onClick={e => handleTogglePin(project, e)}
                        title="Desfijar proyecto"
                      >
                        <Pin size={12} fill="currentColor" />
                      </button>
                      {onGithub ? (
                        <GitHubLogo size={13} color="var(--accent-cyan)" className="github-indicator-icon" />
                      ) : (
                        <HardDrive size={12} color="var(--text-tertiary)" className="local-indicator-icon" />
                      )}
                      {project.status === 'error' && <AlertTriangle size={13} color="var(--accent-rose)" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="project-section">
            <div className="nav-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{pinnedProjects.length > 0 ? 'OTROS PROYECTOS' : 'PROYECTOS'}</span>
              {activeProjects.length > 0 && (
                <span className="badge-count" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--bg-surface-2)' }}>
                  {activeProjects.length}
                </span>
              )}
            </div>
            <div className="project-list">
              {activeProjects.map(project => {
                const onGithub = isGitHubConnected(project)
                return (
                  <div
                    className={`project-nav-item ${selectedId === project.id ? 'selected' : ''}`}
                    key={project.id}
                    title={`${project.name} · ${onGithub ? 'Sincronizado con GitHub' : 'Solo en almacenamiento local'}`}
                  >
                    <button
                      type="button"
                      className="project-nav-open"
                      onClick={() => {
                        setSelectedId(project.id)
                        setViewMode('local')
                      }}
                    >
                      <StatusDot status={project.status} />
                      <span className="project-nav-name">{project.name}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-pin-btn"
                      onClick={e => handleTogglePin(project, e)}
                      title="Fijar proyecto al inicio"
                    >
                      <Pin size={12} />
                    </button>
                    {onGithub ? (
                      <GitHubLogo size={13} color="var(--accent-cyan)" className="github-indicator-icon" />
                    ) : (
                      <HardDrive size={12} color="var(--text-tertiary)" className="local-indicator-icon" />
                    )}
                    {project.status === 'error' && <AlertTriangle size={13} color="var(--accent-rose)" />}
                  </div>
                )
              })}
            </div>
          </div>

          {archivedProjects.length > 0 && (
            <div className="project-section archived-section">
              <div
                className="nav-heading"
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => setShowArchivedSidebar(prev => !prev)}
                title="Mostrar/ocultar proyectos archivados"
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent-indigo)' }}>
                  <Archive size={11} /> ARCHIVADOS {showArchivedSidebar ? '▾' : '▸'}
                </span>
                <span className="badge-count" style={{ fontSize: 10, padding: '1px 6px', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-indigo)' }}>
                  {archivedProjects.length}
                </span>
              </div>
              {showArchivedSidebar && (
                <div className="project-list">
                  {archivedProjects.map(project => {
                    const onGithub = isGitHubConnected(project)
                    return (
                      <div
                        className={`project-nav-item archived ${selectedId === project.id ? 'selected' : ''}`}
                        key={project.id}
                        title={`${project.name} (Archivado) · ${onGithub ? 'Sincronizado con GitHub' : 'Solo en almacenamiento local'}`}
                      >
                        <button
                          type="button"
                          className="project-nav-open"
                          onClick={() => {
                            setSelectedId(project.id)
                            setViewMode('local')
                          }}
                        >
                          <StatusDot status={project.status} />
                          <span className="project-nav-name">{project.name}</span>
                        </button>
                        <button
                          type="button"
                          className="sidebar-pin-btn active"
                          onClick={e => handleToggleArchive(project, e)}
                          title="Desarchivar proyecto"
                          style={{ color: 'var(--accent-indigo)' }}
                        >
                          <ArchiveRestore size={12} />
                        </button>
                        {onGithub ? (
                          <GitHubLogo size={13} color="var(--accent-cyan)" className="github-indicator-icon" />
                        ) : (
                          <HardDrive size={12} color="var(--text-tertiary)" className="local-indicator-icon" />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => void refreshSettings()}>
            <Settings2 size={16} /> Ajustes
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
            {github.status?.authenticated ? (
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
                <span>GitHub: @{github.status.username} ({github.status.totalRepos} repos)</span>
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
            <button className="avatar" aria-label="Ajustes" onClick={() => void refreshSettings()} style={{ overflow: 'hidden', padding: 0 }}>
              {github.status?.avatarUrl ? (
                <img
                  src={github.status.avatarUrl}
                  alt={github.status.username || 'Ajustes'}
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                'DC'
              )}
            </button>
          </div>
        </header>

        <div className="content">
          {loading ? (
            <LoadingScreen />
          ) : activeDetail ? (
            <ProjectWorkspace
              detail={activeDetail}
              gitHubRepo={getGitHubRepo(activeDetail.project)}
              tab={tab}
              setTab={setTab}
              logs={logs}
              setLogs={setLogs}
              disk={disk}
              busy={busy}
              onBack={() => setSelectedId(null)}
              onRun={handleRun}
              onStop={() => action('stop', () => api.stopProject(activeDetail.project.id))}
              onRestart={() => action('restart', () => api.restartProject(activeDetail.project.id))}
              onRefresh={handleRefresh}
              onDisk={handleDisk}
              onPreviewCleanup={previewCleanup}
              onLaunchTool={launchTool}
              onOpenUrl={() => action('url', () => api.openProjectUrl(activeDetail.project.id))}
              onNotify={(text, kind) => notify(text, kind)}
              onDeleteProject={setDeleteCandidate}
              onTogglePin={handleTogglePin}
              onToggleArchive={handleToggleArchive}
              onKindChange={handleKindChange}
            />
          ) : viewMode === 'github' ? (
            <GitHubHubView
              status={github.status}
              repos={github.repos}
              loading={github.loading}
              onRefresh={github.load}
              onClone={handleCloneRepo}
              onOpenLocal={repo => {
                if (!repo.localProjectId) {
                  notify(
`«${repo.name}» ya está en ${repo.localPath ?? 'tu disco'}, pero no está registrado en el panel. Regístralo para gestionarlo desde aquí.`,
'info')
                  return
                }
                setSelectedId(repo.localProjectId)
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
              onRefreshAll={handleRefreshAll}
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
              onDeleteProject={setDeleteCandidate}
              onTogglePin={handleTogglePin}
              onToggleArchive={handleToggleArchive}
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
          <button aria-label="Cerrar mensaje" onClick={dismiss}>
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

      {deleteCandidate && (
        <DeleteProjectModal
          candidate={deleteCandidate}
          onClose={() => setDeleteCandidate(null)}
          onConfirm={handleDeleteProject}
          busy={busy === `delete:${deleteCandidate.id}`}
        />
      )}

      {cloneCandidate && (
        <CloneModal
          repo={cloneCandidate}
          defaultCloneDir={defaultCloneDir}
          onClose={() => setCloneCandidate(null)}
          onConfirmClone={handleConfirmClone}
          busy={!!busy && busy.startsWith('clone:')}
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
          githubStatus={github.status}
          defaultCloneDir={defaultCloneDir}
          onClose={() => setModal(null)}
          onSaveIde={async settings => {
            await action('settings', async () => {
              const saved = await api.saveIdeSettings(settings)
              setIdeSettings(saved)
              notify('Configuración de herramientas guardada.')
              setModal(null)
            })
          }}
          onSaveGitHubToken={handleSaveGitHubToken}
          onSaveDefaultCloneDir={async path => {
            const saved = await api.setDefaultCloneDir(path)
            setDefaultCloneDir(saved)
            notify('Ruta base de clonación guardada.')
          }}
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
