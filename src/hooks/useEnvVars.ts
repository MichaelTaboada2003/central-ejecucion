import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { ProjectEnvVars, SaveEnvVarRequest } from '../types'
import type { NoticeKind } from './useNotices'

interface Options {
  projectId: string | null
  notify: (text: string, kind: NoticeKind) => void
}

/**
 * Bóveda de variables de entorno del proyecto abierto.
 *
 * Cada mutación recarga el conjunto completo en vez de retocar el estado
 * local: el estado de sincronización de los ficheros (`files`) se calcula en el
 * backend cruzando disco y base, así que después de guardar una variable el
 * dato de «cuántas claves están sin proteger» solo puede venir de allí.
 */
export function useEnvVars({ projectId, notify }: Options) {
  const [data, setData] = useState<ProjectEnvVars | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // `notify` llega como flecha en línea desde `ProjectWorkspace`, así que su
  // identidad cambia en cada render. Sin esta referencia entraba en la lista de
  // dependencias de `load`, y con `load` en el efecto de carga el resultado era
  // un bucle: cada render pedía la bóveda otra vez.
  const notifyRef = useRef(notify)
  notifyRef.current = notify

  const load = useCallback(async (id: string) => {
    setLoading(true)
    try {
      setData(await api.getProjectEnvVars(id))
    } catch (error) {
      notifyRef.current(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!projectId) {
      setData(null)
      return
    }
    void load(projectId)
  }, [projectId, load])

  /** Envuelve una acción: marca el botón como ocupado, avisa y recarga. */
  const run = useCallback(
    async <T,>(token: string, operation: () => Promise<T>, describe: (result: T) => string) => {
      if (!projectId) return
      setBusy(token)
      try {
        const result = await operation()
        notifyRef.current(describe(result), 'success')
        await load(projectId)
        return result
      } catch (error) {
        notifyRef.current(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setBusy(null)
      }
    },
    [projectId, load]
  )

  const saveVar = useCallback(
    (request: SaveEnvVarRequest) =>
      run(`save:${request.id ?? request.key}`, () => api.saveEnvVar(request), saved => `«${saved.key}» guardada en ${saved.scope}.`),
    [run]
  )

  const deleteVars = useCallback(
    (ids: string[], label: string) =>
      run(`delete:${ids.join(',')}`, () => api.deleteEnvVars(ids), () => `${label} fuera de la bóveda.`),
    [run]
  )

  /** Importa el fichero del proyecto (`content` vacío) o un bloque pegado. */
  const importVars = useCallback(
    (scope: string, content?: string) =>
      run(
        `import:${scope}`,
        () => api.importEnvVars({ projectId: projectId!, scope, content: content ?? null }),
        result =>
          result.added + result.updated === 0
            ? `${scope} ya estaba al día en la bóveda.`
            : `${scope}: ${result.added} añadidas, ${result.updated} actualizadas, ${result.unchanged} sin cambios.`
      ),
    [run, projectId]
  )

  const writeFile = useCallback(
    (scope: string) =>
      run(
        `write:${scope}`,
        () => api.writeEnvFile(projectId!, scope),
        result =>
          `${result.written} variables escritas en ${result.scope}${
            result.backupPath ? `. Copia del contenido anterior en ${result.backupPath}` : ''
          }.`
      ),
    [run, projectId]
  )

  /** Copia al portapapeles en formato dotenv, listo para pegar donde sea. */
  const copyAsEnv = useCallback(
    async (ids?: string[]) => {
      if (!projectId) return
      try {
        const text = await api.exportEnvVars(projectId, ids)
        await navigator.clipboard.writeText(text)
        notifyRef.current(ids?.length ? `${ids.length} variables copiadas` : 'Bóveda copiada al portapapeles', 'success')
      } catch (error) {
        notifyRef.current(error instanceof Error ? error.message : String(error), 'error')
      }
    },
    [projectId]
  )

  return { data, loading, busy, reload: () => projectId && load(projectId), saveVar, deleteVars, importVars, writeFile, copyAsEnv }
}
