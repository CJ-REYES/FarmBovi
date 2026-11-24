import {
  ApiError,
  PERSISTED_SESSION_META_KEY,
  hasActiveAuthSession,
  reproductionApi
} from '../lib/api';
import { db } from '../lib/database/db';
import { computeStableNegativeId } from '../lib/database/migrations';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { ReproductionRepository } from '../lib/database/repositories/reproduction.repository';
import type { LocalOutboxQueue, LocalReproductionRecord } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import type {
  BackendEventoReproductivoDto,
  BackendEventoReproductivoPayload,
  ReproductionEvent,
  ReproductionEventInput
} from '../types/reproduction';
import { CattleService } from './cattle.service';
import { isValidGuid } from './cattle.validation';
import {
  normalizeReproductionInput,
  validateReproductionInput,
  type ReproductionValidationErrors
} from './reproduction.validation';
import { ConflictResolver } from './sync/conflict-resolver';
import { PushSyncEngine } from './sync/push-sync.engine';

export class ReproductionValidationError extends Error {
  readonly fieldErrors: ReproductionValidationErrors;

  constructor(message: string, fieldErrors: ReproductionValidationErrors) {
    super(message);
    this.name = 'ReproductionValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface ReproductionMutationResult {
  event: ReproductionEvent;
  synced: boolean;
  syncMessage?: string;
}

export interface ReproductionSyncIssue {
  idEntidad: string;
  idOperacion: string;
  estado: LocalOutboxQueue['estado'];
  intentos: number;
  mensaje: string;
}

export interface ReproductionLoadResult {
  data: ReproductionEvent[];
  animals: Cattle[];
  source: 'server' | 'cache';
  warning: string | null;
  syncIssuesByEventId: Record<string, ReproductionSyncIssue>;
  activeConflictsCount: number;
}

interface SessionRanchScope {
  hasSession: boolean;
  ranchIds: string[];
  preferredRanchId?: string;
}

function readSessionRanchScope(): SessionRanchScope {
  if (typeof window === 'undefined') {
    return { hasSession: false, ranchIds: [] };
  }

  const candidates: Array<string | null> = [];
  try {
    candidates.push(window.sessionStorage?.getItem('farmbovi_session_user') ?? null);
  } catch {
    // Ignorar si sessionStorage no está disponible
  }
  try {
    candidates.push(window.localStorage?.getItem(PERSISTED_SESSION_META_KEY) ?? null);
  } catch {
    // Ignorar si localStorage no está disponible
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

function normalizeDateTimeForBackend(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return trimmed;
}

function mapBackendReproductionToLocal(
  remote: BackendEventoReproductivoDto,
  ranchId: string | undefined,
  existing?: LocalReproductionRecord
): LocalReproductionRecord {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idEventoReproductivo;

  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idEventoReproductivo,
    ranchId: ranchId || existing?.ranchId,
    cattleId: remote.idAnimal,
    sementalId: remote.idSemental ?? null,
    evento: remote.tipo.trim(),
    fecha: remote.fecha,
    resultado: remote.resultado?.trim() ? remote.resultado.trim() : null,
    observaciones: remote.observaciones?.trim() ? remote.observaciones.trim() : undefined,
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

export const ReproductionService = {
  toReproductionEvent(local: LocalReproductionRecord): ReproductionEvent {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idEventoReproductivo: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId,
      idSemental: local.sementalId ?? null,
      tipo: local.evento,
      fecha: local.fecha,
      resultado: local.resultado?.trim() ? local.resultado.trim() : null,
      observaciones: local.observaciones?.trim() ? local.observaciones.trim() : null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toBackendPayload(
    idEventoReproductivo: string,
    input: ReproductionEventInput,
    versionRegistro?: number
  ): BackendEventoReproductivoPayload {
    const normalized = normalizeReproductionInput(input);
    return {
      idEventoReproductivo,
      idAnimal: normalized.idAnimal,
      idSemental: normalized.idSemental ?? null,
      tipo: normalized.tipo,
      fecha: normalizeDateTimeForBackend(normalized.fecha),
      resultado: normalized.resultado,
      observaciones: normalized.observaciones,
      ...(typeof versionRegistro === 'number' ? { versionRegistro } : {})
    };
  },

  async loadAnimals(options?: {
    preferRemote?: boolean;
    idRancho?: string;
    allowedRanchIds?: readonly string[];
  }): Promise<Cattle[]> {
    let items: Cattle[];
    if (options?.preferRemote) {
      try {
        const cattleResult = await CattleService.getAll();
        items = cattleResult.data;
      } catch {
        const localAnimals = await CattleRepository.getAll();
        items = localAnimals.map((item) => CattleService.toCattle(item));
      }
    } else {
      const localAnimals = await CattleRepository.getAll();
      items = localAnimals.map((item) => CattleService.toCattle(item));
    }

    if (options?.idRancho) {
      return items.filter((a) => a.idRancho === options.idRancho);
    }
    if (options?.allowedRanchIds && options.allowedRanchIds.length > 0) {
      const allowed = new Set(options.allowedRanchIds);
      return items.filter((a) => allowed.has(a.idRancho));
    }
    return items;
  },

  async getSyncDiagnostics(): Promise<{
    syncIssuesByEventId: Record<string, ReproductionSyncIssue>;
    activeConflictsCount: number;
  }> {
    const [outboxOps, pendingConflicts] = await Promise.all([
      db.outbox
        .where('entidad')
        .equals('reproductionRecords')
        .filter((op) => op.estado === 'fallido' || op.estado === 'conflicto')
        .toArray(),
      ConflictResolver.getPendingConflicts()
    ]);

    outboxOps.sort((a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion));
    const syncIssuesByEventId: Record<string, ReproductionSyncIssue> = {};
    for (const op of outboxOps) {
      syncIssuesByEventId[op.idEntidad] = {
        idEntidad: op.idEntidad,
        idOperacion: op.idOperacion,
        estado: op.estado,
        intentos: op.intentos,
        mensaje:
          op.ultimoError?.trim() ||
          (op.estado === 'conflicto'
            ? 'Conflicto de versión pendiente de resolución.'
            : 'Error al sincronizar este evento reproductivo.')
      };
    }

    const activeConflictsCount = pendingConflicts.filter(
      (c) => c.entidad === 'reproductionRecords'
    ).length;

    return { syncIssuesByEventId, activeConflictsCount };
  },

  async retryEventSync(idEntidad: string): Promise<{ synced: boolean; syncMessage: string }> {
    const ops = await OutboxRepository.getByEntity('reproductionRecords', idEntidad);
    const retryable = ops.filter((op) => op.estado === 'fallido');
    for (const op of retryable) {
      await OutboxRepository.resetForManualRetry(op.idOperacion);
    }

    const entity = await ReproductionRepository.getByIdIncludingDeleted(idEntidad);
    if (entity && entity.syncStatus === 'error') {
      await db.reproductionRecords.update(entity.id, { syncStatus: 'pending' });
    }

    const outcome = await this.attemptPushForEntity(idEntidad, 'actualizado');
    return {
      synced: outcome.synced,
      syncMessage:
        outcome.syncMessage ||
        (outcome.synced
          ? 'Evento reproductivo sincronizado con el servidor.'
          : 'Reintento encolado en espera de conexión.')
    };
  },

  async attemptPushForEntity(
    idEntidad: string,
    action: 'guardado' | 'actualizado' | 'desactivado'
  ): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage: `Sin conexión: el evento reproductivo fue ${action} localmente en IndexedDB y se sincronizará al recuperar Internet.`
      };
    }

    if (!hasActiveAuthSession()) {
      return {
        synced: false,
        syncMessage: `Evento reproductivo ${action} localmente en IndexedDB. Inicia sesión para sincronizarlo con el servidor.`
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const ops = await OutboxRepository.getByEntity('reproductionRecords', idEntidad);
    const latestOp = ops[ops.length - 1];
    if (!latestOp || latestOp.estado === 'confirmado') {
      return {
        synced: true,
        syncMessage: `Evento reproductivo ${action} y sincronizado con el servidor.`
      };
    }

    if (latestOp.estado === 'conflicto') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'Se detectó un conflicto de versión con el servidor. Resuélvelo desde el panel de conflictos.'
      };
    }

    if (latestOp.estado === 'fallido') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'El evento se guardó localmente, pero el servidor reportó un error al sincronizarlo.'
      };
    }

    return {
      synced: false,
      syncMessage: `Evento reproductivo ${action} localmente y en cola de sincronización.`
    };
  },

  /**
   * Consulta el historial real de eventos reproductivos desde `/api/eventos-reproductivos`
   * cuando hay conectividad y sesión activa, aislando estrictamente por rancho autorizado,
   * reconciliando la copia local sin duplicar ni perder mutaciones offline y preservando
   * orden cronológico determinista.
   */
  async getAll(options?: {
    idRancho?: string;
    cattleId?: string;
    tipo?: string;
    desde?: string;
    hasta?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<ReproductionLoadResult> {
    let source: 'server' | 'cache' = 'cache';
    let warning: string | null = null;

    const sessionScope = readSessionRanchScope();
    if (
      options?.idRancho &&
      sessionScope.hasSession &&
      sessionScope.ranchIds.length > 0 &&
      !sessionScope.ranchIds.includes(options.idRancho)
    ) {
      throw new ApiError('No tienes permisos sobre el rancho solicitado.', 403);
    }

    const effectiveRanchId = options?.idRancho ?? sessionScope.preferredRanchId;
    const allowedRanchIds =
      sessionScope.hasSession && sessionScope.ranchIds.length > 0
        ? sessionScope.ranchIds
        : undefined;

    const animals = await this.loadAnimals({
      preferRemote: true,
      idRancho: effectiveRanchId,
      allowedRanchIds
    });

    if (typeof navigator !== 'undefined' && navigator.onLine && hasActiveAuthSession()) {
      await PushSyncEngine.pushPendingOperations().catch(() => undefined);

      try {
        const remoteItems = await reproductionApi.list({
          idRancho: effectiveRanchId,
          idAnimal: options?.cattleId,
          tipo: options?.tipo,
          desde: options?.desde,
          hasta: options?.hasta,
          incluirEliminados: Boolean(options?.includeDeleted)
        });

        const allAnimals = await CattleRepository.getAllWithOptions({ includeDeleted: true });
        const ranchByAnimal = new Map<string, string>();
        for (const a of allAnimals) {
          if (a.ranchId) {
            ranchByAnimal.set(a.id, a.ranchId);
            if (typeof a.remoteId === 'string') {
              ranchByAnimal.set(a.remoteId, a.ranchId);
            }
          }
        }
        for (const a of animals) {
          if (a.idRancho) {
            ranchByAnimal.set(a.id, a.idRancho);
          }
        }

        await ReproductionRepository.reconcileServerSnapshot(remoteItems, ranchByAnimal, {
          scopedRanchId: effectiveRanchId,
          allowedRanchIds,
          scopedCattleId: options?.cattleId,
          includeDeleted: Boolean(options?.includeDeleted),
          isFilteredSubset: Boolean(options?.tipo || options?.desde || options?.hasta)
        });

        source = 'server';
      } catch (err) {
        if (err instanceof ApiError && err.status === 403 && options?.idRancho) {
          throw err;
        }
        if (err instanceof ApiError && err.status === 401) {
          warning =
            'Sesión no autenticada en el servidor (401). Mostrando eventos reproductivos locales en IndexedDB.';
        } else if (err instanceof ApiError && err.status === 403) {
          warning =
            'Sin permisos para consultar eventos reproductivos en el servidor (403). Mostrando copia local.';
        } else {
          warning =
            err instanceof Error
              ? `${err.message} Mostrando eventos guardados localmente.`
              : 'No se pudo consultar el servidor. Mostrando eventos locales.';
        }
      }
    }

    const [localRecords, diagnostics] = await Promise.all([
      ReproductionRepository.getAllWithOptions({
        ranchId: effectiveRanchId,
        allowedRanchIds,
        cattleId: options?.cattleId,
        tipo: options?.tipo,
        desde: options?.desde,
        hasta: options?.hasta,
        includeDeleted: options?.includeDeleted,
        order: options?.order
      }),
      this.getSyncDiagnostics()
    ]);

    return {
      data: localRecords.map((item) => this.toReproductionEvent(item)),
      animals,
      source,
      warning,
      syncIssuesByEventId: diagnostics.syncIssuesByEventId,
      activeConflictsCount: diagnostics.activeConflictsCount
    };
  },

  async getById(id: string): Promise<ReproductionEvent | undefined> {
    const sessionScope = readSessionRanchScope();
    let local = await ReproductionRepository.getByIdIncludingDeleted(id);

    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine &&
      hasActiveAuthSession() &&
      (!local || local.syncStatus === 'synced')
    ) {
      try {
        const remote = await reproductionApi.getById(id);
        const ranchId = (await CattleRepository.resolveByIdentifier(remote.idAnimal))?.ranchId;
        const mapped = mapBackendReproductionToLocal(remote, ranchId, local);
        await ReproductionRepository.upsertFromServer([mapped]);
        local = await ReproductionRepository.getByIdIncludingDeleted(mapped.id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          throw err;
        }
      }
    }

    if (
      local &&
      sessionScope.hasSession &&
      sessionScope.ranchIds.length > 0 &&
      local.ranchId &&
      !sessionScope.ranchIds.includes(local.ranchId)
    ) {
      throw new ApiError('No tienes permisos sobre el rancho de este registro.', 403);
    }

    return local ? this.toReproductionEvent(local) : undefined;
  },

  async create(rawInput: ReproductionEventInput): Promise<ReproductionMutationResult> {
    const sessionScope = readSessionRanchScope();
    const allowedRanchIds =
      sessionScope.hasSession && sessionScope.ranchIds.length > 0
        ? sessionScope.ranchIds
        : undefined;

    const [animals, existingAnimalEvents] = await Promise.all([
      this.loadAnimals({ allowedRanchIds }),
      rawInput.idAnimal.trim()
        ? ReproductionRepository.getByCattleId(rawInput.idAnimal.trim())
        : Promise.resolve([])
    ]);

    const fieldErrors = validateReproductionInput(rawInput, {
      animals,
      existingEvents: existingAnimalEvents.map((item) => this.toReproductionEvent(item))
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del evento reproductivo.';
      throw new ReproductionValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeReproductionInput(rawInput);
    const animal = animals.find((a) => a.id === normalized.idAnimal)!;
    const idEventoReproductivo = crypto.randomUUID();
    const fechaIso = normalizeDateTimeForBackend(normalized.fecha);
    const payload = this.toBackendPayload(idEventoReproductivo, rawInput);

    const createdLocal = await ReproductionRepository.create(
      {
        id: idEventoReproductivo,
        ranchId: animal.idRancho,
        cattleId: animal.id,
        sementalId: normalized.idSemental ?? null,
        evento: normalized.tipo,
        fecha: fechaIso,
        resultado: normalized.resultado,
        observaciones: normalized.observaciones ?? undefined
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(createdLocal.id, 'guardado');
    const refreshed =
      (await ReproductionRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      event: this.toReproductionEvent(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async update(id: string, rawInput: ReproductionEventInput): Promise<ReproductionMutationResult> {
    const existing = await ReproductionRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El evento reproductivo que intentas editar no existe o fue desactivado.');
    }

    const sessionScope = readSessionRanchScope();
    if (
      sessionScope.hasSession &&
      sessionScope.ranchIds.length > 0 &&
      existing.ranchId &&
      !sessionScope.ranchIds.includes(existing.ranchId)
    ) {
      throw new ApiError('No tienes permisos sobre el rancho de este registro.', 403);
    }

    // `idAnimal` permanece inmutable en edición para conservar la integridad del expediente
    const enforcedInput: ReproductionEventInput = {
      ...rawInput,
      idAnimal: existing.cattleId
    };

    const allowedRanchIds =
      sessionScope.hasSession && sessionScope.ranchIds.length > 0
        ? sessionScope.ranchIds
        : undefined;

    const [animals, existingAnimalEvents] = await Promise.all([
      this.loadAnimals({ allowedRanchIds }),
      ReproductionRepository.getByCattleId(existing.cattleId)
    ]);

    const fieldErrors = validateReproductionInput(enforcedInput, {
      animals,
      existingEvents: existingAnimalEvents.map((item) => this.toReproductionEvent(item)),
      excludeEventId: existing.id
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del evento reproductivo.';
      throw new ReproductionValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeReproductionInput(enforcedInput);
    const idEventoReproductivo =
      typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const fechaIso = normalizeDateTimeForBackend(normalized.fecha);
    const currentVersion =
      typeof existing.serverVersion === 'number'
        ? existing.serverVersion
        : typeof existing.serverVersion === 'string' && !Number.isNaN(Number(existing.serverVersion))
          ? Number(existing.serverVersion)
          : undefined;
    const payload = this.toBackendPayload(idEventoReproductivo, enforcedInput, currentVersion);

    const updatedLocal = await ReproductionRepository.updateRecoverable(
      existing.id,
      {
        ranchId: existing.ranchId,
        cattleId: existing.cattleId,
        sementalId: normalized.idSemental ?? null,
        evento: normalized.tipo,
        fecha: fechaIso,
        resultado: normalized.resultado,
        observaciones: normalized.observaciones ?? undefined
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(updatedLocal.id, 'actualizado');
    const refreshed =
      (await ReproductionRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      event: this.toReproductionEvent(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async deactivate(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await ReproductionRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El evento reproductivo no fue encontrado.');
    }

    const sessionScope = readSessionRanchScope();
    if (
      sessionScope.hasSession &&
      sessionScope.ranchIds.length > 0 &&
      existing.ranchId &&
      !sessionScope.ranchIds.includes(existing.ranchId)
    ) {
      throw new ApiError('No tienes permisos sobre el rancho de este registro.', 403);
    }

    await ReproductionRepository.softDelete(existing.id, {
      idEventoReproductivo: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity(existing.id, 'desactivado');
  }
};
