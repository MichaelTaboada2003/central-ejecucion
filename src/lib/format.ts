/** Formateo para pantalla. Sin dependencias de React. */
import type { CommandRecord } from '../types'

export function formatBytes(value: number): string {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

/**
 * Instante escrito por el backend. El inicio de un comando se guarda en RFC
 * 3339 y su fin lo escribe SQLite con `datetime('now')`: mismo reloj (UTC)
 * pero sin la zona, y el navegador lo leía como hora local. Una instalación de
 * treinta segundos aparecía durando cinco horas.
 */
export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const text = value.trim()
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text
  const parsed = Date.parse(normalized)
  return Number.isNaN(parsed) ? null : parsed
}

export function formatDate(value: string): string {
  const parsed = parseTimestamp(value)
  return parsed === null
    ? '—'
    : new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/** Cronómetro de una tarea en curso: `01:12`, y con horas si las hubiera. */
export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000))
  const seconds = String(total % 60).padStart(2, '0')
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${String(minutes).padStart(2, '0')}:${seconds}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`
}

/** Duración en palabras para un resumen: «42 s», «3 min 12 s». */
export function formatDurationText(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`
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
  const started = parseTimestamp(command.startedAt)
  const ended = command.endedAt ? parseTimestamp(command.endedAt) : now
  if (started === null || ended === null || ended < started) return null
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
  const fecha = parseTimestamp(value)
  if (fecha === null) return '—'
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
