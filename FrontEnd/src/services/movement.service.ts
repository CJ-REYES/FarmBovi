import {
  ApiError,
  movementsApi,
  readSessionAuthToken
} from '../lib/api';
import { computeStableNegativeId } from '../lib/database/migrations';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { MovementRepository } from '../lib/database/repositories/movement.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import type { LocalLot, LocalMovement } from '../lib/database/schema';
import type { Cattle, LotOption } from '../types/cattle';
import type {
  BackendMovimientoAnimalDto,
  BackendMovimientoAnimalPayload,
  Movement,
  MovementInput
} from '../types/movement';
import { CattleService } from './cattle.service';
import {
  normalizeMovementInput,
  normalizeMovementType,
  validateMovementInput,
  type MovementValidationErrors
} from './movement.validation';
import { PushSyncEngine } from './sync/push-sync.engine';

export class MovementValidationError extends Error {
  readonly fieldErrors: MovementValidationErrors;

  constructor(message: string, fieldErrors: MovementValidationErrors) {
    super(message);
    this.name = 'MovementValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface MovementMutationResult {
  movement: Movement;
  synced: boolean;
  syncMessage?: string;
}

export interface MovementLoadResult {
  data: Movement[];
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

function normalizeFechaForBackend(rawFecha: string): string {
  const trimmed = rawFecha.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  return trimmed;
}

function mapBackendMovementToLocal(
  remote: BackendMovimientoAnimalDto,
  ranchId: string | undefined,
  existing?: LocalMovement
): LocalMovement {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idMovimiento;

  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idMovimiento,
    ranchId: ranchId || existing?.ranchId,
    cattleId: remote.idAnimal,
    origenLotId: remote.idLoteOrigen ?? undefined,
    destinoLotId: remote.idLoteDestino ?? undefined,
    tipo: normalizeMovementType(remote.tipo),
    origenExterno: remote.origenExterno ?? undefined,
    destinoExterno: remote.destinoExterno ?? undefined,
    fecha: remote.fecha,
    motivo: remote.motivo ?? '',
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

export const MovementService = {
  toMovement(local: LocalMovement): Movement {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idMovimiento: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId,
      idLoteOrigen: local.origenLotId ?? null,
      idLoteDestino: local.destinoLotId ?? null,
      tipo: normalizeMovementType(local.tipo),
      fecha: local.fecha,
      origenExterno: local.origenExterno ?? null,
      destinoExterno: local.destinoExterno ?? null,
      motivo: local.motivo?.trim() ? local.motivo : null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toBackendPayload(idMovimiento: string, input: MovementInput): BackendMovimientoAnimalPayload {
    const normalized = normalizeMovementInput(input);
    return {
      idMovimiento,
      idAnimal: normalized.idAnimal,
      idLoteOrigen: normalized.idLoteOrigen,
      idLoteDestino: normalized.idLoteDestino,
      tipo: normalized.tipo,
      fecha: normalizeFechaForBackend(normalized.fecha),
      origenExterno: normalized.origenExterno,
      destinoExterno: normalized.destinoExterno,
      motivo: normalized.motivo
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
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<MovementLoadResult> {
    let source: 'server' | 'cache' = 'cache';
    let warning: string | null = null;

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteItems = await movementsApi.list(Boolean(options?.includeDeleted));
        const localAnimals = await CattleRepository.getAllWithOptions({ includeDeleted: true });
        const ranchByAnimalId = new Map<string, string>();
        for (const animal of localAnimals) {
          if (animal.ranchId) {
            ranchByAnimalId.set(animal.id, animal.ranchId);
            if (typeof animal.remoteId === 'string') {
              ranchByAnimalId.set(animal.remoteId, animal.ranchId);
            }
          }
        }

        const upserts: LocalMovement[] = [];
        for (const remote of remoteItems) {
          const existing = await MovementRepository.resolveByIdentifier(remote.idMovimiento);
          upserts.push(
            mapBackendMovementToLocal(remote, ranchByAnimalId.get(remote.idAnimal), existing)
          );
        }
        if (upserts.length > 0) {
          await MovementRepository.upsertFromServer(upserts);
        }
        source = 'server';
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          warning =
            'Sesión no autenticada en el servidor (401). Mostrando historial local guardado en IndexedDB.';
        } else if (err instanceof ApiError && err.status === 403) {
          warning =
            'Sin permisos para consultar movimientos en el servidor (403). Mostrando copia local.';
        } else {
          warning =
            err instanceof Error
              ? `${err.message} Mostrando historial guardado localmente.`
              : 'No se pudo consultar el servidor. Mostrando historial local.';
        }
      }
    }

    const [localMovements, context] = await Promise.all([
      MovementRepository.getAllWithOptions(options),
      this.loadContextData()
    ]);

    return {
      data: localMovements.map((item) => this.toMovement(item)),
      animals: context.animals,
      lots: context.lots,
      source,
      warning
    };
  },

  async getById(id: string): Promise<Movement | undefined> {
    let local = await MovementRepository.getByIdIncludingDeleted(id);

    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine &&
      (!local || local.syncStatus === 'synced')
    ) {
      try {
        const remote = await movementsApi.getById(id);
        const animal = await CattleRepository.resolveByIdentifier(remote.idAnimal);
        const mapped = mapBackendMovementToLocal(remote, animal?.ranchId, local);
        await MovementRepository.upsertFromServer([mapped]);
        local = await MovementRepository.getByIdIncludingDeleted(mapped.id);
      } catch {
        // Fallback a copia local si no hay sesión o red
      }
    }

    return local ? this.toMovement(local) : undefined;
  },

  async attemptPushForEntity(idEntidad: string): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage:
          'Sin conexión: el movimiento se guardó localmente en IndexedDB y se sincronizará al recuperar Internet.'
      };
    }

    if (!readSessionAuthToken()) {
      return {
        synced: false,
        syncMessage:
          'Guardado localmente en IndexedDB. Inicia sesión para sincronizar este movimiento con el servidor.'
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const ops = await OutboxRepository.getByEntity('movements', idEntidad);
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
          'El movimiento se guardó localmente, pero el servidor reportó un error al sincronizarlo.'
      };
    }

    return {
      synced: false,
      syncMessage: 'Movimiento guardado localmente y en cola de sincronización.'
    };
  },

  async create(rawInput: MovementInput): Promise<MovementMutationResult> {
    const normalized = normalizeMovementInput(rawInput);
    const { animals, lots } = await this.loadContextData();

    const fieldErrors = validateMovementInput(normalized, {
      animals,
      lots,
      isEditMode: false
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del movimiento.';
      throw new MovementValidationError(firstMsg, fieldErrors);
    }

    const animal = animals.find((a) => a.id === normalized.idAnimal)!;
    const idMovimiento = crypto.randomUUID();

    // Si es un cambio interno/traslado/venta/baja y el usuario dejó origen vacío,
    // usar el potrero actual del animal (siempre que no coincida con el destino).
    let effectiveOrigen = normalized.idLoteOrigen;
    if (
      !effectiveOrigen &&
      normalized.tipo !== 'Alta' &&
      animal.idLote &&
      animal.idLote !== normalized.idLoteDestino
    ) {
      effectiveOrigen = animal.idLote;
    }

    const finalInput: MovementInput = {
      ...normalized,
      idLoteOrigen: effectiveOrigen,
      fecha: normalizeFechaForBackend(normalized.fecha)
    };

    const payload = this.toBackendPayload(idMovimiento, finalInput);

    const createdLocal = await MovementRepository.createMovementWithSideEffects({
      idMovimiento,
      cattleId: animal.id,
      ranchId: animal.idRancho,
      tipo: finalInput.tipo,
      fecha: finalInput.fecha,
      origenLotId: finalInput.idLoteOrigen ?? undefined,
      destinoLotId: finalInput.idLoteDestino ?? undefined,
      origenExterno: finalInput.origenExterno ?? undefined,
      destinoExterno: finalInput.destinoExterno ?? undefined,
      motivo: finalInput.motivo ?? '',
      backendPayload: payload
    });

    const syncOutcome = await this.attemptPushForEntity(createdLocal.id);
    const refreshed =
      (await MovementRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      movement: this.toMovement(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async update(id: string, rawInput: MovementInput): Promise<MovementMutationResult> {
    const existing = await MovementRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El movimiento que intentas editar no existe o fue desactivado.');
    }

    // Regla del Backend (`SincronizacionController` AllowedUpdateProperties): IdAnimal es inmutable en edición.
    const normalized = normalizeMovementInput({
      ...rawInput,
      idAnimal: existing.cattleId
    });

    const { animals, lots } = await this.loadContextData();

    const fieldErrors = validateMovementInput(normalized, {
      animals,
      lots,
      isEditMode: true
    });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del movimiento.';
      throw new MovementValidationError(firstMsg, fieldErrors);
    }

    const idMovimiento = typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const finalInput: MovementInput = {
      ...normalized,
      fecha: normalizeFechaForBackend(normalized.fecha)
    };
    const payload = this.toBackendPayload(idMovimiento, finalInput);

    const updatedLocal = await MovementRepository.update(
      existing.id,
      {
        cattleId: existing.cattleId,
        ranchId: existing.ranchId,
        origenLotId: finalInput.idLoteOrigen ?? undefined,
        destinoLotId: finalInput.idLoteDestino ?? undefined,
        tipo: finalInput.tipo,
        origenExterno: finalInput.origenExterno ?? undefined,
        destinoExterno: finalInput.destinoExterno ?? undefined,
        fecha: finalInput.fecha,
        motivo: finalInput.motivo ?? ''
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(updatedLocal.id);
    const refreshed =
      (await MovementRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      movement: this.toMovement(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  /**
   * Desactivación lógica (`DELETE /api/movimientos-animales/{id}` / Push `Eliminar`).
   * Conserva el registro histórico de auditoría sin borrarlo físicamente.
   */
  async deactivate(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await MovementRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El movimiento no fue encontrado.');
    }

    await MovementRepository.softDelete(existing.id, {
      idMovimiento: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity(existing.id);
  }
};
