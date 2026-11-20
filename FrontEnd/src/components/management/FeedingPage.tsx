import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Wheat,
  Plus,
  Search,
  RefreshCw,
  ArrowUpDown,
  Edit,
  Archive,
  Eye,
  Cloud,
  CloudUpload,
  AlertCircle,
  AlertOctagon,
  WifiOff,
  CheckCircle2,
  Loader2,
  X,
  Beef,
  MapPin
} from 'lucide-react';
import type { Cattle, LotOption } from '../../types/cattle';
import type { FeedingInput, FeedingRecord } from '../../types/feeding';
import { FeedingService, type FeedingMutationResult } from '../../services/feeding.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import EmptyState from '../ui/EmptyState';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';
import FeedingFormModal from './FeedingFormModal';

function formatDateTimeDisplay(raw: string | null): string {
  if (!raw) return 'En curso / Sin fecha fin';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderSyncBadge(syncStatus: FeedingRecord['syncStatus']) {
  switch (syncStatus) {
    case 'synced':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-success/10 text-status-success">
          <Cloud size={12} /> Sincronizado
        </span>
      );
    case 'conflict':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700">
          <AlertOctagon size={12} /> Conflicto
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-error/10 text-status-error">
          <AlertCircle size={12} /> Error sync
        </span>
      );
    case 'pending':
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-warning/15 text-amber-800">
          <CloudUpload size={12} /> Pendiente
        </span>
      );
  }
}

export default function FeedingPage() {
  const { isOnline } = useSyncStatus();

  const [records, setRecords] = useState<FeedingRecord[]>([]);
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [lots, setLots] = useState<LotOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [targetFilter, setTargetFilter] = useState<'todos' | 'lote' | 'animal'>('todos');
  const [lotFilter, setLotFilter] = useState<string>('todos');
  const [animalFilter, setAnimalFilter] = useState<string>('todos');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  // Modales y detalle
  const [formModalState, setFormModalState] = useState<
    | { open: false }
    | { open: true; mode: 'create' }
    | { open: true; mode: 'edit'; record: FeedingRecord }
  >({ open: false });

  const [selectedRecord, setSelectedRecord] = useState<FeedingRecord | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<FeedingRecord | null>(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const loadData = useCallback(async (withDeleted: boolean, order: 'asc' | 'desc') => {
    setLoading(true);
    setError(null);
    try {
      const result = await FeedingService.getAll({
        includeDeleted: withDeleted,
        order
      });
      setRecords(result.data);
      setAnimals(result.animals);
      setLots(result.lots);
      setApiWarning(result.warning);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudieron cargar los registros de alimentación.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await FeedingService.getAll({
          includeDeleted,
          order: sortOrder
        });
        if (!active) return;
        setRecords(result.data);
        setAnimals(result.animals);
        setLots(result.lots);
        setApiWarning(result.warning);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudieron cargar los registros de alimentación.'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    let previousSyncAt = SyncScheduler.getSnapshot().lastCompletedSyncAt;
    const unsubscribe = SyncScheduler.subscribe(() => {
      const nextSyncAt = SyncScheduler.getSnapshot().lastCompletedSyncAt;
      if (nextSyncAt && nextSyncAt !== previousSyncAt) {
        previousSyncAt = nextSyncAt;
        void loadData(includeDeleted, sortOrder);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [includeDeleted, sortOrder, loadData]);

  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);

  const describeTarget = useCallback(
    (rec: FeedingRecord): string => {
      if (rec.idAnimal) {
        const animal = animalById.get(rec.idAnimal);
        return animal ? `${animal.arete} (${animal.raza})` : `Animal ${rec.idAnimal.slice(0, 8)}…`;
      }
      if (rec.idLote) {
        const lot = lotById.get(rec.idLote);
        return lot ? lot.nombre : `Potrero ${rec.idLote.slice(0, 8)}…`;
      }
      return 'Sin destino';
    },
    [animalById, lotById]
  );

  const filteredRecords = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return records.filter((rec) => {
      if (!includeDeleted && rec.deletedAt) return false;
      if (targetFilter !== 'todos' && rec.targetType !== targetFilter) return false;
      if (lotFilter !== 'todos' && rec.idLote !== lotFilter) return false;
      if (animalFilter !== 'todos' && rec.idAnimal !== animalFilter) return false;
      if (!query) return true;

      const targetLabel = describeTarget(rec).toLowerCase();
      return (
        rec.alimento.toLowerCase().includes(query) ||
        rec.racion.toLowerCase().includes(query) ||
        rec.frecuencia.toLowerCase().includes(query) ||
        (rec.cambioDieta || '').toLowerCase().includes(query) ||
        targetLabel.includes(query)
      );
    });
  }, [
    records,
    includeDeleted,
    targetFilter,
    lotFilter,
    animalFilter,
    searchTerm,
    describeTarget
  ]);

  const stats = useMemo(() => {
    const active = records.filter((r) => !r.deletedAt);
    return {
      total: active.length,
      porLote: active.filter((r) => r.targetType === 'lote').length,
      porAnimal: active.filter((r) => r.targetType === 'animal').length,
      pendientesSync: active.filter((r) => r.syncStatus !== 'synced').length
    };
  }, [records]);

  const handleSaveRecord = async (input: FeedingInput): Promise<FeedingMutationResult> => {
    const isEdit = formModalState.open && formModalState.mode === 'edit';
    const result = isEdit
      ? await FeedingService.update(formModalState.record.id, input)
      : await FeedingService.create(input);

    const confirmation = result.synced
      ? isEdit
        ? `Alimentación "${result.record.alimento}" actualizada y sincronizada.`
        : `Alimentación "${result.record.alimento}" registrada y sincronizada.`
      : result.syncMessage ||
        `Alimentación "${result.record.alimento}" guardada localmente. Pendiente de sincronización.`;

    setFeedbackMsg(confirmation);
    await loadData(includeDeleted, sortOrder);
    if (selectedRecord && selectedRecord.id === result.record.id) {
      setSelectedRecord(result.record);
    }
    return result;
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget || isDeactivating) return;
    setIsDeactivating(true);
    setDeactivateError(null);

    try {
      const result = await FeedingService.deactivate(deactivateTarget.id);
      setFeedbackMsg(
        result.synced
          ? `Registro "${deactivateTarget.alimento}" desactivado y sincronizado.`
          : result.syncMessage || `Registro "${deactivateTarget.alimento}" desactivado localmente.`
      );
      if (selectedRecord?.id === deactivateTarget.id) {
        setSelectedRecord(null);
      }
      setDeactivateTarget(null);
      await loadData(includeDeleted, sortOrder);
    } catch (err) {
      setDeactivateError(
        err instanceof Error ? err.message : 'No se pudo desactivar el registro.'
      );
    } finally {
      setIsDeactivating(false);
    }
  };

  const columns: ResponsiveColumn<FeedingRecord>[] = [
    {
      key: 'alimento',
      header: 'Alimento / Ración',
      hideOnCard: true,
      renderCell: (rec) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setSelectedRecord(rec)}
              className="font-bold text-brand-forest hover:text-brand-primary hover:underline text-left cursor-pointer"
            >
              {rec.alimento}
            </button>
            {rec.deletedAt && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-slate/15 text-brand-slate/70">
                Desactivado
              </span>
            )}
            {renderSyncBadge(rec.syncStatus)}
          </div>
          <p className="text-[12px] text-brand-slate/65">{rec.racion}</p>
        </div>
      )
    },
    {
      key: 'destino',
      header: 'Aplicado a',
      renderCell: (rec) => (
        <div className="inline-flex items-center gap-1.5 text-[13px]">
          {rec.idAnimal ? (
            <>
              <Beef size={14} className="text-brand-primary shrink-0" />
              <Link
                to={`/cattle/${rec.idAnimal}`}
                className="font-semibold text-brand-primary hover:underline"
              >
                {describeTarget(rec)}
              </Link>
            </>
          ) : (
            <>
              <MapPin size={14} className="text-brand-forest shrink-0" />
              <span className="font-medium text-brand-slate">{describeTarget(rec)}</span>
            </>
          )}
        </div>
      )
    },
    {
      key: 'dosis',
      header: 'Cantidad y Frecuencia',
      renderCell: (rec) => (
        <div className="text-[13px]">
          <span className="font-bold text-brand-slate">
            {rec.cantidad} {rec.unidad}
          </span>
          <p className="text-[11px] text-brand-slate/65">{rec.frecuencia}</p>
        </div>
      )
    },
    {
      key: 'inicio',
      header: 'Inicio',
      renderCell: (rec) => (
        <span className="text-[12px] text-brand-slate/80">
          {formatDateTimeDisplay(rec.inicio)}
        </span>
      )
    }
  ];

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    targetFilter !== 'todos' ||
    lotFilter !== 'todos' ||
    animalFilter !== 'todos';

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Nutrición
          </span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Alimentación y Raciones
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(includeDeleted, sortOrder)}
            disabled={loading}
            aria-label="Actualizar alimentación"
            className="min-h-[42px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            type="button"
            onClick={() => setFormModalState({ open: true, mode: 'create' })}
            className="min-h-[42px] flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Registrar Alimentación
          </button>
        </div>
      </header>

      {!isOnline && (
        <div
          role="status"
          className="p-3 rounded-xl bg-status-warning/15 border border-status-warning/35 text-brand-dark text-[12px] flex items-center gap-2"
        >
          <WifiOff size={16} className="text-status-warning shrink-0" />
          <span>
            Trabajando sin conexión. Los registros de alimentación se guardan en IndexedDB y se sincronizarán al reconectar.
          </span>
        </div>
      )}

      {apiWarning && isOnline && (
        <div
          role="status"
          className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-brand-slate text-[12px] flex items-center gap-2"
        >
          <AlertCircle size={16} className="text-amber-600 shrink-0" />
          <span>{apiWarning}</span>
        </div>
      )}

      {feedbackMsg && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-status-success/10 border border-status-success/30 text-status-success text-[13px] font-medium flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{feedbackMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            aria-label="Cerrar notificación"
            className="p-1 hover:bg-status-success/10 rounded"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Resumen real */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Total Registros
          </p>
          <p className="text-2xl font-bold text-brand-forest mt-1">{stats.total}</p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Por Potrero / Lote
          </p>
          <p className="text-2xl font-bold text-brand-primary mt-1">{stats.porLote}</p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Por Animal Individual
          </p>
          <p className="text-2xl font-bold text-brand-slate mt-1">{stats.porAnimal}</p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Pendientes Sync
          </p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{stats.pendientesSync}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40"
            />
            <input
              type="text"
              aria-label="Buscar alimentación"
              placeholder="Buscar alimento, ración, frecuencia o destino…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-h-[42px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 outline-none focus:border-brand-primary"
            />
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filtrar por tipo de destino"
              value={targetFilter}
              onChange={(e) => {
                const next = e.target.value as 'todos' | 'lote' | 'animal';
                setTargetFilter(next);
                if (next === 'lote') setAnimalFilter('todos');
                if (next === 'animal') setLotFilter('todos');
              }}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Destino: Todos</option>
              <option value="lote">Por Potrero / Lote</option>
              <option value="animal">Por Animal</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filtrar por potrero"
              value={lotFilter}
              onChange={(e) => setLotFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Potrero: Todos</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filtrar por animal"
              value={animalFilter}
              onChange={(e) => setAnimalFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Animal: Todos</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.arete}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              aria-label="Cambiar orden cronológico"
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light hover:border-brand-primary rounded-md text-[12px] font-semibold text-brand-slate inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ArrowUpDown size={14} className="text-brand-primary shrink-0" />
              <span>{sortOrder === 'desc' ? 'Más recientes' : 'Más antiguos'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-light/70 text-[12px] text-brand-slate/70">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={() => setIncludeDeleted((prev) => !prev)}
              className="rounded border-border-dark text-brand-primary focus:ring-brand-primary"
            />
            <span>Mostrar registros desactivados</span>
          </label>
          <span>
            Mostrando <strong className="text-brand-slate">{filteredRecords.length}</strong> de{' '}
            <strong className="text-brand-slate">{records.length}</strong> registros
          </span>
        </div>
      </div>

      {/* Historial + Panel de detalle */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={selectedRecord ? 'lg:col-span-8' : 'lg:col-span-12'}>
          {error && records.length === 0 ? (
            <div
              role="alert"
              className="bg-status-error/10 border border-status-error/25 rounded-xl p-6 text-center text-status-error space-y-2"
            >
              <AlertCircle className="mx-auto" size={24} />
              <p className="font-semibold text-[14px]">No se pudo cargar la alimentación</p>
              <p className="text-[13px] opacity-85">{error}</p>
            </div>
          ) : loading && records.length === 0 ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-12 text-center text-brand-slate/60 font-medium flex flex-col items-center gap-3">
              <Loader2 size={24} className="animate-spin text-brand-primary" />
              <span>Cargando historial de alimentación…</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm min-h-[340px] flex items-center justify-center p-6">
              <EmptyState
                title={hasActiveFilters ? 'Sin coincidencias' : 'Sin registros de alimentación'}
                message={
                  hasActiveFilters
                    ? 'Ningún registro coincide con tu búsqueda o filtros actuales.'
                    : 'Registra el primer suministro de alimento por potrero/lote o por animal individual.'
                }
                icon={Wheat}
                actionLabel={hasActiveFilters ? 'Limpiar filtros' : 'Registrar Alimentación'}
                onAction={
                  hasActiveFilters
                    ? () => {
                        setSearchTerm('');
                        setTargetFilter('todos');
                        setLotFilter('todos');
                        setAnimalFilter('todos');
                      }
                    : () => setFormModalState({ open: true, mode: 'create' })
                }
              />
            </div>
          ) : (
            <ResponsiveDataView
              items={filteredRecords}
              getKey={(rec) => rec.id}
              columns={columns}
              renderCardHeader={(rec) => (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedRecord(rec)}
                      className="font-bold text-brand-forest hover:underline text-left"
                    >
                      {rec.alimento}
                    </button>
                    {renderSyncBadge(rec.syncStatus)}
                  </div>
                  <p className="text-[12px] text-brand-slate/65">{rec.racion}</p>
                </div>
              )}
              renderCardActions={(rec) => (
                <div className="inline-flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedRecord(rec)}
                    aria-label={`Ver detalle de ${rec.alimento}`}
                    title="Ver detalle"
                    className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-brand-primary hover:bg-brand-primary/10 rounded-md transition-colors cursor-pointer"
                  >
                    <Eye size={17} />
                  </button>
                  {!rec.deletedAt && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setFormModalState({ open: true, mode: 'edit', record: rec })
                        }
                        aria-label={`Editar ${rec.alimento}`}
                        title="Editar"
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors cursor-pointer"
                      >
                        <Edit size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeactivateTarget(rec);
                          setDeactivateError(null);
                        }}
                        aria-label={`Desactivar ${rec.alimento}`}
                        title="Desactivar"
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-error hover:bg-status-error/10 rounded-md transition-colors cursor-pointer"
                      >
                        <Archive size={17} />
                      </button>
                    </>
                  )}
                </div>
              )}
            />
          )}
        </div>

        {/* Panel de Detalle */}
        {selectedRecord && (
          <aside
            aria-label="Detalle del registro de alimentación"
            className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden"
          >
            <div className="h-2 bg-brand-primary w-full" />
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-border-light pb-3">
                <div>
                  <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Detalle de Alimentación
                  </span>
                  <h2 className="text-xl font-bold text-brand-forest mt-0.5">
                    {selectedRecord.alimento}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  aria-label="Cerrar detalle de alimentación"
                  className="p-1 rounded text-brand-slate/55 hover:bg-surface-secondary hover:text-brand-slate"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-primary/10 text-brand-primary">
                  {selectedRecord.targetType === 'animal' ? 'Animal individual' : 'Potrero / Lote'}
                </span>
                {renderSyncBadge(selectedRecord.syncStatus)}
              </div>

              <dl className="space-y-2.5 text-[13px]">
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Aplicado a
                  </dt>
                  <dd className="font-semibold text-brand-slate mt-0.5">
                    {selectedRecord.idAnimal ? (
                      <Link
                        to={`/cattle/${selectedRecord.idAnimal}`}
                        className="text-brand-primary hover:underline"
                      >
                        {describeTarget(selectedRecord)}
                      </Link>
                    ) : (
                      describeTarget(selectedRecord)
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Ración</dt>
                  <dd className="text-brand-slate mt-0.5">{selectedRecord.racion}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                      Cantidad
                    </dt>
                    <dd className="font-bold text-brand-forest mt-0.5">
                      {selectedRecord.cantidad} {selectedRecord.unidad}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                      Frecuencia
                    </dt>
                    <dd className="text-brand-slate mt-0.5">{selectedRecord.frecuencia}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Inicio</dt>
                  <dd className="text-brand-slate mt-0.5">
                    {formatDateTimeDisplay(selectedRecord.inicio)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Fin</dt>
                  <dd className="text-brand-slate mt-0.5">
                    {formatDateTimeDisplay(selectedRecord.fin)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Cambio de Dieta / Observaciones
                  </dt>
                  <dd className="text-brand-slate/85 mt-0.5 whitespace-pre-line">
                    {selectedRecord.cambioDieta || 'Sin observaciones registradas'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Identificador UUID
                  </dt>
                  <dd className="font-mono text-[11px] text-brand-slate/70 mt-0.5 break-all">
                    {selectedRecord.idAlimentacion} (v{selectedRecord.versionRegistro})
                  </dd>
                </div>
              </dl>

              {!selectedRecord.deletedAt && (
                <div className="flex gap-2 pt-3 border-t border-border-light">
                  <button
                    type="button"
                    onClick={() =>
                      setFormModalState({ open: true, mode: 'edit', record: selectedRecord })
                    }
                    className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md border border-border-light text-[12px] font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary"
                  >
                    <Edit size={13} /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeactivateTarget(selectedRecord);
                      setDeactivateError(null);
                    }}
                    className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md border border-status-error/30 text-[12px] font-semibold text-status-error hover:bg-status-error/10"
                  >
                    <Archive size={13} /> Desactivar
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Modal Crear / Editar */}
      {formModalState.open && (
        <FeedingFormModal
          mode={formModalState.mode}
          initialRecord={formModalState.mode === 'edit' ? formModalState.record : undefined}
          animals={animals}
          lots={lots}
          isOnline={isOnline}
          onClose={() => setFormModalState({ open: false })}
          onSubmit={handleSaveRecord}
        />
      )}

      {/* Modal Desactivar */}
      {deactivateTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-feeding-title"
          onClick={() => !isDeactivating && setDeactivateTarget(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2
                  id="deactivate-feeding-title"
                  className="text-[17px] font-bold text-brand-slate"
                >
                  Desactivar registro — {deactivateTarget.alimento}
                </h2>
                <p className="text-[12px] text-brand-slate/65 mt-1">
                  El registro se marcará como desactivado (borrado lógico) conservando su historial nutricional.
                </p>
              </div>
              <button
                type="button"
                disabled={isDeactivating}
                onClick={() => setDeactivateTarget(null)}
                aria-label="Cerrar diálogo"
                className="p-1 text-brand-slate/50 hover:text-brand-slate rounded"
              >
                <X size={16} />
              </button>
            </div>

            {deactivateError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-[12px]"
              >
                {deactivateError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
              <button
                type="button"
                disabled={isDeactivating}
                onClick={() => setDeactivateTarget(null)}
                className="min-h-[40px] px-4 rounded-lg border border-border-light text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeactivating}
                onClick={() => void handleConfirmDeactivate()}
                className="min-h-[40px] px-4 rounded-lg bg-status-error hover:bg-red-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isDeactivating && <Loader2 size={14} className="animate-spin" />}
                Confirmar desactivación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
