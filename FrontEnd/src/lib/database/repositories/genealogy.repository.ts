import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalGenealogy } from '../schema';

class GenealogyTransactionalRepository extends BaseTransactionalRepository<LocalGenealogy> {
  constructor() {
    super('genealogy', db.genealogy);
  }

  async getAllWithOptions(options?: {
    includeDeleted?: boolean;
  }): Promise<LocalGenealogy[]> {
    const items = await db.genealogy.toArray();
    const filtered = options?.includeDeleted
      ? items
      : items.filter((g) => !g.deletedAt);

    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalGenealogy | undefined> {
    const direct = await db.genealogy.get(id);
    if (direct) return direct;
    return await db.genealogy.where('remoteId').equals(id).first();
  }

  async getByCattleId(cattleId: string): Promise<LocalGenealogy | undefined> {
    return await db.genealogy
      .where('cattleId')
      .equals(cattleId)
      .filter((g) => !g.deletedAt)
      .first();
  }

  async getDescendantsOf(animalId: string): Promise<LocalGenealogy[]> {
    const [asFather, asMother] = await Promise.all([
      db.genealogy.where('padreId').equals(animalId).filter((g) => !g.deletedAt).toArray(),
      db.genealogy.where('madreId').equals(animalId).filter((g) => !g.deletedAt).toArray()
    ]);

    const uniqueByCattleId = new Map<string, LocalGenealogy>();
    for (const rec of [...asFather, ...asMother]) {
      if (!uniqueByCattleId.has(rec.cattleId)) {
        uniqueByCattleId.set(rec.cattleId, rec);
      }
    }

    return Array.from(uniqueByCattleId.values());
  }
}

export const GenealogyRepository = new GenealogyTransactionalRepository();
