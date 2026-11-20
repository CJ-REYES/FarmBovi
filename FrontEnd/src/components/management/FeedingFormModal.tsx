import { useState, useRef, useMemo, type FormEvent } from 'react';
import { AlertCircle, Info, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { Cattle, LotOption } from '../../types/cattle';
import type { FeedingInput, FeedingRecord, FeedingTargetType } from '../../types/feeding';
import {
  FEEDING_FIELD_LIMITS,
  validateFeedingInput,
  type FeedingValidationErrors
} from '../../services/feeding.validation';
import {
  FeedingValidationError,
  type FeedingMutationResult
} from '../../services/feeding.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface FeedingFormModalProps {
  mode: 'create' | 'edit';
  initialRecord?: FeedingRecord;
  animals: Cattle[];
  lots: LotOption[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: FeedingInput) => Promise<FeedingMutationResult>;
}

const COMMON_UNITS = ['kg', 'g', 'L', 'mL', 'lb', 'pacas', 'ton'] as const;

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nowDatetimeLocal(): string {
  return toDatetimeLocalValue(new Date().toISOString());
}

export default function FeedingFormModal({
  mode,
  initialRecord,
  animals,
  lots,
  isOnline,
  onClose,
  onSubmit
}: FeedingFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialRecord);
  const submitLockRef = useRef<boolean>(false);

  const [targetType, setTargetType] = useState<FeedingTargetType>(() =>
    initialRecord ? initialRecord.targetType : lots.length > 0 ? 'lote' : 'animal'
  );

  const [formData, setFormData] = useState<FeedingInput>(() => {
    if (initialRecord) {
      return {
        idAnimal: initialRecord.idAnimal,
        idLote: initialRecord.idLote,
        alimento: initialRecord.alimento,
        racion: initialRecord.racion,
        cantidad: String(initialRecord.cantidad),
        unidad: initialRecord.unidad,
        frecuencia: initialRecord.frecuencia,
        inicio: toDatetimeLocalValue(initialRecord.inicio),
        fin: toDatetimeLocalValue(initialRecord.fin) || null,
        cambioDieta: initialRecord.cambioDieta
      };
    }

    return {
      idAnimal: null,
      idLote: null,
      alimento: '',
      racion: '',
      cantidad: '',
      unidad: 'kg',
      frecuencia: '',
      inicio: nowDatetimeLocal(),
      fin: null,
      cambioDieta: null
    };
  });

  const [fieldErrors, setFieldErrors] = useState<FeedingValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const animalOptions = useMemo(
    () =>
      animals.map((animal) => ({
        id: animal.id,
        arete: animal.arete,
        raza: animal.raza,
        extraLabel: `(${animal.estado})`
      })),
    [animals]
  );

  const clearFieldError = (field: keyof FeedingValidationErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleTargetTypeChange = (nextType: FeedingTargetType) => {
    setTargetType(nextType);
    setFormData((prev) => ({
      ...prev,
      idLote: nextType === 'lote' ? prev.idLote : null,
      idAnimal: nextType === 'animal' ? prev.idAnimal : null
    }));
    clearFieldError('target');
    clearFieldError('idLote');
    clearFieldError('idAnimal');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setFormError(null);

    const payloadToValidate: FeedingInput = {
      ...formData,
      idLote: targetType === 'lote' ? formData.idLote : null,
      idAnimal: targetType === 'animal' ? formData.idAnimal : null
    };

    const validationErrors = validateFeedingInput(payloadToValidate, { animals, lots });
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el registro de alimentación.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(payloadToValidate);
      onClose();
    } catch (err) {
      if (err instanceof FeedingValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar la alimentación.');
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
      aria-labelledby="feeding-form-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              {isEditMode ? 'Edición de Alimentación' : 'Nuevo Evento de Alimentación'}
            </span>
            <h2 id="feeding-form-modal-title" className="text-[18px] font-bold text-brand-forest">
              {isEditMode ? 'Actualizar Registro de Alimentación' : 'Registrar Alimentación'}
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
                Modo sin conexión: el registro se guardará localmente en IndexedDB y se sincronizará al reconectar.
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

          {/* Selección excluyente: Potrero / Lote O Animal individual (Regla 05 Backend) */}
          <fieldset className="space-y-3 p-3.5 rounded-lg bg-surface-app/70 border border-border-light">
            <legend className="text-[12px] font-bold text-brand-slate uppercase tracking-wider px-1">
              Destino de la alimentación <span className="text-status-error">*</span>
            </legend>

            <div className="grid grid-cols-2 gap-2">
              <label
                className={`min-h-[42px] px-3 rounded-md border flex items-center justify-center gap-2 text-[13px] font-semibold cursor-pointer transition-colors ${
                  targetType === 'lote'
                    ? 'bg-brand-primary text-white border-brand-primary'
                    : 'bg-surface-white text-brand-slate border-border-light hover:border-brand-primary'
                }`}
              >
                <input
                  type="radio"
                  name="feedingTargetType"
                  value="lote"
                  checked={targetType === 'lote'}
                  onChange={() => handleTargetTypeChange('lote')}
                  className="sr-only"
                />
                <span>Por Potrero / Lote</span>
              </label>

              <label
                className={`min-h-[42px] px-3 rounded-md border flex items-center justify-center gap-2 text-[13px] font-semibold cursor-pointer transition-colors ${
                  targetType === 'animal'
                    ? 'bg-brand-primary text-white border-brand-primary'
                    : 'bg-surface-white text-brand-slate border-border-light hover:border-brand-primary'
                }`}
              >
                <input
                  type="radio"
                  name="feedingTargetType"
                  value="animal"
                  checked={targetType === 'animal'}
                  onChange={() => handleTargetTypeChange('animal')}
                  className="sr-only"
                />
                <span>Animal Individual</span>
              </label>
            </div>

            {targetType === 'lote' ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="feeding-lote"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Potrero / Lote <span className="text-status-error">*</span>
                </label>
                <select
                  id="feeding-lote"
                  name="idLote"
                  required
                  value={formData.idLote ?? ''}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      idLote: e.target.value || null,
                      idAnimal: null
                    }));
                    clearFieldError('target');
                    clearFieldError('idLote');
                  }}
                  aria-invalid={Boolean(fieldErrors.target || fieldErrors.idLote)}
                  className="w-full min-h-[44px] px-3 bg-surface-white border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                >
                  <option value="">Selecciona un potrero / lote</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.nombre}
                      {lot.ubicacion ? ` — ${lot.ubicacion}` : ''}
                    </option>
                  ))}
                </select>
                {(fieldErrors.idLote || fieldErrors.target) && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.idLote || fieldErrors.target}
                  </p>
                )}
              </div>
            ) : (
              <AnimalSelectField
                id="feeding-animal"
                name="idAnimal"
                label="Animal"
                required
                value={formData.idAnimal ?? ''}
                options={animalOptions}
                placeholder="Selecciona un animal"
                error={fieldErrors.idAnimal || fieldErrors.target}
                selectClassName="w-full min-h-[44px] px-3 bg-surface-white border border-border-light rounded-md text-[14px] text-left flex items-center justify-between gap-2 outline-none focus:border-brand-primary cursor-pointer"
                onChange={(animalId) => {
                  setFormData((prev) => ({
                    ...prev,
                    idAnimal: animalId || null,
                    idLote: null
                  }));
                  clearFieldError('target');
                  clearFieldError('idAnimal');
                }}
              />
            )}

            <p className="text-[11px] text-brand-slate/60 flex items-start gap-1">
              <Info size={13} className="shrink-0 mt-0.5 text-brand-primary" />
              <span>
                Cada evento aplica exclusivamente a un potrero/lote o a un animal individual (regla de integridad del servidor).
              </span>
            </p>
          </fieldset>

          {/* Alimento y Ración */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="feeding-alimento"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Alimento <span className="text-status-error">*</span>
              </label>
              <input
                id="feeding-alimento"
                type="text"
                name="alimento"
                required
                maxLength={FEEDING_FIELD_LIMITS.alimentoMax}
                value={formData.alimento}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, alimento: e.target.value }));
                  clearFieldError('alimento');
                }}
                placeholder="Ej. Silo de maíz, Concentrado proteico 18%"
                aria-invalid={Boolean(fieldErrors.alimento)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.alimento && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.alimento}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="feeding-racion"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Ración <span className="text-status-error">*</span>
              </label>
              <input
                id="feeding-racion"
                type="text"
                name="racion"
                required
                maxLength={FEEDING_FIELD_LIMITS.racionMax}
                value={formData.racion}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, racion: e.target.value }));
                  clearFieldError('racion');
                }}
                placeholder="Ej. Ración de engorda fase 2"
                aria-invalid={Boolean(fieldErrors.racion)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.racion && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.racion}
                </p>
              )}
            </div>
          </div>

          {/* Cantidad, Unidad y Frecuencia */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="feeding-cantidad"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Cantidad <span className="text-status-error">*</span>
              </label>
              <input
                id="feeding-cantidad"
                type="number"
                name="cantidad"
                required
                min="0.001"
                step="0.001"
                value={formData.cantidad}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, cantidad: e.target.value }));
                  clearFieldError('cantidad');
                }}
                placeholder="Ej. 12.5"
                aria-invalid={Boolean(fieldErrors.cantidad)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.cantidad && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.cantidad}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="feeding-unidad"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Unidad <span className="text-status-error">*</span>
              </label>
              <input
                id="feeding-unidad"
                type="text"
                name="unidad"
                list="feeding-units-list"
                required
                maxLength={FEEDING_FIELD_LIMITS.unidadMax}
                value={formData.unidad}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, unidad: e.target.value }));
                  clearFieldError('unidad');
                }}
                placeholder="Ej. kg, g, L, pacas"
                aria-invalid={Boolean(fieldErrors.unidad)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              <datalist id="feeding-units-list">
                {COMMON_UNITS.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
              {fieldErrors.unidad && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.unidad}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="feeding-frecuencia"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Frecuencia <span className="text-status-error">*</span>
              </label>
              <input
                id="feeding-frecuencia"
                type="text"
                name="frecuencia"
                required
                maxLength={FEEDING_FIELD_LIMITS.frecuenciaMax}
                value={formData.frecuencia}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, frecuencia: e.target.value }));
                  clearFieldError('frecuencia');
                }}
                placeholder="Ej. 2 veces al día"
                aria-invalid={Boolean(fieldErrors.frecuencia)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.frecuencia && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.frecuencia}
                </p>
              )}
            </div>
          </div>

          {/* Fechas Inicio y Fin */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="feeding-inicio"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fecha y Hora de Inicio <span className="text-status-error">*</span>
              </label>
              <input
                id="feeding-inicio"
                type="datetime-local"
                name="inicio"
                required
                value={formData.inicio}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, inicio: e.target.value }));
                  clearFieldError('inicio');
                  clearFieldError('fin');
                }}
                aria-invalid={Boolean(fieldErrors.inicio)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.inicio && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.inicio}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="feeding-fin"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fecha y Hora de Fin (Opcional)
              </label>
              <input
                id="feeding-fin"
                type="datetime-local"
                name="fin"
                value={formData.fin ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fin: e.target.value || null }));
                  clearFieldError('fin');
                }}
                aria-invalid={Boolean(fieldErrors.fin)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.fin && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.fin}
                </p>
              )}
            </div>
          </div>

          {/* Cambio de dieta / Observaciones */}
          <div className="space-y-1.5">
            <label
              htmlFor="feeding-cambio-dieta"
              className="block text-[13px] font-semibold text-brand-slate"
            >
              Cambio de Dieta / Observaciones (Opcional)
            </label>
            <textarea
              id="feeding-cambio-dieta"
              name="cambioDieta"
              rows={3}
              maxLength={FEEDING_FIELD_LIMITS.cambioDietaMax}
              value={formData.cambioDieta ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, cambioDieta: e.target.value || null }));
                clearFieldError('cambioDieta');
              }}
              placeholder="Ej. Transición gradual a dieta de finalización con sales minerales…"
              aria-invalid={Boolean(fieldErrors.cambioDieta)}
              className="w-full px-3 py-2.5 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary resize-y"
            />
            {fieldErrors.cambioDieta && (
              <p role="alert" className="text-[12px] text-status-error font-medium">
                {fieldErrors.cambioDieta}
              </p>
            )}
          </div>

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
                  : 'Registrar Alimentación'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
