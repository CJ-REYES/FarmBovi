import type { Cattle, LotOption } from '../types/cattle';
import type { FeedingInput } from '../types/feeding';
import { isValidGuid } from './cattle.validation';

export type FeedingValidationField =
  | 'target'
  | 'idAnimal'
  | 'idLote'
  | 'alimento'
  | 'racion'
  | 'cantidad'
  | 'unidad'
  | 'frecuencia'
  | 'inicio'
  | 'fin'
  | 'cambioDieta';

export type FeedingValidationErrors = Partial<Record<FeedingValidationField, string>>;

export const FEEDING_FIELD_LIMITS = {
  alimentoMax: 150,
  racionMax: 150,
  unidadMax: 20,
  frecuenciaMax: 80,
  cambioDietaMax: 500,
  /** Precisión SQL `decimal(10,3)`: máximo 9,999,999.999 */
  cantidadMax: 9999999.999
} as const;

export interface NormalizedFeedingInput {
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

function normalizeOptionalGuid(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export function parseCantidad(raw: number | string): number {
  if (typeof raw === 'number') return raw;
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

export function normalizeFeedingInput(input: FeedingInput): NormalizedFeedingInput {
  const parsedCantidad = parseCantidad(input.cantidad);
  const roundedCantidad = Number.isFinite(parsedCantidad)
    ? Math.round(parsedCantidad * 1000) / 1000
    : Number.NaN;

  return {
    idAnimal: normalizeOptionalGuid(input.idAnimal),
    idLote: normalizeOptionalGuid(input.idLote),
    alimento: input.alimento.trim(),
    racion: input.racion.trim(),
    cantidad: roundedCantidad,
    unidad: input.unidad.trim(),
    frecuencia: input.frecuencia.trim(),
    inicio: input.inicio.trim(),
    fin: normalizeOptionalText(input.fin),
    cambioDieta: normalizeOptionalText(input.cambioDieta)
  };
}

export interface ValidateFeedingContext {
  animals?: Cattle[];
  lots?: LotOption[];
}

function parseDateValue(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function validateFeedingInput(
  rawInput: FeedingInput,
  context: ValidateFeedingContext = {}
): FeedingValidationErrors {
  const errors: FeedingValidationErrors = {};
  const idAnimal = normalizeOptionalGuid(rawInput.idAnimal);
  const idLote = normalizeOptionalGuid(rawInput.idLote);
  const alimento = rawInput.alimento.trim();
  const racion = rawInput.racion.trim();
  const cantidad = parseCantidad(rawInput.cantidad);
  const unidad = rawInput.unidad.trim();
  const frecuencia = rawInput.frecuencia.trim();
  const inicio = rawInput.inicio.trim();
  const fin = normalizeOptionalText(rawInput.fin);
  const cambioDieta = normalizeOptionalText(rawInput.cambioDieta);

  // Regla 05 del Backend: XOR(idAnimal, idLote)
  const hasAnimal = Boolean(idAnimal);
  const hasLot = Boolean(idLote);

  if (hasAnimal === hasLot) {
    errors.target = hasAnimal
      ? 'Selecciona únicamente un animal individual o un potrero/lote (son mutuamente excluyentes).'
      : 'Debes seleccionar un potrero/lote o un animal individual.';
  }

  if (idAnimal) {
    if (!isValidGuid(idAnimal)) {
      errors.idAnimal = 'El identificador del animal debe ser un UUID válido.';
    } else if (context.animals) {
      const exists = context.animals.some((a) => a.id === idAnimal && !a.deletedAt);
      if (!exists) {
        errors.idAnimal = 'El animal seleccionado no existe o está desactivado.';
      }
    }
  }

  if (idLote) {
    if (!isValidGuid(idLote)) {
      errors.idLote = 'El identificador del potrero / lote debe ser un UUID válido.';
    } else if (context.lots) {
      const exists = context.lots.some((l) => l.id === idLote);
      if (!exists) {
        errors.idLote = 'El potrero / lote seleccionado no existe o está desactivado.';
      }
    }
  }

  if (!alimento) {
    errors.alimento = 'El nombre del alimento es obligatorio.';
  } else if (alimento.length > FEEDING_FIELD_LIMITS.alimentoMax) {
    errors.alimento = `El alimento no puede exceder ${FEEDING_FIELD_LIMITS.alimentoMax} caracteres.`;
  }

  if (!racion) {
    errors.racion = 'La descripción de la ración es obligatoria.';
  } else if (racion.length > FEEDING_FIELD_LIMITS.racionMax) {
    errors.racion = `La ración no puede exceder ${FEEDING_FIELD_LIMITS.racionMax} caracteres.`;
  }

  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    errors.cantidad = 'La cantidad debe ser un número mayor que cero.';
  } else if (cantidad > FEEDING_FIELD_LIMITS.cantidadMax) {
    errors.cantidad = `La cantidad no puede exceder ${FEEDING_FIELD_LIMITS.cantidadMax}.`;
  }

  if (!unidad) {
    errors.unidad = 'La unidad de medida es obligatoria (ej. kg, g, L, pacas).';
  } else if (unidad.length > FEEDING_FIELD_LIMITS.unidadMax) {
    errors.unidad = `La unidad no puede exceder ${FEEDING_FIELD_LIMITS.unidadMax} caracteres.`;
  }

  if (!frecuencia) {
    errors.frecuencia = 'La frecuencia de suministro es obligatoria.';
  } else if (frecuencia.length > FEEDING_FIELD_LIMITS.frecuenciaMax) {
    errors.frecuencia = `La frecuencia no puede exceder ${FEEDING_FIELD_LIMITS.frecuenciaMax} caracteres.`;
  }

  const parsedInicio = parseDateValue(inicio);
  if (!inicio) {
    errors.inicio = 'La fecha de inicio es obligatoria.';
  } else if (!parsedInicio) {
    errors.inicio = 'La fecha de inicio no tiene un formato válido.';
  }

  if (fin) {
    const parsedFin = parseDateValue(fin);
    if (!parsedFin) {
      errors.fin = 'La fecha de fin no tiene un formato válido.';
    } else if (parsedInicio && parsedFin.getTime() < parsedInicio.getTime()) {
      errors.fin = 'La fecha de fin no puede ser anterior a la fecha de inicio.';
    }
  }

  if (cambioDieta && cambioDieta.length > FEEDING_FIELD_LIMITS.cambioDietaMax) {
    errors.cambioDieta = `Las observaciones no pueden exceder ${FEEDING_FIELD_LIMITS.cambioDietaMax} caracteres.`;
  }

  return errors;
}
