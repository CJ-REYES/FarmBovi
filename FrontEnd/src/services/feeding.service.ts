import {
  ApiError,
  feedingApi,
  hasActiveAuthSession
} from '../lib/api';
import { computeStableNegativeId } from '../lib/database/migrations';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { FeedingRepository } from '../lib/database/repositories/feeding.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import type { LocalFeedingRecord, LocalLot } from '../lib/database/schema';
import type { Cattle, LotOption } from '../types/cattle';
import type {
  BackendAlimentacionDto,
  BackendAlimentacionPayload,
  FeedingInput,
  FeedingRecord
} from '../types/feeding';
import { CattleService } from './cattle.service';
import {
  normalizeFeedingInput,
  validateFeedingInput,
  type FeedingValidationErrors
} from './feeding.validation';
import { PushSyncEngine } from './sync/push-sync.engine';

export class FeedingValidationError extends Error {
  readonly fieldErrors: FeedingValidationErrors;

  constructor(message: string, fieldErrors: FeedingValidationErrors) {
    super(message);
    this.name = 'FeedingValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface FeedingMutationResult {
  record: FeedingRecord;
  synced: boolean;
  syncMessage?: string;
}

export interface FeedingLoadResult {
  data: FeedingRecord[];
  animals: Cattle[];
  lots: LotOption[];
  source: 'server' | 'cache';
  warning: string | null;
}

function mapLocalLotToOption(lot: LocalLot): LotOption {
  return {
    id: lot.id,
    idRancho: lot.ranchId || '',
    nombre: lot.nombre,
    ubicacion: lot.ubicacion ?? null,
    estado: lot.estado || 'Activo'
  };
}

function normalizeDateTimeForBackend(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  return trimmed;
}

function mapBackendFeedingToLocal(
  remote: BackendAlimentacionDto,
  ranchId: string | undefined,
  existing?: LocalFeedingRecord
): LocalFeedingRecord {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idAlimentacion;

  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idAlimentacion,
    ranchId: ranchId || existing?.ranchId,
    lotId: remote.idLote ?? undefined,
    cattleId: remote.idAnimal ?? undefined,
    tipoAlimento: remote.alimento.trim(),
    cantidadKg: Number(remote.cantidad),
    fecha: remote.inicio,
    racion: remote.racion.trim(),
    unidad: remote.unidad.trim(),
    frecuencia: remote.frecuencia.trim(),
    fin: remote.fin ?? null,
    cambioDieta: remote.cambioDieta ?? null,
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

export const FeedingService = {
  toFeedingRecord(local: LocalFeedingRecord): FeedingRecord {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    const idAnimal = local.cattleId ?? null;
    const idLote = local.lotId ?? null;

    return {
      id: local.id,
      idAlimentacion: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      targetType: idAnimal ? 'animal' : 'lote',
      idAnimal,
      idLote,
      alimento: local.tipoAlimento,
      racion: local.racion || local.tipoAlimento,
      cantidad: local.cantidadKg,
      unidad: local.unidad || 'kg',
      frecuencia: local.frecuencia || 'Diaria',
      inicio: local.fecha,
      fin: local.fin ?? null,
      cambioDieta: local.cambioDieta ?? null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toBackendPayload(idAlimentacion: string, input: FeedingInput): BackendAlimentacionPayload {
    const normalized = normalizeFeedingInput(input);
    return {
      idAlimentacion,
      idAnimal: normalized.idAnimal,
      idLote: normalized.idLote,
      alimento: normalized.alimento,
      racion: normalized.racion,
      cantidad: normalized.cantidad,
      unidad: normalized.unidad,
      frecuencia: normalized.frecuencia,
      inicio: normalizeDateTimeForBackend(normalized.inicio),
      fin: normalized.fin ? normalizeDateTimeForBackend(normalized.fin) : null,
      cambioDieta: normalized.cambioDieta
    };
  },

  async loadContextData(): Promise<{ animals: Cattle[]; lots: LotOption[] }> {
    const [localAnimals, localLots] = await Promise.all([
      CattleRepository.getAll(),
      LotRepository.getAll()
    ]);

    return {
      animals: localAnimals.map((item) => CattleService.toCattle(item)),
      lots: localLots.map(mapLocalLotToOption)
    };
  },

  async getAll(options?: {
    lotId?: string;
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<FeedingLoadResult> {
    let source: 'server' | 'cache' = 'cache';
    let warning: string | null = null;

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteItems = await feedingApi.list(Boolean(options?.includeDeleted));
        const [allAnimals, allLots] = await Promise.all([
          CattleRepository.getAllWithOptions({ includeDeleted: true }),
          LotRepository.getAllWithOptions({ includeDeleted: true })
        ]);

        const ranchByAnimal = new Map<string, string>();
        for (const a of allAnimals) {
          if (a.ranchId) {
            ranchByAnimal.set(a.id, a.ranchId);
            if (typeof a.remoteId === 'string') ranchByAnimal.set(a.remoteId, a.ranchId);
          }
        }
        const ranchByLot = new Map<string, string>();
        for (const l of allLots) {
          if (l.ranchId) {
            ranchByLot.set(l.id, l.ranchId);
            if (typeof l.remoteId === 'string') ranchByLot.set(l.remoteId, l.ranchId);
          }
        }

        const upserts: LocalFeedingRecord[] = [];
        for (const remote of remoteItems) {
          const existing = await FeedingRepository.resolveByIdentifier(remote.idAlimentacion);
          const resolvedRanch =
            (remote.idAnimal ? ranchByAnimal.get(remote.idAnimal) : undefined) ??
            (remote.idLote ? ranchByLot.get(remote.idLote) : undefined);
          upserts.push(mapBackendFeedingToLocal(remote, resolvedRanch, existing));
        }

        if (upserts.length > 0) {
          await FeedingRepository.upsertFromServer(upserts);
        }
        source = 'server';
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          warning =
            'Sesión no autenticada en el servidor (401). Mostrando registros de alimentación locales en IndexedDB.';
        } else if (err instanceof ApiError && err.status === 403) {
          warning =
            'Sin permisos para consultar alimentación en el servidor (403). Mostrando copia local.';
        } else {
          warning =
            err instanceof Error
              ? `${err.message} Mostrando registros guardados localmente.`
              : 'No se pudo consultar el servidor. Mostrando registros locales.';
        }
      }
    }

    const [localItems, context] = await Promise.all([
      FeedingRepository.getAllWithOptions(options),
      this.loadContextData()
    ]);

    return {
      data: localItems.map((item) => this.toFeedingRecord(item)),
      animals: context.animals,
      lots: context.lots,
      source,
      warning
    };
  },

  async getById(id: string): Promise<FeedingRecord | undefined> {
    let local = await FeedingRepository.getByIdIncludingDeleted(id);

    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine &&
      (!local || local.syncStatus === 'synced')
    ) {
      try {
        const remote = await feedingApi.getById(id);
        const ranchId = remote.idAnimal
          ? (await CattleRepository.resolveByIdentifier(remote.idAnimal))?.ranchId
          : remote.idLote
            ? (await LotRepository.resolveByIdentifier(remote.idLote))?.ranchId
            : undefined;
        const mapped = mapBackendFeedingToLocal(remote, ranchId, local);
        await FeedingRepository.upsertFromServer([mapped]);
        local = await FeedingRepository.getByIdIncludingDeleted(mapped.id);
      } catch {
        // Fallback a copia local si no hay sesión o red
      }
    }

    return local ? this.toFeedingRecord(local) : undefined;
  },

  async attemptPushForEntity(idEntidad: string): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage:
          'Sin conexión: el registro de alimentación se guardó localmente en IndexedDB y se sincronizará al recuperar Internet.'
      };
    }

    if (!hasActiveAuthSession()) {
      return {
        synced: false,
        syncMessage:
          'Guardado localmente en IndexedDB. Inicia sesión para sincronizar este registro con el servidor.'
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const ops = await OutboxRepository.getByEntity('feedingRecords', idEntidad);
    const latestOp = ops[ops.length - 1];
    if (!latestOp || latestOp.estado === 'confirmado') {
      return { synced: true };
    }

    if (latestOp.estado === 'conflicto') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'Se detectó un conflicto de versión con el servidor. Revísalo en el Centro de Sincronización.'
      };
    }

    if (latestOp.estado === 'fallido') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'El registro se guardó localmente, pero el servidor reportó un error al sincronizarlo.'
      };
    }

    return {
      synced: false,
      syncMessage: 'Registro guardado localmente y en cola de sincronización.'
    };
  },

  async create(rawInput: FeedingInput): Promise<FeedingMutationResult> {
    const { animals, lots } = await this.loadContextData();
    const fieldErrors = validateFeedingInput(rawInput, { animals, lots });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos de alimentación.';
      throw new FeedingValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeFeedingInput(rawInput);
    const ranchId = normalized.idAnimal
      ? animals.find((a) => a.id === normalized.idAnimal)?.idRancho || ''
      : lots.find((l) => l.id === normalized.idLote)?.idRancho || '';

    const idAlimentacion = crypto.randomUUID();
    const inicioIso = normalizeDateTimeForBackend(normalized.inicio);
    const finIso = normalized.fin ? normalizeDateTimeForBackend(normalized.fin) : null;
    const payload = this.toBackendPayload(idAlimentacion, rawInput);

    const createdLocal = await FeedingRepository.create(
      {
        id: idAlimentacion,
        ranchId,
        lotId: normalized.idLote ?? undefined,
        cattleId: normalized.idAnimal ?? undefined,
        tipoAlimento: normalized.alimento,
        cantidadKg: normalized.cantidad,
        fecha: inicioIso,
        racion: normalized.racion,
        unidad: normalized.unidad,
        frecuencia: normalized.frecuencia,
        fin: finIso,
        cambioDieta: normalized.cambioDieta
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(createdLocal.id);
    const refreshed =
      (await FeedingRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      record: this.toFeedingRecord(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async update(id: string, rawInput: FeedingInput): Promise<FeedingMutationResult> {
    const existing = await FeedingRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El registro de alimentación que intentas editar no existe o fue desactivado.');
    }

    const { animals, lots } = await this.loadContextData();
    const fieldErrors = validateFeedingInput(rawInput, { animals, lots });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos de alimentación.';
      throw new FeedingValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeFeedingInput(rawInput);
    const ranchId = normalized.idAnimal
      ? animals.find((a) => a.id === normalized.idAnimal)?.idRancho || existing.ranchId || ''
      : lots.find((l) => l.id === normalized.idLote)?.idRancho || existing.ranchId || '';

    const idAlimentacion =
      typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const inicioIso = normalizeDateTimeForBackend(normalized.inicio);
    const finIso = normalized.fin ? normalizeDateTimeForBackend(normalized.fin) : null;
    const payload = this.toBackendPayload(idAlimentacion, rawInput);

    const updatedLocal = await FeedingRepository.update(
      existing.id,
      {
        ranchId,
        lotId: normalized.idLote ?? undefined,
        cattleId: normalized.idAnimal ?? undefined,
        tipoAlimento: normalized.alimento,
        cantidadKg: normalized.cantidad,
        fecha: inicioIso,
        racion: normalized.racion,
        unidad: normalized.unidad,
        frecuencia: normalized.frecuencia,
        fin: finIso,
        cambioDieta: normalized.cambioDieta
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(updatedLocal.id);
    const refreshed =
      (await FeedingRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      record: this.toFeedingRecord(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async deactivate(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await FeedingRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El registro de alimentación no fue encontrado.');
    }

    await FeedingRepository.softDelete(existing.id, {
      idAlimentacion: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity(existing.id);
  }
};
