import { ChevronRight, Wrench } from 'lucide-react'
import { formatDate } from '../../../lib/format'
import { describeCommandOutcome } from '../../../lib/format'
import { kindMeta } from '../../../lib/kindMeta'
import { projectKind } from '../../../lib/projects'
import type { Project, ProjectDetail } from '../../../types'
import { CopyButton, Meta } from '../../../components/Primitives'
import { StatusDot, StatusPill } from '../../../components/Status'

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
      ? 'Cómo se ejecuta'
      : kind === 'notebook'
      ? 'Cuadernos'
      : kind === 'inert'
      ? 'Sin comando de arranque'
      : 'Comando de Inicio'
  return (
    <div className="detail-grid">
      <section className="card overview-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">{kind === 'service' ? 'COMANDO PRINCIPAL' : kindMeta[kind].label.toUpperCase()}</p>
            <h2>{cardTitle}</h2>
          </div>
          {/* En un script no hay estado que mostrar: ni se arranca desde aquí ni
              queda un proceso vivo del que informar. */}
          {kind !== 'script' && kind !== 'inert' && <StatusPill status={project.status} />}
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

        {/* El panel controla aplicaciones; un script se corre donde toca. Se
            dice qué comando es y con qué intérprete, para copiarlo y ya. */}
        {kind === 'script' && (
          <p className="nota-script">
            El panel no ejecuta scripts: copia el comando y lánzalo desde la terminal —el botón «Terminal» la
            abre en esta carpeta—
            {scan.packageManager === 'pip' || scan.packageManager === 'uv'
              ? ', que usará el entorno virtual del proyecto'
              : ''}
            . Aquí se gestionan sus dependencias, su espacio en disco y su publicación en GitHub.
          </p>
        )}

        <div className="metadata-grid">
          <Meta label="Gestor" value={scan.packageManager || 'No detectado'} />
          <Meta label="Lockfile" value={scan.lockfile || 'No detectado'} />
          <Meta label="Dependencias" value={`${scan.declaredDependencies} declaradas`} />
          <Meta label="Entorno instalado" value={scan.installedDependencies ? 'Sí' : 'No'} />
        </div>
      </section>

      {kind !== 'script' && kind !== 'inert' && (
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
      )}

      {/* El historial de ejecuciones solo existe si algo se ejecuta. */}
      {kind !== 'script' && kind !== 'inert' && (
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
      )}
    </div>
  )
}
