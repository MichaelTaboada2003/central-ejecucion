import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEnvVars } from '../useEnvVars'
import type { ProjectEnvVars } from '../../types'

const api = vi.hoisted(() => ({
  getProjectEnvVars: vi.fn(),
  saveEnvVar: vi.fn(),
  deleteEnvVars: vi.fn(),
  importEnvVars: vi.fn(),
  writeEnvFile: vi.fn(),
  exportEnvVars: vi.fn(),
}))
vi.mock('../../api', () => ({ api }))

function boveda(projectId: string): ProjectEnvVars {
  return { projectId, vars: [], files: [], unprotectedKeys: 0 }
}

/**
 * Reproduce cómo lo usa `ProjectWorkspace`: el `notify` llega como flecha en
 * línea, así que es una función distinta en cada render.
 */
function Anfitrion({ projectId }: { projectId: string }) {
  const [contador, setContador] = useState(0)
  const env = useEnvVars({ projectId, notify: (texto, tono) => void [texto, tono] })
  return (
    <button onClick={() => setContador(actual => actual + 1)}>
      renders:{contador} cargado:{env.data ? 'sí' : 'no'}
    </button>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getProjectEnvVars.mockImplementation((id: string) => Promise.resolve(boveda(id)))
})

describe('useEnvVars', () => {
  /// Regresión: con `notify` en las dependencias de `load`, y `load` en el
  /// efecto de carga, cada render volvía a pedir la bóveda y el resultado era
  /// una petición por render, sin fin.
  it('no vuelve a pedir la bóveda porque el componente se repinte', async () => {
    const usuario = userEvent.setup()
    render(<Anfitrion projectId="proj-1" />)

    await waitFor(() => expect(screen.getByRole('button').textContent).toContain('cargado:sí'))
    expect(api.getProjectEnvVars).toHaveBeenCalledTimes(1)

    await usuario.click(screen.getByRole('button'))
    await usuario.click(screen.getByRole('button'))

    expect(screen.getByRole('button').textContent).toContain('renders:2')
    expect(api.getProjectEnvVars).toHaveBeenCalledTimes(1)
  })

  it('cambiar de proyecto sí recarga', async () => {
    const { rerender } = render(<Anfitrion projectId="proj-1" />)
    await waitFor(() => expect(api.getProjectEnvVars).toHaveBeenCalledWith('proj-1'))

    rerender(<Anfitrion projectId="proj-2" />)
    await waitFor(() => expect(api.getProjectEnvVars).toHaveBeenCalledWith('proj-2'))
    expect(api.getProjectEnvVars).toHaveBeenCalledTimes(2)
  })

  /// Guardar tiene que dejar a la vista el nuevo estado de sincronización, que
  /// solo lo sabe el backend cruzando disco y base.
  it('cada mutación recarga el conjunto completo', async () => {
    const usuario = userEvent.setup()
    api.saveEnvVar.mockResolvedValue({ key: 'API_TOKEN', scope: '.env' })

    function Formulario() {
      const env = useEnvVars({ projectId: 'proj-1', notify: () => {} })
      return (
        <button onClick={() => void env.saveVar({ scope: '.env', key: 'API_TOKEN', value: 'x' })}>guardar</button>
      )
    }
    render(<Formulario />)
    await waitFor(() => expect(api.getProjectEnvVars).toHaveBeenCalledTimes(1))

    await usuario.click(screen.getByRole('button'))
    await waitFor(() => expect(api.getProjectEnvVars).toHaveBeenCalledTimes(2))
  })
})
