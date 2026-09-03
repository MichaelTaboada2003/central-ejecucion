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

  it('un script NO se ejecuta desde el panel: se gestiona', () => {
    montar({
      project: proyecto({ kind: 'script', port: null, localUrl: null, devCommand: 'python main.py' }),
      scan: {
        kind: 'script',
        devCommand: 'python main.py',
        port: null,
        localUrl: null,
        installedDependencies: true,
        declaredDependencies: 3,
        scripts: [{ name: 'main.py', command: 'python main.py', source: 'main.py' }],
      } as ProjectDetail['scan'],
    })
    expect(document.querySelector('.kind-badge')?.textContent).toContain('Script')
    expect(document.querySelector('.estado-no-ejecutable')?.textContent).toBe('Script')
    expect(screen.queryByRole('button', { name: /ejecutar/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^run$/i })).toBeNull()
  })

  it('un script no muestra las pestañas de ejecución', () => {
    montar({
      project: proyecto({ kind: 'script', port: null, localUrl: null }),
      scan: { kind: 'script', installedDependencies: true, declaredDependencies: 3, scripts: [] } as unknown as ProjectDetail['scan'],
    })
    const barra = document.querySelector('.tabs') as HTMLElement
    const pestanas = [...barra.querySelectorAll('button')].map(b => (b.textContent ?? '').trim())
    // «Entorno» sigue estando: un script también lee su `.env`, y sus
    // credenciales corren el mismo riesgo al borrar el proyecto.
    expect(pestanas).toEqual(['Resumen', 'Git & GitHub', 'Dependencias', 'Disco y limpieza', 'Entorno', 'Configuración'])
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
    expect(screen.queryByRole('button', { name: /^run$/i })).toBeNull()
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

  it('la naturaleza que se muestra es la deducida por el detector', () => {
    montar({ project: proyecto({ kind: 'service' }) })
    expect(document.querySelector('.kind-badge')?.textContent).toContain('Servicio')
  })
})
