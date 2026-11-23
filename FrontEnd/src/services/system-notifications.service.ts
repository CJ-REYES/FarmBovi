export type SystemAlertSeverity = 'warning' | 'info' | 'success' | 'danger';
export type SystemAlertCategory = 'offline' | 'sync' | 'update' | 'system';

export interface SystemAlertItem {
  id: string;
  codigo: string;
  titulo: string;
  descripcion: string;
  categoria: SystemAlertCategory;
  severidad: SystemAlertSeverity;
  fecha: string;
  activa: boolean;
}

export interface LiveSystemAlertsContext {
  isOnline: boolean;
  pendingOperationsCount: number;
  pendingFilesCount: number;
  pendingConflictsCount: number;
  updateAvailable: boolean;
  swVersion: string | null;
}

type SystemAlertListener = () => void;

const STORAGE_KEY = 'farmbovi_system_alerts_v1';
const MAX_HISTORY_ITEMS = 40;
const DEDUPE_WINDOW_MS = 2000;

const listeners = new Set<SystemAlertListener>();

function readHistoryFromStorage(): SystemAlertItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SystemAlertItem =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as SystemAlertItem).id === 'string' &&
          typeof (item as SystemAlertItem).titulo === 'string' &&
          typeof (item as SystemAlertItem).descripcion === 'string' &&
          typeof (item as SystemAlertItem).fecha === 'string'
      )
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function writeHistoryToStorage(items: SystemAlertItem[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // Ignorar errores de cuota de localStorage
  }
}

let historyCache: SystemAlertItem[] | null = null;

function ensureCache(): SystemAlertItem[] {
  if (historyCache === null) {
    historyCache = readHistoryFromStorage();
  }
  return historyCache;
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error en suscriptor de alertas del sistema:', err);
    }
  }
}

export const SystemNotificationsService = {
  subscribe(listener: SystemAlertListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getHistory(): SystemAlertItem[] {
    return [...ensureCache()];
  },

  recordEvent(input: {
    codigo: string;
    titulo: string;
    descripcion: string;
    categoria: SystemAlertCategory;
    severidad: SystemAlertSeverity;
  }): SystemAlertItem {
    const current = ensureCache();
    const now = Date.now();
    const latest = current[0];

    if (
      latest &&
      latest.codigo === input.codigo &&
      latest.titulo === input.titulo &&
      now - Date.parse(latest.fecha) < DEDUPE_WINDOW_MS
    ) {
      return latest;
    }

    const item: SystemAlertItem = {
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `sys-${now}-${Math.random().toString(36).slice(2, 8)}`,
      codigo: input.codigo,
      titulo: input.titulo,
      descripcion: input.descripcion,
      categoria: input.categoria,
      severidad: input.severidad,
      fecha: new Date(now).toISOString(),
      activa: false
    };

    historyCache = [item, ...current].slice(0, MAX_HISTORY_ITEMS);
    writeHistoryToStorage(historyCache);
    emit();
    return item;
  },

  clearHistory(): void {
    historyCache = [];
    writeHistoryToStorage([]);
    emit();
  },

  /**
   * Resetea la caché en memoria (útil en pruebas unitarias cuando se limpia localStorage).
   */
  resetInMemoryCache(): void {
    historyCache = null;
  },

  /**
   * Construye las alertas activas del sistema a partir del estado real de red, cola y PWA.
   */
  getLiveSystemAlerts(ctx: LiveSystemAlertsContext): SystemAlertItem[] {
    const nowIso = new Date().toISOString();
    const live: SystemAlertItem[] = [];

    if (!ctx.isOnline) {
      const pendingDetail =
        ctx.pendingOperationsCount > 0 || ctx.pendingFilesCount > 0
          ? ` Pendientes locales: ${ctx.pendingOperationsCount} operación(es) y ${ctx.pendingFilesCount} fotografía(s).`
          : '';
      live.push({
        id: 'live-offline-mode',
        codigo: 'offline-active',
        titulo: 'Modo Offline Activo',
        descripcion: `Trabajando sin conexión a Internet. Los registros y fotografías se guardan localmente en IndexedDB y se sincronizarán al reconectar.${pendingDetail}`,
        categoria: 'offline',
        severidad: 'warning',
        fecha: nowIso,
        activa: true
      });
    }

    if (ctx.pendingConflictsCount > 0) {
      live.push({
        id: 'live-sync-conflicts',
        codigo: 'sync-conflict',
        titulo: `${ctx.pendingConflictsCount} conflicto(s) de sincronización`,
        descripcion:
          'Existen registros con conflicto de versión entre el dispositivo y el servidor pendientes de revisar.',
        categoria: 'sync',
        severidad: 'danger',
        fecha: nowIso,
        activa: true
      });
    }

    if (ctx.pendingOperationsCount > 0 || ctx.pendingFilesCount > 0) {
      live.push({
        id: 'live-pending-sync',
        codigo: 'pending-sync',
        titulo: 'Operaciones pendientes de sincronización',
        descripcion: `Tienes ${ctx.pendingOperationsCount} operación(es) y ${ctx.pendingFilesCount} fotografía(s) guardadas localmente listas para enviarse al servidor.`,
        categoria: 'sync',
        severidad: 'info',
        fecha: nowIso,
        activa: true
      });
    }

    if (ctx.updateAvailable) {
      live.push({
        id: 'live-pwa-update',
        codigo: 'pwa-update',
        titulo: 'Nueva versión de FarmBovi disponible',
        descripcion: `Hay una actualización lista para aplicarse sin perder tus datos locales${ctx.swVersion ? ` (${ctx.swVersion})` : ''}.`,
        categoria: 'update',
        severidad: 'info',
        fecha: nowIso,
        activa: true
      });
    }

    return live;
  }
};
