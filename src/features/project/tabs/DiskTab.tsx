import { HardDrive, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { formatBytes } from '../../../lib/format'
import type { DiskReport } from '../../../types'
import { LoadingInline } from '../../../components/Primitives'

export function DiskTab({
  disk,
  onLoad,
  onPreviewCleanup,
  busy,
}: {
  disk: DiskReport | null
  onLoad: () => void
  onPreviewCleanup: () => void
  busy: string | null
}) {
  // Si el informe falla, `disk` sigue en null y `busy` vuelve a null: sin este
  // guardia el efecto se relanzaba en bucle y encadenaba análisis de disco
  // fallidos indefinidamente.
  const requested = useRef(false)
  useEffect(() => {
    if (disk || busy || requested.current) return
    requested.current = true
    onLoad()
  }, [disk, onLoad, busy])

  const colorPalette = ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#f43f5e', '#ec4899']

  return (
    <div className="detail-grid">
      <section className="card span-two">
        <div className="card-heading">
          <div>
            <p className="eyebrow">ESPACIO EN DISCO</p>
            <h2>{disk ? formatBytes(disk.totalBytes) : 'Calculando uso de almacenamiento…'}</h2>
            <p>Análisis de directorios regenerables dentro de este proyecto.</p>
          </div>
          <button
            className="danger-outline"
            onClick={onPreviewCleanup}
            disabled={!!busy || !disk?.entries.length}
          >
            <Trash2 size={15} /> Revisar limpieza
          </button>
        </div>

        {disk && disk.entries.length > 0 && (
          <div className="disk-meter-container">
            <div className="disk-meter-bar">
              {disk.entries.map((entry, index) => {
                const percentage = disk.totalBytes > 0 ? (entry.bytes / disk.totalBytes) * 100 : 0
                return (
                  <div
                    key={entry.target}
                    className="disk-meter-segment"
                    style={{
                      width: `${Math.max(percentage, 1)}%`,
                      backgroundColor: colorPalette[index % colorPalette.length],
                    }}
                    title={`${entry.label}: ${formatBytes(entry.bytes)} (${percentage.toFixed(1)}%)`}
                  />
                )
              })}
            </div>
            <div className="disk-legend">
              {disk.entries.map((entry, index) => (
                <div key={entry.target} className="disk-legend-item">
                  <span
                    className="disk-legend-color"
                    style={{ backgroundColor: colorPalette[index % colorPalette.length] }}
                  />
                  <span>
                    {entry.label} ({formatBytes(entry.bytes)})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {disk ? (
          <div className="disk-list">
            {disk.entries.length ? (
              disk.entries.map(entry => (
                <div key={entry.target}>
                  <div>
                    <HardDrive size={16} />
                    <span>
                      <strong>{entry.label}</strong>
                      <small>{entry.path}</small>
                    </span>
                  </div>
                  <b>{formatBytes(entry.bytes)}</b>
                </div>
              ))
            ) : (
              <p className="empty-inline">No se detectaron carpetas regenerables en este proyecto.</p>
            )}
          </div>
        ) : (
          <LoadingInline />
        )}
      </section>

      <section className="card safety-note span-two">
        <ShieldCheck size={22} />
        <div>
          <h3>Garantía de limpieza segura con Dry-Run</h3>
          <p>
            Dev Command Center verifica rutas canónicas, prohíbe symlinks y nunca eliminará archivos
            de configuración sensible como <code>.env</code>, llaves o código fuente.
          </p>
        </div>
      </section>
    </div>
  )
}
