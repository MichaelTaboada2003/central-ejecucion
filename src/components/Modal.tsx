import { X } from 'lucide-react'
import { ReactNode } from 'react'

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

/** Para un script, «detenido» no dice nada: lo que importa es cómo terminó la
 *  última vez. */
