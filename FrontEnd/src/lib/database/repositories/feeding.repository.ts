import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalFeedingRecord } from '../schema';

function compareFeedingChronologically(
  a: LocalFeedingRecord,
  b: LocalFeedingRecord,
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

class FeedingTransactionalRepository extends BaseTransactionalRepository<LocalFeedingRecord> {
  constructor() {
    super('feedingRecords', db.feedingRecords);
  }

  async getAllWithOptions(options?: {
    lotId?: string;
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<LocalFeedingRecord[]> {
    let items: LocalFeedingRecord[];
    if (options?.lotId) {
      items = await db.feedingRecords.where('lotId').equals(options.lotId).toArray();
    } else {
      items = await db.feedingRecords.toArray();
    }

    if (options?.cattleId) {
      items = items.filter((f) => f.cattleId === options.cattleId);
    }

    if (!options?.includeDeleted) {
      items = items.filter((f) => !f.deletedAt);
    }

    return items.sort((a, b) => compareFeedingChronologically(a, b, options?.order ?? 'desc'));
  }

  async getByLotId(lotId: string): Promise<LocalFeedingRecord[]> {
    return await this.getAllWithOptions({ lotId, includeDeleted: false, order: 'desc' });
  }

  async getByCattleId(cattleId: string): Promise<LocalFeedingRecord[]> {
    return await this.getAllWithOptions({ cattleId, includeDeleted: false, order: 'desc' });
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalFeedingRecord | undefined> {
    const direct = await db.feedingRecords.get(id);
    if (direct) return direct;
    return await db.feedingRecords.where('remoteId').equals(id).first();
  }
}

export const FeedingRepository = new FeedingTransactionalRepository();
