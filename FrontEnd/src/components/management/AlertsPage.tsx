import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Syringe,
  Trash2,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { usePwaUpdate } from '../../hooks/usePwaUpdate';
import {
  ALERT_ESTADOS,
  ALERT_SUGGESTED_TYPES,
  type AlertEstado,
  type AlertInput,
  type AlertRecord,
  type AlertTimingStatus
} from '../../types/alert';
import type { Cattle, RanchOption } from '../../types/cattle';
import type { Treatment } from '../../types/health';
import type { Lot } from '../../types/lot';
import {
  AlertService,
  type AlertMutationResult
} from '../../services/alert.service';
import {
  classifyAlertTiming,
  formatAlertRelativeTiming,
  isAlertPendingEstado
} from '../../services/alert.validation';
import {
  SystemNotificationsService,
  type SystemAlertItem
} from '../../services/system-notifications.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';
import EmptyState from '../ui/EmptyState';
import AlertFormModal from './AlertFormModal';

type TimingFilter = 'todas' | AlertTimingStatus | 'sistema';

type ModalState =
  | { open: false }
  | { open: true; mode: 'create'; prefillTreatment?: Treatment }
  | { open: true; mode: 'edit'; alert: AlertRecord };

function formatDateTimeDisplay(iso: string | null | undefined): string {
  if (!iso) return '—';
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

function renderTimingBadge(alert: AlertRecord) {
  const timing = classifyAlertTiming(alert);
  const label = formatAlertRelativeTiming(alert);

  const styles: Record<AlertTimingStatus, string> = {
    vencida: 'bg-status-danger/15 text-status-danger border-status-danger/30',
    proxima: 'bg-status-warning/20 text-brand-dark border-status-warning/40',
    programada: 'bg-sky-500/15 text-sky-800 border-sky-500/30',
    completada: 'bg-status-success/15 text-status-success border-status-success/30',
    cancelada: 'bg-brand-slate/15 text-brand-slate/70 border-brand-slate/20'
  };

  const prefix: Record<AlertTimingStatus, string> = {
    vencida: 'Vencida',
    proxima: 'Próxima',
    programada: 'Programada',
    completada: 'Completada',
    cancelada: 'Cancelada'
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${styles[timing]}`}
      title={label}
    >
      {timing === 'vencida' && <AlertTriangle size={11} />}
      {timing === 'proxima' && <Clock size={11} />}
      {timing === 'completada' && <CheckCircle2 size={11} />}
      <span>{timing === 'vencida' || timing === 'proxima' ? label : prefix[timing]}</span>
    </span>
  );
}

function renderSyncBadge(syncStatus: AlertRecord['syncStatus']) {
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
      <Clock size={11} /> Pendiente
    </span>
  );
}

export default function AlertsPage() {
  const [searchParams] = useSearchParams();
  const { isOnline, counts } = useSyncStatus();
  const { updateAvailable, swVersion, applyUpdate } = usePwaUpdate();

  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [pendingTreatments, setPendingTreatments] = useState<Treatment[]>([]);
  const [ranches, setRanches] = useState<RanchOption[]>([]);
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [systemHistory, setSystemHistory] = useState<SystemAlertItem[]>(() =>
    SystemNotificationsService.getHistory()
  );

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Filtros solicitados: fecha, tipo, estado, vencimiento, sistema y texto
  const [timingFilter, setTimingFilter] = useState<TimingFilter>(() =>
    searchParams.get('seccion') === 'sistema' ? 'sistema' : 'todas'
  );
  const [typeFilter, setTypeFilter] = useState<string>('todos');
  const [estadoFilter, setEstadoFilter] = useState<string>('todos');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  const [modalState, setModalState] = useState<ModalState>({ open: false });
  const [confirmDeactivate, setConfirmDeactivate] = useState<AlertRecord | null>(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  useEffect(() => {
    const syncHistory = () => {
      setSystemHistory(SystemNotificationsService.getHistory());
    };
    return SystemNotificationsService.subscribe(syncHistory);
  }, []);

  const loadData = useCallback(async (withDeleted: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await AlertService.getAll({
        includeDeleted: withDeleted,
        order: 'asc'
      });
      setAlerts(result.alerts);
      setPendingTreatments(result.pendingTreatments);
      setRanches(result.ranches);
      setAnimals(result.animals);
      setLots(result.lots);
      setApiWarning(result.warning);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudieron cargar las alertas y recordatorios.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await AlertService.getAll({
          includeDeleted,
          order: 'asc'
        });
        if (!active) return;
        setAlerts(result.alerts);
        setPendingTreatments(result.pendingTreatments);
        setRanches(result.ranches);
        setAnimals(result.animals);
        setLots(result.lots);
        setApiWarning(result.warning);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudieron cargar las alertas y recordatorios.'
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
        void loadData(includeDeleted);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [includeDeleted, loadData]);

  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);
  const ranchById = useMemo(() => new Map(ranches.map((r) => [r.id, r])), [ranches]);
  const treatmentById = useMemo(
    () => new Map(pendingTreatments.map((t) => [t.id, t])),
    [pendingTreatments]
  );

  const availableTypes = useMemo(() => {
    const set = new Set<string>(ALERT_SUGGESTED_TYPES);
    for (const a of alerts) {
      if (a.tipo.trim()) set.add(a.tipo.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [alerts]);

  const stats = useMemo(() => {
    const active = alerts.filter((a) => !a.deletedAt);
    let vencidas = 0;
    let proximas = 0;
    let pendientes = 0;
    let pendingSync = 0;

    for (const a of active) {
      const timing = classifyAlertTiming(a);
      if (timing === 'vencida') vencidas++;
      else if (timing === 'proxima') proximas++;
      if (isAlertPendingEstado(a.estado)) pendientes++;
      if (a.syncStatus !== 'synced') pendingSync++;
    }

    return {
      vencidas,
      proximas,
      pendientes,
      tratamientosPendientes: pendingTreatments.length,
      pendingSync
    };
  }, [alerts, pendingTreatments.length]);

  const hasActiveFilters = Boolean(
    timingFilter !== 'todas' ||
      typeFilter !== 'todos' ||
      estadoFilter !== 'todos' ||
      dateFrom ||
      dateTo ||
      searchTerm.trim()
  );

  const clearFilters = () => {
    setTimingFilter('todas');
    setTypeFilter('todos');
    setEstadoFilter('todos');
    setDateFrom('');
    setDateTo('');
    setSearchTerm('');
  };

  const allSystemAlerts = useMemo(() => {
    const live = SystemNotificationsService.getLiveSystemAlerts({
      isOnline,
      pendingOperationsCount: counts.pendingOperationsCount,
      pendingFilesCount: counts.pendingFilesCount,
      pendingConflictsCount: counts.pendingConflictsCount,
      updateAvailable,
      swVersion
    });
    return [...live, ...systemHistory];
  }, [
    isOnline,
    counts.pendingOperationsCount,
    counts.pendingFilesCount,
    counts.pendingConflictsCount,
    updateAvailable,
    swVersion,
    systemHistory
  ]);

  const filteredSystemAlerts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : null;
    const toMs = dateTo ? Date.parse(`${dateTo}T23:59:59.999`) : null;

    return allSystemAlerts.filter((item) => {
      if (fromMs !== null || toMs !== null) {
        const itemMs = Date.parse(item.fecha);
        if (!Number.isNaN(itemMs)) {
          if (fromMs !== null && itemMs < fromMs) return false;
          if (toMs !== null && itemMs > toMs) return false;
        }
      }
      if (!query) return true;
      return (
        item.titulo.toLowerCase().includes(query) ||
        item.descripcion.toLowerCase().includes(query) ||
        item.categoria.toLowerCase().includes(query) ||
        'sistema'.includes(query)
      );
    });
  }, [allSystemAlerts, searchTerm, dateFrom, dateTo]);

  const filteredAlerts = useMemo(() => {
    if (timingFilter === 'sistema') return [];
    const query = searchTerm.trim().toLowerCase();
    const fromMs = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : null;
    const toMs = dateTo ? Date.parse(`${dateTo}T23:59:59.999`) : null;

    return alerts.filter((a) => {
      if (!includeDeleted && a.deletedAt) return false;

      if (timingFilter !== 'todas' && classifyAlertTiming(a) !== timingFilter) {
        return false;
      }

      if (typeFilter !== 'todos' && a.tipo.trim().toLowerCase() !== typeFilter.toLowerCase()) {
        return false;
      }

      if (estadoFilter !== 'todos' && a.estado !== estadoFilter) {
        return false;
      }

      if (fromMs !== null || toMs !== null) {
        const alertMs = Date.parse(a.fechaProgramada);
        if (Number.isNaN(alertMs)) return false;
        if (fromMs !== null && alertMs < fromMs) return false;
        if (toMs !== null && alertMs > toMs) return false;
      }

      if (!query) return true;
      const animal = a.idAnimal ? animalById.get(a.idAnimal) : undefined;
      const lot = a.idLote ? lotById.get(a.idLote) : undefined;
      const ranch = ranchById.get(a.idRancho);
      const treatment = a.idTratamiento ? treatmentById.get(a.idTratamiento) : undefined;

      return (
        a.tipo.toLowerCase().includes(query) ||
        a.descripcion.toLowerCase().includes(query) ||
        a.estado.toLowerCase().includes(query) ||
        (animal?.arete || '').toLowerCase().includes(query) ||
        (lot?.nombre || '').toLowerCase().includes(query) ||
        (ranch?.nombre || '').toLowerCase().includes(query) ||
        (treatment?.producto || '').toLowerCase().includes(query)
      );
    });
  }, [
    alerts,
    includeDeleted,
    timingFilter,
    typeFilter,
    estadoFilter,
    dateFrom,
    dateTo,
    searchTerm,
    animalById,
    lotById,
    ranchById,
    treatmentById
  ]);

  const handleSave = async (input: AlertInput): Promise<AlertMutationResult> => {
    const isEdit = modalState.open && modalState.mode === 'edit';
    const result = isEdit
      ? await AlertService.update(modalState.alert.id, input)
      : await AlertService.create(input);

    setFeedbackMsg(
      result.synced
        ? isEdit
          ? `Recordatorio "${result.alert.tipo}" actualizado y sincronizado.`
          : `Recordatorio "${result.alert.tipo}" creado y sincronizado.`
        : result.syncMessage || `Recordatorio "${result.alert.tipo}" guardado localmente.`
    );
    await loadData(includeDeleted);
    return result;
  };

  const handleToggleEstado = async (alert: AlertRecord, nextEstado: AlertEstado) => {
    if (updatingStatusId) return;
    setUpdatingStatusId(alert.id);
    setError(null);
    try {
      const result = await AlertService.setEstado(alert.id, nextEstado);
      setFeedbackMsg(
        result.synced
          ? `Recordatorio marcado como "${nextEstado}" y sincronizado.`
          : result.syncMessage || `Recordatorio marcado como "${nextEstado}" localmente.`
      );
      await loadData(includeDeleted);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo actualizar el estado del recordatorio.'
      );
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!confirmDeactivate || isDeactivating) return;
    setIsDeactivating(true);
    setError(null);
    try {
      const outcome = await AlertService.deactivate(confirmDeactivate.id);
      setFeedbackMsg(
        outcome.synced
          ? 'Recordatorio desactivado y sincronizado.'
          : outcome.syncMessage || 'Recordatorio desactivado localmente.'
      );
      setConfirmDeactivate(null);
      await loadData(includeDeleted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo desactivar el recordatorio.');
    } finally {
      setIsDeactivating(false);
    }
  };

  const renderAlertActions = (a: AlertRecord) => {
    if (a.deletedAt) {
      return <span className="text-[11px] text-brand-slate/50 italic">Desactivado</span>;
    }

    const isPending = isAlertPendingEstado(a.estado);
    const isBusy = updatingStatusId === a.id;

    return (
      <div className="flex items-center gap-1.5 justify-end flex-wrap">
        {isPending ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleToggleEstado(a, 'Completado')}
            aria-label={`Completar recordatorio ${a.tipo}`}
            className="px-2.5 py-1.5 text-[12px] font-semibold text-status-success hover:bg-status-success/10 rounded-md inline-flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 size={13} /> Completar
          </button>
        ) : (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleToggleEstado(a, 'Pendiente')}
            aria-label={`Reabrir recordatorio ${a.tipo}`}
            className="px-2.5 py-1.5 text-[12px] font-semibold text-brand-slate hover:bg-surface-secondary rounded-md inline-flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={13} /> Reabrir
          </button>
        )}

        <button
          type="button"
          onClick={() => setModalState({ open: true, mode: 'edit', alert: a })}
          aria-label={`Editar recordatorio ${a.tipo}`}
          className="px-2.5 py-1.5 text-[12px] font-semibold text-brand-primary hover:bg-brand-primary/10 rounded-md inline-flex items-center gap-1 transition-colors"
        >
          <Edit3 size={13} /> Editar
        </button>

        <button
          type="button"
          onClick={() => setConfirmDeactivate(a)}
          aria-label={`Desactivar recordatorio ${a.tipo}`}
          className="px-2.5 py-1.5 text-[12px] font-semibold text-status-danger hover:bg-status-danger/10 rounded-md inline-flex items-center gap-1 transition-colors"
        >
          <Trash2 size={13} /> Desactivar
        </button>
      </div>
    );
  };

  const columns: ResponsiveColumn<AlertRecord>[] = [
    {
      key: 'recordatorio',
      header: 'Recordatorio',
      hideOnCard: true,
      renderCell: (a) => {
        const animal = a.idAnimal ? animalById.get(a.idAnimal) : undefined;
        const lot = a.idLote ? lotById.get(a.idLote) : undefined;
        const ranch = ranchById.get(a.idRancho);
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-brand-forest">{a.tipo}</span>
              {renderTimingBadge(a)}
              {a.deletedAt && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-slate/15 text-brand-slate/70">
                  Desactivado
                </span>
              )}
              {renderSyncBadge(a.syncStatus)}
            </div>
            <p className="text-[13px] text-brand-slate">{a.descripcion}</p>
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-brand-slate/65">
              {ranch && <span>Rancho: {ranch.nombre}</span>}
              {animal && (
                <Link
                  to={`/cattle/${animal.id}`}
                  className="font-semibold text-brand-primary hover:underline"
                >
                  Animal: {animal.arete}
                </Link>
              )}
              {lot && <span>Potrero: {lot.nombre}</span>}
              {a.idTratamiento && (
                <span className="text-status-info font-semibold">Con tratamiento vinculado</span>
              )}
            </div>
          </div>
        );
      }
    },
    {
      key: 'fecha',
      header: 'Fecha Programada',
      renderCell: (a) => (
        <div className="space-y-0.5">
          <p className="text-[12px] font-medium text-brand-slate">
            {formatDateTimeDisplay(a.fechaProgramada)}
          </p>
          {a.fechaCompletado && (
            <p className="text-[11px] text-status-success">
              Completado: {formatDateTimeDisplay(a.fechaCompletado)}
            </p>
          )}
        </div>
      )
    },
    {
      key: 'estado',
      header: 'Estado',
      renderCell: (a) => (
        <span className="text-[12px] font-semibold text-brand-slate">{a.estado}</span>
      )
    },
    {
      key: 'acciones',
      header: 'Acciones',
      hideOnCard: true,
      renderCell: (a) => renderAlertActions(a)
    }
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Seguimiento Operativo
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Alertas y Recordatorios
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(includeDeleted)}
            disabled={loading}
            aria-label="Actualizar alertas y recordatorios"
            className="min-h-[42px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>

          <button
            type="button"
            onClick={() => setModalState({ open: true, mode: 'create' })}
            className="min-h-[42px] flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Nuevo Recordatorio
          </button>
        </div>
      </header>

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

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-[13px] font-medium flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadData(includeDeleted)}
            className="px-3 py-1.5 bg-surface-white border border-status-danger/40 text-status-danger rounded-md text-[12px] font-semibold hover:bg-status-danger/10 self-start sm:self-auto"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* KPIs reales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setTimingFilter((prev) => (prev === 'vencida' ? 'todas' : 'vencida'))}
          className={`text-left bg-surface-white border rounded-xl p-4 shadow-sm transition-colors cursor-pointer ${
            timingFilter === 'vencida'
              ? 'border-status-danger ring-2 ring-status-danger/20'
              : 'border-border-light hover:border-status-danger/50'
          }`}
        >
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Alertas Vencidas</span>
            <AlertTriangle size={16} className="text-status-danger" />
          </div>
          <p className="text-2xl font-condensed font-bold text-status-danger mt-1">
            {stats.vencidas}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Requieren atención inmediata</p>
        </button>

        <button
          type="button"
          onClick={() => setTimingFilter((prev) => (prev === 'proxima' ? 'todas' : 'proxima'))}
          className={`text-left bg-surface-white border rounded-xl p-4 shadow-sm transition-colors cursor-pointer ${
            timingFilter === 'proxima'
              ? 'border-status-warning ring-2 ring-status-warning/25'
              : 'border-border-light hover:border-status-warning/60'
          }`}
        >
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Próximas (7 días)</span>
            <Clock size={16} className="text-status-warning" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-dark mt-1">
            {stats.proximas}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Programadas esta semana</p>
        </button>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Pendientes Activas</span>
            <Bell size={16} className="text-brand-primary" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-forest mt-1">
            {stats.pendientes}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">
            {stats.pendingSync > 0 ? `${stats.pendingSync} por sincronizar` : 'Sincronizadas'}
          </p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Tratamientos Pendientes</span>
            <Syringe size={16} className="text-status-info" />
          </div>
          <p className="text-2xl font-condensed font-bold text-status-info mt-1">
            {stats.tratamientosPendientes}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Del módulo de Salud</p>
        </div>
      </div>

      {/* Filtros por vencimiento, fecha, tipo y estado */}
      <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por vencimiento">
            {(
              [
                { id: 'todas', label: 'Todas' },
                { id: 'vencida', label: `Vencidas (${stats.vencidas})` },
                { id: 'proxima', label: `Próximas (${stats.proximas})` },
                { id: 'programada', label: 'Programadas' },
                { id: 'completada', label: 'Completadas' },
                { id: 'sistema', label: `Sistema (${allSystemAlerts.length})` }
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setTimingFilter(pill.id)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors ${
                  timingFilter === pill.id
                    ? 'bg-brand-primary text-white border-brand-primary'
                    : 'bg-surface-white text-brand-slate border-border-light hover:border-brand-primary/50'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-[12px] font-semibold text-brand-primary hover:underline"
              >
                Limpiar filtros
              </button>
            )}
            <label className="inline-flex items-center gap-2 text-[12px] text-brand-slate cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="rounded border-border-light text-brand-primary focus:ring-brand-primary"
              />
              Mostrar desactivados
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
            />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar recordatorio, arete, offline..."
              aria-label="Buscar recordatorios y alertas del sistema"
              className="w-full h-[38px] pl-8 pr-3 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            />
          </div>

          <select
            aria-label="Filtrar por tipo"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-[38px] px-3 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
          >
            <option value="todos">Todos los tipos</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por estado"
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value)}
            className="h-[38px] px-3 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
          >
            <option value="todos">Todos los estados</option>
            {ALERT_ESTADOS.map((est) => (
              <option key={est} value={est}>
                {est}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-brand-slate/50 shrink-0" />
            <input
              type="date"
              aria-label="Fecha desde"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full h-[38px] px-2.5 bg-surface-white border border-border-light rounded-md text-[12px] text-brand-slate outline-none focus:border-brand-primary"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-brand-slate/50 shrink-0" />
            <input
              type="date"
              aria-label="Fecha hasta"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full h-[38px] px-2.5 bg-surface-white border border-border-light rounded-md text-[12px] text-brand-slate outline-none focus:border-brand-primary"
            />
          </div>
        </div>
      </div>

      {/* Layout principal: Bandeja de Recordatorios (o Alertas del Sistema) + Panel Lateral */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {timingFilter === 'sistema' ? (
          <section className="lg:col-span-8 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                <ShieldAlert size={16} className="text-brand-primary" />
                Alertas del Sistema ({filteredSystemAlerts.length})
              </h2>
              {systemHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => SystemNotificationsService.clearHistory()}
                  className="text-[12px] font-semibold text-brand-slate/70 hover:text-status-danger transition-colors cursor-pointer"
                >
                  Limpiar historial
                </button>
              )}
            </div>

            <div className="p-4 space-y-3">
              {filteredSystemAlerts.length === 0 ? (
                <EmptyState
                  title={
                    searchTerm.trim()
                      ? 'Sin alertas del sistema para tu búsqueda'
                      : 'Sin alertas del sistema activas'
                  }
                  message={
                    searchTerm.trim()
                      ? 'No se encontraron avisos de modo offline, sincronización o sistema con ese término.'
                      : 'Cuando el dispositivo entre en modo offline, recupere conexión o tenga sincronizaciones pendientes aparecerán aquí.'
                  }
                  icon={ShieldAlert}
                />
              ) : (
                filteredSystemAlerts.map((item) => (
                  <article
                    key={item.id}
                    className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
                      item.severidad === 'danger'
                        ? 'bg-status-danger/5 border-status-danger/30'
                        : item.severidad === 'warning'
                          ? 'bg-status-warning/10 border-status-warning/35'
                          : item.severidad === 'success'
                            ? 'bg-status-success/10 border-status-success/30'
                            : 'bg-surface-secondary/45 border-border-light'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {item.categoria === 'offline' ? (
                        item.severidad === 'success' ? (
                          <Wifi size={16} className="text-status-success shrink-0 mt-0.5" />
                        ) : (
                          <WifiOff size={16} className="text-status-warning shrink-0 mt-0.5" />
                        )
                      ) : item.severidad === 'danger' ? (
                        <AlertTriangle size={16} className="text-status-danger shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle size={16} className="text-brand-primary shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-[13px] text-brand-forest">
                            {item.titulo}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.activa
                                ? 'bg-brand-primary/15 text-brand-primary'
                                : 'bg-brand-slate/10 text-brand-slate/70'
                            }`}
                          >
                            {item.activa ? 'Activa' : 'Historial'}
                          </span>
                        </div>
                        <p className="text-[12px] text-brand-slate/85">{item.descripcion}</p>
                        <p className="text-[11px] text-brand-slate/55">
                          {formatDateTimeDisplay(item.fecha)}
                        </p>
                      </div>
                    </div>
                    {item.codigo === 'pwa-update' && updateAvailable && (
                      <button
                        type="button"
                        onClick={() => applyUpdate(false)}
                        className="px-3 py-1.5 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[12px] font-semibold shrink-0 cursor-pointer"
                      >
                        Actualizar
                      </button>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="lg:col-span-8 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2">
              <h2 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                <Bell size={16} className="text-brand-primary" />
                Recordatorios ({filteredAlerts.length})
              </h2>
            </div>

            {loading ? (
              <div className="p-10 text-center text-brand-slate/60 text-[13px]">
                Cargando alertas y recordatorios...
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title={
                    hasActiveFilters
                      ? 'Sin coincidencias para los filtros actuales'
                      : 'Sin recordatorios registrados'
                  }
                  message={
                    hasActiveFilters
                      ? 'Ajusta los filtros de fecha, tipo, estado o vencimiento para ver otros registros.'
                      : 'Programa recordatorios operativos de vacunación, pesajes, tratamientos o manejo del rancho.'
                  }
                  icon={Bell}
                  actionLabel={hasActiveFilters ? 'Limpiar filtros' : 'Nuevo Recordatorio'}
                  onAction={
                    hasActiveFilters
                      ? clearFilters
                      : () => setModalState({ open: true, mode: 'create' })
                  }
                />
              </div>
            ) : (
              <ResponsiveDataView<AlertRecord>
                items={filteredAlerts}
                columns={columns}
                getKey={(a) => a.id}
                renderCardHeader={(a) => (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-brand-forest text-[15px]">{a.tipo}</span>
                      {renderTimingBadge(a)}
                      {renderSyncBadge(a.syncStatus)}
                    </div>
                    <p className="text-[13px] text-brand-slate">{a.descripcion}</p>
                  </div>
                )}
                renderCardActions={renderAlertActions}
              />
            )}
          </section>
        )}

        {/* Columna Lateral: Alertas del Sistema + Tratamientos Pendientes */}
        <aside className="lg:col-span-4 space-y-5 flex flex-col">
          {timingFilter !== 'sistema' && (
            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2">
                <h2 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                  <ShieldAlert size={16} className="text-status-warning" />
                  Alertas del Sistema ({filteredSystemAlerts.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setTimingFilter('sistema')}
                  className="text-[12px] font-semibold text-brand-primary hover:underline cursor-pointer"
                >
                  Ver todas
                </button>
              </div>

              <div className="p-4 space-y-2.5">
                {filteredSystemAlerts.length === 0 ? (
                  <p className="text-[12px] text-brand-slate/65 text-center py-3">
                    {searchTerm.trim()
                      ? 'Sin alertas del sistema que coincidan con tu búsqueda.'
                      : 'Sistema en línea y sin avisos pendientes.'}
                  </p>
                ) : (
                  filteredSystemAlerts.slice(0, 4).map((item) => (
                    <article
                      key={item.id}
                      className={`p-3 rounded-lg border space-y-1 ${
                        item.severidad === 'danger'
                          ? 'bg-status-danger/5 border-status-danger/30'
                          : item.severidad === 'warning'
                            ? 'bg-status-warning/10 border-status-warning/35'
                            : item.severidad === 'success'
                              ? 'bg-status-success/10 border-status-success/30'
                              : 'bg-surface-secondary/45 border-border-light'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[12px] text-brand-forest flex items-center gap-1.5">
                          {item.categoria === 'offline' ? (
                            item.severidad === 'success' ? (
                              <Wifi size={13} className="text-status-success shrink-0" />
                            ) : (
                              <WifiOff size={13} className="text-status-warning shrink-0" />
                            )
                          ) : (
                            <AlertCircle size={13} className="text-brand-primary shrink-0" />
                          )}
                          {item.titulo}
                        </span>
                        {item.activa && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-primary/15 text-brand-primary shrink-0">
                            Activa
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-brand-slate/80 leading-snug">
                        {item.descripcion}
                      </p>
                      <p className="text-[10px] text-brand-slate/55">
                        {formatDateTimeDisplay(item.fecha)}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {/* Panel de Tratamientos y Actividades Pendientes */}
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2">
              <h2 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                <Syringe size={16} className="text-status-info" />
                Tratamientos Pendientes ({pendingTreatments.length})
              </h2>
              <Link
                to="/health"
                className="text-[12px] font-semibold text-brand-primary hover:underline"
              >
                Ver Salud
              </Link>
            </div>

            <div className="p-4 flex-1 space-y-3">
              {loading ? (
                <p className="text-[13px] text-brand-slate/60 text-center py-6">
                  Consultando tratamientos pendientes...
                </p>
              ) : pendingTreatments.length === 0 ? (
                <EmptyState
                  title="Sin tratamientos pendientes"
                  message="Cuando existan tratamientos en estado Pendiente o En curso en el módulo de Salud aparecerán aquí."
                  icon={Syringe}
                />
              ) : (
                pendingTreatments.map((t) => {
                  const animal = animalById.get(t.idAnimal);
                  const refDate = t.fechaFin || t.fechaInicio;
                  const timing = classifyAlertTiming({
                    estado: t.estado === 'En curso' ? 'En curso' : 'Pendiente',
                    fechaProgramada: refDate
                  });
                  return (
                    <article
                      key={t.id}
                      className="p-3.5 rounded-lg border border-border-light bg-surface-app/25 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-[13px] text-brand-forest">{t.producto}</p>
                          <p className="text-[12px] text-brand-slate/75">
                            {animal ? (
                              <Link
                                to={`/cattle/${animal.id}`}
                                className="font-semibold text-brand-primary hover:underline"
                              >
                                {animal.arete}
                              </Link>
                            ) : (
                              t.idAnimal.slice(0, 8)
                            )}{' '}
                            · {t.dosis} {t.unidadDosis} · {t.frecuencia}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            timing === 'vencida'
                              ? 'bg-status-danger/15 text-status-danger'
                              : 'bg-status-warning/20 text-brand-dark'
                          }`}
                        >
                          {t.estado}
                        </span>
                      </div>

                      <p className="text-[11px] text-brand-slate/65">
                        Inicio: {formatDateTimeDisplay(t.fechaInicio)}
                        {t.fechaFin ? ` · Fin: ${formatDateTimeDisplay(t.fechaFin)}` : ''}
                      </p>

                      <div className="pt-1 border-t border-border-light/70 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setModalState({ open: true, mode: 'create', prefillTreatment: t })
                          }
                          className="text-[11px] font-semibold text-brand-primary hover:underline inline-flex items-center gap-1"
                        >
                          <Plus size={12} /> Programar recordatorio
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Modal de creación / edición */}
      {modalState.open && (
        <AlertFormModal
          mode={modalState.mode}
          initialAlert={modalState.mode === 'edit' ? modalState.alert : undefined}
          prefillTreatment={
            modalState.mode === 'create' ? modalState.prefillTreatment : undefined
          }
          ranches={ranches}
          animals={animals}
          lots={lots}
          treatments={pendingTreatments}
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
          aria-labelledby="confirm-deactivate-alert-title"
          onClick={() => !isDeactivating && setConfirmDeactivate(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="confirm-deactivate-alert-title"
              className="text-lg font-condensed font-bold text-brand-forest"
            >
              Desactivar recordatorio
            </h2>
            <p className="text-[13px] text-brand-slate/80">
              ¿Deseas desactivar el recordatorio <strong>{confirmDeactivate.tipo}</strong> (
              {confirmDeactivate.descripcion})? Se aplicará baja lógica y se sincronizará con el
              servidor.
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
