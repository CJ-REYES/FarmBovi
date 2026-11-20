import type { Cattle } from '../types/cattle';
import {
  TREATMENT_ESTADOS,
  type HealthEvent,
  type HealthEventInput,
  type TreatmentEstado,
  type TreatmentInput
} from '../types/health';
import { isValidGuid } from './cattle.validation';

export type HealthEventValidationField =
  | 'idAnimal'
  | 'tipo'
  | 'fecha'
  | 'sintomas'
  | 'diagnostico'
  | 'profesionalDiagnostico'
  | 'evidenciaDiagnosticoUri'
  | 'responsable'
  | 'observaciones';

export type HealthEventValidationErrors = Partial<Record<HealthEventValidationField, string>>;

export type TreatmentValidationField =
  | 'idEventoSanitario'
  | 'producto'
  | 'dosis'
  | 'unidadDosis'
  | 'viaAdministracion'
  | 'frecuencia'
  | 'fechaInicio'
  | 'fechaFin'
  | 'responsable'
  | 'prescripcionUri'
  | 'estado';

export type TreatmentValidationErrors = Partial<Record<TreatmentValidationField, string>>;

export const HEALTH_EVENT_LIMITS = {
  tipoMax: 35,
  profesionalMax: 180,
  evidenciaUriMax: 500,
  responsableMax: 180,
  textMax: 1000
} as const;

export const TREATMENT_LIMITS = {
  productoMax: 150,
  dosisMax: 9999999.999,
  unidadDosisMax: 20,
  viaMax: 60,
  frecuenciaMax: 80,
  responsableMax: 180,
  prescripcionUriMax: 500,
  estadoMax: 25
} as const;

function normalizeOptText(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeTreatmentEstado(raw: string | null | undefined): TreatmentEstado {
  if (!raw) return 'Pendiente';
  const lowered = raw.trim().toLowerCase();
  if (lowered === 'en curso' || lowered === 'encurso' || lowered === 'activo') return 'En curso';
  if (lowered === 'completado' || lowered === 'finalizado') return 'Completado';
  if (lowered === 'suspendido' || lowered === 'cancelado') return 'Suspendido';
  return 'Pendiente';
}

export function isTreatmentPending(estado: string): boolean {
  const norm = normalizeTreatmentEstado(estado);
  return norm === 'Pendiente' || norm === 'En curso';
}

export function parseDosis(raw: number | string): number {
  if (typeof raw === 'number') return raw;
  const cleaned = raw.trim().replace(',', '.');
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

export function normalizeHealthEventInput(input: HealthEventInput): HealthEventInput {
  return {
    idAnimal: input.idAnimal.trim(),
    tipo: input.tipo.trim(),
    fecha: input.fecha.trim(),
    sintomas: normalizeOptText(input.sintomas),
    diagnostico: normalizeOptText(input.diagnostico),
    profesionalDiagnostico: normalizeOptText(input.profesionalDiagnostico),
    evidenciaDiagnosticoUri: normalizeOptText(input.evidenciaDiagnosticoUri),
    responsable: input.responsable.trim(),
    observaciones: normalizeOptText(input.observaciones)
  };
}

export interface NormalizedTreatmentInput {
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

export function normalizeTreatmentInput(input: TreatmentInput): NormalizedTreatmentInput {
  const parsed = parseDosis(input.dosis);
  const rounded = Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : Number.NaN;

  return {
    idEventoSanitario: input.idEventoSanitario.trim(),
    producto: input.producto.trim(),
    dosis: rounded,
    unidadDosis: input.unidadDosis.trim(),
    viaAdministracion: normalizeOptText(input.viaAdministracion),
    frecuencia: input.frecuencia.trim(),
    fechaInicio: input.fechaInicio.trim(),
    fechaFin: normalizeOptText(input.fechaFin),
    responsable: input.responsable.trim(),
    prescripcionUri: normalizeOptText(input.prescripcionUri),
    estado: normalizeTreatmentEstado(input.estado)
  };
}

export function validateHealthEventInput(
  rawInput: HealthEventInput,
  context: { animals?: Cattle[]; now?: Date } = {}
): HealthEventValidationErrors {
  const errors: HealthEventValidationErrors = {};
  const idAnimal = rawInput.idAnimal.trim();
  const tipo = rawInput.tipo.trim();
  const fechaStr = rawInput.fecha.trim();
  const responsable = rawInput.responsable.trim();
  const sintomas = normalizeOptText(rawInput.sintomas);
  const diagnostico = normalizeOptText(rawInput.diagnostico);
  const profesional = normalizeOptText(rawInput.profesionalDiagnostico);
  const evidencia = normalizeOptText(rawInput.evidenciaDiagnosticoUri);
  const observaciones = normalizeOptText(rawInput.observaciones);

  let selectedAnimal: Cattle | undefined;
  if (!idAnimal) {
    errors.idAnimal = 'Debes seleccionar el animal del evento sanitario.';
  } else if (!isValidGuid(idAnimal)) {
    errors.idAnimal = 'El identificador del animal debe ser un UUID válido.';
  } else if (context.animals) {
    selectedAnimal = context.animals.find((a) => a.id === idAnimal && !a.deletedAt);
    if (!selectedAnimal) {
      errors.idAnimal = 'El animal seleccionado no existe o está desactivado.';
    }
  }

  if (!tipo) {
    errors.tipo = 'El tipo de evento sanitario es obligatorio.';
  } else if (tipo.length > HEALTH_EVENT_LIMITS.tipoMax) {
    errors.tipo = `El tipo no puede exceder ${HEALTH_EVENT_LIMITS.tipoMax} caracteres.`;
  }

  const parsedFecha = fechaStr ? new Date(fechaStr) : null;
  if (!fechaStr) {
    errors.fecha = 'La fecha del evento sanitario es obligatoria.';
  } else if (!parsedFecha || Number.isNaN(parsedFecha.getTime())) {
    errors.fecha = 'La fecha ingresada no tiene un formato válido.';
  } else {
    const now = context.now ?? new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (parsedFecha.getTime() > endOfToday.getTime()) {
      errors.fecha = 'La fecha del evento sanitario no puede estar en el futuro.';
    } else if (selectedAnimal?.fechaNacimiento) {
      const birthDate = new Date(`${selectedAnimal.fechaNacimiento.slice(0, 10)}T00:00:00`);
      if (!Number.isNaN(birthDate.getTime()) && parsedFecha.getTime() < birthDate.getTime()) {
        errors.fecha = 'La fecha del evento no puede ser anterior al nacimiento del animal.';
      }
    }
  }

  if (!responsable) {
    errors.responsable = 'El responsable del evento sanitario es obligatorio.';
  } else if (responsable.length > HEALTH_EVENT_LIMITS.responsableMax) {
    errors.responsable = `El responsable no puede exceder ${HEALTH_EVENT_LIMITS.responsableMax} caracteres.`;
  }

  if (profesional && profesional.length > HEALTH_EVENT_LIMITS.profesionalMax) {
    errors.profesionalDiagnostico = `El nombre del profesional no puede exceder ${HEALTH_EVENT_LIMITS.profesionalMax} caracteres.`;
  }

  if (evidencia && evidencia.length > HEALTH_EVENT_LIMITS.evidenciaUriMax) {
    errors.evidenciaDiagnosticoUri = `La URI de evidencia no puede exceder ${HEALTH_EVENT_LIMITS.evidenciaUriMax} caracteres.`;
  }

  if (sintomas && sintomas.length > HEALTH_EVENT_LIMITS.textMax) {
    errors.sintomas = `Los síntomas no pueden exceder ${HEALTH_EVENT_LIMITS.textMax} caracteres.`;
  }

  if (diagnostico && diagnostico.length > HEALTH_EVENT_LIMITS.textMax) {
    errors.diagnostico = `El diagnóstico no puede exceder ${HEALTH_EVENT_LIMITS.textMax} caracteres.`;
  }

  if (observaciones && observaciones.length > HEALTH_EVENT_LIMITS.textMax) {
    errors.observaciones = `Las observaciones no pueden exceder ${HEALTH_EVENT_LIMITS.textMax} caracteres.`;
  }

  return errors;
}

export function validateTreatmentInput(
  rawInput: TreatmentInput,
  context: { events?: HealthEvent[] } = {}
): TreatmentValidationErrors {
  const errors: TreatmentValidationErrors = {};
  const idEvento = rawInput.idEventoSanitario.trim();
  const producto = rawInput.producto.trim();
  const dosis = parseDosis(rawInput.dosis);
  const unidadDosis = rawInput.unidadDosis.trim();
  const via = normalizeOptText(rawInput.viaAdministracion);
  const frecuencia = rawInput.frecuencia.trim();
  const fechaInicioStr = rawInput.fechaInicio.trim();
  const fechaFinStr = normalizeOptText(rawInput.fechaFin);
  const responsable = rawInput.responsable.trim();
  const prescripcion = normalizeOptText(rawInput.prescripcionUri);
  const estado = rawInput.estado;

  if (!idEvento) {
    errors.idEventoSanitario = 'Debes seleccionar el evento sanitario asociado.';
  } else if (!isValidGuid(idEvento)) {
    errors.idEventoSanitario = 'El identificador del evento sanitario debe ser un UUID válido.';
  } else if (context.events) {
    const exists = context.events.some((e) => e.id === idEvento && !e.deletedAt);
    if (!exists) {
      errors.idEventoSanitario = 'El evento sanitario seleccionado no existe o está desactivado.';
    }
  }

  if (!producto) {
    errors.producto = 'El nombre del producto o medicamento es obligatorio.';
  } else if (producto.length > TREATMENT_LIMITS.productoMax) {
    errors.producto = `El producto no puede exceder ${TREATMENT_LIMITS.productoMax} caracteres.`;
  }

  if (!Number.isFinite(dosis) || dosis <= 0) {
    errors.dosis = 'La dosis del tratamiento debe ser un número mayor que cero.';
  } else if (dosis > TREATMENT_LIMITS.dosisMax) {
    errors.dosis = `La dosis no puede exceder ${TREATMENT_LIMITS.dosisMax}.`;
  }

  if (!unidadDosis) {
    errors.unidadDosis = 'La unidad de dosis es obligatoria (ej. mL, mg, dosis).';
  } else if (unidadDosis.length > TREATMENT_LIMITS.unidadDosisMax) {
    errors.unidadDosis = `La unidad no puede exceder ${TREATMENT_LIMITS.unidadDosisMax} caracteres.`;
  }

  if (via && via.length > TREATMENT_LIMITS.viaMax) {
    errors.viaAdministracion = `La vía de administración no puede exceder ${TREATMENT_LIMITS.viaMax} caracteres.`;
  }

  if (!frecuencia) {
    errors.frecuencia = 'La frecuencia de aplicación es obligatoria.';
  } else if (frecuencia.length > TREATMENT_LIMITS.frecuenciaMax) {
    errors.frecuencia = `La frecuencia no puede exceder ${TREATMENT_LIMITS.frecuenciaMax} caracteres.`;
  }

  const parsedInicio = fechaInicioStr ? new Date(fechaInicioStr) : null;
  if (!fechaInicioStr) {
    errors.fechaInicio = 'La fecha de inicio del tratamiento es obligatoria.';
  } else if (!parsedInicio || Number.isNaN(parsedInicio.getTime())) {
    errors.fechaInicio = 'La fecha de inicio no tiene un formato válido.';
  }

  if (fechaFinStr) {
    const parsedFin = new Date(fechaFinStr);
    if (Number.isNaN(parsedFin.getTime())) {
      errors.fechaFin = 'La fecha de fin no tiene un formato válido.';
    } else if (parsedInicio && parsedFin.getTime() < parsedInicio.getTime()) {
      errors.fechaFin = 'La fecha de fin no puede ser anterior a la fecha de inicio.';
    }
  }

  if (!responsable) {
    errors.responsable = 'El responsable de aplicar el tratamiento es obligatorio.';
  } else if (responsable.length > TREATMENT_LIMITS.responsableMax) {
    errors.responsable = `El responsable no puede exceder ${TREATMENT_LIMITS.responsableMax} caracteres.`;
  }

  if (prescripcion && prescripcion.length > TREATMENT_LIMITS.prescripcionUriMax) {
    errors.prescripcionUri = `La URI de prescripción no puede exceder ${TREATMENT_LIMITS.prescripcionUriMax} caracteres.`;
  }

  if (!estado || !(TREATMENT_ESTADOS as readonly string[]).includes(estado)) {
    errors.estado = 'Selecciona un estado válido para el tratamiento.';
  }

  return errors;
}
