import type {
  BackendAnimalDto,
  BackendAnimalPayload,
  BackendLoteDto,
  BackendRanchoDto
} from '../types/cattle';
import type { BackendLotePayload } from '../types/lot';
import type {
  BackendMovimientoAnimalDto,
  BackendMovimientoAnimalPayload,
  TrasladoAnimalRanchoPayload,
  TrasladoLoteRanchoPayload,
  TrasladoRanchoResultDto
} from '../types/movement';
import type {
  BackendAlimentacionDto,
  BackendAlimentacionPayload
} from '../types/feeding';
import type {
  BackendEventoSanitarioDto,
  BackendEventoSanitarioPayload,
  BackendTratamientoDto,
  BackendTratamientoPayload
} from '../types/health';
import type {
  BackendRecordatorioDto,
  BackendRecordatorioPayload
} from '../types/alert';
import type { BackendArchivoMultimediaDto } from '../types/media';
import type {
  BackendRanchoPayload,
  ChangePasswordRequestDto,
  CreateUsuarioRanchoPayload,
  CreateUsuarioRequestDto,
  LoginRequestDto,
  LoginResponseDto,
  RegisterRequestDto,
  SessionInfoResponseDto,
  UpdateProfileRequestDto,
  UserConfig,
  UsuarioResponseDto
} from '../types/auth';

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
  AUTH_REGISTER: '/auth/register',
  AUTH_SESSION: '/auth/session',
  AUTH_LOGOUT: '/auth/logout',
  MEDIA: '/media',
  ANIMALES: '/animales',
  LOTES: '/lotes',
  RANCHOS: '/ranchos',
  MOVIMIENTOS: '/movimientos-animales',
  ALIMENTACION: '/alimentacion',
  EVENTOS_SANITARIOS: '/eventos-sanitarios',
  TRATAMIENTOS: '/tratamientos',
  RECORDATORIOS: '/recordatorios',
  USUARIOS: '/usuarios',
  USUARIO_RANCHOS: '/usuario-ranchos',
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

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Registra un manejador invocado cuando una petición autenticada recibe HTTP 401
 * desde el Backend (token expirado o revocado).
 */
export function registerUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * Clave de metadatos NO sensibles de sesión en localStorage (sin token JWT) para
 * mantener continuidad PWA offline/entre reinicios junto con la cookie HttpOnly del backend.
 */
export const PERSISTED_SESSION_META_KEY = 'farmbovi_session_meta';

/**
 * Obtiene el token JWT en memoria/sessionStorage (nunca en localStorage ni IndexedDB).
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

/**
 * Indica si existe una sesión autenticada vigente, ya sea mediante token Bearer en la
 * pestaña activa o mediante cookie HttpOnly persistente + metadatos vigentes en la PWA.
 */
export function hasActiveAuthSession(): boolean {
  if (readSessionAuthToken()) return true;
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const rawMeta = window.localStorage.getItem(PERSISTED_SESSION_META_KEY);
    if (!rawMeta) return false;
    const parsed = JSON.parse(rawMeta) as { idUsuario?: unknown; expiraEn?: unknown };
    if (typeof parsed.idUsuario !== 'string' || typeof parsed.expiraEn !== 'string') {
      return false;
    }
    const expiresMs = Date.parse(parsed.expiraEn);
    if (!Number.isNaN(expiresMs) && expiresMs <= Date.now()) {
      window.localStorage.removeItem(PERSISTED_SESSION_META_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
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

/**
 * Resuelve la URL pública de una imagen devuelta por el Backend (ej. `/api/media/uploads/...`)
 * para renderizarla directamente en etiquetas `<img src="..." />` tanto con proxy local como con
 * un `VITE_API_BASE_URL` en otro origen.
 */
export function resolveMediaUrl(urlOrPath?: string | null): string | null {
  if (!urlOrPath || !urlOrPath.trim()) return null;
  const trimmed = urlOrPath.trim();
  if (/^(https?:|blob:|data:)/i.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (/^https?:\/\//i.test(API_BASE_URL)) {
    const apiOrigin = new URL(API_BASE_URL).origin;
    if (normalized.startsWith('/api/')) {
      return `${apiOrigin}${normalized}`;
    }
    return `${API_BASE_URL}${normalized}`;
  }

  return normalized;
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
    if (
      response.status === 401 &&
      (Boolean(headers.Authorization) || hasActiveAuthSession()) &&
      path !== BACKEND_ROUTES.AUTH_LOGIN &&
      path !== BACKEND_ROUTES.AUTH_REGISTER &&
      path !== BACKEND_ROUTES.AUTH_LOGOUT
    ) {
      unauthorizedHandler?.();
    }
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

export const authApi = {
  async login(input: LoginRequestDto): Promise<LoginResponseDto> {
    const res = await apiRequest<LoginResponseDto>(BACKEND_ROUTES.AUTH_LOGIN, {
      method: 'POST',
      body: {
        correo: input.correo.trim().toLowerCase(),
        contrasena: input.contrasena
      }
    });
    return res.data;
  },

  async register(input: RegisterRequestDto): Promise<LoginResponseDto> {
    const res = await apiRequest<LoginResponseDto>(BACKEND_ROUTES.AUTH_REGISTER, {
      method: 'POST',
      body: {
        nombre: input.nombre.trim(),
        correo: input.correo.trim().toLowerCase(),
        contrasena: input.contrasena
      }
    });
    return res.data;
  },

  async getSession(): Promise<SessionInfoResponseDto> {
    const res = await apiRequest<SessionInfoResponseDto>(BACKEND_ROUTES.AUTH_SESSION, {
      method: 'GET'
    });
    return res.data;
  },

  async logout(): Promise<void> {
    await apiRequest<unknown>(BACKEND_ROUTES.AUTH_LOGOUT, {
      method: 'POST',
      allowEmptyResponse: true
    });
  }
};

export const usuariosApi = {
  async getMe(): Promise<UsuarioResponseDto> {
    const res = await apiRequest<UsuarioResponseDto>(`${BACKEND_ROUTES.USUARIOS}/me`, {
      method: 'GET'
    });
    return res.data;
  },

  async updateMe(input: UpdateProfileRequestDto): Promise<UsuarioResponseDto> {
    const res = await apiRequest<UsuarioResponseDto>(`${BACKEND_ROUTES.USUARIOS}/me`, {
      method: 'PUT',
      body: {
        nombre: input.nombre.trim(),
        correo: input.correo.trim().toLowerCase()
      }
    });
    return res.data;
  },

  async changeMyPassword(input: ChangePasswordRequestDto): Promise<{ mensaje?: string }> {
    const res = await apiRequest<{ mensaje?: string }>(
      `${BACKEND_ROUTES.USUARIOS}/me/contrasena`,
      {
        method: 'PUT',
        body: {
          contrasenaActual: input.contrasenaActual,
          nuevaContrasena: input.nuevaContrasena
        }
      }
    );
    return res.data;
  },

  async updateMyConfig(input: UserConfig): Promise<UsuarioResponseDto> {
    const res = await apiRequest<UsuarioResponseDto>(
      `${BACKEND_ROUTES.USUARIOS}/me/configuracion`,
      {
        method: 'PUT',
        body: input
      }
    );
    return res.data;
  },

  async uploadMyPhoto(file: File): Promise<UsuarioResponseDto> {
    const formData = new FormData();
    formData.append('archivo', file);
    const res = await apiRequest<UsuarioResponseDto>(`${BACKEND_ROUTES.USUARIOS}/me/foto`, {
      method: 'POST',
      body: formData
    });
    return res.data;
  },

  async deleteMyPhoto(): Promise<UsuarioResponseDto> {
    const res = await apiRequest<UsuarioResponseDto>(`${BACKEND_ROUTES.USUARIOS}/me/foto`, {
      method: 'DELETE'
    });
    return res.data;
  },

  async create(input: CreateUsuarioRequestDto): Promise<UsuarioResponseDto> {
    const res = await apiRequest<UsuarioResponseDto>(BACKEND_ROUTES.USUARIOS, {
      method: 'POST',
      body: {
        idUsuario: input.idUsuario,
        nombre: input.nombre.trim(),
        correo: input.correo.trim().toLowerCase(),
        contrasena: input.contrasena,
        estado: input.estado.trim() || 'Activo'
      }
    });
    return res.data;
  },

  async getById(id: string): Promise<UsuarioResponseDto> {
    const res = await apiRequest<UsuarioResponseDto>(`${BACKEND_ROUTES.USUARIOS}/${id}`, {
      method: 'GET'
    });
    return res.data;
  }
};

export const usuarioRanchosApi = {
  async create(input: CreateUsuarioRanchoPayload): Promise<unknown> {
    const res = await apiRequest<unknown>(BACKEND_ROUTES.USUARIO_RANCHOS, {
      method: 'POST',
      body: input
    });
    return res.data;
  }
};

export const ranchesApi = {
  async list(incluirEliminados = false): Promise<BackendRanchoDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendRanchoDto[]>(`${BACKEND_ROUTES.RANCHOS}${query}`, {
      method: 'GET'
    });
    return Array.isArray(res.data) ? res.data : [];
  },

  async create(input: BackendRanchoPayload): Promise<BackendRanchoDto> {
    const res = await apiRequest<BackendRanchoDto>(BACKEND_ROUTES.RANCHOS, {
      method: 'POST',
      body: {
        idRancho: input.idRancho,
        nombre: input.nombre.trim(),
        ubicacionGeneral: input.ubicacionGeneral.trim(),
        estado: input.estado.trim() || 'Activo'
      }
    });
    return res.data;
  },

  async update(id: string, input: BackendRanchoPayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.RANCHOS}/${id}`, {
      method: 'PUT',
      body: {
        idRancho: id,
        nombre: input.nombre.trim(),
        ubicacionGeneral: input.ubicacionGeneral.trim(),
        estado: input.estado.trim() || 'Activo'
      },
      allowEmptyResponse: true
    });
  }
};

export const movementsApi = {
  async list(incluirEliminados = false): Promise<BackendMovimientoAnimalDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendMovimientoAnimalDto[]>(
      `${BACKEND_ROUTES.MOVIMIENTOS}${query}`,
      { method: 'GET' }
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: string): Promise<BackendMovimientoAnimalDto> {
    const res = await apiRequest<BackendMovimientoAnimalDto>(
      `${BACKEND_ROUTES.MOVIMIENTOS}/${id}`,
      { method: 'GET' }
    );
    return res.data;
  },

  async create(input: BackendMovimientoAnimalPayload): Promise<BackendMovimientoAnimalDto> {
    const res = await apiRequest<BackendMovimientoAnimalDto>(BACKEND_ROUTES.MOVIMIENTOS, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: string, input: BackendMovimientoAnimalPayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.MOVIMIENTOS}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.MOVIMIENTOS}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  },

  async transferAnimalBetweenRanches(
    input: TrasladoAnimalRanchoPayload
  ): Promise<TrasladoRanchoResultDto> {
    const res = await apiRequest<TrasladoRanchoResultDto>(
      `${BACKEND_ROUTES.MOVIMIENTOS}/traslado-rancho/animal`,
      {
        method: 'POST',
        body: input
      }
    );
    return res.data;
  },

  async transferLotBetweenRanches(
    input: TrasladoLoteRanchoPayload
  ): Promise<TrasladoRanchoResultDto> {
    const res = await apiRequest<TrasladoRanchoResultDto>(
      `${BACKEND_ROUTES.MOVIMIENTOS}/traslado-rancho/lote`,
      {
        method: 'POST',
        body: input
      }
    );
    return res.data;
  }
};

export const feedingApi = {
  async list(incluirEliminados = false): Promise<BackendAlimentacionDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendAlimentacionDto[]>(
      `${BACKEND_ROUTES.ALIMENTACION}${query}`,
      { method: 'GET' }
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: string): Promise<BackendAlimentacionDto> {
    const res = await apiRequest<BackendAlimentacionDto>(
      `${BACKEND_ROUTES.ALIMENTACION}/${id}`,
      { method: 'GET' }
    );
    return res.data;
  },

  async create(input: BackendAlimentacionPayload): Promise<BackendAlimentacionDto> {
    const res = await apiRequest<BackendAlimentacionDto>(BACKEND_ROUTES.ALIMENTACION, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: string, input: BackendAlimentacionPayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.ALIMENTACION}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.ALIMENTACION}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};

export const healthEventsApi = {
  async list(incluirEliminados = false): Promise<BackendEventoSanitarioDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendEventoSanitarioDto[]>(
      `${BACKEND_ROUTES.EVENTOS_SANITARIOS}${query}`,
      { method: 'GET' }
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: string): Promise<BackendEventoSanitarioDto> {
    const res = await apiRequest<BackendEventoSanitarioDto>(
      `${BACKEND_ROUTES.EVENTOS_SANITARIOS}/${id}`,
      { method: 'GET' }
    );
    return res.data;
  },

  async create(input: BackendEventoSanitarioPayload): Promise<BackendEventoSanitarioDto> {
    const res = await apiRequest<BackendEventoSanitarioDto>(BACKEND_ROUTES.EVENTOS_SANITARIOS, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: string, input: BackendEventoSanitarioPayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.EVENTOS_SANITARIOS}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.EVENTOS_SANITARIOS}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};

export const treatmentsApi = {
  async list(incluirEliminados = false): Promise<BackendTratamientoDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendTratamientoDto[]>(
      `${BACKEND_ROUTES.TRATAMIENTOS}${query}`,
      { method: 'GET' }
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: string): Promise<BackendTratamientoDto> {
    const res = await apiRequest<BackendTratamientoDto>(
      `${BACKEND_ROUTES.TRATAMIENTOS}/${id}`,
      { method: 'GET' }
    );
    return res.data;
  },

  async create(input: BackendTratamientoPayload): Promise<BackendTratamientoDto> {
    const res = await apiRequest<BackendTratamientoDto>(BACKEND_ROUTES.TRATAMIENTOS, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: string, input: BackendTratamientoPayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.TRATAMIENTOS}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.TRATAMIENTOS}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};

export const remindersApi = {
  async list(incluirEliminados = false): Promise<BackendRecordatorioDto[]> {
    const query = incluirEliminados ? '?incluirEliminados=true' : '';
    const res = await apiRequest<BackendRecordatorioDto[]>(
      `${BACKEND_ROUTES.RECORDATORIOS}${query}`,
      { method: 'GET' }
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  async getById(id: string): Promise<BackendRecordatorioDto> {
    const res = await apiRequest<BackendRecordatorioDto>(
      `${BACKEND_ROUTES.RECORDATORIOS}/${id}`,
      { method: 'GET' }
    );
    return res.data;
  },

  async create(input: BackendRecordatorioPayload): Promise<BackendRecordatorioDto> {
    const res = await apiRequest<BackendRecordatorioDto>(BACKEND_ROUTES.RECORDATORIOS, {
      method: 'POST',
      body: input
    });
    return res.data;
  },

  async update(id: string, input: BackendRecordatorioPayload): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.RECORDATORIOS}/${id}`, {
      method: 'PUT',
      body: input,
      allowEmptyResponse: true
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.RECORDATORIOS}/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};

export const mediaApi = {
  async list(options?: {
    idAnimal?: string;
    incluirEliminados?: boolean;
  }): Promise<BackendArchivoMultimediaDto[]> {
    const params = new URLSearchParams();
    if (options?.idAnimal) params.set('idAnimal', options.idAnimal);
    if (options?.incluirEliminados) params.set('incluirEliminados', 'true');
    const qs = params.toString();
    const res = await apiRequest<BackendArchivoMultimediaDto[]>(
      `${BACKEND_ROUTES.MEDIA}/archivos${qs ? `?${qs}` : ''}`,
      { method: 'GET' }
    );
    return Array.isArray(res.data) ? res.data : [];
  },

  async upload(formData: FormData): Promise<BackendArchivoMultimediaDto> {
    const res = await apiRequest<BackendArchivoMultimediaDto>(`${BACKEND_ROUTES.MEDIA}/archivos`, {
      method: 'POST',
      body: formData,
      timeoutMs: 30000
    });
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await apiRequest<unknown>(`${BACKEND_ROUTES.MEDIA}/archivos/${id}`, {
      method: 'DELETE',
      allowEmptyResponse: true
    });
  }
};
