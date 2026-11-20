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
  LocalTreatment,
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

  const byStringRemote = await parentTable.where('remoteId').equals(rawRef).first();
  if (byStringRemote) return byStringRemote.id;

  const numericRef = Number(rawRef);
  if (!Number.isNaN(numericRef)) {
    const byRemote = await parentTable.where('remoteId').equals(numericRef).first();
    if (byRemote) return byRemote.id;
  }

  return rawRef;
}

export function getSyncEntityTable(
  entidad: SyncEntityName
): Table<BaseLocalEntity, string> | null {
  switch (entidad) {
    case 'ranches':
      return db.ranches as unknown as Table<BaseLocalEntity, string>;
    case 'cattle':
      return db.cattle as unknown as Table<BaseLocalEntity, string>;
    case 'weighings':
      return db.weighings as unknown as Table<BaseLocalEntity, string>;
    case 'healthRecords':
      return db.healthRecords as unknown as Table<BaseLocalEntity, string>;
    case 'treatments':
      return db.treatments as unknown as Table<BaseLocalEntity, string>;
    case 'feedingRecords':
      return db.feedingRecords as unknown as Table<BaseLocalEntity, string>;
    case 'reproductionRecords':
      return db.reproductionRecords as unknown as Table<BaseLocalEntity, string>;
    case 'lots':
      return db.lots as unknown as Table<BaseLocalEntity, string>;
    case 'movements':
      return db.movements as unknown as Table<BaseLocalEntity, string>;
    case 'genealogy':
      return db.genealogy as unknown as Table<BaseLocalEntity, string>;
    case 'alerts':
      return db.alerts as unknown as Table<BaseLocalEntity, string>;
    case 'media':
      return db.media as unknown as Table<BaseLocalEntity, string>;
    default:
      return null;
  }
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
  const stableId =
    existing?.id ||
    change.clientUuid ||
    (typeof change.remoteId === 'string' && change.remoteId.trim().length > 0
      ? change.remoteId
      : crypto.randomUUID());
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
      const existingCattle = existing as LocalCattle | undefined;
      const arete =
        readString(data, ['arete', 'areteSiniiga', 'tagNumber', 'earTag'], existingCattle?.arete ?? '') ??
        '';
      const raza = readString(data, ['raza', 'breed'], existingCattle?.raza ?? 'Cruzado') ?? 'Cruzado';
      const sexo =
        readString(data, ['sexo', 'gender', 'sex'], existingCattle?.sexo ?? 'Hembra') ?? 'Hembra';
      const nombre = readString(data, ['nombre', 'name'], existingCattle?.nombre);
      const fechaNacimiento = readString(
        data,
        ['fechaNacimiento', 'birthDate'],
        existingCattle?.fechaNacimiento
      );
      const fechaIngreso =
        readString(
          data,
          ['fechaIngreso'],
          existingCattle?.fechaIngreso ?? createdAt.slice(0, 10)
        ) ?? createdAt.slice(0, 10);
      const procedencia =
        readString(data, ['procedencia'], existingCattle?.procedencia ?? 'Propio') ?? 'Propio';
      const estado =
        readString(data, ['estado'], existingCattle?.estado ?? 'Activo') ?? 'Activo';
      const fechaSalida =
        readString(data, ['fechaSalida'], existingCattle?.fechaSalida ?? undefined) ?? null;
      const observaciones =
        readString(data, ['observaciones'], existingCattle?.observaciones ?? undefined) ?? null;
      const rawLoteId = readString(data, ['idLote', 'loteId', 'lotId']);
      const loteId = rawLoteId
        ? await resolveLocalForeignUuid(
            db.lots as unknown as Table<BaseLocalEntity, string>,
            rawLoteId
          )
        : undefined;

      if (!arete && !nombre) {
        throw new Error(
          `Registro remoto de bovino inválido (remoteId=${String(change.remoteId)}): falta arete.`
        );
      }

      const cattleRecord: LocalCattle = {
        ...baseFields,
        arete,
        areteSiniiga: arete,
        nombre,
        raza,
        sexo,
        gender: sexo,
        fechaNacimiento,
        fechaIngreso,
        procedencia,
        estado,
        fechaSalida,
        observaciones,
        loteId
      };
      return cattleRecord;
    }

    case 'weighings': {
      const existingWeighing = existing as LocalWeighing | undefined;
      const rawCattleId = readString(data, ['idAnimal', 'cattleId', 'animalId', 'bovinoId']);
      const peso = readNumber(data, ['pesoRealKg', 'peso', 'weight', 'weightKg']);
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
        fuenteBascula: readString(data, ['fuenteBascula'], existingWeighing?.fuenteBascula),
        responsable: readString(data, ['responsable'], existingWeighing?.responsable),
        observaciones: readString(data, ['observaciones', 'notes'], existingWeighing?.observaciones),
        origenPesaje:
          data.origenPesaje === 'boviscale_ia' ? 'boviscale_ia' : 'manual',
        sourceAnalysisJobId: readString(data, ['sourceAnalysisJobId']) ?? null,
        sourceMediaId: readString(data, ['sourceMediaId']) ?? null
      };
      return weighingRecord;
    }

    case 'healthRecords': {
      const existingHealth = existing as LocalHealthRecord | undefined;
      const rawCattleId = readString(data, ['idAnimal', 'cattleId', 'animalId', 'bovinoId']);
      const tipo = readString(data, ['tipo', 'type'], existingHealth?.tipo);
      const sintomas = readString(data, ['sintomas'], existingHealth?.sintomas ?? undefined) ?? null;
      const diagnostico =
        readString(data, ['diagnostico'], existingHealth?.diagnostico ?? undefined) ?? null;
      const observaciones =
        readString(data, ['observaciones'], existingHealth?.observaciones ?? undefined) ?? null;
      const descripcion =
        readString(
          data,
          ['descripcion', 'description', 'diagnostico', 'sintomas', 'observaciones'],
          existingHealth?.descripcion ?? tipo ?? ''
        ) ?? '';
      const fecha = readString(data, ['fecha', 'date'], change.actualizadoEnServidor);

      if (!rawCattleId || !tipo || !fecha) {
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
        descripcion: descripcion || tipo,
        fecha,
        proximaAplicacion: readString(data, ['proximaAplicacion', 'nextApplicationDate']),
        sintomas,
        diagnostico,
        profesionalDiagnostico:
          readString(
            data,
            ['profesionalDiagnostico'],
            existingHealth?.profesionalDiagnostico ?? undefined
          ) ?? null,
        evidenciaDiagnosticoUri:
          readString(
            data,
            ['evidenciaDiagnosticoUri'],
            existingHealth?.evidenciaDiagnosticoUri ?? undefined
          ) ?? null,
        responsable: readString(data, ['responsable'], existingHealth?.responsable ?? 'No especificado'),
        observaciones
      };
      return healthRecord;
    }

    case 'treatments': {
      const existingTreatment = existing as LocalTreatment | undefined;
      const rawEventId = readString(
        data,
        ['idEventoSanitario', 'eventoSanitarioId'],
        existingTreatment?.eventoSanitarioId
      );
      const producto = readString(data, ['producto'], existingTreatment?.producto);
      const dosis = readNumber(data, ['dosis']) ?? existingTreatment?.dosis;
      const unidadDosis = readString(data, ['unidadDosis'], existingTreatment?.unidadDosis ?? 'mL');
      const frecuencia = readString(data, ['frecuencia'], existingTreatment?.frecuencia ?? 'Diaria');
      const fechaInicio = readString(
        data,
        ['fechaInicio'],
        existingTreatment?.fechaInicio ?? change.actualizadoEnServidor
      );
      const responsable = readString(
        data,
        ['responsable'],
        existingTreatment?.responsable ?? 'No especificado'
      );
      const estado = readString(data, ['estado'], existingTreatment?.estado ?? 'Pendiente');

      if (!rawEventId || !producto || dosis === undefined || dosis <= 0 || !fechaInicio) {
        throw new Error(
          `Registro remoto de tratamiento inválido (remoteId=${String(change.remoteId)}).`
        );
      }

      const eventoSanitarioId = await resolveLocalForeignUuid(
        db.healthRecords as unknown as Table<BaseLocalEntity, string>,
        rawEventId
      );
      const parentEvent = await db.healthRecords.get(eventoSanitarioId);
      const rawCattleId = readString(
        data,
        ['idAnimal', 'cattleId'],
        parentEvent?.cattleId ?? existingTreatment?.cattleId ?? ''
      );

      const treatmentRecord: LocalTreatment = {
        ...baseFields,
        eventoSanitarioId,
        cattleId: rawCattleId || '',
        producto,
        dosis,
        unidadDosis: unidadDosis || 'mL',
        viaAdministracion:
          readString(data, ['viaAdministracion'], existingTreatment?.viaAdministracion ?? undefined) ??
          null,
        frecuencia: frecuencia || 'Diaria',
        fechaInicio,
        fechaFin: readString(data, ['fechaFin'], existingTreatment?.fechaFin ?? undefined) ?? null,
        responsable: responsable || 'No especificado',
        prescripcionUri:
          readString(data, ['prescripcionUri'], existingTreatment?.prescripcionUri ?? undefined) ??
          null,
        estado: estado || 'Pendiente'
      };
      return treatmentRecord;
    }

    case 'feedingRecords': {
      const existingFeeding = existing as LocalFeedingRecord | undefined;
      const tipoAlimento = readString(
        data,
        ['alimento', 'tipoAlimento', 'feedType'],
        existingFeeding?.tipoAlimento
      );
      const cantidadKg =
        readNumber(data, ['cantidad', 'cantidadKg', 'quantityKg']) ?? existingFeeding?.cantidadKg;
      const fecha = readString(
        data,
        ['inicio', 'fecha', 'date'],
        existingFeeding?.fecha ?? change.actualizadoEnServidor
      );
      const rawLotId = readString(data, ['idLote', 'lotId', 'loteId']);
      const rawCattleId = readString(data, ['idAnimal', 'cattleId', 'animalId']);

      if (!tipoAlimento || cantidadKg === undefined || cantidadKg <= 0 || !fecha) {
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
      const cattleId = rawCattleId
        ? await resolveLocalForeignUuid(
            db.cattle as unknown as Table<BaseLocalEntity, string>,
            rawCattleId
          )
        : undefined;

      const feedingRecord: LocalFeedingRecord = {
        ...baseFields,
        lotId,
        cattleId,
        tipoAlimento,
        cantidadKg,
        fecha,
        racion: readString(data, ['racion'], existingFeeding?.racion ?? tipoAlimento),
        unidad: readString(data, ['unidad'], existingFeeding?.unidad ?? 'kg'),
        frecuencia: readString(data, ['frecuencia'], existingFeeding?.frecuencia ?? 'Diaria'),
        fin: readString(data, ['fin'], existingFeeding?.fin ?? undefined) ?? null,
        cambioDieta:
          readString(data, ['cambioDieta'], existingFeeding?.cambioDieta ?? undefined) ?? null
      };
      return feedingRecord;
    }

    case 'reproductionRecords': {
      const rawCattleId = readString(data, ['idAnimal', 'cattleId', 'animalId', 'bovinoId']);
      const evento = readString(data, ['tipo', 'evento', 'event']);
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
        resultado: readString(data, ['resultado', 'result']) ?? null,
        observaciones: readString(data, ['observaciones', 'notes'])
      };
      return reproductionRecord;
    }

    case 'lots': {
      const existingLot = existing as LocalLot | undefined;
      const nombre = readString(data, ['nombre', 'name']);
      const capacidad = readNumber(data, ['capacidad', 'capacity']) ?? existingLot?.capacidad ?? 0;
      const estado = readString(data, ['estado'], existingLot?.estado ?? 'Activo') ?? 'Activo';

      if (!nombre) {
        throw new Error(`Registro remoto de lote inválido (remoteId=${String(change.remoteId)}).`);
      }

      const lotRecord: LocalLot = {
        ...baseFields,
        nombre,
        capacidad,
        ubicacion: readString(data, ['ubicacion', 'location']),
        estado
      };
      return lotRecord;
    }

    case 'movements': {
      const existingMovement = existing as LocalMovement | undefined;
      const rawCattleId = readString(data, ['idAnimal', 'cattleId', 'animalId', 'bovinoId']);
      const fecha = readString(data, ['fecha', 'date'], change.actualizadoEnServidor);
      const motivo = readString(data, ['motivo', 'reason'], existingMovement?.motivo ?? '') ?? '';
      const rawOrigen = readString(data, ['idLoteOrigen', 'origenLotId', 'originLotId']);
      const rawDestino = readString(data, ['idLoteDestino', 'destinoLotId', 'destinationLotId']);
      const tipo = readString(data, ['tipo'], existingMovement?.tipo ?? 'CambioInterno');
      const origenExterno = readString(data, ['origenExterno'], existingMovement?.origenExterno);
      const destinoExterno = readString(data, ['destinoExterno'], existingMovement?.destinoExterno);

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
        tipo,
        origenExterno,
        destinoExterno,
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
