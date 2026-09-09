import { describe, expect, it } from 'vitest'
import { EMPTY_INSTALL_PROGRESS, readInstallProgress } from '../install'

describe('readInstallProgress: traduce la salida del gestor a avance visible', () => {
  it('pnpm: separa resolución, descarga e instalación con sus cifras', () => {
    const progress = readInstallProgress([
      'Lockfile is up to date, resolution step is skipped',
      'Progress: resolved 120, reused 0, downloaded 0, added 0',
      'Progress: resolved 512, reused 300, downloaded 40, added 0',
      'Packages: +480',
      'Progress: resolved 512, reused 300, downloaded 212, added 240',
    ])
    expect(progress.phase).toBe('installing')
    expect(progress.resolved).toBe(512)
    expect(progress.downloaded).toBe(212)
    expect(progress.installed).toBe(240)
    // El denominador es lo que pnpm dice que va a añadir, no el grafo entero.
    expect(progress.ratio).toBeCloseTo(240 / 480)
  })

  it('pnpm: la fase no retrocede aunque vuelvan líneas de resolución', () => {
    const progress = readInstallProgress([
      'Progress: resolved 300, reused 0, downloaded 10, added 120',
      'Progress: resolved 320, reused 0, downloaded 10, added 120',
    ])
    expect(progress.phase).toBe('installing')
  })

  it('yarn: sus cuatro pasos numerados dan un avance exacto', () => {
    expect(readInstallProgress(['[1/4] Resolving packages...']).ratio).toBeCloseTo(0.25)
    const linking = readInstallProgress(['[1/4] Resolving packages...', '[3/4] Linking dependencies...'])
    expect(linking.phase).toBe('installing')
    expect(linking.detail).toBe('Enlazando dependencias')
    expect(linking.ratio).toBeCloseTo(0.75)
  })

  it('npm: sin contadores intermedios la barra queda indeterminada hasta el final', () => {
    const durante = readInstallProgress(['npm warn deprecated inflight@1.0.6: This module is not supported'])
    expect(durante.ratio).toBeNull()
    expect(durante.detail).toBeNull()
    const final = readInstallProgress(['added 512 packages in 31s'])
    expect(final.installed).toBe(512)
    expect(final.ratio).toBe(1)
  })

  it('pip: nombra el paquete concreto que está descargando', () => {
    const progress = readInstallProgress([
      'Collecting numpy>=2.0',
      '  Downloading numpy-2.0.1-cp312-macosx.whl (12.3 MB)',
      'Installing collected packages: numpy, pandas, scipy',
      'Successfully installed numpy-2.0.1 pandas-2.2.2 scipy-1.14.0',
    ])
    expect(progress.installed).toBe(3)
    expect(progress.phase).toBe('installing')
    expect(progress.ratio).toBe(1)
  })

  it('uv: cada fase trae su total', () => {
    const progress = readInstallProgress([
      'Resolved 42 packages in 1.2s',
      'Prepared 12 packages in 800ms',
      'Installed 42 packages in 96ms',
    ])
    expect(progress.resolved).toBe(42)
    expect(progress.downloaded).toBe(12)
    expect(progress.installed).toBe(42)
  })

  it('cargo: cuenta las cajas descargadas y compiladas una a una', () => {
    const progress = readInstallProgress([
      '  Downloaded serde v1.0.210',
      '  Downloaded tokio v1.40.0',
      '   Compiling serde v1.0.210',
    ])
    expect(progress.downloaded).toBe(2)
    expect(progress.installed).toBe(1)
    expect(progress.detail).toBe('Compilando serde v1.0.210')
  })

  it('descarta los colores de la salida y los refrescos con retorno de carro', () => {
    const progress = readInstallProgress([
      '\u001B[32mProgress: resolved 10, reused 0, downloaded 0, added 0\u001B[0m',
      'Progress: resolved 20, reused 0, downloaded 5, added 0\rProgress: resolved 30, reused 0, downloaded 9, added 0',
    ])
    expect(progress.resolved).toBe(30)
    expect(progress.downloaded).toBe(9)
  })

  it('una salida que no reconoce no inventa avance', () => {
    expect(readInstallProgress(['algo totalmente ajeno', ''])).toEqual(EMPTY_INSTALL_PROGRESS)
  })

  it('un entorno ya al día se cierra al 100 % en vez de quedarse a medias', () => {
    const progress = readInstallProgress(['Already up to date'])
    expect(progress.ratio).toBe(1)
    expect(progress.detail).toBe('El entorno ya estaba al día')
  })
})
