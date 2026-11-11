import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  eventosSanitariosApi,
  recordatoriosApi,
  tratamientosApi,
} from '../lib/api'
import type {
  EventoSanitario,
  EventoSanitarioInput,
  Recordatorio,
  RecordatorioInput,
  Tratamiento,
  TratamientoInput,
} from '../types/sanidad'

const SANIDAD_CACHE_KEY = 'farmbovi.sanidad.snapshot.v1'

interface SanidadSnapshot {
  eventos: EventoSanitario[]
  tratamientos: Tratamiento[]
  recordatorios: Recordatorio[]
  savedAt: string
}

function readSanidadCache(): SanidadSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SANIDAD_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SanidadSnapshot
  } catch {
    return null
  }
}

function writeSanidadCache(snapshot: SanidadSnapshot): void {
  try {
    window.localStorage.setItem(SANIDAD_CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage quota issues
  }
}

interface SanidadState {
  eventos: EventoSanitario[]
  tratamientos: Tratamiento[]
  recordatorios: Recordatorio[]
  loading: boolean
  source: 'server' | 'cache' | 'unavailable'
  error: string | null
  savedAt: string | null
}

export function useSanidad() {
  const [state, setState] = useState<SanidadState>({
    eventos: [],
    tratamientos: [],
    recordatorios: [],
    loading: true,
    source: 'unavailable',
    error: null,
    savedAt: null,
  })
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    setRevision((val) => val + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const [eventos, tratamientos, recordatorios] = await Promise.all([
          eventosSanitariosApi.list(undefined, controller.signal),
          tratamientosApi.list(undefined, controller.signal),
          recordatoriosApi.list(undefined, controller.signal),
        ])
        if (controller.signal.aborted) return
        const savedAt = new Date().toISOString()
        writeSanidadCache({ eventos, tratamientos, recordatorios, savedAt })
        setState({
          eventos,
          tratamientos,
          recordatorios,
          loading: false,
          source: 'server',
          error: null,
          savedAt,
        })
      } catch (err) {
        if (controller.signal.aborted) return
        const canUseCache = err instanceof ApiError && (err.status === 0 || err.status >= 500)
        const cached = canUseCache ? readSanidadCache() : null
        setState({
          eventos: cached?.eventos || [],
          tratamientos: cached?.tratamientos || [],
          recordatorios: cached?.recordatorios || [],
          loading: false,
          source: cached ? 'cache' : 'unavailable',
          error: err instanceof Error ? err.message : 'No se pudo cargar el módulo de sanidad y agenda.',
          savedAt: cached?.savedAt || null,
        })
      }
    }
    void load()
    return () => controller.abort()
  }, [revision])

  async function saveEvento(input: EventoSanitarioInput, id?: string) {
    const result = id
      ? await eventosSanitariosApi.update(id, input)
      : await eventosSanitariosApi.create(input)
    refresh()
    return result
  }

  async function removeEvento(id: string) {
    await eventosSanitariosApi.remove(id)
    refresh()
  }

  async function saveTratamiento(input: TratamientoInput, id?: string) {
    const result = id
      ? await tratamientosApi.update(id, input)
      : await tratamientosApi.create(input)
    refresh()
    return result
  }

  async function removeTratamiento(id: string) {
    await tratamientosApi.remove(id)
    refresh()
  }

  async function saveRecordatorio(input: RecordatorioInput, id?: string) {
    const result = id
      ? await recordatoriosApi.update(id, input)
      : await recordatoriosApi.create(input)
    refresh()
    return result
  }

  async function cambiarEstadoRecordatorio(id: string, estado: string) {
    const result = await recordatoriosApi.cambiarEstado(id, estado)
    refresh()
    return result
  }

  async function removeRecordatorio(id: string) {
    await recordatoriosApi.remove(id)
    refresh()
  }

  return {
    ...state,
    refresh,
    saveEvento,
    removeEvento,
    saveTratamiento,
    removeTratamiento,
    saveRecordatorio,
    cambiarEstadoRecordatorio,
    removeRecordatorio,
  }
}
