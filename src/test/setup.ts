import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/** Cada prueba monta su propio árbol: si no se desmonta, el `screen` de la
 *  siguiente encuentra los nodos de la anterior y los asertos mienten. */
afterEach(() => cleanup())
