import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { AdoptEnvVarsRequest, EnvVar } from '../types'
import type { NoticeKind } from './useNotices'

/**
 * Variables huérfanas: las que quedaron en la bóveda cuando su proyecto se
 * borró, se desregistró o se liberó con Safe Offload.
 *
 * El contador se carga aparte de la lista y desde el arranque, porque es lo que
 * pinta la insignia de la barra lateral: sin él nadie se enteraría de que hay
 * credenciales esperando a ser rescatadas o limpiadas.
 */
export function useEnvVault(notify: (text: string, kind: NoticeKind) => void) {
  const [orphans, setOrphans] = useState<EnvVar[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const loadCount = useCallback(async () => {
    try {
      setCount(await api.countOrphanEnvVars())
    } catch {
      // Un fallo al contar no debe teñir de rojo el arranque de la app: la
      // insignia simplemente no aparece.
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listOrphanEnvVars()
      setOrphans(list)
      setCount(list.length)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void loadCount()
  }, [loadCount])

  const adopt = useCallback(
    async (request: AdoptEnvVarsRequest, projectName: string) => {
      setBusy('adopt')
      try {
        const adopted = await api.adoptEnvVars(request)
        notify(`${adopted} ${adopted === 1 ? 'variable restaurada' : 'variables restauradas'} en «${projectName}».`, 'success')
        await load()
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setBusy(null)
      }
    },
    [notify, load]
  )

  const discard = useCallback(
    async (ids: string[], label: string) => {
      setBusy('discard')
      try {
        const removed = await api.deleteEnvVars(ids)
        notify(`${removed} ${removed === 1 ? 'variable eliminada' : 'variables eliminadas'} de ${label}.`, 'success')
        await load()
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setBusy(null)
      }
    },
    [notify, load]
  )

  const copyAsEnv = useCallback(
    async (ids: string[]) => {
      try {
        await navigator.clipboard.writeText(await api.exportEnvVars(null, ids))
        notify(`${ids.length} ${ids.length === 1 ? 'variable copiada' : 'variables copiadas'} al portapapeles`, 'success')
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
      }
    },
    [notify]
  )

  return { orphans, count, loading, busy, load, loadCount, adopt, discard, copyAsEnv }
}
