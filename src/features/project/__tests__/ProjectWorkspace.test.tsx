import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectWorkspace } from '../ProjectWorkspace'
import { detalle, proyecto } from '../../../test/fixtures'
import type { ProjectDetail } from '../../../types'

const api = vi.hoisted(() => ({ getProjectGitStatus: vi.fn(), openExternalUrl: vi.fn() }))
vi.mock('../../../api', () => ({ api }))

const onRun = vi.fn()
function montar(over: Partial<ProjectDetail> = {}) {
  const props = {
    detail: detalle(over),
    tab: 'summary' as const,
    setTab: vi.fn(),
    logs: [],
    setLogs: vi.fn(),
    disk: null,
    busy: null,
    onBack: vi.fn(),
    onRun,
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onRefresh: vi.fn(),
    onDisk: vi.fn(),
    onPreviewCleanup: vi.fn(),
    onLaunchTool: vi.fn(),
    onOpenUrl: vi.fn(),
    onNotify: vi.fn(),
    onDeleteProject: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleArchive: vi.fn(),
    onKindChange: vi.fn(),
  }
  render(<ProjectWorkspace {...props} />)
  return props
}

beforeEach(() => vi.clearAllMocks())

describe('ProjectWorkspace: la acción principal depende de la naturaleza', () => {
  it('un servicio ofrece «Run» y arranca el servidor de desarrollo', async () => {
    const usuario = userEvent.setup()
    montar()
    expect(screen.getByText('Servicio')).toBeTruthy()
    await usuario.click(screen.getByRole('button', { name: /^run$/i }))
    expect(onRun).toHaveBeenCalledWith('dev', undefined)
  })

  it('un script ejecuta SU tarea, no un servidor de desarrollo', async () => {
    const usuario = userEvent.setup()
    montar({
      project: proyecto({ kind: 'script', port: null, localUrl: null, devCommand: 'python main.py' }),
      scan: {
        kind: 'script',
        devCommand: 'python main.py',
        port: null,
        localUrl: null,
        scripts: [{ name: 'main.py', command: 'python main.py', source: 'main.py' }],
      } as ProjectDetail['scan'],
    })
    expect(screen.getByText('Script')).toBeTruthy()
    await usuario.click(screen.getByRole('button', { name: /ejecutar main\.py/i }))
    expect(onRun).toHaveBeenCalledWith('script', 'main.py')
  })

  it('un cuaderno abre Jupyter Lab', async () => {
    const usuario = userEvent.setup()
    montar({
      project: proyecto({ kind: 'notebook', port: 8888, localUrl: 'http://localhost:8888' }),
      scan: {
        kind: 'notebook',
        devCommand: 'jupyter lab',
        port: 8888,
        scripts: [{ name: 'notebook', command: 'jupyter lab', source: 'Jupyter' }],
      } as ProjectDetail['scan'],
    })
    await usuario.click(screen.getByRole('button', { name: /abrir jupyter lab/i }))
    expect(onRun).toHaveBeenCalledWith('notebook', undefined)
  })

  it('un proyecto sin nada ejecutable no ofrece ningún botón de arranque', () => {
    montar({
      project: proyecto({ kind: 'inert', port: null, localUrl: null, devCommand: null }),
      scan: { kind: 'inert', devCommand: null, port: null, scripts: [] } as unknown as ProjectDetail['scan'],
    })
    expect(screen.getByText(/sin nada que ejecutar/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^run$/i })).toBeNull()
  })
})

describe('ProjectWorkspace: sin dependencias, el siguiente paso es instalarlas', () => {
  it('ofrece instalar en vez de un botón apagado con un consejo escondido', async () => {
    const usuario = userEvent.setup()
    montar({
      project: proyecto({ kind: 'script', port: null, localUrl: null, devCommand: 'python main.py' }),
      scan: {
        kind: 'script',
        devCommand: 'python main.py',
        port: null,
        installedDependencies: false,
        declaredDependencies: 40,
        packageManager: 'pip',
        scripts: [{ name: 'main.py', command: 'python main.py', source: 'main.py' }],
      } as ProjectDetail['scan'],
    })

    const boton = screen.getByRole('button', { name: /instalar dependencias/i })
    expect(boton).toHaveProperty('disabled', false)
    await usuario.click(boton)
    expect(onRun).toHaveBeenCalledWith('install')
  })

  it('con el entorno listo vuelve a ofrecer la ejecución', () => {
    montar({
      project: proyecto({ kind: 'script', port: null, localUrl: null, devCommand: 'python main.py' }),
      scan: {
        kind: 'script',
        devCommand: 'python main.py',
        installedDependencies: true,
        declaredDependencies: 40,
        scripts: [{ name: 'main.py', command: 'python main.py', source: 'main.py' }],
      } as ProjectDetail['scan'],
    })
    expect(screen.getByRole('button', { name: /ejecutar main\.py/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /instalar dependencias/i })).toBeNull()
  })
})

describe('ProjectWorkspace: puerto y URL solo donde tienen sentido', () => {
  it('un servicio muestra su puerto y el enlace para abrirlo', () => {
    montar()
    // «:3000» aparece también en la URL del enlace: se busca la etiqueta.
    expect(screen.getByText(/Puerto:/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /abrir http/i })).toBeTruthy()
  })

  it('un script no muestra puerto ni URL aunque la fila guarde uno viejo', () => {
    montar({
      project: proyecto({ kind: 'script', port: 3000, localUrl: 'http://localhost:3000' }),
      scan: { kind: 'script', scripts: [{ name: 'main.py', command: 'python main.py', source: 'main.py' }] } as ProjectDetail['scan'],
    })
    expect(screen.queryByText(/Puerto:/)).toBeNull()
    expect(screen.queryByRole('button', { name: /abrir http/i })).toBeNull()
  })

  it('la naturaleza fijada a mano manda sobre la deducida', () => {
    montar({ project: proyecto({ kind: 'script', kindOverride: 'service' }) })
    expect(screen.getByText('Servicio')).toBeTruthy()
  })
})
