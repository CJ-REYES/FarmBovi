import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalReproductionRecord } from '../schema';

function compareReproductionChronologically(
  a: LocalReproductionRecord,
  b: LocalReproductionRecord,
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

class ReproductionTransactionalRepository extends BaseTransactionalRepository<LocalReproductionRecord> {
  constructor() {
    super('reproductionRecords', db.reproductionRecords);
  }

  async getAllWithOptions(options?: {
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<LocalReproductionRecord[]> {
    let items: LocalReproductionRecord[];
    if (options?.cattleId) {
      items = await db.reproductionRecords.where('cattleId').equals(options.cattleId).toArray();
    } else {
      items = await db.reproductionRecords.toArray();
    }

    if (!options?.includeDeleted) {
      items = items.filter((r) => !r.deletedAt);
    }

    return items.sort((a, b) =>
      compareReproductionChronologically(a, b, options?.order ?? 'desc')
    );
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalReproductionRecord | undefined> {
    const direct = await db.reproductionRecords.get(id);
    if (direct) return direct;
    return await db.reproductionRecords.where('remoteId').equals(id).first();
  }

  async getByCattleId(cattleId: string): Promise<LocalReproductionRecord[]> {
    return await this.getAllWithOptions({
      cattleId,
      includeDeleted: false,
      order: 'desc'
    });
  }
}

export const ReproductionRepository = new ReproductionTransactionalRepository();
