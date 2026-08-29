import { useCallback, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { countProjects, filterByStatus, groupProjects, searchProjects, type StatusFilter } from '../lib/projects'
import type { Project } from '../types'
import { reportError, type NoticeKind } from './useNotices'

interface Options {
  notify: (text: string, kind?: NoticeKind) => void
  onSelect: (projectId: string) => void
  /** Texto del buscador. Vive en la interfaz, pero los derivados se calculan
   *  aquí para que la lista y sus recuentos salgan siempre del mismo sitio. */
  query: string
  statusFilter: StatusFilter
}

/**
 * Registro local de proyectos: la lista, sus derivados y las banderas que se
 * pueden cambiar desde la interfaz (fijar, archivar, naturaleza).
 *
 * El detalle NO se parchea aquí: la lista es la única fuente de verdad de las
 * banderas de un proyecto, y la vista de detalle lee de ella. Cuando cada
 * bandera se escribía en dos sitios, mantenerlos de acuerdo costaba veinte
 * líneas por cada acción.
 */
export function useProjects({ notify, onSelect, query, statusFilter }: Options) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  // El sondeo periódico devuelve casi siempre la misma carga útil: comparar la
  // firma evita reemplazar el estado y volver a renderizar todo el árbol.
  const signature = useRef('')

  const loadProjects = useCallback(
    async (preserveSelection = true) => {
      try {
        const next = await api.listProjects()
        const nextSignature = JSON.stringify(next)
        if (nextSignature !== signature.current) {
          signature.current = nextSignature
          setProjects(next)
        }
        if (!preserveSelection && next[0]) onSelect(next[0].id)
      } catch (error) {
        reportError(error)
      } finally {
        setLoading(false)
      }
    },
    [onSelect]
  )

  /** Aplica el cambio en local antes de que responda el backend y lo confirma
   *  después: fijar o archivar debe sentirse instantáneo. */
  const patch = useCallback((projectId: string, changes: Partial<Project>) => {
    setProjects(prev => prev.map(project => (project.id === projectId ? { ...project, ...changes } : project)))
    // La firma deja de coincidir a propósito, para que el siguiente sondeo
    // reemplace el estado con lo que diga el backend.
    signature.current = ''
  }, [])

  const togglePin = useCallback(
    async (project: Project) => {
      const isPinned = !project.isPinned
      patch(project.id, { isPinned, isArchived: isPinned ? false : project.isArchived })
      try {
        await api.togglePinProject(project.id, isPinned)
        notify(isPinned ? `«${project.name}» fijado al inicio.` : `«${project.name}» desfijado.`)
      } catch (error) {
        reportError(error)
      }
      await loadProjects()
    },
    [loadProjects, notify, patch]
  )

  const toggleArchive = useCallback(
    async (project: Project) => {
      const isArchived = !project.isArchived
      patch(project.id, { isArchived, isPinned: isArchived ? false : project.isPinned })
      try {
        await api.toggleArchiveProject(project.id, isArchived)
        notify(
          isArchived
            ? `«${project.name}» archivado. Puedes encontrarlo en la pestaña "Archivados" o en la barra lateral.`
            : `«${project.name}» restaurado a proyectos activos.`
        )
      } catch (error) {
        reportError(error)
      }
      await loadProjects()
    },
    [loadProjects, notify, patch]
  )

  const refreshAll = useCallback(async () => {
    const refreshed = await api.refreshAllProjects()
    signature.current = JSON.stringify(refreshed)
    setProjects(refreshed)
    return refreshed.length
  }, [])

  const groups = useMemo(() => groupProjects(projects), [projects])

  // Los contadores se calculan sobre el resultado de la búsqueda pero ANTES de
  // aplicar el filtro de estado: si no, al elegir «En ejecución» el contador de
  // «Todos» pasaba a mostrar solo los proyectos en ejecución.
  const searchedProjects = useMemo(() => searchProjects(projects, query), [projects, query])
  const visibleProjects = useMemo(() => filterByStatus(searchedProjects, statusFilter), [searchedProjects, statusFilter])
  const stats = useMemo(() => countProjects(searchedProjects), [searchedProjects])

  return {
    projects,
    loading,
    loadProjects,
    togglePin,
    toggleArchive,
    refreshAll,
    groups,
    searchedProjects,
    visibleProjects,
    stats,
  }
}
