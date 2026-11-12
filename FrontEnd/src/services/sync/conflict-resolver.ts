import { db } from '../../lib/database/db';
import { ConflictRepository } from '../../lib/database/repositories/conflict.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import type {
  ConflictType,
  LocalCattle,
  LocalOutboxQueue,
  LocalSyncConflict
} from '../../lib/database/schema';

export const ConflictResolver = {
  async registerConflict(params: {
    operacionLocal: LocalOutboxQueue;
    datosLocales: Partial<LocalCattle>;
    estadoServidor: Record<string, unknown> | null;
    versionServidor?: number | string | null;
    tipoConflicto?: ConflictType;
  }): Promise<LocalSyncConflict> {
    const { operacionLocal, datosLocales, estadoServidor, versionServidor, tipoConflicto } = params;

    return await db.transaction('rw', db.syncConflicts, db.cattle, db.outbox, async () => {
      const conflict = await ConflictRepository.create({
        idOperacion: operacionLocal.idOperacion,
        entidad: operacionLocal.entidad,
        idEntidad: operacionLocal.idEntidad,
        remoteId: datosLocales.remoteId ?? null,
        operacionLocal,
        datosLocales: datosLocales as Record<string, unknown>,
        versionBase: operacionLocal.versionBase,
        estadoServidor,
        versionServidor: versionServidor ?? null,
        tipoConflicto: tipoConflicto ?? 'VERSION_MISMATCH'
      });

      await OutboxRepository.markConflict(
        operacionLocal.idOperacion,
        `Conflicto detectado (${conflict.tipoConflicto})`
      );

      if (operacionLocal.entidad === 'cattle') {
        await db.cattle.update(operacionLocal.idEntidad, {
          syncStatus: 'conflict'
        });
      }

      return conflict;
    });
  },

  async getPendingConflicts(): Promise<LocalSyncConflict[]> {
    return await ConflictRepository.getPending();
  },

  async resolveConflict(
    idConflicto: string,
    resolution: 'keep_local' | 'keep_server'
  ): Promise<void> {
    const conflict = await ConflictRepository.getById(idConflicto);
    if (!conflict || conflict.estadoResolucion !== 'pendiente') return;

    await db.transaction('rw', db.syncConflicts, db.cattle, db.outbox, async () => {
      if (resolution === 'keep_server') {
        if (conflict.entidad === 'cattle' && conflict.estadoServidor) {
          await db.cattle.update(conflict.idEntidad, {
            ...(conflict.estadoServidor as Partial<LocalCattle>),
            syncStatus: 'synced',
            serverVersion: conflict.versionServidor ?? null,
            updatedAt: new Date().toISOString()
          });
        }
        await ConflictRepository.updateResolution(idConflicto, 'resuelto_servidor');
      } else {
        // Conserva cambios locales, actualiza la versión base y encola una nueva operación con UUID propio
        if (conflict.entidad === 'cattle') {
          await db.cattle.update(conflict.idEntidad, {
            syncStatus: 'pending',
            serverVersion: conflict.versionServidor ?? null,
            updatedAt: new Date().toISOString()
          });
        }

        await OutboxRepository.enqueue({
          entidad: conflict.entidad,
          idEntidad: conflict.idEntidad,
          tipoOperacion: 'UPDATE',
          versionBase: conflict.versionServidor ?? null,
          payload: conflict.datosLocales
        });

        await ConflictRepository.updateResolution(idConflicto, 'resuelto_local');
      }
    });
  }
};
