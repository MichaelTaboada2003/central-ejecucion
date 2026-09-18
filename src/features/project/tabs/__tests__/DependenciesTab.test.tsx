import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DependenciesTab } from '../DependenciesTab'
import { detalle, proyecto } from '../../../../test/fixtures'
import { IDLE_INSTALL_ACTIVITY, type InstallActivity } from '../../../../hooks/useInstallActivity'
import type { ProjectDetail } from '../../../../types'
import { api } from '../../../../api'

function montar(scan: Partial<ProjectDetail['scan']>, install?: InstallActivity, onRun = vi.fn()) {
  const base = detalle().scan
  render(
    <DependenciesTab
      scan={{ ...base, ...scan } as ProjectDetail['scan']}
      onRun={onRun}
      busy={null}
      install={install}
      onOpenLogs={vi.fn()}
    />
  )
  return onRun
}

function instalando(overrides: Partial<InstallActivity> = {}): InstallActivity {
  return {
    ...IDLE_INSTALL_ACTIVITY,
    running: true,
    command: 'pnpm install',
    elapsedMs: 72_000,
    progress: {
      phase: 'downloading',
      detail: 'Descargando react 19.1.0',
      resolved: 512,
      downloaded: 200,
      installed: null,
      expected: 480,
      ratio: null,
    },
    lines: ['Progress: resolved 512, reused 0, downloaded 200, added 0'],
    ...overrides,
  }
}

describe('DependenciesTab: el estado del entorno dice la verdad', () => {
  it('sin dependencias declaradas no hay nada que avisar', () => {
    montar({ declaredDependencies: 0, dependencies: [], installedDependencies: true })
    expect(screen.getByText('Este proyecto no declara dependencias.')).toBeTruthy()
    expect(screen.queryByText(/no se detectó el directorio/i)).toBeNull()
    expect(screen.getByRole('button', { name: /instalar dependencias/i })).toHaveProperty('disabled', true)
  })

  it('cuando están instaladas dice DÓNDE, no un genérico', () => {
    montar({ declaredDependencies: 12, installedDependencies: true, environmentDir: '.venv312' })
    expect(screen.getByText('Dependencias instaladas en «.venv312».')).toBeTruthy()
  })

  it('cuando faltan nombra el directorio de ESTA pila, no node_modules por defecto', () => {
    montar({ declaredDependencies: 8, installedDependencies: false, missingEnvironment: ['vendor'] })
    expect(screen.getByText(/Falta vendor/)).toBeTruthy()
    expect(screen.queryByText(/node_modules/)).toBeNull()
  })

  it('una pila que no guarda dependencias en el proyecto no reporta un directorio ausente', () => {
    montar({ declaredDependencies: 30, installedDependencies: true, environmentDir: null, missingEnvironment: [] })
    expect(screen.getByText(/no las guarda dentro del proyecto/i)).toBeTruthy()
  })
})

describe('DependenciesTab: la instalación se ve mientras ocurre', () => {
  it('mientras instala no dice que falta el entorno: dice que lo está creando', () => {
    montar({ declaredDependencies: 8, installedDependencies: false, missingEnvironment: ['node_modules'] }, instalando())
    expect(screen.getByText('Creando «node_modules» con las 8 dependencias declaradas…')).toBeTruthy()
    expect(screen.queryByText(/Falta node_modules/)).toBeNull()
  })

  it('el botón deja de invitar a repetir lo que ya está en marcha', () => {
    montar({ declaredDependencies: 8, installedDependencies: false }, instalando())
    const boton = screen.getByRole('button', { name: /instalando…/i })
    expect(boton).toHaveProperty('disabled', true)
  })

  it('cuenta la fase, el tiempo y la última línea real del gestor', () => {
    montar({ declaredDependencies: 8, installedDependencies: false }, instalando())
    expect(screen.getByText('Descargando react 19.1.0')).toBeTruthy()
    expect(screen.getByText('01:12')).toBeTruthy()
    expect(screen.getByText(/512 resueltos · 200 descargados/)).toBeTruthy()
    expect(screen.getByText('pnpm install')).toBeTruthy()
  })

  it('sin cifras del gestor la barra no finge un porcentaje', () => {
    const { container } = render(
      <DependenciesTab
        scan={detalle().scan}
        onRun={vi.fn()}
        busy={null}
        install={instalando()}
      />
    )
    const barra = container.querySelector('[role="progressbar"]')
    expect(barra?.getAttribute('aria-valuenow')).toBeNull()
    expect(container.querySelector('.install-bar-fill.indeterminada')).toBeTruthy()
  })

  it('con cifras del gestor la barra publica el avance', () => {
    const { container } = render(
      <DependenciesTab
        scan={detalle().scan}
        onRun={vi.fn()}
        busy={null}
        install={instalando({ progress: { ...instalando().progress, ratio: 0.5 } })}
      />
    )
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50')
  })

  it('al terminar se anuncia el resultado en vez de cambiar la pantalla a solas', () => {
    montar(
      { declaredDependencies: 8, installedDependencies: true },
      {
        ...IDLE_INSTALL_ACTIVITY,
        outcome: { ok: true, cancelled: false, durationMs: 72_000, packages: 512, message: null },
      }
    )
    expect(screen.getByText('Dependencias instaladas')).toBeTruthy()
    expect(screen.getByText('512 paquetes en 1 min 12 s')).toBeTruthy()
  })

  it('un fallo ofrece reintentar sin buscar el botón de nuevo', () => {
    const onRun = montar(
      { declaredDependencies: 8, installedDependencies: false },
      {
        ...IDLE_INSTALL_ACTIVITY,
        outcome: { ok: false, cancelled: false, durationMs: 4_000, packages: null, message: 'ERR_PNPM_FETCH_404' },
      }
    )
    expect(screen.getByText('ERR_PNPM_FETCH_404')).toBeTruthy()
    screen.getByRole('button', { name: /reintentar/i }).click()
    expect(onRun).toHaveBeenCalledWith('install')
  })
})

describe('DependenciesTab: detección y eliminación de dependencias huérfanas', () => {
  it('detecta dependencias sin uso al pulsar el botón de auditoría', async () => {
    const p = proyecto()
    const scan: Partial<ProjectDetail['scan']> = {
      packageManager: 'pnpm',
      dependencies: [
        { name: 'react', version: '^19.0.0', isDev: false, source: 'package.json' },
        { name: 'lodash', version: '^4.17.21', isDev: false, source: 'package.json' },
      ],
    }

    vi.spyOn(api, 'auditDependencies').mockResolvedValueOnce({
      unused: ['lodash'],
      totalScannedFiles: 14,
      timestamp: new Date().toISOString(),
    })

    const onNotify = vi.fn()
    render(
      <DependenciesTab
        project={p}
        scan={{ ...detalle().scan, ...scan } as ProjectDetail['scan']}
        onRun={vi.fn()}
        busy={null}
        onNotify={onNotify}
      />
    )

    const auditBtn = screen.getByRole('button', { name: /detectar no usadas/i })
    expect(auditBtn).toBeTruthy()

    await act(async () => {
      fireEvent.click(auditBtn)
    })

    expect(api.auditDependencies).toHaveBeenCalledWith(p.id)
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('1 dependencias sin uso'), 'info')

    // Banner and chip
    expect(screen.getByText(/dependencias sin referencias directas/i)).toBeTruthy()
    const chipUnused = screen.getByRole('button', { name: /^sin uso \(1\)$/i })
    expect(chipUnused).toBeTruthy()

    // La tarjeta de lodash tiene el estilo distintivo dep-card-unused
    const cardLodash = screen.getByTitle(/clic para ver detalles y gestionar lodash/i)
    expect(cardLodash.classList.contains('dep-card-unused')).toBe(true)

    // Filter by unused
    await act(async () => {
      fireEvent.click(chipUnused)
    })
    expect(screen.getByText('lodash')).toBeTruthy()
    expect(screen.queryByText('react')).toBeNull()
  })

  it('permite abrir el modal de confirmación y eliminar una dependencia', async () => {
    const p = proyecto()
    const scan: Partial<ProjectDetail['scan']> = {
      packageManager: 'pnpm',
      dependencies: [
        { name: 'lodash', version: '^4.17.21', isDev: false, source: 'package.json' },
      ],
    }

    vi.spyOn(api, 'removeDependency').mockResolvedValueOnce('Dependencia eliminada con éxito')

    const onNotify = vi.fn()
    const onReloadProject = vi.fn()

    render(
      <DependenciesTab
        project={p}
        scan={{ ...detalle().scan, ...scan } as ProjectDetail['scan']}
        onRun={vi.fn()}
        busy={null}
        onNotify={onNotify}
        onReloadProject={onReloadProject}
      />
    )

    const deleteBtn = screen.getByRole('button', { name: /eliminar dependencia lodash/i })
    fireEvent.click(deleteBtn)

    // Modal appears
    expect(screen.getByText(/¿Desinstalar «lodash»\?/i)).toBeTruthy()
    expect(screen.getByText('pnpm remove lodash')).toBeTruthy()

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: /^eliminar dependencia$/i })
    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    expect(api.removeDependency).toHaveBeenCalledWith(p.id, 'lodash')
    expect(onNotify).toHaveBeenCalledWith('Dependencia eliminada con éxito', 'success')
    expect(onReloadProject).toHaveBeenCalled()
    expect(screen.queryByText(/¿Desinstalar «lodash»\?/i)).toBeNull()
  })

  it('cancela la eliminación si el usuario pulsa Cancelar', () => {
    const p = proyecto()
    const scan: Partial<ProjectDetail['scan']> = {
      packageManager: 'npm',
      dependencies: [
        { name: 'moment', version: '^2.29.4', isDev: false, source: 'package.json' },
      ],
    }

    const spyRemove = vi.spyOn(api, 'removeDependency')

    render(
      <DependenciesTab
        project={p}
        scan={{ ...detalle().scan, ...scan } as ProjectDetail['scan']}
        onRun={vi.fn()}
        busy={null}
      />
    )

    const deleteBtn = screen.getByRole('button', { name: /eliminar dependencia moment/i })
    fireEvent.click(deleteBtn)

    expect(screen.getByText(/¿Desinstalar «moment»\?/i)).toBeTruthy()

    const cancelBtn = screen.getByRole('button', { name: /cancelar/i })
    fireEvent.click(cancelBtn)

    expect(spyRemove).not.toHaveBeenCalled()
    expect(screen.queryByText(/¿Desinstalar «moment»\?/i)).toBeNull()
  })

  it('al hacer clic directamente en la tarjeta de una dependencia se abre el modal de gestión', () => {
    const p = proyecto()
    const scan: Partial<ProjectDetail['scan']> = {
      packageManager: 'pnpm',
      dependencies: [
        { name: 'clsx', version: '^2.1.1', isDev: false, source: 'package.json' },
      ],
    }

    render(
      <DependenciesTab
        project={p}
        scan={{ ...detalle().scan, ...scan } as ProjectDetail['scan']}
        onRun={vi.fn()}
        busy={null}
      />
    )

    // La tarjeta es seleccionable y tiene rol de botón
    const card = screen.getByTitle(/clic para ver detalles y gestionar clsx/i)
    fireEvent.click(card)

    // Se abre el modal con comando y detalles
    expect(screen.getByText(/¿Desinstalar «clsx»\?/i)).toBeTruthy()
    expect(screen.getByText('pnpm remove clsx')).toBeTruthy()

    // Cerrar el modal
    const closeBtn = screen.getByRole('button', { name: /cancelar/i })
    fireEvent.click(closeBtn)
    expect(screen.queryByText(/¿Desinstalar «clsx»\?/i)).toBeNull()
  })
})

