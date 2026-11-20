import type { Cattle, RanchOption } from '../types/cattle';
import type { Lot } from '../types/lot';
import type { Treatment } from '../types/health';
import {
  ALERT_ESTADOS,
  ALERT_UPCOMING_WINDOW_DAYS,
  type AlertEstado,
  type AlertInput,
  type AlertRecord,
  type AlertTimingStatus
} from '../types/alert';
import { isValidGuid } from './cattle.validation';

export type AlertValidationField =
  | 'idRancho'
  | 'idAnimal'
  | 'idLote'
  | 'idTratamiento'
  | 'idResponsable'
  | 'tipo'
  | 'descripcion'
  | 'fechaProgramada'
  | 'estado'
  | 'fechaCompletado';

export type AlertValidationErrors = Partial<Record<AlertValidationField, string>>;

/** Límites exactos de `FarmDbContext.OnModelCreating` para `Recordatorio`. */
export const ALERT_FIELD_LIMITS = {
  tipoMax: 35,
  descripcionMax: 250,
  estadoMax: 25
} as const;

function normalizeOptGuid(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeAlertEstado(raw: string | null | undefined): AlertEstado {
  if (!raw) return 'Pendiente';
  const lowered = raw.trim().toLowerCase();
  if (lowered === 'en curso' || lowered === 'encurso' || lowered === 'activo') return 'En curso';
  if (lowered === 'completado' || lowered === 'finalizado' || lowered === 'resuelto') {
    return 'Completado';
  }
  if (lowered === 'cancelado' || lowered === 'descartado') return 'Cancelado';
  return 'Pendiente';
}

export function isAlertPendingEstado(estado: string): boolean {
  const normalized = normalizeAlertEstado(estado);
  return normalized === 'Pendiente' || normalized === 'En curso';
}

export function normalizeAlertInput(input: AlertInput): AlertInput {
  const estado = normalizeAlertEstado(input.estado);
  const rawCompletado = input.fechaCompletado?.trim() || '';
  return {
    idRancho: input.idRancho.trim(),
    idAnimal: normalizeOptGuid(input.idAnimal),
    idLote: normalizeOptGuid(input.idLote),
    idTratamiento: normalizeOptGuid(input.idTratamiento),
    idResponsable: normalizeOptGuid(input.idResponsable),
    tipo: input.tipo.trim(),
    descripcion: input.descripcion.trim(),
    fechaProgramada: input.fechaProgramada.trim(),
    estado,
    fechaCompletado:
      estado === 'Completado'
        ? rawCompletado || new Date().toISOString()
        : rawCompletado || null
  };
}

export interface ValidateAlertContext {
  ranches?: RanchOption[];
  animals?: Cattle[];
  lots?: Lot[];
  treatments?: Treatment[];
}

export function validateAlertInput(
  rawInput: AlertInput,
  context: ValidateAlertContext = {}
): AlertValidationErrors {
  const errors: AlertValidationErrors = {};
  const idRancho = rawInput.idRancho.trim();
  const idAnimal = normalizeOptGuid(rawInput.idAnimal);
  const idLote = normalizeOptGuid(rawInput.idLote);
  const idTratamiento = normalizeOptGuid(rawInput.idTratamiento);
  const idResponsable = normalizeOptGuid(rawInput.idResponsable);
  const tipo = rawInput.tipo.trim();
  const descripcion = rawInput.descripcion.trim();
  const fechaProgramada = rawInput.fechaProgramada.trim();
  const estado = rawInput.estado.trim();
  const fechaCompletado = rawInput.fechaCompletado?.trim() || '';

  if (!idRancho) {
    errors.idRancho = 'El rancho del recordatorio es obligatorio.';
  } else if (!isValidGuid(idRancho)) {
    errors.idRancho = 'El identificador del rancho debe ser un UUID válido.';
  } else if (context.ranches && context.ranches.length > 0) {
    const ranchExists = context.ranches.some((r) => r.id === idRancho);
    if (!ranchExists) {
      errors.idRancho = 'El rancho seleccionado no existe o está desactivado.';
    }
  }

  if (!tipo) {
    errors.tipo = 'El tipo de recordatorio es obligatorio.';
  } else if (tipo.length > ALERT_FIELD_LIMITS.tipoMax) {
    errors.tipo = `El tipo no puede exceder ${ALERT_FIELD_LIMITS.tipoMax} caracteres.`;
  }

  if (!descripcion) {
    errors.descripcion = 'La descripción del recordatorio es obligatoria.';
  } else if (descripcion.length > ALERT_FIELD_LIMITS.descripcionMax) {
    errors.descripcion = `La descripción no puede exceder ${ALERT_FIELD_LIMITS.descripcionMax} caracteres.`;
  }

  const parsedProgramada = fechaProgramada ? new Date(fechaProgramada) : null;
  if (!fechaProgramada) {
    errors.fechaProgramada = 'La fecha y hora programada son obligatorias.';
  } else if (!parsedProgramada || Number.isNaN(parsedProgramada.getTime())) {
    errors.fechaProgramada = 'La fecha programada no tiene un formato válido.';
  }

  if (!estado) {
    errors.estado = 'El estado del recordatorio es obligatorio.';
  } else if (estado.length > ALERT_FIELD_LIMITS.estadoMax) {
    errors.estado = `El estado no puede exceder ${ALERT_FIELD_LIMITS.estadoMax} caracteres.`;
  } else if (!ALERT_ESTADOS.includes(estado as AlertEstado)) {
    errors.estado = `El estado debe ser uno de: ${ALERT_ESTADOS.join(', ')}.`;
  }

  if (fechaCompletado) {
    const parsedComp = new Date(fechaCompletado);
    if (Number.isNaN(parsedComp.getTime())) {
      errors.fechaCompletado = 'La fecha de completado no tiene un formato válido.';
    }
  }

  // Regla 12 del Backend: animal y lote son mutuamente excluyentes
  if (idAnimal && idLote) {
    errors.idLote =
      'El recordatorio puede ser general del rancho, individual o por lote; animal y lote son excluyentes.';
  }

  let selectedAnimal: Cattle | undefined;
  if (idAnimal) {
    if (!isValidGuid(idAnimal)) {
      errors.idAnimal = 'El identificador del animal debe ser un UUID válido.';
    } else if (context.animals) {
      selectedAnimal = context.animals.find((a) => a.id === idAnimal && !a.deletedAt);
      if (!selectedAnimal) {
        errors.idAnimal = 'El animal especificado no existe o está desactivado.';
      } else if (idRancho && selectedAnimal.idRancho && selectedAnimal.idRancho !== idRancho) {
        errors.idAnimal = 'El animal del recordatorio debe pertenecer al rancho seleccionado.';
      }
    }
  }

  if (idLote && !errors.idLote) {
    if (!isValidGuid(idLote)) {
      errors.idLote = 'El identificador del lote debe ser un UUID válido.';
    } else if (context.lots) {
      const lot = context.lots.find((l) => l.id === idLote && !l.deletedAt);
      if (!lot) {
        errors.idLote = 'El lote especificado no existe o está desactivado.';
      } else if (idRancho && lot.idRancho && lot.idRancho !== idRancho) {
        errors.idLote = 'El lote del recordatorio debe pertenecer al rancho seleccionado.';
      }
    }
  }

  if (idResponsable && !isValidGuid(idResponsable)) {
    errors.idResponsable = 'El identificador del responsable debe ser un UUID válido.';
  }

  // Reglas de tratamiento vinculado (idénticas a FarmDomainValidationService.ValidateRecordatorioAsync)
  if (idTratamiento) {
    if (idLote) {
      errors.idTratamiento =
        'Un recordatorio vinculado a un tratamiento individual no puede asignarse a un lote.';
    } else if (!isValidGuid(idTratamiento)) {
      errors.idTratamiento = 'El identificador del tratamiento debe ser un UUID válido.';
    } else if (context.treatments) {
      const treatment = context.treatments.find((t) => t.id === idTratamiento && !t.deletedAt);
      if (!treatment) {
        errors.idTratamiento = 'El tratamiento vinculado no existe o está desactivado.';
      } else {
        if (idAnimal && treatment.idAnimal && treatment.idAnimal !== idAnimal) {
          errors.idTratamiento =
            'El tratamiento debe corresponder al animal indicado en el recordatorio.';
        }
        if (idRancho && treatment.idRancho && treatment.idRancho !== idRancho) {
          errors.idTratamiento =
            'El tratamiento vinculado pertenece a un animal de otro rancho.';
        }
      }
    }
  }

  return errors;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Clasifica temporalmente una alerta/recordatorio en vencida, próxima (<= 7 días),
 * programada (> 7 días), completada o cancelada.
 */
export function classifyAlertTiming(
  alert: Pick<AlertRecord, 'estado' | 'fechaProgramada'>,
  now: Date = new Date(),
  upcomingWindowDays: number = ALERT_UPCOMING_WINDOW_DAYS
): AlertTimingStatus {
  const normalized = normalizeAlertEstado(alert.estado);
  if (normalized === 'Completado') return 'completada';
  if (normalized === 'Cancelado') return 'cancelada';

  const targetMs = Date.parse(alert.fechaProgramada);
  if (Number.isNaN(targetMs)) return 'programada';

  const nowMs = now.getTime();
  if (targetMs < nowMs) {
    return 'vencida';
  }

  const upcomingCutoffMs = nowMs + upcomingWindowDays * MS_PER_DAY;
  if (targetMs <= upcomingCutoffMs) {
    return 'proxima';
  }

  return 'programada';
}

export function deriveAlertPriority(
  estado: AlertEstado,
  fechaProgramada: string,
  now: Date = new Date()
): 'Alta' | 'Media' | 'Baja' {
  const timing = classifyAlertTiming({ estado, fechaProgramada }, now);
  if (timing === 'vencida') return 'Alta';
  if (timing === 'proxima') return 'Media';
  return 'Baja';
}

export function formatAlertRelativeTiming(
  alert: Pick<AlertRecord, 'estado' | 'fechaProgramada'>,
  now: Date = new Date()
): string {
  const timing = classifyAlertTiming(alert, now);
  if (timing === 'completada') return 'Completado';
  if (timing === 'cancelada') return 'Cancelado';

  const targetMs = Date.parse(alert.fechaProgramada);
  if (Number.isNaN(targetMs)) return 'Fecha por confirmar';

  const diffMs = targetMs - now.getTime();
  const absHours = Math.round(Math.abs(diffMs) / (60 * 60 * 1000));
  const absDays = Math.floor(Math.abs(diffMs) / MS_PER_DAY);

  if (diffMs < 0) {
    if (absDays >= 1) {
      return `Vencida hace ${absDays} ${absDays === 1 ? 'día' : 'días'}`;
    }
    return absHours <= 1 ? 'Vencida hace menos de 1 h' : `Vencida hace ${absHours} h`;
  }

  if (absDays === 0) {
    return absHours <= 1 ? 'Vence en menos de 1 h' : `Hoy (en ${absHours} h)`;
  }
  return `En ${absDays} ${absDays === 1 ? 'día' : 'días'}`;
}
