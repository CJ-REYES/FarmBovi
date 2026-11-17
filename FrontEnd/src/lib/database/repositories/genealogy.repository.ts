import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalGenealogy } from '../schema';

class GenealogyTransactionalRepository extends BaseTransactionalRepository<LocalGenealogy> {
  constructor() {
    super('genealogy', db.genealogy);
  }

  async getByCattleId(cattleId: string): Promise<LocalGenealogy | undefined> {
    return await db.genealogy
      .where('cattleId')
      .equals(cattleId)
      .filter((g) => !g.deletedAt)
      .first();
  }
}

export const GenealogyRepository = new GenealogyTransactionalRepository();
