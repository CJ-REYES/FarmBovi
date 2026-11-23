import { useState, useRef, type FormEvent } from 'react';
import { AlertCircle, Info, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { RanchOption } from '../../types/cattle';
import { LOT_ESTADOS, type Lot, type LotEstado, type LotInput } from '../../types/lot';
import {
  LOT_FIELD_LIMITS,
  validateLotInput,
  type LotValidationErrors
} from '../../services/lot.validation';
import { LotValidationError, type LotMutationResult } from '../../services/lot.service';

export interface LotFormModalProps {
  mode: 'create' | 'edit';
  initialLot?: Lot;
  ranches: RanchOption[];
  existingLots: Lot[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: LotInput) => Promise<LotMutationResult>;
}

export default function LotFormModal({
  mode,
  initialLot,
  ranches,
  existingLots,
  isOnline,
  onClose,
  onSubmit
}: LotFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialLot);
  const submitLockRef = useRef<boolean>(false);

  const [formData, setFormData] = useState<LotInput>(() => ({
    idRancho: initialLot?.idRancho || (ranches.length === 1 ? ranches[0].id : ''),
    nombre: initialLot?.nombre || '',
    ubicacion: initialLot?.ubicacion ?? null,
    estado: initialLot?.estado || 'Activo'
  }));
  const [fieldErrors, setFieldErrors] = useState<LotValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const effectiveRanchId =
    formData.idRancho || (!isEditMode && ranches.length === 1 ? ranches[0].id : '');

  const clearFieldError = (field: keyof LotValidationErrors) => {
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
    const submissionData: LotInput = {
      ...formData,
      idRancho: effectiveRanchId
    };

    const normalizedName = submissionData.nombre.trim().toLowerCase();
    const duplicateLocal = existingLots.some(
      (item) =>
        !item.deletedAt &&
        item.id !== initialLot?.id &&
        item.idRancho === submissionData.idRancho.trim() &&
        item.nombre.trim().toLowerCase() === normalizedName
    );

    const validationErrors = validateLotInput(submissionData, {
      ranches: ranches.length > 0 ? ranches : undefined,
      duplicateNameExists: duplicateLocal
    });

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el potrero.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(submissionData);
      onClose();
    } catch (err) {
      if (err instanceof LotValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el potrero.');
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
      aria-labelledby="lot-form-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              {isEditMode ? 'Edición de Potrero / Lote' : 'Nuevo Potrero / Lote'}
            </span>
            <h2 id="lot-form-modal-title" className="text-[18px] font-bold text-brand-forest">
              {isEditMode ? `Actualizar ${initialLot?.nombre}` : 'Registrar Potrero / Lote'}
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
                Modo sin conexión: el potrero se guardará en IndexedDB con UUID estable y se sincronizará al reconectar.
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

          {/* Rancho */}
          <div className="space-y-1.5">
            <label htmlFor="lot-rancho" className="block text-[13px] font-semibold text-brand-slate">
              Rancho <span className="text-status-error">*</span>
            </label>

            {ranches.length > 0 ? (
              <select
                id="lot-rancho"
                name="idRancho"
                required
                disabled={isEditMode}
                value={effectiveRanchId}
                onChange={(e) => {
                  setFormData((prev) => ({ ...prev, idRancho: e.target.value }));
                  clearFieldError('idRancho');
                }}
                aria-invalid={Boolean(fieldErrors.idRancho)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="">Selecciona un rancho</option>
                {ranches.map((ranch) => (
                  <option key={ranch.id} value={ranch.id}>
                    {ranch.nombre} — {ranch.ubicacionGeneral}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-1">
                <input
                  id="lot-rancho"
                  type="text"
                  name="idRancho"
                  required
                  disabled={isEditMode}
                  value={effectiveRanchId}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, idRancho: e.target.value }));
                    clearFieldError('idRancho');
                  }}
                  placeholder="UUID del rancho (ej. 22222222-2222-4222-8222-222222222222)"
                  aria-invalid={Boolean(fieldErrors.idRancho)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] font-mono text-brand-slate outline-none focus:border-brand-primary disabled:opacity-60"
                />
                <p className="text-[11px] text-brand-slate/60 flex items-start gap-1">
                  <Info size={13} className="shrink-0 mt-0.5 text-brand-primary" />
                  <span>
                    Sin catálogo de ranchos descargado todavía. Puedes indicar el UUID del rancho para guardar offline.
                  </span>
                </p>
              </div>
            )}

            {isEditMode && (
              <p className="text-[11px] text-brand-slate/55">
                El rancho de pertenencia no se modifica después de crear el potrero.
              </p>
            )}
            {fieldErrors.idRancho && (
              <p role="alert" className="text-[12px] text-status-error font-medium">
                {fieldErrors.idRancho}
              </p>
            )}
          </div>

          {/* Nombre */}
          <div className="space-y-1.5">
            <label htmlFor="lot-nombre" className="block text-[13px] font-semibold text-brand-slate">
              Nombre del Potrero / Lote <span className="text-status-error">*</span>
            </label>
            <input
              id="lot-nombre"
              type="text"
              name="nombre"
              required
              maxLength={LOT_FIELD_LIMITS.nombreMax}
              value={formData.nombre}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, nombre: e.target.value }));
                clearFieldError('nombre');
              }}
              placeholder="Ej. Potrero La Ceiba"
              aria-invalid={Boolean(fieldErrors.nombre)}
              className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
            />
            <p className="text-[11px] text-brand-slate/55">
              Debe ser único dentro del mismo rancho (máx. {LOT_FIELD_LIMITS.nombreMax} caracteres).
            </p>
            {fieldErrors.nombre && (
              <p role="alert" className="text-[12px] text-status-error font-medium">
                {fieldErrors.nombre}
              </p>
            )}
          </div>

          {/* Ubicación */}
          <div className="space-y-1.5">
            <label
              htmlFor="lot-ubicacion"
              className="block text-[13px] font-semibold text-brand-slate"
            >
              Ubicación / Referencia (Opcional)
            </label>
            <input
              id="lot-ubicacion"
              type="text"
              name="ubicacion"
              maxLength={LOT_FIELD_LIMITS.ubicacionMax}
              value={formData.ubicacion ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, ubicacion: e.target.value || null }));
                clearFieldError('ubicacion');
              }}
              placeholder="Ej. Sector Norte, junto al jagüey principal"
              aria-invalid={Boolean(fieldErrors.ubicacion)}
              className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
            />
            {fieldErrors.ubicacion && (
              <p role="alert" className="text-[12px] text-status-error font-medium">
                {fieldErrors.ubicacion}
              </p>
            )}
          </div>

          {/* Estado */}
          <div className="space-y-1.5">
            <label htmlFor="lot-estado" className="block text-[13px] font-semibold text-brand-slate">
              Estado <span className="text-status-error">*</span>
            </label>
            <select
              id="lot-estado"
              name="estado"
              required
              value={formData.estado}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, estado: e.target.value as LotEstado }));
                clearFieldError('estado');
              }}
              aria-invalid={Boolean(fieldErrors.estado)}
              className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
            >
              {LOT_ESTADOS.map((estado) => (
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
                  : 'Crear Potrero'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
