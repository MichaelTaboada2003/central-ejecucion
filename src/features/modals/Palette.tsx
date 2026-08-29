import {
  Archive,
  ChevronRight,
  LayoutDashboard,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { GitHubLogo } from '../../components/GitHubLogo'
import { StatusDot } from '../../components/Status'
import { normalizeSearchText, searchProjects } from '../../lib/projects'
import type { Project } from '../../types'

interface PaletteAction {
  id: string
  label: string
  shortcut?: string
  icon: React.ReactNode
  perform: () => void
  category: 'action'
}

interface PaletteProjectItem {
  id: string
  label: string
  project: Project
  category: 'project'
  perform: () => void
}

type PaletteItem = PaletteAction | PaletteProjectItem

export function Palette({
  onClose,
  onRegister,
  onSettings,
  onDashboard,
  onGitHub,
  onRefreshAll,
  projects = [],
  onSelectProject,
}: {
  onClose: () => void
  onRegister: () => void
  onSettings: () => void
  onDashboard: () => void
  onGitHub?: () => void
  onRefreshAll?: () => void
  projects?: Project[]
  onSelectProject?: (projectId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const baseActions: PaletteAction[] = useMemo(() => {
    const list: PaletteAction[] = [
      {
        id: 'register',
        label: 'Registrar nuevo proyecto',
        shortcut: '⌘N',
        icon: <Plus size={15} color="var(--accent-primary)" />,
        perform: () => {
          onClose()
          onRegister()
        },
        category: 'action',
      },
      {
        id: 'dashboard',
        label: 'Ir al Panel Local / Dashboard',
        icon: <LayoutDashboard size={15} color="var(--accent-primary)" />,
        perform: () => {
          onDashboard()
          onClose()
        },
        category: 'action',
      },
    ]

    if (onGitHub) {
      list.push({
        id: 'github',
        label: 'Abrir GitHub Cloud Hub',
        icon: <GitHubLogo size={15} color="var(--accent-cyan)" />,
        perform: () => {
          onGitHub()
          onClose()
        },
        category: 'action',
      })
    }

    if (onRefreshAll) {
      list.push({
        id: 'refresh-all',
        label: 'Reescanear todos los proyectos locales',
        icon: <RefreshCw size={15} color="var(--accent-amber)" />,
        perform: () => {
          onRefreshAll()
          onClose()
        },
        category: 'action',
      })
    }

    list.push({
      id: 'settings',
      label: 'Configurar editores e IDEs',
      icon: <Settings2 size={15} color="var(--text-secondary)" />,
      perform: () => {
        onClose()
        onSettings()
      },
      category: 'action',
    })

    return list
  }, [onClose, onRegister, onDashboard, onGitHub, onRefreshAll, onSettings])

  const filteredActions = useMemo(() => {
    const normalized = normalizeSearchText(query.trim())
    if (!normalized) return baseActions
    const tokens = normalized.split(/\s+/).filter(Boolean)
    return baseActions.filter(action => {
      const target = normalizeSearchText(action.label)
      return tokens.every(token => target.includes(token))
    })
  }, [baseActions, query])

  const matchingProjects = useMemo(() => {
    if (!projects.length) return []
    return searchProjects(projects, query).slice(0, 10)
  }, [projects, query])

  const projectItems: PaletteProjectItem[] = useMemo(() => {
    if (!onSelectProject) return []
    return matchingProjects.map(project => ({
      id: `project-${project.id}`,
      label: project.name,
      project,
      category: 'project' as const,
      perform: () => {
        onClose()
        onSelectProject(project.id)
      },
    }))
  }, [matchingProjects, onSelectProject, onClose])

  const allItems: PaletteItem[] = useMemo(() => {
    return [...filteredActions, ...projectItems]
  }, [filteredActions, projectItems])

  // Resetear o acotar índice al cambiar resultados
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (allItems.length > 0) {
        setSelectedIndex(prev => (prev + 1) % allItems.length)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (allItems.length > 0) {
        setSelectedIndex(prev => (prev - 1 + allItems.length) % allItems.length)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = allItems[selectedIndex]
      if (item) {
        item.perform()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Desplazar el elemento seleccionado a la vista
  useEffect(() => {
    if (!listRef.current) return
    const selectedEl = listRef.current.querySelector('.palette-item.selected')
    if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  return (
    <Modal title="Paleta de Comandos Rápidos" onClose={onClose}>
      <div className="palette" onKeyDown={handleKeyDown}>
        <div className="search">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar acciones o proyectos por nombre, stack o etiqueta…"
            aria-label="Buscar acción o proyecto"
          />
        </div>

        <div className="palette-results-list" ref={listRef} tabIndex={-1}>
          {filteredActions.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-heading">ACCIONES</div>
              {filteredActions.map((action, idx) => {
                const itemIndex = idx
                const isSelected = itemIndex === selectedIndex
                return (
                  <button
                    key={action.id}
                    type="button"
                    className={`palette-item ${isSelected ? 'selected' : ''}`}
                    onClick={action.perform}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                  >
                    <span className="palette-item-icon">{action.icon}</span>
                    <span className="palette-item-label">{action.label}</span>
                    {action.shortcut && <kbd>{action.shortcut}</kbd>}
                  </button>
                )
              })}
            </div>
          )}

          {projectItems.length > 0 && (
            <div className="palette-group">
              <div className="palette-group-heading">PROYECTOS ({projectItems.length})</div>
              {projectItems.map((item, idx) => {
                const itemIndex = filteredActions.length + idx
                const isSelected = itemIndex === selectedIndex
                const { project } = item
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`palette-item palette-project-item ${isSelected ? 'selected' : ''}`}
                    onClick={item.perform}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                  >
                    <StatusDot status={project.status} />
                    <div className="palette-project-info">
                      <div className="palette-project-row">
                        <strong className="palette-project-name">{project.name}</strong>
                        {project.isPinned && (
                          <span className="pinned-badge" title="Fijado">
                            <Pin size={9} fill="currentColor" />
                          </span>
                        )}
                        {project.isArchived && (
                          <span className="archived-badge" title="Archivado">
                            <Archive size={9} />
                          </span>
                        )}
                        {project.frameworks?.length > 0 && (
                          <span className="palette-project-stack">
                            {project.frameworks.slice(0, 2).join(', ')}
                          </span>
                        )}
                      </div>
                      <small className="palette-project-path" title={project.path}>
                        {project.path}
                      </small>
                    </div>
                    <ChevronRight size={14} className="palette-chevron" />
                  </button>
                )
              })}
            </div>
          )}

          {allItems.length === 0 && (
            <div className="palette-empty">
              <Search size={22} style={{ opacity: 0.4, margin: '0 auto 8px', display: 'block' }} />
              <p>No se encontraron acciones ni proyectos que coincidan con «{query}».</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
