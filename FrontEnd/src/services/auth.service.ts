import {
  ApiError,
  authApi,
  ranchesApi,
  registerUnauthorizedHandler,
  usuariosApi
} from '../lib/api';
import { db } from '../lib/database/db';
import type { LocalRanch } from '../lib/database/schema';
import type {
  AuthSession,
  LoginRanchoDto,
  RegisterUserInput,
  UsuarioResponseDto
} from '../types/auth';
import { SyncScheduler } from './sync/sync-scheduler';

const TOKEN_STORAGE_KEY = 'farmbovi_access_token';
const SESSION_STORAGE_KEY = 'farmbovi_session_user';

type AuthListener = () => void;
const listeners = new Set<AuthListener>();

function readStoredSession(): AuthSession | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const rawUser = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!token || !rawUser) return null;
    const parsed = JSON.parse(rawUser) as Partial<AuthSession>;
    if (
      typeof parsed.idUsuario !== 'string' ||
      typeof parsed.nombre !== 'string' ||
      typeof parsed.expiraEn !== 'string'
    ) {
      return null;
    }
    const expiresMs = Date.parse(parsed.expiraEn);
    if (!Number.isNaN(expiresMs) && expiresMs <= Date.now()) {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return {
      token,
      expiraEn: parsed.expiraEn,
      idUsuario: parsed.idUsuario,
      nombre: parsed.nombre,
      correo: typeof parsed.correo === 'string' ? parsed.correo : '',
      ranchos: Array.isArray(parsed.ranchos) ? parsed.ranchos : []
    };
  } catch {
    return null;
  }
}

export function isSessionExpired(session: AuthSession | null): boolean {
  if (!session || !session.token) return true;
  const expiresMs = Date.parse(session.expiraEn);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= Date.now();
}

function persistSessionToStorage(next: AuthSession | null): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    if (next) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, next.token);
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.sessionStorage.removeItem('auth_token');
    }
  } catch {
    // Ignorar si sessionStorage no está disponible
  }
}

let currentSession: AuthSession | null = readStoredSession();

function emit(next: AuthSession | null): void {
  currentSession = next;
  persistSessionToStorage(next);
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error en suscriptor de autenticación:', err);
    }
  }
}

async function hydrateRanchesToIndexedDb(ranchos: LoginRanchoDto[]): Promise<void> {
  if (ranchos.length === 0) return;
  const now = new Date().toISOString();
  await db.transaction('rw', [db.ranches], async () => {
    for (const r of ranchos) {
      const existing = await db.ranches.get(r.idRancho);
      const local: LocalRanch = {
        id: r.idRancho,
        remoteId: r.idRancho,
        ranchId: r.idRancho,
        nombre: r.nombre,
        ubicacionGeneral: existing?.ubicacionGeneral || 'Registrado en servidor',
        estado: existing?.estado || 'Activo',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: existing?.serverVersion ?? 1,
        deletedAt: null
      };
      await db.ranches.put(local);
    }
  });
}

export function getUserInitials(nombre?: string | null): string {
  if (!nombre || !nombre.trim()) return 'FB';
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export interface LoginFlowResult {
  session: AuthSession;
  hasRanch: boolean;
}

export interface RegisterUserResult {
  ok: boolean;
  requiresAdminAuth?: boolean;
  message: string;
  user?: UsuarioResponseDto;
  session?: AuthSession;
  hasRanch?: boolean;
}

export const AuthService = {
  subscribe(listener: AuthListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): AuthSession | null {
    return currentSession;
  },

  reloadFromSessionStorage(): AuthSession | null {
    const next = readStoredSession();
    emit(next);
    return next;
  },

  appendRanchToSession(ranch: LoginRanchoDto): void {
    if (!currentSession) return;
    const exists = currentSession.ranchos.some((r) => r.idRancho === ranch.idRancho);
    const nextRanchos = exists
      ? currentSession.ranchos.map((r) => (r.idRancho === ranch.idRancho ? ranch : r))
      : [...currentSession.ranchos, ranch];
    emit({ ...currentSession, ranchos: nextRanchos });
  },

  /**
   * Consulta directamente al Backend (`GET /api/ranchos`) para confirmar si el usuario
   * autenticado ya cuenta con al menos un rancho activo.
   */
  async verifyHasRanchFromBackend(): Promise<boolean> {
    if (!currentSession?.token) return false;
    if (isSessionExpired(currentSession)) {
      this.logout();
      return false;
    }
    try {
      const fullRanches = await ranchesApi.list(false);
      const now = new Date().toISOString();
      if (fullRanches.length > 0) {
        await db.transaction('rw', [db.ranches], async () => {
          for (const r of fullRanches) {
            await db.ranches.put({
              id: r.idRancho,
              remoteId: r.idRancho,
              ranchId: r.idRancho,
              nombre: r.nombre,
              ubicacionGeneral: r.ubicacionGeneral,
              estado: r.estado,
              createdAt: r.creadoEn || now,
              updatedAt: now,
              syncStatus: 'synced',
              serverVersion: r.versionRegistro ?? 1,
              deletedAt: r.eliminadoEn ?? null
            });
          }
        });
      }

      // Si durante la llamada se invalidó la sesión (ej. HTTP 401), no sobreescribir
      if (!currentSession) return false;

      const roleByRanch = new Map(currentSession.ranchos.map((r) => [r.idRancho, r.rol]));
      const syncedList: LoginRanchoDto[] = fullRanches.map((r) => ({
        idRancho: r.idRancho,
        nombre: r.nombre,
        rol: roleByRanch.get(r.idRancho) || 'Admin'
      }));
      emit({ ...currentSession, ranchos: syncedList });
      return fullRanches.length > 0;
    } catch {
      if (!currentSession) return false;
      // Si GET /api/ranchos falla temporalmente, emitir la sesión recibida de POST /api/auth/login
      emit(currentSession);
      return currentSession.ranchos.length > 0;
    }
  },

  /**
   * Inicia sesión contra `POST /api/auth/login` delegando todas las validaciones al Backend
   * y comprueba en el servidor si el usuario ya tiene un rancho registrado antes de emitir la sesión.
   */
  async login(correo: string, contrasena: string): Promise<LoginFlowResult> {
    const cleanEmail = correo.trim().toLowerCase();
    const res = await authApi.login({ correo: cleanEmail, contrasena });
    const session: AuthSession = {
      token: res.token,
      expiraEn: res.expiraEn,
      idUsuario: res.idUsuario,
      nombre: res.nombre,
      correo: cleanEmail,
      ranchos: Array.isArray(res.ranchos) ? res.ranchos : []
    };

    // Guardar el JWT para que GET /api/ranchos incluya Bearer sin disparar redirecciones prematuras
    currentSession = session;
    persistSessionToStorage(session);
    await hydrateRanchesToIndexedDb(session.ranchos);

    const hasRanch = await this.verifyHasRanchFromBackend();
    void SyncScheduler.refreshState(true);

    return {
      session: currentSession ?? session,
      hasRanch
    };
  },

  /**
   * Paso 1 de registro: envía la cuenta directamente a `POST /api/usuarios` delegando
   * todas las validaciones al Backend. Al crearse correctamente, inicia sesión con la
   * nueva cuenta en `POST /api/auth/login` para continuar al Paso 2 (Registro de Rancho).
   */
  async registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
    const cleanEmail = input.correo.trim().toLowerCase();
    try {
      const createdUser = await usuariosApi.create({
        nombre: input.nombre.trim(),
        correo: cleanEmail,
        contrasena: input.contrasena,
        estado: input.estado?.trim() || 'Activo'
      });

      // Autenticar la cuenta recién creada contra el Backend para obtener su JWT y comprobar ranchos
      try {
        const loginResult = await this.login(cleanEmail, input.contrasena);
        return {
          ok: true,
          user: createdUser,
          session: loginResult.session,
          hasRanch: loginResult.hasRanch,
          message: `Cuenta creada (${createdUser.correo}). Ahora registra tu rancho para comenzar.`
        };
      } catch {
        return {
          ok: true,
          user: createdUser,
          hasRanch: false,
          message: `Cuenta creada (${createdUser.correo}). Inicia sesión para registrar tu rancho.`
        };
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return {
          ok: false,
          requiresAdminAuth: true,
          message: err.message
        };
      }
      throw err;
    }
  },

  logout(): void {
    emit(null);
    void SyncScheduler.refreshState();
  }
};

// Si el Backend rechaza cualquier petición autenticada con 401 (JWT expirado/inválido),
// limpiar sesión local para que las rutas protegidas redirijan automáticamente a /login.
registerUnauthorizedHandler(() => {
  if (currentSession) {
    AuthService.logout();
  }
});
