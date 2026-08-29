import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DependenciesTab } from '../DependenciesTab'
import { detalle } from '../../../../test/fixtures'
import type { ProjectDetail } from '../../../../types'

function montar(scan: Partial<ProjectDetail['scan']>) {
  const base = detalle().scan
  render(<DependenciesTab scan={{ ...base, ...scan } as ProjectDetail['scan']} onRun={vi.fn()} busy={null} />)
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
