import { describe, expect, it } from 'vitest';
import { buildReportCsv, buildReportJson } from './reports.export';
import { classifyAnimalCategory, ReportsService } from './reports.service';
import {
  INITIAL_REPORT_FILTERS,
  UNASSIGNED_LOT_FILTER_VALUE,
  type ReportDataset
} from '../types/reports';

const REF_DATE = new Date('2026-11-22T12:00:00Z');
const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const LOT_NORTE = '22222222-2222-4222-8222-222222222221';
const LOT_SUR = '22222222-2222-4222-8222-222222222222';
const ANIMAL_VACA = '33333333-3333-4333-8333-333333333331';
const ANIMAL_BECERRO = '33333333-3333-4333-8333-333333333332';
const ANIMAL_NOVILLA = '33333333-3333-4333-8333-333333333333';
const ANIMAL_SIN_LOTE = '33333333-3333-4333-8333-333333333334';

function buildFixtureDataset(): ReportDataset {
  const now = '2026-11-20T10:00:00Z';
  return {
    cattle: [
      {
        id: ANIMAL_VACA,
        idAnimal: ANIMAL_VACA,
        idRancho: RANCH_ID,
        idLote: LOT_NORTE,
        arete: 'MX-001',
        raza: 'Brahman',
        sexo: 'Hembra',
        fechaNacimiento: '2023-05-01', // > 24m -> Vaca
        fechaIngreso: '2024-01-10',
        procedencia: 'Propio',
        estado: 'Activo',
        fechaSalida: null,
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: ANIMAL_BECERRO,
        idAnimal: ANIMAL_BECERRO,
        idRancho: RANCH_ID,
        idLote: LOT_NORTE,
        arete: 'MX-002',
        raza: 'Angus',
        sexo: 'Macho',
        fechaNacimiento: '2026-05-15', // 6m -> Becerro
        fechaIngreso: '2026-05-15',
        procedencia: 'Nacimiento en rancho',
        estado: 'Activo',
        fechaSalida: null,
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: ANIMAL_NOVILLA,
        idAnimal: ANIMAL_NOVILLA,
        idRancho: RANCH_ID,
        idLote: LOT_SUR,
        arete: 'MX-003',
        raza: 'Suizo',
        sexo: 'Hembra',
        fechaNacimiento: '2025-04-01', // 19m -> Novilla
        fechaIngreso: '2025-05-01',
        procedencia: 'Compra',
        estado: 'Vendido',
        fechaSalida: '2026-11-15',
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: ANIMAL_SIN_LOTE,
        idAnimal: ANIMAL_SIN_LOTE,
        idRancho: RANCH_ID,
        idLote: null,
        arete: 'MX-004',
        raza: 'Cruzado',
        sexo: 'Macho',
        fechaNacimiento: null, // Sin fecha -> Macho (sin fecha nac.)
        fechaIngreso: '2026-10-01',
        procedencia: 'Compra',
        estado: 'Activo',
        fechaSalida: null,
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      }
    ],
    lots: [
      {
        id: LOT_NORTE,
        idLote: LOT_NORTE,
        idRancho: RANCH_ID,
        nombre: 'Potrero Norte',
        ubicacion: 'Sector A',
        estado: 'Activo',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced',
        activeAnimalsCount: 2
      },
      {
        id: LOT_SUR,
        idLote: LOT_SUR,
        idRancho: RANCH_ID,
        nombre: 'Potrero Sur',
        ubicacion: 'Sector B',
        estado: 'Activo',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced',
        activeAnimalsCount: 1
      }
    ],
    weighings: [
      {
        id: 'w-1',
        idPesaje: 'w-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_VACA,
        pesoRealKg: 420,
        fecha: '2026-10-01T08:00:00Z',
        fuenteBascula: 'Báscula Principal',
        responsable: 'Carlos',
        observaciones: null,
        origenPesaje: 'manual',
        sourceAnalysisJobId: null,
        sourceMediaId: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      },
      {
        id: 'w-2',
        idPesaje: 'w-2',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_VACA,
        pesoRealKg: 450,
        fecha: '2026-11-01T08:00:00Z',
        fuenteBascula: 'Báscula Principal',
        responsable: 'Carlos',
        observaciones: null,
        origenPesaje: 'manual',
        sourceAnalysisJobId: null,
        sourceMediaId: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      },
      {
        id: 'w-3',
        idPesaje: 'w-3',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_BECERRO,
        pesoRealKg: 150,
        fecha: '2026-11-10T08:00:00Z',
        fuenteBascula: 'Báscula Principal',
        responsable: 'Carlos',
        observaciones: null,
        origenPesaje: 'manual',
        sourceAnalysisJobId: null,
        sourceMediaId: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      }
    ],
    healthEvents: [
      {
        id: 'h-1',
        idEventoSanitario: 'h-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_VACA,
        tipo: 'Vacunación',
        fecha: '2026-10-15T09:00:00Z',
        sintomas: null,
        diagnostico: 'Refuerzo anual',
        profesionalDiagnostico: 'MVZ Ana',
        evidenciaDiagnosticoUri: null,
        responsable: 'MVZ Ana',
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: 'h-2',
        idEventoSanitario: 'h-2',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_NOVILLA,
        tipo: 'Desparasitación',
        fecha: '2026-11-12T09:00:00Z',
        sintomas: null,
        diagnostico: 'Control interno',
        profesionalDiagnostico: 'MVZ Ana',
        evidenciaDiagnosticoUri: null,
        responsable: 'MVZ Ana',
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    treatments: [
      {
        id: 't-1',
        idTratamiento: 't-1',
        idRancho: RANCH_ID,
        idEventoSanitario: 'h-1',
        idAnimal: ANIMAL_VACA,
        producto: 'Antibiótico X',
        dosis: 10,
        unidadDosis: 'mL',
        viaAdministracion: 'Intramuscular',
        frecuencia: 'Cada 24h',
        fechaInicio: '2026-10-15',
        fechaFin: '2026-10-20',
        responsable: 'MVZ Ana',
        prescripcionUri: null,
        estado: 'Pendiente',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: 't-2',
        idTratamiento: 't-2',
        idRancho: RANCH_ID,
        idEventoSanitario: 'h-2',
        idAnimal: ANIMAL_NOVILLA,
        producto: 'Ivermectina',
        dosis: 8,
        unidadDosis: 'mL',
        viaAdministracion: 'Subcutánea',
        frecuencia: 'Dosis única',
        fechaInicio: '2026-11-12',
        fechaFin: '2026-11-12',
        responsable: 'MVZ Ana',
        prescripcionUri: null,
        estado: 'Completado',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: 't-3',
        idTratamiento: 't-3',
        idRancho: RANCH_ID,
        idEventoSanitario: 'h-2',
        idAnimal: ANIMAL_NOVILLA,
        producto: 'Vitamina AD3E',
        dosis: 5,
        unidadDosis: 'mL',
        viaAdministracion: 'Intramuscular',
        frecuencia: 'Cada 48h',
        fechaInicio: '2026-11-14',
        fechaFin: null,
        responsable: 'MVZ Ana',
        prescripcionUri: null,
        estado: 'En curso',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    feedingRecords: [
      {
        id: 'f-1',
        idAlimentacion: 'f-1',
        idRancho: RANCH_ID,
        targetType: 'lote',
        idAnimal: null,
        idLote: LOT_NORTE,
        alimento: 'Silo de Maíz',
        racion: 'Mañana',
        cantidad: 120,
        unidad: 'kg',
        frecuencia: 'Diaria',
        inicio: '2026-11-05T07:00:00Z',
        fin: null,
        cambioDieta: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: 'f-2',
        idAlimentacion: 'f-2',
        idRancho: RANCH_ID,
        targetType: 'animal',
        idAnimal: ANIMAL_NOVILLA,
        idLote: null,
        alimento: 'Concentrado 18%',
        racion: 'Tarde',
        cantidad: 4.5,
        unidad: 'kg',
        frecuencia: 'Diaria',
        inicio: '2026-11-11T16:00:00Z',
        fin: null,
        cambioDieta: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    reproductionEvents: [
      {
        id: 'r-1',
        idEventoReproductivo: 'r-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_VACA,
        tipo: 'Inseminación Artificial',
        fecha: '2026-11-02T10:00:00Z',
        resultado: 'Pendiente',
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      },
      {
        id: 'r-2',
        idEventoReproductivo: 'r-2',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_NOVILLA,
        tipo: 'Celo',
        fecha: '2026-10-20T10:00:00Z',
        resultado: 'Detectado',
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      }
    ],
    movements: [
      {
        id: 'm-1',
        idMovimiento: 'm-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_VACA,
        idLoteOrigen: LOT_SUR,
        idLoteDestino: LOT_NORTE,
        tipo: 'CambioInterno',
        fecha: '2026-10-05T09:00:00Z',
        origenExterno: null,
        destinoExterno: null,
        motivo: 'Rotación de pastura',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      },
      {
        id: 'm-2',
        idMovimiento: 'm-2',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_NOVILLA,
        idLoteOrigen: LOT_SUR,
        idLoteDestino: null,
        tipo: 'Venta',
        fecha: '2026-11-15T11:00:00Z',
        origenExterno: null,
        destinoExterno: 'Comprador Regional',
        motivo: 'Venta directa',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    dataSource: 'server',
    isOffline: false,
    warnings: [],
    loadedAt: now
  };
}

describe('ReportsService — Cálculos reales, filtros y exportación', () => {
  it('clasifica categorías zootécnicas de forma determinística según sexo y fechaNacimiento', () => {
    expect(classifyAnimalCategory({ sexo: 'Hembra', fechaNacimiento: '2023-01-01' }, REF_DATE)).toBe(
      'Vaca'
    );
    expect(classifyAnimalCategory({ sexo: 'Hembra', fechaNacimiento: '2025-03-01' }, REF_DATE)).toBe(
      'Novilla'
    );
    expect(classifyAnimalCategory({ sexo: 'Hembra', fechaNacimiento: '2026-06-01' }, REF_DATE)).toBe(
      'Becerra'
    );
    expect(classifyAnimalCategory({ sexo: 'Macho', fechaNacimiento: '2022-01-01' }, REF_DATE)).toBe(
      'Toro'
    );
    expect(classifyAnimalCategory({ sexo: 'Macho', fechaNacimiento: '2025-04-01' }, REF_DATE)).toBe(
      'Novillo'
    );
    expect(classifyAnimalCategory({ sexo: 'Macho', fechaNacimiento: '2026-07-01' }, REF_DATE)).toBe(
      'Becerro'
    );
    expect(classifyAnimalCategory({ sexo: 'Hembra', fechaNacimiento: null }, REF_DATE)).toBe(
      'Hembra (sin fecha nac.)'
    );
    expect(classifyAnimalCategory({ sexo: 'Macho', fechaNacimiento: null }, REF_DATE)).toBe(
      'Macho (sin fecha nac.)'
    );
  });

  it('calcula totales exactos coincidentes con los registros reales sin filtros', () => {
    const dataset = buildFixtureDataset();
    const result = ReportsService.computeReports(dataset, INITIAL_REPORT_FILTERS, REF_DATE);

    expect(result.kpis.totalAnimales).toBe(4);
    expect(result.kpis.animalesActivos).toBe(3);
    expect(result.kpis.animalesVendidos).toBe(1);
    expect(result.kpis.animalesBaja).toBe(0);

    // Suma de categorías === total de animales
    expect(result.porCategoria.reduce((s, x) => s + x.count, 0)).toBe(4);
    // Suma de potreros === total de animales (2 Norte, 1 Sur, 1 Sin potrero)
    expect(result.porPotrero.reduce((s, x) => s + x.count, 0)).toBe(4);
    expect(result.porPotrero.find((p) => p.key === LOT_NORTE)?.count).toBe(2);
    expect(result.porPotrero.find((p) => p.key === LOT_SUR)?.count).toBe(1);
    expect(result.porPotrero.find((p) => p.key === UNASSIGNED_LOT_FILTER_VALUE)?.count).toBe(1);

    // Pesajes: 3 registros; último peso por animal: Vaca=450, Becerro=150 -> promedio = 300.0
    expect(result.kpis.totalPesajes).toBe(3);
    expect(result.kpis.pesoPromedioKg).toBe(300);

    // Sanidad y tratamientos pendientes (Pendiente + En curso = 2; Completado excluido)
    expect(result.kpis.eventosSanitarios).toBe(2);
    expect(result.kpis.tratamientosPendientes).toBe(2);

    // Alimentación (1 lote + 1 animal = 2; 120 + 4.5 = 124.5 kg)
    expect(result.kpis.actividadesAlimentacion).toBe(2);
    expect(result.alimentacion.porLote).toBe(1);
    expect(result.alimentacion.porAnimal).toBe(1);
    expect(result.alimentacion.totalCantidadKg).toBe(124.5);

    // Reproducción y Movimientos
    expect(result.kpis.eventosReproductivos).toBe(2);
    expect(result.kpis.movimientosRegistrados).toBe(2);
  });

  it('filtra correctamente por rango de fechas, animal, categoría y potrero', () => {
    const dataset = buildFixtureDataset();

    // Filtro por rango de fechas (noviembre 2026)
    const novReport = ReportsService.computeReports(
      dataset,
      { ...INITIAL_REPORT_FILTERS, fechaDesde: '2026-11-01', fechaHasta: '2026-11-30' },
      REF_DATE
    );
    expect(novReport.kpis.totalPesajes).toBe(2); // w-2 (Nov 1) y w-3 (Nov 10)
    expect(novReport.kpis.eventosSanitarios).toBe(1); // h-2 (Nov 12)
    expect(novReport.kpis.tratamientosPendientes).toBe(1); // t-3 (Nov 14, En curso)
    expect(novReport.kpis.actividadesAlimentacion).toBe(2); // f-1 y f-2 en Nov
    expect(novReport.kpis.eventosReproductivos).toBe(1); // r-1 (Nov 2)
    expect(novReport.kpis.movimientosRegistrados).toBe(1); // m-2 (Nov 15)

    // Filtro por animal específico (ANIMAL_VACA en LOT_NORTE)
    const vacaReport = ReportsService.computeReports(
      dataset,
      { ...INITIAL_REPORT_FILTERS, animalId: ANIMAL_VACA },
      REF_DATE
    );
    expect(vacaReport.kpis.totalAnimales).toBe(1);
    expect(vacaReport.kpis.totalPesajes).toBe(2);
    expect(vacaReport.kpis.eventosSanitarios).toBe(1);
    expect(vacaReport.kpis.tratamientosPendientes).toBe(1);
    expect(vacaReport.kpis.actividadesAlimentacion).toBe(1); // incluye alimentación de LOT_NORTE
    expect(vacaReport.kpis.eventosReproductivos).toBe(1);
    expect(vacaReport.kpis.movimientosRegistrados).toBe(1);

    // Filtro por categoría (Novilla)
    const novillaReport = ReportsService.computeReports(
      dataset,
      { ...INITIAL_REPORT_FILTERS, categoria: 'Novilla' },
      REF_DATE
    );
    expect(novillaReport.kpis.totalAnimales).toBe(1);
    expect(novillaReport.kpis.eventosSanitarios).toBe(1);
    expect(novillaReport.kpis.tratamientosPendientes).toBe(1);
    expect(novillaReport.kpis.actividadesAlimentacion).toBe(1);

    // Filtro por potrero sin asignar
    const unassignedReport = ReportsService.computeReports(
      dataset,
      { ...INITIAL_REPORT_FILTERS, potreroId: UNASSIGNED_LOT_FILTER_VALUE },
      REF_DATE
    );
    expect(unassignedReport.kpis.totalAnimales).toBe(1);
    expect(unassignedReport.filteredAnimals[0].arete).toBe('MX-004');
  });

  it('genera exportaciones CSV y JSON con las cifras reales exactas y metadatos de dependencias Backend', () => {
    const dataset = buildFixtureDataset();
    const reports = ReportsService.computeReports(dataset, INITIAL_REPORT_FILTERS, REF_DATE);

    const resumenCsv = buildReportCsv('resumen', reports, INITIAL_REPORT_FILTERS);
    expect(resumenCsv.content).toContain('"Total de animales","4"');
    expect(resumenCsv.content).toContain('"Tratamientos pendientes","2"');
    expect(resumenCsv.content).toContain('"Movimientos registrados","2"');

    const animalesCsv = buildReportCsv('animales', reports, INITIAL_REPORT_FILTERS);
    expect(animalesCsv.rowCount).toBe(4);
    expect(animalesCsv.content).toContain('"MX-001","Vaca","Potrero Norte"');

    const jsonOut = buildReportJson(reports, INITIAL_REPORT_FILTERS, {
      dataSource: dataset.dataSource,
      isOffline: false,
      loadedAt: dataset.loadedAt
    });
    const parsed = JSON.parse(jsonOut.content) as {
      indicadores: { totalAnimales: number; tratamientosPendientes: number };
      dependenciasBackendPendientes: unknown[];
    };
    expect(parsed.indicadores.totalAnimales).toBe(4);
    expect(parsed.indicadores.tratamientosPendientes).toBe(2);
    expect(parsed.dependenciasBackendPendientes.length).toBeGreaterThan(0);
  });
});
