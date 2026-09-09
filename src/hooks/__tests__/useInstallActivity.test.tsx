import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInstallActivity } from '../useInstallActivity'
import { detalle } from '../../test/fixtures'
import type { TerminalEntry } from '../../lib/logs'
import type { CommandRecord, ProjectDetail } from '../../types'

const INICIO = '2026-01-01T10:00:00.000Z'

function registroInstalando(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id: 'cmd-install',
    projectId: 'proj-1',
    action: 'install',
    command: 'pnpm install',
    startedAt: INICIO,
    endedAt: null,
    exitCode: null,
    status: 'running',
    errorMessage: null,
    ...overrides,
  }
}

function instalando(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return detalle({
    process: { projectId: 'proj-1', pid: 4242, startedAt: INICIO, command: 'pnpm install' },
    recentCommands: [registroInstalando()],
    ...overrides,
  })
}

function linea(line: string, seq = 0): TerminalEntry {
  return { projectId: 'proj-1', stream: 'stdout', line, timestamp: '2026-01-01T10:00:05.000Z', seq }
}

beforeEach(() => vi.clearAllMocks())

describe('useInstallActivity: la instalación deja de ser invisible', () => {
  it('reconoce la instalación en curso y lee su avance de los logs', () => {
    const { result } = renderHook(() =>
      useInstallActivity({
        detail: instalando(),
        logs: [linea('Packages: +480'), linea('Progress: resolved 512, reused 0, downloaded 200, added 240', 1)],
      })
    )
    expect(result.current.running).toBe(true)
    expect(result.current.command).toBe('pnpm install')
    expect(result.current.progress.phase).toBe('installing')
    expect(result.current.progress.ratio).toBeCloseTo(0.5)
    expect(result.current.lines).toHaveLength(2)
  })

  it('ignora la salida de comandos anteriores del mismo proyecto', () => {
    const { result } = renderHook(() =>
      useInstallActivity({
        detail: instalando(),
        logs: [
          { ...linea('Progress: resolved 900, reused 0, downloaded 0, added 900'), timestamp: '2026-01-01T09:00:00.000Z' },
          linea('Progress: resolved 10, reused 0, downloaded 0, added 0', 1),
        ],
      })
    )
    expect(result.current.progress.resolved).toBe(10)
    expect(result.current.lines).toHaveLength(1)
  })

  it('un registro «running» sin proceso vivo es basura de una sesión anterior', () => {
    const { result } = renderHook(() =>
      useInstallActivity({ detail: detalle({ recentCommands: [registroInstalando()], process: null }), logs: [] })
    )
    expect(result.current.running).toBe(false)
  })

  it('al terminar anuncia el desenlace con sus cifras, una sola vez', () => {
    const onFinish = vi.fn()
    const { result, rerender } = renderHook(
      ({ detail }: { detail: ProjectDetail }) =>
        useInstallActivity({ detail, logs: [linea('added 512 packages in 31s')], onFinish }),
      { initialProps: { detail: instalando() } }
    )
    expect(result.current.running).toBe(true)

    const terminado = detalle({
      process: null,
      recentCommands: [
        registroInstalando({ status: 'completed', exitCode: 0, endedAt: '2026-01-01 10:00:47' }),
      ],
    })
    rerender({ detail: terminado })

    expect(result.current.running).toBe(false)
    expect(result.current.outcome).toEqual({
      ok: true,
      cancelled: false,
      // El fin lo escribe SQLite sin zona horaria: leerlo como hora local daba
      // duraciones de horas para una instalación de segundos.
      durationMs: 47_000,
      packages: 512,
      message: null,
    })
    expect(onFinish).toHaveBeenCalledTimes(1)

    rerender({ detail: terminado })
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('distingue una cancelación de un fallo', () => {
    const { result, rerender } = renderHook(
      ({ detail }: { detail: ProjectDetail }) => useInstallActivity({ detail, logs: [] }),
      { initialProps: { detail: instalando() } }
    )
    rerender({
      detail: detalle({
        process: null,
        recentCommands: [registroInstalando({ status: 'stopped', endedAt: '2026-01-01 10:00:10' })],
      }),
    })
    expect(result.current.outcome?.cancelled).toBe(true)
    expect(result.current.outcome?.ok).toBe(false)
  })

  it('el desenlace se puede descartar', () => {
    const { result, rerender } = renderHook(
      ({ detail }: { detail: ProjectDetail }) => useInstallActivity({ detail, logs: [] }),
      { initialProps: { detail: instalando() } }
    )
    rerender({
      detail: detalle({
        process: null,
        recentCommands: [registroInstalando({ status: 'error', exitCode: 1, errorMessage: 'ERR_PNPM_FETCH_404' })],
      }),
    })
    expect(result.current.outcome?.message).toBe('ERR_PNPM_FETCH_404')
    act(() => result.current.dismissOutcome())
    expect(result.current.outcome).toBeNull()
  })
})
