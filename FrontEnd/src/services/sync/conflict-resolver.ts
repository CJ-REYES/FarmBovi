import type { Table, UpdateSpec } from 'dexie';
import { db } from '../../lib/database/db';
import { ConflictRepository } from '../../lib/database/repositories/conflict.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import type {
  BaseLocalEntity,
  ConflictType,
  LocalOutboxQueue,
  LocalSyncConflict,
  SyncEntityName
} from '../../lib/database/schema';
import { getSyncEntityTable, mapRemoteChangeToLocalEntity } from './sync-pull.mapper';

export interface RecordConflictParams {
  idOperacion: string;
  entidad: SyncEntityName;
  idEntidad: string;
  remoteId?: string | number | null;
  datosLocales: Record<string, unknown>;
  versionBase: number | string | null;
  estadoServidor: Record<string, unknown> | null;
  versionServidor?: number | string | null;
  tipoConflicto?: ConflictType;
  mensaje?: string;
}

export interface MergeableFieldDescriptor {
  key: string;
  label: string;
  localValue: unknown;
  serverValue: unknown;
  differs: boolean;
}

const NON_MERGEABLE_ENTITIES = new Set<SyncEntityName>([
  'media',
  'weighingAnalysisJobs'
]);

const INTERNAL_METADATA_KEYS = new Set<string>([
  'id',
  'idGenealogia',
  'idEventoReproductivo',
  'idEventoSanitario',
  'idTratamiento',
  'idAlimentacion',
  'idMovimiento',
  'idRecordatorio',
  'idPesaje',
  'idAutor',
  'creadoEn',
  'eliminadoEn',
  'versionRegistro',
  'localNumericId',
  'remoteId',
  'ranchId',
  'ranchoId',
  'createdAt',
  'updatedAt',
  'syncStatus',
  'serverVersion',
  'deletedAt',
  'eliminado'
]);

const FIELD_LABELS: Record<string, string> = {
  arete: 'Arete',
  areteSiniiga: 'Arete',
  tagNumber: 'Arete',
  nombre: 'Nombre',
  name: 'Nombre',
  raza: 'Raza',
  breed: 'Raza',
  sexo: 'Sexo',
  gender: 'Sexo',
  sex: 'Sexo',
  fechaNacimiento: 'Fecha de nacimiento',
  birthDate: 'Fecha de nacimiento',
  fechaIngreso: 'Fecha de ingreso',
  procedencia: 'Procedencia',
  estado: 'Estado',
  fechaSalida: 'Fecha de salida',
  idLote: 'Potrero / Lote asignado',
  loteId: 'Potrero / Lote asignado',
  lotId: 'Potrero / Lote asignado',
  peso: 'Peso (kg)',
  weight: 'Peso (kg)',
  fecha: 'Fecha',
  observaciones: 'Observaciones',
  notes: 'Observaciones',
  tipo: 'Tipo',
  descripcion: 'Descripción',
  proximaAplicacion: 'Próxima aplicación',
  tipoAlimento: 'Tipo de alimento',
  cantidadKg: 'Cantidad (kg)',
  evento: 'Evento reproductivo',
  resultado: 'Resultado',
  idSemental: 'Semental',
  sementalId: 'Semental',
  capacidad: 'Capacidad',
  ubicacion: 'Ubicación',
  origenLotId: 'Lote origen',
  destinoLotId: 'Lote destino',
  motivo: 'Motivo',
  idAnimal: 'Animal',
  idPadre: 'Padre',
  padreId: 'Padre',
  idMadre: 'Madre',
  madreId: 'Madre',
  prioridad: 'Prioridad',
  mensaje: 'Mensaje',
  leida: 'Leída'
};

function normalizeComparableValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function sanitizeEditableFields(
  source: Record<string, unknown>,
  entidad?: SyncEntityName
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!INTERNAL_METADATA_KEYS.has(key) && value !== undefined) {
      clean[key] = value;
    }
  }

  // En reproducción, unificar alias cliente/servidor (`evento` <-> `tipo`, `sementalId` <-> `idSemental`)
  // y excluir el animal inmutable (`idAnimal`/`cattleId`) de la comparación editable.
  if (entidad === 'reproductionRecords') {
    if (clean.tipo === undefined && clean.evento !== undefined) {
      clean.tipo = clean.evento;
    }
    delete clean.evento;

    if (clean.idSemental === undefined && clean.sementalId !== undefined) {
      clean.idSemental = clean.sementalId;
    }
    delete clean.sementalId;

    delete clean.idAnimal;
    delete clean.cattleId;
  }

  return clean;
}

function applyEntitySpecificLocalAliases(
  entidad: SyncEntityName,
  fields: Record<string, unknown>
): Record<string, unknown> {
  if (entidad !== 'reproductionRecords') {
    return fields;
  }
  const adapted: Record<string, unknown> = { ...fields };
  if (typeof adapted.tipo === 'string') {
    adapted.evento = adapted.tipo;
  } else if (typeof adapted.evento === 'string') {
    adapted.tipo = adapted.evento;
  }
  if (adapted.idSemental !== undefined) {
    adapted.sementalId = adapted.idSemental;
  } else if (adapted.sementalId !== undefined) {
    adapted.idSemental = adapted.sementalId;
  }
  return adapted;
}

export const ConflictResolver = {
  /**
   * Indica si el conflicto admite combinación segura campo por campo.
   * No se permite combinar registros eliminados en el servidor ni archivos binarios.
   */
  canMergeConflict(conflict: LocalSyncConflict): { supported: boolean; reason?: string } {
    if (
      conflict.tipoConflicto === 'DELETED_ON_SERVER' ||
      conflict.estadoServidor?.eliminado === true
    ) {
      return {
        supported: false,
        reason:
          'El registro fue eliminado en el servidor; debes elegir entre aceptar la eliminación o restaurarlo completo como nuevo registro.'
      };
    }

    if (NON_MERGEABLE_ENTITIES.has(conflict.entidad)) {
      return {
        supported: false,
        reason: 'Esta entidad contiene evidencia binaria o trabajos de IA que no admiten combinación parcial.'
      };
    }

    if (!conflict.estadoServidor || typeof conflict.estadoServidor !== 'object') {
      return {
        supported: false,
        reason: 'El servidor no proporcionó una instantánea de campos para comparar y combinar.'
      };
    }

    if (
      conflict.versionServidor === null ||
      conflict.versionServidor === undefined ||
      String(conflict.versionServidor).trim() === ''
    ) {
      return {
        supported: false,
        reason: 'Falta versionServidor actual para basar la operación combinada.'
      };
    }

    return { supported: true };
  },

  /**
   * Extrae los campos editables comparando datosLocales vs estadoServidor.
   */
  getMergeableFields(conflict: LocalSyncConflict): MergeableFieldDescriptor[] {
    const localClean = sanitizeEditableFields(conflict.datosLocales ?? {}, conflict.entidad);
    const serverClean = sanitizeEditableFields(conflict.estadoServidor ?? {}, conflict.entidad);
    const allKeys = Array.from(
      new Set([...Object.keys(serverClean), ...Object.keys(localClean)])
    );

    return allKeys.map((key) => {
      const localValue = localClean[key];
      const serverValue = serverClean[key];
      const differs =
        normalizeComparableValue(localValue) !== normalizeComparableValue(serverValue);

      return {
        key,
        label: FIELD_LABELS[key] || key,
        localValue,
        serverValue,
        differs
      };
    });
  },

  /**
   * Registra un conflicto real de sincronización (VERSION_MISMATCH o DELETED_ON_SERVER).
   * Ignora errores de validación de negocio para no mezclarlos con conflictos de versión.
   */
  async recordConflict(params: RecordConflictParams): Promise<LocalSyncConflict | null> {
    if (
      params.tipoConflicto === 'VALIDATION_REJECTED' ||
      params.tipoConflicto === 'DUPLICATE_ENTITY'
    ) {
      return null;
    }

    return await OutboxRepository.markConflict({
      idOperacion: params.idOperacion,
      remoteId: params.remoteId,
      versionServidor: params.versionServidor,
      estadoServidor: params.estadoServidor,
      mensaje: params.mensaje
    });
  },

  async getPendingConflicts(): Promise<LocalSyncConflict[]> {
    return await ConflictRepository.getPendingConflicts();
  },

  async getAllConflicts(): Promise<LocalSyncConflict[]> {
    return await ConflictRepository.getAll();
  },

  /**
   * OPCIÓN 1: Usar la versión del servidor.
   * Descarta la mutación local pendiente tras confirmación explícita del usuario,
   * actualiza la misma entidad local sin duplicarla y cierra la operación conflictiva.
   */
  async resolveWithServer(idConflicto: string, notasResolucion?: string): Promise<void> {
    const conflict = await ConflictRepository.getById(idConflicto);
    if (!conflict) {
      throw new Error('Conflicto de sincronización no encontrado.');
    }
    if (conflict.estadoResolucion !== 'pendiente') {
      throw new Error('Este conflicto ya fue resuelto anteriormente.');
    }

    const entityTable = getSyncEntityTable(conflict.entidad);
    const tables: Table<unknown, string>[] = [
      db.outbox as unknown as Table<unknown, string>,
      db.syncConflicts as unknown as Table<unknown, string>
    ];
    if (entityTable) {
      tables.push(entityTable as unknown as Table<unknown, string>);
      if (conflict.entidad !== 'cattle') {
        tables.push(db.cattle as unknown as Table<unknown, string>);
      }
      if (conflict.entidad !== 'lots') {
        tables.push(db.lots as unknown as Table<unknown, string>);
      }
    }

    await db.transaction('rw', tables, async () => {
      const freshConflict = await db.syncConflicts.get(idConflicto);
      if (!freshConflict || freshConflict.estadoResolucion !== 'pendiente') return;

      const now = new Date().toISOString();
      const isDeletedOnServer =
        freshConflict.tipoConflicto === 'DELETED_ON_SERVER' ||
        freshConflict.estadoServidor?.eliminado === true;

      if (entityTable) {
        const existingEntity = await entityTable.get(freshConflict.idEntidad);

        if (existingEntity) {
          if (isDeletedOnServer) {
            const tombstonePatch: Partial<BaseLocalEntity> = {
              remoteId: freshConflict.remoteId ?? existingEntity.remoteId,
              deletedAt: existingEntity.deletedAt || now,
              updatedAt: now,
              serverVersion: freshConflict.versionServidor ?? existingEntity.serverVersion,
              syncStatus: 'synced'
            };
            await entityTable.update(
              existingEntity.id,
              tombstonePatch as unknown as UpdateSpec<BaseLocalEntity>
            );
          } else if (freshConflict.estadoServidor) {
            const mappedFromServer = await mapRemoteChangeToLocalEntity(
              freshConflict.entidad,
              {
                remoteId: freshConflict.remoteId ?? existingEntity.remoteId ?? existingEntity.id,
                clientUuid: existingEntity.id,
                operacion: 'UPSERT',
                versionServidor:
                  freshConflict.versionServidor ?? existingEntity.serverVersion ?? 1,
                datos: freshConflict.estadoServidor,
                eliminado: false,
                actualizadoEnServidor: now
              },
              existingEntity
            );
            // Garantizar que se conserva exactamente el mismo ID local y remoteId sin duplicar
            mappedFromServer.id = existingEntity.id;
            mappedFromServer.localNumericId = existingEntity.localNumericId;
            mappedFromServer.remoteId = freshConflict.remoteId ?? existingEntity.remoteId;
            mappedFromServer.syncStatus = 'synced';
            mappedFromServer.deletedAt = null;
            await entityTable.put(mappedFromServer);
          } else {
            const fallbackPatch: Partial<BaseLocalEntity> = {
              serverVersion: freshConflict.versionServidor ?? existingEntity.serverVersion,
              syncStatus: 'synced',
              updatedAt: now
            };
            await entityTable.update(
              existingEntity.id,
              fallbackPatch as unknown as UpdateSpec<BaseLocalEntity>
            );
          }
        }
      }

      // Cerrar la operación conflictiva en outbox para que nunca se reenvíe con versión antigua
      const existingOutboxOp = await db.outbox.get(freshConflict.idOperacion);
      if (existingOutboxOp) {
        await db.outbox.update(freshConflict.idOperacion, {
          estado: 'confirmado',
          ultimoError: 'Descartada por usuario al aceptar la versión del servidor.',
          proximoIntento: null
        });
      }

      await db.syncConflicts.update(idConflicto, {
        estadoResolucion: 'resuelto_servidor',
        fechaResolucion: now,
        notasResolucion:
          notasResolucion?.trim() || 'Versión del servidor aceptada por el usuario.',
        datosResueltos: freshConflict.estadoServidor ?? { eliminado: isDeletedOnServer }
      });
    });
  },

  /**
   * OPCIÓN 2: Conservar el cambio local.
   * No reenvía la operación antigua con versionBase obsoleta; en su lugar cierra
   * la operación anterior y genera una NUEVA operación basada en versionServidor.
   */
  async resolveWithLocal(
    idConflicto: string,
    notasResolucion?: string
  ): Promise<LocalOutboxQueue> {
    const conflict = await ConflictRepository.getById(idConflicto);
    if (!conflict) {
      throw new Error('Conflicto de sincronización no encontrado.');
    }
    if (conflict.estadoResolucion !== 'pendiente') {
      throw new Error('Este conflicto ya fue resuelto anteriormente.');
    }

    const isDeletedOnServer =
      conflict.tipoConflicto === 'DELETED_ON_SERVER' ||
      conflict.estadoServidor?.eliminado === true;

    if (
      !isDeletedOnServer &&
      (conflict.versionServidor === null || conflict.versionServidor === undefined)
    ) {
      throw new Error(
        'No se dispone de versionServidor actual para reencolar el cambio local de forma segura.'
      );
    }

    const entityTable = getSyncEntityTable(conflict.entidad);
    const tables: Table<unknown, string>[] = [
      db.outbox as unknown as Table<unknown, string>,
      db.syncConflicts as unknown as Table<unknown, string>
    ];
    if (entityTable) {
      tables.push(entityTable as unknown as Table<unknown, string>);
    }

    return await db.transaction('rw', tables, async () => {
      const freshConflict = await db.syncConflicts.get(idConflicto);
      if (!freshConflict || freshConflict.estadoResolucion !== 'pendiente') {
        throw new Error('El conflicto ya no está pendiente de resolución.');
      }

      const now = new Date().toISOString();
      let existingEntity: BaseLocalEntity | undefined;

      if (entityTable) {
        existingEntity = await entityTable.get(freshConflict.idEntidad);
        if (existingEntity) {
          const editableLocal = applyEntitySpecificLocalAliases(
            freshConflict.entidad,
            sanitizeEditableFields(freshConflict.datosLocales, freshConflict.entidad)
          );
          const updatedEntity: BaseLocalEntity = {
            ...existingEntity,
            ...editableLocal,
            id: existingEntity.id,
            localNumericId: existingEntity.localNumericId,
            remoteId: isDeletedOnServer ? undefined : (freshConflict.remoteId ?? existingEntity.remoteId),
            serverVersion: isDeletedOnServer ? null : (freshConflict.versionServidor ?? null),
            deletedAt:
              freshConflict.operacionLocal.tipoOperacion === 'DELETE' && !isDeletedOnServer
                ? (existingEntity.deletedAt || now)
                : null,
            updatedAt: now,
            syncStatus: 'pending'
          };
          await entityTable.put(updatedEntity);
          existingEntity = updatedEntity;
        }
      }

      const nextPayload = existingEntity
        ? {
            ...existingEntity,
            ...applyEntitySpecificLocalAliases(
              freshConflict.entidad,
              sanitizeEditableFields(freshConflict.datosLocales, freshConflict.entidad)
            )
          }
        : freshConflict.datosLocales;

      // Crear una NUEVA operación con nuevo idOperacion y versionBase = versionServidor actual
      const newOperation = OutboxRepository.createOperationRecord({
        entidad: freshConflict.entidad,
        idEntidad: freshConflict.idEntidad,
        tipoOperacion: isDeletedOnServer
          ? 'CREATE'
          : freshConflict.operacionLocal.tipoOperacion === 'CREATE'
            ? 'UPDATE'
            : freshConflict.operacionLocal.tipoOperacion,
        versionBase: isDeletedOnServer ? null : (freshConflict.versionServidor ?? null),
        payload: nextPayload,
        idRancho: existingEntity?.ranchId ?? freshConflict.operacionLocal.idRancho ?? null
      });

      await db.outbox.put(newOperation);

      // Cerrar la operación obsoleta con versionBase antigua para que no se reenvíe
      const oldOp = await db.outbox.get(freshConflict.idOperacion);
      if (oldOp) {
        await db.outbox.update(freshConflict.idOperacion, {
          estado: 'confirmado',
          ultimoError: `Supersedida por operación ${newOperation.idOperacion} (base v${String(
            newOperation.versionBase ?? 'inicial'
          )}).`,
          proximoIntento: null
        });
      }

      await db.syncConflicts.update(idConflicto, {
        estadoResolucion: 'resuelto_local',
        fechaResolucion: now,
        notasResolucion:
          notasResolucion?.trim() ||
          `Cambio local conservado; nueva operación ${newOperation.idOperacion} generada sobre versión servidor ${String(
            freshConflict.versionServidor ?? 'nueva'
          )}.`,
        datosResueltos: nextPayload
      });

      return newOperation;
    });
  },

  /**
   * OPCIÓN 3: Combinar datos (fusión segura campo por campo).
   * Actualiza la misma entidad local con los campos seleccionados y genera
   * una nueva operación UPDATE basada en versionServidor.
   */
  async resolveWithMerge(
    idConflicto: string,
    selectedFields: Record<string, unknown>,
    notasResolucion?: string
  ): Promise<LocalOutboxQueue> {
    const conflict = await ConflictRepository.getById(idConflicto);
    if (!conflict) {
      throw new Error('Conflicto de sincronización no encontrado.');
    }
    if (conflict.estadoResolucion !== 'pendiente') {
      throw new Error('Este conflicto ya fue resuelto anteriormente.');
    }

    const mergeability = this.canMergeConflict(conflict);
    if (!mergeability.supported) {
      throw new Error(mergeability.reason || 'Este conflicto no admite combinación de campos.');
    }

    const entityTable = getSyncEntityTable(conflict.entidad);
    const tables: Table<unknown, string>[] = [
      db.outbox as unknown as Table<unknown, string>,
      db.syncConflicts as unknown as Table<unknown, string>
    ];
    if (entityTable) {
      tables.push(entityTable as unknown as Table<unknown, string>);
    }

    return await db.transaction('rw', tables, async () => {
      const freshConflict = await db.syncConflicts.get(idConflicto);
      if (!freshConflict || freshConflict.estadoResolucion !== 'pendiente') {
        throw new Error('El conflicto ya no está pendiente de resolución.');
      }

      const now = new Date().toISOString();
      const baseServerClean = sanitizeEditableFields(
        freshConflict.estadoServidor ?? {},
        freshConflict.entidad
      );
      const baseLocalClean = sanitizeEditableFields(
        freshConflict.datosLocales ?? {},
        freshConflict.entidad
      );
      const chosenClean = sanitizeEditableFields(selectedFields, freshConflict.entidad);

      const mergedEditableFields = applyEntitySpecificLocalAliases(freshConflict.entidad, {
        ...baseServerClean,
        ...baseLocalClean,
        ...chosenClean
      });

      let existingEntity: BaseLocalEntity | undefined;
      if (entityTable) {
        existingEntity = await entityTable.get(freshConflict.idEntidad);
        if (existingEntity) {
          const mergedEntity: BaseLocalEntity = {
            ...existingEntity,
            ...mergedEditableFields,
            id: existingEntity.id,
            localNumericId: existingEntity.localNumericId,
            remoteId: freshConflict.remoteId ?? existingEntity.remoteId,
            serverVersion: freshConflict.versionServidor ?? existingEntity.serverVersion,
            deletedAt: null,
            updatedAt: now,
            syncStatus: 'pending'
          };
          await entityTable.put(mergedEntity);
          existingEntity = mergedEntity;
        }
      }

      const mergedPayload = existingEntity
        ? { ...existingEntity, ...mergedEditableFields }
        : mergedEditableFields;

      const newMergeOperation = OutboxRepository.createOperationRecord({
        entidad: freshConflict.entidad,
        idEntidad: freshConflict.idEntidad,
        tipoOperacion: 'UPDATE',
        versionBase: freshConflict.versionServidor ?? null,
        payload: mergedPayload,
        idRancho: existingEntity?.ranchId ?? freshConflict.operacionLocal.idRancho ?? null
      });

      await db.outbox.put(newMergeOperation);

      const oldOp = await db.outbox.get(freshConflict.idOperacion);
      if (oldOp) {
        await db.outbox.update(freshConflict.idOperacion, {
          estado: 'confirmado',
          ultimoError: `Fusionada mediante nueva operación ${newMergeOperation.idOperacion} (base v${String(
            freshConflict.versionServidor
          )}).`,
          proximoIntento: null
        });
      }

      await db.syncConflicts.update(idConflicto, {
        estadoResolucion: 'fusionado',
        fechaResolucion: now,
        notasResolucion:
          notasResolucion?.trim() ||
          `Campos combinados por el usuario; nueva operación ${newMergeOperation.idOperacion} basada en versión servidor ${String(
            freshConflict.versionServidor
          )}.`,
        datosResueltos: mergedPayload
      });

      return newMergeOperation;
    });
  }
};
