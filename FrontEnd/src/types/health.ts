import type { SyncStatus } from '../lib/database/schema';

export const HEALTH_EVENT_SUGGESTED_TYPES = [
  'Vacunación',
  'Desparasitación',
  'Enfermedad',
  'Lesión',
  'Revisión Veterinaria',
  'Cirugía',
  'Otro'
] as const;

export type TreatmentEstado = 'Pendiente' | 'En curso' | 'Completado' | 'Suspendido';

export const TREATMENT_ESTADOS: readonly TreatmentEstado[] = [
  'Pendiente',
  'En curso',
  'Completado',
  'Suspendido'
] as const;

export const TREATMENT_VIAS_SUGGESTED = [
  'Intramuscular',
  'Subcutánea',
  'Intravenosa',
  'Oral',
  'Tópica',
  'Intramamaria'
] as const;

export const TREATMENT_UNITS_SUGGESTED = ['mL', 'mg', 'cc', 'g', 'dosis', 'UI'] as const;

/**
 * DTO exacto de `BackEnd/Models/EventoSanitario.cs` (`GET /api/eventos-sanitarios`).
 */
export interface BackendEventoSanitarioDto {
  idEventoSanitario: string;
  idAnimal: string;
  tipo: string;
  fecha: string;
  sintomas: string | null;
  diagnostico: string | null;
  profesionalDiagnostico: string | null;
  evidenciaDiagnosticoUri: string | null;
  responsable: string;
  observaciones: string | null;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro?: number;
  eliminadoEn?: string | null;
}

/**
 * Payload exacto para `POST/PUT /api/eventos-sanitarios` y `POST /api/sync/operaciones`.
 */
export interface BackendEventoSanitarioPayload {
  idEventoSanitario?: string;
  idAnimal: string;
  tipo: string;
  fecha: string;
  sintomas: string | null;
  diagnostico: string | null;
  profesionalDiagnostico: string | null;
  evidenciaDiagnosticoUri: string | null;
  responsable: string;
  observaciones: string | null;
}

/**
 * DTO exacto de `BackEnd/Models/Tratamiento.cs` (`GET /api/tratamientos`).
 */
export interface BackendTratamientoDto {
  idTratamiento: string;
  idEventoSanitario: string;
  producto: string;
  dosis: number;
  unidadDosis: string;
  viaAdministracion: string | null;
  frecuencia: string;
  fechaInicio: string;
  fechaFin: string | null;
  responsable: string;
  prescripcionUri: string | null;
  estado: string;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro?: number;
  eliminadoEn?: string | null;
}

/**
 * Payload exacto para `POST/PUT /api/tratamientos` y `POST /api/sync/operaciones`.
 */
export interface BackendTratamientoPayload {
  idTratamiento?: string;
  idEventoSanitario: string;
  producto: string;
  dosis: number;
  unidadDosis: string;
  viaAdministracion: string | null;
  frecuencia: string;
  fechaInicio: string;
  fechaFin: string | null;
  responsable: string;
  prescripcionUri: string | null;
  estado: TreatmentEstado;
}

export interface HealthEvent {
  id: string;
  idEventoSanitario: string;
  remoteId?: string | number | null;
  idRancho: string;
  idAnimal: string;
  tipo: string;
  fecha: string;
  sintomas: string | null;
  diagnostico: string | null;
  profesionalDiagnostico: string | null;
  evidenciaDiagnosticoUri: string | null;
  responsable: string;
  observaciones: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface HealthEventInput {
  idAnimal: string;
  tipo: string;
  fecha: string;
  sintomas: string | null;
  diagnostico: string | null;
  profesionalDiagnostico: string | null;
  evidenciaDiagnosticoUri: string | null;
  responsable: string;
  observaciones: string | null;
}

export interface Treatment {
  id: string;
  idTratamiento: string;
  remoteId?: string | number | null;
  idRancho: string;
  idEventoSanitario: string;
  idAnimal: string;
  producto: string;
  dosis: number;
  unidadDosis: string;
  viaAdministracion: string | null;
  frecuencia: string;
  fechaInicio: string;
  fechaFin: string | null;
  responsable: string;
  prescripcionUri: string | null;
  estado: TreatmentEstado;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface TreatmentInput {
  idEventoSanitario: string;
  producto: string;
  dosis: number | string;
  unidadDosis: string;
  viaAdministracion: string | null;
  frecuencia: string;
  fechaInicio: string;
  fechaFin: string | null;
  responsable: string;
  prescripcionUri: string | null;
  estado: TreatmentEstado;
}
