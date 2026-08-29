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
        <div className="clone-repo-header">
          <div className="clone-repo-icon">
            <GitHubLogo size={20} color="var(--accent-cyan)" />
          </div>
          <div className="clone-repo-details">
            <strong className="clone-repo-name">{repo.fullName}</strong>
            <span className="clone-repo-meta">
              {repo.language ? <span>{repo.language} · </span> : null}
              <span>{repo.isPrivate ? 'Privado 🔒' : 'Público 🌐'}</span>
              <span> · {repo.stars} ★</span>
            </span>
          </div>
        </div>

        <div className="clone-destination-section">
          <span className="clone-section-label">
            SELECCIONA DÓNDE GUARDAR EL PROYECTO
          </span>

          {/* Option 1: Default Folder */}
          <div
            className={`clone-choice-card ${destinationMode === 'default' ? 'active' : ''}`}
            onClick={() => setDestinationMode('default')}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') setDestinationMode('default') }}
          >
            <div className="clone-card-header">
              <label className="clone-radio-label" onClick={e => e.stopPropagation()}>
                <input
                  type="radio"
                  name="destinationMode"
                  checked={destinationMode === 'default'}
                  onChange={() => setDestinationMode('default')}
                />
                <strong className="clone-card-title">Ruta predeterminada</strong>
              </label>
              <span className="clone-badge">Ajustes</span>
            </div>
            <div className="clone-path-box">
              <code>{defaultTarget}</code>
            </div>
          </div>

          {/* Option 2: Custom Folder */}
          <div
            className={`clone-choice-card ${destinationMode === 'custom' ? 'active' : ''}`}
            onClick={() => setDestinationMode('custom')}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') setDestinationMode('custom') }}
          >
            <div className="clone-card-header">
              <label className="clone-radio-label" onClick={e => e.stopPropagation()}>
                <input
                  type="radio"
                  name="destinationMode"
                  checked={destinationMode === 'custom'}
                  onChange={() => setDestinationMode('custom')}
                />
                <strong className="clone-card-title">Ruta personalizada</strong>
              </label>
            </div>

            <div className="clone-custom-input-row" onClick={e => e.stopPropagation()}>
              <input
                type="text"
                value={customPath}
                onChange={e => {
                  setCustomPath(e.target.value)
                  setDestinationMode('custom')
                }}
                placeholder="/ruta/personalizada/proyecto"
                className="clone-input-field"
              />
              <button
                type="button"
                className="secondary clone-browse-btn"
                onClick={handleBrowseCustom}
              >
                <FolderOpen size={14} /> Explorar
              </button>
            </div>

            {destinationMode === 'custom' && (
              <label className="clone-checkbox-label" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={setAsDefault}
                  onChange={e => setSetAsDefault(e.target.checked)}
                />
                <span>Guardar y establecer esta carpeta como mi nueva ruta predeterminada</span>
              </label>
            )}
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 12 }}>
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
