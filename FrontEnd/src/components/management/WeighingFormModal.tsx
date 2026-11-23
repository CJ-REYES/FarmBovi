import { useState, useEffect, useRef, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Camera, Info, Loader2, Save, Scale, WifiOff, X } from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import type { Weighing, WeighingInput } from '../../types/weighing';
import {
  WEIGHING_FIELD_LIMITS,
  validateWeighingInput,
  type WeighingValidationErrors
} from '../../services/weighing.validation';
import {
  WeighingService,
  WeighingValidationError,
  type BoviScaleReference,
  type WeighingMutationResult
} from '../../services/weighing.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface WeighingFormModalProps {
  mode: 'create' | 'edit';
  initialWeighing?: Weighing;
  preselectedAnimalId?: string;
  animals: Cattle[];
  lastWeightByAnimal?: Map<string, number>;
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: WeighingInput) => Promise<WeighingMutationResult>;
}

function toDatetimeLocalValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) {
    return toDatetimeLocalValue();
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function WeighingFormModal({
  mode,
  initialWeighing,
  preselectedAnimalId,
  animals,
  lastWeightByAnimal,
  isOnline,
  onClose,
  onSubmit
}: WeighingFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialWeighing);
  const navigate = useNavigate();
  const submitLockRef = useRef<boolean>(false);
  const userEditedWeightRef = useRef<boolean>(isEditMode);

  const [formData, setFormData] = useState<WeighingInput>(() => {
    if (initialWeighing) {
      return {
        idAnimal: initialWeighing.idAnimal,
        pesoRealKg: String(initialWeighing.pesoRealKg),
        fecha: toDatetimeLocalValue(initialWeighing.fecha),
        fuenteBascula: initialWeighing.fuenteBascula,
        responsable: initialWeighing.responsable,
        observaciones: initialWeighing.observaciones
      };
    }

    const defaultAnimal = preselectedAnimalId
      ? animals.find((a) => a.id === preselectedAnimalId && !a.deletedAt)
      : undefined;

    return {
      idAnimal: defaultAnimal?.id || '',
      pesoRealKg: '',
      fecha: toDatetimeLocalValue(),
      fuenteBascula: '',
      responsable: '',
      observaciones: null
    };
  });

  const [fieldErrors, setFieldErrors] = useState<WeighingValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [boviScaleState, setBoviScaleState] = useState<{
    animalId: string;
    ref: BoviScaleReference;
  } | null>(null);

  useEffect(() => {
    const animalId = formData.idAnimal;
    if (!animalId) return;

    let cancelled = false;
    void WeighingService.getLatestBoviScaleReference(animalId)
      .then((ref) => {
        if (cancelled) return;
        setBoviScaleState({ animalId, ref });
        // En creación, si BoviScale ya tiene pesaje registrado y el usuario aún no capturó un peso manual,
        // precargar automáticamente el dato de BoviScale para agilizar la captura / comparación.
        if (!isEditMode && ref.hasWeight && ref.pesoKg !== null && !userEditedWeightRef.current) {
          setFormData((prev) => ({
            ...prev,
            pesoRealKg: String(ref.pesoKg)
          }));
        }
      })
      .catch(() => {
        // Ignorar errores de lectura de referencia BoviScale
      });

    return () => {
      cancelled = true;
    };
  }, [formData.idAnimal, isEditMode]);

  const boviScaleRef =
    formData.idAnimal && boviScaleState?.animalId === formData.idAnimal
      ? boviScaleState.ref
      : null;

  const handleGoToBoviScale = () => {
    const query = formData.idAnimal
      ? `?animal=${encodeURIComponent(formData.idAnimal)}&tipo=BoviScaleVision`
      : '?tipo=BoviScaleVision';
    onClose();
    navigate(`/boviscale${query}`);
  };

  const handleApplyBoviScaleWeight = () => {
    if (!boviScaleRef?.hasWeight || boviScaleRef.pesoKg === null) return;
    userEditedWeightRef.current = true;
    setFormData((prev) => ({
      ...prev,
      pesoRealKg: String(boviScaleRef.pesoKg)
    }));
    clearFieldError('pesoRealKg');
  };

  const boviScaleDiff = useMemo(() => {
    if (!boviScaleRef?.hasWeight || boviScaleRef.pesoKg === null) return null;
    const currentKg = Number(formData.pesoRealKg);
    if (!Number.isFinite(currentKg) || currentKg <= 0) return null;
    const diffKg = Math.round((currentKg - boviScaleRef.pesoKg) * 10) / 10;
    const diffPct = Math.round((diffKg / boviScaleRef.pesoKg) * 1000) / 10;
    return { diffKg, diffPct };
  }, [boviScaleRef, formData.pesoRealKg]);

  const animalOptions = useMemo(
    () =>
      animals.map((animal) => {
        const lastKg = lastWeightByAnimal?.get(animal.id);
        return {
          id: animal.id,
          arete: animal.arete,
          raza: animal.raza,
          extraLabel: lastKg !== undefined ? `(Último: ${lastKg.toFixed(1)} kg)` : undefined
        };
      }),
    [animals, lastWeightByAnimal]
  );

  const clearFieldError = (field: keyof WeighingValidationErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setFormError(null);
    const validationErrors = validateWeighingInput(formData, { animals });
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el pesaje.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(formData);
      onClose();
    } catch (err) {
      if (err instanceof WeighingValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el pesaje.');
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weighing-form-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              {isEditMode ? 'Edición de Pesaje Oficial' : 'Nuevo Pesaje de Báscula'}
            </span>
            <h2 id="weighing-form-modal-title" className="text-[18px] font-bold text-brand-forest">
              {isEditMode ? 'Actualizar Pesaje' : 'Registrar Pesaje Oficial'}
            </h2>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Cerrar formulario"
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-md text-brand-slate/60 hover:bg-surface-secondary hover:text-brand-slate"
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
                Modo sin conexión: el pesaje se almacenará en IndexedDB y quedará encolado para sincronización posterior.
              </span>
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

          {/* Animal con buscador por arete */}
          <AnimalSelectField
            id="weighing-animal"
            name="idAnimal"
            label="Animal"
            required
            disabled={isEditMode}
            value={formData.idAnimal}
            options={animalOptions}
            placeholder="Selecciona un animal"
            helperText={
              isEditMode
                ? 'El animal asociado no se modifica al editar un pesaje.'
                : undefined
            }
            error={fieldErrors.idAnimal}
            onChange={(animalId) => {
              userEditedWeightRef.current = false;
              setFormData((prev) => ({ ...prev, idAnimal: animalId }));
              clearFieldError('idAnimal');
            }}
          />

          {/* Comparativa BoviScale vs Báscula o acceso directo a BoviScale */}
          {formData.idAnimal && boviScaleRef && (
            boviScaleRef.hasWeight && boviScaleRef.pesoKg !== null ? (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-brand-primary/8 border border-brand-primary/25 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[13px] font-bold text-brand-forest">
                    <Scale size={16} className="text-brand-primary shrink-0" />
                    <span>
                      BoviScale vs Báscula: {boviScaleRef.pesoKg.toFixed(1)} kg
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleApplyBoviScaleWeight}
                      className="px-2.5 py-1 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      Usar peso BoviScale
                    </button>
                    <button
                      type="button"
                      onClick={handleGoToBoviScale}
                      className="px-2.5 py-1 rounded-md border border-brand-primary/35 bg-surface-white hover:bg-brand-primary/10 text-brand-forest text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Camera size={12} /> Ir a BoviScale
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-brand-slate/75">
                  {boviScaleRef.sourceLabel}
                  {boviScaleRef.fecha
                    ? ` · ${new Date(boviScaleRef.fecha).toLocaleDateString('es-MX')}`
                    : ''}
                  {boviScaleRef.confianzaModelo !== null
                    ? ` · Confianza: ${Math.round(boviScaleRef.confianzaModelo * 100)}%`
                    : ''}
                  {boviScaleDiff && (
                    <span className="ml-1.5 font-semibold text-brand-forest">
                      · Diferencia báscula vs BoviScale:{' '}
                      {boviScaleDiff.diffKg > 0 ? `+${boviScaleDiff.diffKg}` : boviScaleDiff.diffKg} kg (
                      {boviScaleDiff.diffPct > 0 ? `+${boviScaleDiff.diffPct}` : boviScaleDiff.diffPct}%)
                    </span>
                  )}
                </p>
              </div>
            ) : (
              <div
                role="status"
                className="p-3.5 rounded-lg bg-surface-secondary/70 border border-border-light flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5 text-[12px] text-brand-slate">
                  <p className="font-semibold text-brand-forest flex items-center gap-1.5">
                    <Camera size={14} className="text-brand-primary shrink-0" />
                    Sin pesaje registrado en BoviScale
                  </p>
                  <p className="text-[11px] text-brand-slate/70">
                    {boviScaleRef.hasPhotoWithoutWeight
                      ? `Este bovino tiene ${boviScaleRef.photoCount} foto(s) en BoviScale, pero aún sin estimación de peso registrada.`
                      : 'Este bovino aún no cuenta con un pesaje registrado en BoviScale.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGoToBoviScale}
                  className="shrink-0 min-h-[38px] px-3.5 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Camera size={14} /> Pesar en BoviScale
                </button>
              </div>
            )
          )}

          {/* Peso + Fecha */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="weighing-peso"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Peso Real de Báscula (kg) <span className="text-status-error">*</span>
              </label>
              <input
                id="weighing-peso"
                type="number"
                name="pesoRealKg"
                required
                min="0.001"
                max={WEIGHING_FIELD_LIMITS.pesoMaxKg}
                step="0.1"
                value={formData.pesoRealKg}
                onChange={(e) => {
                  userEditedWeightRef.current = true;
                  setFormData((prev) => ({ ...prev, pesoRealKg: e.target.value }));
                  clearFieldError('pesoRealKg');
                }}
                placeholder="Ej. 428.5"
                aria-invalid={Boolean(fieldErrors.pesoRealKg)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.pesoRealKg && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.pesoRealKg}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="weighing-fecha"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fecha y Hora del Pesaje <span className="text-status-error">*</span>
              </label>
              <input
                id="weighing-fecha"
                type="datetime-local"
                name="fecha"
                required
                value={formData.fecha}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fecha: e.target.value }));
                  clearFieldError('fecha');
                }}
                aria-invalid={Boolean(fieldErrors.fecha)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.fecha && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.fecha}
                </p>
              )}
            </div>
          </div>

          {/* Fuente báscula y Responsable (campos NOT NULL del ER Pesaje) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="weighing-bascula"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fuente / Báscula <span className="text-status-error">*</span>
              </label>
              <input
                id="weighing-bascula"
                type="text"
                name="fuenteBascula"
                required
                maxLength={WEIGHING_FIELD_LIMITS.fuenteBasculaMax}
                value={formData.fuenteBascula}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fuenteBascula: e.target.value }));
                  clearFieldError('fuenteBascula');
                }}
                placeholder="Ej. Báscula digital corral principal"
                aria-invalid={Boolean(fieldErrors.fuenteBascula)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.fuenteBascula && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.fuenteBascula}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="weighing-responsable"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Responsable <span className="text-status-error">*</span>
              </label>
              <input
                id="weighing-responsable"
                type="text"
                name="responsable"
                required
                maxLength={WEIGHING_FIELD_LIMITS.responsableMax}
                value={formData.responsable}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, responsable: e.target.value }));
                  clearFieldError('responsable');
                }}
                placeholder="Ej. Carlos Reyes"
                aria-invalid={Boolean(fieldErrors.responsable)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.responsable && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.responsable}
                </p>
              )}
            </div>
          </div>

          {/* Observaciones */}
          <div className="space-y-1.5">
            <label
              htmlFor="weighing-observaciones"
              className="block text-[13px] font-semibold text-brand-slate"
            >
              Observaciones (Opcional)
            </label>
            <textarea
              id="weighing-observaciones"
              name="observaciones"
              rows={3}
              maxLength={WEIGHING_FIELD_LIMITS.observacionesMax}
              value={formData.observaciones ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, observaciones: e.target.value || null }));
                clearFieldError('observaciones');
              }}
              placeholder="Ej. Pesaje en ayuno previo a cambio de potrero…"
              aria-invalid={Boolean(fieldErrors.observaciones)}
              className="w-full px-3 py-2.5 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary resize-y"
            />
            {fieldErrors.observaciones && (
              <p role="alert" className="text-[12px] text-status-error font-medium">
                {fieldErrors.observaciones}
              </p>
            )}
          </div>

          <p className="text-[11px] text-brand-slate/60 flex items-start gap-1.5 bg-surface-app/70 border border-border-light rounded-lg p-2.5">
            <Info size={14} className="shrink-0 mt-0.5 text-brand-primary" />
            <span>
              Regla 14: los pesajes oficiales de báscula real son la fuente oficial de crecimiento y nunca se reemplazan automáticamente por estimaciones fotográficas.
            </span>
          </p>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-3 border-t border-border-light">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-md border border-border-light text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[44px] px-5 rounded-md bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isSubmitting
                ? 'Guardando…'
                : isEditMode
                  ? 'Guardar Cambios'
                  : 'Guardar Pesaje'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
