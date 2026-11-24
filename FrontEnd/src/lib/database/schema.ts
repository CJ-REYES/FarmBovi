export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';

export type SyncEntityName =
  | 'ranches'
  | 'cattle'
  | 'weighings'
  | 'healthRecords'
  | 'treatments'
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

export interface LocalRanch extends BaseLocalEntity {
  nombre: string;
  ubicacionGeneral: string;
  estado: string;
}

export interface LocalCattle extends BaseLocalEntity {
  /** Identificador oficial / arete del animal (campo `arete` en Backend `Animal`). */
  arete: string;
  /** Alias legado mantenido en sincronía con `arete` por compatibilidad con v1–v3 y Pull. */
  areteSiniiga: string;
  /** Campo legado local (no existe en Backend `Animal`). */
  nombre?: string;
  raza: string;
  /** Sexo del animal (`sexo` en Backend `Animal`: 'Hembra' | 'Macho'). */
  sexo: string;
  /** Alias legado mantenido en sincronía con `sexo` por compatibilidad con v1–v3 y Pull. */
  gender: string;
  fechaNacimiento?: string;
  /** Fecha de ingreso al rancho (`fechaIngreso` en Backend `Animal`). */
  fechaIngreso: string;
  /** Procedencia del animal (`procedencia` en Backend `Animal`). */
  procedencia: string;
  /** Estado operativo (`estado` en Backend `Animal`: 'Activo' | 'Vendido' | 'Baja'). */
  estado: string;
  /** Fecha de salida cuando estado es Vendido o Baja (`fechaSalida` en Backend `Animal`). */
  fechaSalida?: string | null;
  observaciones?: string | null;
  loteId?: string;
}

export interface LocalWeighing extends BaseLocalEntity {
  cattleId: string;
  /** Peso real de báscula en kg (`pesoRealKg` en ER `Pesaje`, siempre > 0). */
  peso: number;
  fecha: string;
  /** Fuente o equipo de báscula (`fuenteBascula` en ER `Pesaje`). */
  fuenteBascula?: string;
  /** Persona responsable del pesaje (`responsable` en ER `Pesaje`). */
  responsable?: string;
  observaciones?: string;
  origenPesaje?: 'manual' | 'boviscale_ia';
  sourceAnalysisJobId?: string | null;
  sourceMediaId?: string | null;
}

export interface LocalHealthRecord extends BaseLocalEntity {
  cattleId: string;
  tipo: string;
  /** Resumen legado sincronizado para vistas compactas (diagnóstico / síntomas / observaciones). */
  descripcion: string;
  fecha: string;
  proximaAplicacion?: string;
  sintomas?: string | null;
  diagnostico?: string | null;
  profesionalDiagnostico?: string | null;
  evidenciaDiagnosticoUri?: string | null;
  responsable?: string;
  observaciones?: string | null;
}

export interface LocalTreatment extends BaseLocalEntity {
  eventoSanitarioId: string;
  cattleId: string;
  producto: string;
  dosis: number;
  unidadDosis: string;
  viaAdministracion?: string | null;
  frecuencia: string;
  fechaInicio: string;
  fechaFin?: string | null;
  responsable: string;
  prescripcionUri?: string | null;
  estado: string;
}

export interface LocalFeedingRecord extends BaseLocalEntity {
  lotId?: string;
  /** Animal individual al que aplica la alimentación (mutuamente excluyente con `lotId`). */
  cattleId?: string;
  /** Alias legado sincronizado con `alimento` (Backend: `Alimento`). */
  tipoAlimento: string;
  /** Alias legado sincronizado con `cantidad` (Backend: `Cantidad`). */
  cantidadKg: number;
  /** Alias legado sincronizado con `inicio` (Backend: `Inicio`). */
  fecha: string;
  /** Ración aplicada (Backend: `Racion`). */
  racion?: string;
  /** Unidad de medida (Backend: `Unidad`). */
  unidad?: string;
  /** Frecuencia de suministro (Backend: `Frecuencia`). */
  frecuencia?: string;
  /** Fecha/hora opcional de finalización (Backend: `Fin`). */
  fin?: string | null;
  /** Notas de cambio de dieta / observaciones (Backend: `CambioDieta`). */
  cambioDieta?: string | null;
}

export interface LocalReproductionRecord extends BaseLocalEntity {
  cattleId: string;
  /** Semental opcional asociado al evento (Backend: `IdSemental`). */
  sementalId?: string | null;
  /** Tipo de evento reproductivo (Backend: `Tipo`). */
  evento: string;
  fecha: string;
  /** Resultado del evento reproductivo (Backend: `Resultado`). */
  resultado?: string | null;
  observaciones?: string;
}

export interface LocalLot extends BaseLocalEntity {
  nombre: string;
  capacidad: number;
  ubicacion?: string;
  estado?: string;
}

export interface LocalMovement extends BaseLocalEntity {
  cattleId: string;
  origenLotId?: string;
  destinoLotId?: string;
  /** Tipo de movimiento real del Backend (`Alta` | `CambioInterno` | `Traslado` | `Venta` | `Baja`). */
  tipo?: string;
  origenExterno?: string;
  destinoExterno?: string;
  fecha: string;
  motivo: string;
}

export interface LocalGenealogy extends BaseLocalEntity {
  cattleId: string;
  padreId?: string;
  madreId?: string;
  observaciones?: string | null;
}

export interface LocalAlert extends BaseLocalEntity {
  tipo: string;
  prioridad: string;
  /** Alias sincronizado con `descripcion` en Backend `Recordatorio`. */
  mensaje: string;
  /** Alias sincronizado con `estado === 'Completado'`. */
  leida: boolean;
  /** Alias sincronizado con `fechaProgramada` en Backend `Recordatorio`. */
  fecha: string;
  /** Animal asociado opcional (`idAnimal` en `Recordatorio`, excluyente con `lotId`). */
  cattleId?: string | null;
  /** Lote/potrero asociado opcional (`idLote` en `Recordatorio`, excluyente con `cattleId`). */
  lotId?: string | null;
  /** Tratamiento vinculado opcional (`idTratamiento` en `Recordatorio`). */
  treatmentId?: string | null;
  /** Usuario responsable opcional (`idResponsable` en `Recordatorio`). */
  responsableId?: string | null;
  /** Estado real del recordatorio (`Pendiente` | `En curso` | `Completado` | `Cancelado`). */
  estado?: string;
  /** Fecha/hora de completado (`fechaCompletado` en `Recordatorio`). */
  fechaCompletado?: string | null;
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
  /** Identificador de dispositivo emisor para auditoría y sincronización Push. */
  idDispositivo?: string | null;
  /** Identificador del rancho propietario para facilitar sincronización sin depender de lookups posteriores. */
  idRancho?: string | null;
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
  datosResueltos?: Record<string, unknown> | null;
}
export interface LocalSyncCheckpoint {
  entidad: SyncEntityName;
  cursorOpaco: string | null;
  ultimaFechaServidor?: string | null;
  actualizadoEn: string;
}

export interface LocalSyncMetadata {
  entityName: string;
  lastSyncedAt?: string;
  lastServerVersion?: number;
}
