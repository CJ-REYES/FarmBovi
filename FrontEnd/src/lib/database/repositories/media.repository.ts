import { db } from '../db';
import type { LocalMedia } from '../schema';

export const MediaRepository = {
  async saveCapture(
    fileOrBlob: Blob,
    tipo: 'FotoPerfil' | 'BoviScaleVision' | 'Documento',
    cattleId?: string
  ): Promise<LocalMedia> {
    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    if (fileOrBlob.size > MAX_SIZE_BYTES) {
      throw new Error('El archivo excede el límite máximo permitido de 10MB.');
    }

    const now = new Date().toISOString();
    const record: LocalMedia = {
      id: crypto.randomUUID(),
      cattleId,
      tipo,
      blobData: fileOrBlob,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending'
    };

    try {
      await db.media.put(record);
      return record;
    } catch (err) {
      console.error('Error al guardar Blob multimedia en IndexedDB:', err);
      throw new Error('Almacenamiento local lleno o cuota excedida en IndexedDB.', { cause: err });
    }
  },

  async getById(id: string): Promise<LocalMedia | undefined> {
    return await db.media.get(id);
  },

  async getByCattleId(cattleId: string): Promise<LocalMedia[]> {
    return await db.media.where('cattleId').equals(cattleId).filter(m => !m.deletedAt).toArray();
  },

  async getPendingSync(): Promise<LocalMedia[]> {
    return await db.media.where('syncStatus').equals('pending').toArray();
  }
};
