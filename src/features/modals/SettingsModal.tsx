import { Check, FolderOpen, LoaderCircle, Settings2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api } from '../../api'
import type { GitHubAccountStatus, IdeSettings } from '../../types'
import { Modal } from '../../components/Modal'
import { LoadingInline } from '../../components/Primitives'
import { GitHubLogo } from '../../components/GitHubLogo'

export function SettingsModal({
  settings,
  githubStatus,
  defaultCloneDir,
  onClose,
  onSaveIde,
  onSaveGitHubToken,
  onSaveDefaultCloneDir,
}: {
  settings: IdeSettings | null
  githubStatus: GitHubAccountStatus | null
  defaultCloneDir: string
  onClose: () => void
  onSaveIde: (settings: IdeSettings) => Promise<void>
  onSaveGitHubToken: (token: string) => Promise<void>
  onSaveDefaultCloneDir: (path: string) => Promise<void>
}) {
  const [tools, setTools] = useState(settings?.tools || [])
  const [tokenInput, setTokenInput] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [tokenMessage, setTokenMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [cloneDirInput, setCloneDirInput] = useState(defaultCloneDir)
  const [savingCloneDir, setSavingCloneDir] = useState(false)
  const [cloneDirMessage, setCloneDirMessage] = useState<string | null>(null)

  useEffect(() => setTools(settings?.tools || []), [settings])
  useEffect(() => setCloneDirInput(defaultCloneDir), [defaultCloneDir])

  const handleTokenSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!tokenInput.trim()) return
    setSavingToken(true)
    setTokenMessage(null)
    try {
      await onSaveGitHubToken(tokenInput.trim())
      setTokenMessage({ kind: 'success', text: 'Token de GitHub guardado y verificado.' })
      setTokenInput('')
    } catch (err) {
      setTokenMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Error al verificar token con GitHub.',
      })
    } finally {
      setSavingToken(false)
    }
  }

  const handleCloneDirBrowse = async () => {
    try {
      const result = await api.pickFolder({
        title: 'Selecciona la carpeta base para clonar repositorios',
        defaultPath: cloneDirInput || defaultCloneDir,
      })
      if (result) {
        setCloneDirInput(result)
      }
    } catch (err) {
      console.warn('Dialog error:', err)
    }
  }

  const handleCloneDirSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!cloneDirInput.trim()) return
    setSavingCloneDir(true)
    setCloneDirMessage(null)
    try {
      await onSaveDefaultCloneDir(cloneDirInput.trim())
      setCloneDirMessage('Ruta base de clonación actualizada.')
    } catch (err) {
      setCloneDirMessage(err instanceof Error ? err.message : 'Error al guardar ruta.')
    } finally {
      setSavingCloneDir(false)
    }
  }

  return (
    <Modal title="Configuración de la Aplicación" onClose={onClose}>
      <div className="form-stack">
        {/* GitHub Cloud Connection */}
        <div style={{ padding: 14, background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <GitHubLogo size={16} color="var(--accent-cyan)" /> Integración GitHub
            </strong>
            {githubStatus?.authenticated ? (
              <span className="status-pill status-running" style={{ fontSize: 11 }}>
                Conectado (@{githubStatus.username})
              </span>
            ) : (
              <span className="status-pill status-stopped" style={{ fontSize: 11 }}>
                No conectado
              </span>
            )}
          </div>
          <p className="modal-copy" style={{ margin: '4px 0 10px' }}>
            Ingresa tu Personal Access Token (PAT) clásico o fine-grained de GitHub para sincronizar repositorios públicos y privados.
          </p>

          {githubStatus?.authenticated && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0', padding: '10px 12px', background: 'var(--bg-surface-0)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              {githubStatus.avatarUrl ? (
                <img
                  src={githubStatus.avatarUrl}
                  alt={githubStatus.username || 'Avatar'}
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: 'rgba(6, 182, 212, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent-cyan)',
                    fontWeight: 700,
                    fontSize: 13,
                    flexShrink: 0,
                  }}
                >
                  {(githubStatus.username || 'GH').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13, display: 'block', color: 'var(--text-primary)' }}>{githubStatus.name || githubStatus.username}</strong>
                <small style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{githubStatus.totalRepos} repositorios · Token: {githubStatus.tokenPreview || 'Guardado'}</small>
              </div>
            </div>
          )}

          <form onSubmit={handleTokenSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="github_pat_... o ghp_..."
              style={{ flex: 1 }}
            />
            <button className="secondary" type="submit" disabled={!tokenInput.trim() || savingToken}>
              {savingToken ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Guardar Token
            </button>
          </form>

          {tokenMessage && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: tokenMessage.kind === 'success' ? 'var(--accent-primary)' : 'var(--accent-rose)' }}>
              {tokenMessage.text}
            </p>
          )}
        </div>

        {/* Default Clone Directory */}
        <div style={{ padding: 14, background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <FolderOpen size={16} color="var(--accent-primary)" /> Carpeta de Clonación por Defecto
            </strong>
          </div>
          <p className="modal-copy" style={{ margin: '4px 0 10px' }}>
            Los repositorios que clones desde GitHub se descargarán dentro de este directorio base (ej. <code>~/Projects</code> o tu carpeta favorita).
          </p>

          <form onSubmit={handleCloneDirSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={cloneDirInput}
              onChange={e => setCloneDirInput(e.target.value)}
              placeholder="/ruta/a/tus/proyectos"
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <button type="button" className="secondary" onClick={handleCloneDirBrowse}>
              <FolderOpen size={14} /> Explorar
            </button>
            <button className="primary" type="submit" disabled={!cloneDirInput.trim() || savingCloneDir}>
              {savingCloneDir ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Guardar
            </button>
          </form>

          {cloneDirMessage && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--accent-primary)' }}>
              {cloneDirMessage}
            </p>
          )}
        </div>

        {/* IDE & Editor Tools */}
        {settings ? (
          <form
            className="form-stack"
            style={{ marginTop: 8 }}
            onSubmit={event => {
              event.preventDefault()
              void onSaveIde({ tools })
            }}
          >
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <Settings2 size={16} /> Editores e IDEs Locales
            </strong>
            <p className="modal-copy">
              Configura el comando o ruta para Antigravity IDE (ej: <code>agy</code>) y Codex (ej: <code>codex</code>).
            </p>
            {tools.map((tool, index) => (
              <label key={tool.id}>
                {tool.label}
                <span className="tool-input">
                  <input
                    value={tool.command || ''}
                    onChange={event =>
                      setTools(current =>
                        current.map((item, position) =>
                          position === index ? { ...item, command: event.target.value || null } : item
                        )
                      )
                    }
                    placeholder={tool.id === 'antigravity' ? 'agy o ruta de app' : tool.id === 'codex' ? 'codex' : tool.id}
                  />
                  <span className={tool.available ? 'available' : 'unavailable'}>
                    {tool.available ? 'Disponible' : 'No detectado'}
                  </span>
                </span>
              </label>
            ))}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>
                Cerrar
              </button>
              <button className="primary" type="submit">
                <Check size={16} /> Guardar editores
              </button>
            </div>
          </form>
        ) : (
          <LoadingInline />
        )}
      </div>
    </Modal>
  )
}
