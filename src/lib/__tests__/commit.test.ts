import { describe, expect, it } from 'vitest'
import { canCommit, commitCounterState, selectedPaths, toggleExcluded } from '../commit'
import type { GitFileChange } from '../../types'

const cambios: GitFileChange[] = [
  { path: 'src/App.tsx', status: 'modified', staged: false },
  { path: 'notas/borrador temporal.md', status: 'untracked', staged: false },
  { path: 'src/viejo.ts', status: 'deleted', staged: false },
]

describe('selectedPaths', () => {
  it('sin exclusiones entra todo', () => {
    expect(selectedPaths(cambios, new Set())).toHaveLength(3)
  })

  it('lo excluido no entra, y las rutas con espacios se respetan tal cual', () => {
    const seleccion = selectedPaths(cambios, new Set(['src/viejo.ts']))
    expect(seleccion).toEqual(['src/App.tsx', 'notas/borrador temporal.md'])
  })

  it('un archivo nuevo que aparece después entra marcado por defecto', () => {
    const excluidos = new Set(['src/App.tsx'])
    const conNuevo = [...cambios, { path: 'nuevo.ts', status: 'untracked', staged: false } as GitFileChange]
    expect(selectedPaths(conNuevo, excluidos)).toContain('nuevo.ts')
  })
})

describe('toggleExcluded', () => {
  it('alterna sin mutar el conjunto original', () => {
    const original = new Set<string>()
    const conUno = toggleExcluded(original, 'a')
    expect(original.size).toBe(0)
    expect(conUno.has('a')).toBe(true)
    expect(toggleExcluded(conUno, 'a').has('a')).toBe(false)
  })
})

describe('commitCounterState', () => {
  it('avisa a los 50 y marca error pasados los 72', () => {
    expect(commitCounterState(10)).toBe('ok')
    expect(commitCounterState(50)).toBe('ok')
    expect(commitCounterState(51)).toBe('warn')
    expect(commitCounterState(72)).toBe('warn')
    expect(commitCounterState(73)).toBe('over')
  })
})

describe('canCommit', () => {
  it('hace falta mensaje Y al menos un archivo', () => {
    expect(canCommit('fix: algo', ['a.ts'])).toBe(true)
    expect(canCommit('   ', ['a.ts'])).toBe(false)
    expect(canCommit('fix: algo', [])).toBe(false)
  })
})
