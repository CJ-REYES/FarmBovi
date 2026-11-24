import { db } from '../db';
import type {
  LocalSyncCheckpoint,
  RanchCheckpointCursor,
  SyncEntityName
} from '../schema';

export const CheckpointRepository = {
  async getByEntity(entidad: SyncEntityName): Promise<LocalSyncCheckpoint | undefined> {
    return await db.syncCheckpoints.get(entidad);
  },

  async getAll(): Promise<LocalSyncCheckpoint[]> {
    return await db.syncCheckpoints.toArray();
  },

  /**
   * Obtiene el cursor opaco confirmado para una entidad y (opcionalmente) un rancho específico.
   * Si el usuario trabaja con múltiples ranchos, cada rancho conserva su propio cursor en
   * `cursorsByRanch[ranchId]` sin sobreescribir ni mezclar cursores de otros ranchos.
   */
  extractCursorForRanch(
    checkpoint: LocalSyncCheckpoint | undefined,
    ranchId?: string | null
  ): string | null {
    if (!checkpoint) return null;
    if (ranchId) {
      const scoped = checkpoint.cursorsByRanch?.[ranchId];
      if (scoped !== undefined) {
        return scoped.cursorOpaco ?? null;
      }
      // Compatibilidad con checkpoints legados sin `cursorsByRanch`:
      // solo reutilizar el cursor raíz si corresponde al mismo rancho o si no tenía rancho asociado.
      if (!checkpoint.ranchId || checkpoint.ranchId === ranchId) {
        return checkpoint.cursorOpaco ?? null;
      }
      return null;
    }
    return checkpoint.cursorOpaco ?? null;
  },

  async getCursor(entidad: SyncEntityName, ranchId?: string | null): Promise<string | null> {
    const checkpoint = await db.syncCheckpoints.get(entidad);
    return this.extractCursorForRanch(checkpoint, ranchId);
  },

  /**
   * Construye el objeto LocalSyncCheckpoint siguiente manteniendo el cursor opaco
   * emitido por el servidor por rancho y preservando los cursores de otros ranchos.
   * Nunca sustituye el cursor por una fecha local.
   */
  buildNextCheckpoint(params: {
    entidad: SyncEntityName;
    ranchId?: string | null;
    currentCheckpoint?: LocalSyncCheckpoint;
    siguienteCursorOpaco: string | null;
    fechaServidor?: string;
  }): LocalSyncCheckpoint {
    const now = new Date().toISOString();
    const existingByRanch: Record<string, RanchCheckpointCursor> = {
      ...(params.currentCheckpoint?.cursorsByRanch ?? {})
    };

    // Migrar cursor legado al mapa por rancho si el checkpoint previo pertenecía a otro rancho
    if (
      params.currentCheckpoint?.ranchId &&
      !existingByRanch[params.currentCheckpoint.ranchId] &&
      params.currentCheckpoint.cursorOpaco !== undefined
    ) {
      existingByRanch[params.currentCheckpoint.ranchId] = {
        cursorOpaco: params.currentCheckpoint.cursorOpaco,
        ultimaFechaServidor: params.currentCheckpoint.ultimaFechaServidor ?? null,
        actualizadoEn: params.currentCheckpoint.actualizadoEn
      };
    }

    const previousScopedCursor = this.extractCursorForRanch(
      params.currentCheckpoint,
      params.ranchId
    );
    const resolvedCursor =
      params.siguienteCursorOpaco !== null
        ? params.siguienteCursorOpaco
        : previousScopedCursor;

    const previousServerDate =
      params.ranchId && existingByRanch[params.ranchId]
        ? existingByRanch[params.ranchId].ultimaFechaServidor ?? null
        : (params.currentCheckpoint?.ultimaFechaServidor ?? null);

    const resolvedServerDate =
      params.fechaServidor !== undefined ? params.fechaServidor : previousServerDate;

    if (params.ranchId) {
      existingByRanch[params.ranchId] = {
        cursorOpaco: resolvedCursor,
        ultimaFechaServidor: resolvedServerDate,
        actualizadoEn: now
      };
    }

    return {
      entidad: params.entidad,
      ranchId: params.ranchId ?? params.currentCheckpoint?.ranchId ?? null,
      cursorOpaco: resolvedCursor,
      ultimaFechaServidor: resolvedServerDate,
      actualizadoEn: now,
      ...(Object.keys(existingByRanch).length > 0 ? { cursorsByRanch: existingByRanch } : {})
    };
  },

  async clearForRanch(ranchId: string): Promise<void> {
    if (!ranchId) return;
    await db.transaction('rw', [db.syncCheckpoints], async () => {
      const all = await db.syncCheckpoints.toArray();
      for (const cp of all) {
        const nextMap = { ...(cp.cursorsByRanch ?? {}) };
        delete nextMap[ranchId];
        const remainingEntries = Object.entries(nextMap);

        if (remainingEntries.length === 0 && (!cp.ranchId || cp.ranchId === ranchId)) {
          await db.syncCheckpoints.delete(cp.entidad);
          continue;
        }

        const fallbackEntry = remainingEntries[0];
        await db.syncCheckpoints.put({
          ...cp,
          ranchId: cp.ranchId === ranchId ? (fallbackEntry?.[0] ?? null) : cp.ranchId,
          cursorOpaco:
            cp.ranchId === ranchId ? (fallbackEntry?.[1].cursorOpaco ?? null) : cp.cursorOpaco,
          cursorsByRanch: remainingEntries.length > 0 ? nextMap : undefined
        });
      }
    });
  }
};
