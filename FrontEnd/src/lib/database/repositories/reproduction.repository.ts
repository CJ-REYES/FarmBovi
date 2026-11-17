import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalReproductionRecord } from '../schema';

class ReproductionTransactionalRepository extends BaseTransactionalRepository<LocalReproductionRecord> {
  constructor() {
    super('reproductionRecords', db.reproductionRecords);
  }

  async getByCattleId(cattleId: string): Promise<LocalReproductionRecord[]> {
    const items = await db.reproductionRecords
      .where('cattleId')
      .equals(cattleId)
      .filter((r) => !r.deletedAt)
      .toArray();
    return items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
}

export const ReproductionRepository = new ReproductionTransactionalRepository();
