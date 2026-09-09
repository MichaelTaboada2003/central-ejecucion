import { AlertTriangle, ArrowRight, Check, CircleStop, LoaderCircle, PackageOpen, RotateCcw, Timer, X } from 'lucide-react'
import { useMemo } from 'react'
import { formatDurationText, formatElapsed } from '../lib/format'
import { describeInstallPhase, INSTALL_PHASES } from '../lib/install'
import type { InstallActivity, InstallOutcome } from '../hooks/useInstallActivity'

/** Líneas de la salida que se asoman en el panel. Las suficientes para ver que
 *  algo se mueve, no tantas como para convertirlo en una terminal. */
const TAIL_LINES = 4

function percentOf(ratio: number | null): number | null {
  return ratio === null ? null : Math.min(100, Math.max(0, Math.round(ratio * 100)))
}

/** Los contadores que el gestor haya dado; los que no, no se inventan. */
function counters(activity: InstallActivity): string[] {
  const { resolved, downloaded, installed } = activity.progress
  return [
    resolved !== null ? `${resolved} resueltos` : null,
    downloaded ? `${downloaded} descargados` : null,
    installed ? `${installed} instalados` : null,
  ].filter((value): value is string => value !== null)
}

/**
 * Panel de una instalación en curso: fase, avance, cronómetro y las últimas
 * líneas reales del gestor.
 *
 * Lo importante es que nada aquí es decorativo: la barra solo muestra un
 * porcentaje si el gestor da con qué calcularlo, y si no se mueve sola para
 * decir «sigue trabajando» sin fingir que sabe cuánto falta.
 */
export function InstallProgressPanel({
  activity,
  onCancel,
  onOpenLogs,
  cancelling,
}: {
  activity: InstallActivity
  onCancel?: () => void
  onOpenLogs?: () => void
  cancelling?: boolean
}) {
  const { progress, elapsedMs, command } = activity
  const percent = percentOf(progress.ratio)
  const currentStep = INSTALL_PHASES.findIndex(phase => phase.id === progress.phase)
  const tail = useMemo(
    () => activity.lines.filter(line => line.trim()).slice(-TAIL_LINES),
    [activity.lines]
  )
  const marcadores = counters(activity)

  return (
    <section className="install-panel" role="status" aria-live="polite">
      <div className="install-panel-head">
        <div className="install-panel-title">
          <LoaderCircle size={18} className="spin" />
          <div>
            <strong>Instalando dependencias</strong>
            {command && <code title={command}>{command}</code>}
          </div>
        </div>
        <div className="install-panel-actions">
          <span className="install-clock" title="Tiempo transcurrido">
            <Timer size={13} />
            {formatElapsed(elapsedMs)}
          </span>
          {onCancel && (
            <button className="danger-outline" onClick={onCancel} disabled={cancelling}>
              <CircleStop size={14} /> {cancelling ? 'Cancelando…' : 'Cancelar'}
            </button>
          )}
        </div>
      </div>

      <div
        className="install-bar"
        role="progressbar"
        aria-label="Avance de la instalación"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? describeInstallPhase(progress.phase) : `${percent} %`}
      >
        <div
          className={`install-bar-fill ${percent === null ? 'indeterminada' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>

      <ol className="install-steps">
        {INSTALL_PHASES.map((phase, index) => (
          <li
            key={phase.id}
            className={index < currentStep ? 'hecha' : index === currentStep ? 'activa' : ''}
            aria-current={index === currentStep ? 'step' : undefined}
          >
            <i aria-hidden="true" />
            {phase.label}
          </li>
        ))}
      </ol>

      <p className="install-detail">
        <span>{progress.detail ?? describeInstallPhase(progress.phase)}</span>
        {marcadores.length > 0 && (
          <span className="install-counters" title="Cifras que informa el propio gestor de paquetes">
            {marcadores.join(' · ')}
            {percent !== null && ` · ${percent} % aprox.`}
          </span>
        )}
      </p>

      {tail.length > 0 && (
        <div className="install-tail" aria-hidden="true">
          {tail.map((line, index) => (
            <p key={`${index}-${line}`}>{line}</p>
          ))}
        </div>
      )}

      <div className="install-foot">
        <span>La primera instalación de un proyecto puede tardar varios minutos.</span>
        {onOpenLogs && (
          <button className="install-link" onClick={onOpenLogs}>
            Ver la salida completa <ArrowRight size={13} />
          </button>
        )}
      </div>
    </section>
  )
}

/**
 * Cierre de la instalación. Sin esto el único aviso del final era que la
 * pantalla cambiaba sola: aquí se dice qué pasó, cuánto tardó y qué hacer si
 * salió mal.
 */
export function InstallOutcomeCard({
  outcome,
  onDismiss,
  onOpenLogs,
  onRetry,
}: {
  outcome: InstallOutcome
  onDismiss: () => void
  onOpenLogs?: () => void
  onRetry?: () => void
}) {
  const tono = outcome.ok ? 'good' : outcome.cancelled ? 'neutro' : 'bad'
  const detalles = [
    outcome.packages ? `${outcome.packages} paquetes` : null,
    outcome.durationMs !== null ? `en ${formatDurationText(outcome.durationMs)}` : null,
  ].filter(Boolean)

  return (
    <section className={`install-outcome ${tono}`} role="status" aria-live="polite">
      <div className="install-outcome-body">
        {outcome.ok ? <Check size={18} /> : outcome.cancelled ? <PackageOpen size={18} /> : <AlertTriangle size={18} />}
        <div>
          <strong>
            {outcome.ok
              ? 'Dependencias instaladas'
              : outcome.cancelled
                ? 'Instalación cancelada'
                : 'La instalación no terminó bien'}
          </strong>
          <span>
            {outcome.ok
              ? detalles.length
                ? detalles.join(' ')
                : 'El entorno del proyecto ya está listo.'
              : outcome.cancelled
                ? 'El entorno quedó a medias: vuelve a instalar antes de arrancar el proyecto.'
                : outcome.message || 'Revisa la salida del gestor para ver qué falló.'}
          </span>
        </div>
      </div>
      <div className="install-outcome-actions">
        {!outcome.ok && onRetry && (
          <button className="secondary" onClick={onRetry}>
            <RotateCcw size={14} /> Reintentar
          </button>
        )}
        {!outcome.ok && onOpenLogs && (
          <button className="secondary" onClick={onOpenLogs}>
            Ver la salida
          </button>
        )}
        <button className="icon-button" onClick={onDismiss} aria-label="Descartar el aviso" title="Descartar">
          <X size={14} />
        </button>
      </div>
    </section>
  )
}

/** Versión de una línea para el encabezado del proyecto, donde no cabe el panel. */
export function InstallStrip({ activity, onOpen }: { activity: InstallActivity; onOpen?: () => void }) {
  const percent = percentOf(activity.progress.ratio)
  return (
    <div className="install-strip" role="status" aria-live="polite">
      <div className="install-strip-text">
        <LoaderCircle size={16} className="spin" />
        <strong>Instalando dependencias</strong>
        <span>{activity.progress.detail ?? describeInstallPhase(activity.progress.phase)}</span>
        <span className="install-clock">
          <Timer size={13} />
          {formatElapsed(activity.elapsedMs)}
        </span>
      </div>
      <div className="install-bar delgada">
        <div
          className={`install-bar-fill ${percent === null ? 'indeterminada' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {onOpen && (
        <button className="install-link" onClick={onOpen}>
          Ver avance <ArrowRight size={13} />
        </button>
      )}
    </div>
  )
}
