import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../Dashboard'
import { proyecto } from '../../../test/fixtures'
import type { Project } from '../../../types'

vi.mock('../../../api', () => ({ api: { openExternalUrl: vi.fn() } }))

const lista: Project[] = [
  proyecto({ id: 'p1', name: 'web', status: 'running' }),
  proyecto({ id: 'p2', name: 'api', status: 'error' }),
  proyecto({ id: 'p3', name: 'script-python', status: 'stopped', kind: 'script', port: null, devCommand: 'python main.py' }),
  proyecto({ id: 'p4', name: 'docs', status: 'stopped', kind: 'inert', port: null, devCommand: null }),
]

function montar(over: Partial<Parameters<typeof Dashboard>[0]> = {}) {
  const props = {
    projects: lista,
    stats: { total: 4, pinned: 0, running: 1, stopped: 2, error: 1, archived: 0 },
    onRefreshAll: vi.fn(),
    statusFilter: 'all' as const,
    setStatusFilter: vi.fn(),
    onSelect: vi.fn(),
    onRegister: vi.fn(),
    onQuickRun: vi.fn(),
    onQuickStop: vi.fn(),
    onDeleteProject: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleArchive: vi.fn(),
    busy: null,
    isGitHubConnected: () => false,
    ...over,
  }
  render(<Dashboard {...(props as Parameters<typeof Dashboard>[0])} />)
  return props
}

beforeEach(() => vi.clearAllMocks())

describe('Dashboard', () => {
  it('lista un proyecto por fila', () => {
    montar()
    expect(screen.getByText('web')).toBeTruthy()
    expect(screen.getByText('docs')).toBeTruthy()
  })

  it('el arranque rápido solo se ofrece a los servicios', async () => {
    const usuario = userEvent.setup()
    const { onQuickRun } = montar()
    // 2 servicios detenidos/en error tienen botón; el script y el inerte no.
    const arranques = screen.getAllByTitle('Iniciar servidor')
    expect(arranques).toHaveLength(1)
    await usuario.click(arranques[0])
    expect(onQuickRun).toHaveBeenCalled()
  })

  it('cambiar de filtro avisa al contenedor en vez de filtrar por su cuenta', async () => {
    const usuario = userEvent.setup()
    const { setStatusFilter } = montar()
    const grupoFiltros = document.querySelector('.filter-group') as HTMLElement
    await usuario.click(within(grupoFiltros).getByRole('button', { name: /en ejecución/i }))
    expect(setStatusFilter).toHaveBeenCalledWith('running')
  })

  it('sin proyectos en el sistema muestra el estado de registro inicial', () => {
    montar({ projects: [], allProjectsCount: 0, stats: { total: 0, pinned: 0, running: 0, stopped: 0, error: 0, archived: 0 } })
    expect(screen.getByText(/registra tu primer proyecto/i)).toBeTruthy()
  })

  it('con proyectos en el sistema pero sin coincidencias muestra el estado de sin resultados', () => {
    montar({ projects: [], allProjectsCount: 4, query: 'futures', statusFilter: 'archived' })
    expect(screen.getByRole('heading', { name: /sin proyectos que coincidan/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /restablecer filtros y búsqueda/i })).toBeTruthy()
  })
})

describe('Dashboard: lo que no se ejecuta no dice «Detenido»', () => {
  it('un script y un repo sin ejecutable muestran qué son, no un estado falso', () => {
    montar()
    expect(screen.getByText('Script')).toBeTruthy()
    expect(screen.getByText('Sin ejecutable')).toBeTruthy()
    // Los servicios conservan su estado real (el texto también está en el
    // filtro superior, así que se busca dentro de la tabla).
    const tabla = document.querySelector('.project-table') as HTMLElement
    expect(within(tabla).getByText('En ejecución')).toBeTruthy()
  })
})
