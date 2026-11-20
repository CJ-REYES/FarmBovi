import type { SyncStatus } from '../lib/database/schema';

export type MovementType = 'Alta' | 'CambioInterno' | 'Traslado' | 'Venta' | 'Baja';

export const MOVEMENT_TYPES: readonly MovementType[] = [
  'CambioInterno',
  'Alta',
  'Traslado',
  'Venta',
  'Baja'
] as const;

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  CambioInterno: 'Cambio interno (entre potreros)',
  Alta: 'Alta / Ingreso',
  Traslado: 'Traslado',
  Venta: 'Venta / Salida comercial',
  Baja: 'Baja / Descarte'
};

/**
 * DTO exacto devuelto por `GET /api/movimientos-animales` (`BackEnd/Models/MovimientoAnimal.cs`).
 */
export interface BackendMovimientoAnimalDto {
  idMovimiento: string;
  idAnimal: string;
  idLoteOrigen: string | null;
  idLoteDestino: string | null;
  tipo: string;
  fecha: string;
  origenExterno: string | null;
  destinoExterno: string | null;
  motivo: string | null;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro?: number;
  eliminadoEn?: string | null;
}

/**
 * Payload exacto aceptado por `POST/PUT /api/movimientos-animales` y `POST /api/sync/operaciones`.
 */
export interface BackendMovimientoAnimalPayload {
  idMovimiento?: string;
  idAnimal: string;
  idLoteOrigen: string | null;
  idLoteDestino: string | null;
  tipo: MovementType;
  fecha: string;
  origenExterno: string | null;
  destinoExterno: string | null;
  motivo: string | null;
}

/**
 * Modelo de dominio de trazabilidad en Frontend alineado al contrato real de `MovimientoAnimal`.
 */
export interface Movement {
  id: string;
  idMovimiento: string;
  remoteId?: string | number | null;
  idRancho: string;
  idAnimal: string;
  idLoteOrigen: string | null;
  idLoteDestino: string | null;
  tipo: MovementType;
  fecha: string;
  origenExterno: string | null;
  destinoExterno: string | null;
  motivo: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface MovementInput {
  idAnimal: string;
  tipo: MovementType;
  fecha: string;
  idLoteOrigen: string | null;
  idLoteDestino: string | null;
  origenExterno: string | null;
  destinoExterno: string | null;
  motivo: string | null;
}
