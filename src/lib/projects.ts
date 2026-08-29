/**
 * Lógica pura sobre la lista de proyectos: búsqueda, filtros, agrupación y
 * contadores. Vivía dentro de `App.tsx` y por tanto no se podía probar sin
 * montar la aplicación entera.
 */
import type { Project, ProjectKind, ProjectStatus } from '../types'

export type StatusFilter = ProjectStatus | 'pinned' | 'archived' | 'all'

export interface ProjectStats {
  total: number
  pinned: number
  running: number
  stopped: number
  error: number
  archived: number
}

export interface ProjectGroups {
  pinnedProjects: Project[]
  activeProjects: Project[]
  archivedProjects: Project[]
}

/** Cómo trata el panel a este proyecto. `service` para las filas de bases
 *  anteriores a que el campo existiera. */
export function projectKind(project: Project): ProjectKind {
  return project.kind ?? 'service'
}

/** Busca en nombre, ruta, tipo, frameworks y etiquetas. */
export function searchProjects(projects: Project[], query: string): Project[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return projects
  return projects.filter(project => {
    const haystack = `${project.name} ${project.path} ${project.projectType} ${project.frameworks.join(' ')} ${project.tags.join(' ')}`.toLowerCase()
    return haystack.includes(needle)
  })
}

/** Los archivados solo aparecen cuando se piden explícitamente. */
export function filterByStatus(projects: Project[], filter: StatusFilter): Project[] {
  if (filter === 'archived') return projects.filter(project => project.isArchived)
  const activos = projects.filter(project => !project.isArchived)
  if (filter === 'all') return activos
  if (filter === 'pinned') return activos.filter(project => project.isPinned)
  return activos.filter(project => project.status === filter)
}

/** Una sola pasada: fijados, activos y archivados son mutuamente excluyentes. */
export function groupProjects(projects: Project[]): ProjectGroups {
  const pinnedProjects: Project[] = []
  const activeProjects: Project[] = []
  const archivedProjects: Project[] = []
  for (const project of projects) {
    if (project.isArchived) archivedProjects.push(project)
    else if (project.isPinned) pinnedProjects.push(project)
    else activeProjects.push(project)
  }
  return { pinnedProjects, activeProjects, archivedProjects }
}

/**
 * Contadores para las tarjetas del panel. Se calculan sobre el resultado de la
 * búsqueda pero ANTES del filtro de estado: si no, al elegir «En ejecución» el
 * contador de «Todos» pasaba a mostrar solo los proyectos en ejecución.
 */
export function countProjects(projects: Project[]): ProjectStats {
  const stats: ProjectStats = { total: 0, pinned: 0, running: 0, stopped: 0, error: 0, archived: 0 }
  for (const project of projects) {
    if (project.isArchived) {
      stats.archived++
      continue
    }
    stats.total++
    if (project.isPinned) stats.pinned++
    if (project.status === 'running') stats.running++
    else if (project.status === 'stopped') stats.stopped++
    else if (project.status === 'error') stats.error++
  }
  return stats
}
