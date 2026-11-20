import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { BaseTransactionalRepository } from './base-transactional.repository';
import { OutboxRepository } from './outbox.repository';
import type { LocalMovement } from '../schema';
import type { BackendMovimientoAnimalPayload, MovementType } from '../../../types/movement';

function compareMovementsChronologically(
  a: LocalMovement,
  b: LocalMovement,
  order: 'asc' | 'desc' = 'desc'
): number {
  const timeA = Date.parse(a.fecha);
  const timeB = Date.parse(b.fecha);
  let diff =
    !Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB
      ? timeA - timeB
      : a.fecha.localeCompare(b.fecha);

  if (diff === 0) {
    diff = a.createdAt.localeCompare(b.createdAt);
  }
  if (diff === 0) {
    diff = a.id.localeCompare(b.id);
  }

  return order === 'asc' ? diff : -diff;
}

class MovementTransactionalRepository extends BaseTransactionalRepository<LocalMovement> {
  constructor() {
    super('movements', db.movements);
  }

  async getAllWithOptions(options?: {
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<LocalMovement[]> {
    let items: LocalMovement[];
    if (options?.cattleId) {
      items = await db.movements.where('cattleId').equals(options.cattleId).toArray();
    } else {
      items = await db.movements.toArray();
    }

    if (!options?.includeDeleted) {
      items = items.filter((m) => !m.deletedAt);
    }

    return items.sort((a, b) => compareMovementsChronologically(a, b, options?.order ?? 'desc'));
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalMovement | undefined> {
    const direct = await db.movements.get(id);
    if (direct) return direct;
    return await db.movements.where('remoteId').equals(id).first();
  }

  async getByCattleId(cattleId: string): Promise<LocalMovement[]> {
    return await this.getAllWithOptions({ cattleId, includeDeleted: false, order: 'desc' });
  }

  /**
   * Registra un movimiento de trazabilidad completo y aplica atómicamente los efectos
   * de dominio sobre el expediente del animal (`IdLote` en Alta/CambioInterno;
   * `Estado` + `FechaSalida` en Venta/Baja; reactivación en Alta) en una sola transacción Dexie.
   */
  async createMovementWithSideEffects(input: {
    idMovimiento: string;
    cattleId: string;
    ranchId: string;
    tipo: MovementType;
    fecha: string;
    origenLotId?: string;
    destinoLotId?: string;
    origenExterno?: string;
    destinoExterno?: string;
    motivo: string;
    backendPayload: BackendMovimientoAnimalPayload;
  }): Promise<LocalMovement> {
    return await db.transaction('rw', [db.movements, db.cattle, db.outbox], async () => {
      const cattle = await db.cattle.get(input.cattleId);
      if (!cattle || cattle.deletedAt) {
        throw new Error('Animal no encontrado para registrar movimiento.');
      }

      const now = new Date().toISOString();
      const movement: LocalMovement = {
        id: input.idMovimiento,
        localNumericId: computeStableNegativeId(input.idMovimiento),
        ranchId: input.ranchId || cattle.ranchId,
        cattleId: cattle.id,
        origenLotId: input.origenLotId,
        destinoLotId: input.destinoLotId,
        tipo: input.tipo,
        origenExterno: input.origenExterno,
        destinoExterno: input.destinoExterno,
        fecha: input.fecha,
        motivo: input.motivo,
        createdAt: now,
        updatedAt: now,
        syncStatus: 'pending',
        serverVersion: null,
        deletedAt: null
      };

      await db.movements.put(movement);

      const movementOutbox = OutboxRepository.createOperationRecord({
        entidad: 'movements',
        idEntidad: movement.id,
        tipoOperacion: 'CREATE',
        versionBase: null,
        payload: input.backendPayload
      });
      await db.outbox.put(movementOutbox);

      // Efectos atómicos equivalentes a `MovimientoAnimalController.Create` (Reglas 06 y 08)
      const cattleUpdates: Record<string, unknown> = {};
      const cattleOutboxPayload: Record<string, unknown> = {};

      if (input.tipo === 'Alta' || input.tipo === 'CambioInterno') {
        if (input.destinoLotId && input.destinoLotId !== cattle.loteId) {
          cattleUpdates.loteId = input.destinoLotId;
          cattleOutboxPayload.idLote = input.destinoLotId;
        }
        if (input.tipo === 'Alta' && cattle.estado !== 'Activo') {
          cattleUpdates.estado = 'Activo';
          cattleUpdates.fechaSalida = null;
          cattleOutboxPayload.estado = 'Activo';
          cattleOutboxPayload.fechaSalida = null;
        }
      } else if (input.tipo === 'Venta' || input.tipo === 'Baja') {
        const nextEstado = input.tipo === 'Venta' ? 'Vendido' : 'Baja';
        const fechaSalida = input.fecha.slice(0, 10);
        cattleUpdates.estado = nextEstado;
        cattleUpdates.fechaSalida = fechaSalida;
        cattleOutboxPayload.estado = nextEstado;
        cattleOutboxPayload.fechaSalida = fechaSalida;
      }

      if (Object.keys(cattleUpdates).length > 0) {
        await db.cattle.update(cattle.id, {
          ...cattleUpdates,
          updatedAt: now,
          syncStatus: 'pending'
        });

        const cattleOutbox = OutboxRepository.createOperationRecord({
          entidad: 'cattle',
          idEntidad: cattle.id,
          tipoOperacion: 'UPDATE',
          versionBase: cattle.serverVersion ?? null,
          payload: cattleOutboxPayload
        });
        await db.outbox.put(cattleOutbox);
      }

      return movement;
    });
  }

  /**
   * Registra un traslado interno de lote, actualiza el lote actual del bovino y encola
   * ambas mutaciones en el outbox dentro de una sola transacción Dexie.
   */
  async registerCattleTransfer(input: {
    cattleId: string;
    origenLotId?: string;
    destinoLotId?: string;
    fecha: string;
    motivo: string;
    ranchId?: string;
  }): Promise<LocalMovement> {
    const cattle = await db.cattle.get(input.cattleId);
    if (!cattle || cattle.deletedAt) {
      throw new Error('Bovino destino no encontrado para registrar movimiento.');
    }

    const movementId = crypto.randomUUID();
    const origenLotId = input.origenLotId ?? cattle.loteId;
    const payload: BackendMovimientoAnimalPayload = {
      idMovimiento: movementId,
      idAnimal: cattle.id,
      idLoteOrigen: origenLotId ?? null,
      idLoteDestino: input.destinoLotId ?? null,
      tipo: 'CambioInterno',
      fecha: input.fecha,
      origenExterno: null,
      destinoExterno: null,
      motivo: input.motivo.trim() || null
    };

    return await this.createMovementWithSideEffects({
      idMovimiento: movementId,
      cattleId: cattle.id,
      ranchId: input.ranchId ?? cattle.ranchId ?? '',
      tipo: 'CambioInterno',
      fecha: input.fecha,
      origenLotId,
      destinoLotId: input.destinoLotId,
      motivo: input.motivo,
      backendPayload: payload
    });
  }
}

export const MovementRepository = new MovementTransactionalRepository();
