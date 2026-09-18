import { Globe, LoaderCircle, Lock, Plus, Tag, UploadCloud, X } from 'lucide-react'
import { FormEvent, useMemo, useState } from 'react'

/** GitHub acepta letras, dígitos, punto, guion y guion bajo para nombres de repos. */
export function normalizarNombreRepo(valor: string): string {
  return valor
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Normaliza una tecnología o etiqueta para cumplir las reglas de topics de GitHub:
 * minúsculas, solo [a-z0-9-], hasta 35 caracteres, empezando por alfanumérico.
 */
export function toGithubTopic(raw: string): string {
  const t = raw.trim().toLowerCase()
  if (t === 'c++') return 'cpp'
  if (t === 'c#') return 'csharp'
  if (t === '.net' || t === 'dotnet') return 'dotnet'
  if (t === 'next.js') return 'nextjs'
  if (t === 'node.js') return 'nodejs'
  if (t === 'vue.js') return 'vue'
  if (t === 'three.js') return 'threejs'
  if (t === 'tailwind css' || t === 'tailwindcss') return 'tailwindcss'
  return t
    .replace(/[^a-z0-9-_./ ]/g, '')
    .replace(/[-_./ ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 35)
}

export function PublishToGitHub({
  nombre,
  setNombre,
  descripcion,
  setDescripcion,
  privado,
  setPrivado,
  usuario,
  publicando,
  topics = [],
  setTopics,
  onSubmit,
}: {
  nombre: string
  setNombre: (valor: string) => void
  descripcion: string
  setDescripcion: (valor: string) => void
  privado: boolean
  setPrivado: (valor: boolean) => void
  usuario?: string | null
  publicando: boolean
  topics?: string[]
  setTopics?: (topics: string[]) => void
  onSubmit: (e: FormEvent) => void
}) {
  const [newTopicInput, setNewTopicInput] = useState('')
  const normalizado = useMemo(() => normalizarNombreRepo(nombre), [nombre])
  const valido = normalizado.length > 0

  const handleAddTopic = () => {
    if (!setTopics) return
    const cleaned = toGithubTopic(newTopicInput)
    if (cleaned && !topics.includes(cleaned) && topics.length < 20) {
      setTopics([...topics, cleaned])
      setNewTopicInput('')
    }
  }

  const handleRemoveTopic = (topicToRemove: string) => {
    if (!setTopics) return
    setTopics(topics.filter(t => t !== topicToRemove))
  }

  return (
    <form className="publicar" onSubmit={onSubmit}>
      <div className="publicar-campo">
        <label htmlFor="publicar-nombre">Nombre del repositorio</label>
        <input
          id="publicar-nombre"
          type="text"
          className="publicar-nombre"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          placeholder="mi-proyecto"
          spellCheck={false}
          autoComplete="off"
          required
        />
        {/* Se muestra a dónde va a parar: el nombre se corrige solo y conviene
            verlo antes de crear nada. */}
        <p className="publicar-destino">
          {valido ? (
            <>
              github.com/<strong>{usuario ?? 'tu-cuenta'}</strong>/<strong>{normalizado}</strong>
            </>
          ) : (
            'Escribe un nombre para el repositorio'
          )}
        </p>
      </div>

      <div className="publicar-campo">
        <label htmlFor="publicar-desc">Descripción (opcional)</label>
        <input
          id="publicar-desc"
          type="text"
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Para qué sirve este proyecto"
        />
      </div>

      {setTopics && (
        <div className="publicar-campo">
          <label htmlFor="publicar-topics">
            <Tag size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
            Tags y Temas en GitHub (Topics)
          </label>
          <p style={{ margin: '2px 0 8px', fontSize: 12, color: 'var(--text-tertiary)' }}>
            Se incrustarán en tu repositorio de GitHub para clasificar tus tecnologías.
          </p>

          <div className="publicar-topics-wrap">
            <div className="publicar-topics-list">
              {topics.map(topic => (
                <span key={topic} className="publicar-topic-badge">
                  #{topic}
                  <button
                    type="button"
                    className="publicar-topic-remove"
                    onClick={() => handleRemoveTopic(topic)}
                    title={`Quitar tag ${topic}`}
                    aria-label={`Quitar tag ${topic}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {topics.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                  Sin tags asignados
                </span>
              )}
            </div>

            {topics.length < 20 && (
              <div className="publicar-topic-input-row">
                <input
                  id="publicar-topics"
                  type="text"
                  value={newTopicInput}
                  onChange={e => setNewTopicInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddTopic()
                    }
                  }}
                  placeholder="Añadir tag (ej: typescript)"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={handleAddTopic}
                  disabled={!toGithubTopic(newTopicInput)}
                >
                  <Plus size={13} style={{ marginRight: 4 }} />
                  Añadir
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dos opciones explícitas en vez de una casilla: quién puede verlo es una
          decisión que conviene tomar mirando, no marcando. */}
      <fieldset className="publicar-visibilidad">
        <legend>Quién puede verlo</legend>
        <label className={privado ? '' : 'elegida'}>
          <input type="radio" name="visibilidad" checked={!privado} onChange={() => setPrivado(false)} />
          <Globe size={14} aria-hidden="true" />
          <span>
            <strong>Público</strong>
            <small>Cualquiera puede ver el código</small>
          </span>
        </label>
        <label className={privado ? 'elegida' : ''}>
          <input type="radio" name="visibilidad" checked={privado} onChange={() => setPrivado(true)} />
          <Lock size={14} aria-hidden="true" />
          <span>
            <strong>Privado</strong>
            <small>Solo tú y quien invites</small>
          </span>
        </label>
      </fieldset>

      <button type="submit" className="primary" disabled={publicando || !valido}>
        {publicando ? <LoaderCircle className="spin" size={15} /> : <UploadCloud size={15} />}
        {/* El botón del encabezado lleva hasta aquí y se llama «Publicar en
            GitHub»; este dice lo que va a pasar al pulsarlo. */}
        {publicando ? 'Creando el repositorio y subiendo…' : 'Crear repositorio y subir'}
      </button>
    </form>
  )
}
