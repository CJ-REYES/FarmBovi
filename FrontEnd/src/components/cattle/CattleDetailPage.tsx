import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Edit,
  Calendar,
  Info,
  Scale,
  Syringe,
  HeartPulse,
  Dna,
  Activity,
  MapPin,
  Cloud,
  CloudUpload,
  AlertCircle,
  AlertOctagon,
  Archive,
  CheckCircle2,
  Loader2,
  X
} from 'lucide-react';
import { useSharedCattle } from '../../hooks/useCattle';
import type { Cattle } from '../../types/cattle';
import type {
  LocalGenealogy,
  LocalHealthRecord,
  LocalMovement,
  LocalReproductionRecord,
  LocalWeighing
} from '../../lib/database/schema';
import {
  GenealogyRepository,
  HealthRepository,
  MovementRepository,
  ReproductionRepository,
  WeighingRepository
} from '../../lib/database/repositories';
import { calculateAnimalAge } from '../../services/cattle.validation';
import EmptyState from '../ui/EmptyState';

interface DetailLocationState {
  feedback?: string;
}

interface AnimalHistory {
  movements: LocalMovement[];
  weighings: LocalWeighing[];
  healthRecords: LocalHealthRecord[];
  reproductionRecords: LocalReproductionRecord[];
  genealogy?: LocalGenealogy;
}

function formatDateDisplay(value: string | null | undefined): string {
  if (!value) return 'No registrada';
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export default function CattleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as DetailLocationState | null;

  const { ranches, lots, getById, deactivate } = useSharedCattle();

  const [animal, setAnimal] = useState<Cattle | null>(null);
  const [history, setHistory] = useState<AnimalHistory>({
    movements: [],
    weighings: [],
    healthRecords: [],
    reproductionRecords: []
  });
  const [loading, setLoading] = useState<boolean>(Boolean(id));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(
    () => locationState?.feedback ?? null
  );
  const [confirmDeactivate, setConfirmDeactivate] = useState<boolean>(false);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);

  useEffect(() => {
    if (!id) return;

    let active = true;

    void (async () => {
      try {
        const record = await getById(id);
        if (!active) return;

        if (!record) {
          setAnimal(null);
          return;
        }

        setAnimal(record);
        setErrorMsg(null);

        const [movements, weighings, healthRecords, reproductionRecords, genealogy] =
          await Promise.all([
            MovementRepository.getByCattleId(record.id),
            WeighingRepository.getByCattleId(record.id),
            HealthRepository.getByCattleId(record.id),
            ReproductionRepository.getByCattleId(record.id),
            GenealogyRepository.getByCattleId(record.id)
          ]);

        if (!active) return;
        setHistory({
          movements,
          weighings,
          healthRecords,
          reproductionRecords,
          genealogy
        });
      } catch (err) {
        if (!active) return;
        setErrorMsg(
          err instanceof Error ? err.message : 'Error al cargar el expediente del animal.'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [id, getById]);

  const ranchName = useMemo(() => {
    if (!animal?.idRancho) return 'Sin rancho asignado';
    return ranches.find((r) => r.id === animal.idRancho)?.nombre || animal.idRancho;
  }, [animal, ranches]);

  const lotName = useMemo(() => {
    if (!animal?.idLote) return 'Sin potrero / lote asignado';
    return lots.find((l) => l.id === animal.idLote)?.nombre || animal.idLote;
  }, [animal, lots]);

  const handleDeactivate = async () => {
    if (!animal || isDeactivating) return;
    setIsDeactivating(true);
    try {
      const result = await deactivate(animal.id);
      navigate('/cattle', {
        replace: true,
        state: {
          feedback: result.synced
            ? `Animal ${animal.arete} desactivado y sincronizado.`
            : result.syncMessage ||
              `Animal ${animal.arete} desactivado localmente. Pendiente de sincronización.`
        }
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo desactivar el animal.');
      setConfirmDeactivate(false);
    } finally {
      setIsDeactivating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-brand-slate/60 flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin text-brand-primary" />
        <span className="text-[14px]">Cargando expediente del animal…</span>
      </div>
    );
  }

  if (errorMsg && !animal) {
    return (
      <div role="alert" className="p-8 text-center text-status-error space-y-3">
        <AlertCircle size={28} className="mx-auto" />
        <p className="font-bold">{errorMsg}</p>
        <button
          type="button"
          onClick={() => navigate('/cattle')}
          className="min-h-[42px] px-4 rounded-md bg-brand-primary text-white text-[13px] font-semibold"
        >
          Volver al inventario
        </button>
      </div>
    );
  }

  if (!animal) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-status-error font-bold text-[16px]">Animal no encontrado.</p>
        <button
          type="button"
          onClick={() => navigate('/cattle')}
          className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-md bg-brand-primary text-white text-[13px] font-semibold"
        >
          <ArrowLeft size={16} /> Volver al inventario
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/cattle')}
            aria-label="Volver al inventario"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-surface-white border border-border-light rounded-md text-brand-slate/70 hover:text-brand-primary transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
              Expediente Individual
            </span>
            <h1 className="text-2xl sm:text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-0.5 flex flex-wrap items-center gap-2.5">
              <span>{animal.arete}</span>
              <span className="text-[12px] font-sans font-semibold px-2.5 py-0.5 rounded-full bg-surface-secondary text-brand-slate">
                {animal.deletedAt ? 'Desactivado' : animal.estado}
              </span>
              {animal.syncStatus === 'synced' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full bg-status-success/10 text-status-success">
                  <Cloud size={12} /> Sincronizado
                </span>
              ) : animal.syncStatus === 'conflict' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700">
                  <AlertOctagon size={12} /> Conflicto
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full bg-status-warning/15 text-amber-800">
                  <CloudUpload size={12} /> Pendiente sync
                </span>
              )}
            </h1>
          </div>
        </div>

        {!animal.deletedAt && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/cattle/${animal.id}/edit`)}
              className="min-h-[42px] flex items-center gap-2 bg-surface-white border border-border-light text-brand-slate hover:border-brand-primary hover:text-brand-primary px-4 rounded-md font-semibold text-[13px] transition-colors shadow-sm cursor-pointer"
            >
              <Edit size={15} /> Editar
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeactivate(true)}
              className="min-h-[42px] flex items-center gap-2 bg-surface-white border border-status-error/30 text-status-error hover:bg-status-error/10 px-4 rounded-md font-semibold text-[13px] transition-colors cursor-pointer"
            >
              <Archive size={15} /> Desactivar
            </button>
          </div>
        )}
      </header>

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

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-status-error/10 border border-status-error/30 text-status-error text-[13px] font-medium"
        >
          {errorMsg}
        </div>
      )}

      {confirmDeactivate && (
        <div
          role="alertdialog"
          className="p-4 rounded-xl bg-status-error/10 border border-status-error/30 space-y-3"
        >
          <p className="text-[13px] font-semibold text-status-error">
            ¿Deseas desactivar el expediente de {animal.arete}? El historial sanitario, biométrico y de movimientos se conservará.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isDeactivating}
              onClick={() => void handleDeactivate()}
              className="min-h-[40px] px-4 rounded-md bg-status-error text-white text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {isDeactivating && <Loader2 size={14} className="animate-spin" />}
              Confirmar desactivación
            </button>
            <button
              type="button"
              disabled={isDeactivating}
              onClick={() => setConfirmDeactivate(false)}
              className="min-h-[40px] px-4 rounded-md border border-border-light bg-surface-white text-[13px] font-semibold text-brand-slate"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Ficha Completa del Contrato Animal */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
            <div className="h-2 bg-brand-primary w-full" />
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2.5 text-brand-slate border-b border-border-light pb-3">
                <Info size={18} className="text-brand-primary" />
                <h2 className="font-bold text-[16px]">Ficha de Identificación</h2>
              </div>

              <dl className="grid grid-cols-2 gap-4 text-[14px]">
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Arete
                  </dt>
                  <dd className="font-semibold text-brand-slate mt-0.5">{animal.arete}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Sexo
                  </dt>
                  <dd className="font-semibold text-brand-slate mt-0.5">{animal.sexo}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Raza
                  </dt>
                  <dd className="font-semibold text-brand-slate mt-0.5">{animal.raza}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Edad estimada
                  </dt>
                  <dd className="font-medium text-brand-slate mt-0.5">
                    {calculateAnimalAge(animal.fechaNacimiento)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Nacimiento
                  </dt>
                  <dd className="font-medium text-brand-slate flex items-center gap-1.5 mt-0.5">
                    <Calendar size={13} className="text-brand-slate/45" />
                    {formatDateDisplay(animal.fechaNacimiento)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Fecha ingreso
                  </dt>
                  <dd className="font-medium text-brand-slate flex items-center gap-1.5 mt-0.5">
                    <Calendar size={13} className="text-brand-slate/45" />
                    {formatDateDisplay(animal.fechaIngreso)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Procedencia
                  </dt>
                  <dd className="font-medium text-brand-slate mt-0.5">{animal.procedencia}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Rancho
                  </dt>
                  <dd className="font-medium text-brand-slate flex items-center gap-1.5 mt-0.5 break-all">
                    <MapPin size={13} className="text-brand-primary shrink-0" />
                    <span>{ranchName}</span>
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                    Potrero / Lote
                  </dt>
                  <dd className="font-medium text-brand-slate mt-0.5">{lotName}</dd>
                </div>
                {animal.fechaSalida && (
                  <div className="col-span-2">
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                      Fecha de salida
                    </dt>
                    <dd className="font-medium text-status-error mt-0.5">
                      {formatDateDisplay(animal.fechaSalida)}
                    </dd>
                  </div>
                )}
                {animal.observaciones && (
                  <div className="col-span-2">
                    <dt className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
                      Observaciones
                    </dt>
                    <dd className="text-[13px] text-brand-slate/85 mt-0.5 whitespace-pre-line">
                      {animal.observaciones}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="pt-3 border-t border-border-light text-[11px] text-brand-slate/55 space-y-0.5">
                <p className="font-mono truncate" title={animal.idAnimal}>
                  UUID: {animal.idAnimal}
                </p>
                <p>Versión de registro: v{animal.versionRegistro}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Historiales reales consultados desde IndexedDB */}
        <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Movimientos */}
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[240px]">
            <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
              <h3 className="font-bold text-[14px] text-brand-slate flex items-center gap-2">
                <Activity size={16} className="text-brand-primary" /> Movimientos y Trazabilidad
              </h3>
              <span className="text-[11px] font-bold text-brand-slate/55">
                {history.movements.length}
              </span>
            </div>
            <div className="flex-1 p-4">
              {history.movements.length === 0 ? (
                <EmptyState
                  title="Sin movimientos locales"
                  message="Los traslados de potrero y cambios registrados para este animal aparecerán aquí."
                  icon={Activity}
                />
              ) : (
                <ul className="divide-y divide-border-light text-[13px]">
                  {history.movements.slice(0, 5).map((mov) => (
                    <li key={mov.id} className="py-2 flex items-center justify-between gap-2">
                      <span className="font-medium text-brand-slate truncate">{mov.motivo}</span>
                      <span className="text-[11px] text-brand-slate/60 shrink-0">
                        {formatDateDisplay(mov.fecha)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Pesajes */}
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[240px]">
            <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
              <h3 className="font-bold text-[14px] text-brand-slate flex items-center gap-2">
                <Scale size={16} className="text-brand-primary" /> Historial de Pesajes
              </h3>
              <span className="text-[11px] font-bold text-brand-slate/55">
                {history.weighings.length}
              </span>
            </div>
            <div className="flex-1 p-4">
              {history.weighings.length === 0 ? (
                <EmptyState
                  title="Sin pesajes"
                  message="No hay pesajes registrados para este animal."
                  icon={Scale}
                />
              ) : (
                <ul className="divide-y divide-border-light text-[13px]">
                  {history.weighings.slice(0, 5).map((w) => (
                    <li key={w.id} className="py-2 flex items-center justify-between gap-2">
                      <span className="font-bold text-brand-forest">{w.peso} kg</span>
                      <span className="text-[11px] text-brand-slate/60">
                        {formatDateDisplay(w.fecha)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Salud */}
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[240px]">
            <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
              <h3 className="font-bold text-[14px] text-brand-slate flex items-center gap-2">
                <Syringe size={16} className="text-status-info" /> Salud y Tratamientos
              </h3>
              <span className="text-[11px] font-bold text-brand-slate/55">
                {history.healthRecords.length}
              </span>
            </div>
            <div className="flex-1 p-4">
              {history.healthRecords.length === 0 ? (
                <EmptyState
                  title="Sin eventos sanitarios"
                  message="No se han registrado eventos sanitarios o tratamientos para este animal."
                  icon={Syringe}
                />
              ) : (
                <ul className="divide-y divide-border-light text-[13px]">
                  {history.healthRecords.slice(0, 5).map((h) => (
                    <li key={h.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-brand-slate truncate">{h.tipo}</p>
                        <p className="text-[11px] text-brand-slate/65 truncate">{h.descripcion}</p>
                      </div>
                      <span className="text-[11px] text-brand-slate/60 shrink-0">
                        {formatDateDisplay(h.fecha)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Reproducción & Genealogía */}
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[240px]">
            <div className="px-5 py-3.5 border-b border-border-light bg-surface-app/30 flex items-center justify-between">
              <h3 className="font-bold text-[14px] text-brand-slate flex items-center gap-2">
                <HeartPulse size={16} className="text-pink-600" /> Reproducción y Genealogía
              </h3>
              <Dna size={15} className="text-brand-yellow" />
            </div>
            <div className="flex-1 p-4 space-y-3">
              {history.genealogy && (history.genealogy.padreId || history.genealogy.madreId) && (
                <div className="p-2.5 rounded-lg bg-surface-secondary/50 border border-border-light text-[12px] space-y-1">
                  <p className="font-bold text-brand-slate">Parentesco registrado</p>
                  {history.genealogy.padreId && <p>Padre: {history.genealogy.padreId}</p>}
                  {history.genealogy.madreId && <p>Madre: {history.genealogy.madreId}</p>}
                </div>
              )}

              {history.reproductionRecords.length === 0 ? (
                <EmptyState
                  title="Sin eventos reproductivos"
                  message="No existen eventos reproductivos registrados para este animal."
                  icon={HeartPulse}
                />
              ) : (
                <ul className="divide-y divide-border-light text-[13px]">
                  {history.reproductionRecords.slice(0, 5).map((r) => (
                    <li key={r.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-medium text-brand-slate">{r.evento}</span>
                        {r.resultado && (
                          <span className="ml-2 text-[11px] text-brand-slate/70">
                            · {r.resultado}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-brand-slate/60 shrink-0">
                        {formatDateDisplay(r.fecha)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
