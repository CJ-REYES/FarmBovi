import {
  ApiError,
  cattleApi,
  lotsApi,
  ranchesApi,
  readSessionAuthToken
} from '../lib/api';
import { computeStableNegativeId } from '../lib/database/migrations';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import type { LocalCattle, LocalLot, LocalRanch } from '../lib/database/schema';
import { PushSyncEngine } from './sync/push-sync.engine';
import type {
  BackendAnimalDto,
  BackendAnimalPayload,
  BackendLoteDto,
  BackendRanchoDto,
  Cattle,
  CattleInput,
  LotOption,
  RanchOption
} from '../types/cattle';
import {
  getTodayDateString,
  normalizeAnimalEstado,
  normalizeAnimalSex,
  normalizeCattleInput,
  toDateInputValue,
  validateCattleInput,
  type CattleValidationErrors
} from './cattle.validation';

export class CattleValidationError extends Error {
  readonly fieldErrors: CattleValidationErrors;

  constructor(message: string, fieldErrors: CattleValidationErrors) {
    super(message);
    this.name = 'CattleValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface CattleMutationResult {
  animal: Cattle;
  synced: boolean;
  syncMessage?: string;
}

export interface CattleLoadResult {
  data: Cattle[];
  ranches: RanchOption[];
  lots: LotOption[];
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

function mapLocalLotToOption(lot: LocalLot): LotOption {
  return {
    id: lot.id,
    idRancho: lot.ranchId || '',
    nombre: lot.nombre,
    ubicacion: lot.ubicacion ?? null,
    estado: lot.estado || 'Activo'
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
    nombre: remote.nombre,
    capacidad: existing?.capacidad ?? 0,
    ubicacion: remote.ubicacion ?? undefined,
    estado: remote.estado || 'Activo',
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

function mapBackendAnimalToLocal(remote: BackendAnimalDto, existing?: LocalCattle): LocalCattle {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idAnimal;
  const arete = remote.arete?.trim() || existing?.arete || existing?.areteSiniiga || '';
  const sexo = normalizeAnimalSex(remote.sexo);
  const fechaNacimiento = toDateInputValue(remote.fechaNacimiento) || undefined;
  const fechaIngreso =
    toDateInputValue(remote.fechaIngreso) ||
    toDateInputValue(remote.creadoEn) ||
    existing?.fechaIngreso ||
    getTodayDateString();
  const fechaSalida = toDateInputValue(remote.fechaSalida) || null;

  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idAnimal,
    ranchId: remote.idRancho,
    arete,
    areteSiniiga: arete,
    nombre: existing?.nombre,
    raza: remote.raza?.trim() || 'Cruzado',
    sexo,
    gender: sexo,
    fechaNacimiento,
    fechaIngreso,
    procedencia: remote.procedencia?.trim() || 'Propio',
    estado: remote.estado?.trim() || 'Activo',
    fechaSalida,
    observaciones: remote.observaciones ?? null,
    loteId: remote.idLote ?? undefined,
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

export const CattleService = {
  toCattle(local: LocalCattle): Cattle {
    const arete = local.arete || local.areteSiniiga || '';
    const sexo = normalizeAnimalSex(local.sexo || local.gender);
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idAnimal: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idLote: local.loteId ?? null,
      arete,
      raza: local.raza || '',
      sexo,
      fechaNacimiento: toDateInputValue(local.fechaNacimiento) || null,
      fechaIngreso:
        toDateInputValue(local.fechaIngreso) ||
        toDateInputValue(local.createdAt) ||
        getTodayDateString(),
      procedencia: local.procedencia || 'Propio',
      estado: local.estado || 'Activo',
      fechaSalida: toDateInputValue(local.fechaSalida) || null,
      observaciones: local.observaciones ?? null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toBackendPayload(idAnimal: string, input: CattleInput): BackendAnimalPayload {
    const normalized = normalizeCattleInput(input);
    return {
      idAnimal,
      idRancho: normalized.idRancho,
      idLote: normalized.idLote,
      arete: normalized.arete,
      raza: normalized.raza,
      sexo: normalized.sexo,
      fechaNacimiento: normalized.fechaNacimiento,
      fechaIngreso: normalized.fechaIngreso,
      procedencia: normalized.procedencia,
      estado: normalized.estado,
      fechaSalida: normalized.fechaSalida,
      observaciones: normalized.observaciones
    };
  },

  async loadCatalogsFromLocal(): Promise<{ ranches: RanchOption[]; lots: LotOption[] }> {
    const [localRanches, localLots] = await Promise.all([
      RanchRepository.getActive(),
      LotRepository.getAll()
    ]);

    return {
      ranches: localRanches.map(mapLocalRanchToOption),
      lots: localLots
        .filter((l) => (l.estado || 'Activo').toLowerCase() !== 'inactivo')
        .map(mapLocalLotToOption)
    };
  },

  async getAll(options?: {
    ranchId?: string;
    includeDeleted?: boolean;
  }): Promise<CattleLoadResult> {
    let source: 'server' | 'cache' = 'cache';
    let warning: string | null = null;

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const [animalsRes, ranchesRes, lotsRes] = await Promise.allSettled([
        cattleApi.list(Boolean(options?.includeDeleted)),
        ranchesApi.list(),
        lotsApi.list()
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
      }

      if (animalsRes.status === 'fulfilled') {
        const animalUpserts: LocalCattle[] = [];
        for (const remote of animalsRes.value) {
          const existing = await CattleRepository.resolveByIdentifier(remote.idAnimal);
          animalUpserts.push(mapBackendAnimalToLocal(remote, existing));
        }
        if (animalUpserts.length > 0) {
          await CattleRepository.upsertFromServer(animalUpserts);
        }
        source = 'server';
      } else {
        const reason = animalsRes.reason;
        if (reason instanceof ApiError && reason.status === 401) {
          warning =
            'Sesión no autenticada en el servidor (401). Mostrando registros locales guardados en IndexedDB.';
        } else if (reason instanceof ApiError && reason.status === 403) {
          warning =
            'Sin permisos para consultar el rancho en el servidor (403). Mostrando copia local.';
        } else {
          warning =
            reason instanceof Error
              ? `${reason.message} Mostrando información guardada localmente.`
              : 'No se pudo consultar el servidor. Mostrando información local.';
        }
      }
    }

    const [localAnimals, catalogs] = await Promise.all([
      CattleRepository.getAllWithOptions(options),
      this.loadCatalogsFromLocal()
    ]);

    return {
      data: localAnimals.map((item) => this.toCattle(item)),
      ranches: catalogs.ranches,
      lots: catalogs.lots,
      source,
      warning
    };
  },

  async getById(id: string): Promise<Cattle | undefined> {
    let local = await CattleRepository.getByIdIncludingDeleted(id);

    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine &&
      (!local || local.syncStatus === 'synced')
    ) {
      try {
        const remote = await cattleApi.getById(id);
        const mapped = mapBackendAnimalToLocal(remote, local);
        await CattleRepository.upsertFromServer([mapped]);
        local = await CattleRepository.getByIdIncludingDeleted(mapped.id);
      } catch {
        // Fallback silencioso a datos locales si está sin sesión o sin red
      }
    }

    return local ? this.toCattle(local) : undefined;
  },

  async attemptPushForEntity(idEntidad: string): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage:
          'Sin conexión: el cambio se guardó localmente en IndexedDB y se sincronizará automáticamente al recuperar Internet.'
      };
    }

    if (!readSessionAuthToken()) {
      return {
        synced: false,
        syncMessage:
          'Guardado localmente en IndexedDB. Inicia sesión para sincronizar este cambio con el servidor.'
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const entityOps = await OutboxRepository.getByEntity('cattle', idEntidad);
    const latestOp = entityOps[entityOps.length - 1];
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

  async create(rawInput: CattleInput): Promise<CattleMutationResult> {
    const normalized = normalizeCattleInput(rawInput);
    const catalogs = await this.loadCatalogsFromLocal();
    const duplicate = normalized.idRancho
      ? await CattleRepository.getByAreteInRanch(normalized.idRancho, normalized.arete)
      : undefined;

    const fieldErrors = validateCattleInput(normalized, {
      ranches: catalogs.ranches.length > 0 ? catalogs.ranches : undefined,
      lots: catalogs.lots.length > 0 ? catalogs.lots : undefined,
      duplicateAreteExists: Boolean(duplicate)
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos capturados.';
      throw new CattleValidationError(firstMsg, fieldErrors);
    }

    const idAnimal = crypto.randomUUID();
    const payload = this.toBackendPayload(idAnimal, normalized);

    const createdLocal = await CattleRepository.create(
      {
        id: idAnimal,
        ranchId: normalized.idRancho,
        arete: normalized.arete,
        areteSiniiga: normalized.arete,
        raza: normalized.raza,
        sexo: normalized.sexo,
        gender: normalized.sexo,
        fechaNacimiento: normalized.fechaNacimiento ?? undefined,
        fechaIngreso: normalized.fechaIngreso,
        procedencia: normalized.procedencia,
        estado: normalized.estado,
        fechaSalida: normalized.fechaSalida,
        observaciones: normalized.observaciones,
        loteId: normalized.idLote ?? undefined
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(createdLocal.id);
    const refreshed = (await CattleRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      animal: this.toCattle(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async update(id: string, rawInput: CattleInput): Promise<CattleMutationResult> {
    const existing = await CattleRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El animal que intentas editar no existe o fue desactivado.');
    }

    // Regla del Backend (`AnimalsController.Update`): el rancho del expediente es inmutable.
    const effectiveRanchId = existing.ranchId || rawInput.idRancho;
    const normalized = normalizeCattleInput({
      ...rawInput,
      idRancho: effectiveRanchId
    });

    const catalogs = await this.loadCatalogsFromLocal();
    const duplicate = normalized.idRancho
      ? await CattleRepository.getByAreteInRanch(normalized.idRancho, normalized.arete, existing.id)
      : undefined;

    const fieldErrors = validateCattleInput(normalized, {
      ranches: catalogs.ranches.length > 0 ? catalogs.ranches : undefined,
      lots: catalogs.lots.length > 0 ? catalogs.lots : undefined,
      duplicateAreteExists: Boolean(duplicate)
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos capturados.';
      throw new CattleValidationError(firstMsg, fieldErrors);
    }

    const idAnimal = typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const payload = this.toBackendPayload(idAnimal, normalized);

    const updatedLocal = await CattleRepository.update(
      existing.id,
      {
        ranchId: normalized.idRancho,
        arete: normalized.arete,
        areteSiniiga: normalized.arete,
        raza: normalized.raza,
        sexo: normalized.sexo,
        gender: normalized.sexo,
        fechaNacimiento: normalized.fechaNacimiento ?? undefined,
        fechaIngreso: normalized.fechaIngreso,
        procedencia: normalized.procedencia,
        estado: normalized.estado,
        fechaSalida: normalized.fechaSalida,
        observaciones: normalized.observaciones,
        loteId: normalized.idLote ?? undefined
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(updatedLocal.id);
    const refreshed = (await CattleRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      animal: this.toCattle(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  /**
   * Registra salida operativa (`Vendido` o `Baja`) conservando el expediente (Regla 08).
   */
  async registerExit(
    id: string,
    params: { estado: 'Vendido' | 'Baja'; fechaSalida: string; observaciones?: string | null }
  ): Promise<CattleMutationResult> {
    const existing = await CattleRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('Animal no encontrado para registrar salida.');
    }

    const current = this.toCattle(existing);
    const combinedNotes = params.observaciones?.trim()
      ? current.observaciones
        ? `${current.observaciones}\n${params.observaciones.trim()}`
        : params.observaciones.trim()
      : current.observaciones;

    return await this.update(existing.id, {
      idRancho: current.idRancho,
      idLote: current.idLote,
      arete: current.arete,
      raza: current.raza,
      sexo: current.sexo,
      fechaNacimiento: current.fechaNacimiento,
      fechaIngreso: current.fechaIngreso,
      procedencia: current.procedencia,
      estado: normalizeAnimalEstado(params.estado),
      fechaSalida: params.fechaSalida,
      observaciones: combinedNotes
    });
  },

  /**
   * Desactivación lógica (`DELETE /api/animales/{id}` / Push `Eliminar`) sin borrado en cascada (Regla 08).
   */
  async deactivate(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await CattleRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El animal no fue encontrado.');
    }

    await CattleRepository.softDelete(existing.id, {
      idAnimal: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity(existing.id);
  }
};
