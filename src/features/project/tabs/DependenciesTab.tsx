import {
  AlertTriangle,
  Box,
  Check,
  CheckCircle2,
  Copy,
  LoaderCircle,
  PackageOpen,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeSearchText } from '../../../lib/projects'
import type { DeclaredDependency, DependencyAuditResult, Project, ProjectDetail } from '../../../types'
import { Meta } from '../../../components/Primitives'
import { InstallOutcomeCard, InstallProgressPanel } from '../../../components/InstallProgress'
import { IDLE_INSTALL_ACTIVITY, type InstallActivity } from '../../../hooks/useInstallActivity'
import { copyText } from '../../../lib/clipboard'
import { api } from '../../../api'
import { Modal } from '../../../components/Modal'

// Caché en memoria para evitar cualquier lag al navegar o filtrar
const auditCache = new Map<string, DependencyAuditResult>()

function getRemovalCommandPreview(pm: string | null | undefined, depName: string): string {
  const manager = (pm || '').toLowerCase()
  if (manager.includes('pnpm')) return `pnpm remove ${depName}`
  if (manager.includes('yarn')) return `yarn remove ${depName}`
  if (manager.includes('bun')) return `bun remove ${depName}`
  if (manager.includes('cargo')) return `cargo remove ${depName}`
  if (manager.includes('poetry')) return `poetry remove ${depName}`
  if (manager.includes('pipenv')) return `pipenv uninstall ${depName}`
  return `npm uninstall ${depName}`
}

export function DependenciesTab({
  project,
  scan,
  onRun,
  busy,
  install = IDLE_INSTALL_ACTIVITY,
  onCancelInstall,
  onOpenLogs,
  onNotify,
  onReloadProject,
}: {
  project?: Project
  scan: ProjectDetail['scan']
  onRun: (action: 'install') => Promise<void> | undefined
  busy: string | null
  /** Instalación en curso, si la hay. Se dibuja aquí porque es aquí donde se
   *  lanza: mandar al usuario a otra pestaña a ver si avanza no es seguirla. */
  install?: InstallActivity
  onCancelInstall?: () => void
  onOpenLogs?: () => void
  onNotify?: (text: string, kind: 'success' | 'error' | 'info') => void
  onReloadProject?: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'prod' | 'dev' | 'unused'>('all')
  const [copiedDep, setCopiedDep] = useState<string | null>(null)

  // Auditoría en memoria (0 lag) y selección para modal
  const [auditResult, setAuditResult] = useState<DependencyAuditResult | null>(() => {
    return project ? auditCache.get(project.id) || null : null
  })
  const [auditing, setAuditing] = useState(false)
  const [selectedDep, setSelectedDep] = useState<DeclaredDependency | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Restaurar diagnóstico de caché si ya fue analizado previamente
  useEffect(() => {
    if (!project) return
    const cached = auditCache.get(project.id)
    if (cached) {
      setAuditResult(cached)
    }
  }, [project?.id])

  const dependencies = scan.dependencies || []

  const unusedSet = useMemo(() => {
    return new Set(auditResult?.unused || [])
  }, [auditResult])

  const filteredDeps = useMemo(() => {
    const normalized = normalizeSearchText(search.trim())
    const tokens = normalized ? normalized.split(/\s+/).filter(Boolean) : []
    return dependencies.filter(dep => {
      if (tokens.length > 0) {
        const haystack = normalizeSearchText(`${dep.name || ''} ${dep.source || ''} ${dep.version || ''}`)
        if (!tokens.every(token => haystack.includes(token))) return false
      }
      if (filterType === 'prod') return !dep.isDev
      if (filterType === 'dev') return dep.isDev
      if (filterType === 'unused') return unusedSet.has(dep.name)
      return true
    })
  }, [dependencies, search, filterType, unusedSet])

  const prodCount = useMemo(() => dependencies.filter(d => !d.isDev).length, [dependencies])
  const devCount = useMemo(() => dependencies.filter(d => d.isDev).length, [dependencies])

  const copyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])
  const copyDep = (name: string) => {
    void copyText(name)
    setCopiedDep(name)
    window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedDep(null), 1500)
  }

  const handleAudit = async (silent = false) => {
    if (!project) return
    setAuditing(true)
    try {
      const result = await api.auditDependencies(project.id)
      auditCache.set(project.id, result)
      setAuditResult(result)
      if (!silent) {
        if (result.unused.length === 0) {
          onNotify?.(
            `Análisis completado: se escanearon ${result.totalScannedFiles} archivos y todas las dependencias parecen estar en uso.`,
            'info'
          )
        } else {
          onNotify?.(
            `Análisis completado: se detectaron ${result.unused.length} dependencias sin uso en ${result.totalScannedFiles} archivos.`,
            'info'
          )
        }
      }
    } catch (err) {
      if (!silent) {
        const msg = err instanceof Error ? err.message : String(err)
        onNotify?.(`Error al auditar dependencias: ${msg}`, 'error')
      }
    } finally {
      setAuditing(false)
    }
  }

  const handleConfirmDelete = async (depName: string) => {
    if (!project || !depName) return
    setIsDeleting(true)
    try {
      const msg = await api.removeDependency(project.id, depName)
      onNotify?.(msg || `Dependencia «${depName}» eliminada correctamente.`, 'success')
      if (auditResult) {
        const updated: DependencyAuditResult = {
          ...auditResult,
          unused: auditResult.unused.filter(d => d !== depName),
        }
        auditCache.set(project.id, updated)
        setAuditResult(updated)
      }
      setSelectedDep(null)
      onReloadProject?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onNotify?.(`Error al eliminar la dependencia: ${msg}`, 'error')
    } finally {
      setIsDeleting(false)
    }
  }


  const estadoEntorno = useMemo(() => {
    // Mientras se instala, el diagnóstico de siempre miente: dice que falta el
    // entorno justo cuando se está creando. Y en vez de repetir lo que ya dice
    // el panel de arriba, nombra el directorio que está apareciendo.
    if (install.running) {
      const destino = scan.environmentDir || scan.missingEnvironment?.[0]
      return {
        tono: 'trabajando' as const,
        texto: destino
          ? `Creando «${destino}» con las ${scan.declaredDependencies} dependencias declaradas…`
          : 'Resolviendo las dependencias declaradas del proyecto…',
      }
    }
    if (scan.declaredDependencies === 0) {
      return { tono: 'neutro' as const, texto: 'Este proyecto no declara dependencias.' }
    }
    if (scan.installedDependencies) {
      return {
        tono: 'good' as const,
        texto: scan.environmentDir
          ? `Dependencias instaladas en «${scan.environmentDir}».`
          : 'Dependencias resueltas: esta pila no las guarda dentro del proyecto.',
      }
    }
    const faltan = scan.missingEnvironment?.length ? scan.missingEnvironment.join(' y ') : 'el entorno'
    return { tono: 'warn' as const, texto: `Falta ${faltan}: las dependencias declaradas todavía no están instaladas.` }
  }, [install.running, scan.declaredDependencies, scan.installedDependencies, scan.environmentDir, scan.missingEnvironment])

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
            disabled={!!busy || install.running || scan.declaredDependencies === 0 || !scan.packageManager}
            title={
              install.running
                ? 'La instalación ya está en marcha'
                : scan.declaredDependencies === 0
                  ? 'Este proyecto no declara dependencias'
                  : !scan.packageManager
                    ? 'No se detectó un gestor de paquetes con el que instalar'
                    : scan.installedDependencies
                      ? 'Reinstalar o sincronizar dependencias'
                      : 'Instalar dependencias del proyecto'
            }
          >
            {/* El spinner acompañaba solo a la llamada que lanza el proceso, que
                dura milisegundos: la espera de verdad empieza justo después. */}
            {busy === 'run:install' || install.running ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <PackageOpen size={15} />
            )}
            {install.running ? 'Instalando…' : 'Instalar dependencias'}
          </button>
        </div>

        {install.running && (
          <InstallProgressPanel
            activity={install}
            onCancel={onCancelInstall}
            onOpenLogs={onOpenLogs}
            cancelling={busy === 'stop'}
          />
        )}
        {!install.running && install.outcome && (
          <InstallOutcomeCard
            outcome={install.outcome}
            onDismiss={install.dismissOutcome}
            onOpenLogs={onOpenLogs}
            onRetry={() => void onRun('install')}
          />
        )}

        <div className="dependency-status">
          {/* Tres estados, no dos: «no declara nada» no es lo mismo que «está
              todo instalado», y cuando falta algo se nombra el directorio de
              ESTA pila en vez de una lista fija de node_modules y .venv. */}
          <div className={`status-check ${estadoEntorno.tono}`}>
            {estadoEntorno.tono === 'good' ? (
              <Check size={18} />
            ) : estadoEntorno.tono === 'warn' ? (
              <AlertTriangle size={18} />
            ) : estadoEntorno.tono === 'trabajando' ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <PackageOpen size={18} />
            )}
            <span>{estadoEntorno.texto}</span>
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
              onKeyDown={e => {
                if (e.key === 'Escape') setSearch('')
              }}
            />
            {search && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearch('')}
                title="Limpiar búsqueda (Esc)"
                aria-label="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            )}
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
            {auditResult && (
              <button
                className={`deps-filter-chip warn-chip ${filterType === 'unused' ? 'active' : ''}`}
                onClick={() => setFilterType('unused')}
                title="Dependencias declaradas sin referencias detectadas en el código fuente"
              >
                Sin uso ({auditResult.unused.length})
              </button>
            )}
          </div>

          <div className="deps-actions">
            <button
              type="button"
              className="secondary audit-deps-btn"
              onClick={() => void handleAudit()}
              disabled={auditing || !project}
              title={
                !project
                  ? 'Seleccione un proyecto para auditar'
                  : 'Analiza archivos TS, JS, Vue, PY, RS, etc. para detectar dependencias que no se importan'
              }
            >
              {auditing ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {auditing ? 'Analizando…' : 'Detectar no usadas'}
            </button>
          </div>
        </div>

        {auditResult && (
          <div className={`deps-audit-banner ${auditResult.unused.length > 0 ? 'has-unused' : 'clean'}`}>
            <div className="deps-audit-banner-text">
              {auditResult.unused.length > 0 ? (
                <>
                  <AlertTriangle size={15} />
                  <span>
                    Se escanearon <strong>{auditResult.totalScannedFiles}</strong> archivos y se detectaron{' '}
                    <strong>{auditResult.unused.length}</strong> dependencias sin referencias directas.
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  <span>
                    Se escanearon <strong>{auditResult.totalScannedFiles}</strong> archivos: ¡todas las dependencias declaradas parecen estar en uso!
                  </span>
                </>
              )}
            </div>
            {auditResult.unused.length > 0 && filterType !== 'unused' && (
              <button
                type="button"
                className="text-button"
                onClick={() => setFilterType('unused')}
              >
                Ver sin uso ({auditResult.unused.length})
              </button>
            )}
          </div>
        )}

        {filteredDeps.length > 0 ? (
          <div className="deps-grid">
            {filteredDeps.map((dep, index) => {
              const isUnused = unusedSet.has(dep.name)
              const isSelected = selectedDep?.name === dep.name
              return (
                <div
                  key={`${dep.name}-${dep.source}-${index}`}
                  className={`dep-card ${isUnused ? 'dep-card-unused' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedDep(dep)}
                  role="button"
                  tabIndex={0}
                  aria-haspopup="dialog"
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedDep(dep)
                    }
                  }}
                  title={`Clic para ver detalles y gestionar ${dep.name}`}
                >
                  <div className="dep-info">
                    <div className={`dep-icon-box ${dep.isDev ? 'dev' : ''} ${isUnused ? 'unused' : ''}`}>
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
                      type="button"
                      className="icon-button"
                      title={copiedDep === dep.name ? '¡Copiado!' : 'Copiar nombre del paquete'}
                      onClick={e => {
                        e.stopPropagation()
                        copyDep(dep.name)
                      }}
                      style={{ width: '26px', height: '26px' }}
                      aria-label={`Copiar nombre ${dep.name}`}
                    >
                      {copiedDep === dep.name ? (
                        <Check size={12} color="var(--accent-primary)" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                    {project && (
                      <button
                        type="button"
                        className="icon-button danger-icon"
                        title={`Eliminar dependencia ${dep.name}`}
                        onClick={e => {
                          e.stopPropagation()
                          setSelectedDep(dep)
                        }}
                        style={{ width: '26px', height: '26px' }}
                        aria-label={`Eliminar dependencia ${dep.name}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-deps-state">
            <p>
              {filterType === 'unused'
                ? 'No hay dependencias detectadas sin uso en este proyecto.'
                : search
                  ? `No se encontraron dependencias que coincidan con "${search}".`
                  : 'No se encontraron dependencias declaradas en este proyecto.'}
            </p>
          </div>
        )}
      </section>

      {selectedDep && (
        <Modal
          title={`Detalles de «${selectedDep.name}»`}
          onClose={() => !isDeleting && setSelectedDep(null)}
        >
          <div className="dep-delete-modal-content">
            <div className="dep-delete-hero">
              <div className={`dep-delete-icon ${unusedSet.has(selectedDep.name) ? 'unused' : 'standard'}`}>
                <PackageOpen size={24} />
              </div>
              <div className="dep-delete-hero-text">
                <div className="dep-modal-title-row">
                  <h3>¿Desinstalar «{selectedDep.name}»?</h3>
                  {selectedDep.version && (
                    <span className="dep-version-tag">{selectedDep.version}</span>
                  )}
                  <span className={`dep-kind-tag ${selectedDep.isDev ? 'dev' : 'prod'}`}>
                    {selectedDep.isDev ? 'dev' : 'prod'}
                  </span>
                </div>
                <p>
                  {unusedSet.has(selectedDep.name)
                    ? 'Esta dependencia fue detectada sin referencias en el código fuente del proyecto.'
                    : 'Atención: Esta dependencia parece estar en uso o no se ha realizado la auditoría todavía.'}
                </p>
              </div>
            </div>

            <div className="dep-delete-details">
              <div className="dep-delete-info-row">
                <span>Manifiesto de origen:</span>
                <strong>{selectedDep.source}</strong>
              </div>
              <div className="dep-delete-info-row">
                <span>Gestor de paquetes:</span>
                <strong>{scan.packageManager || 'Edición directa de manifiesto'}</strong>
              </div>
              <div className="dep-delete-info-row">
                <span>Comando / Acción:</span>
                <code>{getRemovalCommandPreview(scan.packageManager, selectedDep.name)}</code>
              </div>
            </div>

            {unusedSet.has(selectedDep.name) ? (
              <div className="dep-delete-notice success-notice">
                <CheckCircle2 size={16} />
                <span>Es seguro eliminarla si no se usa de forma dinámica o mediante herramientas externas.</span>
              </div>
            ) : (
              <div className="dep-delete-notice warn-notice">
                <AlertTriangle size={16} />
                <span>Si el proyecto usa este paquete, eliminarlo provocará errores al compilar o ejecutar.</span>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setSelectedDep(null)}
                disabled={isDeleting}
              >
                Cancelar
              </button>
              {project && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => void handleConfirmDelete(selectedDep.name)}
                  disabled={isDeleting}
                >
                  {isDeleting ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
                  {isDeleting ? 'Eliminando…' : 'Eliminar dependencia'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

