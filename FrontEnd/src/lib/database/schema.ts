export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';

export type SyncEntityName =
  | 'serverChanges'
  | 'cattle'
  | 'weighings'
  | 'healthRecords'
  | 'feedingRecords'
  | 'reproductionRecords'
  | 'lots'
  | 'movements'
  | 'genealogy'
  | 'alerts'
  | 'media'
  | 'weighingAnalysisJobs';

export type OutboxOperationType = 'CREATE' | 'UPDATE' | 'DELETE';

export type OutboxOperationState =
  | 'pendiente'
  | 'en_proceso'
  | 'confirmado'
  | 'fallido'
  | 'conflicto';

export type ConflictType =
  | 'VERSION_MISMATCH'
  | 'DELETED_ON_SERVER'
  | 'DUPLICATE_ENTITY'
  | 'VALIDATION_REJECTED';

export type ConflictResolutionState =
  | 'pendiente'
  | 'resuelto_local'
  | 'resuelto_servidor'
  | 'fusionado'
  | 'descartado';

export type MediaSyncState =
  | 'pendiente_subida'
  | 'subiendo'
  | 'subido'
  | 'error_subida';

export type WeighingJobState =
  | 'pendiente_de_analisis'
  | 'enviando_analisis'
  | 'pendiente_de_revision'
  | 'confirmado'
  | 'error_analisis'
  | 'cuota_excedida'
  | 'cancelado';

export interface BaseLocalEntity {
  id: string;
  localNumericId?: number;
  remoteId?: string | number;
  ranchId?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  serverVersion?: number | string | null;
  deletedAt?: string | null;
}

export interface LocalCattle extends BaseLocalEntity {
  areteSiniiga: string;
  nombre?: string;
  raza: string;
  gender: string;
  fechaNacimiento?: string;
  loteId?: string;
}

export interface LocalWeighing extends BaseLocalEntity {
  cattleId: string;
  peso: number;
  fecha: string;
  observaciones?: string;
  origenPesaje?: 'manual' | 'boviscale_ia';
  sourceAnalysisJobId?: string | null;
  sourceMediaId?: string | null;
}

export interface LocalHealthRecord extends BaseLocalEntity {
  cattleId: string;
  tipo: string;
  descripcion: string;
  fecha: string;
  proximaAplicacion?: string;
}

export interface LocalFeedingRecord extends BaseLocalEntity {
  lotId?: string;
  tipoAlimento: string;
  cantidadKg: number;
  fecha: string;
}

export interface LocalReproductionRecord extends BaseLocalEntity {
  cattleId: string;
  evento: string;
  fecha: string;
  observaciones?: string;
}

export interface LocalLot extends BaseLocalEntity {
  nombre: string;
  capacidad: number;
  ubicacion?: string;
}

export interface LocalMovement extends BaseLocalEntity {
  cattleId: string;
  origenLotId?: string;
  destinoLotId?: string;
  fecha: string;
  motivo: string;
}

export interface LocalGenealogy extends BaseLocalEntity {
  cattleId: string;
  padreId?: string;
  madreId?: string;
}

export interface LocalAlert extends BaseLocalEntity {
  tipo: string;
  prioridad: string;
  mensaje: string;
  leida: boolean;
  fecha: string;
}

export interface LocalMedia extends BaseLocalEntity {
  cattleId?: string;
  entidadRelacionada: 'cattle' | 'weighings' | 'healthRecords';
  idEntidadRelacionada?: string;
  tipo: 'FotoPerfil' | 'BoviScaleVision' | 'Documento';
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  checksumSha256?: string | null;
  blobData?: Blob;
  urlRemota?: string | null;
  idOperacionSubida?: string | null;
  estadoArchivo: MediaSyncState;
  intentosSubida: number;
  ultimoErrorSubida?: string | null;
  fechaCaptura: string;
}

export interface LocalWeighingAnalysisJob {
  idTrabajo: string;
  idMedia: string;
  idBovino: string;
  ranchId?: string;
  idOperacion?: string | null;
  estado: WeighingJobState;
  pesoEstimadoKg?: number | null;
  pesoConfirmadoKg?: number | null;
  idPesajeConfirmado?: string | null;
  confianzaModelo?: number | null;
  versionModelo?: string | null;
  observacionesModelo?: string | null;
  metadatosCaptura?: {
    angulo?: string;
    distanciaEstimadaCm?: number;
    resolucion?: string;
    dispositivo?: string;
  };
  intentos: number;
  ultimoError?: string | null;
  codigoErrorHttp?: number | null;
  proximoIntento?: string | null;
  fechaCreacion: string;
  actualizadoEn: string;
  analizadoEn?: string | null;
  completadoEn?: string | null;
}

export interface LocalOutboxQueue {
  id: string;
  idOperacion: string;
  entidad: SyncEntityName;
  idEntidad: string;
  tipoOperacion: OutboxOperationType;
  versionBase: number | string | null;
  payload: unknown;
  estado: OutboxOperationState;
  fechaCreacion: string;
  intentos: number;
  ultimoError: string | null;
  proximoIntento: string | null;
}

export interface LocalSyncConflict {
  idConflicto: string;
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
  estadoResolucion: ConflictResolutionState;
  fechaDeteccion: string;
  fechaResolucion?: string | null;
  notasResolucion?: string | null;
}

export interface LocalSyncCheckpoint {
  entidad: string;             // Clave primaria por entidad/usuario sincronizado
  cursorOpaco: string | null;  // Cursor opaco emitido por el servidor (nunca solo fecha)
  ultimaFechaServidor?: string | null;
  actualizadoEn: string;
}

export interface LocalServerChange {
  idCambio: number;
  entidad: string;
  idRegistro: string;
  idRancho: number;
  operacion: 'crear' | 'actualizar' | 'eliminar';
  ocurrioEn: string;
  datos: Record<string, unknown>;
  recibidoEn: string;
  aplicadoEn: string | null;
}

export interface LocalSyncMetadata {
  entityName: string;
  lastSyncedAt?: string;
  lastServerVersion?: number;
}
