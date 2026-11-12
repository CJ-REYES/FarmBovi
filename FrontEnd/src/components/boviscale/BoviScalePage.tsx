import { useState, useEffect, useMemo, useRef, type ChangeEvent, type FormEvent } from 'react';
import {
  Camera,
  Upload,
  WifiOff,
  Clock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Eye,
  Trash2,
  Scale,
  CloudUpload,
  CloudCheck
} from 'lucide-react';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import { useConnectivity } from '../../hooks/useConnectivity';
import { useBoviScaleJobs, type EnrichedBoviScaleJob } from '../../hooks/useBoviScaleJobs';
import type { LocalCattle, WeighingJobState } from '../../lib/database/schema';

function StoredBlobPreview({ blob, alt }: { blob?: Blob; alt: string }) {
  const previewUrl = useMemo(() => {
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }, [blob]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  if (!previewUrl) {
    return (
      <div className="w-20 h-20 rounded-lg bg-surface-secondary flex items-center justify-center text-brand-slate/40 text-[11px]">
        Sin vista
      </div>
    );
  }

  return (
    <img
      src={previewUrl}
      alt={alt}
      className="w-20 h-20 rounded-lg object-cover border border-border-light shrink-0"
    />
  );
}

const AI_STATE_META: Record<
  WeighingJobState,
  { label: string; badgeClass: string; description: string }
> = {
  pendiente_de_analisis: {
    label: 'Pendiente de análisis',
    badgeClass: 'bg-status-warning/15 text-status-warning border-status-warning/30',
    description: 'Evidencia guardada en IndexedDB; esperando conexión para envío al modelo.'
  },
  enviando_analisis: {
    label: 'Analizando con IA...',
    badgeClass: 'bg-brand-primary/15 text-brand-primary border-brand-primary/30',
    description: 'Enviando fotografía al servicio externo vía backend.'
  },
  pendiente_de_revision: {
    label: 'Requiere revisión',
    badgeClass: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
    description: 'Estimación recibida. Confirma o corrige el peso antes de registrarlo.'
  },
  confirmado: {
    label: 'Pesaje confirmado',
    badgeClass: 'bg-status-success/15 text-status-success border-status-success/30',
    description: 'Validado por el usuario y convertido en pesaje definitivo.'
  },
  error_analisis: {
    label: 'Error de análisis',
    badgeClass: 'bg-status-error/15 text-status-error border-status-error/30',
    description: 'Fallo temporal de red o servicio. La fotografía se conserva intacta.'
  },
  cuota_excedida: {
    label: 'Cuota API excedida',
    badgeClass: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
    description: 'Límite gratuito alcanzado. Se reintentará automáticamente más tarde.'
  },
  cancelado: {
    label: 'Cancelado',
    badgeClass: 'bg-brand-slate/10 text-brand-slate/60 border-border-light',
    description: 'Captura descartada.'
  }
};

export default function BoviScalePage() {
  const { isOnline } = useConnectivity();
  const {
    jobs,
    loading,
    error: jobsError,
    captureEvidence,
    retryAnalysis,
    confirmWeight,
    cancelJob
  } = useBoviScaleJobs();

  const [cattleList, setCattleList] = useState<LocalCattle[]>([]);
  const [selectedCattleId, setSelectedCattleId] = useState<string>('');
  const [angulo, setAngulo] = useState<string>('Lateral 90°');
  const [distanciaCm, setDistanciaCm] = useState<string>('200');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSavingCapture, setIsSavingCapture] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Estado del modal de revisión y confirmación humana
  const [reviewTarget, setReviewTarget] = useState<EnrichedBoviScaleJob | null>(null);
  const [reviewedWeightInput, setReviewedWeightInput] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [isConfirmingWeight, setIsConfirmingWeight] = useState<boolean>(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const localCattle = await CattleRepository.getAll();
      if (active) {
        setCattleList(localCattle);
        if (localCattle.length > 0 && !selectedCattleId) {
          setSelectedCattleId(localCattle[0].id);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedCattleId]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setFormError(null);
  };

  const handleSaveCapture = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFeedbackMsg(null);

    if (!selectedCattleId) {
      setFormError('Selecciona un bovino del padrón antes de guardar la evidencia.');
      return;
    }
    if (!selectedFile) {
      setFormError('Captura una fotografía o selecciona un archivo de imagen.');
      return;
    }

    setIsSavingCapture(true);
    try {
      const parsedDistance = Number(distanciaCm);
      await captureEvidence({
        fileOrBlob: selectedFile,
        idBovino: selectedCattleId,
        angulo,
        distanciaEstimadaCm: Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : undefined
      });

      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setFeedbackMsg(
        isOnline
          ? 'Evidencia guardada localmente en IndexedDB y enviada a la cola de análisis IA.'
          : 'Sin conexión: fotografía guardada de forma segura en IndexedDB (pendiente_de_analisis). Se analizará automáticamente al recuperar Internet.'
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar la captura offline.');
    } finally {
      setIsSavingCapture(false);
    }
  };

  const openReviewModal = (entry: EnrichedBoviScaleJob) => {
    setReviewTarget(entry);
    const est = entry.job.pesoEstimadoKg;
    setReviewedWeightInput(est !== null && est !== undefined ? String(est) : '');
    setReviewNotes('');
  };

  const handleConfirmReviewedWeight = async (e: FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;

    const numericWeight = Number(reviewedWeightInput);
    if (!Number.isFinite(numericWeight) || numericWeight <= 0) {
      setFormError('Ingresa un peso válido mayor a 0 kg para confirmar.');
      return;
    }

    setIsConfirmingWeight(true);
    try {
      await confirmWeight({
        idTrabajo: reviewTarget.job.idTrabajo,
        pesoConfirmadoKg: numericWeight,
        observaciones: reviewNotes
      });
      setReviewTarget(null);
      setFeedbackMsg(
        'Pesaje definitivo registrado localmente y encolado en Outbox para sincronización con el servidor.'
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se pudo confirmar el pesaje.');
    } finally {
      setIsConfirmingWeight(false);
    }
  };

  const handleManualRetry = async (idTrabajo: string) => {
    setRetryingJobId(idTrabajo);
    try {
      await retryAnalysis(idTrabajo);
    } finally {
      setRetryingJobId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate flex items-center gap-2">
            <Scale className="text-brand-primary" size={24} /> BoviScale — Pesaje Diferido por Visión IA
          </h1>
          <p className="text-[13px] text-brand-slate/70">
            Captura evidencia fotográfica en campo sin conexión. La estimación del modelo externo y tu revisión se ejecutan de forma segura sin perder datos.
          </p>
        </div>
        {!isOnline && (
          <div className="flex items-center gap-2 bg-status-warning/15 border border-status-warning/40 text-brand-dark px-3.5 py-2 rounded-lg text-[12px] font-semibold">
            <WifiOff size={16} className="text-status-warning shrink-0" />
            Modo Offline activo: las capturas se guardan localmente en IndexedDB
          </div>
        )}
      </div>

      {/* Formulario de Captura No Bloqueante */}
      <form
        onSubmit={handleSaveCapture}
        className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-4"
      >
        <h2 className="font-bold text-[15px] text-brand-slate">1. Nueva Captura de Evidencia</h2>

        {formError && (
          <div className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-[13px]">
            {formError}
          </div>
        )}
        {feedbackMsg && (
          <div className="p-3 rounded-lg bg-status-success/10 border border-status-success/30 text-status-success text-[13px]">
            {feedbackMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-brand-slate mb-1">
              Bovino a Pesar *
            </label>
            <select
              value={selectedCattleId}
              onChange={(e) => setSelectedCattleId(e.target.value)}
              className="w-full border border-border-light rounded-lg px-3 py-2 text-[13px] bg-surface-white text-brand-slate"
            >
              <option value="">-- Selecciona un ejemplar --</option>
              {cattleList.map((bovino) => (
                <option key={bovino.id} value={bovino.id}>
                  {bovino.areteSiniiga || 'Sin Arete'} — {bovino.nombre || bovino.raza}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-brand-slate mb-1">
              Ángulo de Captura
            </label>
            <select
              value={angulo}
              onChange={(e) => setAngulo(e.target.value)}
              className="w-full border border-border-light rounded-lg px-3 py-2 text-[13px] bg-surface-white text-brand-slate"
            >
              <option value="Lateral 90°">Lateral 90° (Recomendado)</option>
              <option value="Dorsal Superior">Dorsal Superior</option>
              <option value="Posterior">Posterior</option>
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-semibold text-brand-slate mb-1">
              Distancia Estimada (cm)
            </label>
            <input
              type="number"
              min="50"
              max="1000"
              value={distanciaCm}
              onChange={(e) => setDistanciaCm(e.target.value)}
              className="w-full border border-border-light rounded-lg px-3 py-2 text-[13px] text-brand-slate"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border-light">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
              id="boviscale-photo-input"
            />
            <label
              htmlFor="boviscale-photo-input"
              className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border-light bg-surface-secondary/60 hover:bg-surface-secondary text-brand-slate text-[13px] font-semibold transition-colors"
            >
              <Camera size={16} className="text-brand-primary" />
              {selectedFile ? 'Cambiar Fotografía' : 'Tomar / Adjuntar Fotografía'}
            </label>
            {selectedFile && (
              <span className="text-[12px] text-brand-slate/70 truncate max-w-[240px]">
                {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={isSavingCapture || !selectedFile || !selectedCattleId}
            className="inline-flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-5 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
          >
            <Upload size={16} />
            {isSavingCapture ? 'Guardando en IndexedDB...' : 'Guardar Evidencia Localmente'}
          </button>
        </div>
      </form>

      {/* Bandeja de Capturas y Análisis Diferidos */}
      <div className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[15px] text-brand-slate">
            2. Capturas en Cola de Análisis y Revisión ({jobs.length})
          </h2>
        </div>

        {jobsError && (
          <div className="p-3 rounded-lg bg-status-error/10 text-status-error text-[13px]">
            {jobsError}
          </div>
        )}

        {loading ? (
          <div className="text-[13px] text-brand-slate/60 py-6 text-center">
            Cargando capturas almacenadas en IndexedDB...
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-6 rounded-lg bg-surface-secondary/40 text-center text-[13px] text-brand-slate/60">
            No hay capturas pendientes ni historial de análisis local.
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((entry) => {
              const { job, media, cattle, confirmedWeighing, outboxState } = entry;
              const meta = AI_STATE_META[job.estado];
              const canRetry =
                job.estado === 'error_analisis' ||
                job.estado === 'cuota_excedida' ||
                job.estado === 'pendiente_de_analisis';

              return (
                <div
                  key={job.idTrabajo}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-border-light bg-surface-secondary/25"
                >
                  <div className="flex items-start gap-3.5">
                    <StoredBlobPreview
                      blob={media?.blobData}
                      alt={cattle?.areteSiniiga || 'Evidencia bovino'}
                    />

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[14px] text-brand-slate">
                          {cattle?.areteSiniiga || 'Arete s/n'} {cattle?.nombre ? `(${cattle.nombre})` : ''}
                        </span>

                        {/* Badge 1: Estado exclusivo del análisis IA */}
                        <span
                          className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${meta.badgeClass}`}
                        >
                          IA: {meta.label}
                        </span>

                        {/* Badge 2: Estado de sincronización del pesaje definitivo (solo si fue confirmado) */}
                        {job.estado === 'confirmado' && confirmedWeighing && (
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                              confirmedWeighing.syncStatus === 'synced' || outboxState === 'confirmado'
                                ? 'bg-status-success/10 text-status-success border-status-success/30'
                                : 'bg-amber-500/10 text-amber-700 border-amber-500/30'
                            }`}
                          >
                            {confirmedWeighing.syncStatus === 'synced' ? (
                              <>
                                <CloudCheck size={12} /> Pesaje Sincronizado
                              </>
                            ) : (
                              <>
                                <CloudUpload size={12} /> Pesaje Pendiente Sync
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      <p className="text-[12px] text-brand-slate/70">
                        Capturado: {new Date(job.fechaCreacion).toLocaleString()} •{' '}
                        {media ? `${(media.tamanoBytes / 1024).toFixed(0)} KB` : 'Blob local'}
                      </p>

                      {/* Estimación del modelo (sin confirmar) vs Peso definitivo confirmado */}
                      {job.estado === 'pendiente_de_revision' && job.pesoEstimadoKg !== null && (
                        <p className="text-[13px] font-semibold text-blue-700">
                          Estimación del modelo: {job.pesoEstimadoKg} kg
                          {job.confianzaModelo !== null && job.confianzaModelo !== undefined
                            ? ` (Confianza: ${(job.confianzaModelo * 100).toFixed(0)}%)`
                            : ''}{' '}
                          — Pendiente de tu confirmación
                        </p>
                      )}

                      {job.estado === 'confirmado' && confirmedWeighing && (
                        <p className="text-[13px] font-bold text-status-success">
                          Peso definitivo confirmado: {confirmedWeighing.peso} kg
                          {job.pesoEstimadoKg ? ` (Estimado IA: ${job.pesoEstimadoKg} kg)` : ''}
                        </p>
                      )}

                      {(job.estado === 'error_analisis' || job.estado === 'cuota_excedida') &&
                        job.ultimoError && (
                          <p className="text-[12px] text-status-error flex items-center gap-1.5">
                            {job.estado === 'cuota_excedida' ? (
                              <AlertOctagon size={14} className="shrink-0" />
                            ) : (
                              <AlertTriangle size={14} className="shrink-0" />
                            )}
                            <span>
                              {job.ultimoError} (Intentos: {job.intentos})
                            </span>
                          </p>
                        )}

                      {job.estado === 'pendiente_de_analisis' && (
                        <p className="text-[12px] text-brand-slate/60 flex items-center gap-1">
                          <Clock size={13} /> {meta.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Acciones por estado */}
                  <div className="flex items-center gap-2 self-end md:self-center">
                    {job.estado === 'pendiente_de_revision' && (
                      <button
                        type="button"
                        onClick={() => openReviewModal(entry)}
                        className="inline-flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                      >
                        <Eye size={14} /> Revisar y Confirmar
                      </button>
                    )}

                    {canRetry && (
                      <button
                        type="button"
                        onClick={() => void handleManualRetry(job.idTrabajo)}
                        disabled={!isOnline || retryingJobId === job.idTrabajo}
                        className="inline-flex items-center gap-1.5 border border-border-light bg-surface-white hover:bg-surface-secondary text-brand-slate px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50"
                      >
                        <RefreshCw
                          size={14}
                          className={retryingJobId === job.idTrabajo ? 'animate-spin' : ''}
                        />
                        {retryingJobId === job.idTrabajo ? 'Analizando...' : 'Analizar Ahora'}
                      </button>
                    )}

                    {job.estado !== 'confirmado' && job.estado !== 'enviando_analisis' && (
                      <button
                        type="button"
                        onClick={() => void cancelJob(job.idTrabajo)}
                        className="p-1.5 text-brand-slate/50 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
                        title="Descartar captura"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Revisión Humana Obligatoria antes de crear Pesaje Definitivo */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmReviewedWeight}
            className="bg-surface-white border border-border-light rounded-xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center gap-2 text-brand-slate font-bold text-[16px]">
              <CheckCircle2 className="text-brand-primary" size={20} />
              Confirmar o Corregir Peso Estimado
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
              <StoredBlobPreview
                blob={reviewTarget.media?.blobData}
                alt="Evidencia a confirmar"
              />
              <div className="text-[12px] space-y-1">
                <p className="font-bold text-brand-slate">
                  {reviewTarget.cattle?.areteSiniiga || 'Bovino'}
                </p>
                <p className="text-blue-700 font-semibold">
                  Estimación del modelo: {reviewTarget.job.pesoEstimadoKg} kg
                </p>
                {reviewTarget.job.versionModelo && (
                  <p className="text-brand-slate/60">Modelo: {reviewTarget.job.versionModelo}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-brand-slate mb-1">
                Peso Definitivo (kg) — Puedes corregirlo si es necesario *
              </label>
              <input
                type="number"
                step="0.1"
                min="1"
                max="2500"
                required
                value={reviewedWeightInput}
                onChange={(e) => setReviewedWeightInput(e.target.value)}
                className="w-full border border-border-light rounded-lg px-3 py-2 text-[14px] font-bold text-brand-slate"
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-brand-slate mb-1">
                Observaciones de revisión (opcional)
              </label>
              <input
                type="text"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Ej. Peso ajustado tras inspección visual"
                className="w-full border border-border-light rounded-lg px-3 py-2 text-[13px] text-brand-slate"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                className="px-4 py-2 rounded-lg border border-border-light text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isConfirmingWeight}
                className="px-4 py-2 rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold disabled:opacity-50"
              >
                {isConfirmingWeight ? 'Confirmando...' : 'Confirmar Pesaje Definitivo'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
