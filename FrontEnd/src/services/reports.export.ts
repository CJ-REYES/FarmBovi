import {
  REPORT_BACKEND_DEPENDENCIES,
  type ComputedReports,
  type ReportExportSection,
  type ReportFilters
} from '../types/reports';

export const REPORT_EXPORT_SECTIONS: readonly {
  value: ReportExportSection;
  label: string;
}[] = [
  { value: 'resumen', label: 'Resumen ejecutivo de indicadores' },
  { value: 'animales', label: 'Padrón de animales filtrados' },
  { value: 'pesajes', label: 'Historial de pesajes reales' },
  { value: 'sanidad', label: 'Eventos sanitarios' },
  { value: 'tratamientos_pendientes', label: 'Tratamientos pendientes' },
  { value: 'alimentacion', label: 'Actividades de alimentación' },
  { value: 'reproduccion', label: 'Eventos reproductivos' },
  { value: 'movimientos', label: 'Movimientos registrados' }
] as const;

export function escapeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = raw.replace(/"/g, '""');
  return `"${safe}"`;
}

function toCsvLine(cells: Array<string | number | null | undefined>): string {
  return cells.map(escapeCsvCell).join(',');
}

export function buildReportCsv(
  section: ReportExportSection,
  reports: ComputedReports,
  filters: ReportFilters
): { filename: string; content: string; rowCount: number } {
  const dateStamp = new Date().toISOString().split('T')[0];

  if (section === 'resumen') {
    const lines: string[] = [
      toCsvLine(['Seccion', 'Indicador', 'Valor', 'Detalle']),
      toCsvLine(['Filtros', 'Fecha desde', filters.fechaDesde || 'Sin límite', '']),
      toCsvLine(['Filtros', 'Fecha hasta', filters.fechaHasta || 'Sin límite', '']),
      toCsvLine([
        'Filtros',
        'Animal',
        filters.animalId ? reports.animalAreteById[filters.animalId] || filters.animalId : 'Todos',
        ''
      ]),
      toCsvLine(['Filtros', 'Categoría', filters.categoria || 'Todas', '']),
      toCsvLine([
        'Filtros',
        'Potrero',
        filters.potreroId
          ? reports.lotNameById[filters.potreroId] || filters.potreroId
          : 'Todos',
        ''
      ]),
      toCsvLine([
        'KPI',
        'Total de animales',
        reports.kpis.totalAnimales,
        `Activos: ${reports.kpis.animalesActivos} | Vendidos: ${reports.kpis.animalesVendidos} | Baja: ${reports.kpis.animalesBaja}`
      ]),
      toCsvLine([
        'KPI',
        'Pesajes reales registrados',
        reports.kpis.totalPesajes,
        reports.kpis.pesoPromedioKg !== null
          ? `Peso promedio más reciente: ${reports.kpis.pesoPromedioKg} kg`
          : 'Sin pesajes en rango'
      ]),
      toCsvLine(['KPI', 'Eventos sanitarios', reports.kpis.eventosSanitarios, '']),
      toCsvLine(['KPI', 'Tratamientos pendientes', reports.kpis.tratamientosPendientes, '']),
      toCsvLine([
        'KPI',
        'Actividades de alimentación',
        reports.kpis.actividadesAlimentacion,
        `Por lote: ${reports.alimentacion.porLote} | Por animal: ${reports.alimentacion.porAnimal}`
      ]),
      toCsvLine(['KPI', 'Eventos reproductivos', reports.kpis.eventosReproductivos, '']),
      toCsvLine(['KPI', 'Movimientos registrados', reports.kpis.movimientosRegistrados, '']),
      ...reports.porCategoria.map((item) =>
        toCsvLine(['Animales por categoría', item.label, item.count, `${item.percentage}%`])
      ),
      ...reports.porPotrero.map((item) =>
        toCsvLine(['Animales por potrero', item.label, item.count, `${item.percentage}%`])
      )
    ];

    return {
      filename: `FarmBovi_Resumen_Reportes_${dateStamp}.csv`,
      content: `\uFEFF${lines.join('\n')}`,
      rowCount: lines.length - 1
    };
  }

  if (section === 'animales') {
    const header = toCsvLine([
      'ID Animal',
      'Arete',
      'Categoría',
      'Potrero',
      'Raza',
      'Sexo',
      'Fecha Nacimiento',
      'Fecha Ingreso',
      'Procedencia',
      'Estado'
    ]);
    const rows = reports.filteredAnimals.map((a) =>
      toCsvLine([
        a.idAnimal,
        a.arete,
        reports.animalCategoryById[a.id] || 'Sin clasificar',
        a.idLote ? reports.lotNameById[a.idLote] || a.idLote : 'Sin potrero asignado',
        a.raza,
        a.sexo,
        a.fechaNacimiento || '',
        a.fechaIngreso,
        a.procedencia,
        a.estado
      ])
    );
    return {
      filename: `FarmBovi_Animales_${dateStamp}.csv`,
      content: `\uFEFF${[header, ...rows].join('\n')}`,
      rowCount: rows.length
    };
  }

  if (section === 'pesajes') {
    const header = toCsvLine([
      'ID Pesaje',
      'Arete',
      'Fecha',
      'Peso Real (kg)',
      'Fuente Báscula',
      'Responsable',
      'Observaciones'
    ]);
    const rows = reports.filteredWeighings.map((w) =>
      toCsvLine([
        w.idPesaje,
        reports.animalAreteById[w.idAnimal] || w.idAnimal,
        w.fecha,
        w.pesoRealKg,
        w.fuenteBascula,
        w.responsable,
        w.observaciones || ''
      ])
    );
    return {
      filename: `FarmBovi_Pesajes_${dateStamp}.csv`,
      content: `\uFEFF${[header, ...rows].join('\n')}`,
      rowCount: rows.length
    };
  }

  if (section === 'sanidad') {
    const header = toCsvLine([
      'ID Evento',
      'Arete',
      'Tipo',
      'Fecha',
      'Síntomas',
      'Diagnóstico',
      'Responsable',
      'Observaciones'
    ]);
    const rows = reports.filteredHealthEvents.map((ev) =>
      toCsvLine([
        ev.idEventoSanitario,
        reports.animalAreteById[ev.idAnimal] || ev.idAnimal,
        ev.tipo,
        ev.fecha,
        ev.sintomas || '',
        ev.diagnostico || '',
        ev.responsable,
        ev.observaciones || ''
      ])
    );
    return {
      filename: `FarmBovi_Eventos_Sanitarios_${dateStamp}.csv`,
      content: `\uFEFF${[header, ...rows].join('\n')}`,
      rowCount: rows.length
    };
  }

  if (section === 'tratamientos_pendientes') {
    const header = toCsvLine([
      'ID Tratamiento',
      'Arete',
      'Producto',
      'Dosis',
      'Unidad',
      'Frecuencia',
      'Fecha Inicio',
      'Fecha Fin',
      'Estado',
      'Responsable'
    ]);
    const rows = reports.tratamientosPendientesLista.map((t) =>
      toCsvLine([
        t.idTratamiento,
        reports.animalAreteById[t.idAnimal] || t.idAnimal,
        t.producto,
        t.dosis,
        t.unidadDosis,
        t.frecuencia,
        t.fechaInicio,
        t.fechaFin || '',
        t.estado,
        t.responsable
      ])
    );
    return {
      filename: `FarmBovi_Tratamientos_Pendientes_${dateStamp}.csv`,
      content: `\uFEFF${[header, ...rows].join('\n')}`,
      rowCount: rows.length
    };
  }

  if (section === 'alimentacion') {
    const header = toCsvLine([
      'ID Alimentación',
      'Objetivo',
      'Animal / Potrero',
      'Alimento',
      'Ración',
      'Cantidad',
      'Unidad',
      'Frecuencia',
      'Inicio',
      'Fin',
      'Cambio Dieta'
    ]);
    const rows = reports.filteredFeeding.map((f) =>
      toCsvLine([
        f.idAlimentacion,
        f.targetType === 'lote' ? 'Potrero/Lote' : 'Animal',
        f.idAnimal
          ? reports.animalAreteById[f.idAnimal] || f.idAnimal
          : f.idLote
            ? reports.lotNameById[f.idLote] || f.idLote
            : '',
        f.alimento,
        f.racion,
        f.cantidad,
        f.unidad,
        f.frecuencia,
        f.inicio,
        f.fin || '',
        f.cambioDieta || ''
      ])
    );
    return {
      filename: `FarmBovi_Alimentacion_${dateStamp}.csv`,
      content: `\uFEFF${[header, ...rows].join('\n')}`,
      rowCount: rows.length
    };
  }

  if (section === 'reproduccion') {
    const header = toCsvLine([
      'ID Evento',
      'Arete',
      'Tipo',
      'Fecha',
      'Resultado',
      'Observaciones'
    ]);
    const rows = reports.filteredReproduction.map((r) =>
      toCsvLine([
        r.idEventoReproductivo,
        reports.animalAreteById[r.idAnimal] || r.idAnimal,
        r.tipo,
        r.fecha,
        r.resultado || '',
        r.observaciones || ''
      ])
    );
    return {
      filename: `FarmBovi_Reproduccion_${dateStamp}.csv`,
      content: `\uFEFF${[header, ...rows].join('\n')}`,
      rowCount: rows.length
    };
  }

  // movimientos
  const header = toCsvLine([
    'ID Movimiento',
    'Arete',
    'Tipo',
    'Fecha',
    'Potrero Origen',
    'Potrero Destino',
    'Origen Externo',
    'Destino Externo',
    'Motivo'
  ]);
  const rows = reports.filteredMovements.map((m) =>
    toCsvLine([
      m.idMovimiento,
      reports.animalAreteById[m.idAnimal] || m.idAnimal,
      m.tipo,
      m.fecha,
      m.idLoteOrigen ? reports.lotNameById[m.idLoteOrigen] || m.idLoteOrigen : '',
      m.idLoteDestino ? reports.lotNameById[m.idLoteDestino] || m.idLoteDestino : '',
      m.origenExterno || '',
      m.destinoExterno || '',
      m.motivo || ''
    ])
  );
  return {
    filename: `FarmBovi_Movimientos_${dateStamp}.csv`,
    content: `\uFEFF${[header, ...rows].join('\n')}`,
    rowCount: rows.length
  };
}

export function buildReportJson(
  reports: ComputedReports,
  filters: ReportFilters,
  meta: { dataSource: string; isOffline: boolean; loadedAt: string }
): { filename: string; content: string } {
  const dateStamp = new Date().toISOString().split('T')[0];
  const payload = {
    generadoEn: new Date().toISOString(),
    fuenteDatos: meta.dataSource,
    modoOffline: meta.isOffline,
    cargadoEn: meta.loadedAt,
    filtrosAplicados: filters,
    indicadores: reports.kpis,
    distribuciones: {
      porCategoria: reports.porCategoria,
      porPotrero: reports.porPotrero,
      porSexo: reports.porSexo,
      porEstado: reports.porEstado,
      sanidadPorTipo: reports.sanidadPorTipo,
      alimentacionPorAlimento: reports.alimentacion.porAlimento,
      reproduccionPorTipo: reports.reproduccionPorTipo,
      movimientosPorTipo: reports.movimientosPorTipo
    },
    evolucionPeso: {
      totalPesajes: reports.evolucionPeso.totalWeighings,
      pesoPromedioMasRecienteKg: reports.evolucionPeso.averageLatestWeightKg,
      pesoMinimoKg: reports.evolucionPeso.minWeightKg,
      pesoMaximoKg: reports.evolucionPeso.maxWeightKg,
      gdpPromedioKgDia: reports.evolucionPeso.averageGdpKgDay,
      serie: reports.evolucionPeso.evolutionPoints
    },
    dependenciasBackendPendientes: REPORT_BACKEND_DEPENDENCIES
  };

  return {
    filename: `FarmBovi_Reportes_${dateStamp}.json`,
    content: JSON.stringify(payload, null, 2)
  };
}

export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
