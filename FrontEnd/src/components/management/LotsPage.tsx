import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  MapPin,
  RefreshCw,
  Edit,
  Archive,
  Eye,
  Cloud,
  CloudUpload,
  AlertCircle,
  AlertOctagon,
  CheckCircle2,
  Loader2,
  Beef,
  X
} from 'lucide-react';
import type { Cattle, RanchOption } from '../../types/cattle';
import type { Lot, LotInput } from '../../types/lot';
import { LotService, type LotMutationResult } from '../../services/lot.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { useSharedCattle } from '../../hooks/useCattle';
import EmptyState from '../ui/EmptyState';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';
import LotFormModal from './LotFormModal';

function renderSyncBadge(syncStatus: Lot['syncStatus']) {
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

function renderEstadoBadge(estado: Lot['estado'], deletedAt: string | null) {
  if (deletedAt) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-slate/15 text-brand-slate/70">
        Desactivado
      </span>
    );
  }
  if (estado === 'Inactivo') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-warning/15 text-amber-800">
        Inactivo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-success/10 text-status-success">
      Activo
    </span>
  );
}

export default function LotsPage() {
  const { isOnline } = useSyncStatus();
  const { refresh: refreshCattleContext } = useSharedCattle();

  const [lots, setLots] = useState<Lot[]>([]);
  const [ranches, setRanches] = useState<RanchOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [ranchFilter, setRanchFilter] = useState<string>('todos');
  const [estadoFilter, setEstadoFilter] = useState<string>('todos');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  // Modales y selección de detalle
  const [formModalState, setFormModalState] = useState<
    { open: false } | { open: true; mode: 'create' } | { open: true; mode: 'edit'; lot: Lot }
  >({ open: false });

  const [selectedLot, setSelectedLot] = useState<Lot | null>(null);
  const [selectedLotAnimals, setSelectedLotAnimals] = useState<Cattle[]>([]);
  const [loadingLotAnimals, setLoadingLotAnimals] = useState<boolean>(false);

  const [deactivateTarget, setDeactivateTarget] = useState<Lot | null>(null);
  const [deactivateMode, setDeactivateMode] = useState<'soft_delete' | 'Inactivo' | 'Activo'>(
    'soft_delete'
  );
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const loadLots = useCallback(async (withDeleted: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await LotService.getAll({ includeDeleted: withDeleted });
      setLots(result.data);
      setRanches(result.ranches);
      setApiWarning(result.warning);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudieron cargar los potreros desde el almacenamiento local.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await LotService.getAll({ includeDeleted });
        if (!active) return;
        setLots(result.data);
        setRanches(result.ranches);
        setApiWarning(result.warning);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudieron cargar los potreros.'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    const unsubscribe = SyncScheduler.subscribeToDataUpdates(['lots', 'ranches'], () => {
      void loadLots(includeDeleted);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [includeDeleted, loadLots]);

  const ranchNameById = useMemo(
    () => new Map(ranches.map((r) => [r.id, r.nombre])),
    [ranches]
  );

  const filteredLots = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return lots.filter((lot) => {
      if (!includeDeleted && lot.deletedAt) return false;
      if (ranchFilter !== 'todos' && lot.idRancho !== ranchFilter) return false;
      if (estadoFilter !== 'todos' && lot.estado !== estadoFilter) return false;
      if (!query) return true;

      const ranchName = (ranchNameById.get(lot.idRancho) || '').toLowerCase();
      return (
        lot.nombre.toLowerCase().includes(query) ||
        (lot.ubicacion || '').toLowerCase().includes(query) ||
        ranchName.includes(query) ||
        lot.idLote.toLowerCase().includes(query)
      );
    });
  }, [lots, includeDeleted, ranchFilter, estadoFilter, searchTerm, ranchNameById]);

  const handleSelectLot = async (lot: Lot) => {
    setSelectedLot(lot);
    setLoadingLotAnimals(true);
    try {
      const assigned = await LotService.getAnimalsInLot(lot.id);
      setSelectedLotAnimals(assigned);
    } catch {
      setSelectedLotAnimals([]);
    } finally {
      setLoadingLotAnimals(false);
    }
  };

  const handleSaveLot = async (input: LotInput): Promise<LotMutationResult> => {
    const result =
      formModalState.open && formModalState.mode === 'edit'
        ? await LotService.update(formModalState.lot.id, input)
        : await LotService.create(input);

    const confirmation = result.synced
      ? formModalState.open && formModalState.mode === 'edit'
        ? `Potrero "${result.lot.nombre}" actualizado y sincronizado.`
        : `Potrero "${result.lot.nombre}" registrado y sincronizado.`
      : result.syncMessage ||
        `Potrero "${result.lot.nombre}" guardado localmente. Pendiente de sincronización.`;

    setFeedbackMsg(confirmation);
    await loadLots(includeDeleted);
    await refreshCattleContext();
    if (selectedLot && selectedLot.id === result.lot.id) {
      setSelectedLot(result.lot);
    }
    return result;
  };

  const openDeactivateModal = (lot: Lot) => {
    setDeactivateTarget(lot);
    setDeactivateMode(lot.activeAnimalsCount > 0 ? 'Inactivo' : 'soft_delete');
    setDeactivateError(null);
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget || isDeactivating) return;
    setIsDeactivating(true);
    setDeactivateError(null);

    try {
      if (deactivateMode === 'soft_delete') {
        const result = await LotService.deactivate(deactivateTarget.id);
        setFeedbackMsg(
          result.synced
            ? `Potrero "${deactivateTarget.nombre}" desactivado y sincronizado.`
            : result.syncMessage ||
                `Potrero "${deactivateTarget.nombre}" desactivado localmente.`
        );
        if (selectedLot?.id === deactivateTarget.id) {
          setSelectedLot(null);
        }
      } else {
        const result = await LotService.setEstado(deactivateTarget.id, deactivateMode);
        setFeedbackMsg(
          result.synced
            ? `Estado de "${deactivateTarget.nombre}" actualizado a ${deactivateMode} y sincronizado.`
            : result.syncMessage ||
                `Estado de "${deactivateTarget.nombre}" guardado localmente como ${deactivateMode}.`
        );
        if (selectedLot?.id === deactivateTarget.id) {
          setSelectedLot(result.lot);
        }
      }

      setDeactivateTarget(null);
      await loadLots(includeDeleted);
      await refreshCattleContext();
    } catch (err) {
      setDeactivateError(
        err instanceof Error ? err.message : 'No se pudo completar la operación.'
      );
    } finally {
      setIsDeactivating(false);
    }
  };

  const columns: ResponsiveColumn<Lot>[] = [
    {
      key: 'nombre',
      header: 'Potrero / Lote',
      hideOnCard: true,
      renderCell: (lot) => (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void handleSelectLot(lot)}
            className="font-bold text-brand-forest hover:text-brand-primary hover:underline text-left cursor-pointer"
          >
            {lot.nombre}
          </button>
          {renderSyncBadge(lot.syncStatus)}
        </div>
      )
    },
    {
      key: 'rancho',
      header: 'Rancho',
      renderCell: (lot) => (
        <span className="text-[13px] text-brand-slate/85">
          {ranchNameById.get(lot.idRancho) || lot.idRancho}
        </span>
      )
    },
    {
      key: 'ubicacion',
      header: 'Ubicación',
      renderCell: (lot) => (
        <span className="text-[13px] text-brand-slate/80">{lot.ubicacion || 'Sin referencia'}</span>
      )
    },
    {
      key: 'animales',
      header: 'Animales activos',
      renderCell: (lot) => (
        <span className="inline-flex items-center gap-1 font-semibold text-brand-slate">
          <Beef size={14} className="text-brand-primary" />
          {lot.activeAnimalsCount}
        </span>
      )
    },
    {
      key: 'estado',
      header: 'Estado',
      renderCell: (lot) => renderEstadoBadge(lot.estado, lot.deletedAt)
    }
  ];

  const hasActiveFilters =
    searchTerm.trim().length > 0 || ranchFilter !== 'todos' || estadoFilter !== 'todos';

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Organización del Rancho
          </span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Gestión de Potreros y Lotes
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadLots(includeDeleted)}
            disabled={loading}
            aria-label="Actualizar potreros"
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
            <Plus size={16} /> Crear Potrero
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

      {/* Filtros y búsqueda */}
      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6 relative">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40"
            />
            <input
              type="text"
              aria-label="Buscar potreros"
              placeholder="Buscar potrero por nombre, ubicación o rancho…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-h-[42px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 outline-none focus:border-brand-primary"
            />
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filtrar por rancho"
              value={ranchFilter}
              onChange={(e) => setRanchFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Rancho: Todos</option>
              {ranches.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filtrar por estado"
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Estado: Todos</option>
              <option value="Activo">Activo</option>
              <option value="Inactivo">Inactivo</option>
            </select>
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
            <span>Mostrar potreros desactivados</span>
          </label>
          <span>
            Mostrando <strong className="text-brand-slate">{filteredLots.length}</strong> de{' '}
            <strong className="text-brand-slate">{lots.length}</strong> potreros
          </span>
        </div>
      </div>

      {/* Lista + Panel de detalle del potrero seleccionado */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className={selectedLot ? 'lg:col-span-8' : 'lg:col-span-12'}>
          {error && lots.length === 0 ? (
            <div
              role="alert"
              className="bg-status-error/10 border border-status-error/25 rounded-xl p-6 text-center text-status-error space-y-2"
            >
              <AlertCircle className="mx-auto" size={24} />
              <p className="font-semibold text-[14px]">No se pudieron cargar los potreros</p>
              <p className="text-[13px] opacity-85">{error}</p>
            </div>
          ) : loading && lots.length === 0 ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-12 text-center text-brand-slate/60 font-medium flex flex-col items-center gap-3">
              <Loader2 size={24} className="animate-spin text-brand-primary" />
              <span>Cargando potreros y lotes…</span>
            </div>
          ) : filteredLots.length === 0 ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm min-h-[340px] flex items-center justify-center p-4">
              <EmptyState
                title={hasActiveFilters ? 'Sin coincidencias' : 'Sin potreros registrados'}
                message={
                  hasActiveFilters
                    ? 'Ningún potrero coincide con tu búsqueda o filtros actuales.'
                    : 'Aún no hay potreros o lotes configurados. Crea el primero para organizar tu ganado.'
                }
                icon={MapPin}
                actionLabel={hasActiveFilters ? 'Limpiar filtros' : 'Crear Potrero'}
                onAction={
                  hasActiveFilters
                    ? () => {
                        setSearchTerm('');
                        setRanchFilter('todos');
                        setEstadoFilter('todos');
                      }
                    : () => setFormModalState({ open: true, mode: 'create' })
                }
              />
            </div>
          ) : (
            <ResponsiveDataView
              items={filteredLots}
              getKey={(lot) => lot.id}
              columns={columns}
              renderCardHeader={(lot) => (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSelectLot(lot)}
                    className="font-bold text-brand-forest hover:underline text-left"
                  >
                    {lot.nombre}
                  </button>
                  {renderSyncBadge(lot.syncStatus)}
                </div>
              )}
              renderCardActions={(lot) => (
                <div className="inline-flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => void handleSelectLot(lot)}
                    aria-label={`Consultar detalle de ${lot.nombre}`}
                    title="Consultar detalle"
                    className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-brand-primary hover:bg-brand-primary/10 rounded-md transition-colors cursor-pointer"
                  >
                    <Eye size={17} />
                  </button>
                  {!lot.deletedAt && (
                    <>
                      <button
                        type="button"
                        onClick={() => setFormModalState({ open: true, mode: 'edit', lot })}
                        aria-label={`Editar ${lot.nombre}`}
                        title="Editar"
                        className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center text-brand-slate/65 hover:text-status-info hover:bg-status-info/10 rounded-md transition-colors cursor-pointer"
                      >
                        <Edit size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeactivateModal(lot)}
                        aria-label={`Desactivar ${lot.nombre}`}
                        title="Desactivar / Cambiar estado"
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

        {/* Panel de Detalle y Animales Asignados al Potrero Seleccionado */}
        {selectedLot && (
          <aside
            aria-label="Detalle del potrero seleccionado"
            className="lg:col-span-4 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden"
          >
            <div className="h-2 bg-brand-primary w-full" />
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-border-light pb-3">
                <div>
                  <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Detalle del Potrero
                  </span>
                  <h2 className="text-xl font-bold text-brand-forest mt-0.5">
                    {selectedLot.nombre}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLot(null)}
                  aria-label="Cerrar detalle del potrero"
                  className="p-1 rounded text-brand-slate/55 hover:bg-surface-secondary hover:text-brand-slate"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {renderEstadoBadge(selectedLot.estado, selectedLot.deletedAt)}
                {renderSyncBadge(selectedLot.syncStatus)}
              </div>

              <dl className="space-y-2.5 text-[13px]">
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Rancho</dt>
                  <dd className="font-semibold text-brand-slate mt-0.5 break-all">
                    {ranchNameById.get(selectedLot.idRancho) || selectedLot.idRancho}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">Ubicación</dt>
                  <dd className="text-brand-slate mt-0.5">
                    {selectedLot.ubicacion || 'Sin referencia registrada'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Identificador UUID
                  </dt>
                  <dd className="font-mono text-[11px] text-brand-slate/70 mt-0.5 break-all">
                    {selectedLot.idLote} (v{selectedLot.versionRegistro})
                  </dd>
                </div>
              </dl>

              {!selectedLot.deletedAt && (
                <div className="flex gap-2 pt-2 border-t border-border-light">
                  <button
                    type="button"
                    onClick={() => setFormModalState({ open: true, mode: 'edit', lot: selectedLot })}
                    className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-md border border-border-light text-[12px] font-semibold text-brand-slate hover:border-brand-primary hover:text-brand-primary"
                  >
                    <Edit size={14} /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeactivateModal(selectedLot)}
                    className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-md border border-status-error/30 text-[12px] font-semibold text-status-error hover:bg-status-error/10"
                  >
                    <Archive size={14} /> Desactivar
                  </button>
                </div>
              )}

              {/* Animales asignados */}
              <div className="pt-3 border-t border-border-light space-y-2">
                <h3 className="text-[12px] font-bold text-brand-slate/70 uppercase tracking-wider flex items-center gap-1.5">
                  <Beef size={14} className="text-brand-primary" /> Animales asignados (
                  {selectedLotAnimals.length})
                </h3>

                {loadingLotAnimals ? (
                  <p className="text-[12px] text-brand-slate/60 py-2">Cargando animales…</p>
                ) : selectedLotAnimals.length === 0 ? (
                  <p className="text-[12px] text-brand-slate/60 py-2">
                    No hay animales activos asignados a este potrero.
                  </p>
                ) : (
                  <ul className="divide-y divide-border-light max-h-56 overflow-y-auto text-[13px]">
                    {selectedLotAnimals.map((animal) => (
                      <li key={animal.id} className="py-2 flex items-center justify-between gap-2">
                        <Link
                          to={`/cattle/${animal.id}`}
                          className="font-semibold text-brand-primary hover:underline truncate"
                        >
                          {animal.arete}
                        </Link>
                        <span className="text-[11px] text-brand-slate/65 shrink-0">
                          {animal.raza} • {animal.sexo}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Modal Crear / Editar */}
      {formModalState.open && (
        <LotFormModal
          mode={formModalState.mode}
          initialLot={formModalState.mode === 'edit' ? formModalState.lot : undefined}
          ranches={ranches}
          existingLots={lots}
          isOnline={isOnline}
          onClose={() => setFormModalState({ open: false })}
          onSubmit={handleSaveLot}
        />
      )}

      {/* Modal Desactivar / Cambiar Estado */}
      {deactivateTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deactivate-lot-title"
          onClick={() => !isDeactivating && setDeactivateTarget(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="deactivate-lot-title" className="text-[17px] font-bold text-brand-slate">
                  Gestionar estado — {deactivateTarget.nombre}
                </h2>
                <p className="text-[12px] text-brand-slate/65 mt-1">
                  {deactivateTarget.activeAnimalsCount > 0
                    ? `Este potrero tiene ${deactivateTarget.activeAnimalsCount} animal(es) activo(s) asignado(s). No puede eliminarse lógicamente hasta trasladarlos, pero puedes marcarlo como Inactivo.`
                    : 'Puedes marcar el potrero como Inactivo o desactivarlo lógicamente conservando su historial.'}
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

            <div className="space-y-1.5">
              <label
                htmlFor="lot-deactivate-mode"
                className="block text-[12px] font-semibold text-brand-slate"
              >
                Acción
              </label>
              <select
                id="lot-deactivate-mode"
                value={deactivateMode}
                onChange={(e) =>
                  setDeactivateMode(e.target.value as 'soft_delete' | 'Inactivo' | 'Activo')
                }
                className="w-full min-h-[42px] px-3 border border-border-light rounded-lg text-[13px] bg-surface-app text-brand-slate"
              >
                <option value="soft_delete">
                  Desactivar potrero (borrado lógico)
                </option>
                <option value="Inactivo">Marcar como Inactivo</option>
                {deactivateTarget.estado === 'Inactivo' && (
                  <option value="Activo">Reactivar como Activo</option>
                )}
              </select>
            </div>

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
                {deactivateMode === 'soft_delete' ? 'Confirmar desactivación' : 'Aplicar cambio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
