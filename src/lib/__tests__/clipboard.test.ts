import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../clipboard'

/** Instala un `navigator.clipboard` de mentira; `null` lo quita del todo. */
function stubClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
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
})

describe('copyText', () => {
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
