import type { Cattle, CattleInput } from '../types/cattle'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const TOKEN_KEY = 'farmbovi:access-token'
const USER_ID_KEY = 'farmbovi:user-id'

export const authApi = {
  token: () => sessionStorage.getItem(TOKEN_KEY),
  userId: () => sessionStorage.getItem(USER_ID_KEY),
  clear: () => { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_ID_KEY) },
  async login(correo: string, contrasena: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/usuarios/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, contrasena }), cache: 'no-store',
    })
    if (!response.ok) {
      const problem: ProblemDetails = await response.json().catch(() => ({}))
      throw new ApiError(problem.detail || problem.title || (response.status === 401 ? 'Correo o contraseña incorrectos.' : 'No se pudo iniciar sesión.'), response.status)
    }
    const result = await response.json() as { token: string; usuario: { id: number } }
    sessionStorage.setItem(TOKEN_KEY, result.token)
    sessionStorage.setItem(USER_ID_KEY, String(result.usuario.id))
  },
}

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
      headers: {
        'Content-Type': 'application/json',
        ...(authApi.token() ? { Authorization: `Bearer ${authApi.token()}` } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.', 0)
  }

  if (!response.ok) {
    if (response.status === 401 && authApi.token()) {
      authApi.clear()
      window.dispatchEvent(new Event('farmbovi:session-expired'))
    }
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

export interface ServerChange {
  idCambio: number
  entidad: string
  idRegistro: string
  idRancho: number
  operacion: 'crear' | 'actualizar' | 'eliminar'
  ocurrioEn: string
  datos: Record<string, unknown>
}

export interface ServerChangePage {
  cambios: ServerChange[]
  cursorSiguiente: string | null
  hayMas: boolean
}

export const syncApi = {
  getChanges: (cursor: string | null, limit = 100) => {
    const params = new URLSearchParams({ limite: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return request<ServerChangePage>(`/sync/cambios?${params.toString()}`)
  }
}
