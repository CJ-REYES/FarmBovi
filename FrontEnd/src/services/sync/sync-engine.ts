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
import { MediaSyncEngine } from './media-sync.engine';

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
        ? parsed.ranchos
            .map((r) => (typeof r?.idRancho === 'string' ? r.idRancho.trim() : ''))
            .filter((id) => isValidGuid(id))
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

async function resolveActiveRanchId(explicitRanchId?: string): Promise<string | undefined> {
  const sessionInfo = readStoredSessionRanchInfo();

  if (sessionInfo.hasSession) {
    // Cuando hay sesión activa, nunca usar ranchos residuales de otra cuenta en IndexedDB.
    if (sessionInfo.ranchIds.length === 0) {
      return undefined;
    }
    if (explicitRanchId && isValidGuid(explicitRanchId) && sessionInfo.ranchIds.includes(explicitRanchId)) {
      return explicitRanchId;
    }
    return sessionInfo.preferredRanchId ?? sessionInfo.ranchIds[0];
  }

  if (explicitRanchId && isValidGuid(explicitRanchId)) {
    return explicitRanchId;
  }

  const activeRanch = await db.ranches.filter((r) => !r.deletedAt).first();
  if (activeRanch && isValidGuid(activeRanch.id)) {
    return activeRanch.id;
  }
  return undefined;
}

export type PushEngineResult = Awaited<
  ReturnType<typeof PushSyncEngine.pushPendingOperations>
>;

export interface FullSyncCycleResult {
  push: PushEngineResult;
  pull: PullEntitySummary[];
  pushCompleted: boolean;
  pullCompleted: boolean;
  allTasksCompleted: boolean;
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

    // Evita dos ejecuciones simultáneas devolviendo la promesa activa
    if (activeEngineCycle) {
      return await activeEngineCycle;
    }

    activeEngineCycle = (async () => {
      try {
        const push = await this.pushChanges();
        const pull = await this.pullChanges(pullOptions);
        await MediaSyncEngine.syncPendingMedia();
        await BoviScaleAnalysisService.processPendingQueue();

        const pushCompleted =
          (push.status === 'completed' || push.status === 'nothing_to_push') &&
          push.transientErrorCount === 0 &&
          push.validationErrorCount === 0 &&
          push.conflictCount === 0;

        const pullCompleted =
          pull.length > 0 && pull.every((item) => item.status === 'completed');

        return {
          push,
          pull,
          pushCompleted,
          pullCompleted,
          allTasksCompleted: pushCompleted && pullCompleted,
          finishedAt: new Date().toISOString()
        };
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

  async pullChanges(options?: PullOptions): Promise<PullEntitySummary[]> {
    const ranchId = await resolveActiveRanchId(options?.ranchId);
    if (!ranchId) {
      // Sin rancho activo no hay cambios de rancho que descargar; evitar 6 llamadas 400 innecesarias.
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
    return await SyncPullEngine.pullAllEntities({
      ...options,
      ranchId
    });
  }
};
