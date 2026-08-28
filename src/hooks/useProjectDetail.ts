import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isTauri, mockLogs } from '../api'
import { appendTerminalEntries, toTerminalEntries, type TerminalEntry } from '../lib/logs'
import type { CleanupPreview, DiskReport, LogEntry, ProjectDetail } from '../types'
import type { NoticeKind } from './useNotices'

export type Tab = 'summary' | 'git' | 'processes' | 'dependencies' | 'disk' | 'scripts' | 'configuration'

interface Options {
  selectedId: string | null
  clearSelection: () => void
  loadProjects: (preserveSelection?: boolean) => Promise<void>
  notify: (text: string, kind?: NoticeKind) => void
}

/**
 * Detalle del proyecto abierto: escaneo, proceso, historial, logs y disco.
 * Se recarga al cambiar de proyecto y compara firmas para no repintar el árbol
 * cuando el sondeo devuelve exactamente lo mismo.
 */
export function useProjectDetail({ selectedId, clearSelection, loadProjects, notify }: Options) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [tab, setTab] = useState<Tab>('summary')
  const [logs, setLogs] = useState<TerminalEntry[]>([])
  const [disk, setDisk] = useState<DiskReport | null>(null)
  const [cleanup, setCleanup] = useState<CleanupPreview | null>(null)
  const signature = useRef('')
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const next = await api.getProjectDetail(id)
        const nextSignature = JSON.stringify(next)
        if (nextSignature !== signature.current) {
          signature.current = nextSignature
          setDetail(next)
        }
      } catch (error) {
        // La carpeta puede haber desaparecido: se cierra el detalle y se avisa
        // con el motivo, sin tratarlo como un fallo de la aplicación.
        signature.current = ''
        setDetail(null)
        clearSelection()
        await loadProjects(true)
        notify(error instanceof Error ? error.message : String(error), 'info')
      }
    },
    [clearSelection, loadProjects, notify]
  )

  useEffect(() => {
    signature.current = ''
    if (selectedId) {
      setTab('summary')
      setLogs([])
      setDisk(null)
      void loadDetail(selectedId)
    } else {
      setDetail(null)
      setDisk(null)
    }
  }, [selectedId, loadDetail])

  // Una única suscripción para toda la vida de la app: el proyecto activo se
  // lee de una referencia, así el listener no se recrea en cada selección.
  useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen<LogEntry[] | LogEntry>('project://log', ({ payload }) => {
      const batch = Array.isArray(payload) ? payload : [payload]
      const relevant = batch.filter(entry => entry.projectId === selectedIdRef.current)
      if (!relevant.length) return
      setLogs(current => appendTerminalEntries(current, toTerminalEntries(relevant)))
    }).then(value => {
      if (disposed) value()
      else unlisten = value
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (isTauri) return
    if (selectedId && mockLogs[selectedId]) setLogs(toTerminalEntries(mockLogs[selectedId]))
  }, [selectedId])

  return { detail, setDetail, tab, setTab, logs, setLogs, disk, setDisk, cleanup, setCleanup, loadDetail, selectedIdRef }
}
