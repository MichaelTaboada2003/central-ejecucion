import { Box, FileCode2, Folder, LayoutDashboard, Radio } from 'lucide-react'
import type { ProjectKind } from '../types'

/** Qué significa cada naturaleza y con qué se dibuja. Vive fuera de los
 *  componentes porque lo usan la cabecera del proyecto, el selector de
 *  configuración y los avisos. */
export const kindMeta: Record<ProjectKind, { label: string; hint: string; icon: typeof LayoutDashboard }> = {
  service: {
    label: 'Servicio',
    hint: 'Servidor de larga duración: se arranca, se detiene y se abre en el navegador.',
    icon: Radio,
  },
  script: {
    label: 'Script',
    hint: 'Tarea de una pasada: importa cómo termina y cuánto tarda, no un puerto.',
    icon: FileCode2,
  },
  notebook: {
    label: 'Notebook',
    hint: 'Cuadernos Jupyter: la acción útil es abrir Jupyter Lab en esta carpeta.',
    icon: Box,
  },
  inert: {
    label: 'Sin ejecutable',
    hint: 'No hay nada que arrancar en la raíz. Útil para repos de documentación y monorepos cuyas apps viven en subcarpetas.',
    icon: Folder,
  },
}
