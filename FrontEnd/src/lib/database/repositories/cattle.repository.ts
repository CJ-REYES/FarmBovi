import { db } from '../db';
import type { LocalCattle } from '../schema';

export const CattleRepository = {
  async create(data: Omit<LocalCattle, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<LocalCattle> {
    const now = new Date().toISOString();
    const record: LocalCattle = {
      id: data.id || crypto.randomUUID(),
      ...data,
      createdAt: now,
      updatedAt: now,
      syncStatus: data.syncStatus || 'pending'
    };
    await db.cattle.put(record);
    return record;
  },

  async getById(id: string): Promise<LocalCattle | undefined> {
    return await db.cattle.get(id);
  },

  async getByRemoteId(remoteId: number | string): Promise<LocalCattle | undefined> {
    return await db.cattle.where('remoteId').equals(remoteId).first();
  },

  async getAll(): Promise<LocalCattle[]> {
    return await db.cattle.filter(c => !c.deletedAt).toArray();
  },

  async update(id: string, changes: Partial<LocalCattle>): Promise<void> {
    await db.cattle.update(id, {
      ...changes,
      updatedAt: new Date().toISOString()
    });
  },

  async delete(id: string): Promise<void> {
    await db.cattle.update(id, {
      deletedAt: new Date().toISOString(),
      syncStatus: 'pending',
      updatedAt: new Date().toISOString()
    });
  },

  async search(query: string): Promise<LocalCattle[]> {
    const q = query.toLowerCase();
    return await db.cattle
      .filter(c => !c.deletedAt && (
        c.areteSiniiga.toLowerCase().includes(q) ||
        (c.nombre && c.nombre.toLowerCase().includes(q)) ||
        c.raza.toLowerCase().includes(q)
      ))
      .toArray();
  },

  async getPendingSync(): Promise<LocalCattle[]> {
    return await db.cattle.where('syncStatus').equals('pending').toArray();
  },

  async bulkUpsert(items: LocalCattle[]): Promise<void> {
    await db.cattle.bulkPut(items);
  }
};
