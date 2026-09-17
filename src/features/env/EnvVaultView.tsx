import {
  ArchiveRestore,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
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
import type { AdoptEnvVarsRequest, EnvVar, EnvVaultSnapshot, Project } from '../../types'
import { LoadingInline } from '../../components/Primitives'

/**
 * Bóveda de entorno: todo lo guardado, de todos los proyectos.
 *
 * Los proyectos vivos van primero y son de solo lectura aquí —editar se hace en
 * la pestaña «Entorno» del proyecto, que es la que sabe de ficheros y de
 * sincronía con el disco—. Esta vista responde a otra pregunta: «¿dónde guardé
 * aquella clave?», y hasta ahora no había forma de contestarla sin abrir los
 * proyectos uno a uno.
 *
 * Después van las huérfanas, agrupadas por el proyecto del que venían. Existen
 * porque borrar un proyecto hace `remove_dir_all` de su carpeta y sus `.env`
 * están en el `.gitignore`: sin este rescate, esas credenciales no estarían en
 * ningún sitio.
 */
export function EnvVaultView({
  snapshot,
  orphans,
  projects,
  loading,
  busy,
  onLoad,
  onAdopt,
  onDiscard,
  onCopy,
}: {
  snapshot: EnvVaultSnapshot | null
  orphans: EnvVar[]
  projects: Project[]
  loading: boolean
  busy: string | null
  onLoad: (silencioso?: boolean) => void
  onAdopt: (request: AdoptEnvVarsRequest, projectName: string) => void
  onDiscard: (ids: string[], label: string) => void
  onCopy: (ids: string[]) => void
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [restoring, setRestoring] = useState<{ origin: string; projectId: string; scope: string } | null>(null)
  const [discarding, setDiscarding] = useState<string | null>(null)

  useEffect(() => {
    onLoad()
    // Una sola carga al entrar: lo demás llega por acciones de esta misma vista,
    // que ya recargan al terminar, o por el botón «Actualizar».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const liveGroups = useMemo(() => snapshot?.groups.filter(group => group.projectId) ?? [], [snapshot])
  // Las huérfanas se reparten por proyecto de origen en vez de ir en un bloque
  // único: restaurar y descartar se deciden por proyecto, no en masa.
  const orphanGroups = useMemo(() => groupByOrigin(orphans), [orphans])

  const total = snapshot?.total ?? 0
  const toggleReveal = (id: string) =>
    setRevealed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const varRow = (variable: EnvVar, borrable: boolean) => {
    const hidden = variable.isSecret && !revealed.has(variable.id)
    return (
      <div key={variable.id} className="env-var-row">
        <div className="env-var-key">
          {variable.isSecret ? <KeyRound size={13} className="env-secret-icon" /> : <span className="env-key-dot" />}
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
          {borrable && (
            <button
              className="icon-button danger-icon"
              onClick={() => onDiscard([variable.id], `«${variable.key}»`)}
              disabled={!!busy}
              title="Descartar esta variable"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="project-header">
        <div className="breadcrumb">
          <Vault size={15} />
          <strong>Bóveda de entorno</strong>
        </div>
        <div className="header-actions">
          <button
            className="secondary"
            onClick={() => onLoad(false)}
            disabled={loading || !!busy}
            title="Recargar la bóveda y recuperar las variables cuyo proyecto ya no existe"
          >
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
            <h1>Todas las variables guardadas</h1>
            <p>
              {total
                ? `${total} ${total === 1 ? 'variable' : 'variables'} en ${liveGroups.length} ${
                    liveGroups.length === 1 ? 'proyecto' : 'proyectos'
                  }${orphans.length ? ` · ${orphans.length} sin proyecto` : ''}.`
                : 'Aquí aparece todo lo que guardes en la bóveda, proyecto a proyecto.'}
            </p>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        {loading && !total ? (
          <div className="card span-two">
            <LoadingInline />
          </div>
        ) : !total ? (
          <div className="empty-state">
            <div className="empty-icon">
              <ShieldCheck size={26} />
            </div>
            <h3>La bóveda está vacía</h3>
            <p>
              Importa los <code>.env</code> de tus proyectos desde la pestaña «Entorno» de cada uno.
              A partir de ahí los verás todos aquí, y si borras un proyecto sus variables
              sobrevivirán en lugar de irse con la carpeta.
            </p>
          </div>
        ) : (
          <>
            {liveGroups.map(group => {
              const ids = group.vars.map(variable => variable.id)
              return (
                <section key={group.projectId} className="card span-two orphan-group">
                  <div className="card-heading">
                    <div>
                      <p className="eyebrow">{group.available ? 'PROYECTO' : 'CARPETA NO DISPONIBLE'}</p>
                      <h2>
                        {group.available ? <FolderOpen size={18} /> : <FolderX size={18} />} {group.projectName}
                      </h2>
                      <p>
                        {group.projectPath ? <code>{group.projectPath}</code> : 'Ruta desconocida'}
                        {group.secretCount ? ` · ${group.secretCount} tratadas como secreto` : ''}
                      </p>
                    </div>
                    <div className="env-heading-actions">
                      <button className="secondary" onClick={() => onCopy(ids)} disabled={!!busy}>
                        <Copy size={15} /> Copiar como .env
                      </button>
                    </div>
                  </div>
                  {/* Sin borrado en bloque: las variables de un proyecto vivo se
                      gestionan en su pestaña «Entorno», que además avisa de lo
                      que quedaría desincronizado con el disco. */}
                  <div className="env-var-list">{group.vars.map(variable => varRow(variable, false))}</div>
                </section>
              )
            })}

            {orphanGroups.map(group => {
              const ids = group.vars.map(variable => variable.id)
              const isRestoring = restoring?.origin === group.origin
              const isDiscarding = discarding === group.origin
              return (
                <section key={`orphan:${group.origin}`} className="card span-two orphan-group">
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

                  <div className="env-var-list">{group.vars.map(variable => varRow(variable, true))}</div>
                </section>
              )
            })}
          </>
        )}
      </div>
    </>
  )
}
