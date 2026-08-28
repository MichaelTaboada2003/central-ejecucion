import type { ProjectStatus } from '../types'

/** Etiquetas de estado, compartidas por las píldoras y por los filtros. */
export const statusLabels: Record<ProjectStatus | 'pinned' | 'archived', string> = {
  running: 'En ejecución',
  stopped: 'Detenido',
  starting: 'Iniciando…',
  error: 'Requiere atención',
  pinned: 'Fijados',
  archived: 'Archivados',
}

