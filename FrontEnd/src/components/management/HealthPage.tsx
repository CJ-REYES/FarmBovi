import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Syringe,
  ShieldCheck,
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
  Clock
} from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import type {
  HealthEvent,
  HealthEventInput,
  Treatment,
  TreatmentEstado
} from '../../types/health';
import { isTreatmentPending } from '../../services/health.validation';
import {
  HealthService,
  type HealthEventMutationResult,
  type TreatmentMutationResult
} from '../../services/health.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import EmptyState from '../ui/EmptyState';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';
import HealthEventFormModal from './HealthEventFormModal';
import TreatmentFormModal, { type TreatmentFormSubmitPayload } from './TreatmentFormModal';

function formatDateTimeDisplay(raw: string | null): string {
  if (!raw) return 'Sin fecha fin';
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

function renderSyncBadge(syncStatus: HealthEvent['syncStatus']) {
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

function renderTreatmentEstadoBadge(estado: TreatmentEstado, deletedAt: string | null) {
  if (deletedAt) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-slate/15 text-brand-slate/70">
        Desactivado
      </span>
    );
  }
  switch (estado) {
    case 'Completado':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-success/10 text-status-success">
          Completado
        </span>
      );
    case 'En curso':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-info/15 text-status-info">
          En curso
        </span>
      );
    case 'Suspendido':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-error/15 text-status-error">
          Suspendido
        </span>
      );
    case 'Pendiente':
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-warning/20 text-amber-900">
          Pendiente
        </span>
      );
  }
}

export default function HealthPage() {
  const [searchParams] = useSearchParams();
  const initialAnimalParam = searchParams.get('animalId') || 'todos';

  const { isOnline } = useSyncStatus();

  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Pestaña activa y filtros
  const [activeTab, setActiveTab] = useState<'eventos' | 'tratamientos'>('eventos');
  const [pendingOnly, setPendingOnly] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [animalFilter, setAnimalFilter] = useState<string>(initialAnimalParam);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  // Modales y selección
  const [eventModalState, setEventModalState] = useState<
    | { open: false }
    | { open: true; mode: 'create' }
    | { open: true; mode: 'edit'; event: HealthEvent }
  >({ open: false });

  const [treatmentModalState, setTreatmentModalState] = useState<
    | { open: false }
    | { open: true; mode: 'create'; preselectedEventId?: string }
    | { open: true; mode: 'edit'; treatment: Treatment }
  >({ open: false });

  const [selectedEvent, setSelectedEvent] = useState<HealthEvent | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<
    { kind: 'event'; item: HealthEvent } | { kind: 'treatment'; item: Treatment } | null
  >(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const loadData = useCallback(async (withDeleted: boolean, order: 'asc' | 'desc') => {
    setLoading(true);
    setError(null);
    try {
      const result = await HealthService.getAll({
        includeDeleted: withDeleted,
        order
      });
      setEvents(result.events);
      setTreatments(result.treatments);
      setAnimals(result.animals);
      setApiWarning(result.warning);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo cargar el historial sanitario.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await HealthService.getAll({
          includeDeleted,
          order: sortOrder
        });
        if (!active) return;
        setEvents(result.events);
        setTreatments(result.treatments);
        setAnimals(result.animals);
        setApiWarning(result.warning);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el historial sanitario.'
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
  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const treatmentsByEventId = useMemo(() => {
    const map = new Map<string, Treatment[]>();
    for (const t of treatments) {
      if (!includeDeleted && t.deletedAt) continue;
      const list = map.get(t.idEventoSanitario) ?? [];
      list.push(t);
      map.set(t.idEventoSanitario, list);
    }
    return map;
  }, [treatments, includeDeleted]);

  const stats = useMemo(() => {
    const activeEvents = events.filter((e) => !e.deletedAt);
    const activeTreatments = treatments.filter((t) => !t.deletedAt);
    return {
      totalEvents: activeEvents.length,
      pendingTreatments: activeTreatments.filter((t) => isTreatmentPending(t.estado)).length,
      completedTreatments: activeTreatments.filter((t) => t.estado === 'Completado').length,
      pendingSync:
        activeEvents.filter((e) => e.syncStatus !== 'synced').length +
        activeTreatments.filter((t) => t.syncStatus !== 'synced').length
    };
  }, [events, treatments]);

  const filteredEvents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return events.filter((ev) => {
      if (!includeDeleted && ev.deletedAt) return false;
      if (animalFilter !== 'todos' && ev.idAnimal !== animalFilter) return false;
      if (!query) return true;

      const animal = animalById.get(ev.idAnimal);
      return (
        (animal?.arete || '').toLowerCase().includes(query) ||
        ev.tipo.toLowerCase().includes(query) ||
        (ev.sintomas || '').toLowerCase().includes(query) ||
        (ev.diagnostico || '').toLowerCase().includes(query) ||
        ev.responsable.toLowerCase().includes(query) ||
        (ev.observaciones || '').toLowerCase().includes(query)
      );
    });
  }, [events, includeDeleted, animalFilter, searchTerm, animalById]);

  const filteredTreatments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return treatments.filter((t) => {
      if (!includeDeleted && t.deletedAt) return false;
      if (pendingOnly && !isTreatmentPending(t.estado)) return false;
      if (animalFilter !== 'todos' && t.idAnimal !== animalFilter) return false;
      if (!query) return true;

      const animal = animalById.get(t.idAnimal);
      const ev = eventById.get(t.idEventoSanitario);
      return (
        (animal?.arete || '').toLowerCase().includes(query) ||
        t.producto.toLowerCase().includes(query) ||
        t.frecuencia.toLowerCase().includes(query) ||
        t.responsable.toLowerCase().includes(query) ||
        t.estado.toLowerCase().includes(query) ||
        (ev?.tipo || '').toLowerCase().includes(query)
      );
    });
  }, [treatments, includeDeleted, pendingOnly, animalFilter, searchTerm, animalById, eventById]);

  const handleSaveEvent = async (input: HealthEventInput): Promise<HealthEventMutationResult> => {
    const isEdit = eventModalState.open && eventModalState.mode === 'edit';
    const result = isEdit
      ? await HealthService.updateEvent(eventModalState.event.id, input)
      : await HealthService.createEvent(input);

    setFeedbackMsg(
      result.synced
        ? isEdit
          ? `Evento sanitario "${result.event.tipo}" actualizado y sincronizado.`
          : `Evento sanitario "${result.event.tipo}" registrado y sincronizado.`
        : result.syncMessage || `Evento sanitario "${result.event.tipo}" guardado localmente.`
    );
    await loadData(includeDeleted, sortOrder);
    if (selectedEvent && selectedEvent.id === result.event.id) {
      setSelectedEvent(result.event);
    }
    return result;
  };

  const handleSaveTreatment = async (
    payload: TreatmentFormSubmitPayload
  ): Promise<TreatmentMutationResult> => {
    const isEdit = treatmentModalState.open && treatmentModalState.mode === 'edit';
    let result: TreatmentMutationResult;

    if (isEdit) {
      result = await HealthService.updateTreatment(
        treatmentModalState.treatment.id,
        payload.treatment
      );
    } else if (payload.inlineEvent) {
      const createdEvent = await HealthService.createEvent(payload.inlineEvent);
      result = await HealthService.createTreatment({
        ...payload.treatment,
        idEventoSanitario: createdEvent.event.id
      });
    } else {
      result = await HealthService.createTreatment(payload.treatment);
    }

    setFeedbackMsg(
      result.synced
        ? isEdit
          ? `Tratamiento "${result.treatment.producto}" actualizado y sincronizado.`
          : `Tratamiento "${result.treatment.producto}" registrado y sincronizado.`
        : result.syncMessage || `Tratamiento "${result.treatment.producto}" guardado localmente.`
    );
    await loadData(includeDeleted, sortOrder);
    return result;
  };

  const handleQuickCompleteTreatment = async (treatment: Treatment) => {
    try {
      const result = await HealthService.setTreatmentEstado(treatment.id, 'Completado');
      setFeedbackMsg(
        result.synced
          ? `Tratamiento "${treatment.producto}" marcado como Completado y sincronizado.`
          : result.syncMessage || `Tratamiento "${treatment.producto}" marcado como Completado localmente.`
      );
      await loadData(includeDeleted, sortOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el estado del tratamiento.');
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget || isDeactivating) return;
    setIsDeactivating(true);
    setDeactivateError(null);

    try {
      if (deactivateTarget.kind === 'event') {
        const result = await HealthService.deactivateEvent(deactivateTarget.item.id);
        setFeedbackMsg(
          result.synced
            ? 'Evento sanitario desactivado y sincronizado.'
            : result.syncMessage || 'Evento sanitario desactivado localmente.'
        );
        if (selectedEvent?.id === deactivateTarget.item.id) {
          setSelectedEvent(null);
        }
      } else {
        const result = await HealthService.deactivateTreatment(deactivateTarget.item.id);
        setFeedbackMsg(
          result.synced
            ? 'Tratamiento desactivado y sincronizado.'
            : result.syncMessage || 'Tratamiento desactivado localmente.'
        );
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

  const eventColumns: ResponsiveColumn<HealthEvent>[] = [
    {
      key: 'evento',
      header: 'Evento / Animal',
      hideOnCard: true,
      renderCell: (ev) => {
        const animal = animalById.get(ev.idAnimal);
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setSelectedEvent(ev)}
                className="font-bold text-brand-forest hover:text-brand-primary hover:underline text-left cursor-pointer"
              >
                {ev.tipo}
              </button>
              {ev.deletedAt && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-slate/15 text-brand-slate/70">
                  Desactivado
                </span>
              )}
              {renderSyncBadge(ev.syncStatus)}
            </div>
            <p className="text-[12px] text-brand-slate/70">
              <Link
                to={`/cattle/${ev.idAnimal}`}
                className="font-semibold text-brand-primary hover:underline"
              >
                {animal ? animal.arete : ev.idAnimal.slice(0, 8)}
              </Link>
              {ev.diagnostico ? ` · ${ev.diagnostico}` : ev.sintomas ? ` · ${ev.sintomas}` : ''}
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
      key: 'responsable',
      header: 'Responsable',
      renderCell: (ev) => <span className="text-[12px] text-brand-slate">{ev.responsable}</span>
    },
    {
      key: 'tratamientos',
      header: 'Tratamientos',
      renderCell: (ev) => {
        const linked = treatmentsByEventId.get(ev.id) ?? [];
        const pending = linked.filter((t) => !t.deletedAt && isTreatmentPending(t.estado)).length;
        return (
          <span className="text-[12px] font-semibold text-brand-slate">
            {linked.length} {pending > 0 ? `(${pending} pend.)` : ''}
          </span>
        );
      }
    }
  ];

  const treatmentColumns: ResponsiveColumn<Treatment>[] = [
    {
      key: 'producto',
      header: 'Tratamiento / Animal',
      hideOnCard: true,
      renderCell: (t) => {
        const animal = animalById.get(t.idAnimal);
        const ev = eventById.get(t.idEventoSanitario);
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-brand-forest">{t.producto}</span>
              {renderTreatmentEstadoBadge(t.estado, t.deletedAt)}
              {renderSyncBadge(t.syncStatus)}
            </div>
            <p className="text-[12px] text-brand-slate/70">
              {animal ? (
                <Link
                  to={`/cattle/${t.idAnimal}`}
                  className="font-semibold text-brand-primary hover:underline"
                >
                  {animal.arete}
                </Link>
              ) : (
                'Animal'
              )}
              {ev ? ` · ${ev.tipo}` : ''}
            </p>
          </div>
        );
      }
    },
    {
      key: 'dosis',
      header: 'Dosis y Frecuencia',
      renderCell: (t) => (
        <div className="text-[12px]">
          <span className="font-bold text-brand-slate">
            {t.dosis} {t.unidadDosis}
          </span>
          {t.viaAdministracion ? ` (${t.viaAdministracion})` : ''}
          <p className="text-[11px] text-brand-slate/65">{t.frecuencia}</p>
        </div>
      )
    },
    {
      key: 'fechas',
      header: 'Inicio / Fin',
      renderCell: (t) => (
        <div className="text-[12px] text-brand-slate/85">
          <p>{formatDateTimeDisplay(t.fechaInicio)}</p>
          {t.fechaFin && (
            <p className="text-[11px] text-brand-slate/60">Fin: {formatDateTimeDisplay(t.fechaFin)}</p>
          )}
        </div>
      )
    },
    {
      key: 'responsable',
      header: 'Responsable',
      renderCell: (t) => <span className="text-[12px] text-brand-slate">{t.responsable}</span>
    }
  ];

  const selectedEventTreatments = selectedEvent
    ? (treatmentsByEventId.get(selectedEvent.id) ?? [])
    : [];

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Manejo Sanitario
          </span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Salud y Tratamientos
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(includeDeleted, sortOrder)}
            disabled={loading}
            aria-label="Actualizar sanidad"
            className="min-h-[42px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            type="button"
            onClick={() => setEventModalState({ open: true, mode: 'create' })}
            className="min-h-[42px] flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Registrar Evento Sanitario
          </button>
          <button
            type="button"
            onClick={() => setTreatmentModalState({ open: true, mode: 'create' })}
            className="min-h-[42px] flex items-center gap-1.5 bg-status-info hover:bg-blue-700 text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Syringe size={15} /> Nuevo Tratamiento
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
            Trabajando sin conexión. Los eventos sanitarios y tratamientos se guardan en IndexedDB y se sincronizarán en orden al reconectar.
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

      {/* KPIs reales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Eventos Sanitarios
          </p>
          <p className="text-2xl font-bold text-brand-forest mt-1">{stats.totalEvents}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setActiveTab('tratamientos');
            setPendingOnly(true);
          }}
          className="text-left bg-surface-white border border-border-light hover:border-status-info rounded-xl p-4 shadow-sm transition-colors cursor-pointer"
        >
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Tratamientos Pendientes
          </p>
          <p className="text-2xl font-bold text-status-info mt-1">{stats.pendingTreatments}</p>
        </button>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Tratamientos Completados
          </p>
          <p className="text-2xl font-bold text-status-success mt-1">
            {stats.completedTreatments}
          </p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Pendientes Sync
          </p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{stats.pendingSync}</p>
        </div>
      </div>

      {/* Pestañas: Historial Sanitario vs Tratamientos Pendientes / Todos */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light pb-2">
        <div role="tablist" aria-label="Vistas de sanidad" className="flex items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'eventos'}
            onClick={() => setActiveTab('eventos')}
            className={`min-h-[40px] px-4 rounded-lg text-[13px] font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'eventos'
                ? 'bg-brand-primary text-white shadow-sm'
                : 'bg-surface-white border border-border-light text-brand-slate hover:border-brand-primary'
            }`}
          >
            <ShieldCheck size={15} /> Historial Sanitario ({stats.totalEvents})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tratamientos'}
            onClick={() => setActiveTab('tratamientos')}
            className={`min-h-[40px] px-4 rounded-lg text-[13px] font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'tratamientos'
                ? 'bg-status-info text-white shadow-sm'
                : 'bg-surface-white border border-border-light text-brand-slate hover:border-status-info'
            }`}
          >
            <Clock size={15} /> Tratamientos ({stats.pendingTreatments} pend.)
          </button>
        </div>

        {activeTab === 'tratamientos' && (
          <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-brand-slate cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={() => setPendingOnly((prev) => !prev)}
              className="rounded border-border-dark text-status-info focus:ring-status-info"
            />
            <span>Solo tratamientos pendientes / en curso</span>
          </label>
        )}
      </div>

      {/* Filtros */}
      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6 relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40"
            />
            <input
              type="text"
              aria-label="Buscar en sanidad"
              placeholder="Buscar por arete, tipo, diagnóstico, producto o responsable…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-h-[42px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 outline-none focus:border-brand-primary"
            />
          </div>

          <div className="md:col-span-4">
            <select
              aria-label="Filtrar por animal"
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
            <span>Mostrar registros desactivados</span>
          </label>
          <span>
            {activeTab === 'eventos'
              ? `Mostrando ${filteredEvents.length} de ${events.length} eventos`
              : `Mostrando ${filteredTreatments.length} de ${treatments.length} tratamientos`}
          </span>
        </div>
      </div>

      {/* Contenido de la pestaña */}
      {activeTab === 'eventos' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className={selectedEvent ? 'lg:col-span-8' : 'lg:col-span-12'}>
            {error && events.length === 0 ? (
              <div
                role="alert"
                className="bg-status-error/10 border border-status-error/25 rounded-xl p-6 text-center text-status-error space-y-2"
              >
                <AlertCircle className="mx-auto" size={24} />
                <p className="font-semibold text-[14px]">No se pudo cargar el historial</p>
                <p className="text-[13px] opacity-85">{error}</p>
              </div>
            ) : loading && events.length === 0 ? (
              <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-12 text-center text-brand-slate/60 flex flex-col items-center gap-3">
                <Loader2 size={24} className="animate-spin text-brand-primary" />
                <span>Cargando historial sanitario…</span>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="bg-surface-white border border-border-light rounded-xl shadow-sm min-h-[300px] flex items-center justify-center p-6">
                <EmptyState
                  title="Sin eventos sanitarios registrados"
                  message="Registra vacunaciones, desparasitaciones, revisiones o diagnósticos para iniciar el expediente sanitario."
                  icon={Syringe}
                  actionLabel="Registrar Evento Sanitario"
                  onAction={() => setEventModalState({ open: true, mode: 'create' })}
                />
              </div>
            ) : (
              <ResponsiveDataView
                items={filteredEvents}
                getKey={(ev) => ev.id}
                columns={eventColumns}
                renderCardHeader={(ev) => (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedEvent(ev)}
                      className="font-bold text-brand-forest hover:underline text-left"
                    >
                      {ev.tipo}
                    </button>
                    {renderSyncBadge(ev.syncStatus)}
                  </div>
                )}
                renderCardActions={(ev) => (
                  <div className="inline-flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedEvent(ev)}
                      aria-label={`Ver detalle del evento ${ev.tipo}`}
                      title="Ver detalle y tratamientos"
                      className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-brand-primary hover:bg-brand-primary/10 rounded-md transition-colors cursor-pointer"
                    >
                      <Eye size={17} />
                    </button>
                    {!ev.deletedAt && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setTreatmentModalState({
                              open: true,
                              mode: 'create',
                              preselectedEventId: ev.id
                            })
                          }
                          aria-label={`Agregar tratamiento a ${ev.tipo}`}
                          title="Agregar tratamiento"
                          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors cursor-pointer"
                        >
                          <Syringe size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEventModalState({ open: true, mode: 'edit', event: ev })
                          }
                          aria-label={`Editar evento ${ev.tipo}`}
                          title="Editar"
                          className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors cursor-pointer"
                        >
                          <Edit size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeactivateTarget({ kind: 'event', item: ev });
                            setDeactivateError(null);
                          }}
                          aria-label={`Desactivar evento ${ev.tipo}`}
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

          {/* Panel de Detalle del Evento Sanitario + sus Tratamientos */}
          {selectedEvent && (
            <aside
              aria-label="Detalle del evento sanitario"
              className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden"
            >
              <div className="h-2 bg-status-info w-full" />
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-2 border-b border-border-light pb-3">
                  <div>
                    <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                      Expediente Clínico
                    </span>
                    <h2 className="text-xl font-bold text-brand-forest mt-0.5">
                      {selectedEvent.tipo}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedEvent(null)}
                    aria-label="Cerrar detalle del evento"
                    className="p-1 rounded text-brand-slate/55 hover:bg-surface-secondary hover:text-brand-slate"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {renderSyncBadge(selectedEvent.syncStatus)}
                </div>

                <dl className="space-y-2.5 text-[13px]">
                  <div>
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Animal</dt>
                    <dd className="mt-0.5">
                      <Link
                        to={`/cattle/${selectedEvent.idAnimal}`}
                        className="font-bold text-brand-primary hover:underline"
                      >
                        {animalById.get(selectedEvent.idAnimal)?.arete || selectedEvent.idAnimal}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Fecha</dt>
                    <dd className="text-brand-slate mt-0.5">
                      {formatDateTimeDisplay(selectedEvent.fecha)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                      Responsable
                    </dt>
                    <dd className="text-brand-slate mt-0.5">{selectedEvent.responsable}</dd>
                  </div>
                  {selectedEvent.sintomas && (
                    <div>
                      <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                        Síntomas
                      </dt>
                      <dd className="text-brand-slate/85 mt-0.5 whitespace-pre-line">
                        {selectedEvent.sintomas}
                      </dd>
                    </div>
                  )}
                  {selectedEvent.diagnostico && (
                    <div>
                      <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                        Diagnóstico
                      </dt>
                      <dd className="text-brand-slate/85 mt-0.5 whitespace-pre-line">
                        {selectedEvent.diagnostico}
                      </dd>
                    </div>
                  )}
                  {selectedEvent.profesionalDiagnostico && (
                    <div>
                      <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                        Profesional
                      </dt>
                      <dd className="text-brand-slate mt-0.5">
                        {selectedEvent.profesionalDiagnostico}
                      </dd>
                    </div>
                  )}
                  {selectedEvent.observaciones && (
                    <div>
                      <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                        Observaciones
                      </dt>
                      <dd className="text-brand-slate/85 mt-0.5 whitespace-pre-line">
                        {selectedEvent.observaciones}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                      Identificador UUID
                    </dt>
                    <dd className="font-mono text-[11px] text-brand-slate/70 mt-0.5 break-all">
                      {selectedEvent.idEventoSanitario} (v{selectedEvent.versionRegistro})
                    </dd>
                  </div>
                </dl>

                {/* Tratamientos vinculados a este evento */}
                <div className="pt-3 border-t border-border-light space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[12px] font-bold text-brand-slate/75 uppercase tracking-wider">
                      Tratamientos ({selectedEventTreatments.length})
                    </h3>
                    {!selectedEvent.deletedAt && (
                      <button
                        type="button"
                        onClick={() =>
                          setTreatmentModalState({
                            open: true,
                            mode: 'create',
                            preselectedEventId: selectedEvent.id
                          })
                        }
                        className="text-[12px] font-semibold text-status-info hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Plus size={13} /> Agregar
                      </button>
                    )}
                  </div>

                  {selectedEventTreatments.length === 0 ? (
                    <p className="text-[12px] text-brand-slate/60">
                      Sin tratamientos asociados todavía.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedEventTreatments.map((t) => (
                        <li
                          key={t.id}
                          className="p-2.5 rounded-lg bg-surface-app/70 border border-border-light text-[12px] space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-brand-forest">{t.producto}</span>
                            {renderTreatmentEstadoBadge(t.estado, t.deletedAt)}
                          </div>
                          <p className="text-brand-slate/75">
                            {t.dosis} {t.unidadDosis} · {t.frecuencia}
                          </p>
                          {!t.deletedAt && (
                            <div className="flex items-center gap-2 pt-1">
                              {isTreatmentPending(t.estado) && (
                                <button
                                  type="button"
                                  onClick={() => void handleQuickCompleteTreatment(t)}
                                  className="text-[11px] font-semibold text-status-success hover:underline cursor-pointer"
                                >
                                  Marcar Completado
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setTreatmentModalState({
                                    open: true,
                                    mode: 'edit',
                                    treatment: t
                                  })
                                }
                                className="text-[11px] font-semibold text-status-info hover:underline cursor-pointer"
                              >
                                Editar
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      ) : (
        /* Pestaña de Tratamientos (Pendientes / Todos) */
        <div>
          {filteredTreatments.length === 0 ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm min-h-[300px] flex items-center justify-center p-6">
              <EmptyState
                title={
                  pendingOnly
                    ? 'Sin tratamientos pendientes'
                    : 'Sin tratamientos registrados'
                }
                message={
                  pendingOnly
                    ? 'No hay tratamientos pendientes ni en curso con los filtros actuales.'
                    : 'Registra un tratamiento asociado a un evento sanitario.'
                }
                icon={Syringe}
                actionLabel="Nuevo Tratamiento"
                onAction={() => setTreatmentModalState({ open: true, mode: 'create' })}
              />
            </div>
          ) : (
            <ResponsiveDataView
              items={filteredTreatments}
              getKey={(t) => t.id}
              columns={treatmentColumns}
              renderCardHeader={(t) => (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-brand-forest">{t.producto}</span>
                  {renderTreatmentEstadoBadge(t.estado, t.deletedAt)}
                  {renderSyncBadge(t.syncStatus)}
                </div>
              )}
              renderCardActions={(t) => (
                <div className="inline-flex items-center justify-end gap-1">
                  {!t.deletedAt && isTreatmentPending(t.estado) && (
                    <button
                      type="button"
                      onClick={() => void handleQuickCompleteTreatment(t)}
                      aria-label={`Completar tratamiento ${t.producto}`}
                      title="Marcar Completado"
                      className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-status-success hover:bg-status-success/10 rounded-md transition-colors cursor-pointer"
                    >
                      <CheckCircle2 size={17} />
                    </button>
                  )}
                  {!t.deletedAt && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setTreatmentModalState({ open: true, mode: 'edit', treatment: t })
                        }
                        aria-label={`Editar tratamiento ${t.producto}`}
                        title="Editar"
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors cursor-pointer"
                      >
                        <Edit size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeactivateTarget({ kind: 'treatment', item: t });
                          setDeactivateError(null);
                        }}
                        aria-label={`Desactivar tratamiento ${t.producto}`}
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
      )}

      {/* Modal Evento Sanitario */}
      {eventModalState.open && (
        <HealthEventFormModal
          mode={eventModalState.mode}
          initialEvent={eventModalState.mode === 'edit' ? eventModalState.event : undefined}
          preselectedAnimalId={animalFilter !== 'todos' ? animalFilter : undefined}
          animals={animals}
          isOnline={isOnline}
          onClose={() => setEventModalState({ open: false })}
          onSubmit={handleSaveEvent}
        />
      )}

      {/* Modal Tratamiento */}
      {treatmentModalState.open && (
        <TreatmentFormModal
          mode={treatmentModalState.mode}
          initialTreatment={
            treatmentModalState.mode === 'edit' ? treatmentModalState.treatment : undefined
          }
          preselectedEventId={
            treatmentModalState.mode === 'create'
              ? treatmentModalState.preselectedEventId
              : undefined
          }
          events={events}
          animals={animals}
          isOnline={isOnline}
          onClose={() => setTreatmentModalState({ open: false })}
          onSubmit={handleSaveTreatment}
        />
      )}

      {/* Modal Desactivar */}
      {deactivateTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-health-title"
          onClick={() => !isDeactivating && setDeactivateTarget(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="deactivate-health-title" className="text-[17px] font-bold text-brand-slate">
                  {deactivateTarget.kind === 'event'
                    ? `Desactivar evento — ${deactivateTarget.item.tipo}`
                    : `Desactivar tratamiento — ${deactivateTarget.item.producto}`}
                </h2>
                <p className="text-[12px] text-brand-slate/65 mt-1">
                  El registro se marcará como desactivado (borrado lógico) conservando la trazabilidad clínica.
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
