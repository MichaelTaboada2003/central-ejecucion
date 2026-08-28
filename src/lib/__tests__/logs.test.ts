import { beforeEach, describe, expect, it } from 'vitest'
import { LOG_BUFFER_LIMIT, appendTerminalEntries, resetLogSequence, toTerminalEntries } from '../logs'
import type { LogEntry } from '../../types'

function linea(n: number): LogEntry {
  return { projectId: 'p1', stream: 'stdout', line: `linea ${n}`, timestamp: '2026-01-01T10:00:00.000Z' }
}

beforeEach(() => resetLogSequence())

describe('toTerminalEntries', () => {
  it('da una identidad distinta a cada línea, incluso si el texto se repite', () => {
    const entradas = toTerminalEntries([linea(1), linea(1)])
    expect(entradas.map(e => e.seq)).toEqual([0, 1])
  })

  it('la identidad sigue creciendo entre lotes: es lo que evita que React recree la lista', () => {
    toTerminalEntries([linea(1)])
    expect(toTerminalEntries([linea(2)])[0].seq).toBe(1)
  })
})

describe('appendTerminalEntries', () => {
  it('acumula mientras cabe', () => {
    const a = toTerminalEntries([linea(1)])
    const b = toTerminalEntries([linea(2)])
    expect(appendTerminalEntries(a, b).map(e => e.line)).toEqual(['linea 1', 'linea 2'])
  })

  it('nunca pasa del límite y conserva las ÚLTIMAS líneas', () => {
    const muchas = toTerminalEntries(Array.from({ length: LOG_BUFFER_LIMIT + 50 }, (_, i) => linea(i)))
    const resultado = appendTerminalEntries([], muchas)
    expect(resultado).toHaveLength(LOG_BUFFER_LIMIT)
    expect(resultado[0].line).toBe('linea 50')
    expect(resultado[resultado.length - 1].line).toBe(`linea ${LOG_BUFFER_LIMIT + 49}`)
  })

  it('un lote que desborda descarta lo más viejo del búfer previo', () => {
    const previo = toTerminalEntries(Array.from({ length: LOG_BUFFER_LIMIT }, (_, i) => linea(i)))
    const nuevo = toTerminalEntries([linea(9998), linea(9999)])
    const resultado = appendTerminalEntries(previo, nuevo)
    expect(resultado).toHaveLength(LOG_BUFFER_LIMIT)
    expect(resultado[resultado.length - 1].line).toBe('linea 9999')
    expect(resultado.some(e => e.line === 'linea 0')).toBe(false)
  })
})
