import type { SyncStatus } from '../lib/database/schema';

export type FeedingTargetType = 'lote' | 'animal';

/**
 * DTO exacto devuelto por `GET /api/alimentacion` (`BackEnd/Models/Alimentacion.cs`).
 */
export interface BackendAlimentacionDto {
  idAlimentacion: string;
  idAnimal: string | null;
  idLote: string | null;
  alimento: string;
  racion: string;
  cantidad: number;
  unidad: string;
  frecuencia: string;
  inicio: string;
  fin: string | null;
  cambioDieta: string | null;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro?: number;
  eliminadoEn?: string | null;
}

/**
 * Payload exacto aceptado por `POST/PUT /api/alimentacion` y `POST /api/sync/operaciones`.
 */
export interface BackendAlimentacionPayload {
  idAlimentacion?: string;
  idAnimal: string | null;
  idLote: string | null;
  alimento: string;
  racion: string;
  cantidad: number;
  unidad: string;
  frecuencia: string;
  inicio: string;
  fin: string | null;
  cambioDieta: string | null;
}

/**
 * Modelo de dominio de alimentación alineado al contrato real del Backend (`Alimentacion`).
 */
export interface FeedingRecord {
  id: string;
  idAlimentacion: string;
  remoteId?: string | number | null;
  idRancho: string;
  targetType: FeedingTargetType;
  idAnimal: string | null;
  idLote: string | null;
  alimento: string;
  racion: string;
  cantidad: number;
  unidad: string;
  frecuencia: string;
  inicio: string;
  fin: string | null;
  cambioDieta: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface FeedingInput {
  idAnimal: string | null;
  idLote: string | null;
  alimento: string;
  racion: string;
  cantidad: number | string;
  unidad: string;
  frecuencia: string;
  inicio: string;
  fin: string | null;
  cambioDieta: string | null;
}
