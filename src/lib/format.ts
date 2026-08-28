/** Formateo para pantalla. Sin dependencias de React. */
import type { CommandRecord } from '../types'

export function formatBytes(value: number): string {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

export function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function getStackClass(framework: string): string {
  const f = framework.toLowerCase()
  if (f.includes('react')) return 'react'
  if (f.includes('vite')) return 'vite'
  if (f.includes('rust')) return 'rust'
  if (f.includes('python') || f.includes('django') || f.includes('fastapi')) return 'python'
  if (f.includes('astro')) return 'astro'
  return ''
}

/** Duración de una ejecución; para una en curso, lo que lleva hasta `now`. */
export function commandDuration(command: CommandRecord, now: number = Date.now()): string | null {
  const started = Date.parse(command.startedAt)
  const ended = command.endedAt ? Date.parse(command.endedAt) : now
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return null
  const seconds = Math.round((ended - started) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * Resultado de una ejecución en una línea. El código de salida y la duración ya
 * se guardaban en el historial y no se mostraban en ninguna pantalla.
 */
export function describeCommandOutcome(command: CommandRecord, now: number = Date.now()): string {
  const duration = commandDuration(command, now)
  if (command.status === 'running') return duration ? `ejecutando · ${duration}` : 'ejecutando'
  const outcome =
    command.exitCode === 0
      ? 'terminó (0)'
      : command.exitCode === null
      ? command.status === 'stopped'
        ? 'detenido a mano'
        : command.status
      : `falló (${command.exitCode})`
  return duration ? `${outcome} · ${duration}` : outcome
}

/**
 * Fecha en tiempo relativo. «hace 3 días» dice de un vistazo si un repositorio
 * sigue vivo; «25/8/2026» obliga a restar mentalmente.
 */
export function formatRelative(value: string, now: number = Date.now()): string {
  const fecha = Date.parse(value)
  if (Number.isNaN(fecha)) return '—'
  const segundos = Math.round((now - fecha) / 1000)
  if (segundos < 0) return 'en el futuro'
  if (segundos < 60) return 'hace un momento'
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'ayer'
  if (dias < 30) return `hace ${dias} días`
  const meses = Math.floor(dias / 30)
  if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`
  const anios = Math.floor(meses / 12)
  return `hace ${anios} ${anios === 1 ? 'año' : 'años'}`
}
