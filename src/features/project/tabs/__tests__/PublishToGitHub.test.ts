import { describe, expect, it } from 'vitest'
import { normalizarNombreRepo, toGithubTopic } from '../PublishToGitHub'

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

describe('toGithubTopic', () => {
  it('normaliza tecnologías comunes a nombres de topic estándar de GitHub', () => {
    expect(toGithubTopic('Next.js')).toBe('nextjs')
    expect(toGithubTopic('Node.js')).toBe('nodejs')
    expect(toGithubTopic('Vue.js')).toBe('vue')
    expect(toGithubTopic('Three.js')).toBe('threejs')
    expect(toGithubTopic('Tailwind CSS')).toBe('tailwindcss')
    expect(toGithubTopic('C++')).toBe('cpp')
    expect(toGithubTopic('C#')).toBe('csharp')
    expect(toGithubTopic('.NET')).toBe('dotnet')
  })

  it('elimina caracteres especiales no permitidos en GitHub topics', () => {
    expect(toGithubTopic('AI / ML')).toBe('ai-ml')
    expect(toGithubTopic('Docker Compose')).toBe('docker-compose')
    expect(toGithubTopic('React')).toBe('react')
    expect(toGithubTopic('  FastAPI  ')).toBe('fastapi')
  })

  it('limita longitud y limpia guiones sobrantes', () => {
    expect(toGithubTopic('---')).toBe('')
    expect(toGithubTopic('')).toBe('')
  })
})

