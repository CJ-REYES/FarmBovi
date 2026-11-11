import { db } from '../db';
import type { LocalWeighing } from '../schema';

export const WeighingRepository = {
  async create(data: Omit<LocalWeighing, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<LocalWeighing> {
    const now = new Date().toISOString();
    const record: LocalWeighing = {
      id: data.id || crypto.randomUUID(),
      ...data,
      createdAt: now,
      updatedAt: now,
      syncStatus: data.syncStatus || 'pending'
    };
    await db.weighings.put(record);
    return record;
  },

  async getById(id: string): Promise<LocalWeighing | undefined> {
    return await db.weighings.get(id);
  },

  async getByCattleId(cattleId: string): Promise<LocalWeighing[]> {
    return await db.weighings.where('cattleId').equals(cattleId).filter(w => !w.deletedAt).toArray();
  },

  async getAll(): Promise<LocalWeighing[]> {
    return await db.weighings.filter(w => !w.deletedAt).toArray();
  },

  async update(id: string, changes: Partial<LocalWeighing>): Promise<void> {
    await db.weighings.update(id, {
      ...changes,
      updatedAt: new Date().toISOString()
    });
  },

  async delete(id: string): Promise<void> {
    await db.weighings.update(id, {
      deletedAt: new Date().toISOString(),
      syncStatus: 'pending',
      updatedAt: new Date().toISOString()
    });
  },

  async search(query: string): Promise<LocalWeighing[]> {
    const q = query.toLowerCase();
    return await db.weighings.filter(w => !w.deletedAt && (w.observaciones || '').toLowerCase().includes(q)).toArray();
  },

  async getPendingSync(): Promise<LocalWeighing[]> {
    return await db.weighings.where('syncStatus').equals('pending').toArray();
  }
};
