import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalLot } from '../schema';

class LotTransactionalRepository extends BaseTransactionalRepository<LocalLot> {
  constructor() {
    super('lots', db.lots);
  }
}

export const LotRepository = new LotTransactionalRepository();
