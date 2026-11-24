/**
 * Exclusión mutua entre pestañas del navegador para evitar ciclos simultáneos
 * conflictivos de Push/Pull sobre la misma base IndexedDB.
 *
 * - Usa la API estándar Web Locks (`navigator.locks`) cuando está disponible.
 * - Usa respaldo de lease con TTL acotado en `localStorage` para entornos sin Web Locks
 *   (navegadores antiguos o JSDOM en pruebas), garantizando liberación segura ante cierre abrupto.
 */

const CROSS_TAB_LOCK_KEY = 'farmbovi_sync_cross_tab_lock_v1';
const LOCK_NAME = 'farmbovi-offline-sync-cycle';
const LEASE_TTL_MS = 60_000;

interface StoredLease {
  ownerId: string;
  acquiredAt: number;
  expiresAt: number;
}

const TAB_OWNER_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function readStoredLease(): StoredLease | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(CROSS_TAB_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLease>;
    if (
      typeof parsed.ownerId !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.acquiredAt !== 'number'
    ) {
      return null;
    }
    return {
      ownerId: parsed.ownerId,
      acquiredAt: parsed.acquiredAt,
      expiresAt: parsed.expiresAt
    };
  } catch {
    return null;
  }
}

function tryAcquireLocalStorageLease(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  const now = Date.now();
  const existing = readStoredLease();
  if (existing && existing.ownerId !== TAB_OWNER_ID && existing.expiresAt > now) {
    return false;
  }
  const lease: StoredLease = {
    ownerId: TAB_OWNER_ID,
    acquiredAt: now,
    expiresAt: now + LEASE_TTL_MS
  };
  try {
    window.localStorage.setItem(CROSS_TAB_LOCK_KEY, JSON.stringify(lease));
    const confirmed = readStoredLease();
    return confirmed?.ownerId === TAB_OWNER_ID;
  } catch {
    return true;
  }
}

function releaseLocalStorageLease(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = readStoredLease();
    if (!existing || existing.ownerId === TAB_OWNER_ID) {
      window.localStorage.removeItem(CROSS_TAB_LOCK_KEY);
    }
  } catch {
    // Ignorar errores de acceso a localStorage
  }
}

export interface ExclusiveLockResult<T> {
  acquired: boolean;
  value: T | null;
}

export const SyncCrossTabLock = {
  getOwnerId(): string {
    return TAB_OWNER_ID;
  },

  /**
   * Ejecuta `task` solo si esta pestaña adquiere el candado exclusivo de sincronización.
   * Si otra pestaña ya tiene el candado vigente, devuelve `{ acquired: false, value: null }`
   * sin bloquear ni lanzar errores.
   */
  async runExclusive<T>(task: () => Promise<T>): Promise<ExclusiveLockResult<T>> {
    const webLocks =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & {
            locks?: {
              request: <R>(
                name: string,
                options: { ifAvailable?: boolean; mode?: 'exclusive' | 'shared' },
                callback: (lock: unknown | null) => Promise<R> | R
              ) => Promise<R>;
            };
          }).locks
        : undefined;

    if (webLocks && typeof webLocks.request === 'function') {
      return await webLocks.request(
        LOCK_NAME,
        { ifAvailable: true, mode: 'exclusive' },
        async (lock) => {
          if (!lock) {
            return { acquired: false, value: null };
          }
          const value = await task();
          return { acquired: true, value };
        }
      );
    }

    if (!tryAcquireLocalStorageLease()) {
      return { acquired: false, value: null };
    }

    try {
      const value = await task();
      return { acquired: true, value };
    } finally {
      releaseLocalStorageLease();
    }
  },

  /** Utilidad para pruebas y recuperación explícita ante cambios de cuenta. */
  forceReleaseLocalLease(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.removeItem(CROSS_TAB_LOCK_KEY);
    } catch {
      // Ignorar
    }
  }
};
