import { statusLabels } from '../lib/labels'
import { describeCommandOutcome } from '../lib/format'
import type { CommandRecord, ProjectStatus } from '../types'

export function StatusDot({ status }: { status: ProjectStatus }) {
  return <i className={`status-dot ${status}`} aria-hidden="true" />
}
export function StatusPill({ status }: { status: ProjectStatus }) {
  return (
    <span className={`status-pill ${status}`}>
      <StatusDot status={status} />
      {statusLabels[status]}
    </span>
  )
}
export function LastRunPill({ record }: { record?: CommandRecord }) {
  if (!record) {
    return (
      <span className="status-pill stopped">
        <StatusDot status="stopped" />
        Sin ejecutar
      </span>
    )
  }
  const failed = record.exitCode !== null && record.exitCode !== 0
  return (
    <span className={`status-pill ${failed ? 'error' : 'stopped'}`} title={record.command}>
      <StatusDot status={failed ? 'error' : 'stopped'} />
      {describeCommandOutcome(record)}
    </span>
  )
}
