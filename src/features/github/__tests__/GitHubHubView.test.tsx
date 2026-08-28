import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubHubView } from '../GitHubHubView'
import type { GitHubAccountStatus, GitHubRepo } from '../../../types'

vi.mock('../../../api', () => ({ api: { openExternalUrl: vi.fn() } }))

function repo(over: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    name: 'web-dashboard',
    fullName: 'demo/web-dashboard',
    description: 'Panel de control',
    htmlUrl: 'https://github.com/demo/web-dashboard',
    cloneUrl: 'https://github.com/demo/web-dashboard.git',
    isPrivate: false,
    language: 'TypeScript',
    stars: 0,
    forks: 0,
    updatedAt: new Date(Date.now() - 3 * 24 * 3600_000).toISOString(),
    defaultBranch: 'main',
    isCloned: false,
    ...over,
  }
}

const cuenta: GitHubAccountStatus = { authenticated: true, username: 'demo', totalRepos: 2 }

async function montarEnGrilla(repos: GitHubRepo[]) {
  const props = {
    status: cuenta,
    repos,
    loading: false,
    onRefresh: vi.fn(),
    onClone: vi.fn(),
    onOpenLocal: vi.fn(),
    onSafeOffload: vi.fn(),
    onOpenSettings: vi.fn(),
    busy: null,
  }
  render(<GitHubHubView {...props} />)
  await userEvent.click(screen.getByRole('button', { name: /vista en tarjetas/i }))
  return props
}

beforeEach(() => vi.clearAllMocks())

describe('Grilla de repositorios: la materia de la tarjeta dice si ocupa disco', () => {
  it('lo clonado tiene cuerpo; lo que sigue en la nube, contorno', async () => {
    await montarEnGrilla([repo({ isCloned: true }), repo({ id: 2, name: 'api-service', fullName: 'demo/api-service' })])
    const tarjetas = document.querySelectorAll('.repo-card')
    expect(tarjetas[0].className).toContain('presente')
    expect(tarjetas[1].className).toContain('ausente')
    expect(screen.getByText('En tu Mac')).toBeTruthy()
    expect(screen.getByText('Solo en la nube')).toBeTruthy()
  })

  it('cada estado ofrece solo sus acciones', async () => {
    const { onClone, onSafeOffload } = await montarEnGrilla([
      repo({ isCloned: true }),
      repo({ id: 2, name: 'api-service', fullName: 'demo/api-service' }),
    ])
    await userEvent.click(screen.getByRole('button', { name: /liberar/i }))
    expect(onSafeOffload).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /clonar/i }))
    expect(onClone).toHaveBeenCalled()
  })
})

describe('Grilla: solo se dibuja lo que informa', () => {
  it('no repite el dueño cuando el repositorio es de tu cuenta', async () => {
    await montarEnGrilla([repo()])
    expect(document.querySelectorAll('.repo-duenio')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /web-dashboard/ })).toBeTruthy()
  })

  it('muestra el dueño cuando el repositorio es de otra cuenta', async () => {
    await montarEnGrilla([repo({ fullName: 'otra-org/web-dashboard' })])
    expect(screen.getByText('otra-org/')).toBeTruthy()
  })

  it('la visibilidad solo se dibuja si es privada', async () => {
    await montarEnGrilla([repo(), repo({ id: 2, name: 'secreto', fullName: 'demo/secreto', isPrivate: true })])
    const grilla = document.querySelector('.repo-grid') as HTMLElement
    expect(within(grilla).queryByText(/público/i)).toBeNull()
    expect(document.querySelectorAll('.repo-privado')).toHaveLength(1)
  })

  it('la fecha se cuenta en tiempo relativo, no en formato de calendario', async () => {
    await montarEnGrilla([repo()])
    expect(screen.getByText(/hace 3 días/)).toBeTruthy()
    expect(screen.queryByText(/Actualizado:/)).toBeNull()
  })
})
