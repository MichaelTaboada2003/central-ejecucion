import { Play } from 'lucide-react'
import type { ProjectDetail } from '../../../types'
import { CopyButton } from '../../../components/Primitives'

export function ScriptsTab({
  scripts,
  onRun,
  busy,
}: {
  scripts: ProjectDetail['scan']['scripts']
  onRun: (action: 'script', script: string) => Promise<void> | undefined
  busy: string | null
}) {
  return (
    <section className="card scripts-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">SCRIPTS DEL MANIFIESTO</p>
          <h2>Comandos de Ejecución</h2>
          <p>Comandos declarados oficialmente en package.json o configuraciones del proyecto.</p>
        </div>
      </div>
      {scripts.length ? (
        <div className="script-list">
          {scripts.map(script => (
            <div key={`${script.source}:${script.name}:${script.command}`}>
              <div>
                <strong>{script.name}</strong>
                <code>{script.command}</code>
              </div>
              <div>
                <CopyButton value={script.command} />
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void onRun('script', script.name)}
                >
                  <Play size={14} /> Ejecutar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-inline">No se encontraron scripts configurados.</p>
      )}
    </section>
  )
}
