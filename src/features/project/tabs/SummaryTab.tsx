import { ChevronRight, Wrench } from 'lucide-react'
import { formatDate } from '../../../lib/format'
import { describeCommandOutcome } from '../../../lib/format'
import { kindMeta } from '../../../lib/kindMeta'
import { projectKind } from '../../../lib/projects'
import type { Project, ProjectDetail } from '../../../types'
import { CopyButton, Meta } from '../../../components/Primitives'
import { LastRunPill, StatusDot, StatusPill } from '../../../components/Status'

export function SummaryTab({
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
    action: 'dev' | 'build' | 'test' | 'lint' | 'format' | 'typecheck' | 'install' | 'script' | 'notebook',
    script?: string
  ) => Promise<void> | undefined
  onNotify: (text: string, kind: 'success' | 'error' | 'info') => void
}) {
  const kind = projectKind(project)
  const activeCmd = process?.command || project.devCommand || 'No se detectó un comando ejecutable'
  const cardTitle =
    project.status === 'running'
      ? 'Proceso Activo'
      : kind === 'script'
      ? 'Tarea principal'
      : kind === 'notebook'
      ? 'Cuadernos'
      : kind === 'inert'
      ? 'Sin comando de arranque'
      : 'Comando de Inicio'
  // Un script no está «detenido»: terminó, y con un código. Ese dato ya vivía en
  // el historial y no se mostraba en ninguna parte.
  const lastRun = kind === 'script' ? recentCommands.find(command => command.status !== 'running') : undefined
  return (
    <div className="detail-grid">
      <section className="card overview-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">{kind === 'service' ? 'COMANDO PRINCIPAL' : kindMeta[kind].label.toUpperCase()}</p>
            <h2>{cardTitle}</h2>
          </div>
          {kind === 'script' && project.status !== 'running' ? (
            <LastRunPill record={lastRun} />
          ) : (
            <StatusPill status={project.status} />
          )}
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
                <span className="mono">{describeCommandOutcome(command)}</span>
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
