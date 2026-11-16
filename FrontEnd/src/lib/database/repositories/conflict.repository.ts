import { db } from '../db';
import type {
  ConflictResolutionState,
  ConflictType,
  LocalOutboxQueue,
  LocalSyncConflict,
  SyncEntityName
} from '../schema';

export interface RecordSyncConflictInput {
  idConflicto?: string;
  idOperacion: string;
  entidad: SyncEntityName;
  idEntidad: string;
  remoteId?: string | number | null;
  operacionLocal: LocalOutboxQueue;
  datosLocales: Record<string, unknown>;
  versionBase: number | string | null;
  estadoServidor: Record<string, unknown> | null;
  versionServidor?: number | string | null;
  tipoConflicto?: ConflictType;
  estadoResolucion?: ConflictResolutionState;
  fechaDeteccion?: string;
  fechaResolucion?: string | null;
  notasResolucion?: string | null;
}

export const ConflictRepository = {
  async upsertConflictForOperation(input: RecordSyncConflictInput): Promise<LocalSyncConflict> {
    const existing = await db.syncConflicts
      .where('idOperacion')
      .equals(input.idOperacion)
      .first();

    const record: LocalSyncConflict = {
      idConflicto: existing?.idConflicto ?? input.idConflicto ?? crypto.randomUUID(),
      idOperacion: input.idOperacion,
      entidad: input.entidad,
      idEntidad: input.idEntidad,
      remoteId: input.remoteId ?? existing?.remoteId ?? null,
      operacionLocal: input.operacionLocal,
      datosLocales: input.datosLocales,
      versionBase: input.versionBase,
      estadoServidor: input.estadoServidor,
      versionServidor: input.versionServidor ?? null,
      tipoConflicto: input.tipoConflicto ?? 'VERSION_MISMATCH',
      estadoResolucion: input.estadoResolucion ?? 'pendiente',
      fechaDeteccion: existing?.fechaDeteccion ?? input.fechaDeteccion ?? new Date().toISOString(),
      fechaResolucion: input.fechaResolucion ?? null,
      notasResolucion: input.notasResolucion ?? null
    };

    await db.syncConflicts.put(record);
    return record;
  },

  async create(input: RecordSyncConflictInput): Promise<LocalSyncConflict> {
    return await this.upsertConflictForOperation(input);
  },

  async getAll(): Promise<LocalSyncConflict[]> {
    const conflicts = await db.syncConflicts.toArray();
    return conflicts.sort((a, b) => b.fechaDeteccion.localeCompare(a.fechaDeteccion));
  },

  async getPendingConflicts(): Promise<LocalSyncConflict[]> {
    const pending = await db.syncConflicts
      .where('estadoResolucion')
      .equals('pendiente')
      .toArray();
    return pending.sort((a, b) => a.fechaDeteccion.localeCompare(b.fechaDeteccion));
  },

  async getPending(): Promise<LocalSyncConflict[]> {
    return await this.getPendingConflicts();
  },

  async getById(idConflicto: string): Promise<LocalSyncConflict | undefined> {
    return await db.syncConflicts.get(idConflicto);
  },

  async getByOperationId(idOperacion: string): Promise<LocalSyncConflict | undefined> {
    return await db.syncConflicts.where('idOperacion').equals(idOperacion).first();
  },

  async getByEntity(entidad: SyncEntityName, idEntidad: string): Promise<LocalSyncConflict[]> {
    return await db.syncConflicts
      .where('idEntidad')
      .equals(idEntidad)
      .filter((c) => c.entidad === entidad)
      .toArray();
  },

  async countPending(): Promise<number> {
    return await db.syncConflicts.where('estadoResolucion').equals('pendiente').count();
  },

  async updateResolutionState(
    idConflicto: string,
    estadoResolucion: ConflictResolutionState,
    notasResolucion?: string
  ): Promise<void> {
    await db.syncConflicts.update(idConflicto, {
      estadoResolucion,
      fechaResolucion: new Date().toISOString(),
      notasResolucion: notasResolucion ?? null
    });
  },

  async updateResolution(
    idConflicto: string,
    estadoResolucion: ConflictResolutionState,
    notasResolucion?: string
  ): Promise<void> {
    await this.updateResolutionState(idConflicto, estadoResolucion, notasResolucion);
  }
};
