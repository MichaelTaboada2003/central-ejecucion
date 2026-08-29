import { ArrowUpRight, Check, Cloud, CloudOff, DownloadCloud, FolderOpen, GitFork, Globe, LayoutGrid, List, LoaderCircle, Lock, RefreshCw, Search, Settings2, Star, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../api'
import { formatRelative, getStackClass } from '../../lib/format'
import { normalizeSearchText } from '../../lib/projects'
import type { GitHubAccountStatus, GitHubRepo } from '../../types'
import { GitHubLogo } from '../../components/GitHubLogo'
import { StatCard } from '../../components/Primitives'

export function GitHubHubView({
  status,
  repos,
  loading,
  onRefresh,
  onClone,
  onOpenLocal,
  onSafeOffload,
  onOpenSettings,
  busy,
}: {
  status: GitHubAccountStatus | null
  repos: GitHubRepo[]
  loading: boolean
  onRefresh: () => void
  onClone: (repo: GitHubRepo) => void
  onOpenLocal: (repo: GitHubRepo) => void
  onSafeOffload: (repo: GitHubRepo) => void
  onOpenSettings: () => void
  busy: string | null
}) {
  const [filter, setFilter] = useState<'all' | 'owner' | 'cloud' | 'local' | 'public' | 'private'>('all')
  const [query, setQuery] = useState('')
  const [layoutMode, setLayoutMode] = useState<'table' | 'grid'>('table')

  const ownerPrefix = status?.username ? `${status.username.toLowerCase()}/` : ''

  const stats = useMemo(() => {
    const total = repos.length
    const owned = ownerPrefix ? repos.filter(r => r.fullName.toLowerCase().startsWith(ownerPrefix)).length : total
    const cloned = repos.filter(r => r.isCloned).length
    const cloudOnly = total - cloned
    const totalStars = repos.reduce((sum, r) => sum + r.stars, 0)
    return { total, owned, cloned, cloudOnly, totalStars }
  }, [repos, ownerPrefix])

  const filteredRepos = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query.trim())
    const tokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : []
    return repos.filter(r => {
      if (tokens.length > 0) {
        const matchQuery = normalizeSearchText(`${r.name} ${r.fullName} ${r.language || ''} ${r.description || ''}`)
        if (!tokens.every(token => matchQuery.includes(token))) return false
      }

      if (filter === 'owner') return ownerPrefix ? r.fullName.toLowerCase().startsWith(ownerPrefix) : true
      if (filter === 'cloud') return !r.isCloned
      if (filter === 'local') return r.isCloned
      if (filter === 'public') return !r.isPrivate
      if (filter === 'private') return r.isPrivate
      return true
    })
  }, [repos, filter, query, ownerPrefix])

  return (
    <div className="github-hub-layout">
      <div className="dashboard-title">
        <div>
          <p className="eyebrow">WORKSPACE EN LA NUBE</p>
          <h1>GitHub</h1>
          <p>
            Explora tus repositorios remotos, clónalos bajo demanda con un clic y libéralos de tu disco de forma segura cuando termines de trabajar.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={onRefresh} disabled={loading || !!busy}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? 'Sincronizando…' : 'Actualizar Repos'}
          </button>
          <button className="primary" onClick={onOpenSettings}>
            <Settings2 size={16} /> {status?.authenticated ? 'Ajustes' : 'Conectar GitHub'}
          </button>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard
          label="Total en GitHub"
          value={stats.total || (status?.totalRepos ?? 0)}
          status="neutral"
          icon={<GitHubLogo size={18} color="var(--accent-cyan)" />}
        />
        <StatCard
          label="Solo en Nube (0 MB)"
          value={stats.cloudOnly}
          status="stopped"
          icon={<DownloadCloud size={18} />}
        />
        <StatCard
          label="Clonados en tu Mac"
          value={stats.cloned}
          status="running"
          icon={<FolderOpen size={18} />}
        />
        <StatCard
          label="Estrellas Totales"
          value={stats.totalStars}
          status="neutral"
          icon={<Star size={18} />}
        />
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <h2>Repositorios en la Nube</h2>
            <p>
              {filteredRepos.length
                ? `${filteredRepos.length} repositorio(s) disponibles ${status?.username ? `en tu cuenta @${status.username}` : 'en GitHub'}`
                : 'No se encontraron repositorios con ese criterio'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="search" style={{ maxWidth: 280, width: '100%' }}>
              <Search size={15} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder="Buscar repositorios…"
                aria-label="Buscar repositorios"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setQuery('')}
                  title="Limpiar búsqueda (Esc)"
                  aria-label="Limpiar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="filter-group">
              {(['all', 'owner', 'cloud', 'local', 'public', 'private'] as const).map(f => {
                const label =
                  f === 'all'
                    ? `Todos (${stats.total})`
                    : f === 'owner'
                    ? `Propios (${stats.owned})`
                    : f === 'cloud'
                    ? `Solo Nube (${stats.cloudOnly})`
                    : f === 'local'
                    ? `Clonados (${stats.cloned})`
                    : f === 'public'
                    ? 'Públicos'
                    : 'Privados'
                return (
                  <button
                    key={f}
                    className={filter === f ? 'active' : ''}
                    onClick={() => setFilter(f)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="view-mode-toggles">
              <button
                className={`view-toggle-btn ${layoutMode === 'table' ? 'active' : ''}`}
                onClick={() => setLayoutMode('table')}
                title="Vista en tabla (Igual al Panel Local)"
                aria-label="Vista en tabla"
                aria-pressed={layoutMode === 'table'}
              >
                <List size={15} />
              </button>
              <button
                className={`view-toggle-btn ${layoutMode === 'grid' ? 'active' : ''}`}
                onClick={() => setLayoutMode('grid')}
                title="Vista en tarjetas"
                aria-label="Vista en tarjetas"
                aria-pressed={layoutMode === 'grid'}
              >
                <LayoutGrid size={15} />
              </button>
            </div>
          </div>
        </div>

        {loading && !repos.length ? (
          <div className="empty-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
            <LoaderCircle size={28} className="spin" style={{ margin: '0 auto 12px', display: 'block' }} />
            <h3>Sincronizando repositorios con GitHub…</h3>
            <p>Consultando el catálogo de @{status?.username || 'tu cuenta'}…</p>
          </div>
        ) : filteredRepos.length ? (
          layoutMode === 'table' ? (
            <div className="github-table" role="table">
              <div className="github-table-head" role="row">
                <span>Repositorio</span>
                <span>Lenguaje / Visibilidad</span>
                <span>Estado</span>
                <span>Métricas</span>
                <span>Actualización</span>
                <span style={{ textAlign: 'right' }}>Acciones</span>
              </div>
              {filteredRepos.map(repo => {
                const isCloning = busy === `clone:${repo.name}`
                return (
                  <div
                    className={`github-table-row ${repo.isCloned ? 'is-cloned' : ''}`}
                    key={repo.id}
                    style={{ cursor: 'pointer' }}
                    title={`Abrir «${repo.fullName}» en GitHub`}
                    onClick={() => void api.openExternalUrl(repo.htmlUrl)}
                  >
                    <span className="project-cell">
                      <span className="mini-icon">
                        <GitHubLogo size={18} color={repo.isCloned ? 'var(--accent-primary)' : 'var(--accent-cyan)'} />
                      </span>
                      <span className="project-info">
                        <span
                          className="github-title-link"
                          title={`Abrir ${repo.fullName} en GitHub`}
                        >
                          <strong>{repo.name}</strong>
                          <ArrowUpRight size={13} style={{ opacity: 0.6 }} />
                        </span>
                        <small title={repo.description || repo.fullName}>
                          {repo.fullName} {repo.description ? `· ${repo.description}` : ''}
                        </small>
                      </span>
                    </span>

                    <span className="stack-list" style={{ alignItems: 'center' }}>
                      {repo.language ? (
                        <em className={`stack-badge ${getStackClass(repo.language)}`}>
                          {repo.language}
                        </em>
                      ) : (
                        <em className="stack-badge">Repo</em>
                      )}
                      {repo.isPrivate ? (
                        <span className="vis-badge private" title="Repositorio privado">
                          <Lock size={10} /> Privado
                        </span>
                      ) : (
                        <span className="vis-badge public" title="Repositorio público">
                          <Globe size={10} /> Público
                        </span>
                      )}
                    </span>

                    <span>
                      {repo.isCloned ? (
                        <span className="status-pill status-running">
                          <Check size={11} /> En tu Mac
                        </span>
                      ) : (
                        <span className="status-pill status-stopped">
                          <Cloud size={11} /> Solo Nube
                        </span>
                      )}
                    </span>

                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Star size={12} color="var(--accent-amber)" /> {repo.stars}
                      </span>
                      {repo.forks > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <GitFork size={12} /> {repo.forks}
                        </span>
                      )}
                    </span>

                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {new Date(repo.updatedAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>

                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                      {repo.isCloned ? (
                        <>
                          <button
                            className="table-action-icon-btn open"
                            onClick={e => {
                              e.stopPropagation()
                              onOpenLocal(repo)
                            }}
                            title={repo.localProjectId ? 'Abrir en Panel Local' : 'Está en tu disco pero no registrado en el panel'}
                          >
                            <FolderOpen size={15} />
                          </button>
                          <button
                            className="table-action-icon-btn offload"
                            onClick={e => {
                              e.stopPropagation()
                              onSafeOffload(repo)
                            }}
                            title="Archivar en GitHub y liberar espacio de disco (elimina copia local de forma segura)"
                          >
                            <CloudOff size={15} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="primary"
                          onClick={e => {
                            e.stopPropagation()
                            onClone(repo)
                          }}
                          disabled={isCloning || !!busy}
                          style={{ height: 28, fontSize: 11, padding: '0 12px', borderRadius: 4 }}
                        >
                          {isCloning ? (
                            <>
                              <LoaderCircle size={12} className="spin" /> Clonando…
                            </>
                          ) : (
                            <>
                              <DownloadCloud size={12} /> Clonar
                            </>
                          )}
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="repo-grid">
              {filteredRepos.map(repo => {
                const isCloning = busy === `clone:${repo.name}`
                // El dueño solo se muestra cuando NO eres tú: repetir «demo/» en
                // cada tarjeta de tu propia cuenta es ruido, igual que lo era la
                // píldora «PÚBLICO» en todas.
                const [duenio] = repo.fullName.split('/')
                const deOtro = Boolean(status?.username) && duenio !== status?.username
                return (
                  /* La materialidad de la tarjeta ES el dato: lo que está en tu
                     disco tiene cuerpo y lomo de color; lo que sigue en la nube
                     es un contorno vacío. Así la grilla se lee como un
                     inventario y no como tres tarjetas idénticas. */
                  <article
                    key={repo.id}
                    className={`repo-card ${repo.isCloned ? 'presente' : 'ausente'}`}
                    data-lenguaje={(repo.language ?? '').toLowerCase()}
                  >
                    <header className="repo-card-head">
                      <h3 className="repo-nombre">
                        <button
                          type="button"
                          className="repo-enlace"
                          onClick={() => void api.openExternalUrl(repo.htmlUrl)}
                          title={`Abrir ${repo.fullName} en GitHub`}
                        >
                          {deOtro && <span className="repo-duenio">{duenio}/</span>}
                          {repo.name}
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </button>
                      </h3>
                      {repo.isPrivate && (
                        <span className="repo-privado" title="Repositorio privado">
                          <Lock size={11} aria-hidden="true" />
                        </span>
                      )}
                    </header>

                    {repo.description && <p className="repo-desc">{repo.description}</p>}

                    <p className="repo-meta">
                      {repo.language && (
                        <>
                          <span className="repo-lenguaje">{repo.language}</span>
                          <span aria-hidden="true"> · </span>
                        </>
                      )}
                      {formatRelative(repo.updatedAt)}
                      {repo.stars > 0 && <span aria-hidden="true"> · {repo.stars} ★</span>}
                    </p>

                    <footer className="repo-card-pie">
                      <span className="repo-estado">{repo.isCloned ? 'En tu Mac' : 'Solo en la nube'}</span>
                      <span className="repo-acciones">
                        {repo.isCloned ? (
                          <>
                            <button type="button" onClick={() => onOpenLocal(repo)}>
                              <FolderOpen size={13} aria-hidden="true" /> Abrir
                            </button>
                            <button
                              type="button"
                              className="liberar"
                              onClick={() => onSafeOffload(repo)}
                              title="Comprueba que todo esté en GitHub y borra la copia local"
                            >
                              <CloudOff size={13} aria-hidden="true" /> Liberar
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => onClone(repo)} disabled={isCloning || !!busy}>
                            {isCloning ? (
                              <LoaderCircle size={13} className="spin" aria-hidden="true" />
                            ) : (
                              <DownloadCloud size={13} aria-hidden="true" />
                            )}
                            {isCloning ? 'Clonando…' : 'Clonar'}
                          </button>
                        )}
                      </span>
                    </footer>
                  </article>
                )
              })}
            </div>
          )
        ) : (
          <div className="empty-card" style={{ padding: '36px 20px', textAlign: 'center' }}>
            <Cloud size={32} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
            <h3>No se encontraron repositorios con los filtros seleccionados</h3>
            <p>Prueba buscando con otro término o cambiando los filtros superiores.</p>
          </div>
        )}
      </section>
    </div>
  )
}
