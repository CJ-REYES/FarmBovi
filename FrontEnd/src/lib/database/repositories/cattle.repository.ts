import { db } from '../db';
import type { LocalCattle, LocalOutboxQueue, OutboxOperationType } from '../schema';

export const CattleRepository = {

  /**
   * Ejecuta una operación de mutación (CRUD) y encola la petición en el Outbox
   * dentro de una transacción atómica segura.
   */
  async executeOutboxTransaction(
    data: Partial<LocalCattle>,
    operation: OutboxOperationType,
    payload?: unknown
  ): Promise<LocalCattle> {
    return await db.transaction('rw', db.cattle, db.outbox, async () => {
      const now = new Date().toISOString();
      let recordId = data.id;

      // 1. Modificar entidad principal
      if (operation === 'CREATE') {
        recordId = data.id || crypto.randomUUID();
        const record = {
          ...data,
          id: recordId,
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending'
        } as LocalCattle;
        await db.cattle.put(record);
      } else if (operation === 'UPDATE') {
        if (!recordId) throw new Error("ID requerido para UPDATE");
        await db.cattle.update(recordId, {
          ...data,
          updatedAt: now,
          syncStatus: 'pending'
        });
      } else if (operation === 'DELETE') {
        if (!recordId) throw new Error("ID requerido para DELETE");
        await db.cattle.update(recordId, {
          deletedAt: now, // Tombstone (Borrado lógico)
          syncStatus: 'pending',
          updatedAt: now
        });
      }

      // 2. Insertar tarea en la cola Outbox
      const outboxEntry: LocalOutboxQueue = {
        id: crypto.randomUUID(),
        entity: 'cattle',
        entityId: recordId!,
        operation: operation,
        payload: payload || data,
        createdAt: now,
        status: 'pending',
        attempts: 0
      };
      await db.outbox.put(outboxEntry);

      const finalRecord = await db.cattle.get(recordId!);
      return finalRecord!;
    });
  },

  async getById(id: string): Promise<LocalCattle | undefined> {
    return await db.cattle.get(id);
  },

  async getByRemoteId(remoteId: number | string): Promise<LocalCattle | undefined> {
    return await db.cattle.where('remoteId').equals(remoteId).first();
  },

  async getAll(): Promise<LocalCattle[]> {
    return await db.cattle.filter(c => !c.deletedAt).toArray();
  },

  async bulkUpsert(items: LocalCattle[]): Promise<void> {
    await db.cattle.bulkPut(items);
  }
};
