import type {
  BackendAnimalDto,
  BackendAnimalPayload,
  BackendLoteDto,
  BackendRanchoDto
} from '../types/cattle';
import type { BackendLotePayload } from '../types/lot';

export const API_BASE_URL = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  '/api'
).replace(/\/$/, '');

/**
 * Rutas reales confirmadas en el backend ASP.NET Core (.NET 10).
 */
export const BACKEND_ROUTES = {
  AUTH_LOGIN: '/auth/login',
  ANIMALES: '/animales',
  LOTES: '/lotes',
  RANCHOS: '/ranchos',
  MOVIMIENTOS: '/movimientos-animales',
  ALIMENTACION: '/alimentacion',
  EVENTOS_SANITARIOS: '/eventos-sanitarios',
  TRATAMIENTOS: '/tratamientos',
  RECORDATORIOS: '/recordatorios',
  USUARIOS: '/usuarios',
  SYNC_PUSH: '/sync/operaciones',
  SYNC_PULL: '/sync/cambios',
  SYNC_AUDIT: '/sync/auditoria'
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    status: number,
    data?: unknown,
    retryAfterMs: number | null = null,
    cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterHeader(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }
  return null;
}

/**
 * Obtiene el token de sesión únicamente desde sessionStorage sin almacenarlo
 * en IndexedDB ni registrarlo en consola.
 */
export function readSessionAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      window.sessionStorage.getItem('farmbovi_access_token') ||
      window.sessionStorage.getItem('auth_token')
    );
  } catch {
    return null;
  }
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith(`${API_BASE_URL}/`) || normalizedPath === API_BASE_URL) {
    return normalizedPath;
  }
  return `${API_BASE_URL}${normalizedPath}`;
}

export function buildSafeHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extraHeaders
  };

  const token = readSessionAuthToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function extractErrorMessage(parsedBody: unknown, rawText: string, status: number): string {
  if (typeof parsedBody === 'string' && parsedBody.trim().length > 0) {
    return parsedBody.trim();
  }

  if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)) {
    const bodyRecord = parsedBody as Record<string, unknown>;
    if (typeof bodyRecord.mensaje === 'string' && bodyRecord.mensaje.trim().length > 0) {
      return bodyRecord.mensaje.trim();
    }
    if (typeof bodyRecord.message === 'string' && bodyRecord.message.trim().length > 0) {
      return bodyRecord.message.trim();
    }
    if (typeof bodyRecord.detail === 'string' && bodyRecord.detail.trim().length > 0) {
      return bodyRecord.detail.trim();
    }
    if (bodyRecord.errors && typeof bodyRecord.errors === 'object' && !Array.isArray(bodyRecord.errors)) {
      const messages = Object.values(bodyRecord.errors as Record<string, unknown>)
        .flatMap((val) => (Array.isArray(val) ? val : [val]))
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (messages.length > 0) {
        return messages.join(' ');
      }
    }
    if (typeof bodyRecord.title === 'string' && bodyRecord.title.trim().length > 0) {
      return bodyRecord.title.trim();
    }
  }

  if (rawText.trim().length > 0 && rawText.trim().length < 300) {
    return rawText.trim();
  }

  return `Error HTTP ${status} en el servidor.`;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  allowEmptyResponse?: boolean;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<{ status: number; data: T; headers: Headers }> {
  const url = buildApiUrl(path);
  const method = options.method || 'GET';
  const hasJsonBody = options.body !== undefined && !(options.body instanceof FormData);

  const headers = buildSafeHeaders(
    hasJsonBody
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options.headers
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      cache: 'no-store',
      body:
        options.body === undefined
          ? undefined
          : options.body instanceof FormData
            ? options.body
            : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 12000)
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    throw new ApiError(
      isTimeout
        ? 'Tiempo de espera agotado al comunicarse con el servidor.'
        : 'No fue posible establecer conexión con el servidor.',
      0,
      null,
      null,
      err
    );
  }

  const retryAfterMs = parseRetryAfterHeader(response.headers.get('Retry-After'));
  const contentType = response.headers.get('Content-Type') || '';
  const rawText = await response.text();

  // Detecta respuestas HTML (ej. fallback index.html de SPA cuando una ruta API no existe)
  if (contentType.includes('text/html') || rawText.trimStart().toLowerCase().startsWith('<!doctype html')) {
    throw new ApiError(
      'El servidor devolvió contenido HTML en lugar de JSON válido.',
      response.status || 502,
      null,
      retryAfterMs
    );
  }

  let parsedBody: unknown = null;
  if (rawText.trim().length > 0) {
    try {
      parsedBody = JSON.parse(rawText) as unknown;
    } catch (parseErr) {
      if (!response.ok) {
        throw new ApiError(
          extractErrorMessage(null, rawText, response.status),
          response.status,
          rawText,
          retryAfterMs,
          parseErr
        );
      }
      throw new ApiError(
        'Respuesta JSON malformada recibida desde el servidor.',
        response.status,
        null,
        retryAfterMs,
        parseErr
      );
    }
  }

  if (!response.ok) {
    const safeMessage = extractErrorMessage(parsedBody, rawText, response.status);
    throw new ApiError(safeMessage, response.status, parsedBody, retryAfterMs);
  }

  if (!options.allowEmptyResponse && parsedBody === null) {
    throw new ApiError(
      'El servidor respondió sin contenido JSON confirmado.',
      response.status,
      null,
      retryAfterMs
    );
  }

  return {
    status: response.status,
    data: parsedBody as T,
    headers: response.headers
  };
}

export const cattleApi = {
  async list(incluirEliminados = false): Promise<BackendAnimalDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendAnimalDto[]>(`${BACKEND_ROUTES.ANIMALES}${query}`, {
      method: 'GET'
    });
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: string): Promise<BackendAnimalDto> {
    const res = await apiRequest<BackendAnimalDto>(`${BACKEND_ROUTES.ANIMALES}/${id}`, {
      method: 'GET'
    });
    return res.data;
  },

  async create(input: BackendAnimalPayload): Promise<BackendAnimalDto> {
    const res = await apiRequest<BackendAnimalDto>(BACKEND_ROUTES.ANIMALES, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: string, input: BackendAnimalPayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.ANIMALES}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.ANIMALES}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};

export const lotsApi = {
  async list(incluirEliminados = false): Promise<BackendLoteDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendLoteDto[]>(`${BACKEND_ROUTES.LOTES}${query}`, {
      method: 'GET'
    });
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: string): Promise<BackendLoteDto> {
    const res = await apiRequest<BackendLoteDto>(`${BACKEND_ROUTES.LOTES}/${id}`, {
      method: 'GET'
    });
    return res.data;
  },

  async create(input: BackendLotePayload): Promise<BackendLoteDto> {
    const res = await apiRequest<BackendLoteDto>(BACKEND_ROUTES.LOTES, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: string, input: BackendLotePayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.LOTES}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.LOTES}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};

export const ranchesApi = {
  async list(incluirEliminados = false): Promise<BackendRanchoDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendRanchoDto[]>(`${BACKEND_ROUTES.RANCHOS}${query}`, {
      method: 'GET'
    });
    return Array.isArray(res.data) ? res.data : [];
  }
};
