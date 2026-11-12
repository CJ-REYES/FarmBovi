import { db } from '../db';
import type { LocalSyncCheckpoint } from '../schema';

export const CheckpointRepository = {
  async getByEntity(entidad: string): Promise<LocalSyncCheckpoint | undefined> {
    return await db.syncCheckpoints.get(entidad);
  },

  async getAll(): Promise<LocalSyncCheckpoint[]> {
    return await db.syncCheckpoints.toArray();
  },

  /**
   * Almacena el cursor opaco devuelto explícitamente por el servidor.
   * No debe invocarse sin una respuesta real del backend.
   */
  async saveServerCursor(
    entidad: string,
    cursorOpaco: string | null,
    ultimaFechaServidor?: string | null
  ): Promise<LocalSyncCheckpoint> {
    const checkpoint: LocalSyncCheckpoint = {
      entidad,
      cursorOpaco,
      ultimaFechaServidor: ultimaFechaServidor ?? null,
      actualizadoEn: new Date().toISOString()
    };
    await db.syncCheckpoints.put(checkpoint);
    return checkpoint;
  }
};
