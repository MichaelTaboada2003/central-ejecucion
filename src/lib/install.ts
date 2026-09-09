/**
 * Lectura del avance de una instalación a partir de la salida del gestor.
 *
 * Instalar dependencias es lo más lento que hace el panel y hasta ahora era
 * también lo más mudo: el comando se lanzaba, el botón parpadeaba y el estado
 * cambiaba de golpe varios minutos después. Los gestores sí cuentan lo que
 * hacen —pnpm publica un contador, yarn numera sus cuatro fases, pip nombra
 * cada paquete—, así que en vez de inventar una animación se traduce lo que
 * ellos dicen.
 *
 * Es lógica pura sobre texto: cada regla reconoce a un gestor, y lo que no
 * reconoce simplemente no altera el estado (una salida desconocida deja la
 * barra indeterminada en vez de mentir con un porcentaje).
 */

export type InstallPhase = 'starting' | 'resolving' | 'downloading' | 'installing'

export interface InstallProgress {
  phase: InstallPhase
  /** Última acción con nombre propio: «Descargando numpy». Null si el gestor
   *  no la nombra, y entonces basta la etiqueta de la fase. */
  detail: string | null
  resolved: number | null
  downloaded: number | null
  installed: number | null
  /** Paquetes que el gestor anuncia que va a instalar, si los anuncia. */
  expected: number | null
  /** Fracción 0..1 SOLO cuando hay con qué estimarla; si no, indeterminada. */
  ratio: number | null
}

export const INSTALL_PHASES: Array<{ id: InstallPhase; label: string }> = [
  { id: 'starting', label: 'Preparando' },
  { id: 'resolving', label: 'Resolviendo' },
  { id: 'downloading', label: 'Descargando' },
  { id: 'installing', label: 'Instalando' },
]

const PHASE_ORDER: InstallPhase[] = INSTALL_PHASES.map(phase => phase.id)

export const EMPTY_INSTALL_PROGRESS: InstallProgress = {
  phase: 'starting',
  detail: null,
  resolved: null,
  downloaded: null,
  installed: null,
  expected: null,
  ratio: null,
}

/** Qué está pasando, en una frase, cuando el gestor no nombra un paquete. */
export function describeInstallPhase(phase: InstallPhase): string {
  switch (phase) {
    case 'starting':
      return 'Preparando el entorno…'
    case 'resolving':
      return 'Resolviendo el árbol de dependencias…'
    case 'downloading':
      return 'Descargando paquetes…'
    case 'installing':
      return 'Instalando paquetes en el proyecto…'
  }
}

/** Los códigos de color de la salida no son datos: estorban a las reglas. */
export function stripAnsi(line: string): string {
  return line.replace(/\u001B\[[0-9;?]*[a-zA-Z]/g, '')
}

type Patch = Partial<InstallProgress> & { advanceBy?: 'downloaded' | 'installed' }
type Rule = { pattern: RegExp; read: (match: RegExpMatchArray) => Patch | null }

const toNumber = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** Las fases de yarn vienen en inglés y numeradas; el resto de la interfaz no. */
const YARN_PHASES: Array<{ match: RegExp; phase: InstallPhase; detail: string }> = [
  { match: /resolving/i, phase: 'resolving', detail: 'Resolviendo paquetes' },
  { match: /fetching/i, phase: 'downloading', detail: 'Descargando paquetes' },
  { match: /linking/i, phase: 'installing', detail: 'Enlazando dependencias' },
  { match: /building/i, phase: 'installing', detail: 'Compilando paquetes' },
]

const RULES: Rule[] = [
  // pnpm lleva la cuenta de todo en una sola línea que reescribe sin parar.
  {
    pattern: /progress:\s*resolved\s+(\d+)(?:,\s*reused\s+(\d+))?(?:,\s*downloaded\s+(\d+))?(?:,\s*added\s+(\d+))?/i,
    read: match => {
      const downloaded = toNumber(match[3])
      const added = toNumber(match[4])
      return {
        resolved: toNumber(match[1]),
        downloaded,
        installed: added,
        phase: added ? 'installing' : downloaded ? 'downloading' : 'resolving',
      }
    },
  },
  // pnpm anuncia cuántos paquetes va a añadir: es el mejor denominador que hay.
  { pattern: /^packages:\s*\+(\d+)/i, read: match => ({ expected: toNumber(match[1]), phase: 'resolving' }) },
  // yarn numera sus fases, así que el avance es exacto y no una estimación.
  {
    pattern: /^\[(\d+)\/(\d+)\]\s*(.+?)\.*$/,
    read: match => {
      const step = toNumber(match[1])
      const total = toNumber(match[2])
      const known = YARN_PHASES.find(candidate => candidate.match.test(match[3]))
      if (!step || !total || !known) return null
      return { phase: known.phase, detail: known.detail, ratio: step / total }
    },
  },
  // Cierres de npm, pnpm y bun: el número final de paquetes.
  { pattern: /^added\s+(\d+)\s+packages?/i, read: match => ({ installed: toNumber(match[1]), phase: 'installing', ratio: 1 }) },
  { pattern: /^(\d+)\s+packages?\s+installed/i, read: match => ({ installed: toNumber(match[1]), phase: 'installing', ratio: 1 }) },
  {
    pattern: /^(?:already\s+)?up to date/i,
    read: () => ({ phase: 'installing', detail: 'El entorno ya estaba al día', ratio: 1 }),
  },
  // uv informa por fases con totales redondos.
  { pattern: /^resolved\s+(\d+)\s+packages?/i, read: match => ({ resolved: toNumber(match[1]), phase: 'resolving' }) },
  { pattern: /^prepared\s+(\d+)\s+packages?/i, read: match => ({ downloaded: toNumber(match[1]), phase: 'downloading' }) },
  { pattern: /^installed\s+(\d+)\s+packages?/i, read: match => ({ installed: toNumber(match[1]), phase: 'installing', ratio: 1 }) },
  // pip nombra cada paquete, que es más útil que cualquier porcentaje.
  { pattern: /^collecting\s+([^\s(;]+)/i, read: match => ({ phase: 'resolving', detail: `Resolviendo ${match[1]}` }) },
  {
    pattern: /^\s*downloading\s+(\S+?)(?:\s+\(([^)]+)\))?\s*$/i,
    read: match => ({
      phase: 'downloading',
      detail: `Descargando ${match[1]}${match[2] ? ` (${match[2]})` : ''}`,
      advanceBy: 'downloaded',
    }),
  },
  {
    pattern: /^\s*using cached\s+(\S+)/i,
    read: match => ({ phase: 'downloading', detail: `Reutilizando ${match[1]} de la caché`, advanceBy: 'downloaded' }),
  },
  {
    pattern: /^installing collected packages:\s*(.+)$/i,
    read: match => ({
      phase: 'installing',
      expected: match[1].split(',').filter(name => name.trim()).length,
      detail: 'Instalando paquetes descargados',
    }),
  },
  {
    pattern: /^successfully installed\s+(.+)$/i,
    read: match => ({ phase: 'installing', installed: match[1].split(/\s+/).filter(Boolean).length, ratio: 1 }),
  },
  { pattern: /^\s*building wheel for\s+(\S+)/i, read: match => ({ phase: 'installing', detail: `Compilando ${match[1]}` }) },
  // poetry: primero declara el plan, luego lo va cumpliendo paquete a paquete.
  { pattern: /^package operations:\s*(\d+)\s+install/i, read: match => ({ expected: toNumber(match[1]), phase: 'resolving' }) },
  {
    pattern: /^\s*[-•]?\s*installing\s+(\S+)\s*\(([^)]+)\)/i,
    read: match => ({ phase: 'installing', detail: `Instalando ${match[1]} ${match[2]}`, advanceBy: 'installed' }),
  },
  // cargo y go descargan y compilan de una en una, sin totales.
  {
    pattern: /^\s*downloaded\s+([\w.@/-]+)\s+v(\S+)/i,
    read: match => ({ phase: 'downloading', detail: `Descargando ${match[1]} v${match[2]}`, advanceBy: 'downloaded' }),
  },
  {
    pattern: /^\s*compiling\s+([\w.@/-]+)\s+v(\S+)/i,
    read: match => ({ phase: 'installing', detail: `Compilando ${match[1]} v${match[2]}`, advanceBy: 'installed' }),
  },
  {
    pattern: /^go:\s*downloading\s+(\S+)\s+(\S+)/i,
    read: match => ({ phase: 'downloading', detail: `Descargando ${match[1]} ${match[2]}`, advanceBy: 'downloaded' }),
  },
  { pattern: /^\s*finished\b/i, read: () => ({ phase: 'installing', ratio: 1 }) },
]

/** Ruido de los gestores que no describe avance alguno. */
const NOISE = /^(npm\s+(warn|notice|error)|warn\b|warning\b|deprecated\b)/i

function furthest(current: InstallPhase, next: InstallPhase | undefined): InstallPhase {
  if (!next) return current
  // El avance no retrocede: pnpm intercala líneas de resolución mientras
  // enlaza, y ver «Descargando» después de «Instalando» parece un reinicio.
  return PHASE_ORDER.indexOf(next) > PHASE_ORDER.indexOf(current) ? next : current
}

/** Estimación honesta: solo cuando hay numerador y denominador reales. */
function estimateRatio(state: InstallProgress, explicit: number | null): number | null {
  const previous = state.ratio ?? 0
  if (explicit !== null) return Math.max(previous, Math.min(explicit, 1))
  const total = state.expected ?? state.resolved
  if (!total || state.installed === null) return state.ratio
  return Math.max(previous, Math.min(state.installed / total, 1))
}

function applySegment(state: InstallProgress, segment: string): InstallProgress {
  const text = segment.trim()
  if (!text || NOISE.test(text)) return state
  for (const rule of RULES) {
    const match = text.match(rule.pattern)
    if (!match) continue
    const patch = rule.read(match)
    if (!patch) continue
    const { advanceBy, ratio: explicitRatio, phase, ...values } = patch
    const next: InstallProgress = {
      ...state,
      ...(Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== null && value !== undefined)
      ) as Partial<InstallProgress>),
      phase: furthest(state.phase, phase),
    }
    // Los gestores que van de uno en uno no dan totales: se cuentan sus líneas.
    if (advanceBy) next[advanceBy] = (state[advanceBy] ?? 0) + 1
    next.ratio = estimateRatio(next, explicitRatio ?? null)
    return next
  }
  return state
}

/**
 * Estado del avance tras leer estas líneas. Se recalcula entero en cada lote
 * porque es una pasada de expresiones regulares sobre un búfer acotado, y así
 * el resultado no depende de qué lote llegó antes.
 */
export function readInstallProgress(
  lines: string[],
  initial: InstallProgress = EMPTY_INSTALL_PROGRESS
): InstallProgress {
  let state = initial
  for (const line of lines) {
    // Una sola línea puede traer varios refrescos separados por retorno de
    // carro cuando el gestor cree estar pintando sobre sí mismo.
    for (const segment of stripAnsi(line).split('\r')) {
      state = applySegment(state, segment)
    }
  }
  return state
}
