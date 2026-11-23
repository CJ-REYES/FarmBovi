import { useState, useEffect, useMemo, useRef, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertCircle,
  WifiOff,
  CheckCircle2,
  Info
} from 'lucide-react';
import { useSharedCattle } from '../../hooks/useCattle';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { CattleValidationError } from '../../services/cattle.service';
import {
  ANIMAL_FIELD_LIMITS,
  getTodayDateString,
  isExitAnimalState,
  normalizeAnimalEstado,
  normalizeAnimalSex,
  toDateInputValue,
  validateCattleInput,
  type CattleValidationErrors
} from '../../services/cattle.validation';
import {
  ANIMAL_ESTADOS,
  ANIMAL_PROCEDENCIAS_PREDEFINIDAS,
  ANIMAL_RAZAS_PREDEFINIDAS,
  ANIMAL_SEXOS,
  type AnimalEstado,
  type CattleInput,
  type CattleSex
} from '../../types/cattle';

const OTHER_BREED_VALUE = '__otra__';

function createInitialFormState(defaultRanchId = ''): CattleInput {
  return {
    idRancho: defaultRanchId,
    idLote: null,
    arete: '',
    raza: '',
    sexo: 'Hembra',
    fechaNacimiento: null,
    fechaIngreso: getTodayDateString(),
    procedencia: 'Propio',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null
  };
}

export default function CattleForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { cattle, ranches, lots, getById, create, update } = useSharedCattle();
  const { isOnline } = useSyncStatus();

  const isEditMode = Boolean(id);
  const submitLockRef = useRef<boolean>(false);

  const [formData, setFormData] = useState<CattleInput>(() =>
    createInitialFormState(ranches.length === 1 ? ranches[0].id : '')
  );
  const [selectedBreedOption, setSelectedBreedOption] = useState<string>('');
  const [customBreed, setCustomBreed] = useState<string>('');
  const [loadingRecord, setLoadingRecord] = useState<boolean>(isEditMode);
  const [recordNotFound, setRecordNotFound] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [fieldErrors, setFieldErrors] = useState<CattleValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const effectiveRanchId =
    formData.idRancho || (!isEditMode && ranches.length === 1 ? ranches[0].id : '');

  // En edición, cargar el animal directamente por GUID (soporta recarga directa de URL)
  useEffect(() => {
    if (!isEditMode || !id) return;

    let active = true;

    void (async () => {
      try {
        const record = await getById(id);
        if (!active) return;

        if (!record || record.deletedAt) {
          setRecordNotFound(true);
          return;
        }

        setRecordNotFound(false);
        const isPredefinedBreed = ANIMAL_RAZAS_PREDEFINIDAS.includes(record.raza);
        setSelectedBreedOption(isPredefinedBreed ? record.raza : OTHER_BREED_VALUE);
        setCustomBreed(isPredefinedBreed ? '' : record.raza);

        setFormData({
          idRancho: record.idRancho,
          idLote: record.idLote,
          arete: record.arete,
          raza: record.raza,
          sexo: normalizeAnimalSex(record.sexo),
          fechaNacimiento: toDateInputValue(record.fechaNacimiento) || null,
          fechaIngreso: toDateInputValue(record.fechaIngreso) || getTodayDateString(),
          procedencia: record.procedencia || 'Propio',
          estado: normalizeAnimalEstado(record.estado),
          fechaSalida: toDateInputValue(record.fechaSalida) || null,
          observaciones: record.observaciones ?? null
        });
      } catch (err) {
        if (!active) return;
        setFormError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el expediente del animal para edición.'
        );
      } finally {
        if (active) {
          setLoadingRecord(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [id, isEditMode, getById]);

  const availableLotsForRanch = useMemo(() => {
    if (!effectiveRanchId) return [];
    return lots.filter((lot) => lot.idRancho === effectiveRanchId);
  }, [lots, effectiveRanchId]);

  const clearFieldError = (field: keyof CattleValidationErrors) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleRanchChange = (e: ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    const nextRanchId = e.target.value;
    setFormData((prev) => {
      const lotStillValid =
        prev.idLote && lots.some((l) => l.id === prev.idLote && l.idRancho === nextRanchId);
      return {
        ...prev,
        idRancho: nextRanchId,
        idLote: lotStillValid ? prev.idLote : null
      };
    });
    clearFieldError('idRancho');
    clearFieldError('idLote');
  };

  const handleBreedSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedBreedOption(value);
    if (value === OTHER_BREED_VALUE) {
      setFormData((prev) => ({ ...prev, raza: customBreed }));
    } else {
      setCustomBreed('');
      setFormData((prev) => ({ ...prev, raza: value }));
    }
    clearFieldError('raza');
  };

  const handleCustomBreedChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomBreed(value);
    setFormData((prev) => ({ ...prev, raza: value }));
    clearFieldError('raza');
  };

  const handleEstadoChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const nextEstado = e.target.value as AnimalEstado;
    setFormData((prev) => ({
      ...prev,
      estado: nextEstado,
      fechaSalida: isExitAnimalState(nextEstado)
        ? prev.fechaSalida || getTodayDateString()
        : null
    }));
    clearFieldError('estado');
    clearFieldError('fechaSalida');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;

    setFormError(null);
    setSuccessMsg(null);

    const submissionData: CattleInput = {
      ...formData,
      idRancho: effectiveRanchId
    };

    const normalizedArete = submissionData.arete.trim().toLowerCase();
    const duplicateLocal = cattle.some(
      (item) =>
        !item.deletedAt &&
        item.id !== id &&
        item.idRancho === submissionData.idRancho.trim() &&
        item.arete.trim().toLowerCase() === normalizedArete
    );

    const validationErrors = validateCattleInput(submissionData, {
      ranches: ranches.length > 0 ? ranches : undefined,
      lots: lots.length > 0 ? lots : undefined,
      duplicateAreteExists: duplicateLocal
    });

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('Revisa los campos marcados antes de guardar el animal.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      const result =
        isEditMode && id ? await update(id, submissionData) : await create(submissionData);

      const confirmation = result.synced
        ? isEditMode
          ? `Animal ${result.animal.arete} actualizado y sincronizado con el servidor.`
          : `Animal ${result.animal.arete} registrado y sincronizado con el servidor.`
        : result.syncMessage ||
          `Animal ${result.animal.arete} guardado localmente. Pendiente de sincronización.`;

      setSuccessMsg(confirmation);
      navigate(`/cattle/${result.animal.id}`, {
        replace: true,
        state: { feedback: confirmation, synced: result.synced }
      });
    } catch (err) {
      if (err instanceof CattleValidationError) {
        setFieldErrors(err.fieldErrors);
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Ocurrió un error inesperado al guardar el animal.');
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (loadingRecord) {
    return (
      <div className="max-w-3xl mx-auto p-10 bg-surface-white border border-border-light rounded-xl text-center text-brand-slate/60 flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin text-brand-primary" />
        <p className="text-[14px] font-medium">Cargando expediente del animal…</p>
      </div>
    );
  }

  if (recordNotFound) {
    return (
      <div className="max-w-3xl mx-auto p-8 bg-surface-white border border-status-error/25 rounded-xl text-center space-y-4">
        <AlertCircle size={28} className="mx-auto text-status-error" />
        <div>
          <h1 className="text-xl font-bold text-brand-slate">Animal no encontrado</h1>
          <p className="text-[13px] text-brand-slate/65 mt-1">
            El expediente solicitado no existe o ya fue desactivado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/cattle')}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-md bg-brand-primary text-white text-[13px] font-semibold hover:bg-brand-dark"
        >
          <ArrowLeft size={16} /> Volver al inventario
        </button>
      </div>
    );
  }

  const today = getTodayDateString();
  const isExitState = isExitAnimalState(formData.estado);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-8 animate-in fade-in duration-300">
      <header className="flex items-center gap-4 border-b border-border-light pb-4">
        <button
          type="button"
          onClick={() => navigate('/cattle')}
          aria-label="Volver al inventario de animales"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-surface-white border border-border-light rounded-md text-brand-slate/70 hover:text-brand-primary transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            {isEditMode ? 'Edición de Expediente' : 'Nuevo Registro'}
          </span>
          <h1 className="text-2xl sm:text-3xl text-brand-forest font-bold font-condensed tracking-tight">
            {isEditMode ? 'Actualizar Animal' : 'Registrar Animal'}
          </h1>
        </div>
      </header>

      {!isOnline && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-status-warning/15 border border-status-warning/40 text-brand-dark text-[13px] flex items-start gap-2.5"
        >
          <WifiOff size={18} className="text-status-warning shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Modo sin conexión activo</p>
            <p className="text-[12px] text-brand-slate/80">
              El animal se guardará de forma segura en IndexedDB con identificador UUID estable y quedará en cola para sincronizarse al recuperar Internet.
            </p>
          </div>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="p-4 bg-status-error/10 border border-status-error/30 text-status-error text-[13px] font-semibold rounded-xl flex items-start gap-2.5"
        >
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          className="p-4 bg-status-success/10 border border-status-success/30 text-status-success text-[13px] font-semibold rounded-xl flex items-start gap-2.5"
        >
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden"
      >
        <div className="p-5 sm:p-6 space-y-6">
          {/* Sección 1: Rancho y Potrero / Lote */}
          <section className="space-y-4">
            <h2 className="text-[13px] font-bold text-brand-slate/70 uppercase tracking-wider border-b border-border-light pb-2">
              Ubicación y Pertenencia
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-rancho"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Rancho <span className="text-status-error">*</span>
                </label>

                {ranches.length > 0 ? (
                  <select
                    id="cattle-rancho"
                    name="idRancho"
                    required
                    disabled={isEditMode}
                    value={effectiveRanchId}
                    onChange={handleRanchChange}
                    aria-invalid={Boolean(fieldErrors.idRancho)}
                    className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">Selecciona un rancho</option>
                    {ranches.map((ranch) => (
                      <option key={ranch.id} value={ranch.id}>
                        {ranch.nombre} — {ranch.ubicacionGeneral}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-1.5">
                    <input
                      id="cattle-rancho"
                      type="text"
                      name="idRancho"
                      required
                      disabled={isEditMode}
                      value={effectiveRanchId}
                      onChange={handleRanchChange}
                      placeholder="UUID del rancho (ej. 22222222-2222-4222-8222-222222222222)"
                      aria-invalid={Boolean(fieldErrors.idRancho)}
                      className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[13px] font-mono text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none disabled:opacity-60"
                    />
                    <p className="text-[11px] text-brand-slate/60 flex items-start gap-1">
                      <Info size={13} className="shrink-0 mt-0.5 text-brand-primary" />
                      <span>
                        No hay catálogo de ranchos descargado todavía. Puedes ingresar el UUID del rancho para guardar offline.
                      </span>
                    </p>
                  </div>
                )}

                {isEditMode && (
                  <p className="text-[11px] text-brand-slate/55">
                    El rancho del expediente no puede modificarse después del alta.
                  </p>
                )}
                {fieldErrors.idRancho && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.idRancho}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-lote"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Potrero / Lote asignado (Opcional)
                </label>
                <select
                  id="cattle-lote"
                  name="idLote"
                  value={formData.idLote ?? ''}
                  disabled={!effectiveRanchId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData((prev) => ({ ...prev, idLote: val || null }));
                    clearFieldError('idLote');
                  }}
                  aria-invalid={Boolean(fieldErrors.idLote)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none disabled:opacity-60"
                >
                  <option value="">Sin potrero / lote asignado</option>
                  {availableLotsForRanch.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.nombre}
                      {lot.ubicacion ? ` (${lot.ubicacion})` : ''}
                    </option>
                  ))}
                </select>
                {effectiveRanchId && availableLotsForRanch.length === 0 && (
                  <p className="text-[11px] text-brand-slate/55">
                    No hay potreros o lotes activos cargados para este rancho.
                  </p>
                )}
                {fieldErrors.idLote && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.idLote}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Sección 2: Identificación y Características */}
          <section className="space-y-4">
            <h2 className="text-[13px] font-bold text-brand-slate/70 uppercase tracking-wider border-b border-border-light pb-2">
              Identificación del Animal
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-arete"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Arete / Identificación <span className="text-status-error">*</span>
                </label>
                <input
                  id="cattle-arete"
                  type="text"
                  name="arete"
                  required
                  maxLength={ANIMAL_FIELD_LIMITS.areteMax}
                  value={formData.arete}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, arete: e.target.value }));
                    clearFieldError('arete');
                  }}
                  placeholder="Ej. MX-0842"
                  aria-invalid={Boolean(fieldErrors.arete)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                />
                <p className="text-[11px] text-brand-slate/55">
                  Debe ser único dentro del mismo rancho (máx. {ANIMAL_FIELD_LIMITS.areteMax} caracteres).
                </p>
                {fieldErrors.arete && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.arete}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-sexo"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Sexo <span className="text-status-error">*</span>
                </label>
                <select
                  id="cattle-sexo"
                  name="sexo"
                  required
                  value={formData.sexo}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, sexo: e.target.value as CattleSex }));
                    clearFieldError('sexo');
                  }}
                  aria-invalid={Boolean(fieldErrors.sexo)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                >
                  {ANIMAL_SEXOS.map((sexo) => (
                    <option key={sexo} value={sexo}>
                      {sexo}
                    </option>
                  ))}
                </select>
                {fieldErrors.sexo && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.sexo}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-raza-select"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Raza <span className="text-status-error">*</span>
                </label>
                <select
                  id="cattle-raza-select"
                  name="razaSelect"
                  required
                  value={selectedBreedOption}
                  onChange={handleBreedSelectChange}
                  aria-invalid={Boolean(fieldErrors.raza)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                >
                  <option value="">Selecciona una raza</option>
                  {ANIMAL_RAZAS_PREDEFINIDAS.map((breed) => (
                    <option key={breed} value={breed}>
                      {breed}
                    </option>
                  ))}
                  <option value={OTHER_BREED_VALUE}>Otra raza…</option>
                </select>

                {selectedBreedOption === OTHER_BREED_VALUE && (
                  <input
                    id="cattle-raza-custom"
                    type="text"
                    name="razaCustom"
                    required
                    maxLength={ANIMAL_FIELD_LIMITS.razaMax}
                    value={customBreed}
                    onChange={handleCustomBreedChange}
                    placeholder="Especifica la raza"
                    aria-label="Especificar otra raza"
                    className="w-full min-h-[44px] px-3 mt-2 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                  />
                )}

                {fieldErrors.raza && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.raza}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-procedencia"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Procedencia <span className="text-status-error">*</span>
                </label>
                <input
                  id="cattle-procedencia"
                  type="text"
                  name="procedencia"
                  list="cattle-procedencia-list"
                  required
                  maxLength={ANIMAL_FIELD_LIMITS.procedenciaMax}
                  value={formData.procedencia}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, procedencia: e.target.value }));
                    clearFieldError('procedencia');
                  }}
                  placeholder="Ej. Propio, Compra, Traslado…"
                  aria-invalid={Boolean(fieldErrors.procedencia)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                />
                <datalist id="cattle-procedencia-list">
                  {ANIMAL_PROCEDENCIAS_PREDEFINIDAS.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                {fieldErrors.procedencia && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.procedencia}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Sección 3: Fechas y Estado Operativo */}
          <section className="space-y-4">
            <h2 className="text-[13px] font-bold text-brand-slate/70 uppercase tracking-wider border-b border-border-light pb-2">
              Fechas y Estado Operativo
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-fecha-nacimiento"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Fecha de Nacimiento (Opcional)
                </label>
                <input
                  id="cattle-fecha-nacimiento"
                  type="date"
                  name="fechaNacimiento"
                  max={today}
                  value={formData.fechaNacimiento ?? ''}
                  onChange={(e) => {
                    setFormData((prev) => ({
                      ...prev,
                      fechaNacimiento: e.target.value || null
                    }));
                    clearFieldError('fechaNacimiento');
                    clearFieldError('fechaIngreso');
                  }}
                  aria-invalid={Boolean(fieldErrors.fechaNacimiento)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                />
                {fieldErrors.fechaNacimiento && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.fechaNacimiento}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-fecha-ingreso"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Fecha de Ingreso <span className="text-status-error">*</span>
                </label>
                <input
                  id="cattle-fecha-ingreso"
                  type="date"
                  name="fechaIngreso"
                  required
                  max={today}
                  value={formData.fechaIngreso}
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, fechaIngreso: e.target.value }));
                    clearFieldError('fechaIngreso');
                    clearFieldError('fechaSalida');
                  }}
                  aria-invalid={Boolean(fieldErrors.fechaIngreso)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                />
                {fieldErrors.fechaIngreso && (
                  <p role="alert" className="text-[12px] text-status-error font-medium">
                    {fieldErrors.fechaIngreso}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="cattle-estado"
                  className="block text-[13px] font-semibold text-brand-slate"
                >
                  Estado <span className="text-status-error">*</span>
                </label>
                <select
                  id="cattle-estado"
                  name="estado"
                  required
                  value={formData.estado}
                  onChange={handleEstadoChange}
                  aria-invalid={Boolean(fieldErrors.estado)}
                  className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                >
                  {ANIMAL_ESTADOS.map((estado) => (
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

              {isExitState && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="cattle-fecha-salida"
                    className="block text-[13px] font-semibold text-brand-slate"
                  >
                    Fecha de Salida <span className="text-status-error">*</span>
                  </label>
                  <input
                    id="cattle-fecha-salida"
                    type="date"
                    name="fechaSalida"
                    required
                    max={today}
                    value={formData.fechaSalida ?? ''}
                    onChange={(e) => {
                      setFormData((prev) => ({
                        ...prev,
                        fechaSalida: e.target.value || null
                      }));
                      clearFieldError('fechaSalida');
                    }}
                    aria-invalid={Boolean(fieldErrors.fechaSalida)}
                    className="w-full min-h-[44px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                  />
                  {fieldErrors.fechaSalida && (
                    <p role="alert" className="text-[12px] text-status-error font-medium">
                      {fieldErrors.fechaSalida}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="cattle-observaciones"
                className="block text-[13px] font-semibold text-brand-slate"
              >
                Observaciones (Opcional)
              </label>
              <textarea
                id="cattle-observaciones"
                name="observaciones"
                rows={3}
                maxLength={ANIMAL_FIELD_LIMITS.observacionesMax}
                value={formData.observaciones ?? ''}
                onChange={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    observaciones: e.target.value || null
                  }));
                  clearFieldError('observaciones');
                }}
                placeholder="Señas particulares, historial inicial o notas operativas…"
                aria-invalid={Boolean(fieldErrors.observaciones)}
                className="w-full p-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none resize-y"
              />
              {fieldErrors.observaciones && (
                <p role="alert" className="text-[12px] text-status-error font-medium">
                  {fieldErrors.observaciones}
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="bg-surface-secondary/30 border-t border-border-light p-4 flex flex-col-reverse sm:flex-row justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/cattle')}
            disabled={isSubmitting}
            className="min-h-[44px] px-5 text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary rounded-md transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[44px] flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-6 rounded-md font-semibold text-[13px] transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isSubmitting
              ? 'Guardando…'
              : isEditMode
                ? 'Guardar Cambios'
                : 'Registrar Animal'}
          </button>
        </div>
      </form>
    </div>
  );
}
