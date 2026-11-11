import type { Cattle, CattleInput } from '../types/cattle'
import type {
  EventoSanitario,
  EventoSanitarioInput,
  Recordatorio,
  RecordatorioInput,
  Tratamiento,
  TratamientoInput,
} from '../types/sanidad'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

interface ProblemDetails {
  title?: string
  detail?: string
  errors?: Record<string, string[]>
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.', 0)
  }

  if (!response.ok) {
    const problem: ProblemDetails = await response.json().catch(() => ({}))
    const validation = Object.values(problem.errors || {}).flat().join(' ')
    throw new ApiError(validation || problem.detail || problem.title || `Error del servidor (${response.status}).`, response.status)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const cattleApi = {
  list: (signal?: AbortSignal) => request<Cattle[]>('/cattle', { signal }),
  create: (data: CattleInput) => request<Cattle>('/cattle', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: CattleInput) => request<Cattle>(`/cattle/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: number) => request<void>(`/cattle/${id}`, { method: 'DELETE' }),
}

export const eventosSanitariosApi = {
  list: (idAnimal?: string, signal?: AbortSignal) => {
    const query = idAnimal ? `?idAnimal=${encodeURIComponent(idAnimal)}` : ''
    return request<EventoSanitario[]>(`/eventos-sanitarios${query}`, { signal })
  },
  create: (data: EventoSanitarioInput) =>
    request<EventoSanitario>('/eventos-sanitarios', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: EventoSanitarioInput) =>
    request<EventoSanitario>(`/eventos-sanitarios/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    request<void>(`/eventos-sanitarios/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export const tratamientosApi = {
  list: (params?: { idEventoSanitario?: string; idAnimal?: string }, signal?: AbortSignal) => {
    const search = new URLSearchParams()
    if (params?.idEventoSanitario) search.set('idEventoSanitario', params.idEventoSanitario)
    if (params?.idAnimal) search.set('idAnimal', params.idAnimal)
    const qs = search.toString() ? `?${search.toString()}` : ''
    return request<Tratamiento[]>(`/tratamientos${qs}`, { signal })
  },
  create: (data: TratamientoInput) =>
    request<Tratamiento>('/tratamientos', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: TratamientoInput) =>
    request<Tratamiento>(`/tratamientos/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    request<void>(`/tratamientos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export const recordatoriosApi = {
  list: (params?: { estado?: string; idAnimal?: string }, signal?: AbortSignal) => {
    const search = new URLSearchParams()
    if (params?.estado) search.set('estado', params.estado)
    if (params?.idAnimal) search.set('idAnimal', params.idAnimal)
    const qs = search.toString() ? `?${search.toString()}` : ''
    return request<Recordatorio[]>(`/recordatorios${qs}`, { signal })
  },
  create: (data: RecordatorioInput) =>
    request<Recordatorio>('/recordatorios', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: RecordatorioInput) =>
    request<Recordatorio>(`/recordatorios/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  cambiarEstado: (id: string, estado: string) =>
    request<Recordatorio>(
      `/recordatorios/${encodeURIComponent(id)}/estado?estado=${encodeURIComponent(estado)}`,
      { method: 'PATCH' }
    ),
  remove: (id: string) =>
    request<void>(`/recordatorios/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
