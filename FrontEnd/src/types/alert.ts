import type { SyncStatus } from '../lib/database/schema';

/**
 * Estados operativos de `Recordatorio` compatibles con `HasMaxLength(25)` en el Backend
 * (`RecordatoriosController` asigna `FechaCompletado` automáticamente cuando `Estado == "Completado"`).
 */
export const ALERT_ESTADOS = [
  'Pendiente',
  'En curso',
  'Completado',
  'Cancelado'
] as const;

export type AlertEstado = (typeof ALERT_ESTADOS)[number];

/**
 * Sugerencias para `Recordatorio.Tipo` (campo libre en Backend con `HasMaxLength(35)`).
 */
export const ALERT_SUGGESTED_TYPES = [
  'Sanitario',
  'Tratamiento',
  'Vacunación',
  'Pesaje',
  'Alimentación',
  'Reproducción',
  'Manejo',
  'General'
] as const;

export type AlertScope = 'rancho' | 'animal' | 'lote';

export type AlertTimingStatus =
  | 'vencida'
  | 'proxima'
  | 'programada'
  | 'completada'
  | 'cancelada';

/** Ventana estándar en días para considerar una alerta pendiente como "próxima". */
export const ALERT_UPCOMING_WINDOW_DAYS = 7;

/**
 * DTO real devuelto por `GET /api/recordatorios` y `POST /api/recordatorios`
 * (`BackEnd/Models/Recordatorio.cs`).
 */
export interface BackendRecordatorioDto {
  idRecordatorio: string;
  idRancho: string;
  idAnimal?: string | null;
  idLote?: string | null;
  idTratamiento?: string | null;
  idResponsable?: string | null;
  tipo: string;
  descripcion: string;
  fechaProgramada: string;
  estado: string;
  fechaCompletado?: string | null;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro?: number;
  eliminadoEn?: string | null;
}

/**
 * Payload real aceptado por `POST /api/recordatorios`, `PUT /api/recordatorios/{id}`
 * y `POST /api/sync/operaciones` (entidad `Recordatorio`).
 */
export interface BackendRecordatorioPayload {
  idRecordatorio: string;
  idRancho: string;
  idAnimal: string | null;
  idLote: string | null;
  idTratamiento: string | null;
  idResponsable: string | null;
  tipo: string;
  descripcion: string;
  fechaProgramada: string;
  estado: string;
  fechaCompletado: string | null;
}

/**
 * Entidad de dominio Frontend alineada al contrato real `Recordatorio`.
 */
export interface AlertRecord {
  id: string;
  idRecordatorio: string;
  remoteId?: string | number;
  idRancho: string;
  idAnimal: string | null;
  idLote: string | null;
  idTratamiento: string | null;
  idResponsable: string | null;
  tipo: string;
  descripcion: string;
  fechaProgramada: string;
  estado: AlertEstado;
  fechaCompletado: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface AlertInput {
  idRancho: string;
  idAnimal: string | null;
  idLote: string | null;
  idTratamiento: string | null;
  idResponsable: string | null;
  tipo: string;
  descripcion: string;
  fechaProgramada: string;
  estado: AlertEstado;
  fechaCompletado: string | null;
}
