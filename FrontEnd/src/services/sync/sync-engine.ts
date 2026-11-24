import { PERSISTED_SESSION_META_KEY } from '../../lib/api';
import { db } from '../../lib/database/db';
import { isValidGuid } from '../cattle.validation';
import { PushSyncEngine } from './push-sync.engine';
import {
  PULL_ENTITY_ORDER,
  SyncPullEngine,
  type PullEntitySummary,
  type PullOptions
} from './sync-pull.engine';
import { BoviScaleAnalysisService } from '../boviscale-analysis.service';
import { MediaSyncEngine, type MediaSyncSummary } from './media-sync.engine';
import { SyncCrossTabLock } from './sync-lock';

interface StoredSessionRanchInfo {
  hasSession: boolean;
  ranchIds: string[];
  preferredRanchId?: string;
}

function readStoredSessionRanchInfo(): StoredSessionRanchInfo {
  if (typeof window === 'undefined') {
    return { hasSession: false, ranchIds: [] };
  }
  const candidates: Array<string | null> = [];
  try {
    if (window.sessionStorage) {
      candidates.push(window.sessionStorage.getItem('farmbovi_session_user'));
    }
  } catch {
    // Ignorar si sessionStorage no es legible
  }
  try {
    if (window.localStorage) {
      candidates.push(window.localStorage.getItem(PERSISTED_SESSION_META_KEY));
    }
  } catch {
    // Ignorar si localStorage no es legible
  }

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as {
        idUsuario?: unknown;
        ranchos?: Array<{ idRancho?: string }>;
        configuracion?: { ranchoPredeterminadoId?: string | null };
      };
      if (typeof parsed.idUsuario !== 'string') continue;

      const ranchIds = Array.isArray(parsed.ranchos)
        ? Array.from(
            new Set(
              parsed.ranchos
                .map((r) => (typeof r?.idRancho === 'string' ? r.idRancho.trim() : ''))
                .filter((id) => isValidGuid(id))
            )
          )
        : [];
      const rawPreferred = parsed.configuracion?.ranchoPredeterminadoId;
      const preferredRanchId =
        typeof rawPreferred === 'string' &&
        isValidGuid(rawPreferred) &&
        ranchIds.includes(rawPreferred)
          ? rawPreferred
          : undefined;

      return { hasSession: true, ranchIds, preferredRanchId };
    } catch {
      // Continuar con el siguiente origen
    }
  }

  return { hasSession: false, ranchIds: [] };
}

/**
 * Resuelve la lista ordenada de ranchos a sincronizar (priorizando el rancho predeterminado):
 * - Si se pasa `explicitRanchId`, sincroniza únicamente ese rancho (si está autorizado).
 * - Si hay sesión activa, devuelve todos los ranchos autorizados del usuario para soporte multi-rancho.
 * - Si no hay sesión persistida (p. ej. pruebas sin auth), usa los ranchos activos en IndexedDB.
 */
async function resolveTargetRanchIds(explicitRanchId?: string): Promise<string[]> {
  const sessionInfo = readStoredSessionRanchInfo();

  if (sessionInfo.hasSession) {
    // Cuando hay sesión activa, nunca usar ranchos residuales de otra cuenta en IndexedDB.
    if (sessionInfo.ranchIds.length === 0) {
      return [];
    }
    if (explicitRanchId && isValidGuid(explicitRanchId)) {
      return sessionInfo.ranchIds.includes(explicitRanchId) ? [explicitRanchId] : [];
    }
    if (sessionInfo.preferredRanchId) {
      return [
        sessionInfo.preferredRanchId,
        ...sessionInfo.ranchIds.filter((id) => id !== sessionInfo.preferredRanchId)
      ];
    }
    return sessionInfo.ranchIds;
  }

  if (explicitRanchId && isValidGuid(explicitRanchId)) {
    return [explicitRanchId];
  }

  const activeRanches = await db.ranches.filter((r) => !r.deletedAt).toArray();
  return Array.from(
    new Set(activeRanches.map((r) => r.id).filter((id) => isValidGuid(id)))
  );
}

export type PushEngineResult = Awaited<
  ReturnType<typeof PushSyncEngine.pushPendingOperations>
>;

export interface FullSyncCycleResult {
  push: PushEngineResult;
  pull: PullEntitySummary[];
  media?: MediaSyncSummary;
  pushCompleted: boolean;
  pullCompleted: boolean;
  allTasksCompleted: boolean;
  hasDataChanges: boolean;
  syncedRanchIds: string[];
  authRequired?: boolean;
  offlineInterrupted?: boolean;
  finishedAt: string;
}

let activeEngineCycle: Promise<FullSyncCycleResult | null> | null = null;

export const SyncEngine = {
  get isSyncing(): boolean {
    return activeEngineCycle !== null;
  },

  async sync(pullOptions?: PullOptions): Promise<FullSyncCycleResult | null> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return null;
    }

    // Evita dos ejecuciones simultáneas dentro de la misma pestaña devolviendo la promesa activa
    if (activeEngineCycle) {
      return await activeEngineCycle;
    }

    activeEngineCycle = (async () => {
      try {
        const lockOutcome = await SyncCrossTabLock.runExclusive(async () => {
          const push = await this.pushChanges();
          const pushHasDataChanges =
            push.confirmedCount > 0 ||
            push.conflictCount > 0 ||
            push.validationErrorCount > 0;

          // Si el JWT expiró (401) o se cayó la red durante Push, detener de inmediato sin lanzar Pull
          if (push.status === 'auth_required' || push.status === 'offline') {
            return {
              push,
              pull: [],
              pushCompleted: false,
              pullCompleted: false,
              allTasksCompleted: false,
              hasDataChanges: pushHasDataChanges,
              syncedRanchIds: [],
              authRequired: push.status === 'auth_required',
              offlineInterrupted: push.status === 'offline',
              finishedAt: new Date().toISOString()
            };
          }

          const targetRanchIds = await resolveTargetRanchIds(pullOptions?.ranchId);
          const pull = await this.pullChanges(pullOptions, targetRanchIds);

          const pullAuthRequired = pull.some(
            (item) => item.status === 'auth_required' || item.httpStatus === 401
          );
          const pullOffline = pull.some((item) => item.status === 'offline');

          let mediaSummary: MediaSyncSummary | undefined;
          let mediaAuthRequired = false;
          let mediaOffline = false;
          let boviScaleProcessedCount = 0;
          if (!pullAuthRequired && !pullOffline && (typeof navigator === 'undefined' || navigator.onLine)) {
            mediaSummary = await MediaSyncEngine.syncPendingMedia({
              ranchIds: targetRanchIds
            });
            mediaAuthRequired = Boolean(mediaSummary.authRequired);
            mediaOffline = Boolean(mediaSummary.offlineInterrupted);
            if (!mediaAuthRequired && !mediaOffline && (typeof navigator === 'undefined' || navigator.onLine)) {
              const boviScaleSummary = await BoviScaleAnalysisService.processPendingQueue({
                ranchIds: targetRanchIds
              });
              boviScaleProcessedCount = boviScaleSummary.processedCount;
            }
          }

          const pushCompleted =
            (push.status === 'completed' || push.status === 'nothing_to_push') &&
            push.transientErrorCount === 0 &&
            push.validationErrorCount === 0 &&
            push.conflictCount === 0;

          const pullCompleted =
            pull.length > 0 && pull.every((item) => item.status === 'completed');

          const pullHasDataChanges = pull.some(
            (item) => item.appliedCount > 0 || item.deletedCount > 0 || item.conflictCount > 0
          );

          const mediaHasDataChanges = Boolean(
            boviScaleProcessedCount > 0 ||
              (mediaSummary &&
                (mediaSummary.uploadedCount > 0 ||
                  mediaSummary.deletedCount > 0 ||
                  mediaSummary.pulledCount > 0))
          );

          return {
            push,
            pull,
            media: mediaSummary,
            pushCompleted,
            pullCompleted,
            allTasksCompleted:
              pushCompleted &&
              pullCompleted &&
              !pullAuthRequired &&
              !pullOffline &&
              !mediaAuthRequired &&
              !mediaOffline &&
              (mediaSummary?.errorCount ?? 0) === 0,
            hasDataChanges: pushHasDataChanges || pullHasDataChanges || mediaHasDataChanges,
            syncedRanchIds: targetRanchIds,
            authRequired: pullAuthRequired || mediaAuthRequired,
            offlineInterrupted:
              pullOffline || mediaOffline || (typeof navigator !== 'undefined' && !navigator.onLine),
            finishedAt: new Date().toISOString()
          };
        });

        if (!lockOutcome.acquired) {
          return null;
        }

        return lockOutcome.value;
      } catch (err) {
        console.error('Error en el ciclo de sincronización:', err);
        return null;
      } finally {
        activeEngineCycle = null;
      }
    })();

    return await activeEngineCycle;
  },

  async pushChanges(): Promise<PushEngineResult> {
    return await PushSyncEngine.pushPendingOperations();
  },

  async pullChanges(
    options?: PullOptions,
    preResolvedRanchIds?: readonly string[]
  ): Promise<PullEntitySummary[]> {
    const targetRanchIds =
      preResolvedRanchIds !== undefined
        ? [...preResolvedRanchIds]
        : await resolveTargetRanchIds(options?.ranchId);

    if (targetRanchIds.length === 0) {
      // Sin rancho activo no hay cambios de rancho que descargar; evitar llamadas 400 innecesarias.
      return PULL_ENTITY_ORDER.map((entidad) => ({
        entidad,
        status: 'completed',
        pagesProcessed: 0,
        appliedCount: 0,
        deletedCount: 0,
        conflictCount: 0,
        skippedPendingCount: 0,
        previousCursor: null,
        currentCursor: null
      }));
    }

    const combinedResults: PullEntitySummary[] = [];
    for (const ranchId of targetRanchIds) {
      const ranchResults = await SyncPullEngine.pullAllEntities({
        ...options,
        ranchId
      });
      combinedResults.push(...ranchResults);

      const stoppedForNetworkOrAuth = ranchResults.some(
        (item) =>
          item.status === 'offline' ||
          item.status === 'auth_required' ||
          item.status === 'endpoint_not_configured' ||
          item.httpStatus === 401
      );
      if (stoppedForNetworkOrAuth) {
        break;
      }
    }

    return combinedResults;
  }
};
