import { ShieldCheck } from 'lucide-react'
import { formatDate } from '../../../lib/format'
import type { Project, ProjectDetail } from '../../../types'
import { CopyButton, Meta } from '../../../components/Primitives'

export function ConfigurationTab({
  project,
  scan,
  onNotify,
}: {
  project: Project
  scan: ProjectDetail['scan']
  onNotify: (text: string, kind: 'success' | 'error' | 'info') => void
}) {
  return (
    <div className="detail-grid">
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
