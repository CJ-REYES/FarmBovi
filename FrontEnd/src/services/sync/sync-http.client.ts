import {
  API_BASE_URL,
  ApiError,
  BACKEND_ROUTES,
  apiRequest,
  buildApiUrl
} from '../../lib/api';
import type { LocalOutboxQueue, OutboxOperationType, SyncEntityName } from '../../lib/database/schema';
import type {
  BackendEndpointAvailability,
  SyncBatchPushRequestDto,
  SyncBatchPushResponseDto,
  SyncConflictFieldDiffDto,
  SyncEndpointsConfig,
  SyncOperationRequestDto,
  SyncOperationResultDto,
  SyncPullRequestDto,
  SyncPullResponseDto
} from '../../types/sync-contracts';
import {
  validateSyncBatchPushResponse,
  validateSyncOperationResult,
  validateSyncPullResponse
} from './sync-response.validator';
import { isValidGuid } from '../cattle.validation';

export class SyncEndpointNotConfiguredError extends Error {
  readonly endpointType: 'push' | 'pull';

  constructor(endpointType: 'push' | 'pull') {
    super(
      `El endpoint de sincronización '${endpointType}' aún no existe o no está configurado en el backend.`
    );
    this.name = 'SyncEndpointNotConfiguredError';
    this.endpointType = endpointType;
  }
}

const DEVICE_ID_STORAGE_KEY = 'farmbovi_device_id';
let fallbackDeviceId: string | null = null;

export function getOrCreateDeviceId(): string {
  if (typeof window !== 'undefined') {
    try {
      const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && /^[A-Za-z0-9._:@-]{3,120}$/.test(existing)) {
        return existing;
      }
      const generated = `pwa-web-${crypto.randomUUID()}`;
      window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
      return generated;
    } catch {
      // Continuar con identificador de memoria si localStorage no está disponible
    }
  }
  if (!fallbackDeviceId) {
    fallbackDeviceId = `pwa-web-${crypto.randomUUID()}`;
  }
  return fallbackDeviceId;
}

const CLIENT_ENTITY_TO_BACKEND: Partial<Record<SyncEntityName, string>> = {
  ranches: 'Rancho',
  lots: 'Lote',
  cattle: 'Animal',
  genealogy: 'GenealogiaAnimal',
  weighings: 'Pesaje',
  healthRecords: 'EventoSanitario',
  treatments: 'Tratamiento',
  feedingRecords: 'Alimentacion',
  reproductionRecords: 'EventoReproductivo',
  movements: 'MovimientoAnimal',
  alerts: 'Recordatorio',
  media: 'ArchivoMultimedia'
};

function mapOperationToBackend(op: OutboxOperationType): 'Crear' | 'Actualizar' | 'Eliminar' {
  switch (op) {
    case 'CREATE':
      return 'Crear';
    case 'UPDATE':
      return 'Actualizar';
    case 'DELETE':
      return 'Eliminar';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePayloadRanchId(dto: SyncOperationRequestDto): string {
  if (dto.ranchId && isValidGuid(dto.ranchId)) {
    return dto.ranchId;
  }
  if (isPlainRecord(dto.payload)) {
    const candidate = dto.payload.idRancho ?? dto.payload.ranchId;
    if (typeof candidate === 'string' && isValidGuid(candidate)) {
      return candidate;
    }
  }
  return '';
}

function resolveBackendRecordId(dto: SyncOperationRequestDto): string {
  if (typeof dto.remoteId === 'string' && isValidGuid(dto.remoteId)) {
    return dto.remoteId;
  }
  if (isValidGuid(dto.idEntidad)) {
    return dto.idEntidad;
  }
  return dto.idEntidad;
}

function normalizeCattlePayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  idRancho: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idAnimal: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const arete =
    typeof rawPayload.arete === 'string'
      ? rawPayload.arete.trim()
      : typeof rawPayload.areteSiniiga === 'string'
        ? rawPayload.areteSiniiga.trim()
        : undefined;
  const sexo =
    typeof rawPayload.sexo === 'string'
      ? rawPayload.sexo.trim()
      : typeof rawPayload.gender === 'string'
        ? rawPayload.gender.trim()
        : undefined;
  const rawLote =
    rawPayload.idLote !== undefined
      ? rawPayload.idLote
      : rawPayload.loteId !== undefined
        ? rawPayload.loteId
        : undefined;
  const idLote =
    typeof rawLote === 'string' && rawLote.trim().length > 0 ? rawLote.trim() : rawLote === null ? null : undefined;

  const backendPayload: Record<string, unknown> = {};

  if (tipoOperacion === 'CREATE') {
    backendPayload.idAnimal = idRegistro;
    backendPayload.idRancho = idRancho;
  }

  if (idLote !== undefined) backendPayload.idLote = idLote;
  if (arete !== undefined) backendPayload.arete = arete;
  if (typeof rawPayload.raza === 'string') backendPayload.raza = rawPayload.raza.trim();
  if (sexo !== undefined) backendPayload.sexo = sexo;
  if (rawPayload.fechaNacimiento !== undefined) {
    backendPayload.fechaNacimiento =
      typeof rawPayload.fechaNacimiento === 'string' && rawPayload.fechaNacimiento.trim().length > 0
        ? rawPayload.fechaNacimiento.trim()
        : null;
  }
  if (typeof rawPayload.fechaIngreso === 'string' && rawPayload.fechaIngreso.trim().length > 0) {
    backendPayload.fechaIngreso = rawPayload.fechaIngreso.trim();
  }
  if (typeof rawPayload.procedencia === 'string') {
    backendPayload.procedencia = rawPayload.procedencia.trim();
  }
  if (typeof rawPayload.estado === 'string') {
    backendPayload.estado = rawPayload.estado.trim();
  }
  if (rawPayload.fechaSalida !== undefined) {
    backendPayload.fechaSalida =
      typeof rawPayload.fechaSalida === 'string' && rawPayload.fechaSalida.trim().length > 0
        ? rawPayload.fechaSalida.trim()
        : null;
  }
  if (rawPayload.observaciones !== undefined) {
    backendPayload.observaciones =
      typeof rawPayload.observaciones === 'string' && rawPayload.observaciones.trim().length > 0
        ? rawPayload.observaciones.trim()
        : null;
  }

  return backendPayload;
}

function normalizeLotPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  idRancho: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idLote: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idLote = idRegistro;
    backendPayload.idRancho = idRancho;
  }

  if (typeof rawPayload.nombre === 'string') {
    backendPayload.nombre = rawPayload.nombre.trim();
  }
  if (rawPayload.ubicacion !== undefined) {
    backendPayload.ubicacion =
      typeof rawPayload.ubicacion === 'string' && rawPayload.ubicacion.trim().length > 0
        ? rawPayload.ubicacion.trim()
        : null;
  }
  if (typeof rawPayload.estado === 'string' && rawPayload.estado.trim().length > 0) {
    backendPayload.estado = rawPayload.estado.trim();
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.estado = 'Activo';
  }

  return backendPayload;
}

function normalizeMovementPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idMovimiento: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readGuidOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idMovimiento = idRegistro;
    const idAnimal = readGuidOrNull(['idAnimal', 'cattleId']);
    if (typeof idAnimal === 'string') {
      backendPayload.idAnimal = idAnimal;
    }
  }

  const idLoteOrigen = readGuidOrNull(['idLoteOrigen', 'origenLotId']);
  if (idLoteOrigen !== undefined) backendPayload.idLoteOrigen = idLoteOrigen;

  const idLoteDestino = readGuidOrNull(['idLoteDestino', 'destinoLotId']);
  if (idLoteDestino !== undefined) backendPayload.idLoteDestino = idLoteDestino;

  const tipo = readTextOrNull(['tipo']);
  if (typeof tipo === 'string') {
    backendPayload.tipo = tipo;
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.tipo = 'CambioInterno';
  }

  const fecha = readTextOrNull(['fecha']);
  if (typeof fecha === 'string') {
    backendPayload.fecha = fecha;
  }

  const origenExterno = readTextOrNull(['origenExterno']);
  if (origenExterno !== undefined) backendPayload.origenExterno = origenExterno;

  const destinoExterno = readTextOrNull(['destinoExterno']);
  if (destinoExterno !== undefined) backendPayload.destinoExterno = destinoExterno;

  const motivo = readTextOrNull(['motivo']);
  if (motivo !== undefined) backendPayload.motivo = motivo;

  return backendPayload;
}

function normalizeFeedingPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idAlimentacion: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readGuidOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idAlimentacion = idRegistro;
  }

  const idAnimal = readGuidOrNull(['idAnimal', 'cattleId']);
  if (idAnimal !== undefined) backendPayload.idAnimal = idAnimal;

  const idLote = readGuidOrNull(['idLote', 'lotId', 'loteId']);
  if (idLote !== undefined) backendPayload.idLote = idLote;

  const alimento = readTextOrNull(['alimento', 'tipoAlimento']);
  if (typeof alimento === 'string') backendPayload.alimento = alimento;

  const racion = readTextOrNull(['racion']);
  if (typeof racion === 'string') {
    backendPayload.racion = racion;
  } else if (tipoOperacion === 'CREATE' && typeof alimento === 'string') {
    backendPayload.racion = alimento;
  }

  const rawCantidad = rawPayload.cantidad ?? rawPayload.cantidadKg;
  if (typeof rawCantidad === 'number' && Number.isFinite(rawCantidad)) {
    backendPayload.cantidad = rawCantidad;
  } else if (typeof rawCantidad === 'string' && rawCantidad.trim().length > 0) {
    const parsed = Number(rawCantidad);
    if (Number.isFinite(parsed)) backendPayload.cantidad = parsed;
  }

  const unidad = readTextOrNull(['unidad']);
  if (typeof unidad === 'string') {
    backendPayload.unidad = unidad;
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.unidad = 'kg';
  }

  const frecuencia = readTextOrNull(['frecuencia']);
  if (typeof frecuencia === 'string') {
    backendPayload.frecuencia = frecuencia;
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.frecuencia = 'Diaria';
  }

  const inicio = readTextOrNull(['inicio', 'fecha']);
  if (typeof inicio === 'string') backendPayload.inicio = inicio;

  const fin = readTextOrNull(['fin']);
  if (fin !== undefined) backendPayload.fin = fin;

  const cambioDieta = readTextOrNull(['cambioDieta']);
  if (cambioDieta !== undefined) backendPayload.cambioDieta = cambioDieta;

  return backendPayload;
}

function normalizeWeighingPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idPesaje: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idPesaje = idRegistro;
    const idAnimal = readTextOrNull(['idAnimal', 'cattleId']);
    if (typeof idAnimal === 'string') {
      backendPayload.idAnimal = idAnimal;
    }
  }

  const rawPeso = rawPayload.pesoRealKg ?? rawPayload.peso;
  if (typeof rawPeso === 'number' && Number.isFinite(rawPeso)) {
    backendPayload.pesoRealKg = rawPeso;
  } else if (typeof rawPeso === 'string' && rawPeso.trim().length > 0) {
    const parsed = Number(rawPeso);
    if (Number.isFinite(parsed)) backendPayload.pesoRealKg = parsed;
  }

  const fecha = readTextOrNull(['fecha']);
  if (typeof fecha === 'string') backendPayload.fecha = fecha;

  const fuenteBascula = readTextOrNull(['fuenteBascula']);
  if (typeof fuenteBascula === 'string') {
    backendPayload.fuenteBascula = fuenteBascula;
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.fuenteBascula = 'Báscula registrada en campo';
  }

  const responsable = readTextOrNull(['responsable']);
  if (typeof responsable === 'string') {
    backendPayload.responsable = responsable;
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.responsable = 'Operador de campo';
  }

  const observaciones = readTextOrNull(['observaciones']);
  if (observaciones !== undefined) backendPayload.observaciones = observaciones;

  const origenPesaje = readTextOrNull(['origenPesaje']);
  if (typeof origenPesaje === 'string') {
    backendPayload.origenPesaje = origenPesaje;
  }

  return backendPayload;
}

function normalizeHealthEventPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idEventoSanitario: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idEventoSanitario = idRegistro;
    const idAnimal = readTextOrNull(['idAnimal', 'cattleId']);
    if (typeof idAnimal === 'string') {
      backendPayload.idAnimal = idAnimal;
    }
  }

  const tipo = readTextOrNull(['tipo']);
  if (typeof tipo === 'string') backendPayload.tipo = tipo;

  const fecha = readTextOrNull(['fecha']);
  if (typeof fecha === 'string') backendPayload.fecha = fecha;

  const sintomas = readTextOrNull(['sintomas']);
  if (sintomas !== undefined) backendPayload.sintomas = sintomas;

  const diagnostico = readTextOrNull(['diagnostico']);
  if (diagnostico !== undefined) backendPayload.diagnostico = diagnostico;

  const profesional = readTextOrNull(['profesionalDiagnostico']);
  if (profesional !== undefined) backendPayload.profesionalDiagnostico = profesional;

  const evidencia = readTextOrNull(['evidenciaDiagnosticoUri']);
  if (evidencia !== undefined) backendPayload.evidenciaDiagnosticoUri = evidencia;

  const responsable = readTextOrNull(['responsable']);
  if (typeof responsable === 'string') {
    backendPayload.responsable = responsable;
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.responsable = 'Responsable de campo';
  }

  const observaciones = readTextOrNull(['observaciones', 'descripcion']);
  if (observaciones !== undefined) backendPayload.observaciones = observaciones;

  return backendPayload;
}

function normalizeTreatmentPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idTratamiento: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idTratamiento = idRegistro;
    const idEvento = readTextOrNull(['idEventoSanitario', 'eventoSanitarioId']);
    if (typeof idEvento === 'string') {
      backendPayload.idEventoSanitario = idEvento;
    }
  }

  const producto = readTextOrNull(['producto']);
  if (typeof producto === 'string') backendPayload.producto = producto;

  const rawDosis = rawPayload.dosis;
  if (typeof rawDosis === 'number' && Number.isFinite(rawDosis)) {
    backendPayload.dosis = rawDosis;
  } else if (typeof rawDosis === 'string' && rawDosis.trim().length > 0) {
    const parsed = Number(rawDosis);
    if (Number.isFinite(parsed)) backendPayload.dosis = parsed;
  }

  const unidadDosis = readTextOrNull(['unidadDosis']);
  if (typeof unidadDosis === 'string') backendPayload.unidadDosis = unidadDosis;

  const via = readTextOrNull(['viaAdministracion']);
  if (via !== undefined) backendPayload.viaAdministracion = via;

  const frecuencia = readTextOrNull(['frecuencia']);
  if (typeof frecuencia === 'string') backendPayload.frecuencia = frecuencia;

  const fechaInicio = readTextOrNull(['fechaInicio']);
  if (typeof fechaInicio === 'string') backendPayload.fechaInicio = fechaInicio;

  const fechaFin = readTextOrNull(['fechaFin']);
  if (fechaFin !== undefined) backendPayload.fechaFin = fechaFin;

  const responsable = readTextOrNull(['responsable']);
  if (typeof responsable === 'string') backendPayload.responsable = responsable;

  const prescripcion = readTextOrNull(['prescripcionUri']);
  if (prescripcion !== undefined) backendPayload.prescripcionUri = prescripcion;

  const estado = readTextOrNull(['estado']);
  if (typeof estado === 'string') backendPayload.estado = estado;

  return backendPayload;
}

function normalizeReproductionDateForBackend(rawFecha: string): string {
  const trimmed = rawFecha.trim();
  if (!trimmed) return trimmed;
  // Fecha calendario pura ("yyyy-MM-dd") se conserva intacta
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Si ya incluye zona horaria explícita ("Z" o "±HH:MM"), conservarla
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
    return trimmed;
  }
  // Cadena local proveniente de datetime-local o registros previos en cola (ej. "2026-11-05T08:12:00")
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return trimmed;
}

function normalizeReproductionPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idEventoReproductivo: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idEventoReproductivo = idRegistro;
  }

  const idAnimal = readTextOrNull(['idAnimal', 'cattleId', 'animalId']);
  if (typeof idAnimal === 'string') {
    backendPayload.idAnimal = idAnimal;
  }

  const idSemental = readTextOrNull(['idSemental', 'sementalId', 'sireId']);
  if (idSemental !== undefined) {
    backendPayload.idSemental = idSemental;
  }

  const tipo = readTextOrNull(['tipo', 'evento', 'event']);
  if (typeof tipo === 'string') backendPayload.tipo = tipo;

  const fecha = readTextOrNull(['fecha', 'date']);
  if (typeof fecha === 'string') {
    backendPayload.fecha = normalizeReproductionDateForBackend(fecha);
  }

  const resultado = readTextOrNull(['resultado', 'result']);
  if (resultado !== undefined) backendPayload.resultado = resultado;

  const observaciones = readTextOrNull(['observaciones', 'notes']);
  if (observaciones !== undefined) backendPayload.observaciones = observaciones;

  return backendPayload;
}

function normalizeGenealogyPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idGenealogia: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readGuidOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idGenealogia = idRegistro;
    const idAnimal = readGuidOrNull(['idAnimal', 'cattleId']);
    if (typeof idAnimal === 'string') {
      backendPayload.idAnimal = idAnimal;
    }
  }

  const idPadre = readGuidOrNull(['idPadre', 'padreId']);
  if (idPadre !== undefined) backendPayload.idPadre = idPadre;

  const idMadre = readGuidOrNull(['idMadre', 'madreId']);
  if (idMadre !== undefined) backendPayload.idMadre = idMadre;

  const observaciones = readTextOrNull(['observaciones']);
  if (observaciones !== undefined) backendPayload.observaciones = observaciones;

  return backendPayload;
}

function normalizeAlertPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  idRancho: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idRecordatorio: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const readGuidOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const readTextOrNull = (keys: readonly string[]): string | null | undefined => {
    for (const key of keys) {
      if (rawPayload[key] !== undefined) {
        const val = rawPayload[key];
        if (val === null) return null;
        if (typeof val === 'string') {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
      }
    }
    return undefined;
  };

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idRecordatorio = idRegistro;
    const resolvedRancho = readGuidOrNull(['idRancho', 'ranchId']) || idRancho;
    if (typeof resolvedRancho === 'string' && resolvedRancho.length > 0) {
      backendPayload.idRancho = resolvedRancho;
    }
  }

  const idAnimal = readGuidOrNull(['idAnimal', 'cattleId']);
  if (idAnimal !== undefined) backendPayload.idAnimal = idAnimal;

  const idLote = readGuidOrNull(['idLote', 'lotId', 'loteId']);
  if (idLote !== undefined) backendPayload.idLote = idLote;

  const idTratamiento = readGuidOrNull(['idTratamiento', 'treatmentId']);
  if (idTratamiento !== undefined) backendPayload.idTratamiento = idTratamiento;

  const idResponsable = readGuidOrNull(['idResponsable', 'responsableId']);
  if (idResponsable !== undefined) backendPayload.idResponsable = idResponsable;

  const tipo = readTextOrNull(['tipo']);
  if (typeof tipo === 'string') backendPayload.tipo = tipo;

  const descripcion = readTextOrNull(['descripcion', 'mensaje']);
  if (typeof descripcion === 'string') backendPayload.descripcion = descripcion;

  const fechaProgramada = readTextOrNull(['fechaProgramada', 'fecha']);
  if (typeof fechaProgramada === 'string') backendPayload.fechaProgramada = fechaProgramada;

  const estado = readTextOrNull(['estado']);
  if (typeof estado === 'string') {
    backendPayload.estado = estado;
  } else if (typeof rawPayload.leida === 'boolean') {
    backendPayload.estado = rawPayload.leida ? 'Completado' : 'Pendiente';
  }

  const fechaCompletado = readTextOrNull(['fechaCompletado']);
  if (fechaCompletado !== undefined) backendPayload.fechaCompletado = fechaCompletado;

  return backendPayload;
}

function normalizeRanchPayloadForBackend(
  rawPayload: unknown,
  idRegistro: string,
  tipoOperacion: OutboxOperationType
): Record<string, unknown> {
  if (tipoOperacion === 'DELETE') {
    return { idRancho: idRegistro };
  }
  if (!isPlainRecord(rawPayload)) {
    return {};
  }

  const backendPayload: Record<string, unknown> = {};
  if (tipoOperacion === 'CREATE') {
    backendPayload.idRancho = idRegistro;
  }

  if (typeof rawPayload.nombre === 'string') {
    backendPayload.nombre = rawPayload.nombre.trim();
  }
  if (rawPayload.ubicacionGeneral !== undefined) {
    backendPayload.ubicacionGeneral =
      typeof rawPayload.ubicacionGeneral === 'string' && rawPayload.ubicacionGeneral.trim().length > 0
        ? rawPayload.ubicacionGeneral.trim()
        : null;
  }
  if (typeof rawPayload.estado === 'string' && rawPayload.estado.trim().length > 0) {
    backendPayload.estado = rawPayload.estado.trim();
  } else if (tipoOperacion === 'CREATE') {
    backendPayload.estado = 'Activo';
  }

  return backendPayload;
}

function buildBackendPushBody(dto: SyncOperationRequestDto): {
  body: Record<string, unknown>;
  deviceId: string;
} {
  const candidateDevice = typeof dto.idDispositivo === 'string' ? dto.idDispositivo.trim() : '';
  const deviceId =
    candidateDevice && /^[A-Za-z0-9._:@-]{3,120}$/.test(candidateDevice)
      ? candidateDevice
      : getOrCreateDeviceId();
  const idRancho = resolvePayloadRanchId(dto);
  const idRegistro = resolveBackendRecordId(dto);
  const entidadBackend = CLIENT_ENTITY_TO_BACKEND[dto.entidad] ?? dto.entidad;
  const parsedVersionBase =
    dto.tipoOperacion === 'CREATE' || dto.versionBase === null || dto.versionBase === undefined
      ? null
      : Number(dto.versionBase);

  const normalizedPayload =
    dto.entidad === 'ranches'
      ? normalizeRanchPayloadForBackend(dto.payload, idRegistro, dto.tipoOperacion)
      : dto.entidad === 'cattle'
        ? normalizeCattlePayloadForBackend(dto.payload, idRegistro, idRancho, dto.tipoOperacion)
        : dto.entidad === 'lots'
        ? normalizeLotPayloadForBackend(dto.payload, idRegistro, idRancho, dto.tipoOperacion)
        : dto.entidad === 'movements'
          ? normalizeMovementPayloadForBackend(dto.payload, idRegistro, dto.tipoOperacion)
          : dto.entidad === 'feedingRecords'
            ? normalizeFeedingPayloadForBackend(dto.payload, idRegistro, dto.tipoOperacion)
            : dto.entidad === 'weighings'
              ? normalizeWeighingPayloadForBackend(dto.payload, idRegistro, dto.tipoOperacion)
              : dto.entidad === 'healthRecords'
                ? normalizeHealthEventPayloadForBackend(dto.payload, idRegistro, dto.tipoOperacion)
                : dto.entidad === 'treatments'
                  ? normalizeTreatmentPayloadForBackend(dto.payload, idRegistro, dto.tipoOperacion)
                  : dto.entidad === 'reproductionRecords'
                    ? normalizeReproductionPayloadForBackend(
                        dto.payload,
                        idRegistro,
                        dto.tipoOperacion
                      )
                    : dto.entidad === 'genealogy'
                      ? normalizeGenealogyPayloadForBackend(
                          dto.payload,
                          idRegistro,
                          dto.tipoOperacion
                        )
                      : dto.entidad === 'alerts'
                        ? normalizeAlertPayloadForBackend(
                            dto.payload,
                            idRegistro,
                            idRancho,
                            dto.tipoOperacion
                          )
                        : isPlainRecord(dto.payload)
                          ? dto.payload
                          : {};

  return {
    deviceId,
    body: {
      idOperacion: dto.idOperacion,
      idRancho,
      idDispositivo: deviceId,
      entidad: entidadBackend,
      idRegistro,
      operacion: mapOperationToBackend(dto.tipoOperacion),
      versionBase:
        parsedVersionBase !== null && Number.isFinite(parsedVersionBase) ? parsedVersionBase : null,
      fechaLocal: dto.fechaCreacionCliente,
      payload: normalizedPayload
    }
  };
}

let configuredEndpoints: SyncEndpointsConfig = {
  pushEndpoint:
    (import.meta.env.VITE_SYNC_PUSH_URL as string | undefined)?.trim() ||
    BACKEND_ROUTES.SYNC_PUSH,
  pullEndpoint:
    (import.meta.env.VITE_SYNC_PULL_URL as string | undefined)?.trim() ||
    BACKEND_ROUTES.SYNC_PULL
};

function mapHttpErrorToOperationResult(
  dto: SyncOperationRequestDto,
  err: unknown
): SyncOperationResultDto {
  if (err instanceof ApiError) {
    const body =
      err.data && typeof err.data === 'object'
        ? (err.data as Record<string, unknown>)
        : null;

    // 409 Conflict: versión base desactualizada, eliminación concurrente o restricción de integridad
    if (err.status === 409) {
      const conflictType = typeof body?.tipoConflicto === 'string' ? body.tipoConflicto : '';
      const rawServerState = body?.estadoServidor ?? body?.datosServidor;
      const serverState =
        rawServerState && typeof rawServerState === 'object' && !Array.isArray(rawServerState)
          ? (rawServerState as Record<string, unknown>)
          : null;
      const serverVersion =
        typeof body?.versionServidor === 'number' || typeof body?.versionServidor === 'string'
          ? body.versionServidor
          : null;
      const remoteRecordId =
        typeof body?.idRegistro === 'string' && body.idRegistro.trim().length > 0
          ? body.idRegistro
          : null;
      const camposModificados = Array.isArray(body?.camposModificados)
        ? (body.camposModificados as SyncConflictFieldDiffDto[])
        : undefined;

      if (
        conflictType === 'DUPLICATE_OR_INVALID_REFERENCE' ||
        conflictType === 'CONSTRAINT_VIOLATION' ||
        conflictType === 'IDEMPOTENCY_HASH_MISMATCH'
      ) {
        return {
          idOperacion: dto.idOperacion,
          entidad: dto.entidad,
          idEntidad: dto.idEntidad,
          resultado: 'VALIDATION_ERROR',
          mensaje: err.message,
          codigoHttp: 409
        };
      }

      const normalizedConflictType: 'VERSION_MISMATCH' | 'DELETED_ON_SERVER' =
        conflictType === 'DELETED_ON_SERVER' ? 'DELETED_ON_SERVER' : 'VERSION_MISMATCH';

      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        remoteId: remoteRecordId,
        resultado: 'CONFLICT',
        tipoConflicto: normalizedConflictType,
        camposModificados,
        versionServidor: serverVersion,
        estadoServidor: serverState,
        mensaje: err.message,
        codigoHttp: 409
      };
    }

    // 400 / 422: error de validación de dominio o esquema
    if (err.status === 400 || err.status === 422) {
      // Si el Backend aún no implementa esta entidad en Sync (p. ej. Pesaje), mantenerla
      // pendiente en la cola en lugar de descartarla permanentemente.
      if (err.status === 400 && /no está soportada para sincronización/i.test(err.message)) {
        return {
          idOperacion: dto.idOperacion,
          entidad: dto.entidad,
          idEntidad: dto.idEntidad,
          resultado: 'TRANSIENT_ERROR',
          mensaje:
            'El servidor aún no habilita la sincronización para esta entidad. El registro permanece seguro en IndexedDB y en la cola pendiente.',
          codigoHttp: err.status
        };
      }

      const fieldErrors =
        body?.errors && typeof body.errors === 'object' && !Array.isArray(body.errors)
          ? (body.errors as Record<string, string[]>)
          : body?.erroresCampos &&
              typeof body.erroresCampos === 'object' &&
              !Array.isArray(body.erroresCampos)
            ? (body.erroresCampos as Record<string, string[]>)
            : undefined;

      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        resultado: 'VALIDATION_ERROR',
        mensaje: err.message,
        erroresCampos: fieldErrors,
        codigoHttp: err.status
      };
    }

    // 401 / 403: sesión expirada o permisos insuficientes (sin exponer tokens)
    if (err.status === 401 || err.status === 403) {
      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        resultado: 'TRANSIENT_ERROR',
        mensaje:
          err.status === 401
            ? 'Sesión no autenticada o expirada. Inicia sesión nuevamente para sincronizar.'
            : 'Permisos insuficientes para sincronizar en este rancho.',
        codigoHttp: err.status
      };
    }

    // 408, 429, 500, 502, 503, 504, status 0 (red/timeout) o respuestas malformadas
    return {
      idOperacion: dto.idOperacion,
      entidad: dto.entidad,
      idEntidad: dto.idEntidad,
      resultado: 'TRANSIENT_ERROR',
      mensaje: err.message,
      codigoHttp: err.status,
      retryAfterMs: err.retryAfterMs
    };
  }

  return {
    idOperacion: dto.idOperacion,
    entidad: dto.entidad,
    idEntidad: dto.idEntidad,
    resultado: 'TRANSIENT_ERROR',
    mensaje:
      err instanceof Error
        ? err.message
        : 'Error de infraestructura durante la comunicación de sincronización.'
  };
}

export const SyncHttpClient = {
  /**
   * Permite sobreescribir rutas de sincronización en tiempo de ejecución o pruebas.
   */
  configureEndpoints(config: Partial<SyncEndpointsConfig>): void {
    configuredEndpoints = {
      pushEndpoint:
        config.pushEndpoint !== undefined ? config.pushEndpoint : configuredEndpoints.pushEndpoint,
      pullEndpoint:
        config.pullEndpoint !== undefined ? config.pullEndpoint : configuredEndpoints.pullEndpoint
    };
  },

  getEndpointAvailability(): BackendEndpointAvailability {
    return {
      animalesCrudEndpoint: buildApiUrl(BACKEND_ROUTES.ANIMALES),
      animalesCrudDisponible: true,
      pushEndpoint: configuredEndpoints.pushEndpoint,
      pushDisponible: Boolean(configuredEndpoints.pushEndpoint),
      pullEndpoint: configuredEndpoints.pullEndpoint,
      pullDisponible: Boolean(configuredEndpoints.pullEndpoint)
    };
  },

  /**
   * Serializa una entrada persistente del Outbox al contrato estricto esperado por el servidor.
   */
  serializeOperationDto(
    op: LocalOutboxQueue,
    remoteId?: string | number | null,
    ranchId?: string | null
  ): SyncOperationRequestDto {
    return {
      idOperacion: op.idOperacion,
      entidad: op.entidad,
      idEntidad: op.idEntidad,
      remoteId: remoteId ?? null,
      ranchId: ranchId ?? op.idRancho ?? null,
      idDispositivo: op.idDispositivo ?? null,
      tipoOperacion: op.tipoOperacion,
      versionBase: op.versionBase,
      payload: op.payload,
      fechaCreacionCliente: op.fechaCreacion
    };
  },

  /**
   * Envía una operación individual al endpoint real `POST /api/sync/operaciones`.
   * Valida estrictamente el cuerpo de respuesta antes de aceptar confirmación.
   */
  async sendOperation(dto: SyncOperationRequestDto): Promise<SyncOperationResultDto> {
    if (!configuredEndpoints.pushEndpoint) {
      throw new SyncEndpointNotConfiguredError('push');
    }

    const { body, deviceId } = buildBackendPushBody(dto);
    const headers: Record<string, string> = {
      'X-Idempotency-Key': dto.idOperacion,
      'X-Device-Id': deviceId
    };

    if (dto.versionBase !== null && dto.versionBase !== undefined) {
      headers['If-Match'] = String(dto.versionBase);
    }

    try {
      const response = await apiRequest<unknown>(configuredEndpoints.pushEndpoint, {
        method: 'POST',
        body,
        headers
      });

      const validation = validateSyncOperationResult(
        response.data,
        dto.idOperacion,
        dto.idEntidad
      );
      if (!validation.valid) {
        return {
          idOperacion: dto.idOperacion,
          entidad: dto.entidad,
          idEntidad: dto.idEntidad,
          resultado: 'TRANSIENT_ERROR',
          mensaje: `Respuesta del servidor no válida: ${validation.reason}`,
          codigoHttp: response.status
        };
      }

      return {
        ...validation.value,
        codigoHttp: response.status
      };
    } catch (err) {
      return mapHttpErrorToOperationResult(dto, err);
    }
  },

  /**
   * Envía un lote ordenado de operaciones pendientes al servidor cuando exista endpoint batch.
   */
  async sendBatch(requestDto: SyncBatchPushRequestDto): Promise<SyncBatchPushResponseDto> {
    if (!configuredEndpoints.pushEndpoint) {
      throw new SyncEndpointNotConfiguredError('push');
    }

    if (requestDto.operaciones.length === 0) {
      return {
        resultados: [],
        fechaServidor: new Date().toISOString()
      };
    }

    const expectedIds = requestDto.operaciones.map((op) => op.idOperacion);
    const response = await apiRequest<unknown>(configuredEndpoints.pushEndpoint, {
      method: 'POST',
      body: requestDto,
      headers: {
        'X-Batch-Idempotency-Keys': expectedIds.join(',')
      }
    });

    const validation = validateSyncBatchPushResponse(response.data, expectedIds);
    if (!validation.valid) {
      throw new ApiError(
        `Respuesta de lote inválida del servidor: ${validation.reason}`,
        response.status,
        response.data
      );
    }

    return validation.value;
  },

  /**
   * Descarga cambios remotos paginados usando cursor opaco (`GET /api/sync/cambios`).
   */
  async fetchChanges<TData = Record<string, unknown>>(
    requestDto: SyncPullRequestDto
  ): Promise<SyncPullResponseDto<TData>> {
    if (!configuredEndpoints.pullEndpoint) {
      throw new SyncEndpointNotConfiguredError('pull');
    }

    const queryParams = new URLSearchParams();
    queryParams.set('entidad', requestDto.entidad);
    queryParams.set('limite', String(requestDto.limite));
    if (requestDto.cursorOpaco !== null && requestDto.cursorOpaco.trim().length > 0) {
      queryParams.set('cursorOpaco', requestDto.cursorOpaco);
    }
    if (requestDto.ranchId) {
      queryParams.set('ranchId', requestDto.ranchId);
    }

    const separator = configuredEndpoints.pullEndpoint.includes('?') ? '&' : '?';
    const urlWithQuery = `${configuredEndpoints.pullEndpoint}${separator}${queryParams.toString()}`;

    const response = await apiRequest<unknown>(urlWithQuery, {
      method: 'GET'
    });

    const validation = validateSyncPullResponse<TData>(response.data, requestDto.entidad);
    if (!validation.valid) {
      throw new ApiError(
        `Respuesta de descarga incremental inválida: ${validation.reason}`,
        response.status,
        response.data
      );
    }

    return validation.value;
  },

  getBaseUrl(): string {
    return API_BASE_URL;
  }
};
