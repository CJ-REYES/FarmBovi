import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalCattle } from '../schema';

class CattleTransactionalRepository extends BaseTransactionalRepository<LocalCattle> {
  constructor() {
    super('cattle', db.cattle);
  }

  async getByEarTag(arete: string): Promise<LocalCattle | undefined> {
    const normalized = arete.trim().toLowerCase();
    return await db.cattle
      .filter(
        (c) =>
          !c.deletedAt &&
          (c.arete?.trim().toLowerCase() === normalized ||
            c.areteSiniiga?.trim().toLowerCase() === normalized)
      )
      .first();
  }

  async getByAreteInRanch(
    ranchId: string,
    arete: string,
    excludeId?: string
  ): Promise<LocalCattle | undefined> {
    const normalizedArete = arete.trim().toLowerCase();
    return await db.cattle
      .where('ranchId')
      .equals(ranchId)
      .filter(
        (c) =>
          !c.deletedAt &&
          c.id !== excludeId &&
          (c.arete?.trim().toLowerCase() === normalizedArete ||
            c.areteSiniiga?.trim().toLowerCase() === normalizedArete)
      )
      .first();
  }

  async getAllWithOptions(options?: {
    ranchId?: string;
    includeDeleted?: boolean;
  }): Promise<LocalCattle[]> {
    const collection = options?.ranchId
      ? db.cattle.where('ranchId').equals(options.ranchId)
      : db.cattle.toCollection();

    const items = options?.includeDeleted
      ? await collection.toArray()
      : await collection.filter((c) => !c.deletedAt).toArray();

    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalCattle | undefined> {
    return await this.resolveByIdentifier(id);
  }

  async getByLotId(loteId: string): Promise<LocalCattle[]> {
    return await db.cattle
      .where('loteId')
      .equals(loteId)
      .filter((c) => !c.deletedAt)
      .toArray();
  }
}

export const CattleRepository = new CattleTransactionalRepository();
