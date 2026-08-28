import { Copy, Radio, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate } from '../../../lib/format'
import type { TerminalEntry } from '../../../lib/logs'
import type { ProcessInfo, Project } from '../../../types'
import { TerminalLine } from '../../../components/TerminalLine'
import { Meta } from '../../../components/Primitives'

export function ProcessesTab({
  project,
  logs,
  setLogs,
  process,
  onNotify,
}: {
  project: Project
  logs: TerminalEntry[]
  setLogs: React.Dispatch<React.SetStateAction<TerminalEntry[]>>
  process: ProcessInfo | null
  onNotify: (text: string, kind: 'success' | 'error' | 'info') => void
}) {
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all')
  const terminalBodyRef = useRef<HTMLDivElement>(null)
  const followTail = useRef(true)

  const filteredLogs = useMemo(() => {
    if (streamFilter === 'all') return logs
    return logs.filter(l => l.stream === streamFilter)
  }, [logs, streamFilter])

  // Un `scrollIntoView` suave por lote encadena animaciones y bloquea el hilo
  // principal; basta con fijar `scrollTop` y solo si el usuario sigue al final.
  useEffect(() => {
    const body = terminalBodyRef.current
    if (!body || !followTail.current) return
    body.scrollTop = body.scrollHeight
  }, [filteredLogs])

  const handleTerminalScroll = () => {
    const body = terminalBodyRef.current
    if (!body) return
    followTail.current = body.scrollHeight - body.scrollTop - body.clientHeight < 48
  }

  const copyAllLogs = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.stream}] ${l.line}`).join('\n')
    void navigator.clipboard.writeText(text)
    onNotify('Logs copiados al portapapeles', 'success')
  }

  return (
    <div className="process-layout">
      <section className="card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">CONTROL DE PROCESO</p>
            <h2>{process ? `PID: ${process.pid}` : 'Sin proceso activo'}</h2>
          </div>
        </div>
        {process ? (
          <div className="process-data">
            <Meta label="Hora de inicio" value={formatDate(process.startedAt)} />
            <Meta label="Comando en ejecución" value={process.command} />
          </div>
        ) : (
          <p className="empty-inline">
            El Centro de Mando administra de manera aislada los subprocesos iniciados desde el panel.
          </p>
        )}
      </section>

      <section className="terminal-log">
        <div className="terminal-header">
          <div className="terminal-window-controls">
            <span className="terminal-dot close" />
            <span className="terminal-dot minimize" />
            <span className="terminal-dot expand" />
          </div>
          <div className="terminal-title">
            <Terminal size={14} />
            <span>Terminal Output</span>
            {project.status === 'running' && (
              <span className="live-beacon">
                <Radio size={11} className="spin" /> LIVE
              </span>
            )}
          </div>
          <div className="terminal-actions">
            <div className="terminal-stream-filters">
              <button
                className={streamFilter === 'all' ? 'active' : ''}
                onClick={() => setStreamFilter('all')}
              >
                Todos
              </button>
              <button
                className={streamFilter === 'stdout' ? 'active' : ''}
                onClick={() => setStreamFilter('stdout')}
              >
                stdout
              </button>
              <button
                className={streamFilter === 'stderr' ? 'active' : ''}
                onClick={() => setStreamFilter('stderr')}
              >
                stderr
              </button>
            </div>
            {logs.length > 0 && (
              <>
                <button
                  className="icon-button"
                  title="Copiar todos los logs"
                  onClick={copyAllLogs}
                >
                  <Copy size={13} />
                </button>
                <button
                  className="icon-button"
                  title="Limpiar vista de logs"
                  onClick={() => setLogs([])}
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        </div>

        <div
          className="terminal-body"
          aria-live="polite"
          ref={terminalBodyRef}
          onScroll={handleTerminalScroll}
        >
          {filteredLogs.length ? (
            filteredLogs.map(entry => <TerminalLine key={entry.seq} entry={entry} />)
          ) : (
            <p className="muted-log">
              {project.status === 'running'
                ? 'Esperando salida estándar del proceso…'
                : 'Inicia el servidor de desarrollo o un script para ver los logs en tiempo real.'}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
