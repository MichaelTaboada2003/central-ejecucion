import { FolderOpen, LoaderCircle, Plus } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api } from '../../api'
import { Modal } from '../../components/Modal'

export function RegisterModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean
  onClose: () => void
  onSubmit: (path: string, name: string, tags: string[]) => Promise<void>
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')

  const chooseFolder = async () => {
    try {
      const result = await api.pickFolder({
        title: 'Selecciona la carpeta del proyecto',
      })
      if (result) setPath(result)
    } catch (err) {
      console.warn('Dialog error in Tauri:', err)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (path.trim()) {
      void onSubmit(
        path.trim(),
        name.trim(),
        tags
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean)
      )
    }
  }

  return (
    <Modal title="Registrar Proyecto Local" onClose={onClose}>
      <form onSubmit={submit} className="form-stack">
        <p className="modal-copy">
          Selecciona una carpeta en tu disco. Dev Command Center analizará los manifiestos de
          configuración para detectar el stack automáticamente.
        </p>
        <label>
          Carpeta del proyecto
          <span className="input-with-button">
            <input
              autoFocus
              value={path}
              onChange={event => setPath(event.target.value)}
              placeholder="/Users/usuario/Proyectos/mi-app"
              required
            />
            <button type="button" className="secondary" onClick={() => void chooseFolder()}>
              <FolderOpen size={15} /> Explorar
            </button>
          </span>
        </label>
        <label>
          Nombre para mostrar (opcional)
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Se usará el nombre de la carpeta por defecto"
          />
        </label>
        <label>
          Etiquetas (separadas por coma)
          <input
            value={tags}
            onChange={event => setTags(event.target.value)}
            placeholder="saas, ai, cliente, frontend"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
            Registrar proyecto
          </button>
        </div>
      </form>
    </Modal>
  )
}
