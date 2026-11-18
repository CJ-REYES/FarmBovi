import type { Cattle, CattleInput } from '../types/cattle';

export const API_BASE_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) || '/api'
).replace(/\/$/, '');

/**
 * Rutas reales confirmadas en el backend ASP.NET Core (.NET 10).
 * No se incluyen rutas inexistentes como /api/cattle.
 */
export const BACKEND_ROUTES = {
  ANIMALES: '/animales'
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
 * Obtiene el token de sesión únicamente desde memoria/sessionStorage sin almacenarlo
 * en IndexedDB ni registrarlo en consola.
 */
function readSessionAuthToken(): string | null {
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
      credentials: 'include',
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
  if (contentType.includes('text/html') || rawText.trimStart().startsWith('<!doctype html')) {
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
    const bodyRecord =
      parsedBody && typeof parsedBody === 'object'
        ? (parsedBody as Record<string, unknown>)
        : null;

    const safeMessage =
      (typeof bodyRecord?.message === 'string' && bodyRecord.message) ||
      (typeof bodyRecord?.title === 'string' && bodyRecord.title) ||
      `Error HTTP ${response.status} en el servidor.`;

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
  async list(): Promise<Cattle[]> {
    const res = await apiRequest<Cattle[]>(BACKEND_ROUTES.ANIMALES, { method: 'GET' });
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: number | string): Promise<Cattle> {
    const res = await apiRequest<Cattle>(`${BACKEND_ROUTES.ANIMALES}/${id}`, { method: 'GET' });
    return res.data;
  },

  async create(input: CattleInput): Promise<Cattle> {
    const res = await apiRequest<Cattle>(BACKEND_ROUTES.ANIMALES, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: number | string, input: CattleInput): Promise<Cattle> {
    const res = await apiRequest<Cattle>(`${BACKEND_ROUTES.ANIMALES}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
    return res.data;
  },

  async remove(id: number | string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.ANIMALES}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};
