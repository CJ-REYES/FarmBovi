import type {
  OutboxOperationType,
  SyncEntityName
} from '../lib/database/schema';

/**
 * Resultados posibles reconocidos para una operación enviada al servidor.
 * Un HTTP 200 solo se considera confirmado si el cuerpo explícitamente devuelve
 * 'ACCEPTED' o 'ALREADY_PROCESSED' con su metadata válida.
 */
export type SyncOperationOutcome =
  | 'ACCEPTED'          // Operación aplicada por primera vez en el servidor
  | 'ALREADY_PROCESSED' // Idempotencia: idOperacion ya había sido procesado antes
  | 'CONFLICT'          // Versión base desactualizada (HTTP 409 o rechazo optimista)
  | 'VALIDATION_ERROR'  // Error de negocio o esquema (HTTP 400 / 422)
  | 'TRANSIENT_ERROR';  // Fallo de red, timeout, 429, 5xx o respuesta inválida

/**
 * DTO unitario de envío saliente (Push) hacia el servidor central.
 */
export interface SyncOperationRequestDto<TPayload = unknown> {
  idOperacion: string;
  entidad: SyncEntityName;
  idEntidad: string;
  remoteId?: string | number | null;
  tipoOperacion: OutboxOperationType;
  versionBase: number | string | null;
  payload: TPayload;
  fechaCreacionCliente: string;
}

/**
 * DTO de lote para envío ordenado de operaciones pendientes.
 */
export interface SyncBatchPushRequestDto {
  dispositivoId?: string;
  ranchId?: string;
  operaciones: SyncOperationRequestDto[];
}

/**
 * Respuesta tipada individual por operación procesada.
 */
export interface SyncOperationResultDto {
  idOperacion: string;
  entidad: SyncEntityName;
  idEntidad: string;
  resultado: SyncOperationOutcome;
  remoteId?: string | number | null;
  versionServidor?: number | string | null;
  estadoServidor?: Record<string, unknown> | null;
  mensaje?: string;
  erroresCampos?: Record<string, string[]>;
  codigoHttp?: number;
  retryAfterMs?: number | null;
  procesadoEnServidor?: string;
}

/**
 * Respuesta tipada del endpoint de envío por lotes.
 */
export interface SyncBatchPushResponseDto {
  resultados: SyncOperationResultDto[];
  fechaServidor: string;
}

/**
 * DTO de solicitud para descarga incremental (Pull) paginada mediante cursor opaco.
 */
export interface SyncPullRequestDto {
  entidad: SyncEntityName;
  cursorOpaco: string | null;
  limite: number;
  ranchId?: string;
}

/**
 * Elemento individual de cambio remoto devuelto en la descarga incremental.
 */
export interface SyncRemoteChangeItemDto<TData = Record<string, unknown>> {
  remoteId: string | number;
  clientUuid?: string | null;
  operacion: 'UPSERT' | 'DELETE';
  versionServidor: number | string;
  datos: TData | null;
  eliminado: boolean;
  actualizadoEnServidor: string;
}

/**
 * Respuesta paginada de descarga incremental con cursor opaco emitido por el servidor.
 */
export interface SyncPullResponseDto<TData = Record<string, unknown>> {
  entidad: SyncEntityName;
  cambios: SyncRemoteChangeItemDto<TData>[];
  siguienteCursorOpaco: string | null;
  hayMasPaginas: boolean;
  fechaServidor?: string;
}

/**
 * Configuración explícita de rutas reales de sincronización.
 * Permanece en null mientras el backend no exponga los endpoints.
 */
export interface SyncEndpointsConfig {
  pushEndpoint: string | null;
  pullEndpoint: string | null;
}

export interface BackendEndpointAvailability {
  animalesCrudEndpoint: string;
  animalesCrudDisponible: boolean;
  pushEndpoint: string | null;
  pushDisponible: boolean;
  pullEndpoint: string | null;
  pullDisponible: boolean;
}
