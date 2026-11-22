import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  BarChart2,
  Beef,
  Calendar,
  Database,
  Download,
  FileJson,
  FileText,
  Filter,
  HeartPulse,
  Info,
  Layers,
  Loader2,
  MapPin,
  PieChart,
  RefreshCw,
  Scale,
  Syringe,
  User,
  Wheat,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { useConnectivity } from '../../hooks/useConnectivity';
import {
  buildReportCsv,
  buildReportJson,
  REPORT_EXPORT_SECTIONS,
  triggerFileDownload
} from '../../services/reports.export';
import { ReportsPdfService, type PdfReportType } from '../../services/reports.pdf';
import { ReportsService } from '../../services/reports.service';
import {
  INITIAL_REPORT_FILTERS,
  REPORT_BACKEND_DEPENDENCIES,
  REPORT_CATEGORIES,
  UNASSIGNED_LOT_FILTER_VALUE,
  type ReportDataset,
  type ReportExportSection,
  type ReportFilters
} from '../../types/reports';
import EmptyState from '../ui/EmptyState';
import { DonutDistributionChart, HorizontalBarChart } from './ReportCharts';
import WeightEvolutionChart from './WeightEvolutionChart';

function formatShortDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  return parsed.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const { isOnline } = useConnectivity();

  const [dataset, setDataset] = useState<ReportDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReportFilters>(INITIAL_REPORT_FILTERS);
  const [exportSection, setExportSection] = useState<ReportExportSection>('resumen');
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [pdfAnimalId, setPdfAnimalId] = useState<string>('');
  const [pdfLotId, setPdfLotId] = useState<string>('');
  const [generatingPdf, setGeneratingPdf] = useState<PdfReportType | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await ReportsService.loadDataset({ includeDeleted: false });
        if (active) {
          setDataset(next);
          setErrorMsg(null);
        }
      } catch (err) {
        if (active) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'No fue posible cargar la información para los reportes.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setErrorMsg(null);
    setRefreshTick((prev) => prev + 1);
  }, []);

  const dateRangeInvalid = Boolean(
    filters.fechaDesde && filters.fechaHasta && filters.fechaDesde > filters.fechaHasta
  );

  const reports = useMemo(() => {
    if (!dataset) return null;
    const effectiveFilters: ReportFilters = dateRangeInvalid
      ? { ...filters, fechaDesde: '', fechaHasta: '' }
      : filters;
    return ReportsService.computeReports(dataset, effectiveFilters);
  }, [dataset, filters, dateRangeInvalid]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.fechaDesde) count += 1;
    if (filters.fechaHasta) count += 1;
    if (filters.animalId) count += 1;
    if (filters.categoria) count += 1;
    if (filters.potreroId) count += 1;
    return count;
  }, [filters]);

  const hasAnyRealData = useMemo(() => {
    if (!dataset) return false;
    return (
      dataset.cattle.length > 0 ||
      dataset.weighings.length > 0 ||
      dataset.healthEvents.length > 0 ||
      dataset.treatments.length > 0 ||
      dataset.feedingRecords.length > 0 ||
      dataset.reproductionEvents.length > 0 ||
      dataset.movements.length > 0
    );
  }, [dataset]);

  const handleExportCsv = () => {
    if (!reports) return;
    const { filename, content, rowCount } = buildReportCsv(exportSection, reports, filters);
    triggerFileDownload(filename, content, 'text/csv;charset=utf-8;');
    setExportFeedback(`Archivo CSV descargado (${filename} · ${rowCount} filas).`);
  };

  const handleExportJson = () => {
    if (!reports || !dataset) return;
    const { filename, content } = buildReportJson(reports, filters, {
      dataSource: dataset.dataSource,
      isOffline: !isOnline || dataset.isOffline,
      loadedAt: dataset.loadedAt
    });
    triggerFileDownload(filename, content, 'application/json;charset=utf-8;');
    setExportFeedback(`Reporte JSON descargado (${filename}).`);
  };

  const effectivePdfAnimalId = pdfAnimalId || filters.animalId || dataset?.cattle[0]?.id || '';
  const effectivePdfLotId =
    pdfLotId ||
    filters.potreroId ||
    dataset?.lots[0]?.idLote ||
    (dataset && dataset.cattle.some((c) => !c.idLote) ? UNASSIGNED_LOT_FILTER_VALUE : '');

  const selectedLotAnimalCount = useMemo(() => {
    if (!dataset || !effectivePdfLotId) return 0;
    if (effectivePdfLotId === UNASSIGNED_LOT_FILTER_VALUE) {
      return dataset.cattle.filter((c) => !c.idLote).length;
    }
    return dataset.cattle.filter((c) => c.idLote === effectivePdfLotId).length;
  }, [dataset, effectivePdfLotId]);

  const handleGeneratePdf = async (type: PdfReportType) => {
    if (!dataset) return;
    setGeneratingPdf(type);
    setPdfError(null);
    setExportFeedback(null);

    const effectiveFilters: ReportFilters = dateRangeInvalid
      ? { ...filters, fechaDesde: '', fechaHasta: '' }
      : filters;

    try {
      let result;
      if (type === 'individual') {
        if (!effectivePdfAnimalId) {
          throw new Error('Selecciona un bovino para generar el reporte individual en PDF.');
        }
        result = await ReportsPdfService.generateIndividualAnimalPdf(
          dataset,
          effectivePdfAnimalId,
          effectiveFilters
        );
      } else if (type === 'lote') {
        if (!effectivePdfLotId) {
          throw new Error('Selecciona un lote o potrero para generar el reporte por lote en PDF.');
        }
        result = await ReportsPdfService.generateLotReportPdf(
          dataset,
          effectivePdfLotId,
          effectiveFilters
        );
      } else {
        result = await ReportsPdfService.generateGeneralReportPdf(dataset, effectiveFilters);
      }

      ReportsPdfService.downloadPdfResult(result);
      setExportFeedback(
        `PDF generado y descargado (${result.filename} · ${result.pageCount} ${result.pageCount === 1 ? 'página' : 'páginas'}).`
      );
    } catch (err) {
      setPdfError(
        err instanceof Error ? err.message : 'No fue posible generar el archivo PDF.'
      );
    } finally {
      setGeneratingPdf(null);
    }
  };

  const clearFilters = () => {
    setFilters(INITIAL_REPORT_FILTERS);
    setExportFeedback(null);
    setPdfError(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-10">
      {/* Encabezado y controles de exportación */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Inteligencia Operativa · Datos Reales
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Reportes e Indicadores
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px]">
            {!isOnline || dataset?.isOffline ? (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-status-warning/20 border border-status-warning/40 text-amber-900 font-semibold"
              >
                <WifiOff size={13} /> Modo offline · Indicadores calculados desde IndexedDB
              </span>
            ) : dataset?.dataSource === 'server' ? (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-status-success/10 border border-status-success/25 text-status-success font-semibold"
              >
                <Wifi size={13} /> Datos sincronizados del servidor + caché local
              </span>
            ) : (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-secondary border border-border-light text-brand-slate font-semibold"
              >
                <Database size={13} className="text-brand-primary" /> Caché local IndexedDB activo
              </span>
            )}
            {dataset && (
              <span className="text-brand-slate/60">
                Actualizado: {new Date(dataset.loadedAt).toLocaleTimeString('es-MX')}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 h-[38px] rounded-lg bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate text-[13px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>

          <select
            aria-label="Sección a exportar en CSV"
            value={exportSection}
            onChange={(e) => setExportSection(e.target.value as ReportExportSection)}
            disabled={loading || !reports}
            className="h-[38px] px-3 rounded-lg bg-surface-white border border-border-light text-[13px] font-medium text-brand-slate outline-none focus:border-brand-primary"
          >
            {REPORT_EXPORT_SECTIONS.map((sec) => (
              <option key={sec.value} value={sec.value}>
                {sec.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loading || !reports || !hasAnyRealData}
            className="inline-flex items-center gap-1.5 px-3.5 h-[38px] rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download size={15} />
            <span>Exportar CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            disabled={loading || !reports || !hasAnyRealData}
            className="inline-flex items-center gap-1.5 px-3 h-[38px] rounded-lg bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate text-[13px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <FileJson size={15} />
            <span>JSON</span>
          </button>
        </div>
      </header>

      {exportFeedback && (
        <div
          role="status"
          className="p-3 rounded-xl bg-status-success/10 border border-status-success/30 text-status-success text-[13px] flex items-center justify-between gap-2"
        >
          <span>{exportFeedback}</span>
          <button
            type="button"
            onClick={() => setExportFeedback(null)}
            aria-label="Cerrar aviso de exportación"
            className="p-1 hover:bg-status-success/10 rounded cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Barra de Filtros */}
      <section
        aria-label="Filtros de reportes"
        className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-bold text-brand-slate">
            <Filter size={15} className="text-brand-primary" />
            <span>Filtros analíticos</span>
            {activeFiltersCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary text-[11px] font-bold">
                {activeFiltersCount} activo{activeFiltersCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-slate/70 hover:text-brand-primary cursor-pointer"
            >
              <X size={13} /> Limpiar filtros
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label
              htmlFor="report-filter-from"
              className="block text-[11px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
            >
              Fecha desde
            </label>
            <div className="relative">
              <Calendar
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40 pointer-events-none"
              />
              <input
                id="report-filter-from"
                type="date"
                value={filters.fechaDesde}
                onChange={(e) => setFilters((prev) => ({ ...prev, fechaDesde: e.target.value }))}
                className="w-full h-[38px] pl-9 pr-3 rounded-lg bg-surface-app border border-border-light text-[13px] text-brand-slate outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="report-filter-to"
              className="block text-[11px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
            >
              Fecha hasta
            </label>
            <div className="relative">
              <Calendar
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40 pointer-events-none"
              />
              <input
                id="report-filter-to"
                type="date"
                value={filters.fechaHasta}
                onChange={(e) => setFilters((prev) => ({ ...prev, fechaHasta: e.target.value }))}
                className="w-full h-[38px] pl-9 pr-3 rounded-lg bg-surface-app border border-border-light text-[13px] text-brand-slate outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="report-filter-animal"
              className="block text-[11px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
            >
              Animal
            </label>
            <select
              id="report-filter-animal"
              value={filters.animalId}
              onChange={(e) => setFilters((prev) => ({ ...prev, animalId: e.target.value }))}
              className="w-full h-[38px] px-3 rounded-lg bg-surface-app border border-border-light text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="">Todos los animales</option>
              {(dataset?.cattle ?? []).map((animal) => (
                <option key={animal.id} value={animal.id}>
                  {animal.arete} — {animal.raza} ({animal.sexo})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="report-filter-category"
              className="block text-[11px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
            >
              Categoría
            </label>
            <select
              id="report-filter-category"
              value={filters.categoria}
              onChange={(e) => setFilters((prev) => ({ ...prev, categoria: e.target.value }))}
              className="w-full h-[38px] px-3 rounded-lg bg-surface-app border border-border-light text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="">Todas las categorías</option>
              {REPORT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="report-filter-lot"
              className="block text-[11px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
            >
              Potrero / Lote
            </label>
            <select
              id="report-filter-lot"
              value={filters.potreroId}
              onChange={(e) => setFilters((prev) => ({ ...prev, potreroId: e.target.value }))}
              className="w-full h-[38px] px-3 rounded-lg bg-surface-app border border-border-light text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="">Todos los potreros</option>
              <option value={UNASSIGNED_LOT_FILTER_VALUE}>Sin potrero asignado</option>
              {(dataset?.lots ?? []).map((lot) => (
                <option key={lot.id} value={lot.idLote}>
                  {lot.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {dateRangeInvalid && (
          <div
            role="alert"
            className="p-2.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-[12px] flex items-center gap-2"
          >
            <AlertCircle size={15} className="shrink-0" />
            <span>
              La fecha inicial no puede ser posterior a la fecha final. Ajusta el rango para aplicar
              el filtro de fechas.
            </span>
          </div>
        )}
      </section>

      {/* Estado de carga */}
      {loading && (
        <div
          role="status"
          className="bg-surface-white border border-border-light rounded-xl p-12 text-center space-y-3"
        >
          <Loader2 size={28} className="animate-spin mx-auto text-brand-primary" />
          <p className="text-[14px] font-semibold text-brand-slate">
            Calculando indicadores desde los registros reales…
          </p>
        </div>
      )}

      {/* Estado de error crítico */}
      {!loading && errorMsg && (
        <div
          role="alert"
          className="bg-status-danger/10 border border-status-danger/30 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-status-danger shrink-0 mt-0.5" />
            <div>
              <h2 className="font-bold text-[15px] text-status-danger">
                No se pudieron cargar los reportes
              </h2>
              <p className="text-[13px] text-brand-slate/80 mt-0.5">{errorMsg}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-4 py-2 rounded-lg bg-brand-primary text-white text-[13px] font-semibold hover:bg-brand-dark shrink-0 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Advertencias parciales (ej. fallback a IndexedDB por red) */}
      {!loading && dataset && dataset.warnings.length > 0 && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-status-warning/15 border border-status-warning/35 text-amber-950 text-[12px] flex items-start gap-2.5"
        >
          <AlertCircle size={16} className="text-status-warning shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">Respaldo local aplicado en uno o más módulos:</p>
            <p className="text-brand-slate/80">{dataset.warnings[0]}</p>
          </div>
        </div>
      )}

      {/* Estado vacío global */}
      {!loading && !errorMsg && reports && !hasAnyRealData && (
        <div className="bg-surface-white border border-border-light rounded-xl p-10">
          <EmptyState
            title="Aún no hay registros para generar reportes"
            message="Registra animales, pesajes, eventos sanitarios, alimentación o movimientos para visualizar indicadores y gráficas reales. Nunca se muestran cifras ficticias."
            icon={BarChart2}
            actionLabel="Registrar primer animal"
            onAction={() => navigate('/cattle/new')}
          />
        </div>
      )}

      {/* Contenido principal de indicadores y gráficas reales */}
      {!loading && !errorMsg && reports && hasAnyRealData && (
        <>
          {/* Generador de Reportes Profesionales en PDF (Individual, Por Lote y General) */}
          <section
            aria-label="Generador de reportes en PDF"
            className="bg-surface-white border border-brand-primary/25 rounded-xl p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-light pb-3">
              <div>
                <h2 className="font-bold text-[16px] text-brand-forest flex items-center gap-2">
                  <FileText size={18} className="text-brand-primary" /> Reportes Profesionales en PDF
                </h2>
                <p className="text-[12px] text-brand-slate/70 mt-0.5">
                  Incluye foto de perfil del bovino, datos base, genética, árbol genealógico y
                  gráficas vectoriales de evolución de peso, alimentación, sanidad, reproducción y
                  movimientos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleGeneratePdf('general')}
                disabled={generatingPdf !== null}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 h-[38px] rounded-lg bg-surface-white border border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white text-[13px] font-semibold transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {generatingPdf === 'general' ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Generando PDF...
                  </>
                ) : (
                  <>
                    <FileText size={15} /> PDF General del Hato
                  </>
                )}
              </button>
            </div>

            {pdfError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-[12px] flex items-center gap-2"
              >
                <AlertCircle size={15} className="shrink-0" />
                <span>{pdfError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Reporte Individual en PDF */}
              <div className="p-4 rounded-xl bg-surface-app border border-border-light space-y-3">
                <div className="flex items-center gap-2 text-brand-forest font-bold text-[14px]">
                  <User size={16} className="text-brand-primary" />
                  <span>Expediente Individual de Bovino (PDF)</span>
                </div>
                <p className="text-[12px] text-brand-slate/70">
                  Ficha ejecutiva con foto de perfil, arete, raza, genética, genealogía y gráficas
                  de evolución de peso, alimentación, sanidad, reproducción y movimientos.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    aria-label="Bovino para reporte PDF individual"
                    value={effectivePdfAnimalId}
                    onChange={(e) => setPdfAnimalId(e.target.value)}
                    disabled={(dataset?.cattle.length ?? 0) === 0}
                    className="flex-1 h-[38px] px-3 rounded-lg bg-surface-white border border-border-light text-[13px] text-brand-slate outline-none focus:border-brand-primary"
                  >
                    {(dataset?.cattle ?? []).length === 0 ? (
                      <option value="">Sin bovinos disponibles</option>
                    ) : (
                      (dataset?.cattle ?? []).map((animal) => (
                        <option key={animal.id} value={animal.id}>
                          {animal.arete} — {animal.raza} ({animal.sexo})
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleGeneratePdf('individual')}
                    disabled={generatingPdf !== null || !effectivePdfAnimalId}
                    className="inline-flex items-center justify-center gap-1.5 px-4 h-[38px] rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                  >
                    {generatingPdf === 'individual' ? (
                      <>
                        <Loader2 size={15} className="animate-spin" /> Generando...
                      </>
                    ) : (
                      <>
                        <Download size={15} /> Descargar PDF Individual
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Reporte Completo por Lote / Potrero en PDF */}
              <div className="p-4 rounded-xl bg-surface-app border border-border-light space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-brand-forest font-bold text-[14px]">
                    <Layers size={16} className="text-brand-primary" />
                    <span>Reporte Completo por Lote / Potrero (PDF)</span>
                  </div>
                  {effectivePdfLotId && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary">
                      Resumen + {selectedLotAnimalCount}{' '}
                      {selectedLotAnimalCount === 1 ? 'ficha' : 'fichas'}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-brand-slate/70">
                  Genera portada con resumen, datos y gráficas consolidadas del lote, seguida de{' '}
                  <strong>una página individual por cada animal</strong> perteneciente al lote.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    aria-label="Lote o potrero para reporte PDF"
                    value={effectivePdfLotId}
                    onChange={(e) => setPdfLotId(e.target.value)}
                    disabled={
                      (dataset?.lots.length ?? 0) === 0 &&
                      !(dataset?.cattle.some((c) => !c.idLote) ?? false)
                    }
                    className="flex-1 h-[38px] px-3 rounded-lg bg-surface-white border border-border-light text-[13px] text-brand-slate outline-none focus:border-brand-primary"
                  >
                    {(dataset?.lots ?? []).map((lot) => (
                      <option key={lot.id} value={lot.idLote}>
                        {lot.nombre}
                      </option>
                    ))}
                    {(dataset?.cattle.some((c) => !c.idLote) ?? false) && (
                      <option value={UNASSIGNED_LOT_FILTER_VALUE}>Sin potrero asignado</option>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleGeneratePdf('lote')}
                    disabled={generatingPdf !== null || !effectivePdfLotId}
                    className="inline-flex items-center justify-center gap-1.5 px-4 h-[38px] rounded-lg bg-brand-forest hover:bg-brand-dark text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                  >
                    {generatingPdf === 'lote' ? (
                      <>
                        <Loader2 size={15} className="animate-spin" /> Generando...
                      </>
                    ) : (
                      <>
                        <Download size={15} /> Descargar PDF del Lote
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Grid de KPIs principales (los 9 indicadores solicitados) */}
          <section aria-label="Resumen de indicadores" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">Total de Animales</span>
                <Beef size={17} className="text-brand-primary" />
              </div>
              <p
                data-testid="kpi-total-animales"
                className="text-3xl font-condensed font-bold text-brand-forest mt-1.5 tabular-nums"
              >
                {reports.kpis.totalAnimales}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1">
                Activos: {reports.kpis.animalesActivos} · Vendidos: {reports.kpis.animalesVendidos} · Baja:{' '}
                {reports.kpis.animalesBaja}
              </p>
            </article>

            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">Categorías / Potreros</span>
                <MapPin size={17} className="text-brand-primary" />
              </div>
              <p
                data-testid="kpi-categorias-potreros"
                className="text-3xl font-condensed font-bold text-brand-forest mt-1.5 tabular-nums"
              >
                {reports.porCategoria.length} / {reports.porPotrero.length}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1 truncate">
                {reports.porCategoria[0]
                  ? `Mayoría: ${reports.porCategoria[0].label} (${reports.porCategoria[0].count})`
                  : 'Sin animales en el filtro'}
              </p>
            </article>

            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">Pesajes Reales</span>
                <Scale size={17} className="text-brand-primary" />
              </div>
              <p
                data-testid="kpi-total-pesajes"
                className="text-3xl font-condensed font-bold text-brand-forest mt-1.5 tabular-nums"
              >
                {reports.kpis.totalPesajes}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1">
                {reports.kpis.pesoPromedioKg !== null
                  ? `Promedio último peso: ${reports.kpis.pesoPromedioKg.toFixed(1)} kg`
                  : 'Sin pesajes en el rango'}
              </p>
            </article>

            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">Eventos Sanitarios</span>
                <Syringe size={17} className="text-amber-600" />
              </div>
              <p
                data-testid="kpi-eventos-sanitarios"
                className="text-3xl font-condensed font-bold text-brand-forest mt-1.5 tabular-nums"
              >
                {reports.kpis.eventosSanitarios}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1">
                {reports.sanidadPorTipo[0]
                  ? `Frecuente: ${reports.sanidadPorTipo[0].label} (${reports.sanidadPorTipo[0].count})`
                  : 'Sin eventos sanitarios'}
              </p>
            </article>

            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  Tratamientos Pendientes
                </span>
                <AlertTriangle
                  size={17}
                  className={
                    reports.kpis.tratamientosPendientes > 0
                      ? 'text-status-danger'
                      : 'text-status-success'
                  }
                />
              </div>
              <p
                data-testid="kpi-tratamientos-pendientes"
                className={`text-3xl font-condensed font-bold mt-1.5 tabular-nums ${
                  reports.kpis.tratamientosPendientes > 0
                    ? 'text-status-danger'
                    : 'text-brand-forest'
                }`}
              >
                {reports.kpis.tratamientosPendientes}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1">
                De {reports.filteredTreatments.length} tratamientos totales
              </p>
            </article>

            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  Actividades de Alimentación
                </span>
                <Wheat size={17} className="text-brand-primary" />
              </div>
              <p
                data-testid="kpi-alimentacion"
                className="text-3xl font-condensed font-bold text-brand-forest mt-1.5 tabular-nums"
              >
                {reports.kpis.actividadesAlimentacion}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1">
                Lotes: {reports.alimentacion.porLote} · Animales: {reports.alimentacion.porAnimal}
              </p>
            </article>

            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  Eventos Reproductivos
                </span>
                <HeartPulse size={17} className="text-pink-600" />
              </div>
              <p
                data-testid="kpi-reproduccion"
                className="text-3xl font-condensed font-bold text-brand-forest mt-1.5 tabular-nums"
              >
                {reports.kpis.eventosReproductivos}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1">
                {reports.reproduccionPorTipo[0]
                  ? `Principal: ${reports.reproduccionPorTipo[0].label} (${reports.reproduccionPorTipo[0].count})`
                  : 'Sin eventos reproductivos'}
              </p>
            </article>

            <article className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-brand-slate/60">
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  Movimientos Registrados
                </span>
                <ArrowLeftRight size={17} className="text-sky-600" />
              </div>
              <p
                data-testid="kpi-movimientos"
                className="text-3xl font-condensed font-bold text-brand-forest mt-1.5 tabular-nums"
              >
                {reports.kpis.movimientosRegistrados}
              </p>
              <p className="text-[12px] text-brand-slate/65 mt-1">
                {reports.movimientosPorTipo[0]
                  ? `Principal: ${reports.movimientosPorTipo[0].label}`
                  : 'Sin movimientos en rango'}
              </p>
            </article>
          </section>

          {/* Fila 1: Animales por Categoría + Animales por Potrero */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2">
                <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                  <PieChart size={18} className="text-brand-primary" /> Animales por Categoría
                </h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-surface-secondary text-brand-slate/70">
                  Derivado de sexo + edad
                </span>
              </div>
              <div className="p-5 flex-1">
                <DonutDistributionChart
                  items={reports.porCategoria}
                  total={reports.kpis.totalAnimales}
                  centerLabel="Animales"
                  emptyTitle="Sin animales en el filtro"
                  emptyMessage="No hay animales que coincidan con la selección actual."
                  ariaLabel="Distribución real de animales por categoría"
                />
              </div>
            </section>

            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2">
                <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                  <MapPin size={18} className="text-brand-primary" /> Animales por Potrero
                </h2>
                <span className="text-[12px] text-brand-slate/65 font-semibold">
                  {reports.kpis.totalAnimales} total
                </span>
              </div>
              <div className="p-5 flex-1">
                <HorizontalBarChart
                  items={reports.porPotrero}
                  emptyTitle="Sin distribución por potrero"
                  emptyMessage="No se encontraron animales para los criterios seleccionados."
                  emptyIcon={MapPin}
                  barColorClass="bg-brand-primary"
                  unitLabel="cab."
                />
              </div>
            </section>
          </div>

          {/* Fila 2: Evolución real de peso */}
          <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <Scale size={18} className="text-brand-primary" /> Evolución de Peso Real (Báscula)
              </h2>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-900">
                IndexedDB local · Endpoint /api/pesajes pendiente en Backend
              </span>
            </div>
            <div className="p-5 space-y-4">
              {reports.evolucionPeso.totalWeighings > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
                  <div className="p-3 rounded-lg bg-surface-app border border-border-light/60">
                    <span className="text-brand-slate/60 font-semibold block">Peso promedio</span>
                    <strong className="text-lg font-condensed text-brand-forest">
                      {reports.evolucionPeso.averageLatestWeightKg !== null
                        ? `${reports.evolucionPeso.averageLatestWeightKg.toFixed(1)} kg`
                        : '—'}
                    </strong>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-app border border-border-light/60">
                    <span className="text-brand-slate/60 font-semibold block">Mínimo registrado</span>
                    <strong className="text-lg font-condensed text-brand-slate">
                      {reports.evolucionPeso.minWeightKg !== null
                        ? `${reports.evolucionPeso.minWeightKg.toFixed(1)} kg`
                        : '—'}
                    </strong>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-app border border-border-light/60">
                    <span className="text-brand-slate/60 font-semibold block">Máximo registrado</span>
                    <strong className="text-lg font-condensed text-brand-slate">
                      {reports.evolucionPeso.maxWeightKg !== null
                        ? `${reports.evolucionPeso.maxWeightKg.toFixed(1)} kg`
                        : '—'}
                    </strong>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-app border border-border-light/60">
                    <span className="text-brand-slate/60 font-semibold block">GDP promedio</span>
                    <strong className="text-lg font-condensed text-brand-primary">
                      {reports.evolucionPeso.averageGdpKgDay !== null
                        ? `${reports.evolucionPeso.averageGdpKgDay.toFixed(3)} kg/día`
                        : 'Requiere ≥ 2 fechas'}
                    </strong>
                  </div>
                </div>
              )}

              <WeightEvolutionChart
                points={reports.evolucionPeso.evolutionPoints}
                subtitle={`${reports.kpis.totalPesajes} pesaje${reports.kpis.totalPesajes === 1 ? '' : 's'} real${reports.kpis.totalPesajes === 1 ? '' : 'es'} en el filtro`}
                emptyActionLabel="Registrar pesaje"
                onEmptyAction={() => navigate('/weighing')}
              />
            </div>
          </section>

          {/* Fila 3: Sanidad + Tratamientos Pendientes */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-5 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
                <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                  <Syringe size={18} className="text-amber-600" /> Eventos Sanitarios
                </h2>
                <span className="text-[12px] font-bold text-brand-forest">
                  {reports.kpis.eventosSanitarios}
                </span>
              </div>
              <div className="p-5 flex-1">
                <HorizontalBarChart
                  items={reports.sanidadPorTipo}
                  emptyTitle="Sin eventos sanitarios"
                  emptyMessage="No hay eventos sanitarios registrados para los filtros aplicados."
                  emptyIcon={Syringe}
                  barColorClass="bg-amber-500"
                />
              </div>
            </section>

            <section className="lg:col-span-7 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
                <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                  <AlertTriangle size={18} className="text-status-danger" /> Tratamientos Pendientes
                </h2>
                <span className="text-[12px] font-bold text-status-danger">
                  {reports.kpis.tratamientosPendientes} activo
                  {reports.kpis.tratamientosPendientes === 1 ? '' : 's'}
                </span>
              </div>
              <div className="p-5 flex-1">
                {reports.tratamientosPendientesLista.length === 0 ? (
                  <EmptyState
                    title="Sin tratamientos pendientes"
                    message="No existen tratamientos en estado Pendiente o En curso dentro de los filtros actuales."
                    icon={Syringe}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-border-light text-[11px] uppercase tracking-wider text-brand-slate/60">
                          <th className="py-2 pr-3">Animal</th>
                          <th className="py-2 pr-3">Producto / Dosis</th>
                          <th className="py-2 pr-3">Inicio</th>
                          <th className="py-2 pr-3">Estado</th>
                          <th className="py-2">Responsable</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-light/60">
                        {reports.tratamientosPendientesLista.slice(0, 8).map((t) => (
                          <tr key={t.id}>
                            <td className="py-2.5 pr-3 font-semibold text-brand-forest">
                              {reports.animalAreteById[t.idAnimal] || t.idAnimal.slice(0, 8)}
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className="font-medium text-brand-slate">{t.producto}</span>
                              <span className="block text-[11px] text-brand-slate/60">
                                {t.dosis} {t.unidadDosis} · {t.frecuencia}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 text-brand-slate/75 whitespace-nowrap">
                              {formatShortDate(t.fechaInicio)}
                            </td>
                            <td className="py-2.5 pr-3">
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-900">
                                {t.estado}
                              </span>
                            </td>
                            <td className="py-2.5 text-brand-slate/75">{t.responsable}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Fila 4: Alimentación + Reproducción + Movimientos */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
                <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
                  <Wheat size={17} className="text-brand-primary" /> Alimentación
                </h2>
                <span className="text-[12px] font-bold text-brand-forest">
                  {reports.alimentacion.totalActividades}
                </span>
              </div>
              <div className="p-5 flex-1 space-y-4">
                {reports.alimentacion.totalActividades > 0 && (
                  <div className="grid grid-cols-2 gap-2 text-[12px]">
                    <div className="p-2.5 rounded-lg bg-surface-app border border-border-light/60">
                      <span className="text-brand-slate/60 block">Por potrero / animal</span>
                      <strong className="text-brand-slate">
                        {reports.alimentacion.porLote} / {reports.alimentacion.porAnimal}
                      </strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-surface-app border border-border-light/60">
                      <span className="text-brand-slate/60 block">Cantidad en kg</span>
                      <strong className="text-brand-forest">
                        {reports.alimentacion.totalCantidadKg.toFixed(1)} kg
                      </strong>
                    </div>
                  </div>
                )}
                <HorizontalBarChart
                  items={reports.alimentacion.porAlimento}
                  emptyTitle="Sin actividades de alimentación"
                  emptyMessage="No hay registros de alimentación en el filtro actual."
                  emptyIcon={Wheat}
                  barColorClass="bg-emerald-600"
                />
              </div>
            </section>

            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2">
                <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
                  <Activity size={17} className="text-pink-600" /> Eventos Reproductivos
                </h2>
                <span className="text-[12px] font-bold text-brand-forest">
                  {reports.kpis.eventosReproductivos}
                </span>
              </div>
              <div className="p-5 flex-1 space-y-3">
                <p className="text-[11px] text-amber-900 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5">
                  Respaldo local IndexedDB · Endpoint <code>/api/eventos-reproductivos</code> aún no
                  disponible en Backend.
                </p>
                <HorizontalBarChart
                  items={reports.reproduccionPorTipo}
                  emptyTitle="Sin eventos reproductivos"
                  emptyMessage="No se encontraron registros reproductivos para los filtros aplicados."
                  emptyIcon={HeartPulse}
                  barColorClass="bg-pink-600"
                />
              </div>
            </section>

            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
                <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
                  <ArrowLeftRight size={17} className="text-sky-600" /> Movimientos Registrados
                </h2>
                <span className="text-[12px] font-bold text-brand-forest">
                  {reports.kpis.movimientosRegistrados}
                </span>
              </div>
              <div className="p-5 flex-1">
                <HorizontalBarChart
                  items={reports.movimientosPorTipo}
                  emptyTitle="Sin movimientos registrados"
                  emptyMessage="No existen movimientos de trazabilidad en el filtro seleccionado."
                  emptyIcon={ArrowLeftRight}
                  barColorClass="bg-sky-600"
                />
              </div>
            </section>
          </div>
        </>
      )}

      {/* Transparencia de Contratos y Endpoints Pendientes en Backend */}
      <section
        aria-label="Dependencias de endpoints del Backend"
        className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-3"
      >
        <div className="flex items-center gap-2 text-brand-forest font-bold text-[14px]">
          <Info size={16} className="text-brand-primary shrink-0" />
          <span>Transparencia de Fuentes y Dependencias Pendientes del Backend</span>
        </div>
        <p className="text-[12px] text-brand-slate/75">
          Los indicadores de <strong>Animales</strong>, <strong>Potreros</strong>,{' '}
          <strong>Eventos Sanitarios</strong>, <strong>Tratamientos</strong>,{' '}
          <strong>Alimentación</strong> y <strong>Movimientos</strong> consultan los endpoints REST
          reales del Backend con respaldo offline en IndexedDB. Los siguientes puntos documentan
          dependencias todavía inexistentes en <code>BackEnd/Controllers/</code>:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {REPORT_BACKEND_DEPENDENCIES.map((dep) => (
            <div
              key={dep.id}
              className="p-3 rounded-lg bg-surface-app border border-border-light/70 text-[12px] space-y-1"
            >
              <p className="font-bold text-brand-slate">{dep.indicador}</p>
              <p className="text-amber-900 font-medium">Pendiente: {dep.endpointFaltante}</p>
              <p className="text-brand-slate/70">{dep.detalle}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
