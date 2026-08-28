import { memo } from 'react'
import type { TerminalEntry } from '../lib/logs'

const logTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const logTimeCache = new Map<string, string>()

/** `toLocaleTimeString` es costoso y las marcas de tiempo se repiten mucho
 *  dentro de un mismo lote, así que se memoiza el formateo. */
function formatLogTime(timestamp: string): string {
  const cached = logTimeCache.get(timestamp)
  if (cached) return cached
  const formatted = logTimeFormatter.format(new Date(timestamp))
  if (logTimeCache.size > 4000) logTimeCache.clear()
  logTimeCache.set(timestamp, formatted)
  return formatted
}
export const TerminalLine = memo(function TerminalLine({ entry }: { entry: TerminalEntry }) {
  return (
    <p className={entry.stream}>
      <time>{formatLogTime(entry.timestamp)}</time>
      <span className="terminal-line-content">{entry.line}</span>
    </p>
  )
})
