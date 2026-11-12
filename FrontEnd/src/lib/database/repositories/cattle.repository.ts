import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalCattle } from '../schema';

class CattleTransactionalRepository extends BaseTransactionalRepository<LocalCattle> {
  constructor() {
    super('cattle', db.cattle);
  }

  async getByEarTag(areteSiniiga: string): Promise<LocalCattle | undefined> {
    return await db.cattle
      .where('areteSiniiga')
      .equals(areteSiniiga)
      .filter((c) => !c.deletedAt)
      .first();
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
