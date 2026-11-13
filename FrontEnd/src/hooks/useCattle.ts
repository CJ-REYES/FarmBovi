import { useCallback, useEffect, useState } from 'react'
import { ApiError, cattleApi } from '../lib/api'
import { clearSnapshot, readSnapshot, saveSnapshot } from '../lib/cattle-cache'
import type { Cattle, CattleInput } from '../types/cattle'

interface CattleState {
  cattle: Cattle[]
  loading: boolean
  source: 'server' | 'cache' | 'unavailable'
  savedAt: string | null
  error: string | null
  cacheAvailable: boolean
}

export function useCattle() {
  const [state, setState] = useState<CattleState>({
    cattle: [], loading: true, source: 'unavailable', savedAt: null, error: null, cacheAvailable: false,
  })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const cattle = await cattleApi.list(controller.signal)
        if (controller.signal.aborted) return
        const savedAt = new Date().toISOString()
        const cacheAvailable = saveSnapshot({ cattle, savedAt })
        setState({ cattle, loading: false, source: 'server', savedAt, error: null, cacheAvailable })
      } catch (error) {
        if (controller.signal.aborted) return
        // Validation/auth errors must never be disguised as an offline success.
        const canUseCache = error instanceof ApiError && (error.status === 0 || error.status >= 500)
        const cached = canUseCache ? readSnapshot() : null
        setState({
          cattle: cached?.cattle || [], loading: false,
          source: cached ? 'cache' : 'unavailable', savedAt: cached?.savedAt || null,
          error: error instanceof Error ? error.message : 'No se pudo cargar el ganado.',
          cacheAvailable: Boolean(cached),
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [revision])

  const refresh = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, error: null }))
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [refresh])

  async function save(data: CattleInput, id?: number) {
    const animal = id ? await cattleApi.update(id, data) : await cattleApi.create(data)
    const cattle = id ? state.cattle.map((item) => item.id === id ? animal : item) : [...state.cattle, animal]
    const savedAt = new Date().toISOString()
    clearSnapshot()
    const cacheAvailable = saveSnapshot({ cattle, savedAt })
    setState({ cattle, loading: false, source: 'server', savedAt, error: null, cacheAvailable })
    refresh()
  }

  async function remove(id: number) {
    await cattleApi.remove(id)
    const cattle = state.cattle.filter((animal) => animal.id !== id)
    const savedAt = new Date().toISOString()
    clearSnapshot()
    const cacheAvailable = saveSnapshot({ cattle, savedAt })
    setState({ cattle, loading: false, source: 'server', savedAt, error: null, cacheAvailable })
    refresh()
  }

  return { ...state, refresh, save, remove }
}
