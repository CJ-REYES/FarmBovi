import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalAlert } from '../schema';

class AlertTransactionalRepository extends BaseTransactionalRepository<LocalAlert> {
  constructor() {
    super('alerts', db.alerts);
  }

  async markAsRead(identifier: string | number): Promise<LocalAlert> {
    return await this.update(identifier, { leida: true }, { leida: true });
  }

  async getUnread(): Promise<LocalAlert[]> {
    return await db.alerts
      .filter((a) => !a.deletedAt && !a.leida)
      .toArray();
  }
}

export const AlertRepository = new AlertTransactionalRepository();
