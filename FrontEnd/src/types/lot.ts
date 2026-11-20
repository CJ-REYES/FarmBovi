import type { SyncStatus } from '../lib/database/schema';
import type { BackendLoteDto } from './cattle';

export type LotEstado = 'Activo' | 'Inactivo';

export const LOT_ESTADOS: readonly LotEstado[] = ['Activo', 'Inactivo'] as const;

export type { BackendLoteDto };

/**
 * Payload real aceptado por `LotesController` (`BackEnd/Models/Lote.cs`) y
 * `POST /api/sync/operaciones` (`entidad: "Lote"`).
 * No incluye propiedades inexistentes en Backend (como superficie, capacidad u observaciones).
 */
export interface BackendLotePayload {
  idLote: string;
  idRancho: string;
  nombre: string;
  ubicacion: string | null;
  estado: LotEstado;
  eliminadoEn?: string | null;
}

export interface Lot {
  id: string;
  idLote: string;
  remoteId?: string | number;
  idRancho: string;
  nombre: string;
  ubicacion: string | null;
  estado: LotEstado;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
  activeAnimalsCount: number;
}

export interface LotInput {
  idRancho: string;
  nombre: string;
  ubicacion: string | null;
  estado: LotEstado;
}
