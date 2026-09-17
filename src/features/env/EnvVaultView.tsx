import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
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
 * La vista responde a «¿dónde guardé aquella clave?», que antes obligaba a abrir
 * los proyectos uno a uno. Los proyectos vivos son de solo lectura aquí —editar
 * se hace en la pestaña «Entorno» del proyecto, que es la que sabe de ficheros y
 * de sincronía con el disco—; las huérfanas, agrupadas por el proyecto del que
 * venían, se restauran o se descartan.
 *
 * El formato es el mismo que usa el resto del panel para listas largas: una
 * tarjeta por sección y filas compactas dentro. Una tarjeta por grupo dejaba, al
 * estar plegada, 44px de relleno alrededor de un título y convertía diez
 * proyectos en diez bloques casi vacíos.
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
  // Plegados por omisión: la fila de cada grupo ya dice cuántas variables
  // guarda, que es lo que hace falta para decidir si merece abrirlo.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
  const groupKeys = useMemo(
    () => [
      ...liveGroups.map(group => `proyecto:${group.projectId}`),
      ...orphanGroups.map(group => `huerfanas:${group.origin}`),
    ],
    [liveGroups, orphanGroups]
  )
  const allExpanded = groupKeys.length > 0 && groupKeys.every(key => expanded.has(key))

  const toggleGroup = (key: string) =>
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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

  /** Cabecera plegable común a los dos tipos de grupo. */
  const groupHeader = (
    key: string,
    icon: React.ReactNode,
    name: string,
    detail: string,
    count: number,
    actions: React.ReactNode
  ) => {
    const abierto = expanded.has(key)
    return (
      <div className="vault-group-row">
        <button
          type="button"
          className="vault-group-toggle"
          onClick={() => toggleGroup(key)}
          aria-expanded={abierto}
          title={abierto ? `Plegar ${name}` : `Desplegar ${name}`}
        >
          {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span className="vault-group-id">
            {icon}
            <span>
              <strong>{name}</strong>
              <small title={detail}>{detail}</small>
            </span>
          </span>
        </button>
        <span className="vault-group-count">
          {count} {count === 1 ? 'variable' : 'variables'}
        </span>
        <div className="vault-group-actions">{actions}</div>
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
          {groupKeys.length > 1 && (
            <button
              className="secondary"
              onClick={() => setExpanded(allExpanded ? new Set() : new Set(groupKeys))}
              title={allExpanded ? 'Plegar todos los grupos' : 'Desplegar todos los grupos'}
            >
              {allExpanded ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{' '}
              {allExpanded ? 'Contraer todo' : 'Expandir todo'}
            </button>
          )}
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
            {liveGroups.length > 0 && (
              <section className="card span-two">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">PROYECTOS REGISTRADOS</p>
                    <h2>Variables por proyecto</h2>
                    <p>Solo lectura: se editan en la pestaña «Entorno» de cada proyecto.</p>
                  </div>
                </div>
                <div className="vault-list">
                  {liveGroups.map(group => {
                    const ids = group.vars.map(variable => variable.id)
                    const key = `proyecto:${group.projectId}`
                    const abierto = expanded.has(key)
                    return (
                      <div key={group.projectId} className={`vault-group ${abierto ? 'open' : ''}`}>
                        {groupHeader(
                          key,
                          group.available ? <FolderOpen size={15} /> : <FolderX size={15} />,
                          group.projectName,
                          [
                            group.projectPath ?? 'Ruta desconocida',
                            group.available ? null : 'carpeta no disponible',
                            group.secretCount ? `${group.secretCount} secretas` : null,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                          group.vars.length,
                          <button className="secondary" onClick={() => onCopy(ids)} disabled={!!busy}>
                            <Copy size={14} /> Copiar .env
                          </button>
                        )}
                        {/* Sin borrado en bloque: eso se gestiona en la pestaña
                            del proyecto, que avisa de lo que quedaría
                            desincronizado con el disco. */}
                        {abierto && (
                          <div className="vault-group-body">
                            <div className="env-var-list">{group.vars.map(variable => varRow(variable, false))}</div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {orphanGroups.length > 0 && (
              <section className="card span-two">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">SIN PROYECTO</p>
                    <h2>Variables que sobrevivieron a su proyecto</h2>
                    <p>
                      El proyecto ya no está en el disco y sus <code>.env</code> nunca llegaron a
                      GitHub: esta es la única copia. Restáuralas en otro proyecto o descártalas.
                    </p>
                  </div>
                </div>
                <div className="vault-list">
                  {orphanGroups.map(group => {
                    const ids = group.vars.map(variable => variable.id)
                    const key = `huerfanas:${group.origin}`
                    const abierto = expanded.has(key)
                    const isRestoring = restoring?.origin === group.origin
                    const isDiscarding = discarding === group.origin
                    return (
                      <div key={key} className={`vault-group orphan ${abierto ? 'open' : ''}`}>
                        {groupHeader(
                          key,
                          <FolderX size={15} />,
                          group.origin,
                          [
                            group.path ?? 'Ruta original desconocida',
                            group.orphanedAt ? `desde ${formatDate(group.orphanedAt)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                          group.vars.length,
                          <>
                            <button className="secondary" onClick={() => onCopy(ids)} disabled={!!busy}>
                              <Copy size={14} /> Copiar .env
                            </button>
                            <button
                              className="primary"
                              onClick={() =>
                                setRestoring(
                                  isRestoring
                                    ? null
                                    : {
                                        origin: group.origin,
                                        projectId: projects[0]?.id ?? '',
                                        scope: group.vars[0].scope,
                                      }
                                )
                              }
                              disabled={!!busy || !projects.length}
                              title={
                                projects.length
                                  ? 'Devolver estas variables a un proyecto'
                                  : 'No hay proyectos registrados'
                              }
                            >
                              <ArchiveRestore size={14} /> Restaurar
                            </button>
                            <button
                              className="danger-outline"
                              onClick={() => setDiscarding(isDiscarding ? null : group.origin)}
                              disabled={!!busy}
                            >
                              <Trash2 size={14} /> Descartar
                            </button>
                          </>
                        )}

                        {/* Los paneles de confirmación se muestran aunque el
                            grupo esté plegado: los abre el usuario. */}
                        {isRestoring && restoring && (
                          <div className="vault-group-panel">
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
                                  {busy === 'adopt' ? (
                                    <LoaderCircle size={14} className="spin" />
                                  ) : (
                                    <ArchiveRestore size={14} />
                                  )}{' '}
                                  Restaurar {ids.length} {ids.length === 1 ? 'variable' : 'variables'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {isDiscarding && (
                          <div className="vault-group-panel">
                            <div className="env-confirm">
                              <div>
                                <strong>
                                  ¿Descartar las {ids.length} variables de «{group.origin}»?
                                </strong>
                                <p className="env-confirm-loss">
                                  Es la última copia que queda. Cópialas antes si tienes dudas.
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
                                  {busy === 'discard' ? (
                                    <LoaderCircle size={14} className="spin" />
                                  ) : (
                                    <Trash2 size={14} />
                                  )}{' '}
                                  Descartar definitivamente
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {abierto && (
                          <div className="vault-group-body">
                            <div className="env-var-list">{group.vars.map(variable => varRow(variable, true))}</div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}
