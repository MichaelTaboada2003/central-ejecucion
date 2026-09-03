import type { EnvFileInfo, EnvVar } from '../types'

/**
 * Presentación de la bóveda de variables de entorno. Nada de esto toca la base
 * de datos: el formato dotenv canónico y la clasificación de secretos viven en
 * `src-tauri/src/env_vars.rs`, y aquí solo se replica lo que la interfaz
 * necesita para decidir en el momento —enmascarar, agrupar, contar lo pegado—
 * sin dar un viaje al backend por cada tecla.
 */

/** Cuántos puntos como máximo sustituyen a un valor oculto. */
const MASK_LIMIT = 24

/**
 * Oculta un valor sin mentir sobre su tamaño: un secreto vacío y uno de
 * cuarenta caracteres tienen que distinguirse, porque «lo puse mal» y «no lo
 * puse» se arreglan de formas distintas.
 */
export function maskValue(value: string): string {
  if (!value) return '(vacío)'
  return '•'.repeat(Math.min(value.length, MASK_LIMIT))
}

const SECRET_SEGMENTS = new Set([
  'TOKEN', 'SECRET', 'SECRETS', 'PASSWORD', 'PASSWD', 'PASS', 'PASSPHRASE', 'KEY', 'KEYS',
  'APIKEY', 'CREDENTIAL', 'CREDENTIALS', 'PRIVATE', 'DSN', 'SALT', 'SIGNATURE', 'SIGNING',
  'CERT', 'CERTIFICATE', 'JWT', 'AUTH', 'SESSION', 'COOKIE', 'ENCRYPTION', 'CIPHER', 'OTP',
])

const SECRET_SUBSTRINGS = ['TOKEN', 'SECRET', 'PASSWORD', 'APIKEY', 'PRIVATEKEY']

/**
 * ¿Debe ocultarse este valor? Espejo de `is_secret_key` en Rust, que es quien
 * decide al importar; esto solo sirve para marcar la casilla sola mientras se
 * teclea una variable nueva.
 *
 * Compara piezas completas del nombre y no subcadenas: buscar «KEY» dentro
 * marcaba `MONKEY_NAME`, y buscar «AUTH» marcaba `AUTHOR_EMAIL`.
 */
export function looksLikeSecret(key: string, value = ''): boolean {
  const upper = key.toUpperCase()
  if (upper.split(/[_\-.]/).some(segment => SECRET_SEGMENTS.has(segment))) return true
  if (SECRET_SUBSTRINGS.some(hint => upper.includes(hint))) return true
  return urlCarriesCredentials(value)
}

/** `postgres://usuario:contraseña@host`: el nombre no delata nada, el valor sí. */
function urlCarriesCredentials(value: string): boolean {
  const [, rest] = value.split('://')
  if (!rest) return false
  const at = rest.indexOf('@')
  if (at <= 0) return false
  const authority = rest.slice(0, at)
  if (authority.includes('/')) return false
  const colon = authority.indexOf(':')
  return colon > 0 && colon < authority.length - 1
}

/**
 * Precedencia del fichero al fusionar variables, igual que en Vite y
 * dotenv-flow: lo más específico gana. Se usa para ordenar los grupos de forma
 * que se lean en el mismo orden en que se aplican.
 */
export function scopeRank(scope: string): number {
  const lower = scope.toLowerCase()
  if (lower === '.env') return 0
  if (lower === '.env.local') return 20
  if (lower.endsWith('.local')) return 30
  return 10
}

/** ¿Es una plantilla pública (`.env.example`) y no una fuente de valores? */
export function isTemplateScope(scope: string): boolean {
  return /\.(example|sample|template|dist|defaults)$/i.test(scope)
}

export interface EnvVarGroup {
  scope: string
  vars: EnvVar[]
}

/** Agrupa por fichero, ordenando los grupos por precedencia y las claves A→Z. */
export function groupByScope(vars: EnvVar[]): EnvVarGroup[] {
  const groups = new Map<string, EnvVar[]>()
  for (const variable of vars) {
    const bucket = groups.get(variable.scope)
    if (bucket) bucket.push(variable)
    else groups.set(variable.scope, [variable])
  }
  return [...groups.entries()]
    .map(([scope, scopeVars]) => ({
      scope,
      vars: [...scopeVars].sort((left, right) => left.key.localeCompare(right.key, 'es', { sensitivity: 'base' })),
    }))
    .sort((left, right) => scopeRank(left.scope) - scopeRank(right.scope) || left.scope.localeCompare(right.scope))
}

/** Agrupa huérfanas por el proyecto del que venían. */
export function groupByOrigin(vars: EnvVar[]): Array<{ origin: string; path: string | null; orphanedAt: string | null; vars: EnvVar[] }> {
  const groups = new Map<string, EnvVar[]>()
  for (const variable of vars) {
    const origin = variable.originProjectName || 'Proyecto desconocido'
    const bucket = groups.get(origin)
    if (bucket) bucket.push(variable)
    else groups.set(origin, [variable])
  }
  return [...groups.entries()]
    .map(([origin, originVars]) => ({
      origin,
      path: originVars[0].originProjectPath ?? null,
      orphanedAt: originVars[0].orphanedAt ?? null,
      vars: [...originVars].sort(
        (left, right) =>
          scopeRank(left.scope) - scopeRank(right.scope) ||
          left.scope.localeCompare(right.scope) ||
          left.key.localeCompare(right.key, 'es', { sensitivity: 'base' })
      ),
    }))
    .sort((left, right) => (right.orphanedAt ?? '').localeCompare(left.orphanedAt ?? ''))
}

/**
 * Cuenta las claves de un bloque pegado a mano, para poder decir «se detectaron
 * 12 variables» antes de importar nada.
 *
 * Es deliberadamente más simple que el intérprete de Rust —no resuelve valores
 * entre comillas repartidos en varias líneas— porque su única misión es dar una
 * cifra orientativa: quien importa de verdad es el backend.
 */
export function countParsableVars(text: string): number {
  const keys = new Set<string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const assignment = line.startsWith('export ') ? line.slice('export '.length) : line
    const separator = assignment.indexOf('=')
    if (separator <= 0) continue
    const key = assignment.slice(0, separator).trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key)
  }
  return keys.size
}

export type SyncTone = 'synced' | 'pending' | 'drifted' | 'template' | 'vault-only'

export interface SyncState {
  tone: SyncTone
  label: string
  hint: string
}

/**
 * Traduce el estado de un fichero a algo que se pueda leer de un vistazo. El
 * caso que importa es `pending`: son las claves que hay en el disco y no en la
 * bóveda, es decir, las que se perderían al borrar el proyecto.
 */
export function syncState(file: EnvFileInfo): SyncState {
  if (file.isTemplate) {
    return {
      tone: 'template',
      label: 'Plantilla',
      hint: 'Declara qué claves espera el proyecto, sin valores reales.',
    }
  }
  if (file.fileVarCount === 0 && file.vaultVarCount > 0) {
    return {
      tone: 'vault-only',
      label: 'Solo en la bóveda',
      hint: 'El fichero no existe en el disco. Escríbelo para regenerarlo.',
    }
  }
  if (file.missingInVault.length > 0) {
    return {
      tone: 'pending',
      label: `${file.missingInVault.length} sin proteger`,
      hint: `Estas claves solo están en el disco y se perderían al borrar el proyecto: ${file.missingInVault.join(', ')}`,
    }
  }
  if (file.differing.length > 0 || file.onlyInVault.length > 0) {
    return {
      tone: 'drifted',
      label: 'Desincronizado',
      hint: [
        file.differing.length ? `Distinto valor en disco y bóveda: ${file.differing.join(', ')}` : '',
        file.onlyInVault.length ? `Solo en la bóveda: ${file.onlyInVault.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    }
  }
  return { tone: 'synced', label: 'Sincronizado', hint: 'El fichero y la bóveda dicen lo mismo.' }
}
