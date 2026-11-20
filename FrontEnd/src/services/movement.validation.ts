import type { Cattle, LotOption } from '../types/cattle';
import {
  MOVEMENT_TYPES,
  type MovementInput,
  type MovementType
} from '../types/movement';
import { isValidGuid } from './cattle.validation';

export type MovementValidationField =
  | 'idAnimal'
  | 'tipo'
  | 'fecha'
  | 'idLoteOrigen'
  | 'idLoteDestino'
  | 'origenExterno'
  | 'destinoExterno'
  | 'motivo';

export type MovementValidationErrors = Partial<Record<MovementValidationField, string>>;

export const MOVEMENT_FIELD_LIMITS = {
  tipoMax: 30,
  origenExternoMax: 250,
  destinoExternoMax: 250,
  motivoMax: 500
} as const;

export function normalizeMovementType(raw: string | null | undefined): MovementType {
  if (!raw) return 'CambioInterno';
  const compact = raw.trim().toLowerCase().replace(/\s+/g, '');
  switch (compact) {
    case 'alta':
      return 'Alta';
    case 'cambiointerno':
      return 'CambioInterno';
    case 'traslado':
      return 'Traslado';
    case 'venta':
      return 'Venta';
    case 'baja':
      return 'Baja';
    default:
      return 'CambioInterno';
  }
}

export function isAllowedMovementType(raw: string): raw is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(raw);
}

function normalizeOptionalGuid(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normaliza la entrada del formulario respetando qué campos de origen/destino
 * tienen sentido para cada tipo de movimiento.
 */
export function normalizeMovementInput(input: MovementInput): MovementInput {
  const tipo = normalizeMovementType(input.tipo);
  const idLoteOrigen = normalizeOptionalGuid(input.idLoteOrigen);
  let idLoteDestino = normalizeOptionalGuid(input.idLoteDestino);
  let origenExterno = normalizeOptionalText(input.origenExterno);
  let destinoExterno = normalizeOptionalText(input.destinoExterno);

  if (tipo === 'CambioInterno') {
    origenExterno = null;
    destinoExterno = null;
  } else if (tipo === 'Alta') {
    destinoExterno = null;
  } else if (tipo === 'Venta') {
    idLoteDestino = null;
    origenExterno = null;
  } else if (tipo === 'Baja') {
    idLoteDestino = null;
    origenExterno = null;
    destinoExterno = null;
  }

  return {
    idAnimal: input.idAnimal.trim(),
    tipo,
    fecha: input.fecha.trim(),
    idLoteOrigen,
    idLoteDestino,
    origenExterno,
    destinoExterno,
    motivo: normalizeOptionalText(input.motivo)
  };
}

export interface ValidateMovementContext {
  animals?: Cattle[];
  lots?: LotOption[];
  isEditMode?: boolean;
  now?: Date;
}

function parseMovementDate(raw: string): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function validateMovementInput(
  rawInput: MovementInput,
  context: ValidateMovementContext = {}
): MovementValidationErrors {
  const errors: MovementValidationErrors = {};
  const idAnimal = rawInput.idAnimal.trim();
  const tipo = rawInput.tipo;
  const fechaStr = rawInput.fecha.trim();
  const idLoteOrigen = normalizeOptionalGuid(rawInput.idLoteOrigen);
  const idLoteDestino = normalizeOptionalGuid(rawInput.idLoteDestino);
  const origenExterno = normalizeOptionalText(rawInput.origenExterno);
  const destinoExterno = normalizeOptionalText(rawInput.destinoExterno);
  const motivo = normalizeOptionalText(rawInput.motivo);

  let selectedAnimal: Cattle | undefined;

  // 1. Animal obligatorio y existente
  if (!idAnimal) {
    errors.idAnimal = 'Debes seleccionar el animal involucrado en el movimiento.';
  } else if (!isValidGuid(idAnimal)) {
    errors.idAnimal = 'El identificador del animal debe ser un UUID válido.';
  } else if (context.animals) {
    selectedAnimal = context.animals.find((a) => a.id === idAnimal && !a.deletedAt);
    if (!selectedAnimal) {
      errors.idAnimal = 'El animal seleccionado no existe o está desactivado.';
    } else if (
      !context.isEditMode &&
      (selectedAnimal.estado === 'Vendido' || selectedAnimal.estado === 'Baja') &&
      tipo !== 'Alta'
    ) {
      errors.idAnimal = `El animal ${selectedAnimal.arete} figura como "${selectedAnimal.estado}". Solo puedes registrar un movimiento de tipo Alta para reingresarlo.`;
    }
  }

  // 2. Tipo de movimiento permitido por Backend
  if (!tipo || !isAllowedMovementType(tipo)) {
    errors.tipo = 'Selecciona un tipo de movimiento válido (Alta, CambioInterno, Traslado, Venta o Baja).';
  }

  // 3. Fecha válida, no futura y consistente con nacimiento
  const parsedFecha = parseMovementDate(fechaStr);
  if (!fechaStr) {
    errors.fecha = 'La fecha del movimiento es obligatoria.';
  } else if (!parsedFecha) {
    errors.fecha = 'La fecha ingresada no tiene un formato válido.';
  } else {
    const now = context.now ?? new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (parsedFecha.getTime() > endOfToday.getTime()) {
      errors.fecha = 'La fecha del movimiento no puede estar en el futuro.';
    } else if (selectedAnimal?.fechaNacimiento) {
      const birthDate = new Date(`${selectedAnimal.fechaNacimiento.slice(0, 10)}T00:00:00`);
      if (!Number.isNaN(birthDate.getTime()) && parsedFecha.getTime() < birthDate.getTime()) {
        errors.fecha = 'La fecha del movimiento no puede ser anterior a la fecha de nacimiento del animal.';
      }
    }
  }

  // 4. Validación de lotes de origen y destino
  let origenLot: LotOption | undefined;
  let destinoLot: LotOption | undefined;

  if (idLoteOrigen) {
    if (!isValidGuid(idLoteOrigen)) {
      errors.idLoteOrigen = 'El identificador del potrero de origen no es un UUID válido.';
    } else if (context.lots) {
      origenLot = context.lots.find((l) => l.id === idLoteOrigen);
      if (!origenLot) {
        errors.idLoteOrigen = 'El potrero de origen seleccionado no existe o fue desactivado.';
      } else if (
        tipo === 'CambioInterno' &&
        selectedAnimal &&
        origenLot.idRancho &&
        origenLot.idRancho !== selectedAnimal.idRancho
      ) {
        errors.idLoteOrigen = 'En un cambio interno, el potrero de origen debe pertenecer al mismo rancho del animal.';
      }
    }
  }

  if (idLoteDestino) {
    if (!isValidGuid(idLoteDestino)) {
      errors.idLoteDestino = 'El identificador del potrero de destino no es un UUID válido.';
    } else if (context.lots) {
      destinoLot = context.lots.find((l) => l.id === idLoteDestino);
      if (!destinoLot) {
        errors.idLoteDestino = 'El potrero de destino seleccionado no existe o fue desactivado.';
      } else if (
        (tipo === 'Alta' || tipo === 'CambioInterno') &&
        selectedAnimal &&
        destinoLot.idRancho &&
        destinoLot.idRancho !== selectedAnimal.idRancho
      ) {
        errors.idLoteDestino =
          'En altas o cambios internos, el potrero de destino debe pertenecer al mismo rancho del animal.';
      }
    }
  }

  // Regla Backend: origen y destino nunca pueden ser el mismo lote
  if (idLoteOrigen && idLoteDestino && idLoteOrigen === idLoteDestino) {
    errors.idLoteDestino = 'El potrero de destino no puede ser igual al potrero de origen.';
  }

  // 5. Reglas de consistencia por tipo de movimiento
  if (tipo === 'CambioInterno') {
    if (!idLoteDestino && !errors.idLoteDestino) {
      errors.idLoteDestino = 'Selecciona el potrero de destino para el cambio interno.';
    } else if (
      !context.isEditMode &&
      !idLoteOrigen &&
      idLoteDestino &&
      selectedAnimal?.idLote &&
      selectedAnimal.idLote === idLoteDestino &&
      !errors.idLoteDestino
    ) {
      errors.idLoteDestino =
        'El animal ya se encuentra asignado a ese potrero. Selecciona un destino diferente.';
    }
  } else if (tipo === 'Alta') {
    if (!idLoteDestino && !origenExterno) {
      errors.idLoteDestino =
        'Para registrar un Alta, indica el potrero de destino o el origen externo del animal.';
    }
  } else if (tipo === 'Traslado') {
    if (!idLoteDestino && !destinoExterno) {
      errors.destinoExterno =
        'Para registrar un Traslado, indica un potrero de destino o un destino externo.';
    }
  } else if (tipo === 'Venta') {
    if (idLoteDestino && !errors.idLoteDestino) {
      errors.idLoteDestino = 'Un movimiento de Venta no debe asignar un potrero interno de destino.';
    }
    if (!destinoExterno && !motivo) {
      errors.destinoExterno =
        'Indica el comprador/destino externo o detalla el motivo de la venta.';
    }
  } else if (tipo === 'Baja') {
    if (idLoteDestino && !errors.idLoteDestino) {
      errors.idLoteDestino = 'Un movimiento de Baja no debe asignar un potrero de destino.';
    }
    if (!motivo) {
      errors.motivo = 'El motivo / observaciones es obligatorio para registrar una Baja.';
    }
  }

  // 6. Longitudes máximas del contrato SQL
  if (origenExterno && origenExterno.length > MOVEMENT_FIELD_LIMITS.origenExternoMax) {
    errors.origenExterno = `El origen externo no puede exceder ${MOVEMENT_FIELD_LIMITS.origenExternoMax} caracteres.`;
  }

  if (destinoExterno && destinoExterno.length > MOVEMENT_FIELD_LIMITS.destinoExternoMax) {
    errors.destinoExterno = `El destino externo no puede exceder ${MOVEMENT_FIELD_LIMITS.destinoExternoMax} caracteres.`;
  }

  if (motivo && motivo.length > MOVEMENT_FIELD_LIMITS.motivoMax) {
    errors.motivo = `El motivo / observaciones no puede exceder ${MOVEMENT_FIELD_LIMITS.motivoMax} caracteres.`;
  }

  return errors;
}
