import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Info, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import {
  HEALTH_EVENT_SUGGESTED_TYPES,
  TREATMENT_ESTADOS,
  TREATMENT_UNITS_SUGGESTED,
  TREATMENT_VIAS_SUGGESTED,
  type HealthEvent,
  type HealthEventInput,
  type Treatment,
  type TreatmentEstado,
  type TreatmentInput
} from '../../types/health';
import {
  HEALTH_EVENT_LIMITS,
  TREATMENT_LIMITS,
  validateHealthEventInput,
  validateTreatmentInput,
  type TreatmentValidationErrors
} from '../../services/health.validation';
import {
  HealthValidationError,
  TreatmentValidationError,
  type TreatmentMutationResult
} from '../../services/health.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface TreatmentFormSubmitPayload {
  treatment: TreatmentInput;
  inlineEvent?: HealthEventInput;
}

export interface TreatmentFormModalProps {
  mode: 'create' | 'edit';
  initialTreatment?: Treatment;
  preselectedEventId?: string;
  events: HealthEvent[];
  animals: Cattle[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (payload: TreatmentFormSubmitPayload) => Promise<TreatmentMutationResult>;
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

export default function TreatmentFormModal({
  mode,
  initialTreatment,
  preselectedEventId,
  events,
  animals,
  isOnline,
  onClose,
  onSubmit
}: TreatmentFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialTreatment);
  const submitLockRef = useRef<boolean>(false);

  const activeEvents = useMemo(
    () =>
      events.filter(
        (ev) => !ev.deletedAt || ev.id === initialTreatment?.idEventoSanitario
      ),
    [events, initialTreatment]
  );

  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

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

  const [eventMode, setEventMode] = useState<'existing' | 'inline'>(() => {
    if (isEditMode || preselectedEventId) return 'existing';
    return activeEvents.length > 0 ? 'existing' : 'inline';
  });

  const [inlineEventData, setInlineEventData] = useState<{
    idAnimal: string;
    tipo: string;
    diagnostico: string;
  }>({
    idAnimal: '',
    tipo: 'Tratamiento',
    diagnostico: ''
  });

  const [inlineEventErrors, setInlineEventErrors] = useState<{
    idAnimal?: string;
    tipo?: string;
  }>({});

  const [formData, setFormData] = useState<TreatmentInput>(() => {
    if (initialTreatment) {
      return {
        idEventoSanitario: initialTreatment.idEventoSanitario,
        producto: initialTreatment.producto,
        dosis: String(initialTreatment.dosis),
        unidadDosis: initialTreatment.unidadDosis,
        viaAdministracion: initialTreatment.viaAdministracion,
        frecuencia: initialTreatment.frecuencia,
        fechaInicio: toDatetimeLocalValue(initialTreatment.fechaInicio),
        fechaFin: toDatetimeLocalValue(initialTreatment.fechaFin) || null,
        responsable: initialTreatment.responsable,
        prescripcionUri: initialTreatment.prescripcionUri,
        estado: initialTreatment.estado
      };
    }

    return {
      idEventoSanitario: preselectedEventId || '',
      producto: '',
      dosis: '',
      unidadDosis: 'mL',
      viaAdministracion: null,
      frecuencia: '',
      fechaInicio: nowDatetimeLocal(),
      fechaFin: null,
      responsable: '',
      prescripcionUri: null,
      estado: 'Pendiente'
    };
  });

  const [fieldErrors, setFieldErrors] = useState<TreatmentValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const clearFieldError = (field: keyof TreatmentValidationErrors) => {
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

    const isInlineMode = !isEditMode && eventMode === 'inline';
    let inlineEventPayload: HealthEventInput | undefined;
    const nextInlineErrors: { idAnimal?: string; tipo?: string } = {};

    if (isInlineMode) {
      inlineEventPayload = {
        idAnimal: inlineEventData.idAnimal,
        tipo: inlineEventData.tipo,
        fecha: formData.fechaInicio,
        sintomas: null,
        diagnostico: inlineEventData.diagnostico.trim() || null,
        profesionalDiagnostico: null,
        evidenciaDiagnosticoUri: null,
        responsable: formData.responsable || 'Responsable de aplicación',
        observaciones: null
      };

      const evErrors = validateHealthEventInput(inlineEventPayload, { animals });
      if (evErrors.idAnimal) nextInlineErrors.idAnimal = evErrors.idAnimal;
      if (evErrors.tipo) nextInlineErrors.tipo = evErrors.tipo;
    }

    // Si crearemos el evento inline, usamos un placeholder GUID solo para validar los demás campos del tratamiento
    const treatmentToValidate: TreatmentInput = isInlineMode
      ? {
          ...formData,
          idEventoSanitario: '11111111-1111-4111-8111-111111111111'
        }
      : formData;

    const validationErrors = validateTreatmentInput(
      treatmentToValidate,
      isInlineMode ? {} : { events }
    );
    if (isInlineMode) {
      delete validationErrors.idEventoSanitario;
    }

    if (
      Object.keys(nextInlineErrors).length > 0 ||
      Object.keys(validationErrors).length > 0
    ) {
      setInlineEventErrors(nextInlineErrors);
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el tratamiento.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setInlineEventErrors({});
    setFieldErrors({});

    try {
      await onSubmit({
        treatment: formData,
        inlineEvent: inlineEventPayload
      });
      onClose();
    } catch (err) {
      if (err instanceof TreatmentValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof HealthValidationError) {
        setInlineEventErrors({
          idAnimal: err.fieldErrors.idAnimal,
          tipo: err.fieldErrors.tipo
        });
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el tratamiento.');
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
      aria-labelledby="treatment-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              {isEditMode ? 'Edición de Tratamiento' : 'Nuevo Tratamiento Sanitario'}
            </span>
            <h2 id="treatment-modal-title" className="text-[18px] font-bold text-brand-forest">
              {isEditMode ? 'Actualizar Tratamiento' : 'Registrar Tratamiento'}
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
                Modo sin conexión: el tratamiento se guardará en IndexedDB y se sincronizará después del evento sanitario asociado.
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

          {/* Origen clínico: Evento sanitario existente o creación directa con animal */}
          <div className="p-3.5 rounded-lg bg-surface-app/70 border border-border-light space-y-3">
            {!isEditMode && activeEvents.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEventMode('existing');
                    setInlineEventErrors({});
                  }}
                  className={`min-h-[38px] px-3 rounded-md border text-[12px] font-semibold transition-colors cursor-pointer ${
                    eventMode === 'existing'
                      ? 'bg-status-info text-white border-status-info'
                      : 'bg-surface-white text-brand-slate border-border-light hover:border-status-info'
                  }`}
                >
                  Evento sanitario existente
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEventMode('inline');
                    clearFieldError('idEventoSanitario');
                  }}
                  className={`min-h-[38px] px-3 rounded-md border text-[12px] font-semibold transition-colors cursor-pointer ${
                    eventMode === 'inline'
                      ? 'bg-status-info text-white border-status-info'
                      : 'bg-surface-white text-brand-slate border-border-light hover:border-status-info'
                  }`}
                >
                  Nuevo evento para un animal
                </button>
              </div>
            )}

            {!isEditMode && activeEvents.length === 0 && (
              <div className="flex items-start gap-2 text-[12px] text-brand-slate/80 bg-status-info/10 border border-status-info/25 rounded-md p-2.5">
                <Info size={15} className="text-status-info shrink-0 mt-0.5" />
                <span>
                  Aún no hay eventos sanitarios previos. Selecciona el animal y el motivo para crear automáticamente el evento sanitario junto con este tratamiento.
                </span>
              </div>
            )}

            {isEditMode || eventMode === 'existing' ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="treatment-evento"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Evento Sanitario Asociado <span className="text-status-error">*</span>
                </label>
                <select
                  id="treatment-evento"
                  name="idEventoSanitario"
                  required
                  disabled={isEditMode}
                  value={formData.idEventoSanitario}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, idEventoSanitario: e.target.value }));
                    clearFieldError('idEventoSanitario');
                  }}
                  aria-invalid={Boolean(fieldErrors.idEventoSanitario)}
                  className="w-full min-h-[44px] px-3 bg-surface-white border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">Selecciona un evento sanitario</option>
                  {activeEvents.map((ev) => {
                    const animal = animalById.get(ev.idAnimal);
                    const dateShort = ev.fecha.slice(0, 10);
                    return (
                      <option key={ev.id} value={ev.id}>
                        {animal ? animal.arete : ev.idAnimal.slice(0, 8)} — {ev.tipo} ({dateShort})
                      </option>
                    );
                  })}
                </select>
                {isEditMode && (
                  <p className="text-[11px] text-brand-slate/55">
                    El evento sanitario asociado no se cambia en edición.
                  </p>
                )}
                {fieldErrors.idEventoSanitario && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.idEventoSanitario}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <AnimalSelectField
                  id="treatment-inline-animal"
                  name="inlineIdAnimal"
                  label="Animal"
                  required
                  value={inlineEventData.idAnimal}
                  options={animalOptions}
                  placeholder="Selecciona un animal"
                  error={inlineEventErrors.idAnimal}
                  selectClassName="w-full min-h-[44px] px-3 bg-surface-white border border-border-light rounded-md text-[14px] text-left flex items-center justify-between gap-2 outline-none focus:border-brand-primary cursor-pointer"
                  onChange={(animalId) => {
                    setInlineEventData((prev) => ({ ...prev, idAnimal: animalId }));
                    setInlineEventErrors((prev) => ({ ...prev, idAnimal: undefined }));
                  }}
                />

                <div className="space-y-1.5">
                  <label
                    htmlFor="treatment-inline-tipo"
                    className="block text-[13px] font-semibold text-brand-slate"
                  >
                    Tipo de Evento Sanitario <span className="text-status-error">*</span>
                  </label>
                  <input
                    id="treatment-inline-tipo"
                    type="text"
                    list="treatment-inline-event-types"
                    required
                    maxLength={HEALTH_EVENT_LIMITS.tipoMax}
                    value={inlineEventData.tipo}
                    onChange={(e) => {
                      setInlineEventData((prev) => ({ ...prev, tipo: e.target.value }));
                      setInlineEventErrors((prev) => ({ ...prev, tipo: undefined }));
                    }}
                    placeholder="Ej. Tratamiento, Vacunación, Enfermedad"
                    aria-invalid={Boolean(inlineEventErrors.tipo)}
                    className="w-full min-h-[44px] px-3 bg-surface-white border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                  <datalist id="treatment-inline-event-types">
                    {HEALTH_EVENT_SUGGESTED_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  {inlineEventErrors.tipo && (
                    <p role="alert" className="text-[12px] text-status-error font-medium">
                      {inlineEventErrors.tipo}
                    </p>
                  )}
                </div>

                <div className="md:col-span-2 space-y-1.5">
                  <label
                    htmlFor="treatment-inline-diagnostico"
                    className="block text-[13px] font-semibold text-brand-slate"
                  >
                    Motivo / Diagnóstico del Evento (Opcional)
                  </label>
                  <input
                    id="treatment-inline-diagnostico"
                    type="text"
                    value={inlineEventData.diagnostico}
                    onChange={(e) =>
                      setInlineEventData((prev) => ({ ...prev, diagnostico: e.target.value }))
                    }
                    placeholder="Ej. Aplicación preventiva o infección detectada en corral"
                    className="w-full min-h-[42px] px-3 bg-surface-white border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Producto + Vía */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="treatment-producto"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Producto / Medicamento <span className="text-status-error">*</span>
              </label>
              <input
                id="treatment-producto"
                type="text"
                name="producto"
                required
                maxLength={TREATMENT_LIMITS.productoMax}
                value={formData.producto}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, producto: e.target.value }));
                  clearFieldError('producto');
                }}
                placeholder="Ej. Ivermectina 1%, Oxitetraciclina LA"
                aria-invalid={Boolean(fieldErrors.producto)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.producto && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.producto}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="treatment-via"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Vía de Administración (Opcional)
              </label>
              <input
                id="treatment-via"
                type="text"
                name="viaAdministracion"
                list="treatment-vias-list"
                maxLength={TREATMENT_LIMITS.viaMax}
                value={formData.viaAdministracion ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    viaAdministracion: e.target.value || null
                  }));
                  clearFieldError('viaAdministracion');
                }}
                placeholder="Ej. Subcutánea, Intramuscular, Oral"
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              <datalist id="treatment-vias-list">
                {TREATMENT_VIAS_SUGGESTED.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Dosis + Unidad + Frecuencia */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="treatment-dosis"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Dosis <span className="text-status-error">*</span>
              </label>
              <input
                id="treatment-dosis"
                type="number"
                name="dosis"
                required
                min="0.001"
                step="0.001"
                value={formData.dosis}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, dosis: e.target.value }));
                  clearFieldError('dosis');
                }}
                placeholder="Ej. 10"
                aria-invalid={Boolean(fieldErrors.dosis)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.dosis && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.dosis}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="treatment-unidad"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Unidad de Dosis <span className="text-status-error">*</span>
              </label>
              <input
                id="treatment-unidad"
                type="text"
                name="unidadDosis"
                list="treatment-units-list"
                required
                maxLength={TREATMENT_LIMITS.unidadDosisMax}
                value={formData.unidadDosis}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, unidadDosis: e.target.value }));
                  clearFieldError('unidadDosis');
                }}
                placeholder="Ej. mL, mg, dosis"
                aria-invalid={Boolean(fieldErrors.unidadDosis)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              <datalist id="treatment-units-list">
                {TREATMENT_UNITS_SUGGESTED.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              {fieldErrors.unidadDosis && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.unidadDosis}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="treatment-frecuencia"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Frecuencia <span className="text-status-error">*</span>
              </label>
              <input
                id="treatment-frecuencia"
                type="text"
                name="frecuencia"
                required
                maxLength={TREATMENT_LIMITS.frecuenciaMax}
                value={formData.frecuencia}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, frecuencia: e.target.value }));
                  clearFieldError('frecuencia');
                }}
                placeholder="Ej. Cada 24 horas"
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

          {/* Fechas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="treatment-inicio"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fecha y Hora de Inicio <span className="text-status-error">*</span>
              </label>
              <input
                id="treatment-inicio"
                type="datetime-local"
                name="fechaInicio"
                required
                value={formData.fechaInicio}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fechaInicio: e.target.value }));
                  clearFieldError('fechaInicio');
                  clearFieldError('fechaFin');
                }}
                aria-invalid={Boolean(fieldErrors.fechaInicio)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.fechaInicio && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.fechaInicio}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="treatment-fin"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Fecha y Hora de Fin (Opcional)
              </label>
              <input
                id="treatment-fin"
                type="datetime-local"
                name="fechaFin"
                value={formData.fechaFin ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fechaFin: e.target.value || null }));
                  clearFieldError('fechaFin');
                }}
                aria-invalid={Boolean(fieldErrors.fechaFin)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.fechaFin && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.fechaFin}
                </p>
              )}
            </div>
          </div>

          {/* Responsable + Estado */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="treatment-responsable"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Responsable de Aplicación <span className="text-status-error">*</span>
              </label>
              <input
                id="treatment-responsable"
                type="text"
                name="responsable"
                required
                maxLength={TREATMENT_LIMITS.responsableMax}
                value={formData.responsable}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, responsable: e.target.value }));
                  clearFieldError('responsable');
                }}
                placeholder="Ej. MVZ Laura Méndez"
                aria-invalid={Boolean(fieldErrors.responsable)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
              {fieldErrors.responsable && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.responsable}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="treatment-estado"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Estado del Tratamiento <span className="text-status-error">*</span>
              </label>
              <select
                id="treatment-estado"
                name="estado"
                required
                value={formData.estado}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, estado: e.target.value as TreatmentEstado }));
                  clearFieldError('estado');
                }}
                aria-invalid={Boolean(fieldErrors.estado)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              >
                {TREATMENT_ESTADOS.map((estado) => (
                  <option key={estado} value={estado}>
                    {estado}
                  </option>
                ))}
              </select>
              {fieldErrors.estado && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.estado}
                </p>
              )}
            </div>
          </div>

          {/* Prescripción URI */}
          <div className="space-y-1.5">
            <label
              htmlFor="treatment-prescripcion"
              className="block text-[13px] font-semibold text-brand-slate"
            >
              Referencia / URI de Prescripción (Opcional)
            </label>
            <input
              id="treatment-prescripcion"
              type="text"
              name="prescripcionUri"
              maxLength={TREATMENT_LIMITS.prescripcionUriMax}
              value={formData.prescripcionUri ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, prescripcionUri: e.target.value || null }));
                clearFieldError('prescripcionUri');
              }}
              placeholder="Ej. receta-vet-2026-089 o enlace al documento"
              className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
            />
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
              className="min-h-[44px] px-5 rounded-md bg-status-info hover:bg-blue-700 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isSubmitting
                ? 'Guardando…'
                : isEditMode
                  ? 'Guardar Cambios'
                  : 'Guardar Tratamiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
