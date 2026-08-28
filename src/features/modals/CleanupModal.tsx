import { LoaderCircle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { formatBytes } from '../../lib/format'
import type { CleanupPreview } from '../../types'
import { Modal } from '../../components/Modal'

export function CleanupModal({
  preview,
  onClose,
  onConfirm,
  busy,
}: {
  preview: CleanupPreview
  onClose: () => void
  onConfirm: (targets: string[]) => void
  busy: boolean
}) {
  const [selected, setSelected] = useState(preview.entries.map(entry => entry.target))
  const total = preview.entries
    .filter(entry => selected.includes(entry.target))
    .reduce((sum, entry) => sum + entry.bytes, 0)

  return (
    <Modal title="Confirmar Limpieza de Directorios" onClose={onClose}>
      <div className="cleanup-modal">
        <div className="cleanup-list">
          {preview.entries.map(entry => (
            <label key={entry.target}>
              <input
                type="checkbox"
                checked={selected.includes(entry.target)}
                onChange={() =>
                  setSelected(current =>
                    current.includes(entry.target)
                      ? current.filter(target => target !== entry.target)
                      : [...current, entry.target]
                  )
                }
              />
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.path}</small>
              </span>
              <b>{formatBytes(entry.bytes)}</b>
            </label>
          ))}
        </div>

        <p className="cleanup-total">
          Espacio total a recuperar: <strong>{formatBytes(total)}</strong>
        </p>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="danger"
            disabled={!selected.length || busy}
            onClick={() => onConfirm(selected)}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            Confirmar eliminación definitiva
          </button>
        </div>
      </div>
    </Modal>
  )
}
