import { db } from '../db';
import type { LocalHealthRecord } from '../schema';

export const HealthRepository = {
  async create(data: Omit<LocalHealthRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<LocalHealthRecord> {
    const now = new Date().toISOString();
    const record: LocalHealthRecord = {
      id: data.id || crypto.randomUUID(),
      ...data,
      createdAt: now,
      updatedAt: now,
      syncStatus: data.syncStatus || 'pending'
    };
    await db.healthRecords.put(record);
    return record;
  },

  async getById(id: string): Promise<LocalHealthRecord | undefined> {
    return await db.healthRecords.get(id);
  },

  async getByCattleId(cattleId: string): Promise<LocalHealthRecord[]> {
    return await db.healthRecords.where('cattleId').equals(cattleId).filter(h => !h.deletedAt).toArray();
  },

  async getAll(): Promise<LocalHealthRecord[]> {
    return await db.healthRecords.filter(h => !h.deletedAt).toArray();
  },

  async update(id: string, changes: Partial<LocalHealthRecord>): Promise<void> {
    await db.healthRecords.update(id, {
      ...changes,
      updatedAt: new Date().toISOString()
    });
  },

  async delete(id: string): Promise<void> {
    await db.healthRecords.update(id, {
      deletedAt: new Date().toISOString(),
      syncStatus: 'pending',
      updatedAt: new Date().toISOString()
    });
  },

  async search(query: string): Promise<LocalHealthRecord[]> {
    const q = query.toLowerCase();
    return await db.healthRecords.filter(h => !h.deletedAt && h.descripcion.toLowerCase().includes(q)).toArray();
  },

  async getPendingSync(): Promise<LocalHealthRecord[]> {
    return await db.healthRecords.where('syncStatus').equals('pending').toArray();
  }
};
