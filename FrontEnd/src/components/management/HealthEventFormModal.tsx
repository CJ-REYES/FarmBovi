import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Info, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import {
  HEALTH_EVENT_SUGGESTED_TYPES,
  type HealthEvent,
  type HealthEventInput
} from '../../types/health';
import {
  HEALTH_EVENT_LIMITS,
  validateHealthEventInput,
  type HealthEventValidationErrors
} from '../../services/health.validation';
import {
  HealthValidationError,
  type HealthEventMutationResult
} from '../../services/health.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface HealthEventFormModalProps {
  mode: 'create' | 'edit';
  initialEvent?: HealthEvent;
  preselectedAnimalId?: string;
  animals: Cattle[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: HealthEventInput) => Promise<HealthEventMutationResult>;
}

function toDatetimeLocalValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return toDatetimeLocalValue();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function HealthEventFormModal({
  mode,
  initialEvent,
  preselectedAnimalId,
  animals,
  isOnline,
  onClose,
  onSubmit
}: HealthEventFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialEvent);
  const submitLockRef = useRef<boolean>(false);

  const [formData, setFormData] = useState<HealthEventInput>(() => {
    if (initialEvent) {
      return {
        idAnimal: initialEvent.idAnimal,
        tipo: initialEvent.tipo,
        fecha: toDatetimeLocalValue(initialEvent.fecha),
        sintomas: initialEvent.sintomas,
        diagnostico: initialEvent.diagnostico,
        profesionalDiagnostico: initialEvent.profesionalDiagnostico,
        evidenciaDiagnosticoUri: initialEvent.evidenciaDiagnosticoUri,
        responsable: initialEvent.responsable,
        observaciones: initialEvent.observaciones
      };
    }

    const defaultAnimal = preselectedAnimalId
      ? animals.find((a) => a.id === preselectedAnimalId && !a.deletedAt)
      : undefined;

    return {
      idAnimal: defaultAnimal?.id || '',
      tipo: '',
      fecha: toDatetimeLocalValue(),
      sintomas: null,
      diagnostico: null,
      profesionalDiagnostico: null,
      evidenciaDiagnosticoUri: null,
      responsable: '',
      observaciones: null
    };
  });

  const [fieldErrors, setFieldErrors] = useState<HealthEventValidationErrors>({});
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

  const clearFieldError = (field: keyof HealthEventValidationErrors) => {
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
    const validationErrors = validateHealthEventInput(formData, { animals });
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el evento sanitario.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(formData);
      onClose();
    } catch (err) {
      if (err instanceof HealthValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el evento sanitario.');
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
      aria-labelledby="health-event-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              {isEditMode ? 'Edición de Evento Sanitario' : 'Nuevo Evento Sanitario'}
            </span>
            <h2 id="health-event-modal-title" className="text-[18px] font-bold text-brand-forest">
              {isEditMode ? 'Actualizar Evento Sanitario' : 'Registrar Evento Sanitario'}
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
                Modo sin conexión: el evento sanitario se guardará en IndexedDB y se sincronizará al reconectar.
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

          {/* Animal + Tipo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimalSelectField
              id="health-event-animal"
              name="idAnimal"
              label="Animal"
              required
              disabled={isEditMode}
              value={formData.idAnimal}
              options={animalOptions}
              placeholder="Selecciona un animal"
              helperText={
                isEditMode
                  ? 'El animal del evento sanitario no se cambia en edición.'
                  : undefined
              }
              error={fieldErrors.idAnimal}
              onChange={(animalId) => {
                setFormData((prev) => ({ ...prev, idAnimal: animalId }));
                clearFieldError('idAnimal');
              }}
            />

            <div className="space-y-1.5">
              <label
                htmlFor="health-event-tipo"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Tipo de Evento <span className="text-status-error">*</span>
              </label>
              <input
                id="health-event-tipo"
                type="text"
                name="tipo"
                list="health-event-types-list"
                required
                maxLength={HEALTH_EVENT_LIMITS.tipoMax}
                value={formData.tipo}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, tipo: e.target.value }));
                  clearFieldError('tipo');
                }}
                placeholder="Ej. Vacunación, Desparasitación, Enfermedad"
                aria-invalid={Boolean(fieldErrors.tipo)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              <datalist id="health-event-types-list">
                {HEALTH_EVENT_SUGGESTED_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {fieldErrors.tipo && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.tipo}
                </p>
              )}
            </div>
          </div>

          {/* Fecha + Responsable */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="health-event-fecha"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fecha y Hora del Evento <span className="text-status-error">*</span>
              </label>
              <input
                id="health-event-fecha"
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

            <div className="space-y-1.5">
              <label
                htmlFor="health-event-responsable"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Responsable <span className="text-status-error">*</span>
              </label>
              <input
                id="health-event-responsable"
                type="text"
                name="responsable"
                required
                maxLength={HEALTH_EVENT_LIMITS.responsableMax}
                value={formData.responsable}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, responsable: e.target.value }));
                  clearFieldError('responsable');
                }}
                placeholder="Ej. MVZ Laura Méndez / Encargado de corral"
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

          {/* Síntomas y Diagnóstico */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="health-event-sintomas"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Síntomas / Descripción (Opcional)
              </label>
              <textarea
                id="health-event-sintomas"
                name="sintomas"
                rows={2}
                maxLength={HEALTH_EVENT_LIMITS.textMax}
                value={formData.sintomas ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, sintomas: e.target.value || null }));
                  clearFieldError('sintomas');
                }}
                placeholder="Ej. Fiebre leve, decaimiento, pérdida de apetito…"
                className="w-full px-3 py-2 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="health-event-diagnostico"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Diagnóstico (Opcional)
              </label>
              <textarea
                id="health-event-diagnostico"
                name="diagnostico"
                rows={2}
                maxLength={HEALTH_EVENT_LIMITS.textMax}
                value={formData.diagnostico ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, diagnostico: e.target.value || null }));
                  clearFieldError('diagnostico');
                }}
                placeholder="Ej. Infección respiratoria leve / Aplicación preventiva…"
                className="w-full px-3 py-2 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary resize-y"
              />
            </div>
          </div>

          {/* Profesional del diagnóstico + Evidencia URI */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="health-event-profesional"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Profesional del Diagnóstico (Opcional)
              </label>
              <input
                id="health-event-profesional"
                type="text"
                name="profesionalDiagnostico"
                maxLength={HEALTH_EVENT_LIMITS.profesionalMax}
                value={formData.profesionalDiagnostico ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    profesionalDiagnostico: e.target.value || null
                  }));
                  clearFieldError('profesionalDiagnostico');
                }}
                placeholder="Ej. Dr. Roberto Castillo (Céd. Prof. ...)"
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="health-event-evidencia"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Referencia / URI de Evidencia (Opcional)
              </label>
              <input
                id="health-event-evidencia"
                type="text"
                name="evidenciaDiagnosticoUri"
                maxLength={HEALTH_EVENT_LIMITS.evidenciaUriMax}
                value={formData.evidenciaDiagnosticoUri ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    evidenciaDiagnosticoUri: e.target.value || null
                  }));
                  clearFieldError('evidenciaDiagnosticoUri');
                }}
                placeholder="Ej. folio-lab-2026-014 o URL del documento"
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
            </div>
          </div>

          {/* Observaciones */}
          <div className="space-y-1.5">
            <label
              htmlFor="health-event-observaciones"
              className="block text-[13px] font-semibold text-brand-slate"
            >
              Observaciones (Opcional)
            </label>
            <textarea
              id="health-event-observaciones"
              name="observaciones"
              rows={2}
              maxLength={HEALTH_EVENT_LIMITS.textMax}
              value={formData.observaciones ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, observaciones: e.target.value || null }));
                clearFieldError('observaciones');
              }}
              placeholder="Ej. Aislado temporalmente en corral de observación…"
              className="w-full px-3 py-2 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary resize-y"
            />
          </div>

          <p className="text-[11px] text-brand-slate/60 flex items-start gap-1.5 bg-surface-app/70 border border-border-light rounded-lg p-2.5">
            <Info size={14} className="shrink-0 mt-0.5 text-status-info" />
            <span>
              Regla 11: FarmBovi conserva el historial clínico, responsable y profesional cuando exista. La aplicación no diagnostica ni prescribe.
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
                  : 'Registrar Evento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
