import { describe, expect, it } from 'vitest'
import {
  countParsableVars,
  groupByOrigin,
  groupByScope,
  looksLikeSecret,
  maskValue,
  scopeRank,
  syncState,
} from '../envVars'
import type { EnvFileInfo, EnvVar } from '../../types'

function variable(overrides: Partial<EnvVar> = {}): EnvVar {
  return {
    id: 'env-1',
    projectId: 'proj-1',
    scope: '.env',
    key: 'PORT',
    value: '3000',
    isSecret: false,
    isEnabled: true,
    comment: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    originProjectName: null,
    originProjectPath: null,
    orphanedAt: null,
    ...overrides,
  }
}

function fichero(overrides: Partial<EnvFileInfo> = {}): EnvFileInfo {
  return {
    name: '.env',
    path: '/proyectos/panel-web/.env',
    isTemplate: false,
    sizeBytes: 120,
    fileVarCount: 3,
    vaultVarCount: 3,
    missingInVault: [],
    differing: [],
    onlyInVault: [],
    ...overrides,
  }
}

describe('maskValue', () => {
  it('un secreto vacío se distingue de uno con contenido', () => {
    expect(maskValue('')).toBe('(vacío)')
    expect(maskValue('abc')).toBe('•••')
  })

  it('un valor largo no revela su longitud exacta ni desborda la fila', () => {
    expect(maskValue('x'.repeat(400))).toHaveLength(24)
  })
})

describe('looksLikeSecret', () => {
  it('marca lo que parece una credencial', () => {
    for (const key of ['API_TOKEN', 'STRIPE_SECRET_KEY', 'DB_PASSWORD', 'JWT_SIGNING_KEY', 'GITHUB_TOKEN']) {
      expect(looksLikeSecret(key), key).toBe(true)
    }
  })

  it('no marca lo que solo contiene una palabra parecida', () => {
    for (const key of ['PORT', 'NODE_ENV', 'MONKEY_NAME', 'AUTHOR_EMAIL', 'VITE_APP_TITLE']) {
      expect(looksLikeSecret(key), key).toBe(false)
    }
  })

  it('una URL con usuario y contraseña es un secreto aunque el nombre no lo diga', () => {
    expect(looksLikeSecret('DATABASE_URL', 'postgres://user:pass@localhost/db')).toBe(true)
    expect(looksLikeSecret('API_BASE_URL', 'https://api.example.com/v1')).toBe(false)
  })
})

describe('scopeRank', () => {
  it('lo específico gana, igual que en Vite y dotenv-flow', () => {
    expect(scopeRank('.env')).toBeLessThan(scopeRank('.env.production'))
    expect(scopeRank('.env.production')).toBeLessThan(scopeRank('.env.local'))
    expect(scopeRank('.env.local')).toBeLessThan(scopeRank('.env.production.local'))
  })
})

describe('groupByScope', () => {
  it('ordena los grupos por precedencia y las claves alfabéticamente', () => {
    const groups = groupByScope([
      variable({ id: '1', scope: '.env.local', key: 'ZONA' }),
      variable({ id: '2', scope: '.env', key: 'PUERTO' }),
      variable({ id: '3', scope: '.env', key: 'ambiente' }),
    ])

    expect(groups.map(group => group.scope)).toEqual(['.env', '.env.local'])
    expect(groups[0].vars.map(v => v.key)).toEqual(['ambiente', 'PUERTO'])
  })
})

describe('groupByOrigin', () => {
  it('agrupa las huérfanas por proyecto y pone arriba lo borrado más recientemente', () => {
    const groups = groupByOrigin([
      variable({ id: '1', projectId: null, originProjectName: 'antiguo', orphanedAt: '2026-01-01T00:00:00Z' }),
      variable({ id: '2', projectId: null, originProjectName: 'reciente', orphanedAt: '2026-06-01T00:00:00Z' }),
      variable({ id: '3', projectId: null, originProjectName: 'reciente', orphanedAt: '2026-06-01T00:00:00Z', key: 'OTRA' }),
    ])

    expect(groups.map(group => group.origin)).toEqual(['reciente', 'antiguo'])
    expect(groups[0].vars).toHaveLength(2)
  })

  it('una huérfana sin nombre de origen sigue siendo visible', () => {
    const groups = groupByOrigin([variable({ projectId: null, originProjectName: null })])
    expect(groups[0].origin).toBe('Proyecto desconocido')
  })
})

describe('countParsableVars', () => {
  it('cuenta claves válidas y descarta comentarios, ruido y duplicados', () => {
    const pegado = [
      '# comentario',
      '',
      'export PORT=3000',
      'DATABASE_URL=postgres://x',
      'PORT=4000',
      'esto no es una variable',
      '1INVALIDA=x',
    ].join('\n')

    expect(countParsableVars(pegado)).toBe(2)
  })

  it('un bloque vacío no ofrece importar nada', () => {
    expect(countParsableVars('   \n# solo comentarios\n')).toBe(0)
  })
})

describe('syncState', () => {
  it('lo que está en el disco y no en la bóveda es el aviso que importa', () => {
    const estado = syncState(fichero({ missingInVault: ['STRIPE_SECRET_KEY'] }))
    expect(estado.tone).toBe('pending')
    expect(estado.label).toBe('1 sin proteger')
    expect(estado.hint).toContain('STRIPE_SECRET_KEY')
  })

  it('distingue desincronizado de sin proteger', () => {
    expect(syncState(fichero({ differing: ['PORT'] })).tone).toBe('drifted')
    expect(syncState(fichero({ onlyInVault: ['NUEVA'] })).tone).toBe('drifted')
    expect(syncState(fichero()).tone).toBe('synced')
  })

  it('una plantilla no se trata como fuente de valores', () => {
    expect(syncState(fichero({ name: '.env.example', isTemplate: true, missingInVault: ['X'] })).tone).toBe('template')
  })

  it('un fichero que ya solo existe en la bóveda se puede regenerar', () => {
    expect(syncState(fichero({ fileVarCount: 0, vaultVarCount: 4, onlyInVault: ['A'] })).tone).toBe('vault-only')
  })
})
