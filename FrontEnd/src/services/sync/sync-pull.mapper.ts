import type { Table } from 'dexie';
import { db } from '../../lib/database/db';
import { computeStableNegativeId } from '../../lib/database/migrations';
import type {
  BaseLocalEntity,
  LocalAlert,
  LocalCattle,
  LocalFeedingRecord,
  LocalGenealogy,
  LocalHealthRecord,
  LocalLot,
  LocalMedia,
  LocalMovement,
  LocalReproductionRecord,
  LocalWeighing,
  SyncEntityName
} from '../../lib/database/schema';
import type { SyncRemoteChangeItemDto } from '../../types/sync-contracts';

function readString(
  data: Record<string, unknown>,
  keys: readonly string[],
  fallback: string
): string;
function readString(
  data: Record<string, unknown>,
  keys: readonly string[],
  fallback?: string
): string | undefined;
function readString(
  data: Record<string, unknown>,
  keys: readonly string[],
  fallback?: string
): string | undefined {
  for (const key of keys) {
    const val = data[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      return String(val);
    }
  }
  return fallback;
}

function readNumber(data: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const val = data[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
    if (typeof val === 'string' && val.trim().length > 0) {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readBoolean(data: Record<string, unknown>, keys: readonly string[], fallback: boolean): boolean {
  for (const key of keys) {
    const val = data[key];
    if (typeof val === 'boolean') return val;
  }
  return fallback;
}

async function resolveLocalForeignUuid(
  parentTable: Table<BaseLocalEntity, string>,
  rawRef: string
): Promise<string> {
  const byUuid = await parentTable.get(rawRef);
  if (byUuid) return byUuid.id;

  const numericRef = Number(rawRef);
  if (!Number.isNaN(numericRef)) {
    const byRemote = await parentTable.where('remoteId').equals(numericRef).first();
    if (byRemote) return byRemote.id;
  }

  return rawRef;
}

export const SYNC_ENTITY_TABLES: Partial<
  Record<SyncEntityName, Table<BaseLocalEntity, string>>
> = {
  cattle: db.cattle as unknown as Table<BaseLocalEntity, string>,
  weighings: db.weighings as unknown as Table<BaseLocalEntity, string>,
  healthRecords: db.healthRecords as unknown as Table<BaseLocalEntity, string>,
  feedingRecords: db.feedingRecords as unknown as Table<BaseLocalEntity, string>,
  reproductionRecords: db.reproductionRecords as unknown as Table<BaseLocalEntity, string>,
  lots: db.lots as unknown as Table<BaseLocalEntity, string>,
  movements: db.movements as unknown as Table<BaseLocalEntity, string>,
  genealogy: db.genealogy as unknown as Table<BaseLocalEntity, string>,
  alerts: db.alerts as unknown as Table<BaseLocalEntity, string>,
  media: db.media as unknown as Table<BaseLocalEntity, string>
};

/** Same IndexedDB table is used for upserts and remote tombstones. */
export function getSyncEntityTable(
  entidad: SyncEntityName
): Table<BaseLocalEntity, string> | null {
  return SYNC_ENTITY_TABLES[entidad] ?? null;
}

export async function mapRemoteChangeToLocalEntity(
  entidad: SyncEntityName,
  change: SyncRemoteChangeItemDto<Record<string, unknown>>,
  existing?: BaseLocalEntity
): Promise<BaseLocalEntity> {
  if (!change.datos || typeof change.datos !== 'object') {
    throw new Error(
      `El cambio UPSERT para ${entidad} (remoteId=${String(change.remoteId)}) carece de datos.`
    );
  }

  const data = change.datos;
  const stableId = existing?.id || change.clientUuid || crypto.randomUUID();
  const localNumericId = existing?.localNumericId ?? computeStableNegativeId(stableId);
  const ranchId = readString(data, ['ranchId', 'ranchoId'], existing?.ranchId);
  const createdAt =
    readString(data, ['createdAt', 'fechaCreacion'], existing?.createdAt) ??
    change.actualizadoEnServidor;

  const baseFields: BaseLocalEntity = {
    id: stableId,
    localNumericId,
    remoteId: change.remoteId,
    ranchId,
    createdAt,
    updatedAt: change.actualizadoEnServidor,
    syncStatus: 'synced',
    serverVersion: change.versionServidor,
    deletedAt: null
  };

  switch (entidad) {
    case 'cattle': {
      const areteSiniiga = readString(data, ['areteSiniiga', 'tagNumber', 'earTag'], '') ?? '';
      const raza = readString(data, ['raza', 'breed'], 'Cruzado') ?? 'Cruzado';
      const gender = readString(data, ['gender', 'sex', 'sexo'], 'Hembra') ?? 'Hembra';
      const nombre = readString(data, ['nombre', 'name']);
      const fechaNacimiento = readString(data, ['fechaNacimiento', 'birthDate']);
      const rawLoteId = readString(data, ['loteId', 'lotId']);
      const loteId = rawLoteId
        ? await resolveLocalForeignUuid(
            db.lots as unknown as Table<BaseLocalEntity, string>,
            rawLoteId
          )
        : undefined;

      if (!areteSiniiga && !nombre) {
        throw new Error(
          `Registro remoto de bovino inválido (remoteId=${String(change.remoteId)}): falta areteSiniiga y nombre.`
        );
      }

      const cattleRecord: LocalCattle = {
        ...baseFields,
        areteSiniiga,
        nombre,
        raza,
        gender,
        fechaNacimiento,
        loteId
      };
      return cattleRecord;
    }

    case 'weighings': {
      const rawCattleId = readString(data, ['cattleId', 'animalId', 'bovinoId']);
      const peso = readNumber(data, ['peso', 'weight', 'weightKg']);
      const fecha = readString(data, ['fecha', 'date', 'fechaPesaje'], change.actualizadoEnServidor);

      if (!rawCattleId || peso === undefined || peso <= 0 || !fecha) {
        throw new Error(
          `Registro remoto de pesaje inválido (remoteId=${String(change.remoteId)}).`
        );
      }

      const cattleId = await resolveLocalForeignUuid(
        db.cattle as unknown as Table<BaseLocalEntity, string>,
        rawCattleId
      );

      const weighingRecord: LocalWeighing = {
        ...baseFields,
        cattleId,
        peso,
        fecha,
        observaciones: readString(data, ['observaciones', 'notes']),
        origenPesaje:
          data.origenPesaje === 'boviscale_ia' ? 'boviscale_ia' : 'manual',
        sourceAnalysisJobId: readString(data, ['sourceAnalysisJobId']) ?? null,
        sourceMediaId: readString(data, ['sourceMediaId']) ?? null
      };
      return weighingRecord;
    }

    case 'healthRecords': {
      const rawCattleId = readString(data, ['cattleId', 'animalId', 'bovinoId']);
      const tipo = readString(data, ['tipo', 'type']);
      const descripcion = readString(data, ['descripcion', 'description']);
      const fecha = readString(data, ['fecha', 'date'], change.actualizadoEnServidor);

      if (!rawCattleId || !tipo || !descripcion || !fecha) {
        throw new Error(
          `Registro remoto de salud inválido (remoteId=${String(change.remoteId)}).`
        );
      }

      const cattleId = await resolveLocalForeignUuid(
        db.cattle as unknown as Table<BaseLocalEntity, string>,
        rawCattleId
      );

      const healthRecord: LocalHealthRecord = {
        ...baseFields,
        cattleId,
        tipo,
        descripcion,
        fecha,
        proximaAplicacion: readString(data, ['proximaAplicacion', 'nextApplicationDate'])
      };
      return healthRecord;
    }

    case 'feedingRecords': {
      const tipoAlimento = readString(data, ['tipoAlimento', 'feedType']);
      const cantidadKg = readNumber(data, ['cantidadKg', 'quantityKg']);
      const fecha = readString(data, ['fecha', 'date'], change.actualizadoEnServidor);
      const rawLotId = readString(data, ['lotId', 'loteId']);

      if (!tipoAlimento || cantidadKg === undefined || cantidadKg < 0 || !fecha) {
        throw new Error(
          `Registro remoto de alimentación inválido (remoteId=${String(change.remoteId)}).`
        );
      }

      const lotId = rawLotId
        ? await resolveLocalForeignUuid(
            db.lots as unknown as Table<BaseLocalEntity, string>,
            rawLotId
          )
        : undefined;

      const feedingRecord: LocalFeedingRecord = {
        ...baseFields,
        lotId,
        tipoAlimento,
        cantidadKg,
        fecha
      };
      return feedingRecord;
    }

    case 'reproductionRecords': {
      const rawCattleId = readString(data, ['cattleId', 'animalId', 'bovinoId']);
      const evento = readString(data, ['evento', 'event']);
      const fecha = readString(data, ['fecha', 'date'], change.actualizadoEnServidor);

      if (!rawCattleId || !evento || !fecha) {
        throw new Error(
          `Registro remoto de reproducción inválido (remoteId=${String(change.remoteId)}).`
        );
      }

      const cattleId = await resolveLocalForeignUuid(
        db.cattle as unknown as Table<BaseLocalEntity, string>,
        rawCattleId
      );

      const reproductionRecord: LocalReproductionRecord = {
        ...baseFields,
        cattleId,
        evento,
        fecha,
        observaciones: readString(data, ['observaciones', 'notes'])
      };
      return reproductionRecord;
    }

    case 'lots': {
      const nombre = readString(data, ['nombre', 'name']);
      const capacidad = readNumber(data, ['capacidad', 'capacity']) ?? 0;

      if (!nombre) {
        throw new Error(`Registro remoto de lote inválido (remoteId=${String(change.remoteId)}).`);
      }

      const lotRecord: LocalLot = {
        ...baseFields,
        nombre,
        capacidad,
        ubicacion: readString(data, ['ubicacion', 'location'])
      };
      return lotRecord;
    }

    case 'movements': {
      const rawCattleId = readString(data, ['cattleId', 'animalId', 'bovinoId']);
      const fecha = readString(data, ['fecha', 'date'], change.actualizadoEnServidor);
      const motivo = readString(data, ['motivo', 'reason'], 'Movimiento registrado') ?? 'Movimiento registrado';
      const rawOrigen = readString(data, ['origenLotId', 'originLotId']);
      const rawDestino = readString(data, ['destinoLotId', 'destinationLotId']);

      if (!rawCattleId || !fecha) {
        throw new Error(
          `Registro remoto de movimiento inválido (remoteId=${String(change.remoteId)}).`
        );
      }

      const lotsTable = db.lots as unknown as Table<BaseLocalEntity, string>;
      const cattleId = await resolveLocalForeignUuid(
        db.cattle as unknown as Table<BaseLocalEntity, string>,
        rawCattleId
      );

      const movementRecord: LocalMovement = {
        ...baseFields,
        cattleId,
        origenLotId: rawOrigen ? await resolveLocalForeignUuid(lotsTable, rawOrigen) : undefined,
        destinoLotId: rawDestino ? await resolveLocalForeignUuid(lotsTable, rawDestino) : undefined,
        fecha,
        motivo
      };
      return movementRecord;
    }

    case 'genealogy': {
      const rawCattleId = readString(data, ['cattleId', 'animalId', 'bovinoId']);
      if (!rawCattleId) {
        throw new Error(
          `Registro remoto de genealogía inválido (remoteId=${String(change.remoteId)}).`
        );
      }

      const cattleTable = db.cattle as unknown as Table<BaseLocalEntity, string>;
      const cattleId = await resolveLocalForeignUuid(cattleTable, rawCattleId);
      const rawPadre = readString(data, ['padreId', 'fatherId']);
      const rawMadre = readString(data, ['madreId', 'motherId']);

      const genealogyRecord: LocalGenealogy = {
        ...baseFields,
        cattleId,
        padreId: rawPadre ? await resolveLocalForeignUuid(cattleTable, rawPadre) : undefined,
        madreId: rawMadre ? await resolveLocalForeignUuid(cattleTable, rawMadre) : undefined
      };
      return genealogyRecord;
    }

    case 'alerts': {
      const tipo = readString(data, ['tipo', 'type'], 'General') ?? 'General';
      const prioridad = readString(data, ['prioridad', 'priority'], 'Media') ?? 'Media';
      const mensaje = readString(data, ['mensaje', 'message']);
      const fecha = readString(data, ['fecha', 'date'], change.actualizadoEnServidor);

      if (!mensaje || !fecha) {
        throw new Error(`Registro remoto de alerta inválido (remoteId=${String(change.remoteId)}).`);
      }

      const alertRecord: LocalAlert = {
        ...baseFields,
        tipo,
        prioridad,
        mensaje,
        leida: readBoolean(data, ['leida', 'read'], false),
        fecha
      };
      return alertRecord;
    }

    case 'media': {
      const nombreArchivo = readString(
        data,
        ['nombreArchivo', 'fileName'],
        `media-${String(change.remoteId)}.jpg`
      )!;
      const mimeType = readString(data, ['mimeType', 'contentType'], 'image/jpeg')!;
      const tamanoBytes = readNumber(data, ['tamanoBytes', 'sizeBytes']) ?? 0;
      const rawCattleId = readString(data, ['cattleId', 'idEntidadRelacionada']);

      const existingMedia = existing as LocalMedia | undefined;
      const mediaRecord: LocalMedia = {
        ...baseFields,
        cattleId: rawCattleId,
        entidadRelacionada: 'cattle',
        idEntidadRelacionada: rawCattleId,
        tipo:
          data.tipo === 'FotoPerfil' || data.tipo === 'BoviScaleVision' || data.tipo === 'Documento'
            ? data.tipo
            : 'Documento',
        nombreArchivo,
        mimeType,
        tamanoBytes,
        checksumSha256: readString(data, ['checksumSha256']) ?? null,
        blobData: existingMedia?.blobData,
        urlRemota: readString(data, ['urlRemota', 'url']) ?? null,
        idOperacionSubida: null,
        estadoArchivo: 'subido',
        intentosSubida: existingMedia?.intentosSubida ?? 0,
        ultimoErrorSubida: null,
        fechaCaptura:
          readString(data, ['fechaCaptura'], existingMedia?.fechaCaptura) ??
          change.actualizadoEnServidor
      };
      return mediaRecord;
    }

    default:
      throw new Error(`Entidad no soportada en descarga incremental: ${entidad}`);
  }
}
