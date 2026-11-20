import type { AnimalEstado, CattleInput, CattleSex, LotOption, RanchOption } from '../types/cattle';

export type CattleValidationField =
  | 'idRancho'
  | 'idLote'
  | 'arete'
  | 'raza'
  | 'sexo'
  | 'fechaNacimiento'
  | 'fechaIngreso'
  | 'procedencia'
  | 'estado'
  | 'fechaSalida'
  | 'observaciones';

export type CattleValidationErrors = Partial<Record<CattleValidationField, string>>;

const GUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const EXIT_STATES = new Set<string>(['Vendido', 'Venta', 'Baja']);

export const ANIMAL_FIELD_LIMITS = {
  areteMax: 50,
  razaMax: 80,
  sexoMax: 15,
  procedenciaMax: 250,
  estadoMax: 25,
  observacionesMax: 2000
} as const;

export function isValidGuid(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return (
    GUID_REGEX.test(trimmed) &&
    trimmed !== '00000000-0000-0000-0000-000000000000'
  );
}

export function isExitAnimalState(estado: string): boolean {
  return EXIT_STATES.has(estado.trim());
}

export function toDateInputValue(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (DATE_ONLY_REGEX.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export function getTodayDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeAnimalSex(raw: string | null | undefined): CattleSex {
  if (raw && raw.trim().toLowerCase() === 'macho') {
    return 'Macho';
  }
  return 'Hembra';
}

export function normalizeAnimalEstado(raw: string | null | undefined): AnimalEstado {
  const value = (raw || '').trim().toLowerCase();
  if (value === 'vendido' || value === 'venta') return 'Vendido';
  if (value === 'baja') return 'Baja';
  return 'Activo';
}

export function normalizeCattleInput(input: CattleInput): CattleInput {
  const estado = normalizeAnimalEstado(input.estado);
  const fechaNacimiento = toDateInputValue(input.fechaNacimiento) || null;
  const fechaIngreso = toDateInputValue(input.fechaIngreso) || getTodayDateString();
  const rawFechaSalida = toDateInputValue(input.fechaSalida) || null;
  const fechaSalida = isExitAnimalState(estado)
    ? (rawFechaSalida ?? getTodayDateString())
    : null;
  const observaciones = input.observaciones?.trim() || null;

  return {
    idRancho: input.idRancho.trim(),
    idLote: input.idLote && input.idLote.trim().length > 0 ? input.idLote.trim() : null,
    arete: input.arete.trim(),
    raza: input.raza.trim(),
    sexo: normalizeAnimalSex(input.sexo),
    fechaNacimiento,
    fechaIngreso,
    procedencia: input.procedencia.trim(),
    estado,
    fechaSalida,
    observaciones
  };
}

export interface ValidateCattleContext {
  ranches?: RanchOption[];
  lots?: LotOption[];
  duplicateAreteExists?: boolean;
  today?: string;
}

export function validateCattleInput(
  input: CattleInput,
  context: ValidateCattleContext = {}
): CattleValidationErrors {
  const errors: CattleValidationErrors = {};
  const today = context.today ?? getTodayDateString();

  const idRancho = input.idRancho.trim();
  const idLote = input.idLote?.trim() || null;
  const arete = input.arete.trim();
  const raza = input.raza.trim();
  const procedencia = input.procedencia.trim();
  const estado = input.estado.trim();
  const fechaNacimiento = toDateInputValue(input.fechaNacimiento);
  const fechaIngreso = toDateInputValue(input.fechaIngreso);
  const fechaSalida = toDateInputValue(input.fechaSalida);
  const observaciones = input.observaciones?.trim() || '';

  if (!idRancho) {
    errors.idRancho = 'Debes seleccionar o indicar el rancho al que pertenece el animal.';
  } else if (!isValidGuid(idRancho)) {
    errors.idRancho = 'El identificador del rancho debe ser un UUID válido.';
  } else if (context.ranches && context.ranches.length > 0) {
    const ranchExists = context.ranches.some((r) => r.id === idRancho);
    if (!ranchExists) {
      errors.idRancho = 'El rancho seleccionado no se encuentra disponible.';
    }
  }

  if (idLote) {
    if (!isValidGuid(idLote)) {
      errors.idLote = 'El identificador del potrero / lote no es un UUID válido.';
    } else if (context.lots && context.lots.length > 0) {
      const lot = context.lots.find((l) => l.id === idLote);
      if (!lot) {
        errors.idLote = 'El potrero / lote seleccionado no existe o fue desactivado.';
      } else if (idRancho && lot.idRancho !== idRancho) {
        errors.idLote = 'El potrero / lote debe pertenecer al mismo rancho del animal.';
      }
    }
  }

  if (!arete) {
    errors.arete = 'El arete / identificación del animal es obligatorio.';
  } else if (arete.length > ANIMAL_FIELD_LIMITS.areteMax) {
    errors.arete = `El arete no puede exceder ${ANIMAL_FIELD_LIMITS.areteMax} caracteres.`;
  } else if (context.duplicateAreteExists) {
    errors.arete = 'Ya existe un animal activo con este arete en el mismo rancho.';
  }

  if (!raza) {
    errors.raza = 'La raza del animal es obligatoria.';
  } else if (raza.length > ANIMAL_FIELD_LIMITS.razaMax) {
    errors.raza = `La raza no puede exceder ${ANIMAL_FIELD_LIMITS.razaMax} caracteres.`;
  }

  if (input.sexo !== 'Hembra' && input.sexo !== 'Macho') {
    errors.sexo = 'Selecciona un sexo válido (Hembra o Macho).';
  }

  if (input.fechaNacimiento && input.fechaNacimiento.trim().length > 0) {
    if (!fechaNacimiento) {
      errors.fechaNacimiento = 'La fecha de nacimiento no tiene un formato válido (AAAA-MM-DD).';
    } else if (fechaNacimiento > today) {
      errors.fechaNacimiento = 'La fecha de nacimiento no puede ser futura.';
    }
  }

  if (!input.fechaIngreso || !fechaIngreso) {
    errors.fechaIngreso = 'La fecha de ingreso es obligatoria.';
  } else if (fechaIngreso > today) {
    errors.fechaIngreso = 'La fecha de ingreso no puede ser futura.';
  } else if (fechaNacimiento && fechaIngreso < fechaNacimiento) {
    errors.fechaIngreso = 'La fecha de ingreso no puede ser anterior a la fecha de nacimiento.';
  }

  if (!procedencia) {
    errors.procedencia = 'La procedencia del animal es obligatoria.';
  } else if (procedencia.length > ANIMAL_FIELD_LIMITS.procedenciaMax) {
    errors.procedencia = `La procedencia no puede exceder ${ANIMAL_FIELD_LIMITS.procedenciaMax} caracteres.`;
  }

  if (!estado) {
    errors.estado = 'El estado del animal es obligatorio.';
  } else if (estado.length > ANIMAL_FIELD_LIMITS.estadoMax) {
    errors.estado = `El estado no puede exceder ${ANIMAL_FIELD_LIMITS.estadoMax} caracteres.`;
  }

  if (isExitAnimalState(estado)) {
    if (!input.fechaSalida || !fechaSalida) {
      errors.fechaSalida = 'Indica la fecha de salida para animales vendidos o dados de baja.';
    } else if (fechaSalida > today) {
      errors.fechaSalida = 'La fecha de salida no puede ser futura.';
    } else if (fechaIngreso && fechaSalida < fechaIngreso) {
      errors.fechaSalida = 'La fecha de salida no puede ser anterior a la fecha de ingreso.';
    }
  } else if (input.fechaSalida && input.fechaSalida.trim().length > 0 && !fechaSalida) {
    errors.fechaSalida = 'La fecha de salida no tiene un formato válido.';
  }

  if (observaciones.length > ANIMAL_FIELD_LIMITS.observacionesMax) {
    errors.observaciones = `Las observaciones no pueden exceder ${ANIMAL_FIELD_LIMITS.observacionesMax} caracteres.`;
  }

  return errors;
}

export function calculateAnimalAge(
  fechaNacimiento: string | null | undefined,
  referenceDate: Date = new Date()
): string {
  const normalized = toDateInputValue(fechaNacimiento);
  if (!normalized) return 'Sin fecha';

  const [yearStr, monthStr, dayStr] = normalized.split('-');
  const birthYear = Number(yearStr);
  const birthMonth = Number(monthStr);
  const birthDay = Number(dayStr);

  let years = referenceDate.getFullYear() - birthYear;
  let months = referenceDate.getMonth() + 1 - birthMonth;
  if (referenceDate.getDate() < birthDay) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) return 'Sin fecha';
  if (years === 0) {
    return months === 1 ? '1 mes' : `${months} meses`;
  }
  const yearLabel = years === 1 ? '1 año' : `${years} años`;
  if (months === 0) return yearLabel;
  const monthLabel = months === 1 ? '1 mes' : `${months} meses`;
  return `${yearLabel}, ${monthLabel}`;
}
