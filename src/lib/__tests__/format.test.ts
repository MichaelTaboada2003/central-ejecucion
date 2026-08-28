import { describe, expect, it } from 'vitest'
import { commandDuration, describeCommandOutcome, formatBytes, formatDate, getStackClass } from '../format'
import type { CommandRecord } from '../../types'

function registro(overrides: Partial<CommandRecord>): CommandRecord {
  return {
    id: 'cmd-1',
    projectId: 'p1',
    action: 'dev',
    command: 'pnpm run dev',
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: null,
    exitCode: null,
    status: 'completed',
    errorMessage: null,
    ...overrides,
  }
}

describe('formatBytes', () => {
  it('cero se muestra explícito, no como cadena vacía', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('escala de unidad y decimales solo a partir de MB', () => {
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB')
  })
})

describe('formatDate', () => {
  it('una fecha inválida no rompe la interfaz', () => {
    expect(formatDate('no es una fecha')).toBe('—')
    expect(formatDate('')).toBe('—')
  })

  it('una fecha válida se formatea', () => {
    expect(formatDate('2026-01-01T10:00:00Z')).not.toBe('—')
  })
})

describe('getStackClass', () => {
  it('agrupa por familia sin importar mayúsculas', () => {
    expect(getStackClass('React')).toBe('react')
    expect(getStackClass('Next.js')).toBe('')
    expect(getStackClass('Django')).toBe('python')
    expect(getStackClass('FastAPI')).toBe('python')
    expect(getStackClass('Astro')).toBe('astro')
  })
})

describe('commandDuration', () => {
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')

  it('mide lo que lleva una ejecución en curso', () => {
    expect(commandDuration(registro({ status: 'running' }), inicio + 12_000)).toBe('12s')
  })

  it('cambia a minutos y a horas', () => {
    expect(commandDuration(registro({ endedAt: '2026-01-01T10:01:30.000Z' }))).toBe('1m 30s')
    expect(commandDuration(registro({ endedAt: '2026-01-01T12:05:00.000Z' }))).toBe('2h 5m')
  })

  it('devuelve nulo si las marcas de tiempo no tienen sentido', () => {
    expect(commandDuration(registro({ startedAt: 'basura' }))).toBeNull()
    expect(commandDuration(registro({ endedAt: '2025-01-01T00:00:00.000Z' }))).toBeNull()
  })
})

describe('describeCommandOutcome', () => {
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')

  it('un código 0 es un final correcto, con su duración', () => {
    const r = registro({ endedAt: '2026-01-01T10:00:05.000Z', exitCode: 0 })
    expect(describeCommandOutcome(r)).toBe('terminó (0) · 5s')
  })

  it('un código distinto de 0 se muestra como fallo con el número', () => {
    const r = registro({ endedAt: '2026-01-01T10:00:05.000Z', exitCode: 1, status: 'error' })
    expect(describeCommandOutcome(r)).toBe('falló (1) · 5s')
  })

  it('detenerlo a mano no es un fallo', () => {
    const r = registro({ endedAt: '2026-01-01T10:00:05.000Z', exitCode: null, status: 'stopped' })
    expect(describeCommandOutcome(r)).toBe('detenido a mano · 5s')
  })

  it('una ejecución en curso lo dice, no inventa un resultado', () => {
    expect(describeCommandOutcome(registro({ status: 'running' }), inicio + 3_000)).toBe('ejecutando · 3s')
  })
})
