import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, readClipboardText } from '../clipboard'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

/** Instala un `navigator.clipboard` de mentira; `null` lo quita del todo. */
function stubClipboard(writeText: ((text: string) => Promise<void>) | null, readText?: () => Promise<string>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText || readText ? { writeText: writeText ?? vi.fn(), readText: readText ?? vi.fn() } : undefined,
    configurable: true,
    writable: true,
  })
}

/** `execCommand` no existe en jsdom: se inyecta para poder observarlo. */
function stubExecCommand(result: boolean | (() => never)) {
  const spy = vi.fn(() => {
    if (typeof result === 'function') result()
    return result as boolean
  })
  Object.defineProperty(document, 'execCommand', { value: spy, configurable: true, writable: true })
  return spy
}

afterEach(() => {
  vi.restoreAllMocks()
  stubClipboard(null)
  // @ts-expect-error simulación de entorno Tauri
  delete window.__TAURI_INTERNALS__
})

describe('copyText', () => {
  it('usa el comando nativo copy_to_clipboard en entorno Tauri', async () => {
    // @ts-expect-error simulación de entorno Tauri
    window.__TAURI_INTERNALS__ = {}
    vi.mocked(invoke).mockResolvedValueOnce(undefined)

    await copyText('API_KEY=1')

    expect(invoke).toHaveBeenCalledWith('copy_to_clipboard', { text: 'API_KEY=1' })
  })

  it('cae a la API web si el comando nativo de Tauri falla', async () => {
    // @ts-expect-error simulación de entorno Tauri
    window.__TAURI_INTERNALS__ = {}
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Tauri error'))

    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)

    await copyText('API_KEY=1')

    expect(invoke).toHaveBeenCalledWith('copy_to_clipboard', { text: 'API_KEY=1' })
    expect(writeText).toHaveBeenCalledWith('API_KEY=1')
  })

  it('usa la API asíncrona cuando el navegador la permite', async () => {
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    const execCommand = stubExecCommand(true)

    await copyText('API_KEY=1')

    expect(writeText).toHaveBeenCalledWith('API_KEY=1')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('cae al respaldo cuando el webview rechaza la API asíncrona', async () => {
    // Es el fallo real de WKWebView: NotAllowedError por contexto no seguro.
    stubClipboard(async () => {
      throw new DOMException('The request is not allowed by the user agent', 'NotAllowedError')
    })
    const execCommand = stubExecCommand(true)

    await expect(copyText('API_KEY=1')).resolves.toBeUndefined()
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('cae al respaldo cuando no hay API de portapapeles', async () => {
    stubClipboard(null)
    const execCommand = stubExecCommand(true)

    await copyText('API_KEY=1')

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('avisa con un error legible si el sistema rechaza también el respaldo', async () => {
    stubClipboard(null)
    stubExecCommand(false)

    await expect(copyText('API_KEY=1')).rejects.toThrow('El sistema no permitió copiar al portapapeles.')
  })

  it('no deja el textarea del respaldo colgando en el documento', async () => {
    stubClipboard(null)
    stubExecCommand(() => {
      throw new Error('el motor falló a media copia')
    })

    await expect(copyText('API_KEY=1')).rejects.toThrow()
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})

describe('readClipboardText', () => {
  it('usa el comando nativo read_from_clipboard en entorno Tauri', async () => {
    // @ts-expect-error simulación de entorno Tauri
    window.__TAURI_INTERNALS__ = {}
    vi.mocked(invoke).mockResolvedValueOnce('CLAVE=VALOR')

    const result = await readClipboardText()

    expect(invoke).toHaveBeenCalledWith('read_from_clipboard')
    expect(result).toBe('CLAVE=VALOR')
  })

  it('usa navigator.clipboard.readText en entorno web', async () => {
    const readText = vi.fn(async () => 'WEB_VALOR')
    stubClipboard(null, readText)

    const result = await readClipboardText()

    expect(readText).toHaveBeenCalled()
    expect(result).toBe('WEB_VALOR')
  })
})

