import type {
  SyncBatchPushResponseDto,
  SyncOperationOutcome,
  SyncOperationResultDto,
  SyncPullResponseDto,
  SyncRemoteChangeItemDto
} from '../../types/sync-contracts';
import type { SyncEntityName } from '../../lib/database/schema';

export type ResponseValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; reason: string };

const VALID_OUTCOMES = new Set<SyncOperationOutcome>([
  'ACCEPTED',
  'ALREADY_PROCESSED',
  'CONFLICT',
  'VALIDATION_ERROR',
  'TRANSIENT_ERROR'
]);

const VALID_ENTITIES = new Set<SyncEntityName>([
  'cattle',
  'weighings',
  'healthRecords',
  'feedingRecords',
  'reproductionRecords',
  'lots',
  'movements',
  'genealogy',
  'alerts',
  'media',
  'weighingAnalysisJobs'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidVersion(value: unknown): value is number | string {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

export function validateSyncOperationResult(
  raw: unknown,
  expectedOperationId?: string
): ResponseValidationResult<SyncOperationResultDto> {
  if (!isRecord(raw)) {
    return { valid: false, reason: 'La respuesta de operación no es un objeto JSON válido.' };
  }

  if (typeof raw.idOperacion !== 'string' || raw.idOperacion.trim().length === 0) {
    return { valid: false, reason: 'La respuesta omite el campo obligatorio idOperacion.' };
  }

  if (expectedOperationId && raw.idOperacion !== expectedOperationId) {
    return {
      valid: false,
      reason: `El idOperacion devuelto (${raw.idOperacion}) no coincide con el enviado (${expectedOperationId}).`
    };
  }

  if (typeof raw.entidad !== 'string' || !VALID_ENTITIES.has(raw.entidad as SyncEntityName)) {
    return { valid: false, reason: 'La respuesta contiene una entidad desconocida o ausente.' };
  }

  if (typeof raw.idEntidad !== 'string' || raw.idEntidad.trim().length === 0) {
    return { valid: false, reason: 'La respuesta omite idEntidad.' };
  }

  if (
    typeof raw.resultado !== 'string' ||
    !VALID_OUTCOMES.has(raw.resultado as SyncOperationOutcome)
  ) {
    return {
      valid: false,
      reason: 'La respuesta HTTP no confirma explícitamente un resultado válido de sincronización.'
    };
  }

  const outcome = raw.resultado as SyncOperationOutcome;

  // Un HTTP 200 con ACCEPTED o ALREADY_PROCESSED debe traer versión confirmada del servidor
  if (
    (outcome === 'ACCEPTED' || outcome === 'ALREADY_PROCESSED') &&
    !isValidVersion(raw.versionServidor)
  ) {
    return {
      valid: false,
      reason: `La operación ${outcome} no incluye una versionServidor confirmada.`
    };
  }

  // Un CONFLICT debe aportar versionServidor o estadoServidor para permitir resolución
  if (
    outcome === 'CONFLICT' &&
    !isValidVersion(raw.versionServidor) &&
    !isRecord(raw.estadoServidor)
  ) {
    return {
      valid: false,
      reason: 'El conflicto reportado no incluye versionServidor ni estadoServidor.'
    };
  }

  const normalized: SyncOperationResultDto = {
    idOperacion: raw.idOperacion,
    entidad: raw.entidad as SyncEntityName,
    idEntidad: raw.idEntidad,
    resultado: outcome,
    remoteId:
      typeof raw.remoteId === 'string' || typeof raw.remoteId === 'number'
        ? raw.remoteId
        : null,
    versionServidor: isValidVersion(raw.versionServidor) ? raw.versionServidor : null,
    estadoServidor: isRecord(raw.estadoServidor) ? raw.estadoServidor : null,
    mensaje: typeof raw.mensaje === 'string' ? raw.mensaje : undefined,
    erroresCampos: isRecord(raw.erroresCampos)
      ? (raw.erroresCampos as Record<string, string[]>)
      : undefined,
    codigoHttp: typeof raw.codigoHttp === 'number' ? raw.codigoHttp : undefined,
    retryAfterMs: typeof raw.retryAfterMs === 'number' ? raw.retryAfterMs : null,
    procesadoEnServidor:
      typeof raw.procesadoEnServidor === 'string' ? raw.procesadoEnServidor : undefined
  };

  return { valid: true, value: normalized };
}

export function validateSyncBatchPushResponse(
  raw: unknown,
  expectedOperationIds: readonly string[]
): ResponseValidationResult<SyncBatchPushResponseDto> {
  if (!isRecord(raw)) {
    return { valid: false, reason: 'La respuesta del lote no es un objeto JSON válido.' };
  }

  if (!Array.isArray(raw.resultados)) {
    return { valid: false, reason: 'La respuesta del lote omite el arreglo resultados.' };
  }

  if (typeof raw.fechaServidor !== 'string' || raw.fechaServidor.trim().length === 0) {
    return { valid: false, reason: 'La respuesta del lote omite fechaServidor.' };
  }

  const validatedResults: SyncOperationResultDto[] = [];
  const seenIds = new Set<string>();

  for (const item of raw.resultados) {
    const itemValidation = validateSyncOperationResult(item);
    if (!itemValidation.valid) {
      return itemValidation;
    }
    validatedResults.push(itemValidation.value);
    seenIds.add(itemValidation.value.idOperacion);
  }

  for (const expectedId of expectedOperationIds) {
    if (!seenIds.has(expectedId)) {
      return {
        valid: false,
        reason: `Respuesta incompleta: falta confirmación explícita para idOperacion ${expectedId}.`
      };
    }
  }

  return {
    valid: true,
    value: {
      resultados: validatedResults,
      fechaServidor: raw.fechaServidor
    }
  };
}

export function validateSyncPullResponse<TData = Record<string, unknown>>(
  raw: unknown,
  expectedEntity: SyncEntityName
): ResponseValidationResult<SyncPullResponseDto<TData>> {
  if (!isRecord(raw)) {
    return { valid: false, reason: 'La respuesta de descarga no es un objeto JSON válido.' };
  }

  if (raw.entidad !== expectedEntity) {
    return {
      valid: false,
      reason: `Entidad inesperada en descarga: se esperaba ${expectedEntity}.`
    };
  }

  if (!Array.isArray(raw.cambios)) {
    return { valid: false, reason: 'La respuesta de descarga omite el arreglo cambios.' };
  }

  if (raw.siguienteCursorOpaco !== null && typeof raw.siguienteCursorOpaco !== 'string') {
    return {
      valid: false,
      reason: 'siguienteCursorOpaco debe ser una cadena opaca o null.'
    };
  }

  if (typeof raw.hayMasPaginas !== 'boolean') {
    return {
      valid: false,
      reason: 'La respuesta de descarga omite el indicador booleano hayMasPaginas.'
    };
  }

  if (raw.hayMasPaginas && (!raw.siguienteCursorOpaco || raw.siguienteCursorOpaco.trim() === '')) {
    return {
      valid: false,
      reason: 'hayMasPaginas es true pero siguienteCursorOpaco está vacío.'
    };
  }

  const validatedChanges: SyncRemoteChangeItemDto<TData>[] = [];

  for (const rawItem of raw.cambios) {
    if (!isRecord(rawItem)) {
      return { valid: false, reason: 'Un elemento dentro de cambios no es un objeto válido.' };
    }

    if (typeof rawItem.remoteId !== 'string' && typeof rawItem.remoteId !== 'number') {
      return { valid: false, reason: 'Un cambio remoto omite remoteId.' };
    }

    if (rawItem.operacion !== 'UPSERT' && rawItem.operacion !== 'DELETE') {
      return { valid: false, reason: 'Un cambio remoto tiene operacion inválida.' };
    }

    if (!isValidVersion(rawItem.versionServidor)) {
      return { valid: false, reason: 'Un cambio remoto omite versionServidor.' };
    }

    if (typeof rawItem.eliminado !== 'boolean') {
      return { valid: false, reason: 'Un cambio remoto omite el indicador eliminado.' };
    }

    if (!rawItem.eliminado && rawItem.operacion === 'UPSERT' && !isRecord(rawItem.datos)) {
      return {
        valid: false,
        reason: 'Un cambio UPSERT activo no incluye el objeto datos.'
      };
    }

    if (
      typeof rawItem.actualizadoEnServidor !== 'string' ||
      rawItem.actualizadoEnServidor.trim().length === 0
    ) {
      return { valid: false, reason: 'Un cambio remoto omite actualizadoEnServidor.' };
    }

    validatedChanges.push({
      remoteId: rawItem.remoteId,
      clientUuid: typeof rawItem.clientUuid === 'string' ? rawItem.clientUuid : null,
      operacion: rawItem.operacion,
      versionServidor: rawItem.versionServidor,
      datos: isRecord(rawItem.datos) ? (rawItem.datos as TData) : null,
      eliminado: rawItem.eliminado,
      actualizadoEnServidor: rawItem.actualizadoEnServidor
    });
  }

  return {
    valid: true,
    value: {
      entidad: expectedEntity,
      cambios: validatedChanges,
      siguienteCursorOpaco: raw.siguienteCursorOpaco,
      hayMasPaginas: raw.hayMasPaginas,
      fechaServidor: typeof raw.fechaServidor === 'string' ? raw.fechaServidor : undefined
    }
  };
}
