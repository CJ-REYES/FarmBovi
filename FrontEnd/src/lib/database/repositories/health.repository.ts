import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalHealthRecord } from '../schema';

class HealthTransactionalRepository extends BaseTransactionalRepository<LocalHealthRecord> {
  constructor() {
    super('healthRecords', db.healthRecords);
  }

  async getByCattleId(cattleId: string): Promise<LocalHealthRecord[]> {
    const items = await db.healthRecords
      .where('cattleId')
      .equals(cattleId)
      .filter((h) => !h.deletedAt)
      .toArray();
    return items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
}

export const HealthRepository = new HealthTransactionalRepository();
