import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTimestamp } from '../lib/format'
import { EMPTY_INSTALL_PROGRESS, readInstallProgress, type InstallProgress } from '../lib/install'
import type { TerminalEntry } from '../lib/logs'
import type { ProjectDetail } from '../types'

/** Cuánto se queda en pantalla el resultado antes de retirarse solo. */
const OUTCOME_TTL_MS = 30_000
/** Cadencia del cronómetro. Medio segundo basta para que se vea vivo. */
const TICK_MS = 500

export interface InstallOutcome {
  ok: boolean
  /** Cancelada a mano: ni éxito ni fallo, y no hay nada que arreglar. */
  cancelled: boolean
  durationMs: number | null
  packages: number | null
  message: string | null
}

export interface InstallActivity {
  running: boolean
  command: string | null
  elapsedMs: number
  progress: InstallProgress
  /** Salida de esta instalación, para asomar las últimas líneas en vivo. */
  lines: string[]
  /** Desenlace de la instalación recién terminada, hasta que se descarte. */
  outcome: InstallOutcome | null
  dismissOutcome: () => void
}

export const IDLE_INSTALL_ACTIVITY: InstallActivity = {
  running: false,
  command: null,
  elapsedMs: 0,
  progress: EMPTY_INSTALL_PROGRESS,
  lines: [],
  outcome: null,
  dismissOutcome: () => {},
}

interface Options {
  detail: ProjectDetail | null
  logs: TerminalEntry[]
  /** Se llama una vez cuando la instalación termina, para avisar por toast. */
  onFinish?: (outcome: InstallOutcome) => void
}

/**
 * Convierte «hay un proceso de instalación» en algo que la interfaz puede
 * contar: en qué fase va, cuánto lleva y cómo acabó.
 *
 * La instalación se lanza y devuelve el control de inmediato, así que el estado
 * no puede salir de la llamada: se deduce del historial de comandos —el
 * registro `install` sigue en «running» mientras el gestor trabaja— y de las
 * líneas que ese proceso va escribiendo. Sin proceso vivo no se muestra nada,
 * porque un registro «running» también es lo que deja una app cerrada a medias.
 */
export function useInstallActivity({ detail, logs, onFinish }: Options): InstallActivity {
  const record = useMemo(
    () => detail?.recentCommands.find(command => command.action === 'install' && command.status === 'running') ?? null,
    [detail]
  )
  const running = !!record && !!detail?.process
  const startedMs = parseTimestamp(record?.startedAt)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [running])

  const streamed = useMemo(() => {
    if (!running || startedMs === null) return { lines: [] as string[], progress: EMPTY_INSTALL_PROGRESS }
    // Solo la salida de ESTA instalación: el búfer conserva lo que escribieron
    // los comandos anteriores del proyecto. El segundo de gracia cubre el
    // desfase entre el reloj del registro y el de la primera línea.
    const lines = logs
      .filter(entry => (parseTimestamp(entry.timestamp) ?? 0) >= startedMs - 1_000)
      .map(entry => entry.line)
    return { lines, progress: readInstallProgress(lines) }
  }, [running, startedMs, logs])
  const progress = streamed.progress

  // El desenlace se lee cuando el registro activo desaparece, y para entonces
  // el avance ya se ha vaciado: hay que conservar el último que se vio.
  const lastProgress = useRef<InstallProgress>(EMPTY_INSTALL_PROGRESS)
  if (running) lastProgress.current = progress

  const [outcome, setOutcome] = useState<InstallOutcome | null>(null)
  const activeId = running ? record!.id : null
  const previousId = useRef<string | null>(null)
  const finishHandler = useRef(onFinish)
  finishHandler.current = onFinish

  // Todo el ciclo se observa en un único efecto: repartirlo en dos hacía que el
  // que limpia al cambiar de proyecto borrase, al montar, la referencia que el
  // otro acababa de anotar, y el desenlace no llegaba a anunciarse nunca.
  const projectId = detail?.project.id ?? null
  const previousProject = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const previous = previousId.current
    previousId.current = activeId
    // Al cambiar de proyecto, lo que pasara en el anterior deja de venir a cuento.
    if (previousProject.current !== projectId) {
      previousProject.current = projectId
      // Si el proyecto recién abierto ya está instalando, su avance vale: lo
      // que se descarta es el rastro del proyecto que se acaba de dejar.
      if (!running) lastProgress.current = EMPTY_INSTALL_PROGRESS
      setOutcome(null)
      return
    }
    if (!previous || previous === activeId) return
    const finished = detail?.recentCommands.find(command => command.id === previous)
    if (!finished || finished.status === 'running') return
    const started = parseTimestamp(finished.startedAt)
    const ended = parseTimestamp(finished.endedAt)
    const result: InstallOutcome = {
      ok: finished.status === 'completed',
      cancelled: finished.status === 'stopped',
      durationMs: started !== null && ended !== null && ended >= started ? ended - started : null,
      packages: lastProgress.current.installed,
      message: finished.errorMessage,
    }
    lastProgress.current = EMPTY_INSTALL_PROGRESS
    setOutcome(result)
    finishHandler.current?.(result)
  }, [activeId, projectId, running, detail])

  useEffect(() => {
    if (!outcome) return
    const timer = window.setTimeout(() => setOutcome(null), OUTCOME_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [outcome])

  return {
    running,
    command: record?.command ?? null,
    elapsedMs: running && startedMs !== null ? Math.max(0, now - startedMs) : 0,
    progress,
    lines: streamed.lines,
    outcome,
    dismissOutcome: () => setOutcome(null),
  }
}
