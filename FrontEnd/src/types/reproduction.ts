import type { SyncStatus } from '../lib/database/schema';

/**
 * Sugerencias de tipos de evento reproductivo del ciclo ganadero real
 * (compatible con tipos personalizados registrados previamente).
 */
export const REPRODUCTION_EVENT_SUGGESTED_TYPES = [
  'Detección de celo',
  'Servicio o monta',
  'Monta Natural',
  'Inseminación',
  'Inseminación Artificial',
  'Diagnóstico de gestación',
  'Confirmación de gestación',
  'Parto',
  'Pérdida gestacional',
  'Secado',
  'Destete'
] as const;

/**
 * Sugerencias para el campo opcional `resultado` alineado a `EventoReproductivo`.
 */
export const REPRODUCTION_RESULT_SUGGESTED = [
  'Pendiente',
  'Positivo / Gestante',
  'Negativo / Vacía',
  'Cría Viva',
  'Cría Muerta',
  'Exitoso',
  'Con Complicaciones'
] as const;

export type ReproductionStage = 'servicios' | 'gestaciones' | 'partos';

/**
 * Contrato de dominio del Frontend para eventos reproductivos, alineado a
 * `LocalReproductionRecord` (IndexedDB) y `EventoReproductivo` en el Backend.
 */
export interface ReproductionEvent {
  id: string;
  idEventoReproductivo: string;
  remoteId?: string | number;
  idRancho: string;
  idAnimal: string;
  idSemental?: string | null;
  /** Tipo de evento reproductivo (almacenado en `evento` en IndexedDB por compatibilidad). */
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface ReproductionEventInput {
  idAnimal: string;
  idSemental?: string | null;
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
}

export interface BackendEventoReproductivoPayload {
  idEventoReproductivo?: string;
  idAnimal: string;
  idSemental?: string | null;
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
  versionRegistro?: number;
}

export interface BackendEventoReproductivoDto {
  idEventoReproductivo: string;
  idAnimal: string;
  idSemental: string | null;
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
  idAutor: string;
  creadoEn: string;
  versionRegistro: number;
  eliminadoEn: string | null;
}
