import type { Table, UpdateSpec } from 'dexie';
import { db } from '../db';
import type {
  BaseLocalEntity,
  LocalOutboxQueue,
  LocalSyncConflict,
  OutboxOperationState,
  OutboxOperationType,
  SyncEntityName
} from '../schema';

export interface CreateOutboxOperationInput {
  entidad: SyncEntityName;
  idEntidad: string;
  tipoOperacion: OutboxOperationType;
  versionBase?: number | string | null;
  payload: unknown;
}

export interface MarkConflictInput {
  idOperacion: string;
  remoteId?: string | number | null;
  versionServidor?: number | string | null;
  estadoServidor?: Record<string, unknown> | null;
  mensaje?: string;
}

export const MAX_TRANSIENT_PUSH_RETRIES = 8;
export const MAX_PUSH_RETRY_ATTEMPTS = MAX_TRANSIENT_PUSH_RETRIES;

function getEntityTable(entidad: SyncEntityName): Table<BaseLocalEntity, string> | null {
  switch (entidad) {
    case 'cattle':
      return db.cattle;
    case 'weighings':
      return db.weighings;
    case 'healthRecords':
      return db.healthRecords;
    case 'feedingRecords':
      return db.feedingRecords;
    case 'reproductionRecords':
      return db.reproductionRecords;
    case 'lots':
      return db.lots;
    case 'movements':
      return db.movements;
    case 'genealogy':
      return db.genealogy;
    case 'alerts':
      return db.alerts;
    case 'media':
      return db.media;
    default:
      return null;
  }
}

function toRecordObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { valor: value };
}

export const OutboxRepository = {
  createOperationRecord(input: CreateOutboxOperationInput): LocalOutboxQueue {
    const permanentOperationId = crypto.randomUUID();
    return {
      id: permanentOperationId,
      idOperacion: permanentOperationId,
      entidad: input.entidad,
      idEntidad: input.idEntidad,
      tipoOperacion: input.tipoOperacion,
      versionBase: input.versionBase ?? null,
      payload: input.payload,
      estado: 'pendiente',
      fechaCreacion: new Date().toISOString(),
      intentos: 0,
      ultimoError: null,
      proximoIntento: null
    };
  },

  async enqueue(input: CreateOutboxOperationInput): Promise<LocalOutboxQueue> {
    const operation = this.createOperationRecord(input);
    await db.outbox.put(operation);
    return operation;
  },

  async getByOperationId(idOperacion: string): Promise<LocalOutboxQueue | undefined> {
    return await db.outbox.get(idOperacion);
  },

  async getAll(): Promise<LocalOutboxQueue[]> {
    return await db.outbox.orderBy('fechaCreacion').toArray();
  },

  async getUnconfirmedOrdered(): Promise<LocalOutboxQueue[]> {
    const all = await db.outbox.orderBy('fechaCreacion').toArray();
    return all.filter((op) => op.estado !== 'confirmado');
  },

  async getAllNonConfirmed(): Promise<LocalOutboxQueue[]> {
    return await this.getUnconfirmedOrdered();
  },

  async getDispatchableOperations(
    nowIso: string = new Date().toISOString()
  ): Promise<LocalOutboxQueue[]> {
    const unconfirmed = await this.getUnconfirmedOrdered();
    return unconfirmed.filter((op) => {
      if (op.estado === 'pendiente') {
        return true;
      }
      if (
        op.estado === 'fallido' &&
        op.proximoIntento !== null &&
        op.proximoIntento <= nowIso &&
        op.intentos < MAX_PUSH_RETRY_ATTEMPTS
      ) {
        return true;
      }
      return false;
    });
  },

  async getByEntity(entidad: SyncEntityName, idEntidad: string): Promise<LocalOutboxQueue[]> {
    const ops = await db.outbox
      .where('idEntidad')
      .equals(idEntidad)
      .filter((op) => op.entidad === entidad)
      .toArray();
    return ops.sort((a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion));
  },

  async getPendingByEntity(entidad: SyncEntityName, idEntidad: string): Promise<LocalOutboxQueue[]> {
    const ops = await db.outbox
      .where('idEntidad')
      .equals(idEntidad)
      .filter((op) => op.entidad === entidad && op.estado !== 'confirmado')
      .toArray();
    return ops.sort((a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion));
  },

  async recoverInterruptedOperations(activeInFlightIds: ReadonlySet<string>): Promise<number> {
    const stuckOps = await db.outbox.where('estado').equals('en_proceso').toArray();
    let recovered = 0;

    for (const op of stuckOps) {
      if (!activeInFlightIds.has(op.idOperacion)) {
        await db.outbox.update(op.idOperacion, {
          estado: 'pendiente'
        });
        recovered++;
      }
    }

    return recovered;
  },

  async markInProgress(idOperacion: string): Promise<LocalOutboxQueue | null> {
    return await db.transaction('rw', [db.outbox], async () => {
      const current = await db.outbox.get(idOperacion);
      if (!current) return null;
      if (
        current.estado === 'confirmado' ||
        current.estado === 'en_proceso' ||
        current.estado === 'conflicto'
      ) {
        return null;
      }

      const updated: LocalOutboxQueue = {
        ...current,
        estado: 'en_proceso'
      };
      await db.outbox.put(updated);
      return updated;
    });
  },

  async markConfirmed(params: {
    idOperacion: string;
    remoteId?: string | number | null;
    versionServidor?: number | string | null;
  }): Promise<void> {
    const existingOp = await db.outbox.get(params.idOperacion);
    if (!existingOp) return;

    const targetTable = getEntityTable(existingOp.entidad);
    const tables = targetTable ? [db.outbox, targetTable] : [db.outbox];

    await db.transaction('rw', tables, async () => {
      const currentOp = await db.outbox.get(params.idOperacion);
      if (!currentOp) return;

      await db.outbox.update(params.idOperacion, {
        estado: 'confirmado',
        ultimoError: null,
        proximoIntento: null
      });

      if (!targetTable) return;

      const entity = await targetTable.get(currentOp.idEntidad);
      if (!entity) return;

      const siblingOps = await db.outbox
        .where('idEntidad')
        .equals(currentOp.idEntidad)
        .filter((s) => s.entidad === currentOp.entidad && s.idOperacion !== params.idOperacion)
        .toArray();

      const hasRemainingConflict = siblingOps.some((s) => s.estado === 'conflicto');
      const hasRemainingPending = siblingOps.some(
        (s) => s.estado === 'pendiente' || s.estado === 'en_proceso' || s.estado === 'fallido'
      );

      const nextSyncStatus: BaseLocalEntity['syncStatus'] = hasRemainingConflict
        ? 'conflict'
        : hasRemainingPending
          ? 'pending'
          : 'synced';

      const nextRemoteId =
        params.remoteId !== undefined && params.remoteId !== null
          ? params.remoteId
          : entity.remoteId;

      const nextServerVersion =
        params.versionServidor !== undefined && params.versionServidor !== null
          ? params.versionServidor
          : entity.serverVersion;

      const entityPatch: Partial<BaseLocalEntity> = {
        remoteId: nextRemoteId,
        serverVersion: nextServerVersion,
        syncStatus: nextSyncStatus
      };

      await targetTable.update(entity.id, entityPatch as unknown as UpdateSpec<BaseLocalEntity>);
    });
  },

  async markConflict(
    paramsOrId: MarkConflictInput | string,
    mensaje?: string
  ): Promise<LocalSyncConflict | null> {
    const params: MarkConflictInput =
      typeof paramsOrId === 'string'
        ? { idOperacion: paramsOrId, mensaje }
        : paramsOrId;

    const existingOp = await db.outbox.get(params.idOperacion);
    if (!existingOp) return null;

    const targetTable = getEntityTable(existingOp.entidad);
    const tables = targetTable
      ? [db.outbox, db.syncConflicts, targetTable]
      : [db.outbox, db.syncConflicts];

    return await db.transaction('rw', tables, async () => {
      const currentOp = await db.outbox.get(params.idOperacion);
      if (!currentOp) return null;

      const now = new Date().toISOString();
      const updatedOp: LocalOutboxQueue = {
        ...currentOp,
        estado: 'conflicto',
        ultimoError: params.mensaje || 'Conflicto de versión con el servidor.',
        proximoIntento: null
      };
      await db.outbox.put(updatedOp);

      let entity: BaseLocalEntity | undefined;
      if (targetTable) {
        entity = await targetTable.get(currentOp.idEntidad);
        if (entity) {
          const patch: Partial<BaseLocalEntity> = { syncStatus: 'conflict' };
          await targetTable.update(entity.id, patch as unknown as UpdateSpec<BaseLocalEntity>);
        }
      }

      const existingConflict = await db.syncConflicts
        .where('idOperacion')
        .equals(params.idOperacion)
        .first();

      const conflictRecord: LocalSyncConflict = {
        idConflicto: existingConflict?.idConflicto ?? crypto.randomUUID(),
        idOperacion: currentOp.idOperacion,
        entidad: currentOp.entidad,
        idEntidad: currentOp.idEntidad,
        remoteId: params.remoteId ?? entity?.remoteId ?? null,
        operacionLocal: updatedOp,
        datosLocales: toRecordObject(currentOp.payload ?? entity),
        versionBase: currentOp.versionBase,
        estadoServidor: params.estadoServidor ?? null,
        versionServidor: params.versionServidor ?? null,
        tipoConflicto:
          params.estadoServidor && params.estadoServidor.eliminado === true
            ? 'DELETED_ON_SERVER'
            : 'VERSION_MISMATCH',
        estadoResolucion: 'pendiente',
        fechaDeteccion: existingConflict?.fechaDeteccion ?? now,
        fechaResolucion: null,
        notasResolucion: null
      };

      await db.syncConflicts.put(conflictRecord);
      return conflictRecord;
    });
  },

  async markValidationError(params: {
    idOperacion: string;
    mensaje: string;
    erroresCampos?: Record<string, string[]>;
  }): Promise<void> {
    const existingOp = await db.outbox.get(params.idOperacion);
    if (!existingOp) return;

    const targetTable = getEntityTable(existingOp.entidad);
    const tables = targetTable ? [db.outbox, targetTable] : [db.outbox];

    const fieldSummary = params.erroresCampos
      ? Object.entries(params.erroresCampos)
          .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
          .join(' | ')
      : '';

    const fullMessage = fieldSummary
      ? `Validación rechazada: ${params.mensaje} (${fieldSummary})`
      : `Validación rechazada: ${params.mensaje}`;

    await db.transaction('rw', tables, async () => {
      const currentOp = await db.outbox.get(params.idOperacion);
      if (!currentOp) return;

      await db.outbox.update(params.idOperacion, {
        estado: 'fallido',
        intentos: currentOp.intentos + 1,
        ultimoError: fullMessage,
        proximoIntento: null
      });

      if (targetTable) {
        const entity = await targetTable.get(currentOp.idEntidad);
        if (entity && entity.syncStatus !== 'conflict') {
          const patch: Partial<BaseLocalEntity> = { syncStatus: 'error' };
          await targetTable.update(entity.id, patch as unknown as UpdateSpec<BaseLocalEntity>);
        }
      }
    });
  },

  async markTransientError(params: {
    idOperacion: string;
    mensaje: string;
    nextRetryIso: string | null;
  }): Promise<void> {
    await db.transaction('rw', [db.outbox], async () => {
      const currentOp = await db.outbox.get(params.idOperacion);
      if (!currentOp) return;

      const nextAttempts = currentOp.intentos + 1;
      const exhausted = nextAttempts >= MAX_TRANSIENT_PUSH_RETRIES || params.nextRetryIso === null;

      await db.outbox.update(params.idOperacion, {
        estado: 'fallido',
        intentos: nextAttempts,
        ultimoError: exhausted
          ? `${params.mensaje} (Reintentos automáticos agotados: ${nextAttempts}/${MAX_TRANSIENT_PUSH_RETRIES})`
          : params.mensaje,
        proximoIntento: exhausted ? null : params.nextRetryIso
      });
    });
  },

  async resetForManualRetry(idOperacion: string): Promise<void> {
    const current = await db.outbox.get(idOperacion);
    if (!current || current.estado === 'confirmado' || current.estado === 'en_proceso') {
      return;
    }

    await db.outbox.update(idOperacion, {
      estado: 'pendiente',
      proximoIntento: null
    });
  },

  async scheduleManualRetry(idOperacion: string): Promise<void> {
    await this.resetForManualRetry(idOperacion);
  },

  async getEntityMetadata(
    entidad: SyncEntityName,
    idEntidad: string
  ): Promise<{ remoteId?: string | number; serverVersion?: number | string | null } | null> {
    const table = getEntityTable(entidad);
    if (!table) return null;
    const entity = await table.get(idEntidad);
    if (!entity) return null;
    return {
      remoteId: entity.remoteId,
      serverVersion: entity.serverVersion
    };
  },

  async updateState(idOperacion: string, estado: OutboxOperationState, errorMsg?: string): Promise<void> {
    const existing = await db.outbox.get(idOperacion);
    if (!existing) return;

    await db.outbox.update(idOperacion, {
      estado,
      intentos: estado === 'fallido' ? existing.intentos + 1 : existing.intentos,
      ultimoError: errorMsg ?? existing.ultimoError
    });
  }
};
