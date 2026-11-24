import { useEffect, useState } from 'react';
import { db } from '../lib/database/db';
import type { LocalAlert } from '../lib/database/schema';
import { classifyAlertTiming, normalizeAlertEstado } from '../services/alert.validation';
import { SystemNotificationsService } from '../services/system-notifications.service';
import { SyncScheduler } from '../services/sync/sync-scheduler';
import { ALERT_UPCOMING_WINDOW_DAYS } from '../types/alert';
import { useAuth } from './useAuth';
import { usePwaUpdate } from './usePwaUpdate';
import { useSyncStatus } from './useSyncStatus';

const SEEN_STATE_STORAGE_KEY = 'farmbovi_alerts_seen_state_v1';
const MAX_STORED_KEYS = 200;

interface AlertsSeenState {
  lastSeenAt: string;
  seenReminderKeys: string[];
  seenConflictCount: number;
  seenPwaVersion: string | null;
}

type SeenListener = () => void;
const seenListeners = new Set<SeenListener>();
let seenStateCache: AlertsSeenState | null | undefined = undefined;

function readSeenState(): AlertsSeenState | null {
  if (seenStateCache !== undefined) {
    return seenStateCache;
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    seenStateCache = null;
    return null;
  }
  try {
    const raw = window.localStorage.getItem(SEEN_STATE_STORAGE_KEY);
    if (!raw) {
      seenStateCache = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AlertsSeenState>;
    if (typeof parsed.lastSeenAt !== 'string') {
      seenStateCache = null;
      return null;
    }
    seenStateCache = {
      lastSeenAt: parsed.lastSeenAt,
      seenReminderKeys: Array.isArray(parsed.seenReminderKeys)
        ? parsed.seenReminderKeys.filter((k): k is string => typeof k === 'string')
        : [],
      seenConflictCount:
        typeof parsed.seenConflictCount === 'number' && Number.isFinite(parsed.seenConflictCount)
          ? parsed.seenConflictCount
          : 0,
      seenPwaVersion: typeof parsed.seenPwaVersion === 'string' ? parsed.seenPwaVersion : null
    };
    return seenStateCache;
  } catch {
    seenStateCache = null;
    return null;
  }
}

function writeSeenState(next: AlertsSeenState): void {
  seenStateCache = next;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(SEEN_STATE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignorar errores de cuota de localStorage
    }
  }
  for (const listener of seenListeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error notificando estado de alertas vistas:', err);
    }
  }
}

function buildReminderNotificationKey(
  alert: Pick<LocalAlert, 'id' | 'estado' | 'leida' | 'fecha' | 'updatedAt'>,
  upcomingWindowDays: number,
  now: Date
): string | null {
  const estado = normalizeAlertEstado(alert.estado ?? (alert.leida ? 'Completado' : 'Pendiente'));
  const timing = classifyAlertTiming(
    { estado, fechaProgramada: alert.fecha },
    now,
    upcomingWindowDays
  );
  if (timing !== 'vencida' && timing !== 'proxima') {
    return null;
  }
  return `${alert.id}:${timing}:${alert.updatedAt || alert.fecha}`;
}

async function computeUnreadAlertsCount(params: {
  upcomingWindowDays: number;
  pendingConflictsCount: number;
  updateAvailable: boolean;
  swVersion: string | null;
}): Promise<number> {
  const seen = readSeenState();
  const seenKeys = new Set(seen?.seenReminderKeys ?? []);
  const now = new Date();
  let unread = 0;

  // 1. Recordatorios activos que estén vencidos o próximos y el usuario aún no haya visto
  const localAlerts = await db.alerts.filter((a) => !a.deletedAt).toArray();
  for (const alert of localAlerts) {
    const key = buildReminderNotificationKey(alert, params.upcomingWindowDays, now);
    if (key && !seenKeys.has(key)) {
      unread++;
    }
  }

  // 2. Nuevas notificaciones del sistema registradas DESPUÉS de la última visita a Alertas
  //    (si nunca se visitó, el historial previo inactivo no dispara falsos avisos)
  if (seen?.lastSeenAt) {
    const seenAtMs = Date.parse(seen.lastSeenAt);
    if (!Number.isNaN(seenAtMs)) {
      const history = SystemNotificationsService.getHistory();
      for (const item of history) {
        const itemMs = Date.parse(item.fecha);
        if (!Number.isNaN(itemMs) && itemMs > seenAtMs) {
          unread++;
        }
      }
    }
  }

  // 3. Conflictos de sincronización activos no vistos
  const seenConflicts = seen?.seenConflictCount ?? 0;
  if (params.pendingConflictsCount > 0 && params.pendingConflictsCount > seenConflicts) {
    unread += params.pendingConflictsCount - seenConflicts;
  }

  // 4. Actualización PWA disponible no vista
  if (params.updateAvailable) {
    const versionTag = params.swVersion ?? 'available';
    if (seen?.seenPwaVersion !== versionTag) {
      unread++;
    }
  }

  return unread;
}

/**
 * Marca todas las alertas y notificaciones actuales como vistas por el usuario
 * (se invoca al entrar o revisar la vista de Alertas).
 */
export async function markAlertsAsSeen(options?: {
  upcomingWindowDays?: number;
  pendingConflictsCount?: number;
  updateAvailable?: boolean;
  swVersion?: string | null;
}): Promise<void> {
  const upcomingWindowDays = options?.upcomingWindowDays ?? ALERT_UPCOMING_WINDOW_DAYS;
  const now = new Date();
  const localAlerts = await db.alerts.filter((a) => !a.deletedAt).toArray();

  const currentKeys: string[] = [];
  for (const alert of localAlerts) {
    const key = buildReminderNotificationKey(alert, upcomingWindowDays, now);
    if (key) {
      currentKeys.push(key);
    }
  }

  const nextState: AlertsSeenState = {
    lastSeenAt: now.toISOString(),
    seenReminderKeys: currentKeys.slice(-MAX_STORED_KEYS),
    seenConflictCount: options?.pendingConflictsCount ?? 0,
    seenPwaVersion: options?.updateAvailable ? (options.swVersion ?? 'available') : null
  };

  writeSeenState(nextState);
}

/** Utilidad para pruebas unitarias al limpiar localStorage. */
export function resetUnreadAlertsCache(): void {
  seenStateCache = undefined;
}

export interface UnreadAlertsIndicator {
  unreadCount: number;
  hasUnread: boolean;
}

export function useUnreadAlerts(): UnreadAlertsIndicator {
  const { session } = useAuth();
  const { counts } = useSyncStatus();
  const { updateAvailable, swVersion } = usePwaUpdate();
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const upcomingWindowDays =
    session?.configuracion?.diasAvisoAlertas ?? ALERT_UPCOMING_WINDOW_DAYS;

  useEffect(() => {
    let active = true;

    const recompute = async () => {
      try {
        const nextCount = await computeUnreadAlertsCount({
          upcomingWindowDays,
          pendingConflictsCount: counts.pendingConflictsCount,
          updateAvailable,
          swVersion
        });
        if (active) {
          setUnreadCount(nextCount);
        }
      } catch {
        // Ignorar errores transitorios si IndexedDB se reinicia en pruebas
      }
    };

    void recompute();

    const triggerRecompute = () => {
      // Deferir ligeramente para asegurar que la transacción de Dexie haya concluido
      setTimeout(() => {
        if (active) {
          void recompute();
        }
      }, 0);
    };

    seenListeners.add(triggerRecompute);
    const unsubSystem = SystemNotificationsService.subscribe(triggerRecompute);
    const unsubSync = SyncScheduler.subscribeToDataUpdates(['alerts'], triggerRecompute);
    db.alerts.hook('creating', triggerRecompute);
    db.alerts.hook('updating', triggerRecompute);
    db.alerts.hook('deleting', triggerRecompute);

    const intervalId =
      typeof window !== 'undefined'
        ? window.setInterval(() => {
            if (active) {
              void recompute();
            }
          }, 60_000)
        : null;

    return () => {
      active = false;
      seenListeners.delete(triggerRecompute);
      unsubSystem();
      unsubSync();
      db.alerts.hook('creating').unsubscribe(triggerRecompute);
      db.alerts.hook('updating').unsubscribe(triggerRecompute);
      db.alerts.hook('deleting').unsubscribe(triggerRecompute);
      if (intervalId !== null && typeof window !== 'undefined') {
        window.clearInterval(intervalId);
      }
    };
  }, [upcomingWindowDays, counts.pendingConflictsCount, updateAvailable, swVersion]);

  return {
    unreadCount,
    hasUnread: unreadCount > 0
  };
}
