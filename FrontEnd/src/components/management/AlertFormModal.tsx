import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { Cattle, RanchOption } from '../../types/cattle';
import type { Lot } from '../../types/lot';
import type { Treatment } from '../../types/health';
import {
  ALERT_ESTADOS,
  ALERT_SUGGESTED_TYPES,
  type AlertEstado,
  type AlertInput,
  type AlertRecord,
  type AlertScope
} from '../../types/alert';
import {
  ALERT_FIELD_LIMITS,
  validateAlertInput,
  type AlertValidationErrors
} from '../../services/alert.validation';
import {
  AlertValidationError,
  type AlertMutationResult
} from '../../services/alert.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface AlertFormModalProps {
  mode: 'create' | 'edit';
  initialAlert?: AlertRecord;
  prefillTreatment?: Treatment;
  ranches: RanchOption[];
  animals: Cattle[];
  lots: Lot[];
  treatments: Treatment[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: AlertInput) => Promise<AlertMutationResult>;
}

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultTomorrowDatetimeLocal(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setMinutes(0, 0, 0);
  return toDatetimeLocalValue(tomorrow.toISOString());
}

export default function AlertFormModal({
  mode,
  initialAlert,
  prefillTreatment,
  ranches,
  animals,
  lots,
  treatments,
  isOnline,
  onClose,
  onSubmit
}: AlertFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialAlert);
  const submitLockRef = useRef<boolean>(false);

  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  const initialScope: AlertScope = useMemo(() => {
    if (initialAlert) {
      if (initialAlert.idAnimal) return 'animal';
      if (initialAlert.idLote) return 'lote';
      return 'rancho';
    }
    if (prefillTreatment) return 'animal';
    return 'rancho';
  }, [initialAlert, prefillTreatment]);

  const [scope, setScope] = useState<AlertScope>(initialScope);

  const [formData, setFormData] = useState<AlertInput>(() => {
    if (initialAlert) {
      return {
        idRancho: initialAlert.idRancho,
        idAnimal: initialAlert.idAnimal,
        idLote: initialAlert.idLote,
        idTratamiento: initialAlert.idTratamiento,
        idResponsable: initialAlert.idResponsable,
        tipo: initialAlert.tipo,
        descripcion: initialAlert.descripcion,
        fechaProgramada: toDatetimeLocalValue(initialAlert.fechaProgramada),
        estado: initialAlert.estado,
        fechaCompletado: toDatetimeLocalValue(initialAlert.fechaCompletado) || null
      };
    }

    if (prefillTreatment) {
      const animal = animals.find((a) => a.id === prefillTreatment.idAnimal);
      const ranchId = prefillTreatment.idRancho || animal?.idRancho || ranches[0]?.id || '';
      const targetFecha = prefillTreatment.fechaFin || prefillTreatment.fechaInicio;
      return {
        idRancho: ranchId,
        idAnimal: prefillTreatment.idAnimal || null,
        idLote: null,
        idTratamiento: prefillTreatment.id,
        idResponsable: null,
        tipo: 'Tratamiento',
        descripcion: `Seguimiento de ${prefillTreatment.producto} (${prefillTreatment.dosis} ${prefillTreatment.unidadDosis}, ${prefillTreatment.frecuencia})`.slice(
          0,
          ALERT_FIELD_LIMITS.descripcionMax
        ),
        fechaProgramada: toDatetimeLocalValue(targetFecha) || defaultTomorrowDatetimeLocal(),
        estado: 'Pendiente',
        fechaCompletado: null
      };
    }

    const defaultRanchId = ranches[0]?.id || animals[0]?.idRancho || lots[0]?.idRancho || '';
    return {
      idRancho: defaultRanchId,
      idAnimal: null,
      idLote: null,
      idTratamiento: null,
      idResponsable: null,
      tipo: '',
      descripcion: '',
      fechaProgramada: defaultTomorrowDatetimeLocal(),
      estado: 'Pendiente',
      fechaCompletado: null
    };
  });

  const [fieldErrors, setFieldErrors] = useState<AlertValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const scopedAnimals = useMemo(() => {
    if (!formData.idRancho) return animals;
    return animals.filter((a) => !a.idRancho || a.idRancho === formData.idRancho);
  }, [animals, formData.idRancho]);

  const animalOptions = useMemo(
    () =>
      scopedAnimals.map((a) => ({
        id: a.id,
        arete: a.arete,
        raza: a.raza,
        extraLabel: `(${a.estado})`
      })),
    [scopedAnimals]
  );

  const scopedLots = useMemo(() => {
    if (!formData.idRancho) return lots;
    return lots.filter((l) => !l.idRancho || l.idRancho === formData.idRancho);
  }, [lots, formData.idRancho]);

  const scopedTreatments = useMemo(() => {
    return treatments.filter((t) => {
      if (t.deletedAt && t.id !== initialAlert?.idTratamiento) return false;
      if (formData.idRancho && t.idRancho && t.idRancho !== formData.idRancho) return false;
      if (scope === 'animal' && formData.idAnimal && t.idAnimal !== formData.idAnimal) return false;
      return true;
    });
  }, [treatments, initialAlert, formData.idRancho, formData.idAnimal, scope]);

  const clearFieldError = (field: keyof AlertValidationErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleScopeChange = (nextScope: AlertScope) => {
    setScope(nextScope);
    setFormData((prev) => ({
      ...prev,
      idAnimal: nextScope === 'animal' ? prev.idAnimal : null,
      idLote: nextScope === 'lote' ? prev.idLote : null,
      idTratamiento: nextScope === 'lote' ? null : prev.idTratamiento
    }));
    clearFieldError('idAnimal');
    clearFieldError('idLote');
    clearFieldError('idTratamiento');
  };

  const handleRanchChange = (nextRanchId: string) => {
    setFormData((prev) => ({
      ...prev,
      idRancho: nextRanchId,
      idAnimal: null,
      idLote: null,
      idTratamiento: null
    }));
    clearFieldError('idRancho');
    clearFieldError('idAnimal');
    clearFieldError('idLote');
    clearFieldError('idTratamiento');
  };

  const handleTreatmentChange = (nextTreatmentId: string) => {
    if (!nextTreatmentId) {
      setFormData((prev) => ({ ...prev, idTratamiento: null }));
      clearFieldError('idTratamiento');
      return;
    }

    const treatment = treatments.find((t) => t.id === nextTreatmentId);
    if (treatment) {
      setScope('animal');
      setFormData((prev) => ({
        ...prev,
        idTratamiento: treatment.id,
        idAnimal: treatment.idAnimal || prev.idAnimal,
        idLote: null,
        idRancho: treatment.idRancho || prev.idRancho
      }));
    } else {
      setFormData((prev) => ({ ...prev, idTratamiento: nextTreatmentId }));
    }
    clearFieldError('idTratamiento');
    clearFieldError('idAnimal');
    clearFieldError('idLote');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setFormError(null);

    const effectiveInput: AlertInput = {
      ...formData,
      idAnimal: scope === 'animal' ? formData.idAnimal : null,
      idLote: scope === 'lote' ? formData.idLote : null,
      idTratamiento: scope === 'lote' ? null : formData.idTratamiento
    };

    const validationErrors = validateAlertInput(effectiveInput, {
      ranches,
      animals,
      lots,
      treatments
    });

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el recordatorio.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(effectiveInput);
      onClose();
    } catch (err) {
      if (err instanceof AlertValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el recordatorio.');
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
      aria-labelledby="alert-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border-light flex items-center justify-between bg-surface-app/40 sticky top-0 z-10">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/60">
              {isEditMode ? 'Edición de Recordatorio' : 'Nuevo Recordatorio Operativo'}
            </p>
            <h2
              id="alert-modal-title"
              className="text-xl font-condensed font-bold text-brand-forest"
            >
              {isEditMode ? `Editar: ${initialAlert?.tipo}` : 'Programar Recordatorio'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar formulario de recordatorio"
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
                Modo sin conexión: el recordatorio se almacenará en IndexedDB y se sincronizará con{' '}
                <strong>/api/sync/operaciones</strong> al reconectar.
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

          {/* Rancho + Tipo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="alert-rancho"
                className="block text-[13px] font-semibold text-brand-slate mb-1.5"
              >
                Rancho <span className="text-status-danger">*</span>
              </label>
              <select
                id="alert-rancho"
                required
                value={formData.idRancho}
                onChange={(e) => handleRanchChange(e.target.value)}
                aria-invalid={Boolean(fieldErrors.idRancho)}
                className={`w-full h-[42px] px-3 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none ${
                  fieldErrors.idRancho
                    ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                    : 'border-border-light focus:border-brand-primary'
                }`}
              >
                <option value="">Selecciona un rancho</option>
                {ranches.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
              {fieldErrors.idRancho && (
                <p className="mt-1 text-[12px] text-status-danger font-medium">
                  {fieldErrors.idRancho}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="alert-tipo"
                className="block text-[13px] font-semibold text-brand-slate mb-1.5"
              >
                Tipo <span className="text-status-danger">*</span>
              </label>
              <input
                id="alert-tipo"
                type="text"
                list="alert-tipo-suggestions"
                required
                maxLength={ALERT_FIELD_LIMITS.tipoMax}
                placeholder="Ej. Vacunación, Tratamiento, Pesaje..."
                value={formData.tipo}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, tipo: e.target.value }));
                  clearFieldError('tipo');
                }}
                aria-invalid={Boolean(fieldErrors.tipo)}
                className={`w-full h-[42px] px-3.5 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none ${
                  fieldErrors.tipo
                    ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                    : 'border-border-light focus:border-brand-primary'
                }`}
              />
              <datalist id="alert-tipo-suggestions">
                {ALERT_SUGGESTED_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {fieldErrors.tipo && (
                <p className="mt-1 text-[12px] text-status-danger font-medium">
                  {fieldErrors.tipo}
                </p>
              )}
            </div>
          </div>

          {/* Fecha programada + Estado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="alert-fecha"
                className="block text-[13px] font-semibold text-brand-slate mb-1.5"
              >
                Fecha y Hora Programada <span className="text-status-danger">*</span>
              </label>
              <input
                id="alert-fecha"
                type="datetime-local"
                required
                value={formData.fechaProgramada}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fechaProgramada: e.target.value }));
                  clearFieldError('fechaProgramada');
                }}
                aria-invalid={Boolean(fieldErrors.fechaProgramada)}
                className={`w-full h-[42px] px-3.5 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none ${
                  fieldErrors.fechaProgramada
                    ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                    : 'border-border-light focus:border-brand-primary'
                }`}
              />
              {fieldErrors.fechaProgramada && (
                <p className="mt-1 text-[12px] text-status-danger font-medium">
                  {fieldErrors.fechaProgramada}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="alert-estado"
                className="block text-[13px] font-semibold text-brand-slate mb-1.5"
              >
                Estado <span className="text-status-danger">*</span>
              </label>
              <select
                id="alert-estado"
                value={formData.estado}
                onChange={(e) => {
                  const nextEstado = e.target.value as AlertEstado;
                  setFormData((prev) => ({
                    ...prev,
                    estado: nextEstado,
                    fechaCompletado:
                      nextEstado === 'Completado'
                        ? prev.fechaCompletado || toDatetimeLocalValue(new Date().toISOString())
                        : null
                  }));
                  clearFieldError('estado');
                }}
                aria-invalid={Boolean(fieldErrors.estado)}
                className={`w-full h-[42px] px-3 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none ${
                  fieldErrors.estado
                    ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                    : 'border-border-light focus:border-brand-primary'
                }`}
              >
                {ALERT_ESTADOS.map((est) => (
                  <option key={est} value={est}>
                    {est}
                  </option>
                ))}
              </select>
              {fieldErrors.estado && (
                <p className="mt-1 text-[12px] text-status-danger font-medium">
                  {fieldErrors.estado}
                </p>
              )}
            </div>
          </div>

          {/* Alcance (Regla 12: general, animal o lote — excluyentes) */}
          <div className="space-y-3 p-3.5 rounded-lg bg-surface-secondary/35 border border-border-light">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-brand-slate">
                Alcance del Recordatorio
              </span>
              <div className="inline-flex rounded-md border border-border-light bg-surface-white p-0.5 w-fit">
                {(
                  [
                    { id: 'rancho', label: 'General del Rancho' },
                    { id: 'animal', label: 'Por Animal' },
                    { id: 'lote', label: 'Por Potrero / Lote' }
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleScopeChange(tab.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                      scope === tab.id
                        ? 'bg-brand-primary text-white'
                        : 'text-brand-slate/75 hover:text-brand-forest'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {scope === 'animal' && (
              <AnimalSelectField
                id="alert-animal"
                label="Animal"
                options={animalOptions}
                value={formData.idAnimal ?? ''}
                onChange={(animalId) => {
                  setFormData((prev) => ({
                    ...prev,
                    idAnimal: animalId || null,
                    idLote: null
                  }));
                  clearFieldError('idAnimal');
                }}
                error={fieldErrors.idAnimal}
                placeholder="Selecciona un animal por arete"
                searchPlaceholder="Buscar animal por arete o raza..."
              />
            )}

            {scope === 'lote' && (
              <div>
                <label
                  htmlFor="alert-lote"
                  className="block text-[13px] font-semibold text-brand-slate mb-1.5"
                >
                  Potrero / Lote
                </label>
                <select
                  id="alert-lote"
                  value={formData.idLote ?? ''}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      idLote: e.target.value || null,
                      idAnimal: null,
                      idTratamiento: null
                    }));
                    clearFieldError('idLote');
                  }}
                  aria-invalid={Boolean(fieldErrors.idLote)}
                  className={`w-full h-[42px] px-3 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none ${
                    fieldErrors.idLote
                      ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                      : 'border-border-light focus:border-brand-primary'
                  }`}
                >
                  <option value="">Selecciona un potrero o lote</option>
                  {scopedLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.nombre}
                    </option>
                  ))}
                </select>
                {fieldErrors.idLote && (
                  <p className="mt-1 text-[12px] text-status-danger font-medium">
                    {fieldErrors.idLote}
                  </p>
                )}
              </div>
            )}

            {scope !== 'lote' && scopedTreatments.length > 0 && (
              <div>
                <label
                  htmlFor="alert-tratamiento"
                  className="block text-[13px] font-semibold text-brand-slate mb-1.5"
                >
                  Tratamiento Vinculado{' '}
                  <span className="text-brand-slate/50 font-normal">(Opcional)</span>
                </label>
                <select
                  id="alert-tratamiento"
                  value={formData.idTratamiento ?? ''}
                  onChange={(e) => handleTreatmentChange(e.target.value)}
                  aria-invalid={Boolean(fieldErrors.idTratamiento)}
                  className={`w-full h-[40px] px-3 bg-surface-white border rounded-md text-[13px] text-brand-slate outline-none ${
                    fieldErrors.idTratamiento
                      ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                      : 'border-border-light focus:border-brand-primary'
                  }`}
                >
                  <option value="">Sin tratamiento vinculado</option>
                  {scopedTreatments.map((t) => {
                    const a = animalById.get(t.idAnimal);
                    return (
                      <option key={t.id} value={t.id}>
                        {t.producto} — {a ? a.arete : t.idAnimal.slice(0, 8)} ({t.estado})
                      </option>
                    );
                  })}
                </select>
                {fieldErrors.idTratamiento && (
                  <p className="mt-1 text-[12px] text-status-danger font-medium">
                    {fieldErrors.idTratamiento}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Descripción */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="alert-descripcion"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Descripción <span className="text-status-danger">*</span>
              </label>
              <span className="text-[11px] text-brand-slate/55">
                {formData.descripcion.length}/{ALERT_FIELD_LIMITS.descripcionMax}
              </span>
            </div>
            <textarea
              id="alert-descripcion"
              rows={3}
              required
              maxLength={ALERT_FIELD_LIMITS.descripcionMax}
              placeholder="Ej. Aplicar segunda dosis de vacuna clostridial en corral norte..."
              value={formData.descripcion}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, descripcion: e.target.value }));
                clearFieldError('descripcion');
              }}
              aria-invalid={Boolean(fieldErrors.descripcion)}
              className={`w-full p-3 bg-surface-white border rounded-md text-[14px] text-brand-slate outline-none resize-y ${
                fieldErrors.descripcion
                  ? 'border-status-danger focus:ring-2 focus:ring-status-danger/20'
                  : 'border-border-light focus:border-brand-primary'
              }`}
            />
            {fieldErrors.descripcion && (
              <p className="mt-1 text-[12px] text-status-danger font-medium">
                {fieldErrors.descripcion}
              </p>
            )}
          </div>

          {formData.estado === 'Completado' && (
            <div>
              <label
                htmlFor="alert-fecha-completado"
                className="block text-[13px] font-semibold text-brand-slate mb-1.5"
              >
                Fecha de Completado{' '}
                <span className="text-brand-slate/50 font-normal">(Opcional)</span>
              </label>
              <input
                id="alert-fecha-completado"
                type="datetime-local"
                value={formData.fechaCompletado ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, fechaCompletado: e.target.value || null }));
                  clearFieldError('fechaCompletado');
                }}
                className="w-full h-[42px] px-3.5 bg-surface-white border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              />
            </div>
          )}

          {/* Botones */}
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
              disabled={isSubmitting}
              className="min-h-[42px] px-5 bg-brand-primary hover:bg-brand-dark text-white rounded-md text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Guardando...
                </>
              ) : (
                <>
                  <Save size={16} />
                  {isEditMode ? 'Guardar Cambios' : 'Guardar Recordatorio'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
