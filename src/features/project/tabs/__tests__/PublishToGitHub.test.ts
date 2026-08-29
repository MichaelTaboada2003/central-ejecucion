import { describe, expect, it } from 'vitest'
import { normalizarNombreRepo } from '../PublishToGitHub'

describe('normalizarNombreRepo', () => {
  it('convierte en guion lo que GitHub no admite', () => {
    expect(normalizarNombreRepo('Mi Proyecto')).toBe('Mi-Proyecto')
    expect(normalizarNombreRepo('panel (v2)')).toBe('panel-v2')
    expect(normalizarNombreRepo('acción rápida')).toBe('acci-n-r-pida')
  })

  it('conserva lo que sí admite', () => {
    expect(normalizarNombreRepo('dev-command_center.v2')).toBe('dev-command_center.v2')
  })

  it('no deja guiones sueltos en los extremos', () => {
    expect(normalizarNombreRepo('  ¡hola!  ')).toBe('hola')
    expect(normalizarNombreRepo('---')).toBe('')
  })
})
