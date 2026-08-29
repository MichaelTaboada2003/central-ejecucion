import { AlertTriangle, Box, Check, Copy, LoaderCircle, PackageOpen, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectDetail } from '../../../types'
import { Meta } from '../../../components/Primitives'

export function DependenciesTab({
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

  const copyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])
  const copyDep = (name: string) => {
    void navigator.clipboard.writeText(name)
    setCopiedDep(name)
    window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedDep(null), 1500)
  }

  const estadoEntorno = useMemo(() => {
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
  }, [scan.declaredDependencies, scan.installedDependencies, scan.environmentDir, scan.missingEnvironment])

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
            disabled={!!busy || scan.declaredDependencies === 0 || !scan.packageManager}
            title={
              scan.declaredDependencies === 0
                ? 'Este proyecto no declara dependencias'
                : !scan.packageManager
                  ? 'No se detectó un gestor de paquetes con el que instalar'
                  : scan.installedDependencies
                    ? 'Reinstalar o sincronizar dependencias'
                    : 'Instalar dependencias del proyecto'
            }
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
          {/* Tres estados, no dos: «no declara nada» no es lo mismo que «está
              todo instalado», y cuando falta algo se nombra el directorio de
              ESTA pila en vez de una lista fija de node_modules y .venv. */}
          <div className={`status-check ${estadoEntorno.tono}`}>
            {estadoEntorno.tono === 'good' ? (
              <Check size={18} />
            ) : estadoEntorno.tono === 'warn' ? (
              <AlertTriangle size={18} />
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
