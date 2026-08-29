import { Globe, LoaderCircle, Lock, UploadCloud } from 'lucide-react'
import { FormEvent, useMemo } from 'react'

/** GitHub acepta letras, dígitos, punto, guion y guion bajo. Lo demás se
 *  convierte en guion, que es lo que hace el propio GitHub al importar. */
export function normalizarNombreRepo(valor: string): string {
  return valor
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
  onSubmit: (e: FormEvent) => void
}) {
  const normalizado = useMemo(() => normalizarNombreRepo(nombre), [nombre])
  const valido = normalizado.length > 0

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
