import { LayoutDashboard, Plus, Search, Settings2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Modal } from '../../components/Modal'

export function Palette({
  onClose,
  onRegister,
  onSettings,
  onDashboard,
}: {
  onClose: () => void
  onRegister: () => void
  onSettings: () => void
  onDashboard: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  return (
    <Modal title="Paleta de Comandos Rápidos" onClose={onClose}>
      <div className="palette">
        <div className="search">
          <Search size={16} />
          <input ref={input} placeholder="Escribe para filtrar acciones…" aria-label="Buscar acción" />
        </div>
        <button
          onClick={() => {
            onClose()
            onRegister()
          }}
        >
          <Plus size={15} /> Registrar nuevo proyecto <kbd>⌘N</kbd>
        </button>
        <button
          onClick={() => {
            onDashboard()
            onClose()
          }}
        >
          <LayoutDashboard size={15} /> Ir al Dashboard principal
        </button>
        <button
          onClick={() => {
            onClose()
            onSettings()
          }}
        >
          <Settings2 size={15} /> Configurar editores e IDEs
        </button>
      </div>
    </Modal>
  )
}
