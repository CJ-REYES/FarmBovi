import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalLot } from '../schema';

class LotTransactionalRepository extends BaseTransactionalRepository<LocalLot> {
  constructor() {
    super('lots', db.lots);
  }

  async getByNameInRanch(
    ranchId: string,
    nombre: string,
    excludeId?: string
  ): Promise<LocalLot | undefined> {
    const normalized = nombre.trim().toLowerCase();
    return await db.lots
      .where('ranchId')
      .equals(ranchId)
      .filter(
        (l) =>
          !l.deletedAt &&
          l.id !== excludeId &&
          l.nombre.trim().toLowerCase() === normalized
      )
      .first();
  }

  async getAllWithOptions(options?: {
    ranchId?: string;
    includeDeleted?: boolean;
  }): Promise<LocalLot[]> {
    const collection = options?.ranchId
      ? db.lots.where('ranchId').equals(options.ranchId)
      : db.lots.toCollection();

    const items = options?.includeDeleted
      ? await collection.toArray()
      : await collection.filter((l) => !l.deletedAt).toArray();

    return items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalLot | undefined> {
    return await this.resolveByIdentifier(id);
  }

  async countActiveAnimals(lotId: string): Promise<number> {
    return await db.cattle
      .where('loteId')
      .equals(lotId)
      .filter((c) => !c.deletedAt)
      .count();
  }
}

export const LotRepository = new LotTransactionalRepository();
