import { db } from '../../lib/database/db';
import type { LocalCattle } from '../../lib/database/schema';

export interface SyncConflict {
  entityId: string;
  localData: Partial<LocalCattle>;
  serverData: Partial<LocalCattle>; // Lo que devuelve el 409 del backend
}

const conflictStore = new Map<string, SyncConflict>();

export const ConflictResolver = {
  async registerConflict(entityId: string, localData: Partial<LocalCattle>, serverData: Partial<LocalCattle>): Promise<void> {
    conflictStore.set(entityId, { entityId, localData, serverData });
    await db.cattle.update(entityId, { syncStatus: 'conflict' });
  },

  getPendingConflicts(): SyncConflict[] {
    return Array.from(conflictStore.values());
  },

  async resolveConflict(entityId: string, resolution: 'keep_local' | 'keep_server'): Promise<void> {
    const conflict = conflictStore.get(entityId);
    if (!conflict) return;

    if (resolution === 'keep_server') {
      // Sobrescribimos nuestra DB local con la verdad del servidor
      await db.cattle.update(entityId, {
        ...conflict.serverData,
        syncStatus: 'synced',
        serverVersion: conflict.serverData.serverVersion
      });
    } else {
      // Forzar local: Actualizamos la versión local a la del servidor para vencer el bloqueo If-Match
      await db.cattle.update(entityId, {
        syncStatus: 'pending',
        serverVersion: conflict.serverData.serverVersion
      });
      // (En producción, aquí se inyecta un nuevo evento UPDATE al Outbox)
    }

    conflictStore.delete(entityId);
  }
};
