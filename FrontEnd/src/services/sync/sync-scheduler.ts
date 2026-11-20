import { db } from '../../lib/database/db';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { StorageMonitor } from '../../lib/database/storage-monitor';
import { ConnectivityService } from '../connectivity.service';
import { SyncHttpClient } from './sync-http.client';
import { SyncEngine, type FullSyncCycleResult } from './sync-engine';

export type GlobalSyncState =
  | 'offline'
  | 'syncing'
  | 'conflict'
  | 'error'
  | 'pending'
  | 'synced';

export type SyncTriggerReason =
  | 'startup'
  | 'online_recovered'
  | 'app_resumed'
  | 'manual'
  | 'local_mutation'
  | 'periodic_poll';

export interface SyncQueueCounts {
  pendingOperationsCount: number;
  failedOperationsCount: number;
  pendingFilesCount: number;
  failedFilesCount: number;
  pendingConflictsCount: number;
}

export interface SyncSchedulerSnapshot {
  state: GlobalSyncState;
  stateLabel: string;
  statusDetail: string;
  isOnline: boolean;
  isSyncing: boolean;
  counts: SyncQueueCounts;
  totalPendingWork: number;
  pushEndpointReady: boolean;
  pullEndpointReady: boolean;
  lastTrigger: SyncTriggerReason | null;
  lastAttemptAt: string | null;
  lastCompletedSyncAt: string | null;
  lastCycleResult: FullSyncCycleResult | null;
  lastErrorMessage: string | null;
}

type SchedulerListener = () => void;

const FOREGROUND_POLL_INTERVAL_MS = 45000;
const MUTATION_DEBOUNCE_MS = 1500;
const RESUME_MIN_COOLDOWN_MS = 5000;

const STATE_LABELS: Record<GlobalSyncState, string> = {
  offline: 'Sin conexión',
  syncing: 'Sincronizando',
  conflict: 'Conflicto',
  error: 'Error',
  pending: 'Pendiente',
  synced: 'Sincronizado'
};

function createInitialSnapshot(): SyncSchedulerSnapshot {
  const initialOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const endpoints = SyncHttpClient.getEndpointAvailability();

  return {
    state: initialOnline ? 'pending' : 'offline',
    stateLabel: initialOnline ? 'Pendiente' : 'Sin conexión',
    statusDetail: initialOnline
      ? 'Verificando estado local y conexión con el servidor…'
      : 'Trabajando sin conexión. Los cambios se guardan localmente.',
    isOnline: initialOnline,
    isSyncing: false,
    counts: {
      pendingOperationsCount: 0,
      failedOperationsCount: 0,
      pendingFilesCount: 0,
      failedFilesCount: 0,
      pendingConflictsCount: 0
    },
    totalPendingWork: 0,
    pushEndpointReady: endpoints.pushDisponible,
    pullEndpointReady: endpoints.pullDisponible,
    lastTrigger: null,
    lastAttemptAt: null,
    lastCompletedSyncAt: null,
    lastCycleResult: null,
    lastErrorMessage: null
  };
}

let snapshot: SyncSchedulerSnapshot = createInitialSnapshot();
const listeners = new Set<SchedulerListener>();

let started = false;
let activeRunPromise: Promise<FullSyncCycleResult | null> | null = null;
let queuedFollowUpTrigger: SyncTriggerReason | null = null;
let lastResumeTimestamp = 0;

let pollTimerId: number | null = null;
let mutationDebounceTimerId: number | null = null;
let cleanupLifecycleListeners: (() => void) | null = null;

function emitSnapshot(next: SyncSchedulerSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error notificando estado de sincronización:', err);
    }
  }
}

function resolveStateAndDetail(params: {
  isOnline: boolean;
  isSyncing: boolean;
  counts: SyncQueueCounts;
  pushEndpointReady: boolean;
  pullEndpointReady: boolean;
  lastCompletedSyncAt: string | null;
  lastErrorMessage: string | null;
}): { state: GlobalSyncState; statusDetail: string } {
  const {
    isOnline,
    isSyncing,
    counts,
    pushEndpointReady,
    pullEndpointReady,
    lastCompletedSyncAt,
    lastErrorMessage
  } = params;

  const totalPending =
    counts.pendingOperationsCount + counts.pendingFilesCount;

  if (isSyncing) {
    return {
      state: 'syncing',
      statusDetail:
        totalPending > 0
          ? `Sincronizando ${counts.pendingOperationsCount} operación(es) y ${counts.pendingFilesCount} archivo(s)…`
          : 'Sincronizando cambios con el servidor…'
    };
  }

  if (!isOnline) {
    return {
      state: 'offline',
      statusDetail:
        totalPending > 0
          ? `Sin conexión. ${counts.pendingOperationsCount} operación(es) y ${counts.pendingFilesCount} archivo(s) en cola local.`
          : 'Sin conexión a Internet. Puedes seguir trabajando offline.'
    };
  }

  if (counts.pendingConflictsCount > 0) {
    return {
      state: 'conflict',
      statusDetail: `Hay ${counts.pendingConflictsCount} conflicto(s) de versión pendientes de resolver.`
    };
  }

  if (counts.failedOperationsCount > 0 || counts.failedFilesCount > 0) {
    return {
      state: 'error',
      statusDetail:
        lastErrorMessage ||
        `${counts.failedOperationsCount} operación(es) y ${counts.failedFilesCount} archivo(s) con error de envío.`
    };
  }

  if (totalPending > 0) {
    if (!pushEndpointReady) {
      return {
        state: 'pending',
        statusDetail: `${counts.pendingOperationsCount} operación(es) y ${counts.pendingFilesCount} archivo(s) esperando endpoint Push en backend.`
      };
    }
    return {
      state: 'pending',
      statusDetail: `${counts.pendingOperationsCount} operación(es) y ${counts.pendingFilesCount} archivo(s) pendientes de envío.`
    };
  }

  // Solo mostrar 'synced' cuando Push y Pull completaron sus tareas correctamente
  if (pushEndpointReady && pullEndpointReady && lastCompletedSyncAt !== null) {
    return {
      state: 'synced',
      statusDetail: 'Todos los cambios locales y remotos están al día.'
    };
  }

  return {
    state: 'pending',
    statusDetail:
      !pushEndpointReady || !pullEndpointReady
        ? 'Sin cambios pendientes en cola; endpoints de sincronización pendientes en backend.'
        : 'Listo para comprobar cambios con el servidor.'
  };
}

async function readCountsFromIndexedDb(): Promise<{
  counts: SyncQueueCounts;
  latestServerTimestamp: string | null;
}> {
  const [allOutbox, activeMedia, pendingConflictsCount, checkpoints] = await Promise.all([
    db.outbox.toArray(),
    db.media.filter((m) => !m.deletedAt).toArray(),
    db.syncConflicts.where('estadoResolucion').equals('pendiente').count(),
    db.syncCheckpoints.toArray()
  ]);

  let pendingOperationsCount = 0;
  let failedOperationsCount = 0;
  for (const op of allOutbox) {
    if (op.estado === 'pendiente' || op.estado === 'en_proceso') {
      pendingOperationsCount++;
    } else if (op.estado === 'fallido') {
      failedOperationsCount++;
    }
  }

  let pendingFilesCount = 0;
  let failedFilesCount = 0;
  for (const media of activeMedia) {
    if (media.estadoArchivo === 'pendiente_subida' || media.estadoArchivo === 'subiendo') {
      pendingFilesCount++;
    } else if (media.estadoArchivo === 'error_subida') {
      failedFilesCount++;
    }
  }

  let latestServerTimestamp: string | null = null;
  for (const cp of checkpoints) {
    if (
      cp.ultimaFechaServidor &&
      (!latestServerTimestamp || cp.ultimaFechaServidor > latestServerTimestamp)
    ) {
      latestServerTimestamp = cp.ultimaFechaServidor;
    }
  }

  return {
    counts: {
      pendingOperationsCount,
      failedOperationsCount,
      pendingFilesCount,
      failedFilesCount,
      pendingConflictsCount
    },
    latestServerTimestamp
  };
}

async function tryRegisterProgressiveBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncManager = (
      registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;

    if (syncManager && typeof syncManager.register === 'function') {
      await syncManager.register('farmbovi-sync');
    }
  } catch {
    // Background Sync no disponible o bloqueado por políticas del navegador;
    // el planificador en primer plano garantiza la ejecución.
  }
}

export const SyncScheduler = {
  subscribe(listener: SchedulerListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): SyncSchedulerSnapshot {
    return snapshot;
  },

  isStarted(): boolean {
    return started;
  },

  /**
   * Recalcula los contadores reales desde IndexedDB sin bloquear la UI.
   */
  async refreshState(overrideOnline?: boolean): Promise<SyncSchedulerSnapshot> {
    const { counts, latestServerTimestamp } = await readCountsFromIndexedDb();
    const endpoints = SyncHttpClient.getEndpointAvailability();
    const isOnline =
      overrideOnline !== undefined
        ? overrideOnline
        : snapshot.isOnline;

    const lastCompletedSyncAt =
      snapshot.lastCompletedSyncAt ??
      (endpoints.pushDisponible && endpoints.pullDisponible ? latestServerTimestamp : null);

    const { state, statusDetail } = resolveStateAndDetail({
      isOnline,
      isSyncing: activeRunPromise !== null,
      counts,
      pushEndpointReady: endpoints.pushDisponible,
      pullEndpointReady: endpoints.pullDisponible,
      lastCompletedSyncAt,
      lastErrorMessage: snapshot.lastErrorMessage
    });

    const next: SyncSchedulerSnapshot = {
      ...snapshot,
      state,
      stateLabel: STATE_LABELS[state],
      statusDetail,
      isOnline,
      isSyncing: activeRunPromise !== null,
      counts,
      totalPendingWork: counts.pendingOperationsCount + counts.pendingFilesCount,
      pushEndpointReady: endpoints.pushDisponible,
      pullEndpointReady: endpoints.pullDisponible,
      lastCompletedSyncAt
    };

    emitSnapshot(next);
    return next;
  },

  /**
   * Inicia el planificador y lo conecta a todos los puntos del ciclo de vida de la app:
   * arranque, recuperación de red, reanudación de visibilidad/foco, cambios en IndexedDB
   * y sondeo periódico en primer plano.
   */
  start(): void {
    if (started || typeof window === 'undefined') {
      return;
    }
    started = true;

    const scheduleMutationCheck = () => {
      if (mutationDebounceTimerId !== null) {
        window.clearTimeout(mutationDebounceTimerId);
      }
      mutationDebounceTimerId = window.setTimeout(() => {
        mutationDebounceTimerId = null;
        void this.handleLocalMutationDetected();
      }, MUTATION_DEBOUNCE_MS);
    };

    // Hooks de Dexie para detectar trabajo nuevo en outbox, media o conflictos
    const onOutboxChange = () => {
      window.setTimeout(scheduleMutationCheck, 100);
    };
    const onMediaChange = () => {
      window.setTimeout(scheduleMutationCheck, 100);
    };
    const onConflictChange = () => {
      window.setTimeout(() => {
        void this.refreshState();
      }, 100);
    };

    db.outbox.hook('creating', onOutboxChange);
    db.outbox.hook('updating', onOutboxChange);
    db.outbox.hook('deleting', onOutboxChange);
    db.media.hook('creating', onMediaChange);
    db.media.hook('updating', onMediaChange);
    db.syncConflicts.hook('creating', onConflictChange);
    db.syncConflicts.hook('updating', onConflictChange);

    // 1. Recuperación de conexión de red
    const handleOnline = () => {
      void this.triggerSync('online_recovered');
    };

    const handleOffline = () => {
      void this.refreshState(false);
    };

    // 2. Reanudación de la aplicación después de estar suspendida o en segundo plano
    const handleResumeCheck = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastResumeTimestamp < RESUME_MIN_COOLDOWN_MS) return;
      lastResumeTimestamp = now;
      void this.handleAppResumed();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void this.handleAppResumed();
      }
    };

    // 3. Suscripción a sondas de ConnectivityService
    const unsubscribeConnectivity = ConnectivityService.subscribe((probe) => {
      const wasOffline = !snapshot.isOnline;
      if (probe.isOnline && wasOffline) {
        void this.triggerSync('online_recovered');
      } else if (!probe.isOnline && snapshot.isOnline) {
        void this.refreshState(false);
      }
    });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleResumeCheck);
    window.addEventListener('focus', handleResumeCheck);
    window.addEventListener('pageshow', handlePageShow);

    // 4. Sondeo periódico en primer plano (independiente de Background Sync)
    pollTimerId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void this.handlePeriodicPoll();
      }
    }, FOREGROUND_POLL_INTERVAL_MS);

    cleanupLifecycleListeners = () => {
      db.outbox.hook('creating').unsubscribe(onOutboxChange);
      db.outbox.hook('updating').unsubscribe(onOutboxChange);
      db.outbox.hook('deleting').unsubscribe(onOutboxChange);
      db.media.hook('creating').unsubscribe(onMediaChange);
      db.media.hook('updating').unsubscribe(onMediaChange);
      db.syncConflicts.hook('creating').unsubscribe(onConflictChange);
      db.syncConflicts.hook('updating').unsubscribe(onConflictChange);

      unsubscribeConnectivity();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleResumeCheck);
      window.removeEventListener('focus', handleResumeCheck);
      window.removeEventListener('pageshow', handlePageShow);

      if (pollTimerId !== null) {
        window.clearInterval(pollTimerId);
        pollTimerId = null;
      }
      if (mutationDebounceTimerId !== null) {
        window.clearTimeout(mutationDebounceTimerId);
        mutationDebounceTimerId = null;
      }
    };

    // 5. Revisión inmediata al iniciar FarmBovi
    void this.handleAppStartup();
  },

  stop(): void {
    if (!started) return;
    started = false;
    cleanupLifecycleListeners?.();
    cleanupLifecycleListeners = null;
  },

  async handleAppStartup(): Promise<void> {
    // 1. Recuperar cualquier operación interrumpida en un cierre previo (incluso si reabrimos offline)
    await OutboxRepository.recoverInterruptedOperations(new Set());
    // 2. Solicitar almacenamiento persistente del navegador para proteger IndexedDB
    void StorageMonitor.initPersistenceAndCheck();

    const probe = await ConnectivityService.checkBackendAvailability();
    const current = await this.refreshState(probe.isOnline);

    if (probe.isOnline) {
      // Al iniciar, sincronizar si hay trabajo pendiente o para comprobar cambios remotos
      if (
        current.totalPendingWork > 0 ||
        (current.pushEndpointReady && current.pullEndpointReady)
      ) {
        await this.triggerSync('startup');
      }
    } else if (current.totalPendingWork > 0) {
      await tryRegisterProgressiveBackgroundSync();
    }
  },

  async handleAppResumed(): Promise<void> {
    const probe = await ConnectivityService.checkBackendAvailability();
    const current = await this.refreshState(probe.isOnline);

    if (probe.isOnline && current.totalPendingWork > 0) {
      await this.triggerSync('app_resumed');
    }
  },

  async handleLocalMutationDetected(): Promise<void> {
    const current = await this.refreshState();
    if (current.totalPendingWork === 0) return;

    if (current.isOnline) {
      await this.triggerSync('local_mutation');
    } else {
      await tryRegisterProgressiveBackgroundSync();
    }
  },

  async handlePeriodicPoll(): Promise<void> {
    const probe = await ConnectivityService.checkBackendAvailability();
    const current = await this.refreshState(probe.isOnline);

    if (
      probe.isOnline &&
      (current.totalPendingWork > 0 ||
        (current.pushEndpointReady && current.pullEndpointReady))
    ) {
      await this.triggerSync('periodic_poll');
    }
  },

  /**
   * Inicia una sincronización manual explícita desde la interfaz de usuario.
   */
  async triggerManualSync(): Promise<FullSyncCycleResult | null> {
    return await this.triggerSync('manual');
  },

  /**
   * Ejecuta un ciclo único de sincronización evitando concurrencia simultánea.
   */
  async triggerSync(reason: SyncTriggerReason): Promise<FullSyncCycleResult | null> {
    if (activeRunPromise) {
      // Si ya hay una sincronización en curso, registrar seguimiento único sin duplicar procesos
      if (reason === 'local_mutation' || reason === 'manual' || reason === 'online_recovered') {
        queuedFollowUpTrigger = reason;
      }
      return await activeRunPromise;
    }

    const probe = await ConnectivityService.checkBackendAvailability();
    if (!probe.isOnline) {
      await this.refreshState(false);
      await tryRegisterProgressiveBackgroundSync();
      return null;
    }

    activeRunPromise = (async () => {
      const attemptAt = new Date().toISOString();
      const preCounts = await readCountsFromIndexedDb();
      const endpoints = SyncHttpClient.getEndpointAvailability();

      const syncingDetail = resolveStateAndDetail({
        isOnline: true,
        isSyncing: true,
        counts: preCounts.counts,
        pushEndpointReady: endpoints.pushDisponible,
        pullEndpointReady: endpoints.pullDisponible,
        lastCompletedSyncAt: snapshot.lastCompletedSyncAt,
        lastErrorMessage: null
      });

      emitSnapshot({
        ...snapshot,
        state: 'syncing',
        stateLabel: STATE_LABELS.syncing,
        statusDetail: syncingDetail.statusDetail,
        isOnline: true,
        isSyncing: true,
        counts: preCounts.counts,
        totalPendingWork:
          preCounts.counts.pendingOperationsCount + preCounts.counts.pendingFilesCount,
        pushEndpointReady: endpoints.pushDisponible,
        pullEndpointReady: endpoints.pullDisponible,
        lastTrigger: reason,
        lastAttemptAt: attemptAt,
        lastErrorMessage: null
      });

      let cycleResult: FullSyncCycleResult | null = null;
      let cycleError: string | null = null;

      try {
        cycleResult = await SyncEngine.sync();
        if (!cycleResult) {
          cycleError = 'No fue posible completar el ciclo de sincronización.';
        } else if (!cycleResult.allTasksCompleted) {
          if (!endpoints.pushDisponible || !endpoints.pullDisponible) {
            cycleError = null; // Pendiente de endpoints en backend, no es error fatal
          } else if (!cycleResult.pushCompleted) {
            cycleError = 'El envío saliente (Push) finalizó con elementos pendientes o con error.';
          } else if (!cycleResult.pullCompleted) {
            cycleError = 'La descarga incremental (Pull) no completó todas las entidades.';
          }
        }
      } catch (err) {
        cycleError =
          err instanceof Error ? err.message : 'Error inesperado durante la sincronización.';
      } finally {
        activeRunPromise = null;
      }

      const postData = await readCountsFromIndexedDb();
      const postEndpoints = SyncHttpClient.getEndpointAvailability();

      // Solo actualizar lastCompletedSyncAt si Push y Pull completaron sus tareas correctamente
      const verifiedCompletedAt =
        cycleResult && cycleResult.allTasksCompleted
          ? cycleResult.finishedAt
          : snapshot.lastCompletedSyncAt;

      const resolved = resolveStateAndDetail({
        isOnline: true,
        isSyncing: false,
        counts: postData.counts,
        pushEndpointReady: postEndpoints.pushDisponible,
        pullEndpointReady: postEndpoints.pullDisponible,
        lastCompletedSyncAt: verifiedCompletedAt,
        lastErrorMessage: cycleError
      });

      emitSnapshot({
        ...snapshot,
        state: resolved.state,
        stateLabel: STATE_LABELS[resolved.state],
        statusDetail: resolved.statusDetail,
        isOnline: true,
        isSyncing: false,
        counts: postData.counts,
        totalPendingWork:
          postData.counts.pendingOperationsCount + postData.counts.pendingFilesCount,
        pushEndpointReady: postEndpoints.pushDisponible,
        pullEndpointReady: postEndpoints.pullDisponible,
        lastCycleResult: cycleResult,
        lastCompletedSyncAt: verifiedCompletedAt,
        lastErrorMessage: cycleError
      });

      return cycleResult;
    })();

    const result = await activeRunPromise;

    if (queuedFollowUpTrigger) {
      const nextReason = queuedFollowUpTrigger;
      queuedFollowUpTrigger = null;
      return await this.triggerSync(nextReason);
    }

    return result;
  }
};
