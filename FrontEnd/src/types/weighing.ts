import type { SyncStatus } from '../lib/database/schema';

export type WeighingOrigin = 'manual' | 'boviscale_ia';

/**
 * Payload alineado al modelo lógico real `Pesaje` del diagrama ER v0.1.0 / v0.2.0
 * y a la Regla 14 (`FarmDomainValidationService.ValidatePesaje`).
 */
export interface BackendPesajePayload {
  idPesaje?: string;
  idAnimal: string;
  pesoRealKg: number;
  fecha: string;
  fuenteBascula: string;
  responsable: string;
  observaciones: string | null;
}

/**
 * Modelo de dominio de pesajes en Frontend.
 */
export interface Weighing {
  id: string;
  idPesaje: string;
  remoteId?: string | number | null;
  idRancho: string;
  idAnimal: string;
  pesoRealKg: number;
  fecha: string;
  fuenteBascula: string;
  responsable: string;
  observaciones: string | null;
  origenPesaje: WeighingOrigin;
  sourceAnalysisJobId: string | null;
  sourceMediaId: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface WeighingInput {
  idAnimal: string;
  pesoRealKg: number | string;
  fecha: string;
  fuenteBascula: string;
  responsable: string;
  observaciones: string | null;
}

export interface WeighingDelta {
  deltaKg: number;
  daysElapsed: number;
  gdpKgDay: number | null;
}

export interface WeightEvolutionPoint {
  id: string;
  fecha: string;
  label: string;
  pesoKg: number;
  sampleCount: number;
  weighingId?: string;
}

export interface AnimalLastWeightSummary {
  idAnimal: string;
  arete: string;
  raza: string;
  latestWeightKg: number;
  latestFecha: string;
  previousWeightKg: number | null;
  deltaKg: number | null;
  gdpKgDay: number | null;
  totalWeighings: number;
}

/**
 * Contrato JSON de solicitud hacia `POST /api/boviscale/estimaciones` (.NET 10).
 */
export interface SolicitarEstimacionPesoPayload {
  idSolicitud: string;
  idAnimal: string;
  idRancho?: string;
  idArchivo: string;
  fechaPesaje?: string;
  responsable?: string;
  anguloCaptura?: string;
  distanciaEstimadaCm?: number;
  observaciones?: string;
}

/**
 * Contrato JSON de respuesta desde `POST /api/boviscale/estimaciones` (.NET 10).
 */
export interface EstimacionPesoBoviScaleDto {
  idPesaje: string;
  idSolicitud: string;
  idRancho: string;
  idAnimal: string;
  idArchivoMultimedia: string | null;
  pesoEstimadoKg: number;
  unidadPeso: string;
  confianzaModelo: number | null;
  versionModelo: string | null;
  observaciones: string | null;
  origenPesaje: string;
  fuenteBascula: string;
  responsable: string;
  fechaPesaje: string;
  creadoEn: string;
  versionRegistro: number;
  duplicadoIgnorado: boolean;
  tiempoProcesamientoMs: number | null;
}

/**
 * Estados visibles del flujo de estimación BoviScale en la interfaz de usuario.
 */
export type BoviScaleEstimationStep =
  | 'fotografia_pendiente'
  | 'fotografia_validada'
  | 'solicitud_enviada'
  | 'procesando_estimacion'
  | 'estimacion_recibida'
  | 'pesaje_registrado'
  | 'error_procesamiento';
