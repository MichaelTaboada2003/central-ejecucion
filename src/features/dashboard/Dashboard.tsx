import { Archive, ArchiveRestore, ChevronRight, CircleStop, HardDrive, Layers, Pin, Play, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react'
import { formatBytes, getStackClass } from '../../lib/format'
import { projectKind, type StatusFilter } from '../../lib/projects'
import { statusLabels } from '../../lib/labels'
import type { Project } from '../../types'
import { GitHubLogo } from '../../components/GitHubLogo'
import { EmptyState, StatCard } from '../../components/Primitives'
import { StatusPill } from '../../components/Status'

export function Dashboard({
  projects,
  stats,
  onRefreshAll,
  statusFilter,
  setStatusFilter,
  isGitHubConnected,
  onSelect,
  onRegister,
  onQuickRun,
  onQuickStop,
  onDeleteProject,
  onTogglePin,
  onToggleArchive,
  busy,
}: {
  projects: Project[]
  stats: { total: number; pinned: number; running: number; stopped: number; error: number; archived: number }
  onRefreshAll: () => void
  statusFilter: StatusFilter
  setStatusFilter: (value: StatusFilter) => void
  isGitHubConnected: (project: Project) => boolean
  onSelect: (id: string) => void
  onRegister: () => void
  onQuickRun: (project: Project, e: React.MouseEvent) => void
  onQuickStop: (project: Project, e: React.MouseEvent) => void
  onDeleteProject: (project: Project) => void
  onTogglePin: (project: Project, e?: React.MouseEvent) => void
  onToggleArchive: (project: Project, e?: React.MouseEvent) => void
  busy: string | null
}) {
  return (
    <>
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">CENTRO DE MANDO</p>
          <h1>Panel Local</h1>
          <p>Supervisa, ejecuta y optimiza tus entornos locales de desarrollo.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="secondary"
            onClick={onRefreshAll}
            disabled={!!busy}
            title="Reescanear todos los proyectos del registro"
          >
            <RefreshCw size={15} className={busy === 'refresh-all' ? 'spin' : ''} /> Reescanear
          </button>
          <button className="primary" onClick={onRegister}>
            <Plus size={16} /> Registrar proyecto
          </button>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard
          label="En ejecución"
          value={stats.running}
          status="running"
          icon={<Play size={18} />}
        />
        <StatCard
          label="Fijados"
          value={stats.pinned}
          status="neutral"
          icon={<Pin size={18} color="var(--accent-amber)" />}
        />
        <StatCard
          label="Detenidos"
          value={stats.stopped}
          status="stopped"
          icon={<CircleStop size={18} />}
        />
        <StatCard
          label="Archivados"
          value={stats.archived}
          status="neutral"
          icon={<Archive size={18} color="var(--accent-indigo)" />}
        />
        <StatCard
          label="Total activos"
          value={stats.total}
          status="neutral"
          icon={<Layers size={18} />}
        />
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <h2>Proyectos en tu Mac</h2>
            <p>
              {projects.length
                ? `${projects.length} proyecto(s) listados`
                : 'Sin proyectos que coincidan con los filtros'}
            </p>
          </div>
          <div className="filter-group">
            {(['all', 'pinned', 'running', 'stopped', 'archived', 'error'] as const).map(status => {
              const count =
                status === 'all'
                  ? stats.total
                  : status === 'pinned'
                  ? stats.pinned
                  : status === 'running'
                  ? stats.running
                  : status === 'stopped'
                  ? stats.stopped
                  : status === 'archived'
                  ? stats.archived
                  : stats.error
              return (
                <button
                  className={statusFilter === status ? 'active' : ''}
                  key={status}
                  onClick={() => setStatusFilter(status)}
                >
                  {status === 'all' ? `Todos (${count})` : `${statusLabels[status]} (${count})`}
                </button>
              )
            })}
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
                  style={{ cursor: 'pointer', opacity: project.isArchived ? 0.75 : 1 }}
                >
                  <span className="project-cell">
                    <span className="mini-icon">
                      <Terminal size={17} />
                    </span>
                    <span className="project-info">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <strong>{project.name}</strong>
                        {project.isPinned && (
                          <span className="pinned-badge" title="Proyecto fijado">
                            <Pin size={10} fill="currentColor" /> Fijado
                          </span>
                        )}
                        {project.isArchived && (
                          <span className="archived-badge" title="Proyecto archivado">
                            <Archive size={10} /> Archivado
                          </span>
                        )}
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
                    ) : project.devCommand && projectKind(project) === 'service' ? (
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

                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    <button
                      className="icon-button"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: project.isPinned ? 'var(--accent-amber)' : 'var(--text-tertiary)',
                        padding: '4px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'color 0.15s ease',
                      }}
                      title={project.isPinned ? 'Desfijar proyecto' : 'Fijar proyecto al inicio'}
                      onClick={e => {
                        e.stopPropagation()
                        onTogglePin(project, e)
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-amber)')}
                      onMouseLeave={e => (e.currentTarget.style.color = project.isPinned ? 'var(--accent-amber)' : 'var(--text-tertiary)')}
                    >
                      <Pin size={15} fill={project.isPinned ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      className="icon-button"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: project.isArchived ? 'var(--accent-indigo)' : 'var(--text-tertiary)',
                        padding: '4px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'color 0.15s ease',
                      }}
                      title={project.isArchived ? 'Restaurar de archivados' : 'Archivar proyecto'}
                      onClick={e => {
                        e.stopPropagation()
                        onToggleArchive(project, e)
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-indigo)')}
                      onMouseLeave={e => (e.currentTarget.style.color = project.isArchived ? 'var(--accent-indigo)' : 'var(--text-tertiary)')}
                    >
                      {project.isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    </button>
                    <button
                      className="icon-button"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-tertiary)',
                        padding: '4px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'color 0.15s ease',
                      }}
                      title="Eliminar o desregistrar proyecto"
                      onClick={e => {
                        e.stopPropagation()
                        onDeleteProject(project)
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-rose, #ef4444)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                    >
                      <Trash2 size={15} />
                    </button>
                    <ChevronRight size={18} style={{ opacity: 0.5 }} />
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
