import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { OutboxRepository } from './outbox.repository';
import type { LocalCattle, OutboxOperationType } from '../schema';

export const CattleRepository = {
  async executeOutboxTransaction(
    data: Partial<LocalCattle>,
    operation: OutboxOperationType,
    payload?: unknown
  ): Promise<LocalCattle> {
    return await db.transaction('rw', db.cattle, db.outbox, async () => {
      const now = new Date().toISOString();
      let recordId = data.id;
      let versionBase: number | string | null = null;

      if (operation === 'CREATE') {
        recordId = data.id || crypto.randomUUID();
        const record: LocalCattle = {
          ...(data as LocalCattle),
          id: recordId,
          localNumericId: data.localNumericId ?? computeStableNegativeId(recordId),
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending',
          serverVersion: null,
          deletedAt: null
        };
        await db.cattle.put(record);
      } else if (operation === 'UPDATE') {
        if (!recordId) throw new Error('ID local requerido para UPDATE');
        const current = await db.cattle.get(recordId);
        if (!current) throw new Error('Registro local no encontrado para UPDATE');
        versionBase = current.serverVersion ?? null;

        await db.cattle.update(recordId, {
          ...data,
          localNumericId: current.localNumericId ?? computeStableNegativeId(recordId),
          updatedAt: now,
          syncStatus: 'pending'
        });
      } else if (operation === 'DELETE') {
        if (!recordId) throw new Error('ID local requerido para DELETE');
        const current = await db.cattle.get(recordId);
        if (!current) throw new Error('Registro local no encontrado para DELETE');
        versionBase = current.serverVersion ?? null;

        await db.cattle.update(recordId, {
          deletedAt: now,
          syncStatus: 'pending',
          updatedAt: now
        });
      }

      const outboxEntry = OutboxRepository.createOperationRecord({
        entidad: 'cattle',
        idEntidad: recordId!,
        tipoOperacion: operation,
        versionBase,
        payload: payload ?? data
      });

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

  async getByLocalNumericId(localNumericId: number): Promise<LocalCattle | undefined> {
    return await db.cattle.where('localNumericId').equals(localNumericId).first();
  },

  /**
   * Resuelve cualquier identificador estable (UUID local, localNumericId persistido o remoteId)
   * sin depender de mapas volátiles en memoria.
   */
  async resolveByIdentifier(identifier: string | number): Promise<LocalCattle | undefined> {
    if (typeof identifier === 'string') {
      const byUuid = await this.getById(identifier);
      if (byUuid) return byUuid;
      const parsed = Number(identifier);
      if (!Number.isNaN(parsed)) {
        return (await this.getByRemoteId(parsed)) ?? (await this.getByLocalNumericId(parsed));
      }
      return undefined;
    }

    if (identifier < 0) {
      return await this.getByLocalNumericId(identifier);
    }
    return (await this.getByRemoteId(identifier)) ?? (await this.getByLocalNumericId(identifier));
  },

  async getAll(): Promise<LocalCattle[]> {
    return await db.cattle.filter((c) => !c.deletedAt).toArray();
  },

  async bulkUpsert(items: LocalCattle[]): Promise<void> {
    const normalized = items.map((item) => ({
      ...item,
      localNumericId: item.localNumericId ?? computeStableNegativeId(item.id)
    }));
    await db.cattle.bulkPut(normalized);
  }
};
