import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DependenciesTab } from '../DependenciesTab'
import { detalle } from '../../../../test/fixtures'
import { IDLE_INSTALL_ACTIVITY, type InstallActivity } from '../../../../hooks/useInstallActivity'
import type { ProjectDetail } from '../../../../types'

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
