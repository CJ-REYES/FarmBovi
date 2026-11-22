import { useState, useMemo, useRef, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeftRight,
  Building2,
  Info,
  Layers,
  Loader2,
  WifiOff,
  X
} from 'lucide-react';
import type { Cattle, LotOption, RanchOption } from '../../types/cattle';
import type {
  LotTransferMode,
  TrasladoAnimalRanchoPayload,
  TrasladoLoteRanchoPayload,
  TrasladoRanchoResultDto
} from '../../types/movement';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface RanchTransferModalProps {
  animals: Cattle[];
  lots: LotOption[];
  ranches: RanchOption[];
  isOnline: boolean;
  onClose: () => void;
  onTransferAnimal: (payload: TrasladoAnimalRanchoPayload) => Promise<TrasladoRanchoResultDto>;
  onTransferLot: (payload: TrasladoLoteRanchoPayload) => Promise<TrasladoRanchoResultDto>;
}

function toDatetimeLocalNow(): string {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function RanchTransferModal({
  animals,
  lots,
  ranches,
  isOnline,
  onClose,
  onTransferAnimal,
  onTransferLot
}: RanchTransferModalProps) {
  const submitLockRef = useRef(false);
  const [targetType, setTargetType] = useState<'animal' | 'lot'>('animal');

  // Estado para traslado de animal
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>('');
  const [animalDestRanchId, setAnimalDestRanchId] = useState<string>('');
  const [animalDestLotId, setAnimalDestLotId] = useState<string>('');

  // Estado para traslado de lote
  const [selectedLotId, setSelectedLotId] = useState<string>('');
  const [lotMode, setLotMode] = useState<LotTransferMode>('MoverLoteCompleto');
  const [lotDestRanchId, setLotDestRanchId] = useState<string>('');
  const [lotDestLotId, setLotDestLotId] = useState<string>('');

  // Comunes
  const [fecha, setFecha] = useState<string>(() => toDatetimeLocalNow());
  const [motivo, setMotivo] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const ranchNameById = useMemo(
    () => new Map(ranches.map((r) => [r.id, r.nombre])),
    [ranches]
  );

  const lotNameById = useMemo(
    () => new Map(lots.map((l) => [l.id, l.nombre])),
    [lots]
  );

  const activeAnimals = useMemo(
    () =>
      animals.filter(
        (a) =>
          !a.deletedAt &&
          a.estado.toLowerCase() !== 'vendido' &&
          a.estado.toLowerCase() !== 'baja'
      ),
    [animals]
  );

  const activeAnimalsByLotId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const animal of activeAnimals) {
      if (animal.idLote) {
        counts.set(animal.idLote, (counts.get(animal.idLote) ?? 0) + 1);
      }
    }
    return counts;
  }, [activeAnimals]);

  const animalOptions = useMemo(
    () =>
      activeAnimals.map((animal) => {
        const ranchLabel = ranchNameById.get(animal.idRancho) || 'Rancho actual';
        const lotLabel = animal.idLote
          ? lotNameById.get(animal.idLote) || 'Potrero'
          : 'Sin potrero';
        return {
          id: animal.id,
          arete: animal.arete,
          raza: animal.raza,
          extraLabel: `(${ranchLabel} · ${lotLabel})`
        };
      }),
    [activeAnimals, ranchNameById, lotNameById]
  );

  const selectedAnimal = useMemo(
    () => activeAnimals.find((a) => a.id === selectedAnimalId),
    [activeAnimals, selectedAnimalId]
  );

  const selectedLot = useMemo(
    () => lots.find((l) => l.id === selectedLotId),
    [lots, selectedLotId]
  );

  const animalDestinationRanches = useMemo(() => {
    if (!selectedAnimal?.idRancho) return ranches;
    return ranches.filter((r) => r.id !== selectedAnimal.idRancho);
  }, [ranches, selectedAnimal]);

  const animalDestinationLots = useMemo(() => {
    if (!animalDestRanchId) return [];
    return lots.filter((l) => l.idRancho === animalDestRanchId);
  }, [lots, animalDestRanchId]);

  const lotDestinationRanches = useMemo(() => {
    if (!selectedLot?.idRancho) return ranches;
    return ranches.filter((r) => r.id !== selectedLot.idRancho);
  }, [ranches, selectedLot]);

  const lotDestinationLots = useMemo(() => {
    if (!lotDestRanchId) return [];
    return lots.filter((l) => l.idRancho === lotDestRanchId && l.id !== selectedLotId);
  }, [lots, lotDestRanchId, selectedLotId]);

  const handleSelectAnimal = (nextId: string) => {
    setSelectedAnimalId(nextId);
    const nextAnimal = activeAnimals.find((a) => a.id === nextId);
    if (nextAnimal && animalDestRanchId === nextAnimal.idRancho) {
      setAnimalDestRanchId('');
      setAnimalDestLotId('');
    }
    setFormError(null);
  };

  const handleSelectLot = (nextId: string) => {
    setSelectedLotId(nextId);
    const nextLot = lots.find((l) => l.id === nextId);
    if (nextLot && lotDestRanchId === nextLot.idRancho) {
      setLotDestRanchId('');
      setLotDestLotId('');
    }
    setFormError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setFormError(null);

    if (!isOnline) {
      setFormError(
        'El traslado entre ranchos requiere conexión a Internet para confirmar unicidad y permisos en el servidor.'
      );
      return;
    }

    if (targetType === 'animal') {
      if (!selectedAnimalId) {
        setFormError('Selecciona el bovino que deseas trasladar.');
        return;
      }
      if (!animalDestRanchId) {
        setFormError('Selecciona el rancho de destino.');
        return;
      }
      if (selectedAnimal?.idRancho === animalDestRanchId) {
        setFormError('El rancho de destino debe ser distinto al rancho actual del bovino.');
        return;
      }
    } else {
      if (!selectedLotId) {
        setFormError('Selecciona el lote o potrero que deseas trasladar.');
        return;
      }
      if (!lotDestRanchId) {
        setFormError('Selecciona el rancho de destino.');
        return;
      }
      if (selectedLot?.idRancho === lotDestRanchId) {
        setFormError('El rancho de destino debe ser distinto al rancho actual del lote.');
        return;
      }
      const lotAnimalCount = activeAnimalsByLotId.get(selectedLotId) ?? 0;
      if (lotMode === 'ReubicarAnimalesEnLoteDestino' && lotAnimalCount === 0) {
        setFormError('Este lote no tiene bovinos activos para reubicar en el rancho destino.');
        return;
      }
    }

    submitLockRef.current = true;
    setIsSubmitting(true);

    try {
      if (targetType === 'animal') {
        await onTransferAnimal({
          idAnimal: selectedAnimalId,
          idRanchoDestino: animalDestRanchId,
          idLoteDestino: animalDestLotId || null,
          fecha: fecha || undefined,
          motivo: motivo.trim() || null
        });
      } else {
        await onTransferLot({
          idLote: selectedLotId,
          idRanchoDestino: lotDestRanchId,
          modoLote: lotMode,
          idLoteDestino:
            lotMode === 'ReubicarAnimalesEnLoteDestino' ? lotDestLotId || null : null,
          fecha: fecha || undefined,
          motivo: motivo.trim() || null
        });
      }
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'No se pudo completar el traslado entre ranchos.'
      );
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const hasEnoughRanches = ranches.length >= 2;
  const selectedLotAnimalsCount = selectedLotId
    ? (activeAnimalsByLotId.get(selectedLotId) ?? 0)
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ranch-transfer-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              Trazabilidad entre Ranchos
            </span>
            <h2
              id="ranch-transfer-modal-title"
              className="text-[18px] font-bold text-brand-forest flex items-center gap-2"
            >
              <ArrowLeftRight size={18} className="text-brand-primary" />
              Trasladar Animal o Lote a Otro Rancho
            </h2>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Cerrar formulario de traslado entre ranchos"
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md text-brand-slate/60 hover:bg-surface-secondary hover:text-brand-slate cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-5 space-y-5">
          {!isOnline && (
            <div
              role="status"
              className="p-3 rounded-lg bg-status-warning/15 border border-status-warning/35 text-brand-dark text-[12px] flex items-start gap-2"
            >
              <WifiOff size={15} className="text-status-warning shrink-0 mt-0.5" />
              <span>
                Sin conexión: el traslado entre ranchos requiere conexión al servidor para validar permisos y evitar aretes o lotes duplicados en el rancho destino.
              </span>
            </div>
          )}

          {!hasEnoughRanches && (
            <div
              role="status"
              className="p-3.5 rounded-lg bg-brand-primary/10 border border-brand-primary/25 text-brand-slate text-[13px] flex items-start gap-2.5"
            >
              <Building2 size={16} className="text-brand-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-brand-forest">
                  Necesitas al menos 2 ranchos activos para trasladar entre ranchos.
                </p>
                <p className="text-[12px] text-brand-slate/75">
                  Actualmente tienes {ranches.length} rancho(s). Puedes registrar otro en{' '}
                  <Link
                    to="/ranches"
                    onClick={onClose}
                    className="font-semibold text-brand-primary underline"
                  >
                    Ranchos
                  </Link>
                  .
                </p>
              </div>
            </div>
          )}

          {formError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-[12px] font-semibold flex items-start gap-2"
            >
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Selector de objetivo: Bovino individual vs Lote / Potrero */}
          <div
            role="tablist"
            aria-label="Tipo de traslado entre ranchos"
            className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-surface-secondary border border-border-light"
          >
            <button
              type="button"
              role="tab"
              aria-selected={targetType === 'animal'}
              onClick={() => {
                setTargetType('animal');
                setFormError(null);
              }}
              className={`min-h-[40px] rounded-md text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                targetType === 'animal'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-brand-slate hover:bg-surface-white'
              }`}
            >
              <ArrowLeftRight size={15} />
              Trasladar Bovino
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={targetType === 'lot'}
              onClick={() => {
                setTargetType('lot');
                setFormError(null);
              }}
              className={`min-h-[40px] rounded-md text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                targetType === 'lot'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-brand-slate hover:bg-surface-white'
              }`}
            >
              <Layers size={15} />
              Trasladar Lote
            </button>
          </div>

          {targetType === 'animal' ? (
            <div className="space-y-4">
              <AnimalSelectField
                id="transfer-animal-select"
                name="idAnimal"
                label="Bovino a trasladar"
                required
                value={selectedAnimalId}
                options={animalOptions}
                placeholder="Busca por arete o raza…"
                onChange={handleSelectAnimal}
              />

              {selectedAnimal && (
                <div className="p-3 rounded-lg bg-surface-secondary/70 border border-border-light text-[12px] text-brand-slate flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    <strong>Rancho actual:</strong>{' '}
                    {ranchNameById.get(selectedAnimal.idRancho) || 'Rancho actual'}
                  </span>
                  <span>
                    <strong>Potrero actual:</strong>{' '}
                    {selectedAnimal.idLote
                      ? lotNameById.get(selectedAnimal.idLote) || 'Asignado'
                      : 'Sin potrero'}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="transfer-animal-dest-ranch"
                    className="block text-[13px] font-semibold text-brand-slate"
                  >
                    Rancho de Destino <span className="text-status-error">*</span>
                  </label>
                  <select
                    id="transfer-animal-dest-ranch"
                    value={animalDestRanchId}
                    onChange={(e) => {
                      setAnimalDestRanchId(e.target.value);
                      setAnimalDestLotId('');
                      setFormError(null);
                    }}
                    disabled={!hasEnoughRanches}
                    className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary disabled:opacity-60"
                  >
                    <option value="">Selecciona rancho de destino</option>
                    {animalDestinationRanches.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="transfer-animal-dest-lot"
                    className="block text-[13px] font-semibold text-brand-slate"
                  >
                    Potrero en Rancho Destino (opcional)
                  </label>
                  <select
                    id="transfer-animal-dest-lot"
                    value={animalDestLotId}
                    onChange={(e) => setAnimalDestLotId(e.target.value)}
                    disabled={!animalDestRanchId}
                    className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary disabled:opacity-60"
                  >
                    <option value="">Sin asignar potrero</option>
                    {animalDestinationLots.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nombre}
                        {l.ubicacion ? ` — ${l.ubicacion}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="transfer-lot-select"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Lote / Potrero de Origen <span className="text-status-error">*</span>
                </label>
                <select
                  id="transfer-lot-select"
                  value={selectedLotId}
                  onChange={(e) => handleSelectLot(e.target.value)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                >
                  <option value="">Selecciona un lote o potrero</option>
                  {lots.map((l) => {
                    const count = activeAnimalsByLotId.get(l.id) ?? 0;
                    const ranchName = ranchNameById.get(l.idRancho) || 'Rancho';
                    return (
                      <option key={l.id} value={l.id}>
                        {l.nombre} — {ranchName} ({count} bovino{count === 1 ? '' : 's'})
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedLot && (
                <div className="p-3 rounded-lg bg-surface-secondary/70 border border-border-light text-[12px] text-brand-slate flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    <strong>Rancho actual:</strong>{' '}
                    {ranchNameById.get(selectedLot.idRancho) || 'Rancho actual'}
                  </span>
                  <span>
                    <strong>Bovinos activos en el lote:</strong> {selectedLotAnimalsCount}
                  </span>
                </div>
              )}

              <div className="space-y-2">
                <span className="block text-[13px] font-semibold text-brand-slate">
                  ¿Cómo deseas realizar el traslado del lote?
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label
                    className={`p-3 rounded-lg border text-[12px] cursor-pointer transition-colors ${
                      lotMode === 'MoverLoteCompleto'
                        ? 'border-brand-primary bg-brand-primary/5 text-brand-forest'
                        : 'border-border-light bg-surface-app text-brand-slate'
                    }`}
                  >
                    <input
                      type="radio"
                      name="lotTransferMode"
                      value="MoverLoteCompleto"
                      checked={lotMode === 'MoverLoteCompleto'}
                      onChange={() => {
                        setLotMode('MoverLoteCompleto');
                        setLotDestLotId('');
                      }}
                      className="mr-2 accent-brand-primary"
                    />
                    <strong>Mover lote completo</strong>
                    <p className="text-[11px] text-brand-slate/70 mt-1">
                      Cambia el lote y todos sus bovinos activos al rancho destino manteniendo el mismo potrero.
                    </p>
                  </label>

                  <label
                    className={`p-3 rounded-lg border text-[12px] cursor-pointer transition-colors ${
                      lotMode === 'ReubicarAnimalesEnLoteDestino'
                        ? 'border-brand-primary bg-brand-primary/5 text-brand-forest'
                        : 'border-border-light bg-surface-app text-brand-slate'
                    }`}
                  >
                    <input
                      type="radio"
                      name="lotTransferMode"
                      value="ReubicarAnimalesEnLoteDestino"
                      checked={lotMode === 'ReubicarAnimalesEnLoteDestino'}
                      onChange={() => setLotMode('ReubicarAnimalesEnLoteDestino')}
                      className="mr-2 accent-brand-primary"
                    />
                    <strong>Reubicar solo animales</strong>
                    <p className="text-[11px] text-brand-slate/70 mt-1">
                      Mueve los bovinos del lote hacia un potrero del rancho destino y conserva el lote origen vacío.
                    </p>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="transfer-lot-dest-ranch"
                    className="block text-[13px] font-semibold text-brand-slate"
                  >
                    Rancho de Destino <span className="text-status-error">*</span>
                  </label>
                  <select
                    id="transfer-lot-dest-ranch"
                    value={lotDestRanchId}
                    onChange={(e) => {
                      setLotDestRanchId(e.target.value);
                      setLotDestLotId('');
                      setFormError(null);
                    }}
                    disabled={!hasEnoughRanches}
                    className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary disabled:opacity-60"
                  >
                    <option value="">Selecciona rancho de destino</option>
                    {lotDestinationRanches.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                {lotMode === 'ReubicarAnimalesEnLoteDestino' && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="transfer-lot-dest-lot"
                      className="block text-[13px] font-semibold text-brand-slate"
                    >
                      Potrero Destino en Rancho (opcional)
                    </label>
                    <select
                      id="transfer-lot-dest-lot"
                      value={lotDestLotId}
                      onChange={(e) => setLotDestLotId(e.target.value)}
                      disabled={!lotDestRanchId}
                      className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary disabled:opacity-60"
                    >
                      <option value="">Sin asignar potrero</option>
                      {lotDestinationLots.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nombre}
                          {l.ubicacion ? ` — ${l.ubicacion}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Fecha y Motivo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="transfer-ranch-fecha"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fecha y Hora del Traslado
              </label>
              <input
                id="transfer-ranch-fecha"
                type="datetime-local"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="transfer-ranch-motivo"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Motivo / Guía de Movilización (opcional)
              </label>
              <input
                id="transfer-ranch-motivo"
                type="text"
                maxLength={500}
                placeholder="Ej. Reacomodo de hato, guía REEMO, pastoreo estacional…"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-brand-primary/5 border border-brand-primary/20 text-[12px] text-brand-slate/80 flex items-start gap-2">
            <Info size={15} className="text-brand-primary shrink-0 mt-0.5" />
            <span>
              El traslado actualiza el rancho asignado de forma atómica en el servidor y registra automáticamente un movimiento de tipo <strong>Traslado</strong> en la línea de tiempo de trazabilidad.
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border-light">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-md border border-border-light bg-surface-white hover:bg-surface-secondary text-[13px] font-semibold text-brand-slate cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !hasEnoughRanches || !isOnline}
              className="min-h-[42px] px-5 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold inline-flex items-center gap-2 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Trasladando…
                </>
              ) : (
                <>
                  <ArrowLeftRight size={15} />
                  Confirmar Traslado
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
