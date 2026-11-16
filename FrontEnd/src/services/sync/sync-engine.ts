import { OutboxService } from './outbox.service';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { authApi, syncApi } from '../../lib/api';
import { db } from '../../lib/database/db';
import type { LocalServerChange } from '../../lib/database/schema';
import { BoviScaleAnalysisService } from '../boviscale-analysis.service';
import { RemoteChangeProjector } from './remote-change-projector';

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

    // Retry durable inbox rows first; a previous dependency or IndexedDB error never loses them.
    await this.applyPending(checkpointKey);

    while (true) {
      const page = await syncApi.getChanges(cursor, 100);
      if (page.hayMas && page.cambios.length === 0) throw new Error('El servidor indicó más cambios sin entregar registros.');
      const now = new Date().toISOString();
      const inboxRows: LocalServerChange[] = page.cambios.map(change => ({
        ...change,
        recibidoEn: now,
        aplicadoEn: null,
      }));
      const tables = [db.serverChanges, db.syncCheckpoints, ...RemoteChangeProjector.tables];

      await db.transaction('rw', tables, async () => {
        if (inboxRows.length) await db.serverChanges.bulkPut(inboxRows);
        for (const change of inboxRows) {
          if (await RemoteChangeProjector.apply(change, now)) await db.serverChanges.update(change.idCambio, { aplicadoEn: now });
        }
        await db.syncCheckpoints.put({
          entidad: checkpointKey,
          cursorOpaco: page.cursorSiguiente,
          ultimaFechaServidor: page.cambios.at(-1)?.ocurrioEn ?? null,
          actualizadoEn: now,
        });
      });

      if (inboxRows.length) window.dispatchEvent(new Event('farmbovi:changes-applied'));

      cursor = page.cursorSiguiente;
      if (!page.hayMas) break;
    }
  },

  async applyPending(checkpointKey: string): Promise<void> {
    // Null values are not indexed consistently by IndexedDB implementations.
    const inbox = (await db.serverChanges.toArray()).filter(row => row.aplicadoEn == null);
    if (!inbox.length) return;
    const now = new Date().toISOString();
    await db.transaction('rw', [db.serverChanges, db.syncCheckpoints, ...RemoteChangeProjector.tables], async () => {
      for (const change of inbox) {
        if (await RemoteChangeProjector.apply(change, now)) await db.serverChanges.update(change.idCambio, { aplicadoEn: now });
      }
      const checkpoint = await db.syncCheckpoints.get(checkpointKey);
      if (checkpoint) await db.syncCheckpoints.put({ ...checkpoint, actualizadoEn: now });
    });
    window.dispatchEvent(new Event('farmbovi:changes-applied'));
  }
};
