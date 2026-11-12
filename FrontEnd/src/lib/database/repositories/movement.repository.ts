import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { BaseTransactionalRepository } from './base-transactional.repository';
import { OutboxRepository } from './outbox.repository';
import type { LocalMovement } from '../schema';

class MovementTransactionalRepository extends BaseTransactionalRepository<LocalMovement> {
  constructor() {
    super('movements', db.movements);
  }

  async getByCattleId(cattleId: string): Promise<LocalMovement[]> {
    const items = await db.movements
      .where('cattleId')
      .equals(cattleId)
      .filter((m) => !m.deletedAt)
      .toArray();
    return items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  /**
   * Registra un traslado de lote, actualiza el lote actual del bovino y encola
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
    return await db.transaction('rw', [db.movements, db.cattle, db.outbox], async () => {
      const cattle = await db.cattle.get(input.cattleId);
      if (!cattle || cattle.deletedAt) {
        throw new Error('Bovino destino no encontrado para registrar movimiento.');
      }

      const now = new Date().toISOString();
      const movementId = crypto.randomUUID();

      const movement: LocalMovement = {
        id: movementId,
        localNumericId: computeStableNegativeId(movementId),
        ranchId: input.ranchId ?? cattle.ranchId,
        cattleId: cattle.id,
        origenLotId: input.origenLotId ?? cattle.loteId,
        destinoLotId: input.destinoLotId,
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
        idEntidad: movementId,
        tipoOperacion: 'CREATE',
        versionBase: null,
        payload: movement
      });
      await db.outbox.put(movementOutbox);

      if (input.destinoLotId !== undefined && input.destinoLotId !== cattle.loteId) {
        await db.cattle.update(cattle.id, {
          loteId: input.destinoLotId,
          updatedAt: now,
          syncStatus: 'pending'
        });

        const cattleOutbox = OutboxRepository.createOperationRecord({
          entidad: 'cattle',
          idEntidad: cattle.id,
          tipoOperacion: 'UPDATE',
          versionBase: cattle.serverVersion ?? null,
          payload: { loteId: input.destinoLotId }
        });
        await db.outbox.put(cattleOutbox);
      }

      return movement;
    });
  }
}

export const MovementRepository = new MovementTransactionalRepository();
