/**
 * Búfer circular de la terminal. Es lógica pura y con invariantes que importan:
 * el límite acota la memoria y `seq` da identidad estable a cada línea para que
 * React no recree la lista al desplazarse el búfer.
 */
import type { LogEntry } from '../types'

export type TerminalEntry = LogEntry & { seq: number }

/** Líneas de terminal conservadas en memoria. */
export const LOG_BUFFER_LIMIT = 500

let logSequence = 0

export function toTerminalEntries(entries: LogEntry[]): TerminalEntry[] {
  return entries.map(entry => ({ ...entry, seq: logSequence++ }))
}

export function appendTerminalEntries(current: TerminalEntry[], incoming: TerminalEntry[]): TerminalEntry[] {
  const next = current.concat(incoming)
  return next.length > LOG_BUFFER_LIMIT ? next.slice(next.length - LOG_BUFFER_LIMIT) : next
}

/** Solo para pruebas: reinicia el contador de identidades. */
export function resetLogSequence(): void {
  logSequence = 0
}
