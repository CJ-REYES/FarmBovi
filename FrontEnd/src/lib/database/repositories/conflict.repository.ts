import { db } from '../db';
import type {
  ConflictResolutionState,
  ConflictType,
  LocalOutboxQueue,
  LocalSyncConflict,
  SyncEntityName
} from '../schema';

export interface RegisterConflictInput {
  idOperacion: string;
  entidad: SyncEntityName;
  idEntidad: string;
  remoteId?: string | number | null;
  operacionLocal: LocalOutboxQueue;
  datosLocales: Record<string, unknown>;
  versionBase: number | string | null;
  estadoServidor: Record<string, unknown> | null;
  versionServidor?: number | string | null;
  tipoConflicto: ConflictType;
}

export const ConflictRepository = {
  async create(input: RegisterConflictInput): Promise<LocalSyncConflict> {
    const conflict: LocalSyncConflict = {
      idConflicto: crypto.randomUUID(),
      idOperacion: input.idOperacion,
      entidad: input.entidad,
      idEntidad: input.idEntidad,
      remoteId: input.remoteId ?? null,
      operacionLocal: input.operacionLocal,
      datosLocales: input.datosLocales,
      versionBase: input.versionBase,
      estadoServidor: input.estadoServidor,
      versionServidor: input.versionServidor ?? null,
      tipoConflicto: input.tipoConflicto,
      estadoResolucion: 'pendiente',
      fechaDeteccion: new Date().toISOString(),
      fechaResolucion: null,
      notasResolucion: null
    };

    await db.syncConflicts.put(conflict);
    return conflict;
  },

  async getById(idConflicto: string): Promise<LocalSyncConflict | undefined> {
    return await db.syncConflicts.get(idConflicto);
  },

  async getPending(): Promise<LocalSyncConflict[]> {
    return await db.syncConflicts
      .where('estadoResolucion')
      .equals('pendiente')
      .sortBy('fechaDeteccion');
  },

  async getByEntityId(idEntidad: string): Promise<LocalSyncConflict[]> {
    return await db.syncConflicts.where('idEntidad').equals(idEntidad).toArray();
  },

  async updateResolution(
    idConflicto: string,
    estadoResolucion: ConflictResolutionState,
    notasResolucion?: string
  ): Promise<void> {
    await db.syncConflicts.update(idConflicto, {
      estadoResolucion,
      fechaResolucion: new Date().toISOString(),
      notasResolucion: notasResolucion ?? null
    });
  }
};
