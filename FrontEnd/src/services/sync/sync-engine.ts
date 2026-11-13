import { OutboxService } from './outbox.service';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { authApi, syncApi } from '../../lib/api';
import { db } from '../../lib/database/db';
import type { BaseLocalEntity, LocalServerChange } from '../../lib/database/schema';
import type { Table } from 'dexie';
import { BoviScaleAnalysisService } from '../boviscale-analysis.service';

const deletionTables: Record<string, Table<BaseLocalEntity, string> | undefined> = {
  Animal: db.cattle as unknown as Table<BaseLocalEntity, string>,
  Lote: db.lots as unknown as Table<BaseLocalEntity, string>,
  EventoSanitario: db.healthRecords as unknown as Table<BaseLocalEntity, string>,
  Alimentacion: db.feedingRecords as unknown as Table<BaseLocalEntity, string>,
  MovimientoAnimal: db.movements as unknown as Table<BaseLocalEntity, string>,
  Recordatorio: db.alerts as unknown as Table<BaseLocalEntity, string>,
};

export const SyncEngine = {
  isSyncing: false,

  async sync(): Promise<void> {
    if (this.isSyncing || typeof navigator === 'undefined' || !navigator.onLine) return;

    try {
      this.isSyncing = true;
      await this.pushChanges();
      await this.pullChanges();
      await BoviScaleAnalysisService.processPendingQueue();
    } catch (err) {
      console.error('Error en el ciclo de sincronización:', err);
    } finally {
      this.isSyncing = false;
    }
  },

  async pushChanges(): Promise<void> {
    const operations = await OutboxService.getPendingOperations();
    if (operations.length === 0) return;

    console.debug(
      `Outbox con ${operations.length} operación(es) lista(s) para envío cuando el endpoint esté disponible.`
    );
  },

  async pullChanges(): Promise<void> {
    const userId = authApi.userId();
    if (!userId || !authApi.token()) return;
    const checkpointKey = `serverChanges:${userId}`;
    let cursor = (await CheckpointRepository.getByEntity(checkpointKey))?.cursorOpaco ?? null;

    while (true) {
      const page = await syncApi.getChanges(cursor, 100);
      if (page.hayMas && page.cambios.length === 0) throw new Error('El servidor indicó más cambios sin entregar registros.');
      const now = new Date().toISOString();
      const inboxRows: LocalServerChange[] = page.cambios.map(change => ({
        ...change,
        recibidoEn: now,
        aplicadoEn: null,
      }));
      const tables = [db.serverChanges, db.syncCheckpoints, ...Object.values(deletionTables).filter((table): table is Table<BaseLocalEntity, string> => Boolean(table))];

      await db.transaction('rw', tables, async () => {
        if (inboxRows.length) await db.serverChanges.bulkPut(inboxRows);
        for (const change of inboxRows) {
          if (change.operacion !== 'eliminar') continue;
          const table = deletionTables[change.entidad];
          if (!table) continue;
          const remoteId = /^\d+$/.test(change.idRegistro) ? Number(change.idRegistro) : change.idRegistro;
          const matches = await table.where('remoteId').equals(remoteId).toArray();
          let applied = matches.length === 0;
          for (const record of matches) {
            if (record.syncStatus === 'pending' || record.syncStatus === 'conflict') continue;
            await table.update(record.id, { deletedAt: change.ocurrioEn, updatedAt: change.ocurrioEn, syncStatus: 'synced' });
            applied = true;
          }
          if (applied) await db.serverChanges.update(change.idCambio, { aplicadoEn: now });
        }
        await db.syncCheckpoints.put({
          entidad: checkpointKey,
          cursorOpaco: page.cursorSiguiente,
          ultimaFechaServidor: page.cambios.at(-1)?.ocurrioEn ?? null,
          actualizadoEn: now,
        });
      });

      cursor = page.cursorSiguiente;
      if (!page.hayMas) break;
    }
  }
};
