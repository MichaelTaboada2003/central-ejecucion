import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { copyText } from '../lib/clipboard'
import type { AdoptEnvVarsRequest, EnvVar, EnvVaultSnapshot } from '../types'
import type { NoticeKind } from './useNotices'

/**
 * Bóveda global: todo lo guardado, agrupado por proyecto, con las huérfanas
 * —las que quedaron sueltas al borrar, desregistrar o liberar su proyecto— como
 * un grupo más al final.
 *
 * El contador de huérfanas se carga aparte y desde el arranque, porque es lo que
 * pinta la insignia de la barra lateral: sin él nadie se enteraría de que hay
 * credenciales esperando a ser rescatadas o limpiadas.
 */
export function useEnvVault(notify: (text: string, kind: NoticeKind) => void) {
  const [snapshot, setSnapshot] = useState<EnvVaultSnapshot | null>(null)
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

  /**
   * `silencioso` distingue el recargado que sigue a una acción —que ya avisó de
   * lo suyo— de pulsar «Actualizar», donde el aviso es la única señal de que el
   * botón hizo algo.
   */
  const load = useCallback(
    async (silencioso = true) => {
      setLoading(true)
      try {
        const next = await api.listEnvVault()
        setSnapshot(next)
        setCount(next.orphanCount)
        if (!silencioso) {
          const proyectos = next.groups.filter(group => group.projectId).length
          notify(
            next.reconciled
              ? `${next.total} variables en ${proyectos} proyecto(s). ${next.reconciled} recuperada(s) de proyectos que ya no existen.`
              : `${next.total} variables en ${proyectos} proyecto(s), ${next.orphanCount} sin proyecto.`,
            'success'
          )
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setLoading(false)
      }
    },
    [notify]
  )

  useEffect(() => {
    void loadCount()
  }, [loadCount])

  const orphans = useMemo<EnvVar[]>(
    () => snapshot?.groups.find(group => group.projectId === null)?.vars ?? [],
    [snapshot]
  )

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
        await copyText(await api.exportEnvVars(null, ids))
        notify(`${ids.length} ${ids.length === 1 ? 'variable copiada' : 'variables copiadas'} al portapapeles`, 'success')
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
      }
    },
    [notify]
  )

  return { snapshot, orphans, count, loading, busy, load, loadCount, adopt, discard, copyAsEnv }
}
