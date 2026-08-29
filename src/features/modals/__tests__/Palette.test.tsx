import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Palette } from '../Palette'
import { proyecto } from '../../../test/fixtures'
import type { Project } from '../../../types'

const sampleProjects: Project[] = [
  proyecto({ id: 'p1', name: 'Dashboard Web', frameworks: ['React', 'Vite'] }),
  proyecto({ id: 'p2', name: 'API Server', frameworks: ['FastAPI', 'Python'] }),
]

describe('Palette (⌘K Command Palette)', () => {
  it('renderiza acciones rápidas y proyectos registrados', () => {
    render(
      <Palette
        onClose={vi.fn()}
        onRegister={vi.fn()}
        onSettings={vi.fn()}
        onDashboard={vi.fn()}
        projects={sampleProjects}
        onSelectProject={vi.fn()}
      />
    )

    expect(screen.getByPlaceholderText(/buscar acciones o proyectos/i)).toBeTruthy()
    expect(screen.getByText('Registrar nuevo proyecto')).toBeTruthy()
    expect(screen.getByText('Ir al Panel Local / Dashboard')).toBeTruthy()
    expect(screen.getByText('Dashboard Web')).toBeTruthy()
    expect(screen.getByText('API Server')).toBeTruthy()
  })

  it('filtra reactivamente proyectos y acciones al escribir en el buscador', async () => {
    const user = userEvent.setup()
    render(
      <Palette
        onClose={vi.fn()}
        onRegister={vi.fn()}
        onSettings={vi.fn()}
        onDashboard={vi.fn()}
        projects={sampleProjects}
        onSelectProject={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText(/buscar acciones o proyectos/i)
    await user.type(input, 'FastAPI')

    expect(screen.getByText('API Server')).toBeTruthy()
    expect(screen.queryByText('Dashboard Web')).toBeNull()
    expect(screen.queryByText('Registrar nuevo proyecto')).toBeNull()
  })

  it('permite seleccionar un proyecto al hacer clic', async () => {
    const user = userEvent.setup()
    const onSelectProject = vi.fn()
    const onClose = vi.fn()

    render(
      <Palette
        onClose={onClose}
        onRegister={vi.fn()}
        onSettings={vi.fn()}
        onDashboard={vi.fn()}
        projects={sampleProjects}
        onSelectProject={onSelectProject}
      />
    )

    await user.click(screen.getByText('Dashboard Web'))
    expect(onSelectProject).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalled()
  })

  it('soporta navegación con teclado (flecha abajo y Enter)', async () => {
    const onClose = vi.fn()
    const onRegister = vi.fn()

    render(
      <Palette
        onClose={onClose}
        onRegister={onRegister}
        onSettings={vi.fn()}
        onDashboard={vi.fn()}
        projects={sampleProjects}
        onSelectProject={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText(/buscar acciones o proyectos/i)
    // Presionar Enter en el primer elemento seleccionado por defecto ("Registrar nuevo proyecto")
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRegister).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('muestra mensaje de estado vacío cuando no hay coincidencias', async () => {
    const user = userEvent.setup()
    render(
      <Palette
        onClose={vi.fn()}
        onRegister={vi.fn()}
        onSettings={vi.fn()}
        onDashboard={vi.fn()}
        projects={sampleProjects}
        onSelectProject={vi.fn()}
      />
    )

    const input = screen.getByPlaceholderText(/buscar acciones o proyectos/i)
    await user.type(input, 'terminoinexistentexyz')

    expect(screen.getByText(/no se encontraron acciones ni proyectos/i)).toBeTruthy()
  })
})
