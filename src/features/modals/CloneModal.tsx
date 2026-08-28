import { DownloadCloud, FolderOpen, LoaderCircle } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api } from '../../api'
import type { GitHubRepo } from '../../types'
import { Modal } from '../../components/Modal'
import { GitHubLogo } from '../../components/GitHubLogo'

export function CloneModal({
  repo,
  defaultCloneDir,
  onClose,
  onConfirmClone,
  busy,
}: {
  repo: GitHubRepo
  defaultCloneDir: string
  onClose: () => void
  onConfirmClone: (repo: GitHubRepo, targetPath: string, setAsDefault: boolean) => Promise<void>
  busy: boolean
}) {
  const [destinationMode, setDestinationMode] = useState<'default' | 'custom'>('default')
  const defaultBase = defaultCloneDir.replace(/\/+$/, '') || '/workspace'
  const defaultTarget = `${defaultBase}/${repo.name}`
  const [customPath, setCustomPath] = useState(defaultTarget)
  const [setAsDefault, setSetAsDefault] = useState(false)

  const handleBrowseCustom = async () => {
    try {
      const result = await api.pickFolder({
        title: `Selecciona carpeta destino para «${repo.name}»`,
        defaultPath: defaultBase,
      })
      if (result) {
        const finalPath = `${result.replace(/\/+$/, '')}/${repo.name}`
        setCustomPath(finalPath)
        setDestinationMode('custom')
      }
    } catch (err) {
      console.warn('Dialog error:', err)
    }
  }

  const effectivePath = destinationMode === 'default' ? defaultTarget : customPath

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!effectivePath.trim()) return
    await onConfirmClone(repo, effectivePath.trim(), setAsDefault && destinationMode === 'custom')
  }

  return (
    <Modal title="Clonar Repositorio de GitHub" onClose={onClose}>
      <form onSubmit={handleSubmit} className="form-stack">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div className="mini-icon" style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface-3)' }}>
            <GitHubLogo size={20} color="var(--accent-cyan)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 14, display: 'block' }}>{repo.fullName}</strong>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {repo.language ? `${repo.language} · ` : ''}{repo.isPrivate ? 'Privado 🔒' : 'Público 🌐'} · {repo.stars} ★
            </span>
          </div>
        </div>

        <div className="clone-destination-selector" style={{ marginTop: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
            SELECCIONA DÓNDE GUARDAR EL PROYECTO
          </label>

          {/* Option 1: Default Folder */}
          <div
            className={`clone-choice-card ${destinationMode === 'default' ? 'active' : ''}`}
            onClick={() => setDestinationMode('default')}
            style={{
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              border: destinationMode === 'default' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              background: destinationMode === 'default' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface-1)',
              cursor: 'pointer',
              marginBottom: 8,
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="radio"
                name="destinationMode"
                checked={destinationMode === 'default'}
                onChange={() => setDestinationMode('default')}
              />
              <strong style={{ fontSize: 13 }}>Ruta predeterminada</strong>
              <span className="badge-pill" style={{ fontSize: 10, marginLeft: 'auto', background: 'var(--bg-surface-3)', padding: '2px 6px', borderRadius: 4 }}>
                Ajustes
              </span>
            </div>
            <p style={{ margin: '6px 0 0 24px', fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
              {defaultTarget}
            </p>
          </div>

          {/* Option 2: Custom Folder */}
          <div
            className={`clone-choice-card ${destinationMode === 'custom' ? 'active' : ''}`}
            onClick={() => setDestinationMode('custom')}
            style={{
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              border: destinationMode === 'custom' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              background: destinationMode === 'custom' ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface-1)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="radio"
                name="destinationMode"
                checked={destinationMode === 'custom'}
                onChange={() => setDestinationMode('custom')}
              />
              <strong style={{ fontSize: 13 }}>Ruta personalizada</strong>
            </div>

            <div style={{ display: 'flex', gap: 8, marginLeft: 24 }} onClick={e => e.stopPropagation()}>
              <input
                type="text"
                value={customPath}
                onChange={e => {
                  setCustomPath(e.target.value)
                  setDestinationMode('custom')
                }}
                placeholder="/ruta/personalizada/proyecto"
                style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)' }}
              />
              <button type="button" className="secondary" onClick={handleBrowseCustom} style={{ height: 34, fontSize: 12, padding: '0 12px' }}>
                <FolderOpen size={14} /> Explorar
              </button>
            </div>

            {destinationMode === 'custom' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, marginLeft: 24, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={setAsDefault}
                  onChange={e => setSetAsDefault(e.target.checked)}
                />
                Guardar y establecer esta carpeta como mi nueva ruta predeterminada
              </label>
            )}
          </div>
        </div>

        <div className="form-actions" style={{ marginTop: 16 }}>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy || !effectivePath.trim()}>
            {busy ? (
              <>
                <LoaderCircle size={14} className="spin" /> Clonando…
              </>
            ) : (
              <>
                <DownloadCloud size={14} /> Clonar en esta ruta
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
