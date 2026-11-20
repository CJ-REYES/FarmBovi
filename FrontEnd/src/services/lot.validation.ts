import type { RanchOption } from '../types/cattle';
import type { LotEstado, LotInput } from '../types/lot';
import { isValidGuid } from './cattle.validation';

export type LotValidationField = 'idRancho' | 'nombre' | 'ubicacion' | 'estado';

export type LotValidationErrors = Partial<Record<LotValidationField, string>>;

export const LOT_FIELD_LIMITS = {
  nombreMax: 120,
  ubicacionMax: 250,
  estadoMax: 20
} as const;

export function normalizeLotEstado(raw: string | null | undefined): LotEstado {
  if (raw && raw.trim().toLowerCase() === 'inactivo') {
    return 'Inactivo';
  }
  return 'Activo';
}

export function normalizeLotInput(input: LotInput): LotInput {
  return {
    idRancho: input.idRancho.trim(),
    nombre: input.nombre.trim(),
    ubicacion: input.ubicacion?.trim() || null,
    estado: normalizeLotEstado(input.estado)
  };
}

export interface ValidateLotContext {
  ranches?: RanchOption[];
  duplicateNameExists?: boolean;
}

export function validateLotInput(
  input: LotInput,
  context: ValidateLotContext = {}
): LotValidationErrors {
  const errors: LotValidationErrors = {};
  const idRancho = input.idRancho.trim();
  const nombre = input.nombre.trim();
  const ubicacion = input.ubicacion?.trim() || '';
  const estado = input.estado.trim();

  if (!idRancho) {
    errors.idRancho = 'Debes seleccionar o indicar el rancho al que pertenece el potrero.';
  } else if (!isValidGuid(idRancho)) {
    errors.idRancho = 'El identificador del rancho debe ser un UUID válido.';
  } else if (context.ranches && context.ranches.length > 0) {
    const exists = context.ranches.some((r) => r.id === idRancho);
    if (!exists) {
      errors.idRancho = 'El rancho seleccionado no pertenece a tus ranchos activos.';
    }
  }

  if (!nombre) {
    errors.nombre = 'El nombre del potrero / lote es obligatorio.';
  } else if (nombre.length > LOT_FIELD_LIMITS.nombreMax) {
    errors.nombre = `El nombre no puede exceder ${LOT_FIELD_LIMITS.nombreMax} caracteres.`;
  } else if (context.duplicateNameExists) {
    errors.nombre = 'Ya existe un potrero / lote activo con ese nombre en este rancho.';
  }

  if (ubicacion.length > LOT_FIELD_LIMITS.ubicacionMax) {
    errors.ubicacion = `La ubicación no puede exceder ${LOT_FIELD_LIMITS.ubicacionMax} caracteres.`;
  }

  if (!estado || (estado !== 'Activo' && estado !== 'Inactivo')) {
    errors.estado = 'Selecciona un estado válido (Activo o Inactivo).';
  }

  return errors;
}
