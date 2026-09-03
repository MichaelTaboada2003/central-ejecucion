import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentTab } from '../EnvironmentTab'
import type { EnvFileInfo, EnvVar, ProjectEnvVars } from '../../../../types'

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
    fileVarCount: 2,
    vaultVarCount: 2,
    missingInVault: [],
    differing: [],
    onlyInVault: [],
    ...overrides,
  }
}

function montar(data: Partial<ProjectEnvVars> = {}) {
  const handlers = {
    onSave: vi.fn().mockResolvedValue(variable()),
    onDelete: vi.fn(),
    onImport: vi.fn().mockResolvedValue({ scope: '.env', added: 1, updated: 0, unchanged: 0 }),
    onWrite: vi.fn(),
    onCopy: vi.fn(),
  }
  render(
    <EnvironmentTab
      data={{ projectId: 'proj-1', vars: [], files: [], unprotectedKeys: 0, ...data }}
      loading={false}
      busy={null}
      {...handlers}
    />
  )
  return handlers
}

beforeEach(() => vi.clearAllMocks())

describe('EnvironmentTab: secretos ocultos', () => {
  it('un valor marcado como secreto no se muestra hasta revelarlo', async () => {
    const usuario = userEvent.setup()
    montar({ vars: [variable({ key: 'STRIPE_SECRET_KEY', value: 'sk_live_abcdef', isSecret: true })] })

    expect(screen.queryByText('sk_live_abcdef')).toBeNull()
    await usuario.click(screen.getByTitle('Revelar valor'))
    expect(screen.getByText('sk_live_abcdef')).toBeTruthy()

    await usuario.click(screen.getByTitle('Ocultar valor'))
    expect(screen.queryByText('sk_live_abcdef')).toBeNull()
  })

  it('un valor que no es secreto se lee directamente', () => {
    montar({ vars: [variable()] })
    expect(screen.getByText('3000')).toBeTruthy()
    expect(screen.queryByTitle('Revelar valor')).toBeNull()
  })
})

describe('EnvironmentTab: claves sin proteger', () => {
  /// Es el aviso que justifica toda la bóveda: lo que está solo en el disco se
  /// va con la carpeta al borrar el proyecto.
  it('avisa de cuántas claves se perderían al borrar el proyecto', () => {
    montar({
      vars: [variable()],
      files: [fichero({ missingInVault: ['STRIPE_SECRET_KEY', 'SENDGRID_API_KEY'], fileVarCount: 3 })],
      unprotectedKeys: 2,
    })
    expect(screen.getByText('2 claves sin proteger')).toBeTruthy()
    expect(screen.getByText('1 variable guardada')).toBeTruthy()
  })

  it('cuando todo está respaldado lo dice, contando los secretos', () => {
    montar({
      vars: [variable(), variable({ id: 'env-2', key: 'API_TOKEN', isSecret: true })],
      files: [fichero()],
      unprotectedKeys: 0,
    })
    expect(screen.getByText('Todo lo que hay en disco está respaldado')).toBeTruthy()
    expect(screen.getByText(/1 de 2 se tratan como secretos/)).toBeTruthy()
  })
})

describe('EnvironmentTab: escritura al disco', () => {
  /// Sobrescribir un `.env` es la única acción destructiva de la pestaña, así
  /// que no puede ocurrir con un solo clic ni sin enumerar lo que se pierde.
  it('pide confirmación y enumera las claves que desaparecerán del fichero', async () => {
    const usuario = userEvent.setup()
    const { onWrite } = montar({
      vars: [variable()],
      files: [fichero({ vaultVarCount: 1, fileVarCount: 2, missingInVault: ['LEGACY_KEY'] })],
      unprotectedKeys: 1,
    })

    await usuario.click(screen.getByRole('button', { name: /Escribir$/ }))
    expect(onWrite).not.toHaveBeenCalled()

    const confirmacion = document.querySelector('.env-confirm') as HTMLElement
    expect(within(confirmacion).getByText('LEGACY_KEY')).toBeTruthy()

    await usuario.click(within(confirmacion).getByRole('button', { name: /Escribir \.env/ }))
    expect(onWrite).toHaveBeenCalledWith('.env')
  })

  it('cancelar deja el fichero intacto', async () => {
    const usuario = userEvent.setup()
    const { onWrite } = montar({ vars: [variable()], files: [fichero({ vaultVarCount: 1 })] })

    await usuario.click(screen.getByRole('button', { name: /Escribir$/ }))
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(document.querySelector('.env-confirm')).toBeNull()
    expect(onWrite).not.toHaveBeenCalled()
  })

  it('no se puede escribir un ámbito que la bóveda no tiene', () => {
    montar({ files: [fichero({ vaultVarCount: 0, fileVarCount: 2, missingInVault: ['A', 'B'] })], unprotectedKeys: 2 })
    expect(screen.getByRole('button', { name: /Escribir$/ })).toHaveProperty('disabled', true)
  })
})

describe('EnvironmentTab: alta de variables', () => {
  /// Escribir «…_TOKEN» y que el valor quede a la vista es exactamente cómo se
  /// filtra una credencial en una captura de pantalla.
  it('marca sola la casilla de secreto según el nombre que se teclea', async () => {
    const usuario = userEvent.setup()
    montar()

    await usuario.click(screen.getByRole('button', { name: /Añadir variable/ }))
    const casillaSecreto = screen.getByLabelText('Ocultar el valor en la interfaz') as HTMLInputElement
    expect(casillaSecreto.checked).toBe(false)

    await usuario.type(screen.getByLabelText('Nombre'), 'GITHUB_TOKEN')
    expect(casillaSecreto.checked).toBe(true)
  })

  it('una vez tocada a mano, la casilla deja de decidirse sola', async () => {
    const usuario = userEvent.setup()
    montar()

    await usuario.click(screen.getByRole('button', { name: /Añadir variable/ }))
    const nombre = screen.getByLabelText('Nombre')
    const casillaSecreto = screen.getByLabelText('Ocultar el valor en la interfaz') as HTMLInputElement

    await usuario.type(nombre, 'PUBLIC_TOKEN')
    expect(casillaSecreto.checked).toBe(true)

    // El usuario decide que esta no es secreta: seguir tecleando el nombre no
    // puede volver a marcarla.
    await usuario.click(casillaSecreto)
    await usuario.type(nombre, '_ID')

    expect(casillaSecreto.checked).toBe(false)
  })

  it('guarda el ámbito y el nombre recortados', async () => {
    const usuario = userEvent.setup()
    const { onSave } = montar()

    await usuario.click(screen.getByRole('button', { name: /Añadir variable/ }))
    await usuario.type(screen.getByLabelText('Nombre'), 'API_TOKEN')
    await usuario.type(screen.getByLabelText('Valor'), 'abc123')
    await usuario.click(screen.getByRole('button', { name: /Añadir a la bóveda/ }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'API_TOKEN', value: 'abc123', scope: '.env', isSecret: true, isEnabled: true })
    )
  })

  it('sin nombre no se puede guardar', async () => {
    const usuario = userEvent.setup()
    montar()
    await usuario.click(screen.getByRole('button', { name: /Añadir variable/ }))
    expect(screen.getByRole('button', { name: /Añadir a la bóveda/ })).toHaveProperty('disabled', true)
  })
})

describe('EnvironmentTab: importar pegando', () => {
  it('cuenta las variables detectadas y solo entonces permite importar', async () => {
    const usuario = userEvent.setup()
    const { onImport } = montar()

    await usuario.click(screen.getByRole('button', { name: /Pegar \.env/ }))
    expect(screen.getByText('0 variables detectadas')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Importar a la bóveda/ })).toHaveProperty('disabled', true)

    await usuario.type(screen.getByRole('textbox', { name: '' }), 'A=1{enter}B=2')
    expect(screen.getByText('2 variables detectadas')).toBeTruthy()

    await usuario.click(screen.getByRole('button', { name: /Importar a la bóveda/ }))
    expect(onImport).toHaveBeenCalledWith('.env', 'A=1\nB=2')
  })
})

describe('EnvironmentTab: agrupación por fichero', () => {
  /// Se leen en el mismo orden en que se aplican al ejecutar: `.env` primero,
  /// `.env.local` después porque es el que pisa.
  it('ordena los grupos por precedencia', () => {
    montar({
      vars: [
        variable({ id: '1', scope: '.env.local', key: 'A' }),
        variable({ id: '2', scope: '.env', key: 'B' }),
      ],
    })
    const grupos = [...document.querySelectorAll('.env-group-heading strong')].map(node => node.textContent)
    expect(grupos).toEqual(['.env', '.env.local'])
  })

  it('una variable deshabilitada se distingue de una activa', () => {
    montar({ vars: [variable({ isEnabled: false })] })
    expect(document.querySelector('.env-var-row.disabled')).toBeTruthy()
  })
})
