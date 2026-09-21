/**
 * Copia texto al portapapeles del sistema.
 *
 * `navigator.clipboard.writeText` falla dentro del webview con «The request is
 * not allowed by the user agent or the platform in the current context»:
 * WKWebView no trata el origen de la aplicación como contexto seguro y rechaza
 * la API asíncrona, además de exigir un gesto del usuario que se pierde en
 * cuanto hay un `await` por medio —y copiar la bóveda necesita ir antes al
 * backend a exportarla—.
 *
 * El respaldo es un `textarea` fuera de pantalla y `execCommand('copy')`. Está
 * obsoleto en la web abierta, pero funciona en el webview, no necesita permisos
 * ni plugins y es sincrónico, así que no depende del gesto.
 */
import { invoke } from '@tauri-apps/api/core'

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function copyText(text: string): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('copy_to_clipboard', { text })
      return
    } catch {
      // Si el comando nativo devolviera error, cae a las estrategias web de respaldo.
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // El motivo del rechazo no cambia qué hacer: se intenta el respaldo.
  }
  if (!copyWithTextarea(text)) {
    throw new Error('El sistema no permitió copiar al portapapeles.')
  }
}

/** Lee texto del portapapeles del sistema, nativo en Tauri y con respaldo web. */
export async function readClipboardText(): Promise<string> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<string>('read_from_clipboard')
    } catch {
      // Cae a la API web si el comando fallara.
    }
  }
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText()
    } catch {
      // Ignorar rechazo de lectura en navegador
    }
  }
  return ''
}

/** Respaldo sincrónico. Devuelve si el navegador aceptó la copia. */
function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  // Tiene que estar en el árbol y ser seleccionable: con `display: none` o
  // `visibility: hidden` no hay selección, y sin selección no hay nada que
  // copiar. Se aparca fuera de la vista y sin opacidad.
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}
