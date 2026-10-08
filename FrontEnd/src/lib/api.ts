import type { Cattle, CattleInput } from '../types/cattle'

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
