import { describe, expect, it } from 'vitest'
import { countProjects, filterByStatus, groupProjects, projectKind, searchProjects } from '../projects'
import type { Project } from '../../types'

function proyecto(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: overrides.id,
    path: `/proyectos/${overrides.id}`,
    canonicalPath: `/proyectos/${overrides.id}`,
    projectType: 'Node.js',
    frameworks: [],
    packageManager: null,
    devCommand: null,
    buildCommand: null,
    testCommand: null,
    localUrl: null,
    port: null,
    status: 'stopped',
    lastUsedAt: null,
    diskSizeBytes: 0,
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    lastError: null,
    ...overrides,
  }
}

const lista: Project[] = [
  proyecto({ id: 'web', status: 'running', frameworks: ['Astro'], tags: ['github'] }),
  proyecto({ id: 'api', status: 'error', isPinned: true }),
  proyecto({ id: 'script', status: 'stopped', kind: 'script' }),
  proyecto({ id: 'viejo', status: 'stopped', isArchived: true }),
  proyecto({ id: 'fijado-archivado', isPinned: true, isArchived: true }),
]

describe('projectKind', () => {
  it('es la que dedujo el detector: no hay forma de contradecirla', () => {
    expect(projectKind(proyecto({ id: 'x', kind: 'notebook' }))).toBe('notebook')
    expect(projectKind(proyecto({ id: 'x', kind: 'script' }))).toBe('script')
  })

  it('las filas de bases antiguas, sin el campo, se tratan como servicio', () => {
    expect(projectKind(proyecto({ id: 'x' }))).toBe('service')
  })
})

describe('searchProjects', () => {
  it('sin término devuelve la misma lista', () => {
    expect(searchProjects(lista, '   ')).toBe(lista)
  })

  it('busca también en frameworks y etiquetas, no solo en el nombre', () => {
    expect(searchProjects(lista, 'astro').map(p => p.id)).toEqual(['web'])
    expect(searchProjects(lista, 'github').map(p => p.id)).toEqual(['web'])
  })

  it('ignora mayúsculas y busca en la ruta', () => {
    expect(searchProjects(lista, '/PROYECTOS/API').map(p => p.id)).toEqual(['api'])
  })

  it('soporta múltiples palabras / tokens en cualquier orden', () => {
    expect(searchProjects(lista, 'web astro').map(p => p.id)).toEqual(['web'])
    expect(searchProjects(lista, 'github astro').map(p => p.id)).toEqual(['web'])
  })

  it('es insensible a tildes y diacríticos', () => {
    const conTildes: Project[] = [
      proyecto({ id: 'app1', name: 'Gestión de Clientes', port: 3000, packageManager: 'pnpm' }),
      proyecto({ id: 'app2', name: 'modulo de ventas', port: 8080, devCommand: 'npm run dev' }),
    ]
    expect(searchProjects(conTildes, 'gestion').map(p => p.id)).toEqual(['app1'])
    expect(searchProjects(conTildes, 'GESTIÓN').map(p => p.id)).toEqual(['app1'])
    expect(searchProjects(conTildes, 'módulo').map(p => p.id)).toEqual(['app2'])
    expect(searchProjects(conTildes, '3000').map(p => p.id)).toEqual(['app1'])
    expect(searchProjects(conTildes, 'pnpm').map(p => p.id)).toEqual(['app1'])
    expect(searchProjects(conTildes, 'npm run dev').map(p => p.id)).toEqual(['app2'])
  })
})

describe('filterByStatus', () => {
  it('«todos» excluye los archivados', () => {
    expect(filterByStatus(lista, 'all').map(p => p.id)).toEqual(['web', 'api', 'script'])
  })

  it('«archivados» devuelve solo los archivados', () => {
    expect(filterByStatus(lista, 'archived').map(p => p.id)).toEqual(['viejo', 'fijado-archivado'])
  })

  it('«fijados» no incluye un fijado que además está archivado', () => {
    expect(filterByStatus(lista, 'pinned').map(p => p.id)).toEqual(['api'])
  })

  it('filtra por estado dejando fuera los archivados', () => {
    expect(filterByStatus(lista, 'stopped').map(p => p.id)).toEqual(['script'])
  })
})

describe('groupProjects', () => {
  it('los tres grupos son mutuamente excluyentes y suman el total', () => {
    const { pinnedProjects, activeProjects, archivedProjects } = groupProjects(lista)
    expect(pinnedProjects.map(p => p.id)).toEqual(['api'])
    expect(activeProjects.map(p => p.id)).toEqual(['web', 'script'])
    expect(archivedProjects.map(p => p.id)).toEqual(['viejo', 'fijado-archivado'])
    expect(pinnedProjects.length + activeProjects.length + archivedProjects.length).toBe(lista.length)
  })
})

describe('countProjects', () => {
  it('cuenta por estado sin contar los archivados en el total', () => {
    expect(countProjects(lista)).toEqual({
      total: 3,
      pinned: 1,
      running: 1,
      stopped: 1,
      error: 1,
      archived: 2,
    })
  })

  it('una lista vacía da todo a cero', () => {
    expect(countProjects([])).toEqual({ total: 0, pinned: 0, running: 0, stopped: 0, error: 0, archived: 0 })
  })
})
