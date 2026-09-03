import { AlertOctagon, Folder, HardDrive, KeyRound, Layers, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { formatBytes } from '../../lib/format'
import type { Project, ProjectEnvVars } from '../../types'
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
  // El aviso que de verdad hace falta antes de un `remove_dir_all`: los `.env`
  // están en el `.gitignore`, así que las claves que solo viven en el disco no
  // están ni en la bóveda ni en GitHub. Este es el último momento para verlas.
  const [env, setEnv] = useState<ProjectEnvVars | null>(null)
  const [protecting, setProtecting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      .getProjectEnvVars(candidate.id)
      .then(result => {
        if (!cancelled) setEnv(result)
      })
      // Que no se pueda consultar la bóveda no debe impedir borrar: se calla y
      // el modal se comporta como antes de existir esta pestaña.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [candidate.id])

  const unprotected = env?.unprotectedKeys ?? 0
  const pendingFiles = (env?.files ?? []).filter(file => !file.isTemplate && file.missingInVault.length > 0)

  const protectNow = async () => {
    setProtecting(true)
    try {
      for (const file of pendingFiles) {
        await api.importEnvVars({ projectId: candidate.id, scope: file.name, content: null })
      }
      setEnv(await api.getProjectEnvVars(candidate.id))
    } finally {
      setProtecting(false)
    }
  }

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

        {unprotected > 0 && (
          <div className="delete-env-callout warn">
            <KeyRound size={19} />
            <div>
              <strong>
                {unprotected} {unprotected === 1 ? 'variable de entorno se perderá' : 'variables de entorno se perderán'}
              </strong>
              <p>
                Están solo en {pendingFiles.map(file => file.name).join(', ')} y no en la bóveda.
                Como esos ficheros están en el <code>.gitignore</code>, tampoco están en GitHub: al
                borrar la carpeta desaparecen para siempre.
              </p>
              <button className="secondary" onClick={() => void protectNow()} disabled={protecting || busy}>
                {protecting ? <LoaderCircle size={14} className="spin" /> : <ShieldCheck size={14} />}
                Guardar en la bóveda antes de borrar
              </button>
            </div>
          </div>
        )}

        {unprotected === 0 && !!env?.vars.length && (
          <div className="delete-env-callout good">
            <ShieldCheck size={19} />
            <div>
              <strong>
                {env.vars.length} {env.vars.length === 1 ? 'variable a salvo' : 'variables a salvo'} en la bóveda
              </strong>
              <p>
                Sobrevivirán al borrado y quedarán en «Bóveda de entorno», donde podrás restaurarlas
                en otro proyecto o descartarlas.
              </p>
            </div>
          </div>
        )}

        <div className="delete-warning-callout">
          <AlertOctagon size={19} className="delete-warning-icon" />
          <div>
            <strong>Acción permanente e irreversible</strong>
            <p>
              Todos los archivos fuente, dependencias y archivos locales se borrarán permanentemente
              del disco. Las variables de entorno que estén en la bóveda son la única excepción.
            </p>
          </div>
        </div>

        <div className="delete-modal-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            className="danger delete-confirm-btn"
            disabled={busy || protecting}
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
