import { db } from '../db';
import type {
  LocalOutboxQueue,
  OutboxOperationState,
  OutboxOperationType,
  SyncEntityName
} from '../schema';

export interface EnqueueOperationParams {
  idOperacion?: string; // Opcional solo si se rehidrata una operación; por defecto genera UUID nuevo
  entidad: SyncEntityName;
  idEntidad: string;
  tipoOperacion: OutboxOperationType;
  versionBase?: number | string | null;
  payload: unknown;
}

export const OutboxRepository = {
  createOperationRecord(params: EnqueueOperationParams): LocalOutboxQueue {
    const idOperacion = params.idOperacion || crypto.randomUUID();
    return {
      id: idOperacion,
      idOperacion,
      entidad: params.entidad,
      idEntidad: params.idEntidad,
      tipoOperacion: params.tipoOperacion,
      versionBase: params.versionBase ?? null,
      payload: params.payload,
      estado: 'pendiente',
      fechaCreacion: new Date().toISOString(),
      intentos: 0,
      ultimoError: null,
      proximoIntento: null
    };
  },

  async enqueue(params: EnqueueOperationParams): Promise<LocalOutboxQueue> {
    const operation = this.createOperationRecord(params);
    await db.outbox.put(operation);
    return operation;
  },

  async getByOperationId(idOperacion: string): Promise<LocalOutboxQueue | undefined> {
    return await db.outbox.where('idOperacion').equals(idOperacion).first();
  },

  async getPendingAndRetryable(nowIso: string = new Date().toISOString()): Promise<LocalOutboxQueue[]> {
    const candidates = await db.outbox
      .where('estado')
      .anyOf('pendiente', 'fallido')
      .sortBy('fechaCreacion');

    return candidates.filter((op) => !op.proximoIntento || op.proximoIntento <= nowIso);
  },

  async getByState(estado: OutboxOperationState): Promise<LocalOutboxQueue[]> {
    return await db.outbox.where('estado').equals(estado).sortBy('fechaCreacion');
  },

  async markInProgress(idOperacion: string): Promise<void> {
    await db.outbox.update(idOperacion, {
      estado: 'en_proceso'
    });
  },

  async markConfirmed(idOperacion: string): Promise<void> {
    await db.outbox.update(idOperacion, {
      estado: 'confirmado',
      ultimoError: null,
      proximoIntento: null
    });
  },

  async markTemporaryFailure(idOperacion: string, errorMessage: string, nextRetryIso: string): Promise<void> {
    const current = await this.getByOperationId(idOperacion);
    if (!current) return;

    // Conserva el mismo idOperacion UUID e incrementa intentos
    await db.outbox.update(current.id, {
      estado: 'fallido',
      intentos: current.intentos + 1,
      ultimoError: errorMessage,
      proximoIntento: nextRetryIso
    });
  },

  async markConflict(idOperacion: string, errorMessage: string): Promise<void> {
    const current = await this.getByOperationId(idOperacion);
    if (!current) return;

    // Un conflicto NO se trata como fallo temporal reintentable
    await db.outbox.update(current.id, {
      estado: 'conflicto',
      ultimoError: errorMessage,
      proximoIntento: null
    });
  }
};
