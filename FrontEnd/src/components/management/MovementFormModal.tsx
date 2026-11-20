import { useState, useRef, useMemo, type FormEvent } from 'react';
import { AlertCircle, Info, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { Cattle, LotOption } from '../../types/cattle';
import {
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  type Movement,
  type MovementInput,
  type MovementType
} from '../../types/movement';
import {
  MOVEMENT_FIELD_LIMITS,
  validateMovementInput,
  type MovementValidationErrors
} from '../../services/movement.validation';
import {
  MovementValidationError,
  type MovementMutationResult
} from '../../services/movement.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface MovementFormModalProps {
  mode: 'create' | 'edit';
  initialMovement?: Movement;
  preselectedAnimalId?: string;
  animals: Cattle[];
  lots: LotOption[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: MovementInput) => Promise<MovementMutationResult>;
}

function toDatetimeLocalValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) {
    return toDatetimeLocalValue();
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getMovementTypeHelp(tipo: MovementType): string {
  switch (tipo) {
    case 'CambioInterno':
      return 'Mueve el animal entre potreros del mismo rancho y actualiza su potrero actual.';
    case 'Alta':
      return 'Registra el ingreso del animal al rancho o a un potrero inicial.';
    case 'Traslado':
      return 'Registra traslado hacia otro potrero o destino externo (p. ej. otro rancho o feria).';
    case 'Venta':
      return 'Registra la salida comercial del animal y actualiza su estado a Vendido.';
    case 'Baja':
      return 'Registra baja o descarte y actualiza el estado del animal a Baja.';
  }
}

export default function MovementFormModal({
  mode,
  initialMovement,
  preselectedAnimalId,
  animals,
  lots,
  isOnline,
  onClose,
  onSubmit
}: MovementFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialMovement);
  const submitLockRef = useRef<boolean>(false);

  const [formData, setFormData] = useState<MovementInput>(() => {
    if (initialMovement) {
      return {
        idAnimal: initialMovement.idAnimal,
        tipo: initialMovement.tipo,
        fecha: toDatetimeLocalValue(initialMovement.fecha),
        idLoteOrigen: initialMovement.idLoteOrigen,
        idLoteDestino: initialMovement.idLoteDestino,
        origenExterno: initialMovement.origenExterno,
        destinoExterno: initialMovement.destinoExterno,
        motivo: initialMovement.motivo
      };
    }

    const defaultAnimal = preselectedAnimalId
      ? animals.find((a) => a.id === preselectedAnimalId && !a.deletedAt)
      : undefined;

    return {
      idAnimal: defaultAnimal?.id || '',
      tipo: 'CambioInterno',
      fecha: toDatetimeLocalValue(),
      idLoteOrigen: defaultAnimal?.idLote ?? null,
      idLoteDestino: null,
      origenExterno: null,
      destinoExterno: null,
      motivo: null
    };
  });

  const [fieldErrors, setFieldErrors] = useState<MovementValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const selectedAnimal = useMemo(
    () => animals.find((a) => a.id === formData.idAnimal),
    [animals, formData.idAnimal]
  );

  // Potreros disponibles del mismo rancho del animal (para Alta / CambioInterno / Origen)
  const sameRanchLots = useMemo(() => {
    if (!selectedAnimal?.idRancho) return lots;
    return lots.filter((l) => !l.idRancho || l.idRancho === selectedAnimal.idRancho);
  }, [lots, selectedAnimal]);

  const lotNameById = useMemo(() => new Map(lots.map((l) => [l.id, l.nombre])), [lots]);

  const animalOptions = useMemo(
    () =>
      animals.map((animal) => {
        const lotLabel = animal.idLote
          ? lotNameById.get(animal.idLote) || 'Potrero asignado'
          : 'Sin potrero';
        return {
          id: animal.id,
          arete: animal.arete,
          raza: animal.raza,
          extraLabel: `(${lotLabel} · ${animal.estado})`
        };
      }),
    [animals, lotNameById]
  );

  const clearFieldError = (field: keyof MovementValidationErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleAnimalChange = (nextAnimalId: string) => {
    const nextAnimal = animals.find((a) => a.id === nextAnimalId);
    setFormData((prev) => ({
      ...prev,
      idAnimal: nextAnimalId,
      // Preseleccionar automáticamente el potrero actual del animal como origen si aplica
      idLoteOrigen: prev.tipo === 'Alta' ? null : (nextAnimal?.idLote ?? null),
      idLoteDestino:
        prev.idLoteDestino && nextAnimal?.idLote === prev.idLoteDestino
          ? null
          : prev.idLoteDestino
    }));
    clearFieldError('idAnimal');
    clearFieldError('idLoteOrigen');
    clearFieldError('idLoteDestino');
  };

  const handleTipoChange = (nextTipo: MovementType) => {
    setFormData((prev) => ({
      ...prev,
      tipo: nextTipo,
      idLoteOrigen:
        nextTipo === 'Alta' ? null : (prev.idLoteOrigen ?? selectedAnimal?.idLote ?? null),
      idLoteDestino:
        nextTipo === 'Venta' || nextTipo === 'Baja' ? null : prev.idLoteDestino,
      origenExterno: nextTipo === 'Alta' || nextTipo === 'Traslado' ? prev.origenExterno : null,
      destinoExterno:
        nextTipo === 'Traslado' || nextTipo === 'Venta' ? prev.destinoExterno : null
    }));
    setFieldErrors({});
    setFormError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setFormError(null);
    const validationErrors = validateMovementInput(formData, {
      animals,
      lots,
      isEditMode
    });

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el movimiento.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(formData);
      onClose();
    } catch (err) {
      if (err instanceof MovementValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el movimiento.');
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const showInternalOrigin = formData.tipo !== 'Alta';
  const showExternalOrigin = formData.tipo === 'Alta' || formData.tipo === 'Traslado';
  const showInternalDestination =
    formData.tipo === 'CambioInterno' ||
    formData.tipo === 'Alta' ||
    formData.tipo === 'Traslado';
  const showExternalDestination = formData.tipo === 'Traslado' || formData.tipo === 'Venta';

  const destinationLots = formData.tipo === 'Traslado' ? lots : sameRanchLots;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="movement-form-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-light flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">
              {isEditMode ? 'Edición de Movimiento' : 'Nuevo Registro de Trazabilidad'}
            </span>
            <h2 id="movement-form-modal-title" className="text-[18px] font-bold text-brand-forest">
              {isEditMode ? 'Actualizar Movimiento de Animal' : 'Registrar Movimiento de Animal'}
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
                Modo sin conexión: el movimiento se guardará localmente en IndexedDB y se encolará para sincronizarse al reconectar.
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
              id="movement-animal"
              name="idAnimal"
              label="Animal"
              required
              disabled={isEditMode}
              value={formData.idAnimal}
              options={animalOptions}
              placeholder="Selecciona un animal"
              helperText={
                isEditMode
                  ? 'El animal asociado no se cambia después de registrar el movimiento.'
                  : undefined
              }
              error={fieldErrors.idAnimal}
              onChange={handleAnimalChange}
            />

            <div className="space-y-1.5">
              <label
                htmlFor="movement-tipo"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Tipo de Movimiento <span className="text-status-error">*</span>
              </label>
              <select
                id="movement-tipo"
                name="tipo"
                required
                value={formData.tipo}
                onChange={(e) => handleTipoChange(e.target.value as MovementType)}
                aria-invalid={Boolean(fieldErrors.tipo)}
                className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              >
                {MOVEMENT_TYPES.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {MOVEMENT_TYPE_LABELS[tipo]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-brand-slate/60 flex items-start gap-1">
                <Info size={13} className="shrink-0 mt-0.5 text-brand-primary" />
                <span>{getMovementTypeHelp(formData.tipo)}</span>
              </p>
              {fieldErrors.tipo && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.tipo}
                </p>
              )}
            </div>
          </div>

          {/* Fecha */}
          <div className="space-y-1.5">
            <label
              htmlFor="movement-fecha"
              className="block text-[13px] font-semibold text-brand-slate"
            >
              Fecha y Hora del Movimiento <span className="text-status-error">*</span>
            </label>
            <input
              id="movement-fecha"
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

          {/* Origen y Destino */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border-light/70">
            {showInternalOrigin && (
              <div className="space-y-1.5">
                <label
                  htmlFor="movement-origen-lote"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Potrero de Origen
                </label>
                <select
                  id="movement-origen-lote"
                  name="idLoteOrigen"
                  value={formData.idLoteOrigen ?? ''}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      idLoteOrigen: e.target.value || null
                    }));
                    clearFieldError('idLoteOrigen');
                    clearFieldError('idLoteDestino');
                  }}
                  aria-invalid={Boolean(fieldErrors.idLoteOrigen)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                >
                  <option value="">Sin potrero de origen</option>
                  {sameRanchLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.nombre}
                      {lot.ubicacion ? ` — ${lot.ubicacion}` : ''}
                    </option>
                  ))}
                </select>
                {fieldErrors.idLoteOrigen && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.idLoteOrigen}
                  </p>
                )}
              </div>
            )}

            {showExternalOrigin && (
              <div className="space-y-1.5">
                <label
                  htmlFor="movement-origen-externo"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Origen Externo {formData.tipo === 'Alta' ? '(Rancho / Proveedor)' : '(Opcional)'}
                </label>
                <input
                  id="movement-origen-externo"
                  type="text"
                  name="origenExterno"
                  maxLength={MOVEMENT_FIELD_LIMITS.origenExternoMax}
                  value={formData.origenExterno ?? ''}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      origenExterno: e.target.value || null
                    }));
                    clearFieldError('origenExterno');
                    clearFieldError('idLoteDestino');
                  }}
                  placeholder="Ej. Ganadería San Pedro, Subasta Regional"
                  aria-invalid={Boolean(fieldErrors.origenExterno)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                />
                {fieldErrors.origenExterno && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.origenExterno}
                  </p>
                )}
              </div>
            )}

            {showInternalDestination && (
              <div className="space-y-1.5">
                <label
                  htmlFor="movement-destino-lote"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Potrero de Destino{' '}
                  {formData.tipo === 'CambioInterno' && <span className="text-status-error">*</span>}
                </label>
                <select
                  id="movement-destino-lote"
                  name="idLoteDestino"
                  required={formData.tipo === 'CambioInterno'}
                  value={formData.idLoteDestino ?? ''}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      idLoteDestino: e.target.value || null
                    }));
                    clearFieldError('idLoteDestino');
                    clearFieldError('destinoExterno');
                  }}
                  aria-invalid={Boolean(fieldErrors.idLoteDestino)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                >
                  <option value="">Selecciona potrero de destino</option>
                  {destinationLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.nombre}
                      {lot.ubicacion ? ` — ${lot.ubicacion}` : ''}
                    </option>
                  ))}
                </select>
                {fieldErrors.idLoteDestino && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.idLoteDestino}
                  </p>
                )}
              </div>
            )}

            {showExternalDestination && (
              <div className="space-y-1.5">
                <label
                  htmlFor="movement-destino-externo"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Destino Externo{' '}
                  {formData.tipo === 'Venta' ? '(Comprador / Rastro)' : '(Otro Rancho / Lugar)'}
                </label>
                <input
                  id="movement-destino-externo"
                  type="text"
                  name="destinoExterno"
                  maxLength={MOVEMENT_FIELD_LIMITS.destinoExternoMax}
                  value={formData.destinoExterno ?? ''}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      destinoExterno: e.target.value || null
                    }));
                    clearFieldError('destinoExterno');
                  }}
                  placeholder={
                    formData.tipo === 'Venta'
                      ? 'Ej. Frigorífico del Sureste / Comprador Juan Pérez'
                      : 'Ej. Rancho Anexo El Palmar'
                  }
                  aria-invalid={Boolean(fieldErrors.destinoExterno)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                />
                {fieldErrors.destinoExterno && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.destinoExterno}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Motivo / Observaciones */}
          <div className="space-y-1.5">
            <label
              htmlFor="movement-motivo"
              className="block text-[13px] font-semibold text-brand-slate"
            >
              Motivo / Observaciones{' '}
              {formData.tipo === 'Baja' && <span className="text-status-error">*</span>}
            </label>
            <textarea
              id="movement-motivo"
              name="motivo"
              rows={3}
              maxLength={MOVEMENT_FIELD_LIMITS.motivoMax}
              value={formData.motivo ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, motivo: e.target.value || null }));
                clearFieldError('motivo');
                clearFieldError('destinoExterno');
              }}
              placeholder="Ej. Rotación de pastoreo por descanso de pradera, guía de movilización, causa de baja…"
              aria-invalid={Boolean(fieldErrors.motivo)}
              className="w-full px-3 py-2.5 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary resize-y"
            />
            {fieldErrors.motivo && (
              <p role="alert" className="text-[12px] text-status-error font-medium">
                {fieldErrors.motivo}
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
                  : 'Registrar Movimiento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
