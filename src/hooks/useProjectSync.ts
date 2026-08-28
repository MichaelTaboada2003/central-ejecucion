import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isTauri } from '../api'

/** Sondeo de estado de proyectos. Se pausa cuando la ventana está oculta. */
export const POLL_INTERVAL_MS = 6000

interface Options {
  loadProjects: (preserveSelection?: boolean) => Promise<void>
  loadDetail: (id: string) => Promise<void>
  selectedIdRef: React.MutableRefObject<string | null>
}

/**
 * Mantiene la interfaz al día por tres vías: el evento del backend cuando un
 * proceso cambia de estado, un sondeo periódico y el foco de la ventana.
 *
 * Sondear una ventana oculta solo gasta CPU, así que se salta; al recuperar el
 * foco se sincroniza de inmediato.
 */
export function useProjectSync({ loadProjects, loadDetail, selectedIdRef }: Options) {
  useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen('project://status', () => {
      void loadProjects()
      const current = selectedIdRef.current
      if (current) void loadDetail(current)
    }).then(value => {
      if (disposed) value()
      else unlisten = value
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [loadDetail, loadProjects, selectedIdRef])

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return
      void loadProjects(true)
    }, POLL_INTERVAL_MS)
    const onFocus = () => {
      void loadProjects(true)
      const current = selectedIdRef.current
      if (current) void loadDetail(current)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [loadProjects, loadDetail, selectedIdRef])
}
