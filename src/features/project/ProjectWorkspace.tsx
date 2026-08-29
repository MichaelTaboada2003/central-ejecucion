import { AlertTriangle, AppWindow, Archive, ArchiveRestore, ArrowLeft, ArrowUpRight, Bot, ChevronRight, CircleStop, FileCode2, FolderOpen, GitFork, HardDrive, LayoutDashboard, LoaderCircle, PackageOpen, Pin, Play, RefreshCw, RotateCcw, Settings2, SquareTerminal, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { api } from '../../api'
import { formatDate } from '../../lib/format'
import { kindMeta } from '../../lib/kindMeta'
import { projectKind } from '../../lib/projects'
import type { Tab } from '../../hooks/useProjectDetail'
import type { TerminalEntry } from '../../lib/logs'
import type { DiskReport, GitHubRepo, Project, ProjectDetail } from '../../types'
import { GitHubLogo } from '../../components/GitHubLogo'
import { StatusPill } from '../../components/Status'
import { ConfigurationTab } from './tabs/ConfigurationTab'
import { DependenciesTab } from './tabs/DependenciesTab'
import { DiskTab } from './tabs/DiskTab'
import { GitTab } from './tabs/GitTab'
import { ProcessesTab } from './tabs/ProcessesTab'
import { ScriptsTab } from './tabs/ScriptsTab'
import { SummaryTab } from './tabs/SummaryTab'

/** Pestañas del detalle, en el orden en que se muestran. */
/** Pestañas que solo tienen sentido en algo que se ejecuta desde el panel. */
const TABS_DE_EJECUCION: Tab[] = ['processes', 'scripts']

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'summary', label: 'Resumen', icon: LayoutDashboard },
  { id: 'git', label: 'Git & GitHub', icon: GitFork },
  { id: 'processes', label: 'Procesos y logs', icon: Terminal },
  { id: 'dependencies', label: 'Dependencias', icon: PackageOpen },
  { id: 'disk', label: 'Disco y limpieza', icon: HardDrive },
  { id: 'scripts', label: 'Scripts', icon: FileCode2 },
  { id: 'configuration', label: 'Configuración', icon: Settings2 },
]

export function ProjectWorkspace({
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
  onNotify,
  onDeleteProject,
  onTogglePin,
  onToggleArchive,
}: {
  detail: ProjectDetail
  gitHubRepo?: GitHubRepo
  tab: Tab
  setTab: (tab: Tab) => void
  logs: TerminalEntry[]
  setLogs: React.Dispatch<React.SetStateAction<TerminalEntry[]>>
  disk: DiskReport | null
  busy: string | null
  onBack: () => void
  onRun: (
    action: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script' | 'notebook',
    script?: string
  ) => Promise<void> | undefined
  onStop: () => void
  onRestart: () => void
  onRefresh: () => void
  onDisk: () => void
  onPreviewCleanup: () => void
  onLaunchTool: (tool: string) => void
  onOpenUrl: () => void
  onNotify: (text: string, kind: 'success' | 'error' | 'info') => void
  onDeleteProject: (project: Project) => void
  onTogglePin: (project: Project) => void
  onToggleArchive: (project: Project) => void
}) {
  const { project, scan, process, recentCommands } = detail
  const isRunning = project.status === 'running'
  const isMissingDeps = !scan.installedDependencies && scan.declaredDependencies > 0
  const kind = projectKind(project)
  // Un script se lanza como la tarea que es, con su propio nombre; sólo un
  // servicio tiene un `dev` que arrancar.
  const primaryAction = useMemo<{ action: 'dev' | 'script' | 'notebook'; script?: string; label: string; title: string } | null>(() => {
    // Un script se gestiona, no se arranca: el panel es para controlar
    // aplicaciones. Ejecutarlo es cosa de la terminal, y el comando se muestra
    // en el Resumen para copiarlo.
    if (kind === 'inert' || kind === 'script') return null
    if (kind === 'notebook') {
      const hasNotebook = scan.scripts.some(script => script.name === 'notebook')
      return hasNotebook
        ? { action: 'notebook', label: 'Abrir Jupyter Lab', title: 'jupyter lab' }
        : null
    }
    return scan.devCommand ? { action: 'dev', label: 'Run', title: scan.devCommand } : null
  }, [kind, scan.scripts, scan.devCommand])
  const servesOverHttp = kind === 'service' || kind === 'notebook'
  // «Procesos y logs» y «Scripts» solo tienen contenido si algo se ejecuta desde
  // el panel; en un proyecto que no se ejecuta son dos pestañas vacías.
  const tabsVisibles = useMemo(
    () => (kind === 'script' || kind === 'inert' ? tabs.filter(t => !TABS_DE_EJECUCION.includes(t.id)) : tabs),
    [kind]
  )

  // Si la pestaña abierta deja de existir al cambiar de naturaleza, se vuelve al
  // resumen en vez de dejar el contenido en blanco.
  useEffect(() => {
    if (!tabsVisibles.some(t => t.id === tab)) setTab('summary')
  }, [tabsVisibles, tab, setTab])
  const KindIcon = kindMeta[kind].icon
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
          {project.localUrl && servesOverHttp && (
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
            className="secondary"
            onClick={() => onDeleteProject(project)}
            disabled={!!busy}
            title="Eliminar o desregistrar proyecto"
            style={{ color: 'var(--accent-rose, #ef4444)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
          >
            <Trash2 size={15} /> Borrar
          </button>
        </div>
      </div>

      <div className="project-title">
        <div>
          <div className="stack-icon">
            <Terminal size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1>{project.name}</h1>
              <button
                type="button"
                className={`pin-btn ${project.isPinned ? 'pinned' : ''}`}
                onClick={() => onTogglePin(project)}
                title={project.isPinned ? 'Desfijar proyecto' : 'Fijar proyecto al inicio'}
              >
                <Pin size={13} fill={project.isPinned ? 'currentColor' : 'none'} />
                <span>{project.isPinned ? 'Fijado' : 'Fijar'}</span>
              </button>
              <button
                type="button"
                className={`archive-btn ${project.isArchived ? 'archived' : ''}`}
                onClick={() => {
                  if (project.isPinned) onTogglePin(project)
                  onToggleArchive(project)
                }}
                title={project.isArchived ? 'Restaurar proyecto de archivados' : 'Archivar proyecto'}
              >
                {project.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                <span>{project.isArchived ? 'Archivado' : 'Archivar'}</span>
              </button>
            </div>
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{project.projectType}</span>
              <span>·</span>
              <span className={`kind-badge ${kind}`} title={kindMeta[kind].hint}>
                <KindIcon size={11} />
                {kindMeta[kind].label}
              </span>
              <span>·</span>
              {gitHubRepo ? (
                // Dentro del webview de Tauri un enlace con `target="_blank"` no
                // llega al navegador del sistema: hay que delegar en el backend.
                <button
                  type="button"
                  className="github-link-pill"
                  title="Abrir repositorio en GitHub"
                  onClick={() => gitHubRepo.htmlUrl && void api.openExternalUrl(gitHubRepo.htmlUrl)}
                >
                  <GitHubLogo size={13} color="var(--accent-cyan)" />
                  <span>GitHub: {gitHubRepo.fullName || project.name}</span>
                  <ArrowUpRight size={12} />
                </button>
              ) : project.tags.includes('github') ? (
                <span className="github-link-pill" title="Proyecto vinculado a GitHub">
                  <GitHubLogo size={13} color="var(--accent-cyan)" />
                  <span>GitHub</span>
                </span>
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

        {/* La acción principal depende de la naturaleza del proyecto: un script
            de una pasada no tiene un «servidor de desarrollo» que arrancar, y un
            repo sin nada ejecutable no tiene acción ninguna. */}
        <div className="run-actions">
          {isRunning ? (
            <>
              <button className="danger-outline" disabled={!!busy} onClick={onStop}>
                <CircleStop size={16} /> Detener
              </button>
              {kind === 'service' && (
                <button className="primary" disabled={!!busy} onClick={onRestart}>
                  <RotateCcw size={16} /> Reiniciar
                </button>
              )}
            </>
          ) : isMissingDeps ? (
            /* Sin dependencias instaladas, ejecutar no puede funcionar. En vez
               de un botón apagado con un consejo en el tooltip, se ofrece el
               paso que toca: en Python esto además crea el entorno virtual. */
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void onRun('install')}
              title="Instala lo declarado en el manifiesto del proyecto"
            >
              {busy === 'run:install' ? <LoaderCircle size={16} className="spin" /> : <PackageOpen size={16} />}
              Instalar dependencias
            </button>
          ) : primaryAction ? (
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void onRun(primaryAction.action, primaryAction.script)}
              title={primaryAction.title}
            >
              {busy?.startsWith('run:') ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      </div>

      <div className="status-strip">
        {/* Un estado que no puede cambiar no es un estado. */}
        {kind === 'script' || kind === 'inert' ? (
          <span className="estado-no-ejecutable" title={kindMeta[kind].hint}>
            {kindMeta[kind].label}
          </span>
        ) : (
          <StatusPill status={project.status} />
        )}
        {process && (
          <>
            <span className="divider" />
            <span>
              PID: <strong>{process.pid}</strong>
            </span>
          </>
        )}
        {project.port && servesOverHttp && (
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
            onClick={() => setTab('dependencies')}
            style={{ whiteSpace: 'nowrap' }}
          >
            <PackageOpen size={15} />
            Ver
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
        {tabsVisibles.map(({ id, label, icon: Icon }) => (
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
      {tab === 'git' && (
        <GitTab
          project={project}
          gitHubRepo={gitHubRepo}
          onNotify={onNotify}
          onReloadProject={onRefresh}
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
