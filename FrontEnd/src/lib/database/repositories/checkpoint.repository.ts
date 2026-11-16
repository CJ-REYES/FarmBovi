import { db } from '../db';
import type { LocalSyncCheckpoint, SyncEntityName } from '../schema';

export const CheckpointRepository = {
  async getByEntity(entidad: SyncEntityName): Promise<LocalSyncCheckpoint | undefined> {
    return await db.syncCheckpoints.get(entidad);
  },

  async getAll(): Promise<LocalSyncCheckpoint[]> {
    return await db.syncCheckpoints.toArray();
  },

  async getCursor(entidad: SyncEntityName): Promise<string | null> {
    const checkpoint = await db.syncCheckpoints.get(entidad);
    return checkpoint?.cursorOpaco ?? null;
  },

  /**
   * Construye el objeto LocalSyncCheckpoint siguiente manteniendo el cursor opaco
   * emitido por el servidor. Nunca sustituye el cursor por una fecha local.
   */
  buildNextCheckpoint(params: {
    entidad: SyncEntityName;
    currentCheckpoint?: LocalSyncCheckpoint;
    siguienteCursorOpaco: string | null;
    fechaServidor?: string;
  }): LocalSyncCheckpoint {
    const resolvedCursor =
      params.siguienteCursorOpaco !== null
        ? params.siguienteCursorOpaco
        : (params.currentCheckpoint?.cursorOpaco ?? null);

    const resolvedServerDate =
      params.fechaServidor !== undefined
        ? params.fechaServidor
        : (params.currentCheckpoint?.ultimaFechaServidor ?? null);

    return {
      entidad: params.entidad,
      cursorOpaco: resolvedCursor,
      ultimaFechaServidor: resolvedServerDate,
      actualizadoEn: new Date().toISOString()
    };
  }
};
