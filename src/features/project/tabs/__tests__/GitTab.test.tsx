import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitTab } from '../GitTab'
import { estadoGit, proyecto } from '../../../../test/fixtures'

const api = vi.hoisted(() => ({
  getProjectGitStatus: vi.fn(),
  gitFetch: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitPull: vi.fn(),
  publishToGitHub: vi.fn(),
}))
vi.mock('../../../../api', () => ({ api }))

function montar(estado = estadoGit(), trasComprobar = estado) {
  api.getProjectGitStatus.mockResolvedValue(estado)
  api.gitFetch.mockResolvedValue(trasComprobar)
  api.gitCommit.mockResolvedValue({ success: true, message: 'Commit creado en local con 2 archivos: abc1234' })
  const onNotify = vi.fn()
  render(<GitTab project={proyecto()} onNotify={onNotify} onReloadProject={vi.fn()} />)
  return { onNotify }
}

const casillas = () => screen.getAllByRole('checkbox') as HTMLInputElement[]

beforeEach(() => vi.clearAllMocks())

describe('GitTab: selección de archivos', () => {
  it('empieza con todos los archivos marcados', async () => {
    montar()
    await screen.findByText('src/App.tsx')
    expect(casillas()).toHaveLength(3)
    expect(casillas().every(c => c.checked)).toBe(true)
    expect(screen.getByText('Entran 3 de 3 archivos')).toBeTruthy()
  })

  it('el commit incluye SOLO lo marcado', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText('src/App.tsx')

    await usuario.click(casillas()[1])
    expect(screen.getByText('Entran 2 de 3 archivos')).toBeTruthy()

    await usuario.type(screen.getByLabelText(/mensaje del commit/i), 'fix: algo')
    await usuario.click(screen.getByRole('button', { name: /hacer commit/i }))

    await waitFor(() => expect(api.gitCommit).toHaveBeenCalledTimes(1))
    expect(api.gitCommit).toHaveBeenCalledWith('proj-1', 'fix: algo', ['src/App.tsx', 'src/viejo.ts'])
  })

  it('«Quitar todos» deja el botón inhabilitado aunque haya mensaje', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText('src/App.tsx')

    await usuario.type(screen.getByLabelText(/mensaje del commit/i), 'fix: algo')
    await usuario.click(screen.getByRole('button', { name: /quitar todos/i }))

    expect(screen.getByText('No has seleccionado ningún archivo')).toBeTruthy()
    expect(screen.getByRole('button', { name: /hacer commit/i })).toHaveProperty('disabled', true)
  })

  it('sin mensaje no se puede commitear, por muchos archivos que haya', async () => {
    montar()
    await screen.findByText('src/App.tsx')
    expect(screen.getByRole('button', { name: /hacer commit/i })).toHaveProperty('disabled', true)
  })
})

describe('GitTab: commit y push son acciones separadas', () => {
  it('el commit no sube nada: no llama a push', async () => {
    const usuario = userEvent.setup()
    montar()
    await screen.findByText('src/App.tsx')
    await usuario.type(screen.getByLabelText(/mensaje del commit/i), 'fix: algo')
    await usuario.click(screen.getByRole('button', { name: /hacer commit/i }))
    await waitFor(() => expect(api.gitCommit).toHaveBeenCalled())
    expect(api.gitPush).not.toHaveBeenCalled()
  })

  it('Push está inhabilitado sin commits pendientes, aunque haya cambios sin commitear', async () => {
    montar(estadoGit({ aheadCount: 0 }))
    await screen.findByText('src/App.tsx')
    expect(screen.getByRole('button', { name: /^push/i })).toHaveProperty('disabled', true)
  })

  it('Push se habilita en cuanto hay commits por subir', async () => {
    montar(estadoGit({ aheadCount: 2 }))
    await screen.findByText('src/App.tsx')
    expect(screen.getByRole('button', { name: /push/i })).toHaveProperty('disabled', false)
    expect(screen.getByText(/2 por subir/)).toBeTruthy()
  })
})

describe('GitTab: estados del repositorio', () => {
  it('un HEAD desacoplado se dice con todas las letras', async () => {
    montar(estadoGit({ currentBranch: null }))
    expect(await screen.findByText(/HEAD desacoplado/)).toBeTruthy()
  })

  it('sin remoto avisa de que el commit se queda en local', async () => {
    montar(estadoGit({ remoteUrl: null, remoteName: null }))
    await screen.findByText('src/App.tsx')
    expect(screen.getByText(/no tiene remoto configurado/i)).toBeTruthy()
  })

  it('sin cambios no ofrece el compositor de commit', async () => {
    montar(estadoGit({ uncommittedChanges: [], isClean: true }))
    expect(await screen.findByText(/no tienes archivos modificados/i)).toBeTruthy()
    expect(screen.queryByLabelText(/mensaje del commit/i)).toBeNull()
  })
})

describe('GitTab: avisar de lo que espera en GitHub', () => {
  it('al abrir la pestaña consulta GitHub: si no, «0 por bajar» sería un dato viejo', async () => {
    montar()
    await waitFor(() => expect(api.gitFetch).toHaveBeenCalledWith('proj-1'))
  })

  it('avisa con el número de commits y ofrece bajarlos ahí mismo', async () => {
    const usuario = userEvent.setup()
    api.gitPull.mockResolvedValue({ success: true, message: 'Cambios descargados.' })
    montar(estadoGit(), estadoGit({ behindCount: 3, lastFetchAt: new Date().toISOString() }))

    const aviso = await screen.findByRole('status')
    expect(within(aviso).getByText(/GitHub tiene 3 commits nuevos en main/)).toBeTruthy()

    await usuario.click(within(aviso).getByRole('button', { name: /bajar cambios/i }))
    await waitFor(() => expect(api.gitPull).toHaveBeenCalledWith('proj-1'))
  })

  it('sin novedades no hay aviso', async () => {
    montar(estadoGit(), estadoGit({ behindCount: 0, lastFetchAt: new Date().toISOString() }))
    await waitFor(() => expect(api.gitFetch).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('dice cuándo se comprobó, y avisa cuando nunca se ha hecho', async () => {
    montar(estadoGit({ lastFetchAt: null }), estadoGit({ lastFetchAt: null }))
    expect(await screen.findByText('Sin comprobar')).toBeTruthy()
  })

  it('un fallo al comprobar no interrumpe: la pestaña sigue usable con lo local', async () => {
    const { onNotify } = montar()
    api.gitFetch.mockRejectedValue(new Error('sin red'))
    await screen.findByText('src/App.tsx')
    await waitFor(() => expect(api.gitFetch).toHaveBeenCalled())
    expect(onNotify).not.toHaveBeenCalledWith('sin red', 'error')
    expect(screen.getByText('src/App.tsx')).toBeTruthy()
  })

  it('un proyecto sin remoto no consulta nada', async () => {
    montar(estadoGit({ remoteUrl: null, remoteName: null }))
    await screen.findByText('src/App.tsx')
    expect(api.gitFetch).not.toHaveBeenCalled()
  })
})

describe('GitTab: publicar en GitHub', () => {
  it('un proyecto con git pero SIN remoto ofrece el formulario, no un botón que no abre nada', async () => {
    montar(estadoGit({ remoteUrl: null, remoteName: null, remoteBranches: [] }))
    expect(await screen.findByLabelText(/nombre del repositorio/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /crear repositorio y subir/i })).toBeTruthy()
  })

  it('el nombre y la visibilidad viajan como los eligió el usuario', async () => {
    const usuario = userEvent.setup()
    api.publishToGitHub.mockResolvedValue({ success: true, message: 'Publicado' })
    montar(estadoGit({ remoteUrl: null, remoteName: null, remoteBranches: [] }))

    const nombre = await screen.findByLabelText(/nombre del repositorio/i)
    await usuario.clear(nombre)
    await usuario.type(nombre, 'panel de control')
    await usuario.click(screen.getByRole('radio', { name: /privado/i }))
    await usuario.click(screen.getByRole('button', { name: /crear repositorio y subir/i }))

    await waitFor(() => expect(api.publishToGitHub).toHaveBeenCalled())
    expect(api.publishToGitHub).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', repoName: 'panel-de-control', isPrivate: true })
    )
  })

  it('enseña a dónde va a parar, con el nombre ya corregido', async () => {
    const usuario = userEvent.setup()
    montar(estadoGit({ remoteUrl: null, remoteName: null, remoteBranches: [] }))
    const nombre = await screen.findByLabelText(/nombre del repositorio/i)
    await usuario.clear(nombre)
    await usuario.type(nombre, 'Mi Proyecto!')
    expect(screen.getByText(/Mi-Proyecto/)).toBeTruthy()
  })

  it('sin nombre no se puede publicar', async () => {
    const usuario = userEvent.setup()
    montar(estadoGit({ remoteUrl: null, remoteName: null, remoteBranches: [] }))
    await usuario.clear(await screen.findByLabelText(/nombre del repositorio/i))
    expect(screen.getByRole('button', { name: /crear repositorio y subir/i })).toHaveProperty('disabled', true)
  })
})
