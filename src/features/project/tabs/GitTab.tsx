import { ArrowUpRight, Check, Cloud, DownloadCloud, GitFork, LoaderCircle, RefreshCw, UploadCloud } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../api'
import { canCommit, commitCounterState, selectedPaths, toggleExcluded } from '../../../lib/commit'
import { formatRelative } from '../../../lib/format'
import type { GitHubRepo, GitStatusInfo, Project } from '../../../types'
import { GitHubLogo } from '../../../components/GitHubLogo'
import { PublishToGitHub, normalizarNombreRepo } from './PublishToGitHub'

export function GitTab({
  project,
  gitHubRepo,
  onNotify,
  onReloadProject,
}: {
  project: Project
  gitHubRepo?: GitHubRepo
  onNotify: (text: string, kind: 'success' | 'error' | 'info') => void
  onReloadProject: () => void
}) {
  const [gitStatus, setGitStatus] = useState<GitStatusInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [comprobando, setComprobando] = useState(false)
  const comprobadoRef = useRef(false)
  const publicarRef = useRef<HTMLDivElement>(null)
  const [publishName, setPublishName] = useState(project.name)
  const [publishDesc, setPublishDesc] = useState('')
  const [publishPrivate, setPublishPrivate] = useState(false)

  const changes = gitStatus?.uncommittedChanges ?? []
  const changedPaths = useMemo(() => changes.map(file => file.path), [changes])
  const selectedFiles = useMemo(() => selectedPaths(changes, excluded), [changes, excluded])
  const allSelected = selectedFiles.length === changedPaths.length && changedPaths.length > 0

  const toggleFile = (path: string) => setExcluded(prev => toggleExcluded(prev, path))

  const loadGitStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.getProjectGitStatus(project.id)
      setGitStatus(res)
    } catch (err) {
      console.warn('Error al cargar git status:', err)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  /** Consulta a GitHub sin tocar el trabajo local. Es lo que hace que «por
   *  bajar» signifique algo: git cuenta contra su copia de `origin/*`. */
  const comprobarGitHub = useCallback(
    async ({ silencioso }: { silencioso: boolean }) => {
      setComprobando(true)
      try {
        setGitStatus(await api.gitFetch(project.id))
      } catch (err: any) {
        if (!silencioso) onNotify(err?.message || String(err), 'error')
      } finally {
        setComprobando(false)
      }
    },
    [project.id, onNotify]
  )

  useEffect(() => {
    void loadGitStatus()
  }, [loadGitStatus])

  // Al abrir la pestaña se comprueba una vez en segundo plano: si falla la red o
  // el token, la pestaña sigue siendo útil con los datos locales y no se
  // interrumpe con un error que el usuario no pidió.
  useEffect(() => {
    if (!gitStatus?.isRepo || !gitStatus.remoteUrl || comprobadoRef.current) return
    comprobadoRef.current = true
    void comprobarGitHub({ silencioso: true })
  }, [gitStatus?.isRepo, gitStatus?.remoteUrl, comprobarGitHub])

  const handlePull = async () => {
    setBusy('pull')
    try {
      const res = await api.gitPull(project.id)
      onNotify(res.message, 'success')
      await loadGitStatus()
    } catch (err: any) {
      onNotify(err?.message || String(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const handlePush = async () => {
    setBusy('push')
    try {
      const res = await api.gitPush(project.id)
      onNotify(res.message, 'success')
      await loadGitStatus()
    } catch (err: any) {
      onNotify(err?.message || String(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  // Commit y push son dos acciones distintas: juntarlas hacía que un fallo de
  // red diera por fracasado un commit que sí se había hecho.
  const handleCommit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canCommit(commitMessage, selectedFiles)) return
    setBusy('commit')
    try {
      const res = await api.gitCommit(project.id, commitMessage.trim(), selectedFiles)
      onNotify(res.message, 'success')
      setCommitMessage('')
      setExcluded(new Set())
      await loadGitStatus()
    } catch (err: any) {
      onNotify(err?.message || String(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const handlePublish = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('publish')
    try {
      const res = await api.publishToGitHub({
        projectId: project.id,
        // Se envía el nombre YA normalizado, que es el que enseña la vista
        // previa: mandar el crudo hacía que GitHub creara otro distinto del que
        // el usuario acababa de leer en pantalla.
        repoName: normalizarNombreRepo(publishName) || normalizarNombreRepo(project.name),
        description: publishDesc.trim() || undefined,
        isPrivate: publishPrivate,
      })
      onNotify(res.message, 'success')
      await loadGitStatus()
      onReloadProject()
    } catch (err: any) {
      onNotify(err?.message || String(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (loading && !gitStatus) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <LoaderCircle size={24} className="spin" style={{ margin: '0 auto 10px' }} />
        <p>Consultando estado de Git y GitHub…</p>
      </div>
    )
  }

  if (!gitStatus?.isRepo) {
    return (
      <div className="git-tab">
        <div className="git-publish-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ padding: 10, borderRadius: 10, background: 'rgba(6, 182, 212, 0.12)', color: 'var(--accent-cyan)' }}>
              <Cloud size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0 }}>Publicar este proyecto en GitHub</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                Este proyecto aún no está vinculado a un repositorio remoto en GitHub. Inicializa Git y publícalo en tu cuenta con 1 clic.
              </p>
            </div>
          </div>

          <PublishToGitHub
            nombre={publishName}
            setNombre={setPublishName}
            descripcion={publishDesc}
            setDescripcion={setPublishDesc}
            privado={publishPrivate}
            setPrivado={setPublishPrivate}
            usuario={gitHubRepo?.fullName.split('/')[0]}
            publicando={busy === 'publish'}
            onSubmit={handlePublish}
          />
        </div>
      </div>
    )
  }

  const hayNovedades = (gitStatus?.behindCount ?? 0) > 0

  return (
    <div className="git-tab">
      {hayNovedades && (
        <div className="git-aviso" role="status">
          <DownloadCloud size={16} aria-hidden="true" />
          <p>
            {/* Cada línea hace un trabajo: la primera dice qué pasa, la segunda
                por qué te conviene actuar ahora. */}
            <strong>
              GitHub tiene {gitStatus!.behindCount}{' '}
              {gitStatus!.behindCount === 1 ? 'commit nuevo' : 'commits nuevos'} en{' '}
              {gitStatus!.currentBranch ?? 'esta rama'}
            </strong>
            <span>
              {gitStatus!.behindCount === 1 ? 'Bájalo' : 'Bájalos'} antes de seguir trabajando: así evitas resolver
              conflictos después.
            </span>
          </p>
          <button type="button" className="primary" onClick={handlePull} disabled={!!busy}>
            {busy === 'pull' ? <LoaderCircle size={14} className="spin" /> : <DownloadCloud size={14} />}
            Bajar cambios
          </button>
        </div>
      )}

      <div className="git-status-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="git-branch-pill">
            {/* Sin rama actual el repositorio está en HEAD desacoplado, y decirlo
                importa: cualquier commit que se haga ahí no pertenece a ninguna
                rama y es fácil de perder. Antes solo se leía «HEAD». */}
            <GitFork size={14} /> {gitStatus.currentBranch || 'HEAD desacoplado'}
          </div>
          {gitStatus.aheadCount > 0 && (
            <span className="git-ahead-pill" title="Commits locales pendientes de subir">
              <ArrowUpRight size={13} /> {gitStatus.aheadCount} por subir
            </span>
          )}
          {gitStatus.behindCount > 0 && (
            <span className="git-behind-pill" title="Commits en GitHub pendientes de descargar">
              <DownloadCloud size={13} /> {gitStatus.behindCount} por bajar
            </span>
          )}
          {gitStatus.remoteUrl ? (
            <button
              type="button"
              className="github-link-pill"
              onClick={() => gitHubRepo?.htmlUrl ? void api.openExternalUrl(gitHubRepo.htmlUrl) : (gitStatus.remoteUrl && void api.openExternalUrl(gitStatus.remoteUrl))}
              title="Abrir repositorio en GitHub"
            >
              <GitHubLogo size={13} color="var(--accent-cyan)" />
              <span>{gitStatus.remoteUrl.replace('https://github.com/', '').replace('.git', '')}</span>
              <ArrowUpRight size={12} />
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sin repositorio remoto configurado</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {gitStatus.remoteUrl && (
            <span className="git-comprobado" title="Cuándo se consultó GitHub por última vez">
              {comprobando
                ? 'Comprobando…'
                : gitStatus.lastFetchAt
                  ? `Comprobado ${formatRelative(gitStatus.lastFetchAt)}`
                  : 'Sin comprobar'}
            </span>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => (gitStatus.remoteUrl ? void comprobarGitHub({ silencioso: false }) : void loadGitStatus())}
            disabled={loading || comprobando || !!busy}
            title={gitStatus.remoteUrl ? 'Comprobar si hay novedades en GitHub' : 'Recargar estado de Git'}
          >
            <RefreshCw size={14} className={loading || comprobando ? 'spin' : ''} />
          </button>
          {gitStatus.remoteUrl ? (
            <>
              <button
                type="button"
                className="secondary"
                onClick={handlePull}
                disabled={!!busy}
                title="Descargar cambios de GitHub (git pull)"
              >
                {busy === 'pull' ? <LoaderCircle size={14} className="spin" /> : <DownloadCloud size={14} />}
                Pull
              </button>
              <button
                type="button"
                className="primary"
                onClick={handlePush}
                disabled={!!busy || gitStatus.aheadCount === 0}
                title="Subir commits a GitHub (git push)"
              >
                {busy === 'push' ? <LoaderCircle size={14} className="spin" /> : <UploadCloud size={14} />}
                Push {gitStatus.aheadCount > 0 ? `(${gitStatus.aheadCount})` : ''}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => {
                publicarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                publicarRef.current?.querySelector('input')?.focus()
              }}
            >
              <UploadCloud size={14} /> Publicar en GitHub
            </button>
          )}
        </div>
      </div>

      <div className="git-grid-layout">
        {/* Cambios pendientes & Commit rápido */}
        <div className="git-card">
          <div className="git-card-head">
            <h3>
              Cambios pendientes {gitStatus.uncommittedChanges.length ? `(${gitStatus.uncommittedChanges.length})` : ''}
            </h3>
            {gitStatus.uncommittedChanges.length === 0 ? (
              <span className="git-clean-note">
                <Check size={14} /> Directorio de trabajo limpio
              </span>
            ) : (
              <button
                type="button"
                className="git-select-all"
                onClick={() => setExcluded(allSelected ? new Set(changedPaths) : new Set())}
              >
                {allSelected ? 'Quitar todos' : 'Seleccionar todos'}
              </button>
            )}
          </div>

          {gitStatus.uncommittedChanges.length > 0 ? (
            <>
              {/* Cada archivo se puede dejar fuera del commit. */}
              <div className="git-file-list">
                {gitStatus.uncommittedChanges.map(file => {
                  const included = !excluded.has(file.path)
                  return (
                    <label
                      key={file.path}
                      className={`git-file-item selectable ${included ? '' : 'excluded'}`}
                      title={file.path}
                    >
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleFile(file.path)}
                        aria-label={`Incluir ${file.path} en el commit`}
                      />
                      <span className="git-file-path">{file.path}</span>
                      <span className={`git-status-tag ${file.status}`}>
                        {file.status === 'modified' ? 'M' : file.status === 'untracked' || file.status === 'added' ? '+' : file.status === 'deleted' ? 'D' : file.status}
                      </span>
                    </label>
                  )
                })}
              </div>

              <form onSubmit={handleCommit} className="commit-composer">
                <div className="commit-composer-head">
                  <label htmlFor="commit-message">Mensaje del commit</label>
                  <span
                    className={`commit-counter ${commitCounterState(commitMessage.length)}`}
                    title="Se recomienda que el resumen no pase de 50 caracteres, y nunca de 72"
                  >
                    {commitMessage.length}/72
                  </span>
                </div>
                <textarea
                  id="commit-message"
                  className="commit-input"
                  rows={2}
                  spellCheck={false}
                  placeholder="fix: corregir el cálculo del total en la factura"
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  onKeyDown={e => {
                    // Enter envía; Mayús+Enter deja escribir un cuerpo largo.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleCommit(e as unknown as FormEvent)
                    }
                  }}
                  required
                />
                <div className="commit-composer-foot">
                  <span className="commit-selection-note">
                    {selectedFiles.length === 0
                      ? 'No has seleccionado ningún archivo'
                      : `Entran ${selectedFiles.length} de ${changedPaths.length} archivo${changedPaths.length === 1 ? '' : 's'}`}
                  </span>
                  <button
                    type="submit"
                    className="primary"
                    disabled={busy === 'commit' || !canCommit(commitMessage, selectedFiles)}
                  >
                    {busy === 'commit' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                    Hacer commit
                  </button>
                </div>
                {/* El commit es local; subir es el otro botón. */}
                <p className="commit-composer-hint">
                  El commit se queda en tu equipo.{' '}
                  {gitStatus.remoteUrl
                    ? 'Para publicarlo usa «Push».'
                    : 'Este proyecto no tiene remoto configurado.'}
                </p>
              </form>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>
              No tienes archivos modificados sin commitear en este proyecto.
            </p>
          )}

          {gitStatus.lastCommitMessage && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-tertiary)', display: 'block', fontSize: 11, marginBottom: 2 }}>ÚLTIMO COMMIT</span>
              <strong>{gitStatus.lastCommitMessage}</strong>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                <span>{gitStatus.lastCommitHash}</span>
                <span>·</span>
                <span>{gitStatus.lastCommitDate}</span>
              </div>
            </div>
          )}
        </div>

        {/* Ramas Locales y Remotas / Publicar */}
        <div className="git-card">
          <h3 style={{ margin: 0, fontSize: 14 }}>Ramas del Proyecto</h3>
          {gitStatus.branches.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.05em' }}>RAMAS LOCALES</span>
              {gitStatus.branches.map(b => (
                <div
                  key={b}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: b === gitStatus.currentBranch ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-surface-2)',
                    border: `1px solid ${b === gitStatus.currentBranch ? 'var(--accent-primary-border)' : 'var(--border-subtle)'}`,
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: b === gitStatus.currentBranch ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                    <GitFork size={13} /> {b}
                  </span>
                  {b === gitStatus.currentBranch && (
                    <span style={{ fontSize: 10, color: 'var(--accent-primary)', fontWeight: 600 }}>ACTIVA</span>
                  )}
                </div>
              ))}

              {gitStatus.remoteBranches.length > 0 && (
                <>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.05em', marginTop: 8 }}>
                    RAMAS REMOTAS (GITHUB)
                  </span>
                  {gitStatus.remoteBranches.map(rb => (
                    <div
                      key={rb}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'var(--bg-surface-2)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: 12,
                        color: 'var(--accent-cyan)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <GitHubLogo size={12} color="var(--accent-cyan)" /> {rb}
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-tertiary)' }}>Sin ramas registradas.</p>
          )}

          {/* Un proyecto con git pero sin remoto: el formulario vive aquí, no
              escondido tras un botón que no abría nada. */}
          {!gitStatus.remoteUrl && (
            <div className="publicar-bloque" ref={publicarRef}>
              <h4>Publicar en GitHub</h4>
              <p>Este proyecto todavía no está en GitHub. Se creará el repositorio y se subirá la rama actual.</p>
              <PublishToGitHub
                nombre={publishName}
                setNombre={setPublishName}
                descripcion={publishDesc}
                setDescripcion={setPublishDesc}
                privado={publishPrivate}
                setPrivado={setPublishPrivate}
                usuario={gitHubRepo?.fullName.split('/')[0]}
                publicando={busy === 'publish'}
                onSubmit={handlePublish}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
