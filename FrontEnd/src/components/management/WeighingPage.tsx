import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Scale,
  Plus,
  TrendingUp,
  History,
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
  CheckCircle2,
  Loader2,
  X,
  Info
} from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import type { Weighing, WeighingInput } from '../../types/weighing';
import { computeWeightAnalytics } from '../../services/weighing.validation';
import { WeighingService, type WeighingMutationResult } from '../../services/weighing.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import EmptyState from '../ui/EmptyState';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';
import WeightEvolutionChart from './WeightEvolutionChart';
import WeighingFormModal from './WeighingFormModal';

function formatDateTimeDisplay(raw: string): string {
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

function renderSyncBadge(syncStatus: Weighing['syncStatus']) {
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

export default function WeighingPage() {
  const [searchParams] = useSearchParams();
  const initialAnimalParam = searchParams.get('animalId') || 'todos';

  const { isOnline } = useSyncStatus();

  const [weighings, setWeighings] = useState<Weighing[]>([]);
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [backendNotice, setBackendNotice] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [animalFilter, setAnimalFilter] = useState<string>(initialAnimalParam);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  // Modales y detalle
  const [formModalState, setFormModalState] = useState<
    | { open: false }
    | { open: true; mode: 'create' }
    | { open: true; mode: 'edit'; weighing: Weighing }
  >({ open: false });

  const [selectedWeighing, setSelectedWeighing] = useState<Weighing | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Weighing | null>(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const loadData = useCallback(async (withDeleted: boolean, order: 'asc' | 'desc') => {
    setLoading(true);
    setError(null);
    try {
      const result = await WeighingService.getAll({
        includeDeleted: withDeleted,
        order
      });
      setWeighings(result.data);
      setAnimals(result.animals);
      setBackendNotice(result.backendNotice);
      setSelectedWeighing((current) =>
        current ? (result.data.find((w) => w.id === current.id) ?? null) : null
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo cargar el historial de pesajes.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await WeighingService.getAll({
          includeDeleted,
          order: sortOrder
        });
        if (!active) return;
        setWeighings(result.data);
        setAnimals(result.animals);
        setBackendNotice(result.backendNotice);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el historial de pesajes.'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    let previousSyncAt = SyncScheduler.getSnapshot().lastCompletedSyncAt;
    let previousCycleFinishedAt = SyncScheduler.getSnapshot().lastCycleResult?.finishedAt ?? null;
    const unsubscribe = SyncScheduler.subscribe(() => {
      const snap = SyncScheduler.getSnapshot();
      const nextSyncAt = snap.lastCompletedSyncAt;
      const nextCycle = snap.lastCycleResult;
      const nextCycleFinishedAt = nextCycle?.finishedAt ?? null;

      const fullSyncAdvanced = Boolean(nextSyncAt && nextSyncAt !== previousSyncAt);
      const relevantPullApplied =
        Boolean(nextCycleFinishedAt && nextCycleFinishedAt !== previousCycleFinishedAt) &&
        Boolean(
          nextCycle?.pull.some(
            (item) =>
              (item.entidad === 'weighings' || item.entidad === 'cattle') &&
              (item.appliedCount > 0 || item.deletedCount > 0 || item.conflictCount > 0)
          )
        );

      if (fullSyncAdvanced || relevantPullApplied) {
        previousSyncAt = nextSyncAt;
        previousCycleFinishedAt = nextCycleFinishedAt;
        void loadData(includeDeleted, sortOrder);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [includeDeleted, sortOrder, loadData]);

  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  const analytics = useMemo(
    () => computeWeightAnalytics(weighings, animals, animalFilter),
    [weighings, animals, animalFilter]
  );

  const lastWeightByAnimal = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of analytics.latestByAnimal) {
      map.set(item.idAnimal, item.latestWeightKg);
    }
    return map;
  }, [analytics.latestByAnimal]);

  const filteredWeighings = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return weighings.filter((w) => {
      if (!includeDeleted && w.deletedAt) return false;
      if (animalFilter !== 'todos' && w.idAnimal !== animalFilter) return false;
      if (!query) return true;

      const animal = animalById.get(w.idAnimal);
      return (
        (animal?.arete || '').toLowerCase().includes(query) ||
        (animal?.raza || '').toLowerCase().includes(query) ||
        w.fuenteBascula.toLowerCase().includes(query) ||
        w.responsable.toLowerCase().includes(query) ||
        (w.observaciones || '').toLowerCase().includes(query) ||
        String(w.pesoRealKg).includes(query)
      );
    });
  }, [weighings, includeDeleted, animalFilter, searchTerm, animalById]);

  const activeCount = useMemo(() => weighings.filter((w) => !w.deletedAt).length, [weighings]);
  const pendingCount = useMemo(
    () => weighings.filter((w) => !w.deletedAt && w.syncStatus !== 'synced').length,
    [weighings]
  );

  const handleSaveWeighing = async (input: WeighingInput): Promise<WeighingMutationResult> => {
    const isEdit = formModalState.open && formModalState.mode === 'edit';
    const result = isEdit
      ? await WeighingService.update(formModalState.weighing.id, input)
      : await WeighingService.create(input);

    const confirmation = result.synced
      ? isEdit
        ? `Pesaje (${result.weighing.pesoRealKg.toFixed(1)} kg) actualizado y sincronizado.`
        : `Pesaje (${result.weighing.pesoRealKg.toFixed(1)} kg) registrado y sincronizado.`
      : result.syncMessage ||
        `Pesaje (${result.weighing.pesoRealKg.toFixed(1)} kg) guardado localmente.`;

    setFeedbackMsg(confirmation);
    await loadData(includeDeleted, sortOrder);
    if (selectedWeighing && selectedWeighing.id === result.weighing.id) {
      setSelectedWeighing(result.weighing);
    }
    return result;
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget || isDeactivating) return;
    setIsDeactivating(true);
    setDeactivateError(null);

    try {
      const result = await WeighingService.deactivate(deactivateTarget.id);
      setFeedbackMsg(
        result.synced
          ? 'Pesaje desactivado lógicamente y sincronizado.'
          : result.syncMessage || 'Pesaje desactivado localmente.'
      );
      if (selectedWeighing?.id === deactivateTarget.id) {
        setSelectedWeighing(null);
      }
      setDeactivateTarget(null);
      await loadData(includeDeleted, sortOrder);
    } catch (err) {
      setDeactivateError(
        err instanceof Error ? err.message : 'No se pudo desactivar el pesaje.'
      );
    } finally {
      setIsDeactivating(false);
    }
  };

  const columns: ResponsiveColumn<Weighing>[] = [
    {
      key: 'animal',
      header: 'Animal',
      hideOnCard: true,
      renderCell: (w) => {
        const animal = animalById.get(w.idAnimal);
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/cattle/${w.idAnimal}`}
                className="font-bold text-brand-forest hover:text-brand-primary hover:underline"
              >
                {animal ? animal.arete : `Animal ${w.idAnimal.slice(0, 8)}…`}
              </Link>
              {w.deletedAt && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-slate/15 text-brand-slate/70">
                  Desactivado
                </span>
              )}
              {renderSyncBadge(w.syncStatus)}
            </div>
            {animal && (
              <p className="text-[11px] text-brand-slate/65">
                {animal.raza} · {animal.sexo}
              </p>
            )}
          </div>
        );
      }
    },
    {
      key: 'peso',
      header: 'Peso real',
      renderCell: (w) => {
        const delta = analytics.deltaByWeighingId.get(w.id);
        return (
          <div>
            <span className="font-bold text-[14px] text-brand-forest">
              {w.pesoRealKg.toFixed(1)} kg
            </span>
            {delta && (
              <p
                className={`text-[11px] font-semibold ${
                  delta.deltaKg > 0
                    ? 'text-status-success'
                    : delta.deltaKg < 0
                      ? 'text-status-error'
                      : 'text-brand-slate/65'
                }`}
              >
                {delta.deltaKg > 0 ? `+${delta.deltaKg.toFixed(1)}` : delta.deltaKg.toFixed(1)} kg
                {delta.gdpKgDay !== null ? ` (${delta.gdpKgDay.toFixed(2)} kg/día)` : ''}
              </p>
            )}
          </div>
        );
      }
    },
    {
      key: 'fecha',
      header: 'Fecha',
      renderCell: (w) => (
        <span className="text-[12px] text-brand-slate/85">{formatDateTimeDisplay(w.fecha)}</span>
      )
    },
    {
      key: 'fuente',
      header: 'Báscula / Responsable',
      renderCell: (w) => (
        <div className="text-[12px]">
          <p className="font-medium text-brand-slate truncate max-w-[200px]">{w.fuenteBascula}</p>
          <p className="text-[11px] text-brand-slate/60 truncate max-w-[200px]">{w.responsable}</p>
        </div>
      )
    }
  ];

  const hasActiveFilters = searchTerm.trim().length > 0 || animalFilter !== 'todos';
  const latestAnimal = analytics.latestWeighing
    ? animalById.get(analytics.latestWeighing.idAnimal)
    : undefined;
  const maxLatestKg =
    analytics.latestByAnimal.length > 0
      ? Math.max(...analytics.latestByAnimal.map((item) => item.latestWeightKg), 1)
      : 1;

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Biometría y Rendimiento
          </span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Pesajes y Crecimiento
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(includeDeleted, sortOrder)}
            disabled={loading}
            aria-label="Actualizar pesajes"
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
            <Plus size={16} /> Registrar Pesaje Oficial
          </button>
        </div>
      </header>

      {backendNotice && isOnline && (
        <div
          role="status"
          className="p-3 rounded-xl bg-status-info/10 border border-status-info/30 text-brand-slate text-[12px] flex items-start gap-2"
        >
          <Info size={16} className="text-status-info shrink-0 mt-0.5" />
          <span>{backendNotice}</span>
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

      {/* KPIs reales: Último peso registrado, GDP promedio real, Total y Pendientes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Último Peso Registrado
          </p>
          {analytics.latestWeighing ? (
            <>
              <p className="text-2xl font-bold text-brand-forest mt-1">
                {analytics.latestWeighing.pesoRealKg.toFixed(1)}{' '}
                <span className="text-[14px] font-semibold text-brand-slate/70">kg</span>
              </p>
              <p className="text-[11px] text-brand-slate/65 mt-0.5 truncate">
                {latestAnimal ? `${latestAnimal.arete} · ` : ''}
                {formatDateTimeDisplay(analytics.latestWeighing.fecha)}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-brand-slate/45 mt-1">--.- kg</p>
              <p className="text-[11px] text-brand-slate/60 mt-0.5">Sin pesajes registrados</p>
            </>
          )}
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            {animalFilter !== 'todos' ? 'GDP del Animal' : 'GDP Promedio Real'}
          </p>
          {analytics.averageGdpKgDay !== null ? (
            <>
              <p className="text-2xl font-bold text-brand-primary mt-1">
                {analytics.averageGdpKgDay > 0
                  ? `+${analytics.averageGdpKgDay.toFixed(2)}`
                  : analytics.averageGdpKgDay.toFixed(2)}{' '}
                <span className="text-[14px] font-semibold text-brand-slate/70">kg/día</span>
              </p>
              <p className="text-[11px] text-brand-slate/65 mt-0.5">
                Calculado sobre pesajes oficiales reales
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-brand-slate/45 mt-1">--.- kg/día</p>
              <p className="text-[11px] text-brand-slate/60 mt-0.5">
                Requiere ≥ 2 pesajes en días distintos
              </p>
            </>
          )}
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Pesajes Activos
          </p>
          <p className="text-2xl font-bold text-brand-slate mt-1">{activeCount}</p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">
            {analytics.latestByAnimal.length} animal(es) con registro
          </p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Pendientes Sync
          </p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{pendingCount}</p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">En cola local IndexedDB</p>
        </div>
      </div>

      {/* Gráfica de evolución real + Comparativa de último peso por animal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section
          aria-label="Gráfica de evolución de peso"
          className="lg:col-span-8 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
              <TrendingUp size={18} className="text-brand-primary" />
              {animalFilter !== 'todos'
                ? `Evolución de Peso — ${animalById.get(animalFilter)?.arete || 'Animal'}`
                : 'Evolución del Hato (Promedio Real por Fecha)'}
            </h2>
            <select
              aria-label="Seleccionar animal para gráfica"
              value={animalFilter}
              onChange={(e) => setAnimalFilter(e.target.value)}
              className="min-h-[36px] px-2.5 bg-surface-white border border-border-light rounded-md text-[12px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Todo el hato</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.arete} — {a.raza}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 p-5">
            <WeightEvolutionChart
              points={analytics.evolutionPoints}
              subtitle={
                animalFilter !== 'todos'
                  ? `Curva real de ${animalById.get(animalFilter)?.arete || 'animal'} (${analytics.evolutionPoints.length} pesajes)`
                  : `Promedio real del hato en ${analytics.evolutionPoints.length} jornada(s)`
              }
              emptyActionLabel="Registrar Pesaje Oficial"
              onEmptyAction={() => setFormModalState({ open: true, mode: 'create' })}
              onSelectWeighingId={(id) => {
                const found = weighings.find((w) => w.id === id);
                if (found) setSelectedWeighing(found);
              }}
            />
          </div>
        </section>

        <section
          aria-label="Último peso por animal"
          className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
            <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
              <Scale size={17} className="text-brand-primary" /> Último Peso por Animal
            </h2>
            <span className="text-[11px] font-bold text-brand-slate/55">
              {analytics.latestByAnimal.length}
            </span>
          </div>
          <div className="flex-1 p-4 overflow-y-auto max-h-[320px]">
            {analytics.latestByAnimal.length === 0 ? (
              <EmptyState
                title="Sin registros"
                message="Aquí aparecerá el último peso real de cada animal."
                icon={Scale}
              />
            ) : (
              <ul className="space-y-3">
                {analytics.latestByAnimal.map((item) => {
                  const pct = Math.max(8, Math.round((item.latestWeightKg / maxLatestKg) * 100));
                  const isFiltered = animalFilter === item.idAnimal;
                  return (
                    <li key={item.idAnimal} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[12px]">
                        <button
                          type="button"
                          onClick={() =>
                            setAnimalFilter(isFiltered ? 'todos' : item.idAnimal)
                          }
                          className={`font-bold text-left truncate cursor-pointer hover:underline ${
                            isFiltered ? 'text-brand-primary' : 'text-brand-forest'
                          }`}
                        >
                          {item.arete}
                        </button>
                        <span className="font-bold text-brand-slate shrink-0">
                          {item.latestWeightKg.toFixed(1)} kg
                        </span>
                      </div>
                      <div className="w-full h-2 bg-surface-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isFiltered ? 'bg-brand-forest' : 'bg-brand-primary'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-brand-slate/60">
                        <span>{item.totalWeighings} pesaje(s)</span>
                        <span>
                          {item.deltaKg !== null
                            ? `${item.deltaKg > 0 ? '+' : ''}${item.deltaKg.toFixed(1)} kg`
                            : 'Primer registro'}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Filtros del historial */}
      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6 relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40"
            />
            <input
              type="text"
              aria-label="Buscar pesajes"
              placeholder="Buscar por arete, báscula, responsable u observaciones…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-h-[42px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 outline-none focus:border-brand-primary"
            />
          </div>

          <div className="md:col-span-4">
            <select
              aria-label="Filtrar historial por animal"
              value={animalFilter}
              onChange={(e) => setAnimalFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Animal: Todos</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.arete} — {a.raza}
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
            <span>Mostrar pesajes desactivados</span>
          </label>
          <span>
            Mostrando <strong className="text-brand-slate">{filteredWeighings.length}</strong> de{' '}
            <strong className="text-brand-slate">{weighings.length}</strong> pesajes
          </span>
        </div>
      </div>

      {/* Historial Biométrico + Panel de Detalle */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={selectedWeighing ? 'lg:col-span-8' : 'lg:col-span-12'}>
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border-light flex items-center gap-2">
              <History size={17} className="text-brand-slate/70" />
              <h2 className="font-bold text-[15px] text-brand-slate">Historial Biométrico Real</h2>
            </div>

            {error && weighings.length === 0 ? (
              <div role="alert" className="p-6 text-center text-status-error space-y-2">
                <AlertCircle className="mx-auto" size={24} />
                <p className="font-semibold text-[14px]">No se pudo cargar el historial</p>
                <p className="text-[13px] opacity-85">{error}</p>
              </div>
            ) : loading && weighings.length === 0 ? (
              <div className="p-12 text-center text-brand-slate/60 flex flex-col items-center gap-3">
                <Loader2 size={24} className="animate-spin text-brand-primary" />
                <span>Cargando pesajes…</span>
              </div>
            ) : filteredWeighings.length === 0 ? (
              <div className="min-h-[260px] flex items-center justify-center p-6">
                <EmptyState
                  title={hasActiveFilters ? 'Sin coincidencias' : 'Sin pesajes registrados'}
                  message={
                    hasActiveFilters
                      ? 'Ningún pesaje coincide con los filtros actuales.'
                      : 'Registra el primer pesaje real de báscula para comenzar el seguimiento biométrico.'
                  }
                  icon={History}
                  actionLabel={hasActiveFilters ? 'Limpiar filtros' : 'Registrar Pesaje Oficial'}
                  onAction={
                    hasActiveFilters
                      ? () => {
                          setSearchTerm('');
                          setAnimalFilter('todos');
                        }
                      : () => setFormModalState({ open: true, mode: 'create' })
                  }
                />
              </div>
            ) : (
              <ResponsiveDataView
                items={filteredWeighings}
                getKey={(w) => w.id}
                columns={columns}
                renderCardHeader={(w) => {
                  const animal = animalById.get(w.idAnimal);
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-brand-forest">
                        {animal ? animal.arete : `Animal ${w.idAnimal.slice(0, 8)}…`} —{' '}
                        {w.pesoRealKg.toFixed(1)} kg
                      </span>
                      {renderSyncBadge(w.syncStatus)}
                    </div>
                  );
                }}
                renderCardActions={(w) => (
                  <div className="inline-flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedWeighing(w)}
                      aria-label={`Ver detalle del pesaje ${w.id}`}
                      title="Ver detalle"
                      className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-brand-primary hover:bg-brand-primary/10 rounded-md transition-colors cursor-pointer"
                    >
                      <Eye size={17} />
                    </button>
                    {!w.deletedAt && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setFormModalState({ open: true, mode: 'edit', weighing: w })
                          }
                          aria-label={`Editar pesaje ${w.id}`}
                          title="Editar"
                          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors cursor-pointer"
                        >
                          <Edit size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeactivateTarget(w);
                            setDeactivateError(null);
                          }}
                          aria-label={`Desactivar pesaje ${w.id}`}
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
        </div>

        {/* Panel de Detalle */}
        {selectedWeighing && (
          <aside
            aria-label="Detalle del pesaje seleccionado"
            className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden"
          >
            <div className="h-2 bg-brand-primary w-full" />
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-border-light pb-3">
                <div>
                  <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Detalle Biométrico
                  </span>
                  <h2 className="text-2xl font-bold text-brand-forest mt-0.5">
                    {selectedWeighing.pesoRealKg.toFixed(1)} kg
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedWeighing(null)}
                  aria-label="Cerrar detalle del pesaje"
                  className="p-1 rounded text-brand-slate/55 hover:bg-surface-secondary hover:text-brand-slate"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-primary/10 text-brand-primary">
                  {selectedWeighing.origenPesaje === 'boviscale_ia'
                    ? 'Validado BoviScale'
                    : 'Báscula oficial'}
                </span>
                {renderSyncBadge(selectedWeighing.syncStatus)}
              </div>

              <dl className="space-y-2.5 text-[13px]">
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Animal</dt>
                  <dd className="mt-0.5">
                    <Link
                      to={`/cattle/${selectedWeighing.idAnimal}`}
                      className="font-bold text-brand-primary hover:underline"
                    >
                      {animalById.get(selectedWeighing.idAnimal)?.arete ||
                        selectedWeighing.idAnimal}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Fecha</dt>
                  <dd className="text-brand-slate mt-0.5">
                    {formatDateTimeDisplay(selectedWeighing.fecha)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Fuente / Báscula
                  </dt>
                  <dd className="text-brand-slate mt-0.5">{selectedWeighing.fuenteBascula}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Responsable
                  </dt>
                  <dd className="text-brand-slate mt-0.5">{selectedWeighing.responsable}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Observaciones
                  </dt>
                  <dd className="text-brand-slate/85 mt-0.5 whitespace-pre-line">
                    {selectedWeighing.observaciones || 'Sin observaciones registradas'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Identificador UUID
                  </dt>
                  <dd className="font-mono text-[11px] text-brand-slate/70 mt-0.5 break-all">
                    {selectedWeighing.idPesaje} (v{selectedWeighing.versionRegistro})
                  </dd>
                </div>
              </dl>

              {!selectedWeighing.deletedAt && (
                <div className="flex gap-2 pt-3 border-t border-border-light">
                  <button
                    type="button"
                    onClick={() =>
                      setFormModalState({ open: true, mode: 'edit', weighing: selectedWeighing })
                    }
                    className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md border border-border-light text-[12px] font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary"
                  >
                    <Edit size={13} /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeactivateTarget(selectedWeighing);
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
        <WeighingFormModal
          mode={formModalState.mode}
          initialWeighing={formModalState.mode === 'edit' ? formModalState.weighing : undefined}
          preselectedAnimalId={animalFilter !== 'todos' ? animalFilter : undefined}
          animals={animals}
          lastWeightByAnimal={lastWeightByAnimal}
          isOnline={isOnline}
          onClose={() => setFormModalState({ open: false })}
          onSubmit={handleSaveWeighing}
        />
      )}

      {/* Modal Desactivar */}
      {deactivateTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-weighing-title"
          onClick={() => !isDeactivating && setDeactivateTarget(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2
                  id="deactivate-weighing-title"
                  className="text-[17px] font-bold text-brand-slate"
                >
                  Desactivar pesaje ({deactivateTarget.pesoRealKg.toFixed(1)} kg)
                </h2>
                <p className="text-[12px] text-brand-slate/65 mt-1">
                  El pesaje se marcará como desactivado (borrado lógico) y dejará de incluirse en la gráfica y en el cálculo de GDP.
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
