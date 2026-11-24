import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Baby,
  CheckCircle2,
  Clock,
  Dna,
  Edit3,
  Eye,
  Info,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X
} from 'lucide-react';
import { useConnectivity } from '../../hooks/useConnectivity';
import type { Cattle } from '../../types/cattle';
import type {
  AnimalGenealogyProfile,
  GenealogyInput,
  GenealogyRecord
} from '../../types/genealogy';
import {
  GenealogyService,
  type GenealogyMutationResult
} from '../../services/genealogy.service';
import { buildAnimalGenealogyProfile } from '../../services/genealogy.validation';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import AnimalSelectField from '../shared/AnimalSelectField';
import ResponsiveDataView, { type ResponsiveColumn } from '../shared/ResponsiveDataView';
import EmptyState from '../ui/EmptyState';
import GenealogyFormModal from './GenealogyFormModal';
import GenealogyTreeView from './GenealogyTreeView';

type ModalState =
  | { open: false }
  | { open: true; mode: 'create'; preselectedAnimalId?: string }
  | { open: true; mode: 'edit'; record: GenealogyRecord };

function renderSyncBadge(syncStatus: GenealogyRecord['syncStatus']) {
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

export default function GenealogyPage() {
  const { isOnline } = useConnectivity();
  const [searchParams, setSearchParams] = useSearchParams();

  const [records, setRecords] = useState<GenealogyRecord[]>([]);
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const [selectedAnimalId, setSelectedAnimalId] = useState<string>(
    () => searchParams.get('animal') || ''
  );
  const [directorySearch, setDirectorySearch] = useState<string>('');
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);

  const [treeState, setTreeState] = useState<{
    animalId: string;
    profile: AnimalGenealogyProfile | null;
    source?: 'server' | 'cache';
    error: string | null;
    loading: boolean;
  } | null>(null);
  const [treeRefreshTick, setTreeRefreshTick] = useState<number>(0);

  const [modalState, setModalState] = useState<ModalState>({ open: false });
  const [confirmDeactivate, setConfirmDeactivate] = useState<GenealogyRecord | null>(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);

  const loadData = useCallback(async (withDeleted: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await GenealogyService.getAll({ includeDeleted: withDeleted });
      setRecords(result.records);
      setAnimals(result.animals);
      setWarning(result.warning);
      setTreeRefreshTick((t) => t + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo cargar la información genealógica.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await GenealogyService.getAll({ includeDeleted });
        if (!active) return;
        setRecords(result.records);
        setAnimals(result.animals);
        setWarning(result.warning);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : 'No se pudo cargar la información genealógica.'
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
              (item.entidad === 'genealogy' || item.entidad === 'cattle') &&
              (item.appliedCount > 0 || item.deletedCount > 0 || item.conflictCount > 0)
          )
        );

      if (fullSyncAdvanced || relevantPullApplied) {
        previousSyncAt = nextSyncAt;
        previousCycleFinishedAt = nextCycleFinishedAt;
        void loadData(includeDeleted);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [includeDeleted, loadData]);

  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  const activeRecords = useMemo(() => records.filter((r) => !r.deletedAt), [records]);

  const activeRecordByAnimalId = useMemo(() => {
    const map = new Map<string, GenealogyRecord>();
    for (const r of activeRecords) {
      if (!map.has(r.idAnimal)) {
        map.set(r.idAnimal, r);
      }
    }
    return map;
  }, [activeRecords]);

  // Resolver animal seleccionado efectivo (URL o seleccionado; si no, enfoca el primer vínculo activo)
  const effectiveAnimalId = useMemo(() => {
    if (selectedAnimalId) {
      return selectedAnimalId;
    }
    if (activeRecords.length > 0 && animalById.has(activeRecords[0].idAnimal)) {
      return activeRecords[0].idAnimal;
    }
    return '';
  }, [selectedAnimalId, animalById, activeRecords]);

  useEffect(() => {
    if (!effectiveAnimalId) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const treeRes = await GenealogyService.getAnimalTree(effectiveAnimalId, {
          profundidad: 3,
          animals
        });
        if (!active) return;
        setTreeState({
          animalId: effectiveAnimalId,
          profile: treeRes.profile,
          source: treeRes.source,
          error: null,
          loading: false
        });
        if (treeRes.warning) {
          setWarning((prev) => prev ?? treeRes.warning);
        }
      } catch (err) {
        if (!active) return;
        setTreeState({
          animalId: effectiveAnimalId,
          profile: null,
          source: undefined,
          error:
            err instanceof Error
              ? err.message
              : 'No se pudo consultar el árbol genealógico del ejemplar.',
          loading: false
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [effectiveAnimalId, animals, treeRefreshTick]);

  const activeTreeState =
    effectiveAnimalId && treeState?.animalId === effectiveAnimalId ? treeState : null;
  const treeProfile = activeTreeState?.profile ?? null;
  const treeSource = activeTreeState?.source;
  const treeError = activeTreeState?.error ?? null;
  const treeLoading = Boolean(effectiveAnimalId && (!activeTreeState || activeTreeState.loading));

  const handleSelectAnimal = (animalId: string) => {
    setSelectedAnimalId(animalId);
    if (animalId) {
      setSearchParams({ animal: animalId }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  const animalSelectOptions = useMemo(
    () =>
      animals.map((a) => ({
        id: a.id,
        arete: a.arete,
        raza: a.raza,
        extraLabel: `(${a.sexo} · ${a.estado})`
      })),
    [animals]
  );

  const localFallbackProfile = useMemo(() => {
    if (!effectiveAnimalId) return null;
    return buildAnimalGenealogyProfile(effectiveAnimalId, animals, activeRecords, 3);
  }, [effectiveAnimalId, animals, activeRecords]);

  const focalProfile = useMemo(() => {
    if (treeError) return null;
    if (treeProfile && treeProfile.animal.id === effectiveAnimalId) {
      return treeProfile;
    }
    return localFallbackProfile;
  }, [treeError, treeProfile, effectiveAnimalId, localFallbackProfile]);

  const descendantsCountByAnimalId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of activeRecords) {
      if (r.idPadre) {
        const set = map.get(r.idPadre) ?? new Set<string>();
        set.add(r.idAnimal);
        map.set(r.idPadre, set);
      }
      if (r.idMadre) {
        const set = map.get(r.idMadre) ?? new Set<string>();
        set.add(r.idAnimal);
        map.set(r.idMadre, set);
      }
    }
    return map;
  }, [activeRecords]);

  const stats = useMemo(() => {
    const progenitorsWithOffspring = descendantsCountByAnimalId.size;
    const pendingSync = activeRecords.filter((r) => r.syncStatus !== 'synced').length;
    return {
      totalAnimals: animals.length,
      totalLinks: activeRecords.length,
      progenitorsWithOffspring,
      pendingSync
    };
  }, [animals.length, activeRecords, descendantsCountByAnimalId]);

  const filteredRecords = useMemo(() => {
    const query = directorySearch.trim().toLowerCase();
    return records.filter((rec) => {
      if (!includeDeleted && rec.deletedAt) return false;
      if (!query) return true;
      const animal = animalById.get(rec.idAnimal);
      const padre = rec.idPadre ? animalById.get(rec.idPadre) : undefined;
      const madre = rec.idMadre ? animalById.get(rec.idMadre) : undefined;
      return (
        (animal?.arete || '').toLowerCase().includes(query) ||
        (animal?.raza || '').toLowerCase().includes(query) ||
        (padre?.arete || '').toLowerCase().includes(query) ||
        (madre?.arete || '').toLowerCase().includes(query)
      );
    });
  }, [records, includeDeleted, directorySearch, animalById]);

  const openRegisterOrEditForAnimal = (animalId: string) => {
    const existing =
      activeRecordByAnimalId.get(animalId) ??
      (focalProfile?.animal.id === animalId ? focalProfile.record : null);
    if (existing) {
      setModalState({ open: true, mode: 'edit', record: existing });
    } else {
      setModalState({ open: true, mode: 'create', preselectedAnimalId: animalId });
    }
  };

  const handleSave = async (input: GenealogyInput): Promise<GenealogyMutationResult> => {
    const isEdit = modalState.open && modalState.mode === 'edit';
    const result = isEdit
      ? await GenealogyService.update(modalState.record.id, input)
      : await GenealogyService.create(input);

    setFeedbackMsg(result.syncMessage);
    handleSelectAnimal(result.record.idAnimal);
    await loadData(includeDeleted);
    return result;
  };

  const handleConfirmDeactivate = async () => {
    if (!confirmDeactivate || isDeactivating) return;
    setIsDeactivating(true);
    setError(null);
    try {
      const outcome = await GenealogyService.deactivate(confirmDeactivate.id);
      setFeedbackMsg(outcome.syncMessage);
      setConfirmDeactivate(null);
      await loadData(includeDeleted);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo desactivar el vínculo genealógico.'
      );
    } finally {
      setIsDeactivating(false);
    }
  };

  const renderRecordActions = (rec: GenealogyRecord) => {
    if (rec.deletedAt) {
      return <span className="text-[11px] text-brand-slate/50 italic">Registro desactivado</span>;
    }

    const animal = animalById.get(rec.idAnimal);
    const label = animal ? animal.arete : rec.idAnimal.slice(0, 8);

    return (
      <div className="flex items-center gap-1.5 justify-end flex-wrap">
        <button
          type="button"
          onClick={() => handleSelectAnimal(rec.idAnimal)}
          aria-label={`Ver árbol de ${label}`}
          className="px-2.5 py-1.5 text-[12px] font-semibold text-brand-forest hover:bg-brand-primary/10 rounded-md inline-flex items-center gap-1 transition-colors"
        >
          <Eye size={13} /> Ver árbol
        </button>
        <button
          type="button"
          onClick={() => setModalState({ open: true, mode: 'edit', record: rec })}
          aria-label={`Editar parentesco de ${label}`}
          className="px-2.5 py-1.5 text-[12px] font-semibold text-brand-primary hover:bg-brand-primary/10 rounded-md inline-flex items-center gap-1 transition-colors"
        >
          <Edit3 size={13} /> Editar
        </button>
        <button
          type="button"
          onClick={() => setConfirmDeactivate(rec)}
          aria-label={`Desactivar parentesco de ${label}`}
          className="px-2.5 py-1.5 text-[12px] font-semibold text-status-danger hover:bg-status-danger/10 rounded-md inline-flex items-center gap-1 transition-colors"
        >
          <Trash2 size={13} /> Desactivar
        </button>
      </div>
    );
  };

  const columns: ResponsiveColumn<GenealogyRecord>[] = [
    {
      key: 'animal',
      header: 'Ejemplar',
      hideOnCard: true,
      renderCell: (rec) => {
        const animal = animalById.get(rec.idAnimal);
        return (
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleSelectAnimal(rec.idAnimal)}
                className="font-bold text-brand-forest hover:text-brand-primary hover:underline text-left"
              >
                {animal ? animal.arete : rec.idAnimal.slice(0, 8)}
              </button>
              {rec.deletedAt && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-slate/15 text-brand-slate/70">
                  Desactivado
                </span>
              )}
              {renderSyncBadge(rec.syncStatus)}
            </div>
            {animal && (
              <p className="text-[12px] text-brand-slate/70">
                {animal.raza} · {animal.sexo}
              </p>
            )}
          </div>
        );
      }
    },
    {
      key: 'padre',
      header: 'Padre (Semental)',
      renderCell: (rec) => {
        if (!rec.idPadre) return <span className="text-[12px] text-brand-slate/45">No registrado</span>;
        const padre = animalById.get(rec.idPadre);
        return padre ? (
          <button
            type="button"
            onClick={() => handleSelectAnimal(padre.id)}
            className="text-[12px] font-semibold text-sky-700 hover:underline"
          >
            {padre.arete} ({padre.raza})
          </button>
        ) : (
          <span className="text-[12px] text-brand-slate/70">{rec.idPadre.slice(0, 8)}</span>
        );
      }
    },
    {
      key: 'madre',
      header: 'Madre (Vientre)',
      renderCell: (rec) => {
        if (!rec.idMadre) return <span className="text-[12px] text-brand-slate/45">No registrada</span>;
        const madre = animalById.get(rec.idMadre);
        return madre ? (
          <button
            type="button"
            onClick={() => handleSelectAnimal(madre.id)}
            className="text-[12px] font-semibold text-pink-700 hover:underline"
          >
            {madre.arete} ({madre.raza})
          </button>
        ) : (
          <span className="text-[12px] text-brand-slate/70">{rec.idMadre.slice(0, 8)}</span>
        );
      }
    },
    {
      key: 'descendientes',
      header: 'Descendientes',
      renderCell: (rec) => {
        const count = descendantsCountByAnimalId.get(rec.idAnimal)?.size ?? 0;
        return (
          <span className="text-[12px] font-semibold text-brand-slate">
            {count} {count === 1 ? 'cría' : 'crías'}
          </span>
        );
      }
    }
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Líneas Genéticas
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Genealogía y Parentesco
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(includeDeleted)}
            disabled={loading}
            aria-label="Actualizar genealogía"
            className="min-h-[42px] px-3 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setModalState({
                open: true,
                mode: 'create',
                preselectedAnimalId:
                  effectiveAnimalId && !activeRecordByAnimalId.has(effectiveAnimalId)
                    ? effectiveAnimalId
                    : undefined
              })
            }
            className="min-h-[42px] flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            <Plus size={16} /> Registrar Parentesco
          </button>
        </div>
      </header>

      {warning && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-brand-slate text-[12px] flex items-start gap-2.5"
        >
          <Info size={16} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-brand-forest">Consulta en modo caché local</p>
            <p>{warning}</p>
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
            <span>Animales en Hato</span>
            <Users size={16} className="text-brand-primary" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-forest mt-1">
            {stats.totalAnimals}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Disponibles para consulta</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/60 text-[12px] font-semibold">
            <span>Parentescos Activos</span>
            <Dna size={16} className="text-brand-yellow" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-forest mt-1">
            {stats.totalLinks}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Ejemplares con padre o madre</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/60 text-[12px] font-semibold">
            <span>Progenitores con Crías</span>
            <Baby size={16} className="text-emerald-600" />
          </div>
          <p className="text-2xl font-condensed font-bold text-emerald-700 mt-1">
            {stats.progenitorsWithOffspring}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Sementales y vientres activos</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/60 text-[12px] font-semibold">
            <span>Cola Local Pendiente</span>
            <Clock size={16} className="text-status-warning" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-slate mt-1">
            {stats.pendingSync}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Almacenados en IndexedDB</p>
        </div>
      </div>

      {/* Buscador de animal para explorar árbol genealógico */}
      <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
        <div className="max-w-xl">
          <AnimalSelectField
            id="genealogy-focus-animal"
            label="Consultar árbol genealógico de un animal"
            options={animalSelectOptions}
            value={effectiveAnimalId}
            onChange={(animalId) => handleSelectAnimal(animalId)}
            placeholder="Busca y selecciona un animal por arete para ver su árbol"
            searchPlaceholder="Filtrar animal por arete o raza..."
            helperText="Selecciona cualquier ejemplar para visualizar su padre, madre, abuelos y descendientes registrados."
          />
        </div>
      </div>

      {/* Árbol genealógico visual o estados vacíos claros */}
      {loading ? (
        <div className="bg-surface-white border border-border-light rounded-xl p-10 text-center text-brand-slate/60 text-[13px]">
          Cargando datos genealógicos...
        </div>
      ) : treeError ? (
        <div
          role="alert"
          className="bg-surface-white border border-status-danger/35 rounded-xl p-6 shadow-sm flex items-start gap-3 text-status-danger"
        >
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-[14px]">No se pudo consultar el árbol genealógico</p>
            <p className="text-[13px]">{treeError}</p>
          </div>
        </div>
      ) : animals.length === 0 && !focalProfile ? (
        <div className="bg-surface-white border border-border-light rounded-xl p-6 shadow-sm">
          <EmptyState
            title="No hay animales registrados en el hato"
            message="Registra primero tus bovinos en el módulo de Bovinos para poder consultar y registrar sus relaciones de parentesco."
            icon={Dna}
          />
          <div className="mt-4 text-center">
            <Link
              to="/cattle/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-primary hover:bg-brand-dark text-white rounded-md text-[13px] font-semibold transition-colors"
            >
              <Plus size={15} /> Registrar Primer Bovino
            </Link>
          </div>
        </div>
      ) : focalProfile ? (
        <GenealogyTreeView
          profile={focalProfile}
          source={treeSource}
          loading={treeLoading}
          onSelectAnimal={handleSelectAnimal}
          onRegisterOrEdit={openRegisterOrEditForAnimal}
        />
      ) : treeLoading ? (
        <div className="bg-surface-white border border-border-light rounded-xl p-10 text-center text-brand-slate/60 text-[13px]">
          Consultando árbol genealógico...
        </div>
      ) : (
        <div className="bg-surface-white border border-border-light rounded-xl p-6 shadow-sm">
          <EmptyState
            title="Selecciona un animal para consultar su árbol genealógico"
            message="Aún no hay vínculos genealógicos registrados. Busca un ejemplar en el selector superior o registra su padre y madre manualmente."
            icon={Dna}
            actionLabel="Registrar Parentesco"
            onAction={() => setModalState({ open: true, mode: 'create' })}
          />
        </div>
      )}

      {/* Directorio de parentescos registrados */}
      <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-brand-forest">
              Parentescos Registrados ({filteredRecords.length})
            </h2>
            <p className="text-[12px] text-brand-slate/65">
              Un registro único por ejemplar para evitar relaciones duplicadas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px]">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
              />
              <input
                type="search"
                value={directorySearch}
                onChange={(e) => setDirectorySearch(e.target.value)}
                placeholder="Buscar por arete de cría, padre o madre..."
                aria-label="Buscar parentescos registrados"
                className="w-full h-[36px] pl-8 pr-3 bg-surface-white border border-border-light rounded-md text-[12px] text-brand-slate outline-none focus:border-brand-primary"
              />
            </div>

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

        {filteredRecords.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Sin parentescos registrados"
              message={
                directorySearch
                  ? 'No se encontraron relaciones que coincidan con tu búsqueda.'
                  : 'Aún no existen vínculos de padre o madre guardados. Registra un parentesco real para construir las líneas genéticas.'
              }
              icon={Dna}
              actionLabel={animals.length > 0 ? 'Registrar Parentesco' : undefined}
              onAction={
                animals.length > 0
                  ? () => setModalState({ open: true, mode: 'create' })
                  : undefined
              }
            />
          </div>
        ) : (
          <ResponsiveDataView<GenealogyRecord>
            items={filteredRecords}
            columns={columns}
            getKey={(rec) => rec.id}
            renderCardHeader={(rec) => {
              const animal = animalById.get(rec.idAnimal);
              return (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-brand-forest text-[15px]">
                      {animal ? animal.arete : rec.idAnimal.slice(0, 8)}
                    </span>
                    {renderSyncBadge(rec.syncStatus)}
                  </div>
                  {animal && (
                    <p className="text-[12px] text-brand-slate/70">
                      {animal.raza} · {animal.sexo}
                    </p>
                  )}
                </div>
              );
            }}
            renderCardActions={renderRecordActions}
          />
        )}
      </section>

      {/* Modal de creación / edición */}
      {modalState.open && (
        <GenealogyFormModal
          mode={modalState.mode}
          initialRecord={modalState.mode === 'edit' ? modalState.record : undefined}
          preselectedAnimalId={
            modalState.mode === 'create' ? modalState.preselectedAnimalId : undefined
          }
          animals={animals}
          existingRecords={activeRecords}
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
          aria-labelledby="confirm-deactivate-gen-title"
          onClick={() => !isDeactivating && setConfirmDeactivate(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="confirm-deactivate-gen-title"
              className="text-lg font-condensed font-bold text-brand-forest"
            >
              Desactivar vínculo genealógico
            </h2>
            <p className="text-[13px] text-brand-slate/80">
              ¿Deseas desactivar el parentesco registrado para{' '}
              <strong>
                {animalById.get(confirmDeactivate.idAnimal)?.arete ||
                  confirmDeactivate.idAnimal.slice(0, 8)}
              </strong>
              ? {isOnline
                ? 'Se aplicará baja lógica en el servidor y en la copia local.'
                : 'Se aplicará baja lógica local en IndexedDB y quedará pendiente de sincronización.'}
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
