import {
  ApiError,
  lotsApi,
  ranchesApi,
  hasActiveAuthSession
} from '../lib/api';
import { computeStableNegativeId } from '../lib/database/migrations';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import type { LocalLot, LocalRanch } from '../lib/database/schema';
import type { BackendLoteDto, BackendRanchoDto, Cattle, RanchOption } from '../types/cattle';
import type { BackendLotePayload, Lot, LotEstado, LotInput } from '../types/lot';
import { CattleService } from './cattle.service';
import {
  normalizeLotEstado,
  normalizeLotInput,
  validateLotInput,
  type LotValidationErrors
} from './lot.validation';
import { PushSyncEngine } from './sync/push-sync.engine';

export class LotValidationError extends Error {
  readonly fieldErrors: LotValidationErrors;

  constructor(message: string, fieldErrors: LotValidationErrors) {
    super(message);
    this.name = 'LotValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface LotMutationResult {
  lot: Lot;
  synced: boolean;
  syncMessage?: string;
}

export interface LotLoadResult {
  data: Lot[];
  ranches: RanchOption[];
  source: 'server' | 'cache';
  warning: string | null;
}

function mapLocalRanchToOption(ranch: LocalRanch): RanchOption {
  return {
    id: ranch.id,
    nombre: ranch.nombre,
    ubicacionGeneral: ranch.ubicacionGeneral,
    estado: ranch.estado
  };
}

function mapBackendRanchToLocal(remote: BackendRanchoDto, existing?: LocalRanch): LocalRanch {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idRancho;
  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idRancho,
    ranchId: remote.idRancho,
    nombre: remote.nombre,
    ubicacionGeneral: remote.ubicacionGeneral,
    estado: remote.estado || 'Activo',
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

function mapBackendLotToLocal(remote: BackendLoteDto, existing?: LocalLot): LocalLot {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idLote;
  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idLote,
    ranchId: remote.idRancho,
    nombre: remote.nombre.trim(),
    capacidad: existing?.capacidad ?? 0,
    ubicacion: remote.ubicacion ?? undefined,
    estado: normalizeLotEstado(remote.estado),
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

export const LotService = {
  toLot(local: LocalLot, activeAnimalsCount = 0): Lot {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idLote: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      nombre: local.nombre,
      ubicacion: local.ubicacion ?? null,
      estado: normalizeLotEstado(local.estado),
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus,
      activeAnimalsCount
    };
  },

  toBackendPayload(idLote: string, input: LotInput): BackendLotePayload {
    const normalized = normalizeLotInput(input);
    return {
      idLote,
      idRancho: normalized.idRancho,
      nombre: normalized.nombre,
      ubicacion: normalized.ubicacion,
      estado: normalized.estado
    };
  },

  async loadRanchesFromLocal(): Promise<RanchOption[]> {
    const localRanches = await RanchRepository.getActive();
    return localRanches.map(mapLocalRanchToOption);
  },

  async getAll(options?: {
    ranchId?: string;
    includeDeleted?: boolean;
  }): Promise<LotLoadResult> {
    let source: 'server' | 'cache' = 'cache';
    let warning: string | null = null;

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const [lotsRes, ranchesRes] = await Promise.allSettled([
        lotsApi.list(Boolean(options?.includeDeleted)),
        ranchesApi.list()
      ]);

      if (ranchesRes.status === 'fulfilled') {
        const ranchUpserts: LocalRanch[] = [];
        for (const remote of ranchesRes.value) {
          const existing = await RanchRepository.resolveByIdentifier(remote.idRancho);
          ranchUpserts.push(mapBackendRanchToLocal(remote, existing));
        }
        if (ranchUpserts.length > 0) {
          await RanchRepository.upsertFromServer(ranchUpserts);
        }
      }

      if (lotsRes.status === 'fulfilled') {
        const lotUpserts: LocalLot[] = [];
        for (const remote of lotsRes.value) {
          const existing = await LotRepository.resolveByIdentifier(remote.idLote);
          lotUpserts.push(mapBackendLotToLocal(remote, existing));
        }
        if (lotUpserts.length > 0) {
          await LotRepository.upsertFromServer(lotUpserts);
        }
        source = 'server';
      } else {
        const reason = lotsRes.reason;
        if (reason instanceof ApiError && reason.status === 401) {
          warning =
            'Sesión no autenticada en el servidor (401). Mostrando potreros locales guardados en IndexedDB.';
        } else if (reason instanceof ApiError && reason.status === 403) {
          warning =
            'Sin permisos para consultar los potreros en el servidor (403). Mostrando copia local.';
        } else {
          warning =
            reason instanceof Error
              ? `${reason.message} Mostrando potreros guardados localmente.`
              : 'No se pudo consultar el servidor. Mostrando potreros locales.';
        }
      }
    }

    const [localLots, ranches, allActiveAnimals] = await Promise.all([
      LotRepository.getAllWithOptions(options),
      this.loadRanchesFromLocal(),
      CattleRepository.getAll()
    ]);

    const animalCountsByLot = new Map<string, number>();
    for (const animal of allActiveAnimals) {
      if (animal.loteId) {
        animalCountsByLot.set(animal.loteId, (animalCountsByLot.get(animal.loteId) ?? 0) + 1);
      }
    }

    return {
      data: localLots.map((item) => this.toLot(item, animalCountsByLot.get(item.id) ?? 0)),
      ranches,
      source,
      warning
    };
  },

  async getById(id: string): Promise<Lot | undefined> {
    let local = await LotRepository.getByIdIncludingDeleted(id);

    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine &&
      (!local || local.syncStatus === 'synced')
    ) {
      try {
        const remote = await lotsApi.getById(id);
        const mapped = mapBackendLotToLocal(remote, local);
        await LotRepository.upsertFromServer([mapped]);
        local = await LotRepository.getByIdIncludingDeleted(mapped.id);
      } catch {
        // Fallback a copia local si no hay sesión o conectividad
      }
    }

    if (!local) return undefined;
    const count = await LotRepository.countActiveAnimals(local.id);
    return this.toLot(local, count);
  },

  async getAnimalsInLot(lotId: string): Promise<Cattle[]> {
    const localAnimals = await CattleRepository.getByLotId(lotId);
    return localAnimals.map((item) => CattleService.toCattle(item));
  },

  async attemptPushForEntity(idEntidad: string): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage:
          'Sin conexión: el potrero se guardó localmente en IndexedDB y se sincronizará automáticamente al recuperar Internet.'
      };
    }

    if (!hasActiveAuthSession()) {
      return {
        synced: false,
        syncMessage:
          'Guardado localmente en IndexedDB. Inicia sesión para sincronizar este cambio con el servidor.'
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const ops = await OutboxRepository.getByEntity('lots', idEntidad);
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
          'El cambio se guardó localmente, pero el servidor reportó un error al sincronizarlo.'
      };
    }

    return {
      synced: false,
      syncMessage: 'Guardado localmente y en cola de sincronización.'
    };
  },

  async create(rawInput: LotInput): Promise<LotMutationResult> {
    const normalized = normalizeLotInput(rawInput);
    const ranches = await this.loadRanchesFromLocal();
    const duplicate = normalized.idRancho
      ? await LotRepository.getByNameInRanch(normalized.idRancho, normalized.nombre)
      : undefined;

    const fieldErrors = validateLotInput(normalized, {
      ranches: ranches.length > 0 ? ranches : undefined,
      duplicateNameExists: Boolean(duplicate)
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del potrero.';
      throw new LotValidationError(firstMsg, fieldErrors);
    }

    const idLote = crypto.randomUUID();
    const payload = this.toBackendPayload(idLote, normalized);

    const createdLocal = await LotRepository.create(
      {
        id: idLote,
        ranchId: normalized.idRancho,
        nombre: normalized.nombre,
        capacidad: 0,
        ubicacion: normalized.ubicacion ?? undefined,
        estado: normalized.estado
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(createdLocal.id);
    const refreshed = (await LotRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      lot: this.toLot(refreshed, 0),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async update(id: string, rawInput: LotInput): Promise<LotMutationResult> {
    const existing = await LotRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El potrero que intentas editar no existe o fue desactivado.');
    }

    // Regla del Backend (`SincronizacionController` AllowedUpdateProperties): IdRancho es inmutable en edición.
    const effectiveRanchId = existing.ranchId || rawInput.idRancho;
    const normalized = normalizeLotInput({
      ...rawInput,
      idRancho: effectiveRanchId
    });

    const ranches = await this.loadRanchesFromLocal();
    const duplicate = normalized.idRancho
      ? await LotRepository.getByNameInRanch(normalized.idRancho, normalized.nombre, existing.id)
      : undefined;

    const fieldErrors = validateLotInput(normalized, {
      ranches: ranches.length > 0 ? ranches : undefined,
      duplicateNameExists: Boolean(duplicate)
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del potrero.';
      throw new LotValidationError(firstMsg, fieldErrors);
    }

    const idLote = typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const payload = this.toBackendPayload(idLote, normalized);

    const updatedLocal = await LotRepository.update(
      existing.id,
      {
        ranchId: normalized.idRancho,
        nombre: normalized.nombre,
        ubicacion: normalized.ubicacion ?? undefined,
        estado: normalized.estado
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(updatedLocal.id);
    const refreshed = (await LotRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;
    const count = await LotRepository.countActiveAnimals(refreshed.id);

    return {
      lot: this.toLot(refreshed, count),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async setEstado(id: string, estado: LotEstado): Promise<LotMutationResult> {
    const existing = await LotRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('Potrero no encontrado para cambiar estado.');
    }

    return await this.update(existing.id, {
      idRancho: existing.ranchId || '',
      nombre: existing.nombre,
      ubicacion: existing.ubicacion ?? null,
      estado
    });
  },

  /**
   * Desactivación lógica (`DELETE /api/lotes/{id}` / Push `Eliminar`).
   * Respeta la regla de integridad de `LotesController.Delete`: no se puede eliminar
   * un lote que tenga animales activos asociados.
   */
  async deactivate(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await LotRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El potrero no fue encontrado.');
    }

    const activeAnimalsCount = await LotRepository.countActiveAnimals(existing.id);
    if (activeAnimalsCount > 0) {
      throw new Error(
        `No se puede desactivar el potrero "${existing.nombre}" porque tiene ${activeAnimalsCount} animal(es) activo(s) asignado(s). Traslada primero a los animales o márcalo como Inactivo.`
      );
    }

    await LotRepository.softDelete(existing.id, {
      idLote: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity(existing.id);
  }
};
