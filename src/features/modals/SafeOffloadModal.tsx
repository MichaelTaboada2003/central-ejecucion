import { CloudOff, LoaderCircle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Project } from '../../types'
import { Modal } from '../../components/Modal'

export function SafeOffloadModal({
  candidate,
  onClose,
  onConfirm,
  busy,
}: {
  candidate: Project
  onClose: () => void
  onConfirm: (candidate: Project, force: boolean) => void
  busy: boolean
}) {
  const [force, setForce] = useState(false)

  return (
    <Modal title="Archivar a la Nube y Liberar Disco" onClose={onClose}>
      <div className="cleanup-modal">
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ padding: 10, background: 'rgba(244, 63, 94, 0.12)', borderRadius: 10, color: 'var(--accent-rose)', border: '1px solid rgba(244, 63, 94, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CloudOff size={26} />
          </div>
          <div>
            <h3 style={{ margin: '0 0 6px' }}>¿Deseas archivar «{candidate.name}»?</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Esta acción verificará con Git que <strong>todos tus cambios locales y commits estén subidos a GitHub (git push)</strong>. Si todo está limpio, se eliminará la carpeta física local:
            </p>
            <code style={{ display: 'block', marginTop: 8, padding: '6px 10px', background: 'var(--bg-canvas)', borderRadius: 6, fontSize: 12 }}>
              {candidate.path}
            </code>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 12, background: 'rgba(59, 130, 246, 0.08)', borderRadius: 8, border: '1px solid rgba(59, 130, 246, 0.2)', fontSize: 12, color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0 }}>
            💾 <strong>Liberarás espacio en tu disco local.</strong> El repositorio seguirá disponible en GitHub y podrás volver a clonarlo cuando quieras desde el Cloud Hub con 1 clic.
          </p>
        </div>

        <label style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={force}
            onChange={e => setForce(e.target.checked)}
          />
          <span>Forzar eliminación incluso si hay cambios o ramas no rastreadas</span>
        </label>

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => onConfirm(candidate, force)}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            {busy ? 'Verificando Git y Archivando…' : 'Verificar y Archivar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
