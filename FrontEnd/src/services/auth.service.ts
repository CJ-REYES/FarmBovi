import {
  ApiError,
  PERSISTED_SESSION_META_KEY,
  authApi,
  ranchesApi,
  registerUnauthorizedHandler,
  usuariosApi
} from '../lib/api';
import { db } from '../lib/database/db';
import type { LocalRanch } from '../lib/database/schema';
import {
  DEFAULT_USER_CONFIG,
  type AuthSession,
  type ChangePasswordRequestDto,
  type LoginRanchoDto,
  type LoginResponseDto,
  type RegisterUserInput,
  type SessionInfoResponseDto,
  type UpdateProfileRequestDto,
  type UserConfig,
  type UsuarioResponseDto
} from '../types/auth';
import { SyncCrossTabLock } from './sync/sync-lock';
import { SyncScheduler } from './sync/sync-scheduler';

const TOKEN_STORAGE_KEY = 'farmbovi_access_token';
const SESSION_STORAGE_KEY = 'farmbovi_session_user';
const LAST_ACTIVE_USER_KEY = 'farmbovi_last_user_id';
const MAX_TIMEOUT_MS = 2_147_483_647;

interface PersistedSessionMeta {
  expiraEn: string;
  idUsuario: string;
  nombre: string;
  correo: string;
  ranchos: LoginRanchoDto[];
  fotoPerfilUrl: string | null;
  configuracion: UserConfig;
}

type AuthListener = () => void;
const listeners = new Set<AuthListener>();
let expirationTimerId: ReturnType<typeof setTimeout> | null = null;
let bootstrapInFlight: Promise<AuthSession | null> | null = null;

function normalizeUserConfig(raw?: Partial<UserConfig> | null): UserConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_USER_CONFIG };
  return {
    unidadPeso: raw.unidadPeso === 'lb' ? 'lb' : 'kg',
    diasAvisoAlertas:
      typeof raw.diasAvisoAlertas === 'number' &&
      raw.diasAvisoAlertas >= 1 &&
      raw.diasAvisoAlertas <= 90
        ? Math.round(raw.diasAvisoAlertas)
        : DEFAULT_USER_CONFIG.diasAvisoAlertas,
    sincronizacionAutomatica:
      typeof raw.sincronizacionAutomatica === 'boolean'
        ? raw.sincronizacionAutomatica
        : DEFAULT_USER_CONFIG.sincronizacionAutomatica,
    formatoFecha: raw.formatoFecha === 'yyyy-MM-dd' ? 'yyyy-MM-dd' : 'dd/MM/yyyy',
    ranchoPredeterminadoId:
      typeof raw.ranchoPredeterminadoId === 'string' && raw.ranchoPredeterminadoId.trim()
        ? raw.ranchoPredeterminadoId
        : null
  };
}

function clearPersistedMeta(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(PERSISTED_SESSION_META_KEY);
  } catch {
    // Ignorar si localStorage no está disponible
  }
}

function readPersistedMeta(): PersistedSessionMeta | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const rawMeta = window.localStorage.getItem(PERSISTED_SESSION_META_KEY);
    if (!rawMeta) return null;
    const parsed = JSON.parse(rawMeta) as Partial<PersistedSessionMeta>;
    if (
      typeof parsed.idUsuario !== 'string' ||
      typeof parsed.nombre !== 'string' ||
      typeof parsed.expiraEn !== 'string'
    ) {
      return null;
    }
    const expiresMs = Date.parse(parsed.expiraEn);
    if (!Number.isNaN(expiresMs) && expiresMs <= Date.now()) {
      clearPersistedMeta();
      return null;
    }
    return {
      expiraEn: parsed.expiraEn,
      idUsuario: parsed.idUsuario,
      nombre: parsed.nombre,
      correo: typeof parsed.correo === 'string' ? parsed.correo : '',
      ranchos: Array.isArray(parsed.ranchos) ? parsed.ranchos : [],
      fotoPerfilUrl: typeof parsed.fotoPerfilUrl === 'string' ? parsed.fotoPerfilUrl : null,
      configuracion: normalizeUserConfig(parsed.configuracion)
    };
  } catch {
    return null;
  }
}

function readStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  // 1. Sesión activa en pestaña actual (Bearer + HttpOnly cookie)
  if (window.sessionStorage) {
    try {
      const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
      const rawUser = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (token && rawUser) {
        const parsed = JSON.parse(rawUser) as Partial<AuthSession>;
        if (
          typeof parsed.idUsuario === 'string' &&
          typeof parsed.nombre === 'string' &&
          typeof parsed.expiraEn === 'string'
        ) {
          const expiresMs = Date.parse(parsed.expiraEn);
          if (!Number.isNaN(expiresMs) && expiresMs <= Date.now()) {
            window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
            window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
            clearPersistedMeta();
            return null;
          }
          return {
            token,
            authMode: 'bearer',
            expiraEn: parsed.expiraEn,
            idUsuario: parsed.idUsuario,
            nombre: parsed.nombre,
            correo: typeof parsed.correo === 'string' ? parsed.correo : '',
            ranchos: Array.isArray(parsed.ranchos) ? parsed.ranchos : [],
            fotoPerfilUrl: typeof parsed.fotoPerfilUrl === 'string' ? parsed.fotoPerfilUrl : null,
            configuracion: normalizeUserConfig(parsed.configuracion)
          };
        }
      }
    } catch {
      // Continuar con respaldo de metadatos persistentes
    }
  }

  // 2. Sesión persistida al reabrir la PWA / nueva pestaña (cookie HttpOnly + metadatos NO sensibles)
  const meta = readPersistedMeta();
  if (meta) {
    return {
      token: '',
      authMode: 'cookie',
      ...meta
    };
  }

  return null;
}

export function isSessionExpired(session: AuthSession | null): boolean {
  if (!session) return true;
  if (!session.token && session.authMode !== 'cookie') return true;
  const expiresMs = Date.parse(session.expiraEn);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= Date.now();
}

function clearExpirationTimer(): void {
  if (expirationTimerId !== null) {
    clearTimeout(expirationTimerId);
    expirationTimerId = null;
  }
}

function scheduleExpirationTimer(next: AuthSession | null): void {
  clearExpirationTimer();
  if (!next || typeof window === 'undefined') return;
  const expiresMs = Date.parse(next.expiraEn);
  if (Number.isNaN(expiresMs)) return;

  const remainingMs = expiresMs - Date.now();
  if (remainingMs <= 0) {
    AuthService.logout({ skipServerCall: true });
    return;
  }

  const delay = Math.min(remainingMs + 250, MAX_TIMEOUT_MS);
  expirationTimerId = setTimeout(() => {
    expirationTimerId = null;
    if (currentSession && isSessionExpired(currentSession)) {
      AuthService.logout({ skipServerCall: true });
    } else if (currentSession) {
      scheduleExpirationTimer(currentSession);
    }
  }, delay);
}

function persistSessionToStorage(next: AuthSession | null): void {
  if (typeof window === 'undefined') return;

  if (window.sessionStorage) {
    try {
      if (next && next.token) {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, next.token);
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      } else if (!next) {
        window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        window.sessionStorage.removeItem('auth_token');
      }
    } catch {
      // Ignorar si sessionStorage no está disponible
    }
  }

  // Persistir ÚNICAMENTE metadatos no sensibles en localStorage (nunca el JWT crudo).
  // El JWT real persiste en cookie HttpOnly manejada por el navegador/backend hasta ExpiraEn.
  if (window.localStorage) {
    try {
      if (next) {
        const meta: PersistedSessionMeta = {
          expiraEn: next.expiraEn,
          idUsuario: next.idUsuario,
          nombre: next.nombre,
          correo: next.correo,
          ranchos: next.ranchos,
          fotoPerfilUrl: next.fotoPerfilUrl ?? null,
          configuracion: normalizeUserConfig(next.configuracion)
        };
        window.localStorage.setItem(PERSISTED_SESSION_META_KEY, JSON.stringify(meta));
      } else {
        window.localStorage.removeItem(PERSISTED_SESSION_META_KEY);
      }
    } catch {
      // Ignorar si localStorage no está disponible
    }
  }
}

let currentSession: AuthSession | null = readStoredSession();
scheduleExpirationTimer(currentSession);

function emit(next: AuthSession | null): void {
  currentSession = next;
  persistSessionToStorage(next);
  scheduleExpirationTimer(next);
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error en suscriptor de autenticación:', err);
    }
  }
}

function buildSessionFromLoginResponse(
  res: LoginResponseDto,
  fallbackEmail: string
): AuthSession {
  return {
    token: res.token,
    authMode: 'bearer',
    expiraEn: res.expiraEn,
    idUsuario: res.idUsuario,
    nombre: res.nombre,
    correo: (res.correo || fallbackEmail).trim().toLowerCase(),
    ranchos: Array.isArray(res.ranchos) ? res.ranchos : [],
    fotoPerfilUrl: typeof res.fotoPerfilUrl === 'string' ? res.fotoPerfilUrl : null,
    configuracion: normalizeUserConfig(res.configuracion)
  };
}

function buildSessionFromServerInfo(
  info: SessionInfoResponseDto,
  existingToken: string
): AuthSession {
  return {
    token: existingToken,
    authMode: existingToken ? 'bearer' : 'cookie',
    expiraEn: info.expiraEn,
    idUsuario: info.idUsuario,
    nombre: info.nombre,
    correo: (info.correo || '').trim().toLowerCase(),
    ranchos: Array.isArray(info.ranchos) ? info.ranchos : [],
    fotoPerfilUrl: typeof info.fotoPerfilUrl === 'string' ? info.fotoPerfilUrl : null,
    configuracion: normalizeUserConfig(info.configuracion)
  };
}

function mergeProfileIntoSession(profile: UsuarioResponseDto): AuthSession | null {
  if (!currentSession) return null;
  const updated: AuthSession = {
    ...currentSession,
    nombre: profile.nombre,
    correo: profile.correo,
    fotoPerfilUrl: typeof profile.fotoPerfilUrl === 'string' ? profile.fotoPerfilUrl : null,
    configuracion: normalizeUserConfig(profile.configuracion)
  };
  emit(updated);
  return updated;
}

/**
 * Aísla la caché local de IndexedDB para el usuario autenticado actual:
 * - Elimina ranchos `synced` que ya no pertenecen a los ranchos autorizados del usuario
 *   (evita arrastrar ranchos de una cuenta anterior en el mismo navegador y disparar 403 en Pull).
 * - Si cambió de cuenta o se purgaron ranchos no autorizados, reinicia checkpoints de Pull
 *   y purga registros `synced` en caché de esos ranchos ajenos (conservando datos locales pendientes).
 */
async function reconcileLocalCacheForUser(
  userId: string,
  authorizedRanches: readonly LoginRanchoDto[]
): Promise<void> {
  const authorizedIds = new Set(authorizedRanches.map((r) => r.idRancho));
  let switchedAccount = false;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const previousUserId = window.localStorage.getItem(LAST_ACTIVE_USER_KEY);
      if (previousUserId && previousUserId !== userId) {
        switchedAccount = true;
      }
      window.localStorage.setItem(LAST_ACTIVE_USER_KEY, userId);
    } catch {
      // Ignorar si localStorage no está disponible
    }
  }

  await db.transaction(
    'rw',
    [
      db.ranches,
      db.lots,
      db.cattle,
      db.weighings,
      db.healthRecords,
      db.treatments,
      db.feedingRecords,
      db.reproductionRecords,
      db.movements,
      db.genealogy,
      db.alerts,
      db.media,
      db.weighingAnalysisJobs,
      db.syncCheckpoints,
      db.syncMetadata,
      db.outbox
    ],
    async () => {
      const cachedRanches = await db.ranches.toArray();
      const unauthorizedRanchIds = cachedRanches
        .filter((r) => r.syncStatus === 'synced' && !authorizedIds.has(r.id))
        .map((r) => r.id);

      if (unauthorizedRanchIds.length > 0) {
        await db.ranches.bulkDelete(unauthorizedRanchIds);
      }

      if (switchedAccount || unauthorizedRanchIds.length > 0) {
        await db.syncCheckpoints.clear();
        await db.syncMetadata.clear();
        SyncCrossTabLock.forceReleaseLocalLease();

        const unauthorizedSet = new Set(unauthorizedRanchIds);
        const cattleRanchLookup = new Map<string, string | undefined>();
        const allCattle = await db.cattle.toArray();
        for (const animal of allCattle) {
          cattleRanchLookup.set(animal.id, animal.ranchId);
        }

        const shouldPruneRow = (row: {
          syncStatus: string;
          ranchId?: string | null;
          cattleId?: string | null;
        }): boolean => {
          // Nunca perder datos locales pendientes, en conflicto o con error sin confirmar
          if (row.syncStatus !== 'synced') return false;
          const effectiveRanchId =
            row.ranchId || (row.cattleId ? cattleRanchLookup.get(row.cattleId) : undefined);
          return switchedAccount
            ? !effectiveRanchId || !authorizedIds.has(effectiveRanchId)
            : Boolean(effectiveRanchId && unauthorizedSet.has(effectiveRanchId));
        };

        const [
          staleLots,
          staleCattle,
          staleWeighings,
          staleHealth,
          staleTreatments,
          staleFeeding,
          staleReproduction,
          staleMovements,
          staleGenealogy,
          staleAlerts,
          staleMedia,
          staleJobs
        ] = await Promise.all([
          db.lots.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.cattle.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.weighings.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.healthRecords.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.treatments.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.feedingRecords.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.reproductionRecords.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.movements.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.genealogy.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.alerts.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.media.filter((x) => shouldPruneRow(x)).primaryKeys(),
          db.weighingAnalysisJobs
            .filter(
              (j) =>
                (j.estado === 'confirmado' || j.estado === 'cancelado') &&
                (switchedAccount
                  ? !j.ranchId || !authorizedIds.has(j.ranchId)
                  : Boolean(j.ranchId && unauthorizedSet.has(j.ranchId)))
            )
            .primaryKeys()
        ]);

        if (staleLots.length > 0) await db.lots.bulkDelete(staleLots);
        if (staleCattle.length > 0) await db.cattle.bulkDelete(staleCattle);
        if (staleWeighings.length > 0) await db.weighings.bulkDelete(staleWeighings);
        if (staleHealth.length > 0) await db.healthRecords.bulkDelete(staleHealth);
        if (staleTreatments.length > 0) await db.treatments.bulkDelete(staleTreatments);
        if (staleFeeding.length > 0) await db.feedingRecords.bulkDelete(staleFeeding);
        if (staleReproduction.length > 0) await db.reproductionRecords.bulkDelete(staleReproduction);
        if (staleMovements.length > 0) await db.movements.bulkDelete(staleMovements);
        if (staleGenealogy.length > 0) await db.genealogy.bulkDelete(staleGenealogy);
        if (staleAlerts.length > 0) await db.alerts.bulkDelete(staleAlerts);
        if (staleMedia.length > 0) await db.media.bulkDelete(staleMedia);
        if (staleJobs.length > 0) await db.weighingAnalysisJobs.bulkDelete(staleJobs);

        // Al cambiar de cuenta, limpiar solo el historial de operaciones ya confirmadas;
        // conservar intactas las pendientes/fallidas/en conflicto para jamás perder datos.
        if (switchedAccount) {
          const confirmedOps = await db.outbox
            .where('estado')
            .equals('confirmado')
            .primaryKeys();
          if (confirmedOps.length > 0) {
            await db.outbox.bulkDelete(confirmedOps);
          }
        }
      }
    }
  );
}

async function hydrateRanchesToIndexedDb(
  ranchos: LoginRanchoDto[],
  userId?: string
): Promise<void> {
  if (userId) {
    await reconcileLocalCacheForUser(userId, ranchos);
  }
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
  correo?: string;
  message: string;
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

  /**
   * Hidrata y valida la sesión persistida al arrancar la PWA:
   * - Si el usuario reabre la app offline, conserva la sesión local vigente hasta `expiraEn`.
   * - Si está online, verifica `GET /api/auth/session` usando la cookie HttpOnly (o Bearer)
   *   para refrescar ranchos, foto y expiración real, cerrando sesión si el backend devuelve 401.
   */
  async bootstrapSession(): Promise<AuthSession | null> {
    if (bootstrapInFlight) {
      return await bootstrapInFlight;
    }

    bootstrapInFlight = (async () => {
      const local = readStoredSession();
      if (!local) {
        if (currentSession !== null) emit(null);
        return null;
      }

      if (isSessionExpired(local)) {
        this.logout({ skipServerCall: true });
        return null;
      }

      if (currentSession === null || currentSession.authMode !== local.authMode || currentSession.token !== local.token) {
        emit(local);
      } else {
        scheduleExpirationTimer(currentSession);
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return currentSession;
      }

      try {
        const info = await authApi.getSession();
        const refreshed = buildSessionFromServerInfo(info, local.token);
        emit(refreshed);
        await hydrateRanchesToIndexedDb(refreshed.ranchos, refreshed.idUsuario);
        void SyncScheduler.refreshState(true);
        return refreshed;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          this.logout({ skipServerCall: true });
          return null;
        }
        // Error de red/servidor temporal: mantener sesión offline-first hasta expiración
        return currentSession;
      }
    })().finally(() => {
      bootstrapInFlight = null;
    });

    return await bootstrapInFlight;
  },

  /**
   * Sincroniza inicio/cierre de sesión entre múltiples pestañas abiertas de la PWA.
   */
  startLifecycleListeners(): () => void {
    if (typeof window === 'undefined') return () => undefined;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== PERSISTED_SESSION_META_KEY) return;
      if (event.newValue === null) {
        // Otra pestaña cerró sesión
        if (currentSession !== null) {
          emit(null);
          void SyncScheduler.refreshState();
        }
      } else {
        const refreshed = readStoredSession();
        emit(refreshed);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && currentSession) {
        if (isSessionExpired(currentSession)) {
          this.logout({ skipServerCall: true });
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  },

  appendRanchToSession(ranch: LoginRanchoDto): void {
    if (!currentSession) return;
    const exists = currentSession.ranchos.some((r) => r.idRancho === ranch.idRancho);
    const nextRanchos = exists
      ? currentSession.ranchos.map((r) => (r.idRancho === ranch.idRancho ? ranch : r))
      : [...currentSession.ranchos, ranch];
    emit({ ...currentSession, ranchos: nextRanchos });
  },

  async verifyHasRanchFromBackend(): Promise<boolean> {
    if (!currentSession || (!currentSession.token && currentSession.authMode !== 'cookie')) {
      return false;
    }
    if (isSessionExpired(currentSession)) {
      this.logout({ skipServerCall: true });
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

      if (!currentSession) return false;

      const roleByRanch = new Map(currentSession.ranchos.map((r) => [r.idRancho, r.rol]));
      const syncedList: LoginRanchoDto[] = fullRanches.map((r) => ({
        idRancho: r.idRancho,
        nombre: r.nombre,
        rol: roleByRanch.get(r.idRancho) || 'Admin'
      }));
      await reconcileLocalCacheForUser(currentSession.idUsuario, syncedList);
      emit({ ...currentSession, ranchos: syncedList });
      return fullRanches.length > 0;
    } catch {
      if (!currentSession) return false;
      emit(currentSession);
      return currentSession.ranchos.length > 0;
    }
  },

  /**
   * Inicia sesión contra `POST /api/auth/login` delegando todas las validaciones al Backend.
   */
  async login(correo: string, contrasena: string): Promise<LoginFlowResult> {
    const cleanEmail = correo.trim().toLowerCase();
    const res = await authApi.login({ correo: cleanEmail, contrasena });
    const session = buildSessionFromLoginResponse(res, cleanEmail);

    currentSession = session;
    persistSessionToStorage(session);
    await hydrateRanchesToIndexedDb(session.ranchos, session.idUsuario);

    const hasRanch = await this.verifyHasRanchFromBackend();
    void SyncScheduler.refreshState(true);
    if (
      SyncScheduler.isStarted() &&
      (typeof navigator === 'undefined' || navigator.onLine)
    ) {
      void SyncScheduler.triggerSync('startup');
    }

    return {
      session: currentSession ?? session,
      hasRanch
    };
  },

  /**
   * Registro público de cuenta contra `POST /api/auth/register` (`[AllowAnonymous]` en Backend).
   * Crea el usuario sin iniciar sesión automáticamente para que el usuario ingrese desde Iniciar Sesión.
   */
  async registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
    const cleanEmail = input.correo.trim().toLowerCase();
    const res = await authApi.register({
      nombre: input.nombre.trim(),
      correo: cleanEmail,
      contrasena: input.contrasena
    });

    const registeredEmail = (res.correo || cleanEmail).trim().toLowerCase();
    return {
      ok: true,
      correo: registeredEmail,
      hasRanch: false,
      message: `Cuenta creada correctamente (${registeredEmail}). Ahora inicia sesión con tu correo y contraseña.`
    };
  },

  async refreshProfile(): Promise<UsuarioResponseDto> {
    const profile = await usuariosApi.getMe();
    mergeProfileIntoSession(profile);
    return profile;
  },

  async updateProfile(input: UpdateProfileRequestDto): Promise<UsuarioResponseDto> {
    const profile = await usuariosApi.updateMe(input);
    mergeProfileIntoSession(profile);
    return profile;
  },

  async changePassword(input: ChangePasswordRequestDto): Promise<string> {
    const res = await usuariosApi.changeMyPassword(input);
    return res.mensaje || 'Contraseña actualizada correctamente.';
  },

  async updateConfig(input: UserConfig): Promise<UsuarioResponseDto> {
    const previousDefaultRanch = currentSession?.configuracion?.ranchoPredeterminadoId ?? null;
    const profile = await usuariosApi.updateMyConfig(input);
    mergeProfileIntoSession(profile);
    const nextDefaultRanch = profile.configuracion?.ranchoPredeterminadoId ?? null;
    if (previousDefaultRanch !== nextDefaultRanch) {
      void SyncScheduler.refreshState();
      if (
        SyncScheduler.isStarted() &&
        (typeof navigator === 'undefined' || navigator.onLine)
      ) {
        void SyncScheduler.triggerSync('app_resumed');
      }
    }
    return profile;
  },

  async uploadProfilePhoto(file: File): Promise<UsuarioResponseDto> {
    const profile = await usuariosApi.uploadMyPhoto(file);
    mergeProfileIntoSession(profile);
    return profile;
  },

  async deleteProfilePhoto(): Promise<UsuarioResponseDto> {
    const profile = await usuariosApi.deleteMyPhoto();
    mergeProfileIntoSession(profile);
    return profile;
  },

  logout(options?: { skipServerCall?: boolean }): void {
    const shouldNotifyServer =
      !options?.skipServerCall &&
      typeof navigator !== 'undefined' &&
      navigator.onLine;
    SyncCrossTabLock.forceReleaseLocalLease();
    emit(null);
    if (shouldNotifyServer) {
      void authApi.logout().catch(() => undefined);
    }
    void SyncScheduler.refreshState();
  }
};

registerUnauthorizedHandler(() => {
  if (currentSession) {
    AuthService.logout({ skipServerCall: true });
  }
});
