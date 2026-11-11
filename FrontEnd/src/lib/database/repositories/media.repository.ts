import { db } from '../db';
import type { LocalMedia } from '../schema';

export const MediaRepository = {
  async create(data: Omit<LocalMedia, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<LocalMedia> {
    const now = new Date().toISOString();
    const record: LocalMedia = {
      id: data.id || crypto.randomUUID(),
      ...data,
      createdAt: now,
      updatedAt: now,
      syncStatus: data.syncStatus || 'pending'
    };
    await db.media.put(record);
    return record;
  },

  async getById(id: string): Promise<LocalMedia | undefined> {
    return await db.media.get(id);
  },

  async getByCattleId(cattleId: string): Promise<LocalMedia[]> {
    return await db.media.where('cattleId').equals(cattleId).filter(m => !m.deletedAt).toArray();
  },

  async getAll(): Promise<LocalMedia[]> {
    return await db.media.filter(m => !m.deletedAt).toArray();
  },

  async update(id: string, changes: Partial<LocalMedia>): Promise<void> {
    await db.media.update(id, {
      ...changes,
      updatedAt: new Date().toISOString()
    });
  },

  async delete(id: string): Promise<void> {
    await db.media.update(id, {
      deletedAt: new Date().toISOString(),
      syncStatus: 'pending',
      updatedAt: new Date().toISOString()
    });
  },

  async search(query: string): Promise<LocalMedia[]> {
    const q = query.toLowerCase();
    return await db.media.filter(m => !m.deletedAt && m.tipo.toLowerCase().includes(q)).toArray();
  },

  async getPendingSync(): Promise<LocalMedia[]> {
    return await db.media.where('syncStatus').equals('pending').toArray();
  }
};
