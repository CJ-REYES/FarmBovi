import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalRanch } from '../schema';

class RanchTransactionalRepository extends BaseTransactionalRepository<LocalRanch> {
  constructor() {
    super('ranches', db.ranches);
  }

  async getActive(): Promise<LocalRanch[]> {
    const all = await this.getAll();
    return all.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }
}

export const RanchRepository = new RanchTransactionalRepository();
