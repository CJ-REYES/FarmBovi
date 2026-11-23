import type { Cattle } from '../types/cattle';
import { MOVEMENT_TYPE_LABELS, type MovementType } from '../types/movement';
import {
  UNASSIGNED_LOT_FILTER_VALUE,
  type ComputedReports,
  type DistributionItem,
  type ReportCategory,
  type ReportDataset,
  type ReportFilters
} from '../types/reports';
import { CattleService } from './cattle.service';
import { FeedingService } from './feeding.service';
import { HealthService } from './health.service';
import { isTreatmentPending } from './health.validation';
import { LotService } from './lot.service';
import { MovementService } from './movement.service';
import { ReproductionService } from './reproduction.service';
import { WeighingService } from './weighing.service';
import { computeWeightAnalytics } from './weighing.validation';

function extractDateKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (isoMatch) return isoMatch[1];

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isWithinDateRange(
  rawDate: string | null | undefined,
  fechaDesde: string,
  fechaHasta: string
): boolean {
  const from = fechaDesde.trim();
  const to = fechaHasta.trim();
  if (!from && !to) return true;

  const key = extractDateKey(rawDate);
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function calculateAgeInMonths(fechaNacimiento: string, referenceDate: Date): number | null {
  const key = extractDateKey(fechaNacimiento);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return null;

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth() + 1;
  const refDay = referenceDate.getUTCDate();

  let months = (refYear - y) * 12 + (refMonth - m);
  if (refDay < d) {
    months -= 1;
  }
  return Math.max(0, months);
}

/**
 * Clasifica un animal de forma determinística a partir de `sexo` y `fechaNacimiento` reales.
 * Cuando falta `fechaNacimiento` no inventa edad: lo clasifica explícitamente sin fecha.
 */
export function classifyAnimalCategory(
  animal: Pick<Cattle, 'sexo' | 'fechaNacimiento'>,
  referenceDate: Date = new Date()
): ReportCategory {
  const normalizedSex = (animal.sexo || '').trim().toLowerCase();
  const isFemale = normalizedSex === 'hembra' || normalizedSex === 'f';
  const isMale = normalizedSex === 'macho' || normalizedSex === 'm';

  if (!isFemale && !isMale) {
    return 'Sin clasificar';
  }

  if (!animal.fechaNacimiento) {
    return isFemale ? 'Hembra (sin fecha nac.)' : 'Macho (sin fecha nac.)';
  }

  const ageMonths = calculateAgeInMonths(animal.fechaNacimiento, referenceDate);
  if (ageMonths === null) {
    return isFemale ? 'Hembra (sin fecha nac.)' : 'Macho (sin fecha nac.)';
  }

  if (isFemale) {
    if (ageMonths < 12) return 'Becerra';
    if (ageMonths < 24) return 'Novilla';
    return 'Vaca';
  }

  if (ageMonths < 12) return 'Becerro';
  if (ageMonths < 24) return 'Novillo';
  return 'Toro';
}

function buildDistribution(
  counts: Map<string, { label: string; count: number; detail?: string }>,
  total: number
): DistributionItem[] {
  return Array.from(counts.entries())
    .map(([key, item]) => ({
      key,
      label: item.label,
      count: item.count,
      percentage: total > 0 ? Math.round((item.count / total) * 1000) / 10 : 0,
      detail: item.detail
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
}

function resolveMovementTypeLabel(tipo: string): string {
  if (tipo in MOVEMENT_TYPE_LABELS) {
    return MOVEMENT_TYPE_LABELS[tipo as MovementType];
  }
  return tipo || 'Sin tipo';
}

export const ReportsService = {
  /**
   * Carga todos los conjuntos reales desde los servicios del proyecto (API REST cuando hay red
   * + respaldo IndexedDB para operación 100% offline).
   */
  async loadDataset(options?: { includeDeleted?: boolean }): Promise<ReportDataset> {
    const includeDeleted = Boolean(options?.includeDeleted);
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    const [
      cattleRes,
      lotsRes,
      weighingsRes,
      healthRes,
      feedingRes,
      reproductionRes,
      movementsRes
    ] = await Promise.allSettled([
      CattleService.getAll({ includeDeleted }),
      LotService.getAll({ includeDeleted }),
      WeighingService.getAll({ includeDeleted, order: 'asc' }),
      HealthService.getAll({ includeDeleted, order: 'desc' }),
      FeedingService.getAll({ includeDeleted, order: 'desc' }),
      ReproductionService.getAll({ includeDeleted, order: 'desc' }),
      MovementService.getAll({ includeDeleted, order: 'desc' })
    ]);

    const results = [
      cattleRes,
      lotsRes,
      weighingsRes,
      healthRes,
      feedingRes,
      reproductionRes,
      movementsRes
    ];
    if (results.every((r) => r.status === 'rejected')) {
      throw new Error(
        'No fue posible cargar los datos de reportes ni desde el servidor ni desde IndexedDB.'
      );
    }

    const warnings: string[] = [];
    const registerRejection = (label: string, reason: unknown) => {
      const msg = reason instanceof Error ? reason.message : 'Error inesperado';
      warnings.push(`${label}: ${msg}`);
    };

    const cattle = cattleRes.status === 'fulfilled' ? cattleRes.value.data : [];
    if (cattleRes.status === 'rejected') registerRejection('Animales', cattleRes.reason);
    else if (cattleRes.value.warning) warnings.push(cattleRes.value.warning);

    const lots = lotsRes.status === 'fulfilled' ? lotsRes.value.data : [];
    if (lotsRes.status === 'rejected') registerRejection('Potreros', lotsRes.reason);
    else if (lotsRes.value.warning) warnings.push(lotsRes.value.warning);

    const weighings = weighingsRes.status === 'fulfilled' ? weighingsRes.value.data : [];
    if (weighingsRes.status === 'rejected') registerRejection('Pesajes', weighingsRes.reason);

    const healthEvents = healthRes.status === 'fulfilled' ? healthRes.value.events : [];
    const treatments = healthRes.status === 'fulfilled' ? healthRes.value.treatments : [];
    if (healthRes.status === 'rejected') registerRejection('Sanidad', healthRes.reason);
    else if (healthRes.value.warning) warnings.push(healthRes.value.warning);

    const feedingRecords = feedingRes.status === 'fulfilled' ? feedingRes.value.data : [];
    if (feedingRes.status === 'rejected') registerRejection('Alimentación', feedingRes.reason);
    else if (feedingRes.value.warning) warnings.push(feedingRes.value.warning);

    const reproductionEvents =
      reproductionRes.status === 'fulfilled' ? reproductionRes.value.data : [];
    if (reproductionRes.status === 'rejected') {
      registerRejection('Reproducción', reproductionRes.reason);
    }

    const movements = movementsRes.status === 'fulfilled' ? movementsRes.value.data : [];
    if (movementsRes.status === 'rejected') registerRejection('Movimientos', movementsRes.reason);
    else if (movementsRes.value.warning) warnings.push(movementsRes.value.warning);

    const remoteCapableSources = [
      cattleRes.status === 'fulfilled' ? cattleRes.value.source : 'cache',
      lotsRes.status === 'fulfilled' ? lotsRes.value.source : 'cache',
      healthRes.status === 'fulfilled' ? healthRes.value.source : 'cache',
      feedingRes.status === 'fulfilled' ? feedingRes.value.source : 'cache',
      movementsRes.status === 'fulfilled' ? movementsRes.value.source : 'cache'
    ];

    const serverCount = remoteCapableSources.filter((s) => s === 'server').length;
    const dataSource: ReportDataset['dataSource'] =
      isOffline || serverCount === 0
        ? 'cache'
        : serverCount === remoteCapableSources.length
          ? 'server'
          : 'mixed';

    return {
      cattle,
      lots,
      weighings,
      healthEvents,
      treatments,
      feedingRecords,
      reproductionEvents,
      movements,
      dataSource,
      isOffline,
      warnings: Array.from(new Set(warnings)),
      loadedAt: new Date().toISOString()
    };
  },

  /**
   * Calcula todos los indicadores reales aplicando de forma consistente los filtros de
   * fecha, animal, categoría y potrero. Todos los totales coinciden con los registros reales.
   */
  computeReports(
    dataset: ReportDataset,
    filters: ReportFilters,
    referenceDate: Date = new Date()
  ): ComputedReports {
    const lotNameById: Record<string, string> = {};
    for (const lot of dataset.lots) {
      lotNameById[lot.idLote] = lot.nombre;
      lotNameById[lot.id] = lot.nombre;
    }

    const animalCategoryById: Record<string, ReportCategory> = {};
    const animalAreteById: Record<string, string> = {};
    const animalLotById = new Map<string, string | null>();

    for (const animal of dataset.cattle) {
      const category = classifyAnimalCategory(animal, referenceDate);
      animalCategoryById[animal.id] = category;
      animalCategoryById[animal.idAnimal] = category;
      animalAreteById[animal.id] = animal.arete;
      animalAreteById[animal.idAnimal] = animal.arete;
      animalLotById.set(animal.id, animal.idLote ?? null);
      animalLotById.set(animal.idAnimal, animal.idLote ?? null);
    }

    // 1. Filtrar padrón de animales por cohorte (animal, categoría, potrero)
    const filteredAnimals = dataset.cattle.filter((animal) => {
      if (filters.animalId && animal.id !== filters.animalId && animal.idAnimal !== filters.animalId) {
        return false;
      }

      if (filters.categoria) {
        const cat = animalCategoryById[animal.id];
        if (cat !== filters.categoria) return false;
      }

      if (filters.potreroId) {
        if (filters.potreroId === UNASSIGNED_LOT_FILTER_VALUE) {
          if (animal.idLote) return false;
        } else if (animal.idLote !== filters.potreroId) {
          return false;
        }
      }

      return true;
    });

    const hasCohortFilter = Boolean(filters.animalId || filters.categoria || filters.potreroId);
    const allowedAnimalIds = new Set<string>();
    const allowedLotIdsFromCohort = new Set<string>();
    for (const animal of filteredAnimals) {
      allowedAnimalIds.add(animal.id);
      allowedAnimalIds.add(animal.idAnimal);
      if (animal.idLote) {
        allowedLotIdsFromCohort.add(animal.idLote);
      }
    }

    const matchesAnimalCohort = (idAnimal: string | null | undefined): boolean => {
      if (!hasCohortFilter) return true;
      if (!idAnimal) return false;
      return allowedAnimalIds.has(idAnimal);
    };

    // 2. Filtrar pesajes reales
    const filteredWeighings = dataset.weighings.filter(
      (w) =>
        matchesAnimalCohort(w.idAnimal) &&
        isWithinDateRange(w.fecha, filters.fechaDesde, filters.fechaHasta)
    );

    // 3. Filtrar eventos sanitarios
    const filteredHealthEvents = dataset.healthEvents.filter(
      (ev) =>
        matchesAnimalCohort(ev.idAnimal) &&
        isWithinDateRange(ev.fecha, filters.fechaDesde, filters.fechaHasta)
    );

    // 4. Filtrar tratamientos (y extraer pendientes)
    const filteredTreatments = dataset.treatments.filter(
      (t) =>
        matchesAnimalCohort(t.idAnimal) &&
        isWithinDateRange(t.fechaInicio, filters.fechaDesde, filters.fechaHasta)
    );
    const tratamientosPendientesLista = filteredTreatments.filter((t) =>
      isTreatmentPending(t.estado)
    );

    // 5. Filtrar actividades de alimentación (soporta objetivo por animal o por lote)
    const filteredFeeding = dataset.feedingRecords.filter((f) => {
      if (!isWithinDateRange(f.inicio, filters.fechaDesde, filters.fechaHasta)) {
        return false;
      }

      if (!hasCohortFilter) return true;

      if (f.idAnimal) {
        return allowedAnimalIds.has(f.idAnimal);
      }

      if (f.idLote) {
        if (filters.potreroId === UNASSIGNED_LOT_FILTER_VALUE) {
          return false;
        }
        if (filters.animalId) {
          const selectedLot = animalLotById.get(filters.animalId);
          return Boolean(selectedLot && selectedLot === f.idLote);
        }
        if (filters.potreroId) {
          return f.idLote === filters.potreroId;
        }
        if (filters.categoria) {
          return allowedLotIdsFromCohort.has(f.idLote);
        }
      }

      return false;
    });

    // 6. Filtrar eventos reproductivos
    const filteredReproduction = dataset.reproductionEvents.filter(
      (r) =>
        matchesAnimalCohort(r.idAnimal) &&
        isWithinDateRange(r.fecha, filters.fechaDesde, filters.fechaHasta)
    );

    // 7. Filtrar movimientos registrados
    const filteredMovements = dataset.movements.filter((m) => {
      if (!isWithinDateRange(m.fecha, filters.fechaDesde, filters.fechaHasta)) {
        return false;
      }
      if (!hasCohortFilter) return true;

      if (filters.animalId || filters.categoria) {
        return allowedAnimalIds.has(m.idAnimal);
      }

      if (filters.potreroId) {
        if (filters.potreroId === UNASSIGNED_LOT_FILTER_VALUE) {
          return allowedAnimalIds.has(m.idAnimal);
        }
        return (
          allowedAnimalIds.has(m.idAnimal) ||
          m.idLoteOrigen === filters.potreroId ||
          m.idLoteDestino === filters.potreroId
        );
      }

      return true;
    });

    // 8. Distribuciones del padrón filtrado
    const categoryCounts = new Map<string, { label: string; count: number }>();
    const potreroCounts = new Map<string, { label: string; count: number; detail?: string }>();
    const sexoCounts = new Map<string, { label: string; count: number }>();
    const estadoCounts = new Map<string, { label: string; count: number }>();

    let animalesActivos = 0;
    let animalesVendidos = 0;
    let animalesBaja = 0;
    let ingresosEnPeriodo = 0;

    for (const animal of filteredAnimals) {
      const cat = animalCategoryById[animal.id] || 'Sin clasificar';
      const catEntry = categoryCounts.get(cat) ?? { label: cat, count: 0 };
      catEntry.count += 1;
      categoryCounts.set(cat, catEntry);

      const lotKey = animal.idLote || UNASSIGNED_LOT_FILTER_VALUE;
      const lotLabel = animal.idLote
        ? lotNameById[animal.idLote] || `Potrero (${animal.idLote.slice(0, 8)})`
        : 'Sin potrero asignado';
      const lotEntry = potreroCounts.get(lotKey) ?? { label: lotLabel, count: 0 };
      lotEntry.count += 1;
      potreroCounts.set(lotKey, lotEntry);

      const sexLabel = animal.sexo || 'Sin definir';
      const sexEntry = sexoCounts.get(sexLabel) ?? { label: sexLabel, count: 0 };
      sexEntry.count += 1;
      sexoCounts.set(sexLabel, sexEntry);

      const estadoLabel = animal.estado || 'Activo';
      const estadoEntry = estadoCounts.get(estadoLabel) ?? { label: estadoLabel, count: 0 };
      estadoEntry.count += 1;
      estadoCounts.set(estadoLabel, estadoEntry);

      const normEstado = estadoLabel.toLowerCase();
      if (normEstado === 'activo') animalesActivos += 1;
      else if (normEstado === 'vendido') animalesVendidos += 1;
      else if (normEstado === 'baja') animalesBaja += 1;

      if (isWithinDateRange(animal.fechaIngreso, filters.fechaDesde, filters.fechaHasta)) {
        ingresosEnPeriodo += 1;
      }
    }

    // 9. Evolución real de peso
    const rawWeightAnalytics = computeWeightAnalytics(
      filteredWeighings,
      filteredAnimals,
      filters.animalId || 'todos'
    );
    const latestWeights = rawWeightAnalytics.latestByAnimal.map((item) => item.latestWeightKg);
    const allWeights = filteredWeighings.map((w) => w.pesoRealKg);
    const evolucionPeso = {
      totalWeighings: filteredWeighings.length,
      averageLatestWeightKg:
        latestWeights.length > 0
          ? Math.round(
              (latestWeights.reduce((acc, v) => acc + v, 0) / latestWeights.length) * 100
            ) / 100
          : null,
      minWeightKg: allWeights.length > 0 ? Math.min(...allWeights) : null,
      maxWeightKg: allWeights.length > 0 ? Math.max(...allWeights) : null,
      averageGdpKgDay: rawWeightAnalytics.averageGdpKgDay,
      evolutionPoints: rawWeightAnalytics.evolutionPoints,
      latestByAnimal: rawWeightAnalytics.latestByAnimal
    };

    // 10. Distribuciones de sanidad, alimentación, reproducción y movimientos
    const healthTypeCounts = new Map<string, { label: string; count: number }>();
    for (const ev of filteredHealthEvents) {
      const key = ev.tipo.trim() || 'Otro';
      const entry = healthTypeCounts.get(key) ?? { label: key, count: 0 };
      entry.count += 1;
      healthTypeCounts.set(key, entry);
    }

    const feedTypeCounts = new Map<string, { label: string; count: number; detail?: string }>();
    let feedingPorLote = 0;
    let feedingPorAnimal = 0;
    let totalCantidadKg = 0;
    const qtyByFeed = new Map<string, number>();

    for (const f of filteredFeeding) {
      if (f.targetType === 'lote' || (f.idLote && !f.idAnimal)) feedingPorLote += 1;
      else feedingPorAnimal += 1;

      const unitNorm = (f.unidad || '').trim().toLowerCase();
      if (unitNorm === 'kg' || unitNorm === 'kilogramos' || unitNorm === 'kilos' || unitNorm === '') {
        totalCantidadKg += Number(f.cantidad) || 0;
      }

      const key = f.alimento.trim() || 'Sin especificar';
      const entry = feedTypeCounts.get(key) ?? { label: key, count: 0 };
      entry.count += 1;
      feedTypeCounts.set(key, entry);
      qtyByFeed.set(key, (qtyByFeed.get(key) ?? 0) + (Number(f.cantidad) || 0));
    }

    for (const [key, entry] of feedTypeCounts.entries()) {
      const qty = qtyByFeed.get(key) ?? 0;
      entry.detail = `${Math.round(qty * 10) / 10} total`;
    }

    const reproTypeCounts = new Map<string, { label: string; count: number }>();
    for (const r of filteredReproduction) {
      const key = r.tipo.trim() || 'Sin tipo';
      const entry = reproTypeCounts.get(key) ?? { label: key, count: 0 };
      entry.count += 1;
      reproTypeCounts.set(key, entry);
    }

    const movTypeCounts = new Map<string, { label: string; count: number }>();
    for (const m of filteredMovements) {
      const key = m.tipo || 'Otro';
      const entry = movTypeCounts.get(key) ?? {
        label: resolveMovementTypeLabel(key),
        count: 0
      };
      entry.count += 1;
      movTypeCounts.set(key, entry);
    }

    return {
      kpis: {
        totalAnimales: filteredAnimals.length,
        animalesActivos,
        animalesVendidos,
        animalesBaja,
        ingresosEnPeriodo,
        totalPesajes: filteredWeighings.length,
        pesoPromedioKg: evolucionPeso.averageLatestWeightKg,
        eventosSanitarios: filteredHealthEvents.length,
        tratamientosPendientes: tratamientosPendientesLista.length,
        actividadesAlimentacion: filteredFeeding.length,
        eventosReproductivos: filteredReproduction.length,
        movimientosRegistrados: filteredMovements.length
      },
      porCategoria: buildDistribution(categoryCounts, filteredAnimals.length),
      porPotrero: buildDistribution(potreroCounts, filteredAnimals.length),
      porSexo: buildDistribution(sexoCounts, filteredAnimals.length),
      porEstado: buildDistribution(estadoCounts, filteredAnimals.length),
      evolucionPeso,
      sanidadPorTipo: buildDistribution(healthTypeCounts, filteredHealthEvents.length),
      tratamientosPendientesLista,
      alimentacion: {
        totalActividades: filteredFeeding.length,
        porLote: feedingPorLote,
        porAnimal: feedingPorAnimal,
        totalCantidadKg: Math.round(totalCantidadKg * 100) / 100,
        porAlimento: buildDistribution(feedTypeCounts, filteredFeeding.length)
      },
      reproduccionPorTipo: buildDistribution(reproTypeCounts, filteredReproduction.length),
      movimientosPorTipo: buildDistribution(movTypeCounts, filteredMovements.length),
      filteredAnimals,
      filteredWeighings,
      filteredHealthEvents,
      filteredTreatments,
      filteredFeeding,
      filteredReproduction,
      filteredMovements,
      lotNameById,
      animalAreteById,
      animalCategoryById
    };
  }
};
