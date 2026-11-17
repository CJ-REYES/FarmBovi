import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalFeedingRecord } from '../schema';

class FeedingTransactionalRepository extends BaseTransactionalRepository<LocalFeedingRecord> {
  constructor() {
    super('feedingRecords', db.feedingRecords);
  }

  async getByLotId(lotId: string): Promise<LocalFeedingRecord[]> {
    const items = await db.feedingRecords
      .where('lotId')
      .equals(lotId)
      .filter((f) => !f.deletedAt)
      .toArray();
    return items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
}

export const FeedingRepository = new FeedingTransactionalRepository();
