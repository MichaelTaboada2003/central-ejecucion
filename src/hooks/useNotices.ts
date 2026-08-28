import { useCallback, useEffect, useState } from 'react'

export type NoticeKind = 'success' | 'error' | 'info'
export interface Notice {
  kind: NoticeKind
  text: string
}

/** Un error atrapado en cualquier parte llega al aviso global sin tener que
 *  pasar el `notify` por media docena de props. */
export function reportError(error: unknown): void {
  const text = error instanceof Error ? error.message : String(error)
  window.dispatchEvent(new CustomEvent('dev-command-error', { detail: text }))
  console.error(error)
}

/**
 * Avisos de la interfaz. Se cierran solos —antes se quedaban tapando la
 * pantalla hasta pulsar la X— y los errores tardan más en irse que los éxitos
 * porque hay que poder leerlos.
 */
export function useNotices() {
  const [notice, setNotice] = useState<Notice | null>(null)

  const notify = useCallback((text: string, kind: NoticeKind = 'success') => {
    setNotice({ kind, text })
  }, [])

  const dismiss = useCallback(() => setNotice(null), [])

  useEffect(() => {
    const handler = (event: Event) => setNotice({ kind: 'error', text: (event as CustomEvent<string>).detail })
    window.addEventListener('dev-command-error', handler)
    return () => window.removeEventListener('dev-command-error', handler)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.kind === 'error' ? 9000 : 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  return { notice, notify, dismiss }
}
