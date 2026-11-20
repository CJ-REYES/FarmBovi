import { useState, useMemo } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  Search,
  Plus,
  Eye,
  Edit,
  Archive,
  Beef,
  AlertCircle,
  Cloud,
  CloudUpload,
  AlertOctagon,
  WifiOff,
  CheckCircle2,
  RefreshCw,
  Loader2,
  X
} from 'lucide-react';
import { useSharedCattle } from '../../hooks/useCattle';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import type { Cattle } from '../../types/cattle';
import { calculateAnimalAge, getTodayDateString } from '../../services/cattle.validation';
import EmptyState from '../ui/EmptyState';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';

interface LocationFeedbackState {
  feedback?: string;
}

function renderSyncBadge(syncStatus: Cattle['syncStatus']) {
  switch (syncStatus) {
    case 'synced':
      return (
        <span
          title="Sincronizado con el servidor"
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-success/10 text-status-success"
        >
          <Cloud size={12} /> Sincronizado
        </span>
      );
    case 'conflict':
      return (
        <span
          title="Conflicto de versión pendiente de resolver"
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700"
        >
          <AlertOctagon size={12} /> Conflicto
        </span>
      );
    case 'error':
      return (
        <span
          title="Error al sincronizar con el servidor"
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-error/10 text-status-error"
        >
          <AlertCircle size={12} /> Error sync
        </span>
      );
    case 'pending':
    default:
      return (
        <span
          title="Guardado localmente. Pendiente de sincronización"
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-warning/15 text-amber-800"
        >
          <CloudUpload size={12} /> Pendiente
        </span>
      );
  }
}

function renderEstadoBadge(estado: string, deletedAt: string | null) {
  if (deletedAt) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-slate/15 text-brand-slate/70">
        Desactivado
      </span>
    );
  }
  const normalized = estado.trim().toLowerCase();
  if (normalized === 'vendido' || normalized === 'venta') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-info/15 text-status-info">
        Vendido
      </span>
    );
  }
  if (normalized === 'baja') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-error/10 text-status-error">
        Baja
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-success/10 text-status-success">
      {estado || 'Activo'}
    </span>
  );
}

export default function CattleListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationFeedbackState | null;

  const {
    cattle,
    ranches,
    lots,
    loading,
    error,
    apiWarning,
    refresh,
    registerExit,
    deactivate
  } = useSharedCattle();
  const { isOnline } = useSyncStatus();

  const [searchTerm, setSearchTerm] = useState('');
  const [sexoFilter, setSexoFilter] = useState<string>('todos');
  const [estadoFilter, setEstadoFilter] = useState<string>('todos');
  const [lotFilter, setLotFilter] = useState<string>('todos');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  const [actionTarget, setActionTarget] = useState<Cattle | null>(null);
  const [deactivateMode, setDeactivateMode] = useState<'soft_delete' | 'Vendido' | 'Baja'>(
    'soft_delete'
  );
  const [exitDate, setExitDate] = useState<string>(() => getTodayDateString());
  const [exitNotes, setExitNotes] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(
    () => locationState?.feedback ?? null
  );

  const ranchNameById = useMemo(
    () => new Map(ranches.map((r) => [r.id, r.nombre])),
    [ranches]
  );

  const lotNameById = useMemo(
    () => new Map(lots.map((l) => [l.id, l.nombre])),
    [lots]
  );

  const filteredCattle = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return cattle.filter((animal) => {
      if (!includeDeleted && animal.deletedAt) return false;
      if (sexoFilter !== 'todos' && animal.sexo !== sexoFilter) return false;
      if (estadoFilter !== 'todos' && animal.estado !== estadoFilter) return false;
      if (lotFilter === 'sin_lote' && animal.idLote) return false;
      if (lotFilter !== 'todos' && lotFilter !== 'sin_lote' && animal.idLote !== lotFilter) {
        return false;
      }

      if (!query) return true;
      const lotName = animal.idLote ? (lotNameById.get(animal.idLote) || '').toLowerCase() : '';
      const ranchName = (ranchNameById.get(animal.idRancho) || '').toLowerCase();
      return (
        animal.arete.toLowerCase().includes(query) ||
        animal.raza.toLowerCase().includes(query) ||
        animal.procedencia.toLowerCase().includes(query) ||
        (animal.observaciones || '').toLowerCase().includes(query) ||
        lotName.includes(query) ||
        ranchName.includes(query)
      );
    });
  }, [
    cattle,
    searchTerm,
    sexoFilter,
    estadoFilter,
    lotFilter,
    includeDeleted,
    lotNameById,
    ranchNameById
  ]);

  const handleToggleIncludeDeleted = async () => {
    const nextValue = !includeDeleted;
    setIncludeDeleted(nextValue);
    await refresh({ includeDeleted: nextValue });
  };

  const openDeactivateModal = (animal: Cattle) => {
    setActionTarget(animal);
    setDeactivateMode('soft_delete');
    setExitDate(getTodayDateString());
    setExitNotes('');
    setActionError(null);
  };

  const handleConfirmDeactivation = async () => {
    if (!actionTarget || isProcessingAction) return;

    setIsProcessingAction(true);
    setActionError(null);
    try {
      if (deactivateMode === 'soft_delete') {
        const result = await deactivate(actionTarget.id);
        setFeedbackMsg(
          result.synced
            ? `Animal ${actionTarget.arete} desactivado y sincronizado (su historial se conserva).`
            : result.syncMessage ||
                `Animal ${actionTarget.arete} desactivado localmente. Pendiente de sincronización.`
        );
      } else {
        const result = await registerExit(actionTarget.id, {
          estado: deactivateMode,
          fechaSalida: exitDate,
          observaciones: exitNotes.trim() || null
        });
        setFeedbackMsg(
          result.synced
            ? `Salida (${deactivateMode}) registrada para ${actionTarget.arete} y sincronizada.`
            : result.syncMessage ||
                `Salida (${deactivateMode}) guardada localmente para ${actionTarget.arete}.`
        );
      }
      setActionTarget(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'No se pudo completar la operación.'
      );
    } finally {
      setIsProcessingAction(false);
    }
  };

  const columns: ResponsiveColumn<Cattle>[] = [
    {
      key: 'arete',
      header: 'Arete / Identificación',
      hideOnCard: true,
      renderCell: (animal) => (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold bg-brand-yellow/20 text-brand-dark px-2 py-0.5 rounded border border-brand-yellow/35 text-[13px]">
            {animal.arete || 'Sin arete'}
          </span>
          {renderSyncBadge(animal.syncStatus)}
        </div>
      )
    },
    {
      key: 'raza',
      header: 'Raza',
      renderCell: (animal) => <span className="font-medium">{animal.raza || '--'}</span>
    },
    {
      key: 'sexo',
      header: 'Sexo',
      renderCell: (animal) =>
        animal.sexo === 'Hembra' ? (
          <span className="text-pink-700 font-medium bg-pink-50 px-2 py-0.5 rounded-full text-[12px]">
            Hembra
          </span>
        ) : (
          <span className="text-blue-700 font-medium bg-blue-50 px-2 py-0.5 rounded-full text-[12px]">
            Macho
          </span>
        )
    },
    {
      key: 'edad',
      header: 'Edad',
      renderCell: (animal) => (
        <span className="text-[13px] text-brand-slate/80">
          {calculateAnimalAge(animal.fechaNacimiento)}
        </span>
      )
    },
    {
      key: 'lote',
      header: 'Potrero / Lote',
      renderCell: (animal) => (
        <span className="text-[13px] text-brand-slate/85">
          {animal.idLote ? lotNameById.get(animal.idLote) || 'Lote asignado' : 'Sin asignar'}
        </span>
      )
    },
    {
      key: 'estado',
      header: 'Estado',
      renderCell: (animal) => renderEstadoBadge(animal.estado, animal.deletedAt)
    }
  ];

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    sexoFilter !== 'todos' ||
    estadoFilter !== 'todos' ||
    lotFilter !== 'todos';

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Padrón Ganadero
          </span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Inventario de Animales
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh({ includeDeleted })}
            disabled={loading}
            aria-label="Actualizar inventario"
            className="min-h-[42px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/cattle/new')}
            className="min-h-[42px] flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Registrar Animal
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
            Trabajando sin conexión. Los registros mostrados provienen de IndexedDB y cualquier alta o cambio se sincronizará al reconectar.
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

      {/* Filtros y búsqueda */}
      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40"
            />
            <input
              type="text"
              aria-label="Buscar animales"
              placeholder="Buscar por arete, raza, procedencia o potrero…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-h-[42px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 focus:outline-none focus:border-brand-primary"
            />
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filtrar por sexo"
              value={sexoFilter}
              onChange={(e) => setSexoFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Sexo: Todos</option>
              <option value="Hembra">Hembra</option>
              <option value="Macho">Macho</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filtrar por estado"
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Estado: Todos</option>
              <option value="Activo">Activo</option>
              <option value="Vendido">Vendido</option>
              <option value="Baja">Baja</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filtrar por potrero o lote"
              value={lotFilter}
              onChange={(e) => setLotFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Potrero / Lote: Todos</option>
              <option value="sin_lote">Sin potrero asignado</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-light/70 text-[12px] text-brand-slate/70">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={() => void handleToggleIncludeDeleted()}
              className="rounded border-border-dark text-brand-primary focus:ring-brand-primary"
            />
            <span>Mostrar animales desactivados</span>
          </label>
          <span>
            Mostrando <strong className="text-brand-slate">{filteredCattle.length}</strong> de{' '}
            <strong className="text-brand-slate">{cattle.length}</strong> registros
          </span>
        </div>
      </div>

      {/* Contenido principal */}
      {error && cattle.length === 0 ? (
        <div
          role="alert"
          className="bg-status-error/10 border border-status-error/25 rounded-xl p-6 text-center text-status-error space-y-2"
        >
          <AlertCircle className="mx-auto" size={24} />
          <p className="font-semibold text-[14px]">No se pudo cargar el inventario</p>
          <p className="text-[13px] opacity-85">{error}</p>
        </div>
      ) : loading && cattle.length === 0 ? (
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-12 text-center text-brand-slate/60 font-medium flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-brand-primary" />
          <span>Cargando padrón ganadero…</span>
        </div>
      ) : filteredCattle.length === 0 ? (
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm min-h-[340px] flex items-center justify-center p-4">
          <EmptyState
            title={hasActiveFilters ? 'Sin coincidencias' : 'No hay animales registrados'}
            message={
              hasActiveFilters
                ? 'Ningún animal coincide con los filtros o la búsqueda actual.'
                : 'El inventario está vacío. Comienza registrando tu primer animal.'
            }
            icon={Beef}
            actionLabel={hasActiveFilters ? 'Limpiar filtros' : 'Registrar Animal'}
            onAction={
              hasActiveFilters
                ? () => {
                    setSearchTerm('');
                    setSexoFilter('todos');
                    setEstadoFilter('todos');
                    setLotFilter('todos');
                  }
                : () => navigate('/cattle/new')
            }
          />
        </div>
      ) : (
        <ResponsiveDataView
          items={filteredCattle}
          getKey={(animal) => animal.id}
          columns={columns}
          renderCardHeader={(animal) => (
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-brand-yellow/20 text-brand-dark px-2 py-0.5 rounded border border-brand-yellow/35 text-[13px]">
                {animal.arete}
              </span>
              {renderSyncBadge(animal.syncStatus)}
            </div>
          )}
          renderCardActions={(animal) => (
            <div className="inline-flex items-center justify-end gap-1">
              <Link
                to={`/cattle/${animal.id}`}
                aria-label={`Ver expediente de ${animal.arete}`}
                title="Ver expediente"
                className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-brand-primary hover:bg-brand-primary/10 rounded-md transition-colors"
              >
                <Eye size={17} />
              </Link>
              {!animal.deletedAt && (
                <>
                  <Link
                    to={`/cattle/${animal.id}/edit`}
                    aria-label={`Editar ${animal.arete}`}
                    title="Editar"
                    className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors"
                  >
                    <Edit size={17} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => openDeactivateModal(animal)}
                    aria-label={`Desactivar o registrar salida de ${animal.arete}`}
                    title="Desactivar / Registrar salida"
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

      {/* Modal de Desactivación / Registro de Salida (conservando historial — Regla 08) */}
      {actionTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-animal-title"
          onClick={() => !isProcessingAction && setActionTarget(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="deactivate-animal-title" className="text-[17px] font-bold text-brand-slate">
                  Desactivar o registrar salida — {actionTarget.arete}
                </h2>
                <p className="text-[12px] text-brand-slate/65 mt-1">
                  El expediente y su historial se conservan íntegros (borrado lógico sin cascada).
                </p>
              </div>
              <button
                type="button"
                disabled={isProcessingAction}
                onClick={() => setActionTarget(null)}
                aria-label="Cerrar diálogo"
                className="p-1 text-brand-slate/50 hover:text-brand-slate rounded"
              >
                <X size={16} />
              </button>
            </div>

            {actionError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-[12px]"
              >
                {actionError}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-[12px] font-semibold text-brand-slate">
                Acción a realizar
              </label>
              <select
                value={deactivateMode}
                onChange={(e) =>
                  setDeactivateMode(e.target.value as 'soft_delete' | 'Vendido' | 'Baja')
                }
                className="w-full min-h-[42px] px-3 border border-border-light rounded-lg text-[13px] bg-surface-app text-brand-slate"
              >
                <option value="soft_delete">Desactivar expediente (borrado lógico)</option>
                <option value="Vendido">Registrar salida por Venta</option>
                <option value="Baja">Registrar salida por Baja</option>
              </select>
            </div>

            {deactivateMode !== 'soft_delete' && (
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="modal-exit-date"
                    className="block text-[12px] font-semibold text-brand-slate mb-1"
                  >
                    Fecha de salida
                  </label>
                  <input
                    id="modal-exit-date"
                    type="date"
                    max={getTodayDateString()}
                    value={exitDate}
                    onChange={(e) => setExitDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 border border-border-light rounded-lg text-[13px] bg-surface-app text-brand-slate"
                  />
                </div>
                <div>
                  <label
                    htmlFor="modal-exit-notes"
                    className="block text-[12px] font-semibold text-brand-slate mb-1"
                  >
                    Observación de salida (opcional)
                  </label>
                  <input
                    id="modal-exit-notes"
                    type="text"
                    value={exitNotes}
                    onChange={(e) => setExitNotes(e.target.value)}
                    placeholder="Motivo o comprador…"
                    className="w-full min-h-[42px] px-3 border border-border-light rounded-lg text-[13px] bg-surface-app text-brand-slate"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
              <button
                type="button"
                disabled={isProcessingAction}
                onClick={() => setActionTarget(null)}
                className="min-h-[40px] px-4 rounded-lg border border-border-light text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isProcessingAction}
                onClick={() => void handleConfirmDeactivation()}
                className="min-h-[40px] px-4 rounded-lg bg-status-error hover:bg-red-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isProcessingAction && <Loader2 size={14} className="animate-spin" />}
                {deactivateMode === 'soft_delete' ? 'Confirmar desactivación' : 'Registrar salida'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
