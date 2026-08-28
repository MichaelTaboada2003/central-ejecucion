import { Check, RefreshCw, ShieldCheck } from 'lucide-react'
import { formatDate } from '../../../lib/format'
import { kindMeta } from '../../../lib/kindMeta'
import type { Project, ProjectDetail, ProjectKind } from '../../../types'
import { CopyButton, Meta } from '../../../components/Primitives'

export function ConfigurationTab({
  project,
  scan,
  onNotify,
  onKindChange,
}: {
  project: Project
  scan: ProjectDetail['scan']
  onNotify: (text: string, kind: 'success' | 'error' | 'info') => void
  onKindChange: (kind: ProjectKind | null) => Promise<void> | void
}) {
  const detected = project.kind ?? scan.kind ?? 'service'
  const selected: ProjectKind | 'auto' = project.kindOverride ?? 'auto'
  return (
    <div className="detail-grid">
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">NATURALEZA DEL PROYECTO</p>
            <h2>Cómo se trata este proyecto</h2>
            <p>
              Decide qué acciones ofrece el panel. Se deduce del contenido de la carpeta, pero ningún
              detector acierta siempre —hay scripts que arrancan un servidor—, así que puedes fijarla.
            </p>
          </div>
        </div>
        <div className="kind-picker">
          {(['auto', 'service', 'script', 'notebook', 'inert'] as const).map(option => {
            const isAuto = option === 'auto'
            const meta = isAuto ? null : kindMeta[option]
            const OptionIcon = meta?.icon ?? RefreshCw
            return (
              <button
                key={option}
                type="button"
                className={`kind-option ${selected === option ? 'selected' : ''}`}
                onClick={() => void onKindChange(isAuto ? null : option)}
              >
                <span className="kind-option-head">
                  <OptionIcon size={14} />
                  <strong>{isAuto ? `Automática (${kindMeta[detected].label})` : meta!.label}</strong>
                  {selected === option && <Check size={13} color="var(--accent-primary)" />}
                </span>
                <small>{isAuto ? 'Se recalcula en cada escaneo del proyecto.' : meta!.hint}</small>
              </button>
            )
          })}
        </div>
      </section>
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">METADATOS DEL PROYECTO</p>
            <h2>Registro en Base de Datos</h2>
          </div>
        </div>
        <div className="configuration-list">
          <div>
            <Meta label="Ruta original" value={project.path} />
            <div style={{ marginTop: 6 }}>
              <CopyButton
                value={project.path}
                onCopy={() => onNotify('Ruta copiada al portapapeles', 'success')}
              />
            </div>
          </div>
          <div>
            <Meta label="Ruta canónica" value={project.canonicalPath} />
            <div style={{ marginTop: 6 }}>
              <CopyButton
                value={project.canonicalPath}
                onCopy={() => onNotify('Ruta canónica copiada', 'success')}
              />
            </div>
          </div>
          <Meta label="Tipo de proyecto" value={scan.projectType} />
          <Meta label="Frameworks" value={scan.frameworks.join(', ') || 'No detectados'} />
          <Meta label="Etiquetas" value={project.tags.join(', ') || 'Sin etiquetas'} />
          <Meta label="Fecha de registro" value={formatDate(project.createdAt)} />
        </div>
      </section>

      <section className="card safety-note span-two">
        <ShieldCheck size={22} />
        <div>
          <h3>Inmutabilidad de alcance</h3>
          <p>
            La aplicación restringe las operaciones al árbol del proyecto. Si la ruta es alterada o
            apunta fuera, las acciones se bloquean preventivamente.
          </p>
        </div>
      </section>
    </div>
  )
}
