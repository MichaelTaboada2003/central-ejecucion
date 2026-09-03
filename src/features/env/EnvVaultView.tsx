import {
  ArchiveRestore,
  Copy,
  Eye,
  EyeOff,
  FolderX,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Vault,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { groupByOrigin, maskValue } from '../../lib/envVars'
import { formatDate } from '../../lib/format'
import type { AdoptEnvVarsRequest, EnvVar, Project } from '../../types'
import { LoadingInline } from '../../components/Primitives'

/**
 * Bóveda de variables huérfanas.
 *
 * Existe porque borrar un proyecto hace `remove_dir_all` de su carpeta y sus
 * `.env` están en el `.gitignore`: sin este rescate, las credenciales de un
 * proyecto borrado no estarían en ningún sitio. Aquí se restauran en otro
 * proyecto, se copian, o se descartan cuando de verdad ya no hacen falta.
 */
export function EnvVaultView({
  orphans,
  projects,
  loading,
  busy,
  onLoad,
  onAdopt,
  onDiscard,
  onCopy,
}: {
  orphans: EnvVar[]
  projects: Project[]
  loading: boolean
  busy: string | null
  onLoad: () => void
  onAdopt: (request: AdoptEnvVarsRequest, projectName: string) => void
  onDiscard: (ids: string[], label: string) => void
  onCopy: (ids: string[]) => void
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [restoring, setRestoring] = useState<{ origin: string; projectId: string; scope: string } | null>(null)
  const [discarding, setDiscarding] = useState<string | null>(null)

  useEffect(() => {
    onLoad()
    // Una sola carga al entrar: la lista solo cambia por acciones de esta misma
    // vista, que ya recargan al terminar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = useMemo(() => groupByOrigin(orphans), [orphans])

  const toggleReveal = (id: string) =>
    setRevealed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <div className="project-header">
        <div className="breadcrumb">
          <Vault size={15} />
          <strong>Bóveda de entorno</strong>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={onLoad} disabled={loading || !!busy}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      <div className="project-title">
        <div>
          <div className="stack-icon">
            <KeyRound size={24} />
          </div>
          <div>
            <h1>Variables sin proyecto</h1>
            <p>
              {orphans.length
                ? `${orphans.length} ${
                    orphans.length === 1 ? 'variable sobrevivió' : 'variables sobrevivieron'
                  } al borrado de su proyecto. Restáuralas en otro proyecto o descártalas.`
                : 'Aquí aparecen las variables de entorno de los proyectos que borres.'}
            </p>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        {loading && !orphans.length ? (
          <div className="card span-two">
            <LoadingInline />
          </div>
        ) : !groups.length ? (
          <div className="empty-state">
            <div className="empty-icon">
              <ShieldCheck size={26} />
            </div>
            <h3>No hay variables huérfanas</h3>
            <p>
              Cuando borres, desregistres o liberes un proyecto, sus variables de entorno se
              quedarán aquí en lugar de desaparecer con la carpeta. Impórtalas a la bóveda desde la
              pestaña «Entorno» de cada proyecto para que esto funcione.
            </p>
          </div>
        ) : (
          groups.map(group => {
            const ids = group.vars.map(variable => variable.id)
            const isRestoring = restoring?.origin === group.origin
            const isDiscarding = discarding === group.origin
            return (
              <section key={group.origin} className="card span-two orphan-group">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">PROYECTO BORRADO</p>
                    <h2>
                      <FolderX size={18} /> {group.origin}
                    </h2>
                    <p>
                      {group.path ? <code>{group.path}</code> : 'Ruta original desconocida'}
                      {group.orphanedAt ? ` · huérfanas desde ${formatDate(group.orphanedAt)}` : ''}
                    </p>
                  </div>
                  <div className="env-heading-actions">
                    <button className="secondary" onClick={() => onCopy(ids)} disabled={!!busy}>
                      <Copy size={15} /> Copiar como .env
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        setRestoring(
                          isRestoring
                            ? null
                            : { origin: group.origin, projectId: projects[0]?.id ?? '', scope: group.vars[0].scope }
                        )
                      }
                      disabled={!!busy || !projects.length}
                      title={projects.length ? 'Devolver estas variables a un proyecto' : 'No hay proyectos registrados'}
                    >
                      <ArchiveRestore size={15} /> Restaurar
                    </button>
                    <button
                      className="danger-outline"
                      onClick={() => setDiscarding(isDiscarding ? null : group.origin)}
                      disabled={!!busy}
                    >
                      <Trash2 size={15} /> Descartar
                    </button>
                  </div>
                </div>

                {isRestoring && restoring && (
                  <div className="env-confirm">
                    <div className="orphan-restore-form">
                      <label>
                        <span>Proyecto de destino</span>
                        <select
                          value={restoring.projectId}
                          onChange={event => setRestoring({ ...restoring, projectId: event.target.value })}
                        >
                          {projects.map(project => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Fichero</span>
                        <input
                          value={restoring.scope}
                          spellCheck={false}
                          placeholder=".env"
                          onChange={event => setRestoring({ ...restoring, scope: event.target.value })}
                        />
                      </label>
                    </div>
                    <div className="env-confirm-actions">
                      <button className="secondary" onClick={() => setRestoring(null)}>
                        Cancelar
                      </button>
                      <button
                        className="primary"
                        disabled={!restoring.projectId || !!busy}
                        onClick={() => {
                          const target = projects.find(project => project.id === restoring.projectId)
                          onAdopt(
                            { ids, projectId: restoring.projectId, scope: restoring.scope.trim() || null },
                            target?.name ?? 'el proyecto'
                          )
                          setRestoring(null)
                        }}
                      >
                        {busy === 'adopt' ? <LoaderCircle size={14} className="spin" /> : <ArchiveRestore size={14} />}{' '}
                        Restaurar {ids.length} {ids.length === 1 ? 'variable' : 'variables'}
                      </button>
                    </div>
                  </div>
                )}

                {isDiscarding && (
                  <div className="env-confirm">
                    <div>
                      <strong>
                        ¿Descartar las {ids.length} variables de «{group.origin}»?
                      </strong>
                      <p className="env-confirm-loss">
                        Es la última copia que queda: el proyecto ya no está en el disco y sus{' '}
                        <code>.env</code> nunca llegaron a GitHub. Cópialas antes si tienes dudas.
                      </p>
                    </div>
                    <div className="env-confirm-actions">
                      <button className="secondary" onClick={() => setDiscarding(null)}>
                        Cancelar
                      </button>
                      <button
                        className="danger"
                        disabled={!!busy}
                        onClick={() => {
                          onDiscard(ids, `«${group.origin}»`)
                          setDiscarding(null)
                        }}
                      >
                        {busy === 'discard' ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{' '}
                        Descartar definitivamente
                      </button>
                    </div>
                  </div>
                )}

                <div className="env-var-list">
                  {group.vars.map(variable => {
                    const hidden = variable.isSecret && !revealed.has(variable.id)
                    return (
                      <div key={variable.id} className="env-var-row">
                        <div className="env-var-key">
                          {variable.isSecret ? (
                            <KeyRound size={13} className="env-secret-icon" />
                          ) : (
                            <span className="env-key-dot" />
                          )}
                          <code>{variable.key}</code>
                          <small>{variable.scope}</small>
                        </div>
                        <code className={`env-var-value ${hidden ? 'masked' : ''}`}>
                          {hidden ? maskValue(variable.value) : variable.value || '(vacío)'}
                        </code>
                        <div className="env-var-actions">
                          {variable.isSecret && (
                            <button
                              className="icon-button"
                              onClick={() => toggleReveal(variable.id)}
                              title={revealed.has(variable.id) ? 'Ocultar valor' : 'Revelar valor'}
                            >
                              {revealed.has(variable.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          )}
                          <button className="icon-button" onClick={() => onCopy([variable.id])} title="Copiar">
                            <Copy size={14} />
                          </button>
                          <button
                            className="icon-button danger-icon"
                            onClick={() => onDiscard([variable.id], `«${variable.key}»`)}
                            disabled={!!busy}
                            title="Descartar esta variable"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
    </>
  )
}
