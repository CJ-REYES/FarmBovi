import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import {
  REPRODUCTION_EVENT_SUGGESTED_TYPES,
  REPRODUCTION_RESULT_SUGGESTED,
  type ReproductionEvent,
  type ReproductionEventInput
} from '../../types/reproduction';
import {
  REPRODUCTION_FIELD_LIMITS,
  isFemaleAnimal,
  isMaleAnimal,
  validateReproductionInput,
  type ReproductionValidationErrors
} from '../../services/reproduction.validation';
import {
  ReproductionValidationError,
  type ReproductionMutationResult
} from '../../services/reproduction.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface ReproductionFormModalProps {
  mode: 'create' | 'edit';
  initialEvent?: ReproductionEvent;
  defaultTipo?: string;
  animals: Cattle[];
  existingEvents?: ReproductionEvent[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: ReproductionEventInput) => Promise<ReproductionMutationResult>;
}

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

export default function ReproductionFormModal({
  mode,
  initialEvent,
  defaultTipo,
  animals,
  existingEvents,
  isOnline,
  onClose,
  onSubmit
}: ReproductionFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialEvent);
  const submitLockRef = useRef<boolean>(false);

  const animalOptions = useMemo(
    () =>
      animals.map((animal) => ({
        id: animal.id,
        arete: animal.arete,
        raza: animal.raza,
        extraLabel: `(${animal.sexo} · ${animal.estado})`
      })),
    [animals]
  );

  const [formData, setFormData] = useState<ReproductionEventInput>(() => {
    if (initialEvent) {
      return {
        idAnimal: initialEvent.idAnimal,
        idSemental: initialEvent.idSemental ?? null,
        tipo: initialEvent.tipo,
        fecha: toDatetimeLocalValue(initialEvent.fecha),
        resultado: initialEvent.resultado,
        observaciones: initialEvent.observaciones
      };
    }

    return {
      idAnimal: '',
      idSemental: null,
      tipo: defaultTipo || '',
      fecha: nowDatetimeLocal(),
      resultado: null,
      observaciones: null
    };
  });

  const selectedAnimal = useMemo(
    () => animals.find((a) => a.id === formData.idAnimal),
    [animals, formData.idAnimal]
  );

  const sireOptions = useMemo(
    () =>
      animals
        .filter((animal) => {
          if (animal.deletedAt) return false;
          if (animal.id === formData.idAnimal) return false;
          if (selectedAnimal && animal.idRancho !== selectedAnimal.idRancho) return false;
          return !isFemaleAnimal(animal.sexo);
        })
        .map((bull) => ({
          id: bull.id,
          arete: bull.arete,
          raza: bull.raza,
          extraLabel: `(${bull.sexo} · ${bull.estado})`
        })),
    [animals, formData.idAnimal, selectedAnimal]
  );

  const [fieldErrors, setFieldErrors] = useState<ReproductionValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const clearFieldError = (field: keyof ReproductionValidationErrors) => {
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

    const validationErrors = validateReproductionInput(formData, {
      animals,
      existingEvents,
      excludeEventId: initialEvent?.id
    });
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el evento reproductivo.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(formData);
      onClose();
    } catch (err) {
      if (err instanceof ReproductionValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el evento reproductivo.');
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const disableSireSelect = Boolean(selectedAnimal && isMaleAnimal(selectedAnimal.sexo));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reproduction-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border-light flex items-center justify-between bg-surface-app/40 sticky top-0 z-10">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/60">
              {isEditMode ? 'Edición de Evento Reproductivo' : 'Nuevo Evento Reproductivo'}
            </p>
            <h2
              id="reproduction-modal-title"
              className="text-xl font-condensed font-bold text-brand-forest"
            >
              {isEditMode
                ? `Editar: ${initialEvent?.tipo}`
                : 'Registrar Evento Reproductivo'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar formulario de evento reproductivo"
            className="p-2 text-brand-slate/70 hover:text-brand-forest rounded-md hover:bg-surface-secondary/50 transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5">
          {!isOnline && (
            <div className="p-3 rounded-lg bg-status-warning/15 border border-status-warning/40 text-brand-dark text-[12px] flex items-center gap-2">
              <WifiOff size={15} className="text-status-warning shrink-0" />
              <span>
                Modo sin conexión: el evento reproductivo se almacenará en IndexedDB y se
                sincronizará automáticamente al recuperar Internet.
              </span>
            </div>
          )}

          {formError && (
            <div
              role="alert"
              className="p-3.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-[13px] font-medium flex items-center gap-2"
            >
              <AlertCircle size={16} className="shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Selección de animal con buscador interno por arete */}
          <div>
            <AnimalSelectField
              id="repro-animal"
              label="Animal"
              required
              options={animalOptions}
              value={formData.idAnimal}
              disabled={isEditMode}
              onChange={(animalId) => {
                const nextAnimal = animals.find((a) => a.id === animalId);
                setFormData((prev) => ({
                  ...prev,
                  idAnimal: animalId,
                  idSemental:
                    nextAnimal && isMaleAnimal(nextAnimal.sexo) ? null : prev.idSemental
                }));
                clearFieldError('idAnimal');
                clearFieldError('idSemental');
              }}
              error={fieldErrors.idAnimal}
              placeholder="Selecciona un animal por arete"
              searchPlaceholder="Buscar animal por arete o raza..."
              helperText={
                isEditMode
                  ? 'El animal asociado no se modifica al editar para conservar la integridad del expediente.'
                  : 'Busca y selecciona por arete. Los eventos exclusivos de hembra (celo, gestación, parto, etc.) validan el sexo registrado.'
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tipo de evento reproductivo */}
            <div>
              <label
                htmlFor="repro-tipo"
                className="block text-[13px] font-semibold text-brand-slate mb-1.5"
              >
                Tipo de Evento Reproductivo <span className="text-status-danger">*</span>
              </label>
              <input
                id="repro-tipo"
                type="text"
                list="repro-tipo-suggestions"
                required
                maxLength={REPRODUCTION_FIELD_LIMITS.tipoMax}
                placeholder="Ej. Detección de celo, Servicio o monta, Inseminación, Parto..."
                value={formData.tipo}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, tipo: e.target.value }));
                  clearFieldError('tipo');
                }}
                aria-invalid={Boolean(fieldErrors.tipo)}
                className={`w-full h-[42px] px-3.5 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none transition-all ${
                  fieldErrors.tipo
                    ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                    : 'border-border-light focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15'
                }`}
              />
              <datalist id="repro-tipo-suggestions">
                {REPRODUCTION_EVENT_SUGGESTED_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {fieldErrors.tipo && (
                <p className="mt-1 text-[12px] text-status-danger font-medium">
                  {fieldErrors.tipo}
                </p>
              )}
            </div>

            {/* Fecha y hora */}
            <div>
              <label
                htmlFor="repro-fecha"
                className="block text-[13px] font-semibold text-brand-slate mb-1.5"
              >
                Fecha y Hora <span className="text-status-danger">*</span>
              </label>
              <input
                id="repro-fecha"
                type="datetime-local"
                required
                value={formData.fecha}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fecha: e.target.value }));
                  clearFieldError('fecha');
                }}
                aria-invalid={Boolean(fieldErrors.fecha)}
                className={`w-full h-[42px] px-3.5 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none transition-all ${
                  fieldErrors.fecha
                    ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                    : 'border-border-light focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15'
                }`}
              />
              {fieldErrors.fecha && (
                <p className="mt-1 text-[12px] text-status-danger font-medium">
                  {fieldErrors.fecha}
                </p>
              )}
            </div>
          </div>

          {/* Semental opcional */}
          <div>
            <AnimalSelectField
              id="repro-semental"
              name="idSemental"
              label="Semental asociado (Opcional)"
              options={sireOptions}
              value={formData.idSemental ?? ''}
              disabled={disableSireSelect}
              onChange={(sementalId) => {
                setFormData((prev) => ({
                  ...prev,
                  idSemental: sementalId ? sementalId : null
                }));
                clearFieldError('idSemental');
              }}
              error={fieldErrors.idSemental}
              placeholder="Sin semental registrado / Pajilla externa"
              searchPlaceholder="Buscar semental por arete o raza..."
              helperText="Solo machos activos del mismo rancho."
            />
          </div>

          {/* Resultado */}
          <div>
            <label
              htmlFor="repro-resultado"
              className="block text-[13px] font-semibold text-brand-slate mb-1.5"
            >
              Resultado <span className="text-brand-slate/50 font-normal">(Opcional)</span>
            </label>
            <input
              id="repro-resultado"
              type="text"
              list="repro-resultado-suggestions"
              maxLength={REPRODUCTION_FIELD_LIMITS.resultadoMax}
              placeholder="Ej. Positivo / Gestante, Negativo / Vacía, Cría Viva..."
              value={formData.resultado ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  resultado: e.target.value || null
                }));
                clearFieldError('resultado');
              }}
              aria-invalid={Boolean(fieldErrors.resultado)}
              className={`w-full h-[42px] px-3.5 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none transition-all ${
                fieldErrors.resultado
                  ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                  : 'border-border-light focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15'
              }`}
            />
            <datalist id="repro-resultado-suggestions">
              {REPRODUCTION_RESULT_SUGGESTED.map((res) => (
                <option key={res} value={res} />
              ))}
            </datalist>
            {fieldErrors.resultado && (
              <p className="mt-1 text-[12px] text-status-danger font-medium">
                {fieldErrors.resultado}
              </p>
            )}
          </div>

          {/* Observaciones */}
          <div>
            <label
              htmlFor="repro-observaciones"
              className="block text-[13px] font-semibold text-brand-slate mb-1.5"
            >
              Observaciones <span className="text-brand-slate/50 font-normal">(Opcional)</span>
            </label>
            <textarea
              id="repro-observaciones"
              rows={3}
              maxLength={REPRODUCTION_FIELD_LIMITS.observacionesMax}
              placeholder="Notas técnicas de campo, semental/pajilla utilizada, condición corporal o seguimiento..."
              value={formData.observaciones ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  observaciones: e.target.value || null
                }));
                clearFieldError('observaciones');
              }}
              aria-invalid={Boolean(fieldErrors.observaciones)}
              className={`w-full p-3 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none transition-all resize-y ${
                fieldErrors.observaciones
                  ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                  : 'border-border-light focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15'
              }`}
            />
            {fieldErrors.observaciones && (
              <p className="mt-1 text-[12px] text-status-danger font-medium">
                {fieldErrors.observaciones}
              </p>
            )}
          </div>

          {/* Acciones */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-2 border-t border-border-light">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="min-h-[42px] px-4 bg-surface-white border border-border-light hover:bg-surface-secondary/50 text-brand-slate rounded-md text-[13px] font-semibold transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (!isEditMode && animals.length === 0)}
              className="min-h-[42px] px-5 bg-pink-600 hover:bg-pink-700 text-white rounded-md text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Guardando...
                </>
              ) : (
                <>
                  <Save size={16} />
                  {isEditMode ? 'Guardar Cambios' : 'Registrar Evento Reproductivo'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
