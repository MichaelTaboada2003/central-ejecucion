import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { GitHubAccountStatus, GitHubRepo } from '../types'

/**
 * Cuenta y catálogo de GitHub. Un fallo aquí no debe romper el panel local: se
 * registra en consola y la vista muestra su propio estado vacío, porque la app
 * funciona entera sin cuenta configurada.
 */
export function useGitHub() {
  const [status, setStatus] = useState<GitHubAccountStatus | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await api.getGitHubStatus()
      setStatus(next)
      if (next.authenticated) setRepos(await api.listGitHubRepos())
    } catch (error) {
      console.warn('No se pudo cargar estado de GitHub:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveToken = useCallback(async (token: string) => {
    const next = await api.saveGitHubToken(token)
    setStatus(next)
    if (next.authenticated) setRepos(await api.listGitHubRepos(token))
  }, [])

  return { status, repos, loading, load, saveToken }
}
