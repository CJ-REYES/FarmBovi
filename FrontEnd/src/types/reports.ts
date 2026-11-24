import type { Cattle } from './cattle';
import type { FeedingRecord } from './feeding';
import type { HealthEvent, Treatment } from './health';
import type { Lot } from './lot';
import type { Movement } from './movement';
import type { ReproductionEvent } from './reproduction';
import type { AnimalLastWeightSummary, Weighing, WeightEvolutionPoint } from './weighing';

export const UNASSIGNED_LOT_FILTER_VALUE = '__SIN_POTRERO__' as const;

export const REPORT_CATEGORIES = [
  'Vaca',
  'Novilla',
  'Becerra',
  'Toro',
  'Novillo',
  'Becerro',
  'Hembra (sin fecha nac.)',
  'Macho (sin fecha nac.)',
  'Sin clasificar'
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type ReportExportSection =
  | 'resumen'
  | 'animales'
  | 'pesajes'
  | 'sanidad'
  | 'tratamientos_pendientes'
  | 'alimentacion'
  | 'reproduccion'
  | 'movimientos';

export interface ReportFilters {
  fechaDesde: string;
  fechaHasta: string;
  animalId: string;
  categoria: string;
  potreroId: string;
}

export const INITIAL_REPORT_FILTERS: ReportFilters = {
  fechaDesde: '',
  fechaHasta: '',
  animalId: '',
  categoria: '',
  potreroId: ''
};

export interface ReportBackendDependency {
  id: string;
  indicador: string;
  fuenteActual: string;
  endpointFaltante: string;
  detalle: string;
}

/**
 * Documentación explícita de indicadores que dependen de endpoints o campos todavía
 * inexistentes en el Backend ASP.NET Core actual (`BackEnd/Controllers/`).
 */
export const REPORT_BACKEND_DEPENDENCIES: readonly ReportBackendDependency[] = [
  {
    id: 'reportes-agregados',
    indicador: 'Agregación consolidada de reportes e indicadores',
    fuenteActual: 'Cálculo en cliente sobre colecciones reales (API + IndexedDB)',
    endpointFaltante: 'GET /api/reportes/resumen (inexistente en BackEnd/Controllers/)',
    detalle:
      'El Backend actual no expone ReportesController; el Frontend agrega en tiempo real las entidades confirmadas del servidor y/o IndexedDB sin generar cifras ficticias.'
  },
  {
    id: 'pesajes-rest',
    indicador: 'Evolución de peso',
    fuenteActual: 'IndexedDB local (db.weighings) + sincronización Push/Pull',
    endpointFaltante: 'GET /api/pesajes (PesajesController inexistente)',
    detalle:
      'La evolución de peso refleja pesajes reales de báscula sincronizados mediante Push/Pull y guardados en IndexedDB.'
  },
  {
    id: 'animal-categoria',
    indicador: 'Animales por categoría',
    fuenteActual: 'Derivado de Animal.sexo y Animal.fechaNacimiento (GET /api/animales)',
    endpointFaltante: 'Campo Categoria en BackEnd/Models/Animal.cs (inexistente)',
    detalle:
      'El contrato Animal no incluye una propiedad Categoria; la clasificación zootécnica (Vaca, Novilla, Becerra, Toro, Novillo, Becerro) se calcula por edad y sexo reales, marcando explícitamente los animales sin fecha de nacimiento.'
  }
] as const;

export interface ReportDataset {
  cattle: Cattle[];
  lots: Lot[];
  weighings: Weighing[];
  healthEvents: HealthEvent[];
  treatments: Treatment[];
  feedingRecords: FeedingRecord[];
  reproductionEvents: ReproductionEvent[];
  movements: Movement[];
  dataSource: 'server' | 'mixed' | 'cache';
  isOffline: boolean;
  warnings: string[];
  loadedAt: string;
}

export interface DistributionItem {
  key: string;
  label: string;
  count: number;
  percentage: number;
  detail?: string;
}

export interface FeedingReportSummary {
  totalActividades: number;
  porLote: number;
  porAnimal: number;
  totalCantidadKg: number;
  porAlimento: DistributionItem[];
}

export interface ReportKpis {
  totalAnimales: number;
  animalesActivos: number;
  animalesVendidos: number;
  animalesBaja: number;
  ingresosEnPeriodo: number;
  totalPesajes: number;
  pesoPromedioKg: number | null;
  eventosSanitarios: number;
  tratamientosPendientes: number;
  actividadesAlimentacion: number;
  eventosReproductivos: number;
  movimientosRegistrados: number;
}

export interface ReportWeightSummary {
  totalWeighings: number;
  averageLatestWeightKg: number | null;
  minWeightKg: number | null;
  maxWeightKg: number | null;
  averageGdpKgDay: number | null;
  evolutionPoints: WeightEvolutionPoint[];
  latestByAnimal: AnimalLastWeightSummary[];
}

export interface ComputedReports {
  kpis: ReportKpis;
  porCategoria: DistributionItem[];
  porPotrero: DistributionItem[];
  porSexo: DistributionItem[];
  porEstado: DistributionItem[];
  evolucionPeso: ReportWeightSummary;
  sanidadPorTipo: DistributionItem[];
  tratamientosPendientesLista: Treatment[];
  alimentacion: FeedingReportSummary;
  reproduccionPorTipo: DistributionItem[];
  movimientosPorTipo: DistributionItem[];
  filteredAnimals: Cattle[];
  filteredWeighings: Weighing[];
  filteredHealthEvents: HealthEvent[];
  filteredTreatments: Treatment[];
  filteredFeeding: FeedingRecord[];
  filteredReproduction: ReproductionEvent[];
  filteredMovements: Movement[];
  lotNameById: Record<string, string>;
  animalAreteById: Record<string, string>;
  animalCategoryById: Record<string, ReportCategory>;
}
