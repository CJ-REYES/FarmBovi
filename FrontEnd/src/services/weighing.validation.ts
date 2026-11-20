import type { Cattle } from '../types/cattle';
import type {
  AnimalLastWeightSummary,
  Weighing,
  WeighingDelta,
  WeighingInput,
  WeightEvolutionPoint
} from '../types/weighing';
import { isValidGuid } from './cattle.validation';

export type WeighingValidationField =
  | 'idAnimal'
  | 'pesoRealKg'
  | 'fecha'
  | 'fuenteBascula'
  | 'responsable'
  | 'observaciones';

export type WeighingValidationErrors = Partial<Record<WeighingValidationField, string>>;

export const WEIGHING_FIELD_LIMITS = {
  fuenteBasculaMax: 180,
  responsableMax: 180,
  observacionesMax: 500,
  /** Rango realista para pesaje bovino en kg (compatible con SQL decimal(9,3)) */
  pesoMaxKg: 2500
} as const;

export interface NormalizedWeighingInput {
  idAnimal: string;
  pesoRealKg: number;
  fecha: string;
  fuenteBascula: string;
  responsable: string;
  observaciones: string | null;
}

export function parsePesoKg(raw: number | string): number {
  if (typeof raw === 'number') return raw;
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

export function normalizeWeighingInput(input: WeighingInput): NormalizedWeighingInput {
  const parsedPeso = parsePesoKg(input.pesoRealKg);
  const roundedPeso = Number.isFinite(parsedPeso)
    ? Math.round(parsedPeso * 1000) / 1000
    : Number.NaN;

  const obs = input.observaciones?.trim() || '';

  return {
    idAnimal: input.idAnimal.trim(),
    pesoRealKg: roundedPeso,
    fecha: input.fecha.trim(),
    fuenteBascula: input.fuenteBascula.trim(),
    responsable: input.responsable.trim(),
    observaciones: obs.length > 0 ? obs : null
  };
}

export interface ValidateWeighingContext {
  animals?: Cattle[];
  now?: Date;
}

export function validateWeighingInput(
  rawInput: WeighingInput,
  context: ValidateWeighingContext = {}
): WeighingValidationErrors {
  const errors: WeighingValidationErrors = {};
  const idAnimal = rawInput.idAnimal.trim();
  const pesoRealKg = parsePesoKg(rawInput.pesoRealKg);
  const fechaStr = rawInput.fecha.trim();
  const fuenteBascula = rawInput.fuenteBascula.trim();
  const responsable = rawInput.responsable.trim();
  const observaciones = rawInput.observaciones?.trim() || '';

  let selectedAnimal: Cattle | undefined;

  if (!idAnimal) {
    errors.idAnimal = 'Debes seleccionar el animal a pesar.';
  } else if (!isValidGuid(idAnimal)) {
    errors.idAnimal = 'El identificador del animal debe ser un UUID válido.';
  } else if (context.animals) {
    selectedAnimal = context.animals.find((a) => a.id === idAnimal && !a.deletedAt);
    if (!selectedAnimal) {
      errors.idAnimal = 'El animal seleccionado no existe o está desactivado.';
    }
  }

  // Regla 14: Pesaje.pesoRealKg > 0 proviene de báscula.
  if (!Number.isFinite(pesoRealKg) || pesoRealKg <= 0) {
    errors.pesoRealKg = 'El peso real de báscula (kg) debe ser un número positivo mayor que cero.';
  } else if (pesoRealKg > WEIGHING_FIELD_LIMITS.pesoMaxKg) {
    errors.pesoRealKg = `El peso no puede exceder ${WEIGHING_FIELD_LIMITS.pesoMaxKg} kg. Verifica la unidad.`;
  }

  const parsedFecha = fechaStr ? new Date(fechaStr) : null;
  if (!fechaStr) {
    errors.fecha = 'La fecha y hora del pesaje son obligatorias.';
  } else if (!parsedFecha || Number.isNaN(parsedFecha.getTime())) {
    errors.fecha = 'La fecha ingresada no tiene un formato válido.';
  } else {
    const now = context.now ?? new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (parsedFecha.getTime() > endOfToday.getTime()) {
      errors.fecha = 'La fecha del pesaje no puede estar en el futuro.';
    } else if (selectedAnimal?.fechaNacimiento) {
      const birthDate = new Date(`${selectedAnimal.fechaNacimiento.slice(0, 10)}T00:00:00`);
      if (!Number.isNaN(birthDate.getTime()) && parsedFecha.getTime() < birthDate.getTime()) {
        errors.fecha = 'La fecha del pesaje no puede ser anterior al nacimiento del animal.';
      }
    }
  }

  if (!fuenteBascula) {
    errors.fuenteBascula = 'La fuente o báscula utilizada es obligatoria.';
  } else if (fuenteBascula.length > WEIGHING_FIELD_LIMITS.fuenteBasculaMax) {
    errors.fuenteBascula = `La fuente de báscula no puede exceder ${WEIGHING_FIELD_LIMITS.fuenteBasculaMax} caracteres.`;
  }

  if (!responsable) {
    errors.responsable = 'El responsable del pesaje es obligatorio.';
  } else if (responsable.length > WEIGHING_FIELD_LIMITS.responsableMax) {
    errors.responsable = `El responsable no puede exceder ${WEIGHING_FIELD_LIMITS.responsableMax} caracteres.`;
  }

  if (observaciones.length > WEIGHING_FIELD_LIMITS.observacionesMax) {
    errors.observaciones = `Las observaciones no pueden exceder ${WEIGHING_FIELD_LIMITS.observacionesMax} caracteres.`;
  }

  return errors;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatShortDateLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return parsed.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function compareAsc(a: Weighing, b: Weighing): number {
  const tA = Date.parse(a.fecha);
  const tB = Date.parse(b.fecha);
  if (!Number.isNaN(tA) && !Number.isNaN(tB) && tA !== tB) {
    return tA - tB;
  }
  const byFecha = a.fecha.localeCompare(b.fecha);
  if (byFecha !== 0) return byFecha;
  return a.createdAt.localeCompare(b.createdAt);
}

export interface WeightAnalyticsResult {
  latestWeighing: Weighing | null;
  deltaByWeighingId: Map<string, WeighingDelta>;
  averageGdpKgDay: number | null;
  evolutionPoints: WeightEvolutionPoint[];
  latestByAnimal: AnimalLastWeightSummary[];
}

/**
 * Calcula métricas reales de evolución y ganancia diaria de peso (GDP)
 * estrictamente a partir de pesajes activos reales (nunca datos ficticios).
 */
export function computeWeightAnalytics(
  weighings: Weighing[],
  animals: Cattle[],
  selectedAnimalId?: string
): WeightAnalyticsResult {
  const activeWeighings = weighings
    .filter((w) => !w.deletedAt && Number.isFinite(w.pesoRealKg) && w.pesoRealKg > 0)
    .sort(compareAsc);

  const animalById = new Map(animals.map((a) => [a.id, a]));
  const byAnimal = new Map<string, Weighing[]>();
  for (const w of activeWeighings) {
    const list = byAnimal.get(w.idAnimal) ?? [];
    list.push(w);
    byAnimal.set(w.idAnimal, list);
  }

  const deltaByWeighingId = new Map<string, WeighingDelta>();
  const animalGdps: number[] = [];
  const latestByAnimal: AnimalLastWeightSummary[] = [];

  for (const [idAnimal, list] of byAnimal.entries()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      const deltaKg = Math.round((curr.pesoRealKg - prev.pesoRealKg) * 1000) / 1000;
      const daysElapsed = Math.max(0, (Date.parse(curr.fecha) - Date.parse(prev.fecha)) / MS_PER_DAY);
      const gdpKgDay =
        daysElapsed >= 1 ? Math.round((deltaKg / daysElapsed) * 1000) / 1000 : null;
      deltaByWeighingId.set(curr.id, { deltaKg, daysElapsed, gdpKgDay });
    }

    const first = list[0];
    const latest = list[list.length - 1];
    const previous = list.length >= 2 ? list[list.length - 2] : null;
    const totalDays =
      list.length >= 2 ? (Date.parse(latest.fecha) - Date.parse(first.fecha)) / MS_PER_DAY : 0;
    const overallGdp =
      totalDays >= 1
        ? Math.round(((latest.pesoRealKg - first.pesoRealKg) / totalDays) * 1000) / 1000
        : null;

    if (overallGdp !== null) {
      animalGdps.push(overallGdp);
    }

    const animal = animalById.get(idAnimal);
    latestByAnimal.push({
      idAnimal,
      arete: animal?.arete || `Animal ${idAnimal.slice(0, 8)}…`,
      raza: animal?.raza || '',
      latestWeightKg: latest.pesoRealKg,
      latestFecha: latest.fecha,
      previousWeightKg: previous ? previous.pesoRealKg : null,
      deltaKg: previous
        ? Math.round((latest.pesoRealKg - previous.pesoRealKg) * 1000) / 1000
        : null,
      gdpKgDay: overallGdp,
      totalWeighings: list.length
    });
  }

  latestByAnimal.sort((a, b) => b.latestWeightKg - a.latestWeightKg);

  const scopedWeighings =
    selectedAnimalId && selectedAnimalId !== 'todos'
      ? activeWeighings.filter((w) => w.idAnimal === selectedAnimalId)
      : activeWeighings;

  const latestWeighing =
    scopedWeighings.length > 0 ? scopedWeighings[scopedWeighings.length - 1] : null;

  let averageGdpKgDay: number | null = null;
  if (selectedAnimalId && selectedAnimalId !== 'todos') {
    const summary = latestByAnimal.find((s) => s.idAnimal === selectedAnimalId);
    averageGdpKgDay = summary?.gdpKgDay ?? null;
  } else if (animalGdps.length > 0) {
    const sum = animalGdps.reduce((acc, v) => acc + v, 0);
    averageGdpKgDay = Math.round((sum / animalGdps.length) * 1000) / 1000;
  }

  // Construir serie cronológica real para la gráfica
  let evolutionPoints: WeightEvolutionPoint[];
  if (selectedAnimalId && selectedAnimalId !== 'todos') {
    evolutionPoints = scopedWeighings.map((w) => ({
      id: w.id,
      fecha: w.fecha,
      label: formatShortDateLabel(w.fecha),
      pesoKg: w.pesoRealKg,
      sampleCount: 1,
      weighingId: w.id
    }));
  } else {
    // Agrupar por fecha (YYYY-MM-DD) para obtener promedio real del hato por jornada de pesaje
    const grouped = new Map<string, { sum: number; count: number; latestFecha: string; lastId: string }>();
    for (const w of scopedWeighings) {
      const dayKey = w.fecha.slice(0, 10);
      const bucket = grouped.get(dayKey);
      if (bucket) {
        bucket.sum += w.pesoRealKg;
        bucket.count += 1;
        bucket.latestFecha = w.fecha;
        bucket.lastId = w.id;
      } else {
        grouped.set(dayKey, {
          sum: w.pesoRealKg,
          count: 1,
          latestFecha: w.fecha,
          lastId: w.id
        });
      }
    }

    evolutionPoints = Array.from(grouped.entries())
      .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
      .map(([dayKey, bucket]) => ({
        id: dayKey,
        fecha: bucket.latestFecha,
        label: formatShortDateLabel(bucket.latestFecha),
        pesoKg: Math.round((bucket.sum / bucket.count) * 100) / 100,
        sampleCount: bucket.count,
        weighingId: bucket.count === 1 ? bucket.lastId : undefined
      }));
  }

  return {
    latestWeighing,
    deltaByWeighingId,
    averageGdpKgDay,
    evolutionPoints,
    latestByAnimal
  };
}
