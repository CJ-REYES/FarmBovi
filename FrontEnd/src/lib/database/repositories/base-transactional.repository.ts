import type { Table, UpdateSpec } from 'dexie';
import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { OutboxRepository } from './outbox.repository';
import type {
  BaseLocalEntity,
  LocalOutboxQueue,
  OutboxOperationType,
  SyncEntityName
} from '../schema';

const inFlightOperationKeys = new Set<string>();

function canonicalSerialize(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSerialize(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalSerialize(record[k])}`);
  return `{${entries.join(',')}}`;
}

export class BaseTransactionalRepository<T extends BaseLocalEntity> {
  protected readonly entityName: SyncEntityName;
  protected readonly table: Table<T, string>;

  constructor(entityName: SyncEntityName, table: Table<T, string>) {
    this.entityName = entityName;
    this.table = table;
  }

  protected async resolveNextEntityTimestamp(idEntidad: string): Promise<string> {
    const existingOps = await db.outbox.where('idEntidad').equals(idEntidad).toArray();
    const nowMs = Date.now();
    if (existingOps.length === 0) {
      return new Date(nowMs).toISOString();
    }

    const maxExistingMs = existingOps.reduce((max, op) => {
      const parsed = Date.parse(op.fechaCreacion);
      return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    const safeMs = Math.max(nowMs, maxExistingMs + 1);
    return new Date(safeMs).toISOString();
  }

  protected async isDuplicatePendingOperation(
    idEntidad: string,
    tipoOperacion: OutboxOperationType,
    payload: unknown
  ): Promise<boolean> {
    const existingOps = await db.outbox.where('idEntidad').equals(idEntidad).toArray();
    const activeOps = existingOps.filter(
      (op) => op.estado === 'pendiente' || op.estado === 'en_proceso'
    );
    if (activeOps.length === 0) return false;

    activeOps.sort((a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion));
    const latestOp = activeOps[activeOps.length - 1];

    if (latestOp.tipoOperacion !== tipoOperacion) return false;
    if (tipoOperacion === 'DELETE') return true;

    return canonicalSerialize(latestOp.payload) === canonicalSerialize(payload);
  }

  async executeOutboxTransaction(
    data: Partial<T>,
    operation: OutboxOperationType,
    payload?: unknown
  ): Promise<T> {
    const lockTarget = String(data.id ?? canonicalSerialize(payload ?? data));
    const lockKey = `${this.entityName}:${operation}:${lockTarget}`;

    if (inFlightOperationKeys.has(lockKey)) {
      throw new Error('Operación duplicada bloqueada: ya existe una transacción en curso.');
    }

    inFlightOperationKeys.add(lockKey);

    try {
      return await db.transaction('rw', [this.table, db.outbox], async () => {
        let recordId = data.id;

        if (operation === 'CREATE') {
          recordId = data.id || crypto.randomUUID();
          const now = await this.resolveNextEntityTimestamp(recordId);
          const effectivePayload = payload ?? data;

          const existingRecord = await this.table.get(recordId);
          if (existingRecord && !existingRecord.deletedAt) {
            const isDup = await this.isDuplicatePendingOperation(
              recordId,
              'CREATE',
              effectivePayload
            );
            if (isDup) {
              return existingRecord;
            }
          }

          const newRecord = {
            ...(data as T),
            id: recordId,
            localNumericId: data.localNumericId ?? computeStableNegativeId(recordId),
            createdAt: now,
            updatedAt: now,
            syncStatus: 'pending',
            serverVersion: null,
            deletedAt: null
          } as T;

          await this.table.put(newRecord);

          const outboxEntry: LocalOutboxQueue = {
            ...OutboxRepository.createOperationRecord({
              entidad: this.entityName,
              idEntidad: recordId,
              tipoOperacion: 'CREATE',
              versionBase: null,
              payload: effectivePayload
            }),
            fechaCreacion: now
          };

          await db.outbox.put(outboxEntry);
          const persisted = await this.table.get(recordId);
          if (!persisted) {
            throw new Error(`No se pudo confirmar la creación local en ${this.entityName}.`);
          }
          return persisted;
        }

        if (!recordId) {
          throw new Error(`Identificador local requerido para ${operation} en ${this.entityName}.`);
        }

        const current = await this.table.get(recordId);
        if (!current) {
          throw new Error(`Registro no encontrado en ${this.entityName} para ${operation}.`);
        }

        if (current.deletedAt) {
          if (operation === 'DELETE') {
            return current;
          }
          throw new Error(`No se puede modificar un registro eliminado en ${this.entityName}.`);
        }

        const effectivePayload = payload ?? data;
        const isDuplicate = await this.isDuplicatePendingOperation(
          recordId,
          operation,
          effectivePayload
        );
        if (isDuplicate) {
          return current;
        }

        const now = await this.resolveNextEntityTimestamp(recordId);
        const versionBase: number | string | null = current.serverVersion ?? null;

        if (operation === 'UPDATE') {
          const updateChanges = {
            ...data,
            id: current.id,
            localNumericId: current.localNumericId ?? computeStableNegativeId(current.id),
            updatedAt: now,
            syncStatus: 'pending'
          } as UpdateSpec<T>;
          await this.table.update(recordId, updateChanges);
        } else if (operation === 'DELETE') {
          const tombstoneChanges: Partial<BaseLocalEntity> = {
            deletedAt: now,
            updatedAt: now,
            syncStatus: 'pending'
          };
          await this.table.update(recordId, tombstoneChanges as unknown as UpdateSpec<T>);
        }

        const outboxEntry: LocalOutboxQueue = {
          ...OutboxRepository.createOperationRecord({
            entidad: this.entityName,
            idEntidad: recordId,
            tipoOperacion: operation,
            versionBase,
            payload: effectivePayload
          }),
          fechaCreacion: now
        };

        await db.outbox.put(outboxEntry);

        const updatedRecord = await this.table.get(recordId);
        if (!updatedRecord) {
          throw new Error(`Fallo al verificar consistencia tras ${operation} en ${this.entityName}.`);
        }
        return updatedRecord;
      });
    } finally {
      inFlightOperationKeys.delete(lockKey);
    }
  }

  async create(
    data: Omit<T, keyof BaseLocalEntity> & Partial<BaseLocalEntity>,
    payload?: unknown
  ): Promise<T> {
    return await this.executeOutboxTransaction(data as Partial<T>, 'CREATE', payload ?? data);
  }

  async update(identifier: string | number, changes: Partial<T>, payload?: unknown): Promise<T> {
    const existing = await this.resolveByIdentifier(identifier);
    if (!existing) {
      throw new Error(`Registro no encontrado en ${this.entityName} para actualización.`);
    }
    return await this.executeOutboxTransaction(
      { ...changes, id: existing.id },
      'UPDATE',
      payload ?? changes
    );
  }

  async softDelete(identifier: string | number, payload?: unknown): Promise<void> {
    const existing = await this.resolveByIdentifier(identifier);
    if (!existing) return;

    await this.executeOutboxTransaction(
      { id: existing.id } as Partial<T>,
      'DELETE',
      payload ?? { id: existing.remoteId ?? existing.id }
    );
  }

  async getById(id: string): Promise<T | undefined> {
    const record = await this.table.get(id);
    return record && !record.deletedAt ? record : undefined;
  }

  async getByRemoteId(remoteId: string | number): Promise<T | undefined> {
    const record = await this.table.where('remoteId').equals(remoteId).first();
    return record && !record.deletedAt ? record : undefined;
  }

  async getByLocalNumericId(localNumericId: number): Promise<T | undefined> {
    const record = await this.table.where('localNumericId').equals(localNumericId).first();
    return record && !record.deletedAt ? record : undefined;
  }

  async resolveByIdentifier(identifier: string | number): Promise<T | undefined> {
    if (typeof identifier === 'string') {
      const byUuid = await this.table.get(identifier);
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
  }

  async getAll(): Promise<T[]> {
    return await this.table.filter((item) => !item.deletedAt).toArray();
  }

  /**
   * Hidrata únicamente registros confirmados por el servidor central sin pisar
   * mutaciones locales pendientes o en conflicto.
   */
  async upsertFromServer(serverItems: T[]): Promise<void> {
    if (serverItems.length === 0) return;

    await db.transaction('rw', [this.table], async () => {
      for (const item of serverItems) {
        if (item.syncStatus !== 'synced') {
          throw new Error(
            `upsertFromServer solo acepta registros confirmados por servidor en ${this.entityName}.`
          );
        }

        const existing =
          (item.remoteId !== undefined && item.remoteId !== null
            ? await this.table.where('remoteId').equals(item.remoteId).first()
            : undefined) ?? (await this.table.get(item.id));

        if (existing && (existing.syncStatus === 'pending' || existing.syncStatus === 'conflict')) {
          continue;
        }

        const stableId = existing?.id || item.id || crypto.randomUUID();
        const normalized: T = {
          ...item,
          id: stableId,
          localNumericId: existing?.localNumericId ?? computeStableNegativeId(stableId),
          syncStatus: 'synced'
        };

        await this.table.put(normalized);
      }
    });
  }

  /**
   * Importación transaccional por lotes (utilizada por MigrationService):
   * - Registros con syncStatus === 'synced' se hidratan sin pisar cambios pendientes.
   * - Registros no sincronizados se guardan junto con su operación en db.outbox
   *   dentro de la misma transacción Dexie.
   */
  async bulkUpsert(items: T[]): Promise<void> {
    if (items.length === 0) return;

    await db.transaction('rw', [this.table, db.outbox], async () => {
      const now = new Date().toISOString();

      for (const item of items) {
        const existing =
          (item.remoteId !== undefined && item.remoteId !== null
            ? await this.table.where('remoteId').equals(item.remoteId).first()
            : undefined) ?? (await this.table.get(item.id));

        if (existing && (existing.syncStatus === 'pending' || existing.syncStatus === 'conflict')) {
          continue;
        }

        const stableId = existing?.id || item.id || crypto.randomUUID();
        const localNumericId =
          existing?.localNumericId ?? item.localNumericId ?? computeStableNegativeId(stableId);

        if (item.syncStatus === 'synced') {
          const syncedRecord: T = {
            ...item,
            id: stableId,
            localNumericId,
            syncStatus: 'synced'
          };
          await this.table.put(syncedRecord);
        } else {
          const pendingRecord: T = {
            ...item,
            id: stableId,
            localNumericId,
            createdAt: item.createdAt || now,
            updatedAt: now,
            syncStatus: 'pending',
            deletedAt: item.deletedAt ?? null
          };
          await this.table.put(pendingRecord);

          const outboxOp = OutboxRepository.createOperationRecord({
            entidad: this.entityName,
            idEntidad: stableId,
            tipoOperacion: existing ? 'UPDATE' : 'CREATE',
            versionBase: existing?.serverVersion ?? null,
            payload: pendingRecord
          });
          await db.outbox.put(outboxOp);
        }
      }
    });
  }
}
