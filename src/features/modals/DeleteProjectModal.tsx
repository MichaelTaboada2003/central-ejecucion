import { AlertOctagon, Folder, HardDrive, Layers, LoaderCircle, Trash2 } from 'lucide-react'
import { formatBytes } from '../../lib/format'
import type { Project } from '../../types'
import { Modal } from '../../components/Modal'

export function DeleteProjectModal({
  candidate,
  onClose,
  onConfirm,
  busy,
}: {
  candidate: Project
  onClose: () => void
  onConfirm: (candidate: Project) => void
  busy: boolean
}) {
  return (
    <Modal title="Eliminar Proyecto" onClose={onClose}>
      <div className="delete-modal-container">
        <div className="delete-hero-section">
          <div className="delete-hero-icon">
            <Trash2 size={28} />
          </div>
          <div className="delete-hero-content">
            <h3>¿Eliminar «{candidate.name}» de tu computador?</h3>
            <p>
              Esta acción eliminará de forma definitiva el proyecto y todos sus archivos locales de tu disco duro.
            </p>
          </div>
        </div>

        <div className="delete-project-info-card">
          <div className="delete-info-row">
            <span className="delete-info-label">
              <Folder size={14} /> Carpeta
            </span>
            <code className="delete-info-path" title={candidate.path}>
              {candidate.path}
            </code>
          </div>

          <div className="delete-info-metrics">
            <div className="delete-metric-pill">
              <Layers size={13} />
              <span>{candidate.projectType}</span>
            </div>
            {candidate.diskSizeBytes > 0 && (
              <div className="delete-metric-pill">
                <HardDrive size={13} />
                <span>Libera {formatBytes(candidate.diskSizeBytes)}</span>
              </div>
            )}
            {candidate.frameworks.map(f => (
              <span key={f} className="delete-framework-badge">
                {f}
              </span>
            ))}
          </div>
        </div>

        <div className="delete-warning-callout">
          <AlertOctagon size={19} className="delete-warning-icon" />
          <div>
            <strong>Acción permanente e irreversible</strong>
            <p>
              Todos los archivos fuente, dependencias, variables de entorno y archivos locales se borrarán permanentemente del disco.
            </p>
          </div>
        </div>

        <div className="delete-modal-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            className="danger delete-confirm-btn"
            disabled={busy}
            onClick={() => onConfirm(candidate)}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            {busy ? 'Eliminando del disco…' : 'Eliminar del computador'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
