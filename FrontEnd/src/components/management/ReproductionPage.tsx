import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpDown,
  Baby,
  CheckCircle2,
  Clock,
  Edit3,
  HeartPulse,
  Info,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { useConnectivity } from '../../hooks/useConnectivity';
import type { Cattle } from '../../types/cattle';
import {
  REPRODUCTION_BACKEND_DEPENDENCY,
  type ReproductionEvent,
  type ReproductionEventInput,
  type ReproductionStage
} from '../../types/reproduction';
import {
  ReproductionService,
  type ReproductionMutationResult
} from '../../services/reproduction.service';
import { classifyReproductionStage } from '../../services/reproduction.validation';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import EmptyState from '../ui/EmptyState';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';
import ReproductionFormModal from './ReproductionFormModal';

type ViewMode = 'historial' | 'tablero';
type StageFilter = 'todos' | ReproductionStage;

type ModalState =
  | { open: false }
  | { open: true; mode: 'create'; defaultTipo?: string }
  | { open: true; mode: 'edit'; event: ReproductionEvent };

function formatDateTimeDisplay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getStageLabel(stage: ReproductionStage): string {
  switch (stage) {
    case 'servicios':
      return 'Servicio / Celo';
    case 'gestaciones':
      return 'Gestación / Diagnóstico';
    case 'partos':
      return 'Parto / Cría';
  }
}

function renderStageBadge(stage: ReproductionStage) {
  const styles: Record<ReproductionStage, string> = {
    servicios: 'bg-sky-500/15 text-sky-800 border-sky-500/30',
    gestaciones: 'bg-pink-500/15 text-pink-700 border-pink-500/30',
    partos: 'bg-emerald-500/15 text-emerald-800 border-emerald-500/30'
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${styles[stage]}`}
    >
      {getStageLabel(stage)}
    </span>
  );
}

function renderSyncBadge(syncStatus: ReproductionEvent['syncStatus']) {
  if (syncStatus === 'synced') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-success/15 text-status-success">
        Sincronizado
      </span>
    );
  }
  if (syncStatus === 'conflict') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-danger/15 text-status-danger">
        Conflicto
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-warning/20 text-brand-dark">
      <Clock size={11} /> Pendiente local
    </span>
  );
}

export default function ReproductionPage() {
  const { isOnline } = useConnectivity();

  const [events, setEvents] = useState<ReproductionEvent[]>([]);
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [backendNotice, setBackendNotice] = useState<string | null>(
    REPRODUCTION_BACKEND_DEPENDENCY.summaryMessage
  );
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('historial');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [animalFilter, setAnimalFilter] = useState<string>('todos');
  const [stageFilter, setStageFilter] = useState<StageFilter>('todos');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  const [modalState, setModalState] = useState<ModalState>({ open: false });
  const [confirmDeactivate, setConfirmDeactivate] = useState<ReproductionEvent | null>(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);

  const loadData = useCallback(async (withDeleted: boolean, order: 'asc' | 'desc') => {
    setLoading(true);
    setError(null);
    try {
      const result = await ReproductionService.getAll({
        includeDeleted: withDeleted,
        order
      });
      setEvents(result.data);
      setAnimals(result.animals);
      setBackendNotice(result.backendNotice);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo cargar el historial reproductivo.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await ReproductionService.getAll({
          includeDeleted,
          order: sortOrder
        });
        if (!active) return;
        setEvents(result.data);
        setAnimals(result.animals);
        setBackendNotice(result.backendNotice);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el historial reproductivo.'
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

  const activeEvents = useMemo(() => events.filter((ev) => !ev.deletedAt), [events]);

  const stats = useMemo(() => {
    let servicios = 0;
    let gestaciones = 0;
    let partos = 0;
    let pendingSync = 0;

    for (const ev of activeEvents) {
      const stage = classifyReproductionStage(ev.tipo, ev.resultado);
      if (stage === 'servicios') servicios++;
      else if (stage === 'gestaciones') gestaciones++;
      else partos++;

      if (ev.syncStatus !== 'synced') pendingSync++;
    }

    return {
      total: activeEvents.length,
      servicios,
      gestaciones,
      partos,
      pendingSync
    };
  }, [activeEvents]);

  const filteredEvents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return events.filter((ev) => {
      if (!includeDeleted && ev.deletedAt) return false;
      if (animalFilter !== 'todos' && ev.idAnimal !== animalFilter) return false;
      if (stageFilter !== 'todos' && classifyReproductionStage(ev.tipo, ev.resultado) !== stageFilter) {
        return false;
      }

      if (!query) return true;
      const animal = animalById.get(ev.idAnimal);
      return (
        (animal?.arete || '').toLowerCase().includes(query) ||
        (animal?.raza || '').toLowerCase().includes(query) ||
        ev.tipo.toLowerCase().includes(query) ||
        (ev.resultado || '').toLowerCase().includes(query) ||
        (ev.observaciones || '').toLowerCase().includes(query)
      );
    });
  }, [events, includeDeleted, animalFilter, stageFilter, searchTerm, animalById]);

  const boardColumns = useMemo(() => {
    const servicios: ReproductionEvent[] = [];
    const gestaciones: ReproductionEvent[] = [];
    const partos: ReproductionEvent[] = [];

    for (const ev of filteredEvents) {
      if (ev.deletedAt) continue;
      const stage = classifyReproductionStage(ev.tipo, ev.resultado);
      if (stage === 'servicios') servicios.push(ev);
      else if (stage === 'gestaciones') gestaciones.push(ev);
      else partos.push(ev);
    }

    return { servicios, gestaciones, partos };
  }, [filteredEvents]);

  const handleSave = async (input: ReproductionEventInput): Promise<ReproductionMutationResult> => {
    const isEdit = modalState.open && modalState.mode === 'edit';
    const result = isEdit
      ? await ReproductionService.update(modalState.event.id, input)
      : await ReproductionService.create(input);

    setFeedbackMsg(result.syncMessage);
    await loadData(includeDeleted, sortOrder);
    return result;
  };

  const handleConfirmDeactivate = async () => {
    if (!confirmDeactivate || isDeactivating) return;
    setIsDeactivating(true);
    setError(null);
    try {
      const outcome = await ReproductionService.deactivate(confirmDeactivate.id);
      setFeedbackMsg(outcome.syncMessage);
      setConfirmDeactivate(null);
      await loadData(includeDeleted, sortOrder);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo desactivar el evento reproductivo.'
      );
    } finally {
      setIsDeactivating(false);
    }
  };

  const renderEventActions = (ev: ReproductionEvent) => {
    if (ev.deletedAt) {
      return <span className="text-[11px] text-brand-slate/50 italic">Registro desactivado</span>;
    }

    return (
      <div className="flex items-center gap-1.5 justify-end">
        <button
          type="button"
          onClick={() => setModalState({ open: true, mode: 'edit', event: ev })}
          aria-label={`Editar evento ${ev.tipo}`}
          className="px-2.5 py-1.5 text-[12px] font-semibold text-brand-primary hover:bg-brand-primary/10 rounded-md inline-flex items-center gap-1 transition-colors"
        >
          <Edit3 size={13} /> Editar
        </button>
        <button
          type="button"
          onClick={() => setConfirmDeactivate(ev)}
          aria-label={`Desactivar evento ${ev.tipo}`}
          className="px-2.5 py-1.5 text-[12px] font-semibold text-status-danger hover:bg-status-danger/10 rounded-md inline-flex items-center gap-1 transition-colors"
        >
          <Trash2 size={13} /> Desactivar
        </button>
      </div>
    );
  };

  const columns: ResponsiveColumn<ReproductionEvent>[] = [
    {
      key: 'evento',
      header: 'Evento / Animal',
      hideOnCard: true,
      renderCell: (ev) => {
        const animal = animalById.get(ev.idAnimal);
        const stage = classifyReproductionStage(ev.tipo, ev.resultado);
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-brand-forest">{ev.tipo}</span>
              {renderStageBadge(stage)}
              {ev.deletedAt && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-slate/15 text-brand-slate/70">
                  Desactivado
                </span>
              )}
              {renderSyncBadge(ev.syncStatus)}
            </div>
            <p className="text-[12px] text-brand-slate/75">
              <Link
                to={`/cattle/${ev.idAnimal}`}
                className="font-semibold text-brand-primary hover:underline"
              >
                {animal ? animal.arete : ev.idAnimal.slice(0, 8)}
              </Link>
              {animal ? ` · ${animal.raza} (${animal.sexo})` : ''}
            </p>
          </div>
        );
      }
    },
    {
      key: 'fecha',
      header: 'Fecha',
      renderCell: (ev) => (
        <span className="text-[12px] text-brand-slate/85">{formatDateTimeDisplay(ev.fecha)}</span>
      )
    },
    {
      key: 'resultado',
      header: 'Resultado',
      renderCell: (ev) => (
        <span className="text-[12px] font-medium text-brand-slate">
          {ev.resultado || <span className="text-brand-slate/45">—</span>}
        </span>
      )
    },
    {
      key: 'observaciones',
      header: 'Observaciones',
      renderCell: (ev) => (
        <span className="text-[12px] text-brand-slate/75 line-clamp-2">
          {ev.observaciones || <span className="text-brand-slate/45">—</span>}
        </span>
      )
    },
    {
      key: 'acciones',
      header: 'Acciones',
      hideOnCard: true,
      renderCell: (ev) => renderEventActions(ev)
    }
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Eficiencia Reproductiva
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Reproducción y Cría
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(includeDeleted, sortOrder)}
            disabled={loading}
            aria-label="Actualizar historial reproductivo"
            className="min-h-[42px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>

          <button
            type="button"
            onClick={() => setModalState({ open: true, mode: 'create' })}
            className="min-h-[42px] flex items-center gap-1.5 bg-pink-600 hover:bg-pink-700 text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Registrar Evento Reproductivo
          </button>
        </div>
      </header>

      {backendNotice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-brand-slate text-[12px] flex items-start gap-2.5"
        >
          <Info size={16} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-brand-forest">
              Dependencia de Backend documentada ({REPRODUCTION_BACKEND_DEPENDENCY.entityName})
            </p>
            <p>{backendNotice}</p>
          </div>
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

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-[13px] font-medium flex items-center gap-2"
        >
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPIs reales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/60 text-[12px] font-semibold">
            <span>Eventos Activos</span>
            <HeartPulse size={16} className="text-pink-600" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-forest mt-1">{stats.total}</p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">
            {stats.pendingSync > 0
              ? `${stats.pendingSync} pendientes en cola local`
              : 'Sin pendientes en cola'}
          </p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/60 text-[12px] font-semibold">
            <span>Servicios / Celos</span>
            <Sparkles size={16} className="text-sky-600" />
          </div>
          <p className="text-2xl font-condensed font-bold text-sky-700 mt-1">{stats.servicios}</p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Montas, celos e inseminaciones</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/60 text-[12px] font-semibold">
            <span>Gestaciones / Diagnósticos</span>
            <HeartPulse size={16} className="text-pink-500" />
          </div>
          <p className="text-2xl font-condensed font-bold text-pink-600 mt-1">
            {stats.gestaciones}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Palpaciones y gestaciones</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/60 text-[12px] font-semibold">
            <span>Partos y Crías</span>
            <Baby size={16} className="text-emerald-600" />
          </div>
          <p className="text-2xl font-condensed font-bold text-emerald-700 mt-1">{stats.partos}</p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Nacimientos, abortos y destetes</p>
        </div>
      </div>

      {/* Selector de vista y barra de filtros */}
      <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border-light bg-surface-secondary/40 p-1 w-fit">
            <button
              type="button"
              onClick={() => setViewMode('historial')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                viewMode === 'historial'
                  ? 'bg-surface-white text-brand-forest shadow-sm'
                  : 'text-brand-slate/70 hover:text-brand-forest'
              }`}
            >
              <List size={14} /> Historial Cronológico
            </button>
            <button
              type="button"
              onClick={() => setViewMode('tablero')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                viewMode === 'tablero'
                  ? 'bg-surface-white text-brand-forest shadow-sm'
                  : 'text-brand-slate/70 hover:text-brand-forest'
              }`}
            >
              <LayoutGrid size={14} /> Tablero por Etapa
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              className="h-[38px] px-3 bg-surface-white border border-border-light hover:border-brand-primary rounded-md text-[12px] font-semibold text-brand-slate inline-flex items-center gap-1.5 transition-colors"
            >
              <ArrowUpDown size={14} />
              {sortOrder === 'desc' ? 'Más recientes primero' : 'Más antiguos primero'}
            </button>

            <label className="inline-flex items-center gap-2 text-[12px] text-brand-slate cursor-pointer select-none px-2">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="rounded border-border-light text-pink-600 focus:ring-pink-600"
              />
              Mostrar desactivados
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
            />
            <input
              type="search"
              placeholder="Buscar por arete, evento, resultado u observaciones..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Buscar eventos reproductivos"
              className="w-full h-[38px] pl-9 pr-3 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            />
          </div>

          <select
            aria-label="Filtrar por animal"
            value={animalFilter}
            onChange={(e) => setAnimalFilter(e.target.value)}
            className="h-[38px] px-3 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
          >
            <option value="todos">Todos los animales ({animals.length})</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.arete} — {a.raza} ({a.sexo})
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por etapa reproductiva"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as StageFilter)}
            className="h-[38px] px-3 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
          >
            <option value="todos">Todas las etapas</option>
            <option value="servicios">Servicios e Inseminaciones</option>
            <option value="gestaciones">Gestaciones y Diagnósticos</option>
            <option value="partos">Partos y Nacimientos</option>
          </select>
        </div>
      </div>

      {/* Contenido principal */}
      {loading ? (
        <div className="bg-surface-white border border-border-light rounded-xl p-10 text-center text-brand-slate/60 text-[13px]">
          Cargando historial reproductivo...
        </div>
      ) : viewMode === 'historial' ? (
        filteredEvents.length === 0 ? (
          <div className="bg-surface-white border border-border-light rounded-xl p-6 shadow-sm">
            <EmptyState
              title="Sin eventos reproductivos registrados"
              message={
                searchTerm || animalFilter !== 'todos' || stageFilter !== 'todos'
                  ? 'No se encontraron eventos con los filtros seleccionados.'
                  : 'Registra celos, servicios, palpaciones o partos para construir el historial reproductivo real del hato.'
              }
              icon={HeartPulse}
              actionLabel="Registrar Evento Reproductivo"
              onAction={() => setModalState({ open: true, mode: 'create' })}
            />
          </div>
        ) : (
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
            <ResponsiveDataView<ReproductionEvent>
              items={filteredEvents}
              columns={columns}
              getKey={(ev) => ev.id}
              renderCardHeader={(ev) => {
                const animal = animalById.get(ev.idAnimal);
                const stage = classifyReproductionStage(ev.tipo, ev.resultado);
                return (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-brand-forest text-[15px]">{ev.tipo}</span>
                      {renderStageBadge(stage)}
                      {renderSyncBadge(ev.syncStatus)}
                    </div>
                    <p className="text-[12px] text-brand-slate/75">
                      {animal ? `${animal.arete} · ${animal.raza} (${animal.sexo})` : ev.idAnimal}
                    </p>
                  </div>
                );
              }}
              renderCardActions={renderEventActions}
            />
          </div>
        )
      ) : (
        /* Tablero real de 3 etapas */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              key: 'servicios' as const,
              title: 'Servicios e Inseminaciones',
              accent: 'border-t-sky-500',
              headerBg: 'bg-surface-secondary/50',
              defaultTipo: 'Inseminación Artificial',
              icon: Sparkles,
              emptyMsg: 'Sin servicios o celos registrados aún.',
              items: boardColumns.servicios
            },
            {
              key: 'gestaciones' as const,
              title: 'Gestaciones Confirmadas',
              accent: 'border-t-pink-500',
              headerBg: 'bg-pink-50/40',
              defaultTipo: 'Gestación Confirmada',
              icon: HeartPulse,
              emptyMsg: 'Las palpaciones y diagnósticos de gestación aparecerán aquí.',
              items: boardColumns.gestaciones
            },
            {
              key: 'partos' as const,
              title: 'Partos y Nacimientos',
              accent: 'border-t-emerald-500',
              headerBg: 'bg-surface-secondary/50',
              defaultTipo: 'Parto',
              icon: Baby,
              emptyMsg: 'Sin partos o nacimientos registrados aún.',
              items: boardColumns.partos
            }
          ].map((col) => (
            <section
              key={col.key}
              className={`bg-surface-white border border-border-light border-t-4 ${col.accent} rounded-xl shadow-sm flex flex-col min-h-[380px]`}
            >
              <div
                className={`p-4 border-b border-border-light ${col.headerBg} flex items-center justify-between gap-2`}
              >
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-brand-slate text-[14px]">{col.title}</h2>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-surface-white border border-border-light text-brand-slate">
                    {col.items.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setModalState({ open: true, mode: 'create', defaultTipo: col.defaultTipo })
                  }
                  aria-label={`Agregar a ${col.title}`}
                  className="p-1.5 rounded-md text-brand-slate/70 hover:text-brand-forest hover:bg-surface-white transition-colors"
                >
                  <Plus size={15} />
                </button>
              </div>

              <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[540px]">
                {col.items.length === 0 ? (
                  <EmptyState
                    title="Sin registros"
                    message={col.emptyMsg}
                    icon={col.icon}
                    actionLabel="Registrar"
                    onAction={() =>
                      setModalState({
                        open: true,
                        mode: 'create',
                        defaultTipo: col.defaultTipo
                      })
                    }
                  />
                ) : (
                  col.items.map((ev) => {
                    const animal = animalById.get(ev.idAnimal);
                    return (
                      <article
                        key={ev.id}
                        className="p-3 rounded-lg border border-border-light bg-surface-app/25 hover:border-brand-primary/40 transition-colors space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-bold text-[13px] text-brand-forest">{ev.tipo}</p>
                            <p className="text-[12px] text-brand-slate/75">
                              {animal ? `${animal.arete} · ${animal.raza}` : ev.idAnimal.slice(0, 8)}
                            </p>
                          </div>
                          {renderSyncBadge(ev.syncStatus)}
                        </div>
                        <p className="text-[11px] text-brand-slate/65">
                          {formatDateTimeDisplay(ev.fecha)}
                        </p>
                        {ev.resultado && (
                          <p className="text-[12px] font-medium text-brand-slate">
                            Resultado: {ev.resultado}
                          </p>
                        )}
                        {ev.observaciones && (
                          <p className="text-[12px] text-brand-slate/70 line-clamp-2">
                            {ev.observaciones}
                          </p>
                        )}
                        <div className="pt-1 border-t border-border-light/70 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setModalState({ open: true, mode: 'edit', event: ev })}
                            className="text-[11px] font-semibold text-brand-primary hover:underline inline-flex items-center gap-1"
                          >
                            <Edit3 size={12} /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeactivate(ev)}
                            className="text-[11px] font-semibold text-status-danger hover:underline inline-flex items-center gap-1"
                          >
                            <Trash2 size={12} /> Desactivar
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Modal de creación / edición */}
      {modalState.open && (
        <ReproductionFormModal
          mode={modalState.mode}
          initialEvent={modalState.mode === 'edit' ? modalState.event : undefined}
          defaultTipo={modalState.mode === 'create' ? modalState.defaultTipo : undefined}
          animals={animals}
          isOnline={isOnline}
          onClose={() => setModalState({ open: false })}
          onSubmit={handleSave}
        />
      )}

      {/* Modal de confirmación de desactivación */}
      {confirmDeactivate && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-deactivate-repro-title"
          onClick={() => !isDeactivating && setConfirmDeactivate(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="confirm-deactivate-repro-title"
              className="text-lg font-condensed font-bold text-brand-forest"
            >
              Desactivar evento reproductivo
            </h2>
            <p className="text-[13px] text-brand-slate/80">
              ¿Deseas desactivar el evento <strong>{confirmDeactivate.tipo}</strong> registrado el{' '}
              {formatDateTimeDisplay(confirmDeactivate.fecha)}? Se aplicará baja lógica local en
              IndexedDB.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeactivate(null)}
                disabled={isDeactivating}
                className="min-h-[38px] px-4 bg-surface-white border border-border-light rounded-md text-[13px] font-semibold text-brand-slate"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeactivate()}
                disabled={isDeactivating}
                className="min-h-[38px] px-4 bg-status-danger hover:bg-red-700 text-white rounded-md text-[13px] font-semibold disabled:opacity-50"
              >
                {isDeactivating ? 'Desactivando...' : 'Confirmar Desactivación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
