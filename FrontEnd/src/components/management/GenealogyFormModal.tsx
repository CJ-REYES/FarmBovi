import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Save, WifiOff, X } from 'lucide-react';
import type { Cattle } from '../../types/cattle';
import type { GenealogyInput, GenealogyRecord } from '../../types/genealogy';
import {
  GENEALOGY_MAX_OBSERVACIONES_LENGTH,
  isValidFatherSex,
  isValidMotherSex,
  validateGenealogyInput,
  type GenealogyValidationErrors
} from '../../services/genealogy.validation';
import {
  GenealogyValidationError,
  type GenealogyMutationResult
} from '../../services/genealogy.service';
import AnimalSelectField from '../shared/AnimalSelectField';

export interface GenealogyFormModalProps {
  mode: 'create' | 'edit';
  initialRecord?: GenealogyRecord;
  preselectedAnimalId?: string;
  animals: Cattle[];
  existingRecords: GenealogyRecord[];
  isOnline: boolean;
  onClose: () => void;
  onSubmit: (input: GenealogyInput) => Promise<GenealogyMutationResult>;
}

export default function GenealogyFormModal({
  mode,
  initialRecord,
  preselectedAnimalId,
  animals,
  existingRecords,
  isOnline,
  onClose,
  onSubmit
}: GenealogyFormModalProps) {
  const isEditMode = mode === 'edit' && Boolean(initialRecord);
  const submitLockRef = useRef<boolean>(false);

  const [formData, setFormData] = useState<GenealogyInput>(() => {
    if (initialRecord) {
      return {
        idAnimal: initialRecord.idAnimal,
        idPadre: initialRecord.idPadre,
        idMadre: initialRecord.idMadre,
        observaciones: initialRecord.observaciones ?? ''
      };
    }

    return {
      idAnimal: preselectedAnimalId || '',
      idPadre: null,
      idMadre: null,
      observaciones: ''
    };
  });

  const [fieldErrors, setFieldErrors] = useState<GenealogyValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const selectedChildRanchId = useMemo(
    () => animals.find((a) => a.id === formData.idAnimal)?.idRancho || null,
    [animals, formData.idAnimal]
  );

  const activeRecordsByAnimal = useMemo(() => {
    const set = new Set<string>();
    for (const r of existingRecords) {
      if (!r.deletedAt) set.add(r.idAnimal);
    }
    return set;
  }, [existingRecords]);

  const childOptions = useMemo(
    () =>
      animals.map((a) => ({
        id: a.id,
        arete: a.arete,
        raza: a.raza,
        extraLabel: activeRecordsByAnimal.has(a.id)
          ? `(${a.sexo} · Ya registrado)`
          : `(${a.sexo} · ${a.estado})`
      })),
    [animals, activeRecordsByAnimal]
  );

  // Candidatos a padre: mismo rancho, excluye al propio animal y prioriza machos (o sexo desconocido)
  const fatherOptions = useMemo(
    () =>
      animals
        .filter(
          (a) =>
            a.id !== formData.idAnimal &&
            (!selectedChildRanchId || !a.idRancho || a.idRancho === selectedChildRanchId || a.id === formData.idPadre) &&
            (isValidFatherSex(a.sexo) || a.id === formData.idPadre)
        )
        .map((a) => ({
          id: a.id,
          arete: a.arete,
          raza: a.raza,
          extraLabel: `(${a.sexo} · ${a.estado})`
        })),
    [animals, formData.idAnimal, formData.idPadre, selectedChildRanchId]
  );

  // Candidatos a madre: mismo rancho, excluye al propio animal y prioriza hembras (o sexo desconocido)
  const motherOptions = useMemo(
    () =>
      animals
        .filter(
          (a) =>
            a.id !== formData.idAnimal &&
            (!selectedChildRanchId || !a.idRancho || a.idRancho === selectedChildRanchId || a.id === formData.idMadre) &&
            (isValidMotherSex(a.sexo) || a.id === formData.idMadre)
        )
        .map((a) => ({
          id: a.id,
          arete: a.arete,
          raza: a.raza,
          extraLabel: `(${a.sexo} · ${a.estado})`
        })),
    [animals, formData.idAnimal, formData.idMadre, selectedChildRanchId]
  );

  const clearFieldError = (field: keyof GenealogyValidationErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field] && !prev.general) return prev;
      const next = { ...prev };
      delete next[field];
      delete next.general;
      return next;
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setFormError(null);

    const validationErrors = validateGenealogyInput(formData, {
      animals,
      existingRecords,
      editingRecordId: initialRecord?.id
    });

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError(
        validationErrors.general ||
          'Revisa los campos marcados antes de guardar el parentesco.'
      );
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      await onSubmit(formData);
      onClose();
    } catch (err) {
      if (err instanceof GenealogyValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el parentesco.');
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
      aria-labelledby="genealogy-modal-title"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        className="bg-surface-white border border-border-light rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border-light flex items-center justify-between bg-surface-app/40 sticky top-0 z-10">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-slate/60">
              {isEditMode ? 'Edición de Parentesco' : 'Nuevo Vínculo Genealógico'}
            </p>
            <h2
              id="genealogy-modal-title"
              className="text-xl font-condensed font-bold text-brand-forest"
            >
              {isEditMode ? 'Editar Padre y Madre' : 'Registrar Parentesco'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar formulario de parentesco"
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
                Modo sin conexión: el parentesco se guardará localmente en IndexedDB y quedará en
                cola pendiente hasta recuperar conectividad.
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

          {/* Animal focal */}
          <div>
            <AnimalSelectField
              id="gen-animal"
              label="Animal (Cría / Ejemplar)"
              required
              options={childOptions}
              value={formData.idAnimal}
              disabled={isEditMode}
              onChange={(animalId) => {
                setFormData((prev) => ({
                  ...prev,
                  idAnimal: animalId,
                  idPadre: prev.idPadre === animalId ? null : prev.idPadre,
                  idMadre: prev.idMadre === animalId ? null : prev.idMadre
                }));
                clearFieldError('idAnimal');
              }}
              error={fieldErrors.idAnimal}
              placeholder="Selecciona el animal por arete"
              searchPlaceholder="Buscar animal por arete o raza..."
              helperText={
                isEditMode
                  ? 'El ejemplar del registro no se modifica al editar para evitar duplicados.'
                  : 'Cada animal admite un único registro de parentesco activo.'
              }
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Padre (Macho) */}
            <div className="space-y-1.5">
              <AnimalSelectField
                id="gen-padre"
                label="Padre (Semental)"
                options={fatherOptions}
                value={formData.idPadre ?? ''}
                onChange={(padreId) => {
                  setFormData((prev) => ({ ...prev, idPadre: padreId || null }));
                  clearFieldError('idPadre');
                }}
                error={fieldErrors.idPadre}
                placeholder="Sin padre seleccionado"
                searchPlaceholder="Buscar padre (Macho) por arete..."
                helperText="Opcional. Solo sementales (Macho) del mismo rancho."
              />
              {formData.idPadre && (
                <button
                  type="button"
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, idPadre: null }));
                    clearFieldError('idPadre');
                  }}
                  className="text-[11px] font-semibold text-brand-slate/70 hover:text-status-danger"
                >
                  Quitar padre seleccionado
                </button>
              )}
            </div>

            {/* Madre (Hembra) */}
            <div className="space-y-1.5">
              <AnimalSelectField
                id="gen-madre"
                label="Madre (Vientre)"
                options={motherOptions}
                value={formData.idMadre ?? ''}
                onChange={(madreId) => {
                  setFormData((prev) => ({ ...prev, idMadre: madreId || null }));
                  clearFieldError('idMadre');
                }}
                error={fieldErrors.idMadre}
                placeholder="Sin madre seleccionada"
                searchPlaceholder="Buscar madre (Hembra) por arete..."
                helperText="Opcional. Solo vientres (Hembra) del mismo rancho."
              />
              {formData.idMadre && (
                <button
                  type="button"
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, idMadre: null }));
                    clearFieldError('idMadre');
                  }}
                  className="text-[11px] font-semibold text-brand-slate/70 hover:text-status-danger"
                >
                  Quitar madre seleccionada
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="gen-observaciones"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Observaciones (opcional)
              </label>
              <span className="text-[11px] text-brand-slate/60">
                {(formData.observaciones ?? '').length}/{GENEALOGY_MAX_OBSERVACIONES_LENGTH}
              </span>
            </div>
            <textarea
              id="gen-observaciones"
              rows={2}
              maxLength={GENEALOGY_MAX_OBSERVACIONES_LENGTH}
              value={formData.observaciones ?? ''}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, observaciones: e.target.value }));
                clearFieldError('observaciones');
              }}
              placeholder="Ej. Inseminación artificial, empadre controlado, línea lechera..."
              className="w-full px-3 py-2 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary resize-none"
            />
            {fieldErrors.observaciones && (
              <p className="text-[12px] text-status-danger font-medium">
                {fieldErrors.observaciones}
              </p>
            )}
          </div>

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
              className="min-h-[42px] px-5 bg-brand-primary hover:bg-brand-dark text-white rounded-md text-[13px] font-semibold inline-flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Guardando...
                </>
              ) : (
                <>
                  <Save size={16} />
                  {isEditMode ? 'Guardar Cambios' : 'Guardar Parentesco'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
