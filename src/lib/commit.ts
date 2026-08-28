/**
 * Selección de archivos del commit. Se guarda lo EXCLUIDO, no lo incluido: así
 * un archivo que aparece después (porque lo acabas de tocar) entra marcado por
 * defecto, que es lo esperable.
 */
import type { GitFileChange } from '../types'

/** Límite recomendado para el resumen de un commit. */
export const COMMIT_SUBJECT_LIMIT = 72
/** A partir de aquí el resumen ya es largo, aunque todavía válido. */
export const COMMIT_SUBJECT_WARN = 50

export function selectedPaths(changes: GitFileChange[], excluded: Set<string>): string[] {
  return changes.map(change => change.path).filter(path => !excluded.has(path))
}

export function toggleExcluded(excluded: Set<string>, path: string): Set<string> {
  const next = new Set(excluded)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

export function commitCounterState(length: number): 'ok' | 'warn' | 'over' {
  if (length > COMMIT_SUBJECT_LIMIT) return 'over'
  if (length > COMMIT_SUBJECT_WARN) return 'warn'
  return 'ok'
}

/** Un commit necesita mensaje y al menos un archivo. */
export function canCommit(message: string, selected: string[]): boolean {
  return message.trim().length > 0 && selected.length > 0
}
