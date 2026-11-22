import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  Plus,
  Search,
  RefreshCw,
  ArrowRight,
  ArrowLeftRight,
  ArrowUpDown,
  Calendar,
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
  Filter
} from 'lucide-react';
import type { Cattle, LotOption, RanchOption } from '../../types/cattle';
import {
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  type Movement,
  type MovementInput,
  type MovementType,
  type TrasladoAnimalRanchoPayload,
  type TrasladoLoteRanchoPayload,
  type TrasladoRanchoResultDto
} from '../../types/movement';
import {
  MovementService,
  type MovementMutationResult
} from '../../services/movement.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useSharedCattle } from '../../hooks/useCattle';
import EmptyState from '../ui/EmptyState';
import MovementFormModal from './MovementFormModal';
import RanchTransferModal from './RanchTransferModal';

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

function renderSyncBadge(syncStatus: Movement['syncStatus']) {
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

function renderTipoBadge(tipo: MovementType, deletedAt: string | null) {
  if (deletedAt) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-slate/15 text-brand-slate/70">
        Desactivado
      </span>
    );
  }

  switch (tipo) {
    case 'Alta':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-status-success/10 text-status-success">
          Alta
        </span>
      );
    case 'CambioInterno':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-primary/10 text-brand-primary">
          Cambio interno
        </span>
      );
    case 'Traslado':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-status-info/15 text-status-info">
          Traslado
        </span>
      );
    case 'Venta':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-status-warning/20 text-amber-900">
          Venta
        </span>
      );
    case 'Baja':
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-status-error/15 text-status-error">
          Baja
        </span>
      );
  }
}

export default function TraceabilityPage() {
  const [searchParams] = useSearchParams();
  const initialAnimalParam = searchParams.get('animalId') || 'todos';

  const { isOnline } = useSyncStatus();
  const { refresh: refreshCattleContext } = useSharedCattle();

  const [movements, setMovements] = useState<Movement[]>([]);
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [lots, setLots] = useState<LotOption[]>([]);
  const [ranches, setRanches] = useState<RanchOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Filtros y orden cronológico
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [animalFilter, setAnimalFilter] = useState<string>(initialAnimalParam);
  const [tipoFilter, setTipoFilter] = useState<string>('todos');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  // Modales y detalle
  const [formModalState, setFormModalState] = useState<
    | { open: false }
    | { open: true; mode: 'create' }
    | { open: true; mode: 'edit'; movement: Movement }
  >({ open: false });
  const [isRanchTransferOpen, setIsRanchTransferOpen] = useState<boolean>(false);

  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Movement | null>(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const loadData = useCallback(async (withDeleted: boolean, order: 'asc' | 'desc') => {
    setLoading(true);
    setError(null);
    try {
      const result = await MovementService.getAll({
        includeDeleted: withDeleted,
        order
      });
      setMovements(result.data);
      setAnimals(result.animals);
      setLots(result.lots);
      setRanches(result.ranches);
      setApiWarning(result.warning);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo cargar el historial de movimientos.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await MovementService.getAll({
          includeDeleted,
          order: sortOrder
        });
        if (!active) return;
        setMovements(result.data);
        setAnimals(result.animals);
        setLots(result.lots);
        setRanches(result.ranches);
        setApiWarning(result.warning);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el historial de movimientos.'
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

  const animalById = useMemo(
    () => new Map(animals.map((a) => [a.id, a])),
    [animals]
  );

  const lotNameById = useMemo(
    () => new Map(lots.map((l) => [l.id, l.nombre])),
    [lots]
  );

  const describeOrigin = useCallback(
    (mov: Movement): string => {
      const lotLabel = mov.idLoteOrigen
        ? lotNameById.get(mov.idLoteOrigen) || `Potrero (${mov.idLoteOrigen.slice(0, 8)}…)`
        : null;
      if (mov.origenExterno?.startsWith('Rancho:')) {
        return lotLabel ? `${mov.origenExterno} · ${lotLabel}` : mov.origenExterno;
      }
      if (lotLabel) {
        return lotLabel;
      }
      if (mov.origenExterno) {
        return `Externo: ${mov.origenExterno}`;
      }
      return mov.tipo === 'Alta' ? 'Ingreso inicial' : 'Sin potrero de origen';
    },
    [lotNameById]
  );

  const describeDestination = useCallback(
    (mov: Movement): string => {
      const lotLabel = mov.idLoteDestino
        ? lotNameById.get(mov.idLoteDestino) || `Potrero (${mov.idLoteDestino.slice(0, 8)}…)`
        : null;
      if (mov.destinoExterno?.startsWith('Rancho:')) {
        return lotLabel ? `${mov.destinoExterno} · ${lotLabel}` : mov.destinoExterno;
      }
      if (lotLabel) {
        return lotLabel;
      }
      if (mov.destinoExterno) {
        return `Externo: ${mov.destinoExterno}`;
      }
      if (mov.tipo === 'Baja') {
        return 'Baja del inventario';
      }
      if (mov.tipo === 'Venta') {
        return 'Salida por venta';
      }
      return 'Sin destino especificado';
    },
    [lotNameById]
  );

  const filteredMovements = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return movements.filter((mov) => {
      if (!includeDeleted && mov.deletedAt) return false;
      if (animalFilter !== 'todos' && mov.idAnimal !== animalFilter) return false;
      if (tipoFilter !== 'todos' && mov.tipo !== tipoFilter) return false;
      if (!query) return true;

      const animal = animalById.get(mov.idAnimal);
      const originLabel = describeOrigin(mov).toLowerCase();
      const destLabel = describeDestination(mov).toLowerCase();
      return (
        (animal?.arete || '').toLowerCase().includes(query) ||
        (animal?.raza || '').toLowerCase().includes(query) ||
        originLabel.includes(query) ||
        destLabel.includes(query) ||
        (mov.motivo || '').toLowerCase().includes(query) ||
        MOVEMENT_TYPE_LABELS[mov.tipo].toLowerCase().includes(query)
      );
    });
  }, [
    movements,
    includeDeleted,
    animalFilter,
    tipoFilter,
    searchTerm,
    animalById,
    describeOrigin,
    describeDestination
  ]);

  const stats = useMemo(() => {
    const active = movements.filter((m) => !m.deletedAt);
    return {
      total: active.length,
      internosYTraslados: active.filter(
        (m) => m.tipo === 'CambioInterno' || m.tipo === 'Traslado'
      ).length,
      altasYSalidas: active.filter(
        (m) => m.tipo === 'Alta' || m.tipo === 'Venta' || m.tipo === 'Baja'
      ).length,
      pendientesSync: active.filter((m) => m.syncStatus !== 'synced').length
    };
  }, [movements]);

  const handleSaveMovement = async (input: MovementInput): Promise<MovementMutationResult> => {
    const isEdit = formModalState.open && formModalState.mode === 'edit';
    const result = isEdit
      ? await MovementService.update(formModalState.movement.id, input)
      : await MovementService.create(input);

    const confirmation = result.synced
      ? isEdit
        ? 'Movimiento actualizado y sincronizado.'
        : 'Movimiento registrado y sincronizado.'
      : result.syncMessage || 'Movimiento guardado localmente. Pendiente de sincronización.';

    setFeedbackMsg(confirmation);
    await loadData(includeDeleted, sortOrder);
    await refreshCattleContext();
    if (selectedMovement && selectedMovement.id === result.movement.id) {
      setSelectedMovement(result.movement);
    }
    return result;
  };

  const handleTransferAnimalBetweenRanches = async (
    payload: TrasladoAnimalRanchoPayload
  ): Promise<TrasladoRanchoResultDto> => {
    const result = await MovementService.transferAnimalBetweenRanches(payload);
    setFeedbackMsg(result.mensaje);
    await loadData(includeDeleted, sortOrder);
    await refreshCattleContext();
    return result;
  };

  const handleTransferLotBetweenRanches = async (
    payload: TrasladoLoteRanchoPayload
  ): Promise<TrasladoRanchoResultDto> => {
    const result = await MovementService.transferLotBetweenRanches(payload);
    setFeedbackMsg(result.mensaje);
    await loadData(includeDeleted, sortOrder);
    await refreshCattleContext();
    return result;
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget || isDeactivating) return;
    setIsDeactivating(true);
    setDeactivateError(null);

    try {
      const result = await MovementService.deactivate(deactivateTarget.id);
      setFeedbackMsg(
        result.synced
          ? 'Movimiento desactivado lógicamente y sincronizado.'
          : result.syncMessage || 'Movimiento desactivado localmente.'
      );
      if (selectedMovement?.id === deactivateTarget.id) {
        setSelectedMovement(null);
      }
      setDeactivateTarget(null);
      await loadData(includeDeleted, sortOrder);
    } catch (err) {
      setDeactivateError(
        err instanceof Error ? err.message : 'No se pudo desactivar el movimiento.'
      );
    } finally {
      setIsDeactivating(false);
    }
  };

  const hasActiveFilters =
    searchTerm.trim().length > 0 || animalFilter !== 'todos' || tipoFilter !== 'todos';

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Historial Operativo
          </span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Trazabilidad y Movimientos
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(includeDeleted, sortOrder)}
            disabled={loading}
            aria-label="Actualizar movimientos"
            className="min-h-[42px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            type="button"
            onClick={() => setIsRanchTransferOpen(true)}
            className="min-h-[42px] flex items-center gap-2 bg-surface-white border border-brand-primary/40 hover:bg-brand-primary/10 text-brand-forest px-3.5 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <ArrowLeftRight size={15} className="text-brand-primary" /> Trasladar entre Ranchos
          </button>
          <button
            type="button"
            onClick={() => setFormModalState({ open: true, mode: 'create' })}
            className="min-h-[42px] flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Registrar Movimiento
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

      {/* Resumen real de trazabilidad */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Total Movimientos
          </p>
          <p className="text-2xl font-bold text-brand-forest mt-1">{stats.total}</p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Cambios y Traslados
          </p>
          <p className="text-2xl font-bold text-brand-primary mt-1">{stats.internosYTraslados}</p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Altas / Ventas / Bajas
          </p>
          <p className="text-2xl font-bold text-brand-slate mt-1">{stats.altasYSalidas}</p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/55 uppercase tracking-wider">
            Pendientes Sync
          </p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{stats.pendientesSync}</p>
        </div>
      </div>

      {/* Filtros y orden cronológico */}
      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4 relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40"
            />
            <input
              type="text"
              aria-label="Buscar movimientos"
              placeholder="Buscar por arete, potrero, destino o motivo…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-h-[42px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 outline-none focus:border-brand-primary"
            />
          </div>

          <div className="md:col-span-3">
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

          <div className="md:col-span-3">
            <select
              aria-label="Filtrar por tipo de movimiento"
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Tipo: Todos</option>
              {MOVEMENT_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {MOVEMENT_TYPE_LABELS[tipo]}
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
            <span>Mostrar movimientos desactivados</span>
          </label>
          <span>
            Mostrando <strong className="text-brand-slate">{filteredMovements.length}</strong> de{' '}
            <strong className="text-brand-slate">{movements.length}</strong> movimientos
          </span>
        </div>
      </div>

      {/* Línea de tiempo cronológica + Panel de detalle */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={selectedMovement ? 'lg:col-span-8' : 'lg:col-span-12'}>
          {error && movements.length === 0 ? (
            <div
              role="alert"
              className="bg-status-error/10 border border-status-error/25 rounded-xl p-6 text-center text-status-error space-y-2"
            >
              <AlertCircle className="mx-auto" size={24} />
              <p className="font-semibold text-[14px]">No se pudo cargar el historial</p>
              <p className="text-[13px] opacity-85">{error}</p>
            </div>
          ) : loading && movements.length === 0 ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-12 text-center text-brand-slate/60 font-medium flex flex-col items-center gap-3">
              <Loader2 size={24} className="animate-spin text-brand-primary" />
              <span>Cargando línea de tiempo de movimientos…</span>
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm min-h-[340px] flex items-center justify-center p-6">
              <EmptyState
                title={hasActiveFilters ? 'Sin coincidencias' : 'Sin movimientos registrados'}
                message={
                  hasActiveFilters
                    ? 'Ningún movimiento coincide con los filtros actuales.'
                    : 'Aún no hay movimientos registrados. Registra un traslado, alta o salida para iniciar la trazabilidad.'
                }
                icon={Activity}
                actionLabel={hasActiveFilters ? 'Limpiar filtros' : 'Registrar Movimiento'}
                onAction={
                  hasActiveFilters
                    ? () => {
                        setSearchTerm('');
                        setAnimalFilter('todos');
                        setTipoFilter('todos');
                      }
                    : () => setFormModalState({ open: true, mode: 'create' })
                }
              />
            </div>
          ) : (
            <ol
              aria-label="Historial cronológico de movimientos"
              className="relative border-l-2 border-border-light ml-3 space-y-4 pl-6"
            >
              {filteredMovements.map((mov) => {
                const animal = animalById.get(mov.idAnimal);
                const isSelected = selectedMovement?.id === mov.id;
                return (
                  <li key={mov.id} className="relative">
                    <span
                      aria-hidden="true"
                      className={`absolute -left-[31px] top-4 w-3.5 h-3.5 rounded-full border-2 border-surface-white ${
                        mov.deletedAt
                          ? 'bg-brand-slate/40'
                          : mov.tipo === 'Venta' || mov.tipo === 'Baja'
                            ? 'bg-status-error'
                            : mov.tipo === 'Alta'
                              ? 'bg-status-success'
                              : 'bg-brand-primary'
                      }`}
                    />
                    <article
                      className={`bg-surface-white border rounded-xl p-4 shadow-sm transition-colors ${
                        isSelected
                          ? 'border-brand-primary ring-1 ring-brand-primary/30'
                          : 'border-border-light hover:border-brand-primary/50'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-2 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {renderTipoBadge(mov.tipo, mov.deletedAt)}
                            {renderSyncBadge(mov.syncStatus)}
                            <span className="inline-flex items-center gap-1 text-[12px] text-brand-slate/65">
                              <Calendar size={13} />
                              <time dateTime={mov.fecha}>{formatDateTimeDisplay(mov.fecha)}</time>
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[14px]">
                            <Link
                              to={`/cattle/${mov.idAnimal}`}
                              className="font-bold text-brand-forest hover:text-brand-primary hover:underline"
                            >
                              {animal ? animal.arete : `Animal ${mov.idAnimal.slice(0, 8)}…`}
                            </Link>
                            {animal && (
                              <span className="text-[12px] text-brand-slate/65">
                                ({animal.raza} · {animal.sexo})
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[13px] bg-surface-app/70 border border-border-light/80 rounded-lg px-3 py-2">
                            <span className="font-medium text-brand-slate">
                              {describeOrigin(mov)}
                            </span>
                            <ArrowRight size={14} className="text-brand-primary shrink-0" />
                            <span className="font-semibold text-brand-forest">
                              {describeDestination(mov)}
                            </span>
                          </div>

                          {mov.motivo && (
                            <p className="text-[12px] text-brand-slate/80 leading-relaxed">
                              <strong className="text-brand-slate">Motivo / Observaciones:</strong>{' '}
                              {mov.motivo}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0 self-end sm:self-start">
                          <button
                            type="button"
                            onClick={() => setSelectedMovement(mov)}
                            aria-label={`Ver detalle del movimiento ${mov.id}`}
                            title="Ver detalle"
                            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-brand-primary hover:bg-brand-primary/10 rounded-md transition-colors cursor-pointer"
                          >
                            <Eye size={17} />
                          </button>
                          {!mov.deletedAt && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setFormModalState({ open: true, mode: 'edit', movement: mov })
                                }
                                aria-label={`Editar movimiento ${mov.id}`}
                                title="Editar"
                                className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors cursor-pointer"
                              >
                                <Edit size={17} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeactivateTarget(mov);
                                  setDeactivateError(null);
                                }}
                                aria-label={`Desactivar movimiento ${mov.id}`}
                                title="Desactivar"
                                className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-error hover:bg-status-error/10 rounded-md transition-colors cursor-pointer"
                              >
                                <Archive size={17} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Panel lateral de detalle */}
        {selectedMovement && (
          <aside
            aria-label="Detalle del movimiento seleccionado"
            className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden"
          >
            <div className="h-2 bg-brand-primary w-full" />
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-border-light pb-3">
                <div>
                  <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Auditoría de Movimiento
                  </span>
                  <h2 className="text-lg font-bold text-brand-forest mt-0.5">
                    {MOVEMENT_TYPE_LABELS[selectedMovement.tipo]}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMovement(null)}
                  aria-label="Cerrar detalle del movimiento"
                  className="p-1 rounded text-brand-slate/55 hover:bg-surface-secondary hover:text-brand-slate"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {renderTipoBadge(selectedMovement.tipo, selectedMovement.deletedAt)}
                {renderSyncBadge(selectedMovement.syncStatus)}
              </div>

              <dl className="space-y-2.5 text-[13px]">
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Animal</dt>
                  <dd className="mt-0.5">
                    <Link
                      to={`/cattle/${selectedMovement.idAnimal}`}
                      className="font-bold text-brand-primary hover:underline"
                    >
                      {animalById.get(selectedMovement.idAnimal)?.arete ||
                        selectedMovement.idAnimal}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Fecha</dt>
                  <dd className="text-brand-slate mt-0.5">
                    {formatDateTimeDisplay(selectedMovement.fecha)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Origen</dt>
                  <dd className="text-brand-slate mt-0.5">{describeOrigin(selectedMovement)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Destino</dt>
                  <dd className="font-semibold text-brand-forest mt-0.5">
                    {describeDestination(selectedMovement)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Motivo / Observaciones
                  </dt>
                  <dd className="text-brand-slate/85 mt-0.5 whitespace-pre-line">
                    {selectedMovement.motivo || 'Sin observaciones registradas'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Identificador UUID
                  </dt>
                  <dd className="font-mono text-[11px] text-brand-slate/70 mt-0.5 break-all">
                    {selectedMovement.idMovimiento} (v{selectedMovement.versionRegistro})
                  </dd>
                </div>
              </dl>

              <div className="pt-3 border-t border-border-light space-y-2">
                <button
                  type="button"
                  onClick={() => setAnimalFilter(selectedMovement.idAnimal)}
                  className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md bg-surface-app border border-border-light text-[12px] font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary"
                >
                  <Filter size={13} /> Filtrar historial de este animal
                </button>

                {!selectedMovement.deletedAt && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFormModalState({ open: true, mode: 'edit', movement: selectedMovement })
                      }
                      className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md border border-border-light text-[12px] font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary"
                    >
                      <Edit size={13} /> Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeactivateTarget(selectedMovement);
                        setDeactivateError(null);
                      }}
                      className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-md border border-status-error/30 text-[12px] font-semibold text-status-error hover:bg-status-error/10"
                    >
                      <Archive size={13} /> Desactivar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Modal Crear / Editar */}
      {formModalState.open && (
        <MovementFormModal
          mode={formModalState.mode}
          initialMovement={formModalState.mode === 'edit' ? formModalState.movement : undefined}
          preselectedAnimalId={animalFilter !== 'todos' ? animalFilter : undefined}
          animals={animals}
          lots={lots}
          isOnline={isOnline}
          onClose={() => setFormModalState({ open: false })}
          onSubmit={handleSaveMovement}
        />
      )}

      {/* Modal Traslado entre Ranchos (Animal o Lote) */}
      {isRanchTransferOpen && (
        <RanchTransferModal
          animals={animals}
          lots={lots}
          ranches={ranches}
          isOnline={isOnline}
          onClose={() => setIsRanchTransferOpen(false)}
          onTransferAnimal={handleTransferAnimalBetweenRanches}
          onTransferLot={handleTransferLotBetweenRanches}
        />
      )}

      {/* Modal Desactivación lógica */}
      {deactivateTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-movement-title"
          onClick={() => !isDeactivating && setDeactivateTarget(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2
                  id="deactivate-movement-title"
                  className="text-[17px] font-bold text-brand-slate"
                >
                  Desactivar movimiento
                </h2>
                <p className="text-[12px] text-brand-slate/65 mt-1">
                  El movimiento se marcará como desactivado (borrado lógico) conservando su registro en el historial de auditoría.
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
