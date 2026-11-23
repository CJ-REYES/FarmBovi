import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalHealthRecord } from '../schema';

function compareEventsChronologically(
  a: LocalHealthRecord,
  b: LocalHealthRecord,
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

class HealthTransactionalRepository extends BaseTransactionalRepository<LocalHealthRecord> {
  constructor() {
    super('healthRecords', db.healthRecords);
  }

  async getAllWithOptions(options?: {
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<LocalHealthRecord[]> {
    let items: LocalHealthRecord[];
    if (options?.cattleId) {
      items = await db.healthRecords.where('cattleId').equals(options.cattleId).toArray();
    } else {
      items = await db.healthRecords.toArray();
    }

    if (!options?.includeDeleted) {
      items = items.filter((h) => !h.deletedAt);
    }

    return items.sort((a, b) => compareEventsChronologically(a, b, options?.order ?? 'desc'));
  }

  async getByCattleId(cattleId: string): Promise<LocalHealthRecord[]> {
    return await this.getAllWithOptions({ cattleId, includeDeleted: false, order: 'desc' });
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalHealthRecord | undefined> {
    const direct = await db.healthRecords.get(id);
    if (direct) return direct;
    return await db.healthRecords.where('remoteId').equals(id).first();
  }
}

export const HealthRepository = new HealthTransactionalRepository();
