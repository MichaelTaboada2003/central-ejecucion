import { Check, Copy, FolderOpen, LoaderCircle, Plus } from 'lucide-react'
import { ReactNode, useEffect, useRef, useState } from 'react'
import type { ProjectStatus } from '../types'

export function StatCard({
  label,
  value,
  status,
  icon,
}: {
  label: string
  value: number
  status: ProjectStatus | 'neutral'
  icon: ReactNode
}) {
  return (
    <article className={`stat-card ${status}`}>
      <div className="stat-top">
        <div className="stat-icon">{icon}</div>
        <span className="stat-value">{value}</span>
      </div>
      <div className="stat-bottom">
        <span className="stat-label">{label}</span>
      </div>
    </article>
  )
}
export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  )
}
export function CopyButton({ value, onCopy }: { value: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const handleCopy = () => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    onCopy?.()
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button className="copy-button" aria-label="Copiar comando" onClick={handleCopy}>
      {copied ? <Check size={14} color="var(--accent-primary)" /> : <Copy size={14} />}
    </button>
  )
}
export function EmptyState({ onRegister }: { onRegister: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FolderOpen size={26} />
      </div>
      <h3>Registra tu primer proyecto</h3>
      <p>
        Selecciona una carpeta o pega una ruta local. Dev Command Center detectará de forma
        automática su stack, dependencias y comandos.
      </p>
      <button className="primary" onClick={onRegister}>
        <Plus size={16} /> Registrar proyecto
      </button>
    </div>
  )
}
export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <LoaderCircle className="spin" size={32} />
      <span>Cargando datos locales…</span>
    </div>
  )
}
export function LoadingInline() {
  return (
    <div className="loading-inline">
      <LoaderCircle className="spin" size={18} /> Calculando información…
    </div>
  )
}
