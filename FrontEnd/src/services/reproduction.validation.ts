import type { Cattle } from '../types/cattle';
import type {
  ReproductionEventInput,
  ReproductionStage
} from '../types/reproduction';
import { isValidGuid } from './cattle.validation';

export type ReproductionValidationField =
  | 'idAnimal'
  | 'idSemental'
  | 'tipo'
  | 'fecha'
  | 'resultado'
  | 'observaciones';

export type ReproductionValidationErrors = Partial<
  Record<ReproductionValidationField, string>
>;

export const REPRODUCTION_FIELD_LIMITS = {
  tipoMax: 60,
  resultadoMax: 120,
  observacionesMax: 1000
} as const;

/**
 * Eventos reproductivos que biológicamente aplican de forma exclusiva a hembras.
 */
const FEMALE_ONLY_EVENT_PATTERNS = [
  /\bcelo\b/i,
  /\binseminaci[oó]n\b/i,
  /\bpalpaci[oó]n\b/i,
  /\bgestaci[oó]n\b/i,
  /\bpre[ñn]ez\b/i,
  /\bsecado\b/i,
  /\bparto\b/i,
  /\baborto\b/i,
  /\bp[eé]rdida\s+gestacional\b/i
];

function normalizeOptionalText(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeReproductionInput(
  input: ReproductionEventInput
): ReproductionEventInput {
  const normalizedSemental = normalizeOptionalText(input.idSemental);
  return {
    idAnimal: input.idAnimal.trim(),
    ...(input.idSemental !== undefined ? { idSemental: normalizedSemental } : {}),
    tipo: input.tipo.trim(),
    fecha: input.fecha.trim(),
    resultado: normalizeOptionalText(input.resultado),
    observaciones: normalizeOptionalText(input.observaciones)
  };
}

export function isFemaleOnlyReproductionEvent(tipo: string): boolean {
  const normalized = tipo.trim();
  if (!normalized) return false;
  return FEMALE_ONLY_EVENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMaleAnimal(sexo: string | undefined | null): boolean {
  if (!sexo) return false;
  const lowered = sexo.trim().toLowerCase();
  return lowered === 'macho' || lowered === 'masculino' || lowered === 'm' || lowered === 'male';
}

export function isFemaleAnimal(sexo: string | undefined | null): boolean {
  if (!sexo) return false;
  const lowered = sexo.trim().toLowerCase();
  return (
    lowered === 'hembra' ||
    lowered === 'femenino' ||
    lowered === 'h' ||
    lowered === 'f' ||
    lowered === 'female'
  );
}

export function isCalvingEvent(tipo: string): boolean {
  const normalized = tipo.trim().toLowerCase();
  return normalized === 'parto' || normalized.startsWith('parto ');
}

export interface ValidateReproductionContext {
  animals?: Cattle[];
  existingEvents?: Array<{
    id: string;
    idEventoReproductivo?: string;
    idAnimal: string;
    tipo: string;
    fecha: string;
    deletedAt?: string | null;
  }>;
  excludeEventId?: string;
  now?: Date;
}

export function validateReproductionInput(
  rawInput: ReproductionEventInput,
  context: ValidateReproductionContext = {}
): ReproductionValidationErrors {
  const errors: ReproductionValidationErrors = {};
  const idAnimal = rawInput.idAnimal.trim();
  const idSemental = normalizeOptionalText(rawInput.idSemental);
  const tipo = rawInput.tipo.trim();
  const fechaStr = rawInput.fecha.trim();
  const resultado = normalizeOptionalText(rawInput.resultado);
  const observaciones = normalizeOptionalText(rawInput.observaciones);

  let selectedAnimal: Cattle | undefined;
  let selectedSemental: Cattle | undefined;

  if (!idAnimal) {
    errors.idAnimal = 'Debes seleccionar el animal del evento reproductivo.';
  } else if (!isValidGuid(idAnimal)) {
    errors.idAnimal = 'El identificador del animal debe ser un UUID válido.';
  } else if (context.animals) {
    selectedAnimal = context.animals.find((a) => a.id === idAnimal && !a.deletedAt);
    if (!selectedAnimal) {
      errors.idAnimal = 'El animal seleccionado no existe o está desactivado.';
    }
  }

  if (idSemental) {
    if (!isValidGuid(idSemental)) {
      errors.idSemental = 'El identificador del semental debe ser un UUID válido.';
    } else if (idSemental === idAnimal) {
      errors.idSemental = 'Un animal no puede asociarse como su propio semental.';
    } else if (selectedAnimal && isMaleAnimal(selectedAnimal.sexo)) {
      errors.idSemental =
        'Cuando se asocia un semental, el animal principal del evento debe ser hembra.';
    } else if (context.animals) {
      selectedSemental = context.animals.find((a) => a.id === idSemental && !a.deletedAt);
      if (!selectedSemental) {
        errors.idSemental = 'El semental seleccionado no existe o está desactivado.';
      } else if (selectedAnimal && selectedSemental.idRancho !== selectedAnimal.idRancho) {
        errors.idSemental = 'El semental debe pertenecer al mismo rancho del animal.';
      } else if (isFemaleAnimal(selectedSemental.sexo)) {
        errors.idSemental = 'El semental seleccionado debe ser de sexo Macho.';
      }
    }
  }

  if (!tipo) {
    errors.tipo = 'El tipo de evento reproductivo es obligatorio.';
  } else if (tipo.length > REPRODUCTION_FIELD_LIMITS.tipoMax) {
    errors.tipo = `El tipo de evento no puede exceder ${REPRODUCTION_FIELD_LIMITS.tipoMax} caracteres.`;
  }

  if (
    !errors.idAnimal &&
    selectedAnimal &&
    tipo &&
    isMaleAnimal(selectedAnimal.sexo) &&
    isFemaleOnlyReproductionEvent(tipo)
  ) {
    errors.idAnimal = `El evento "${tipo}" solo aplica a hembras; el animal seleccionado (${selectedAnimal.arete}) es Macho.`;
  }

  const parsedFecha = fechaStr ? new Date(fechaStr) : null;
  if (!fechaStr) {
    errors.fecha = 'La fecha y hora del evento reproductivo son obligatorias.';
  } else if (!parsedFecha || Number.isNaN(parsedFecha.getTime())) {
    errors.fecha = 'La fecha ingresada no tiene un formato válido.';
  } else {
    const now = context.now ?? new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    if (parsedFecha.getTime() > endOfToday.getTime()) {
      errors.fecha = 'La fecha del evento reproductivo no puede estar en el futuro.';
    } else if (selectedAnimal?.fechaNacimiento) {
      const birthDate = new Date(`${selectedAnimal.fechaNacimiento.slice(0, 10)}T00:00:00`);
      if (!Number.isNaN(birthDate.getTime()) && parsedFecha.getTime() < birthDate.getTime()) {
        errors.fecha = 'La fecha del evento no puede ser anterior al nacimiento del animal.';
      }
    }

    if (!errors.fecha && selectedAnimal?.fechaSalida) {
      const exitDate = new Date(`${selectedAnimal.fechaSalida.slice(0, 10)}T23:59:59`);
      if (!Number.isNaN(exitDate.getTime()) && parsedFecha.getTime() > exitDate.getTime()) {
        errors.fecha = 'La fecha del evento no puede ser posterior a la fecha de salida del animal.';
      }
    }

    if (!errors.fecha && selectedSemental?.fechaNacimiento) {
      const sireBirth = new Date(`${selectedSemental.fechaNacimiento.slice(0, 10)}T00:00:00`);
      if (!Number.isNaN(sireBirth.getTime()) && parsedFecha.getTime() < sireBirth.getTime()) {
        errors.fecha = 'La fecha del evento no puede ser anterior al nacimiento del semental.';
      }
    }

    // Coherencia fisiológica entre partos de una misma hembra (mínimo 240 días)
    if (!errors.fecha && idAnimal && isCalvingEvent(tipo) && context.existingEvents) {
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      for (const prev of context.existingEvents) {
        if (prev.deletedAt) continue;
        if (prev.idAnimal !== idAnimal) continue;
        if (
          context.excludeEventId &&
          (prev.id === context.excludeEventId ||
            prev.idEventoReproductivo === context.excludeEventId)
        ) {
          continue;
        }
        if (!isCalvingEvent(prev.tipo)) continue;

        const prevDate = new Date(prev.fecha);
        if (Number.isNaN(prevDate.getTime())) continue;

        const daysDiff = Math.abs(parsedFecha.getTime() - prevDate.getTime()) / MS_PER_DAY;
        if (daysDiff < 240) {
          errors.fecha =
            'Incoherencia cronológica: ya existe otro parto registrado para esta hembra a menos de 240 días de diferencia.';
          break;
        }
      }
    }
  }

  if (resultado && resultado.length > REPRODUCTION_FIELD_LIMITS.resultadoMax) {
    errors.resultado = `El resultado no puede exceder ${REPRODUCTION_FIELD_LIMITS.resultadoMax} caracteres.`;
  }

  if (observaciones && observaciones.length > REPRODUCTION_FIELD_LIMITS.observacionesMax) {
    errors.observaciones = `Las observaciones no pueden exceder ${REPRODUCTION_FIELD_LIMITS.observacionesMax} caracteres.`;
  }

  return errors;
}

/**
 * Clasifica un evento reproductivo real en una de las 3 etapas operativas
 * de la vista de tablero.
 */
export function classifyReproductionStage(
  tipo: string,
  resultado?: string | null
): ReproductionStage {
  const combined = `${tipo} ${resultado ?? ''}`.toLowerCase();

  if (
    /\bparto\b/.test(combined) ||
    /\bnacimiento\b/.test(combined) ||
    /\baborto\b/.test(combined) ||
    /\bp[eé]rdida\s+gestacional\b/.test(combined) ||
    /\bdestete\b/.test(combined) ||
    /\bcr[ií]a\b/.test(combined)
  ) {
    return 'partos';
  }

  if (
    /\bgestaci[oó]n\b/.test(combined) ||
    /\bgestante\b/.test(combined) ||
    /\bpre[ñn]ez\b/.test(combined) ||
    /\bpalpaci[oó]n\b/.test(combined) ||
    /\bdiagn[oó]stico\b/.test(combined) ||
    /\bsecado\b/.test(combined)
  ) {
    return 'gestaciones';
  }

  return 'servicios';
}
