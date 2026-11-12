import { db } from '../lib/database/db';
import { MediaRepository } from '../lib/database/repositories/media.repository';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';

export interface BoviScaleModelResponse {
  estimatedWeightKg: number;
  confidence: number | null;
  modelVersion: string | null;
  notes: string | null;
  mediaUrl: string | null;
}

const inFlightJobIds = new Set<string>();
let queueProcessingLock = false;

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const targetMs = Date.parse(trimmed);
  if (!Number.isNaN(targetMs)) {
    return Math.max(0, targetMs - Date.now());
  }
  return null;
}

function parseModelResponse(raw: unknown): BoviScaleModelResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const rawWeight = record.estimatedWeightKg ?? record.pesoEstimadoKg ?? record.weightKg;
  if (typeof rawWeight !== 'number' || !Number.isFinite(rawWeight) || rawWeight <= 0 || rawWeight > 2500) {
    return null;
  }

  const rawConfidence = record.confidence ?? record.confianzaModelo;
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence) ? rawConfidence : null;

  const rawVersion = record.modelVersion ?? record.versionModelo;
  const modelVersion = typeof rawVersion === 'string' ? rawVersion : null;

  const rawNotes = record.notes ?? record.observacionesModelo;
  const notes = typeof rawNotes === 'string' ? rawNotes : null;

  const rawMediaUrl = record.mediaUrl ?? record.urlRemotaMedia;
  const mediaUrl = typeof rawMediaUrl === 'string' ? rawMediaUrl : null;

  return {
    estimatedWeightKg: Number(rawWeight.toFixed(2)),
    confidence,
    modelVersion,
    notes,
    mediaUrl
  };
}

function getProxyEndpoint(): string {
  const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
  return `${baseUrl.replace(/\/$/, '')}/boviscale/analyze`;
}

export const BoviScaleAnalysisService = {
  calculateBackoffMs(attempts: number): number {
    const baseMs = 4000;
    const maxMs = 15 * 60 * 1000; // Máximo 15 minutos entre reintentos automáticos
    const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempts));
    const jitter = Math.floor(Math.random() * 1500);
    return exponential + jitter;
  },

  isJobInFlight(idTrabajo: string): boolean {
    return inFlightJobIds.has(idTrabajo);
  },

  async analyzeSingleJob(idTrabajo: string): Promise<{
    processed: boolean;
    quotaExceeded: boolean;
  }> {
    if (inFlightJobIds.has(idTrabajo)) {
      return { processed: false, quotaExceeded: false };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { processed: false, quotaExceeded: false };
    }

    const job = await db.weighingAnalysisJobs.get(idTrabajo);
    if (!job) {
      return { processed: false, quotaExceeded: false };
    }

    if (
      job.estado === 'confirmado' ||
      job.estado === 'cancelado' ||
      job.estado === 'pendiente_de_revision' ||
      job.estado === 'enviando_analisis'
    ) {
      return { processed: false, quotaExceeded: false };
    }

    const media = await MediaRepository.getById(job.idMedia);
    if (!media || !media.blobData) {
      await MediaRepository.markJobAnalysisError(idTrabajo, {
        errorMsg: 'No se encontró el Blob de la fotografía en IndexedDB.',
        httpStatus: null,
        isQuotaExceeded: false,
        nextRetryIso: null
      });
      return { processed: false, quotaExceeded: false };
    }

    inFlightJobIds.add(idTrabajo);

    try {
      await MediaRepository.markJobAnalyzing(idTrabajo);

      const cattle = await CattleRepository.getById(job.idBovino);
      const formData = new FormData();
      formData.append('image', media.blobData, media.nombreArchivo);
      formData.append('jobId', job.idTrabajo);
      formData.append(
        'cattleId',
        cattle?.remoteId !== undefined && cattle?.remoteId !== null
          ? String(cattle.remoteId)
          : job.idBovino
      );
      if (job.metadatosCaptura) {
        formData.append('metadata', JSON.stringify(job.metadatosCaptura));
      }

      const response = await fetch(getProxyEndpoint(), {
        method: 'POST',
        body: formData,
        headers: {
          'X-Idempotency-Key': job.idTrabajo
        },
        signal: AbortSignal.timeout(25000)
      });

      if (response.status === 429) {
        const retryAfterMs =
          parseRetryAfterMs(response.headers.get('Retry-After')) ??
          Math.max(5 * 60 * 1000, this.calculateBackoffMs(job.intentos));
        const nextRetryIso = new Date(Date.now() + retryAfterMs).toISOString();

        await MediaRepository.markJobAnalysisError(idTrabajo, {
          errorMsg:
            'Cuota gratuita del servicio de análisis excedida (429). La fotografía está a salvo y se reintentará más tarde.',
          httpStatus: 429,
          isQuotaExceeded: true,
          nextRetryIso
        });
        return { processed: false, quotaExceeded: true };
      }

      if (!response.ok) {
        let serverDetail = '';
        try {
          const errBody = (await response.json()) as Record<string, unknown>;
          if (typeof errBody.message === 'string') serverDetail = errBody.message;
          else if (typeof errBody.detail === 'string') serverDetail = errBody.detail;
        } catch {
          // Cuerpo no JSON
        }

        const backoffMs = this.calculateBackoffMs(job.intentos);
        const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();
        const reason =
          serverDetail ||
          (response.status === 404 || response.status === 501
            ? 'Endpoint proxy de análisis (/api/boviscale/analyze) aún no disponible en el servidor.'
            : `Error del servicio de análisis (HTTP ${response.status}).`);

        await MediaRepository.markJobAnalysisError(idTrabajo, {
          errorMsg: reason,
          httpStatus: response.status,
          isQuotaExceeded: false,
          nextRetryIso
        });
        return { processed: false, quotaExceeded: false };
      }

      const rawJson: unknown = await response.json();
      const parsed = parseModelResponse(rawJson);

      if (!parsed) {
        const backoffMs = this.calculateBackoffMs(job.intentos);
        await MediaRepository.markJobAnalysisError(idTrabajo, {
          errorMsg:
            'El servicio respondió sin una estimación válida de peso. No se generó ningún peso automático.',
          httpStatus: response.status,
          isQuotaExceeded: false,
          nextRetryIso: new Date(Date.now() + backoffMs).toISOString()
        });
        return { processed: false, quotaExceeded: false };
      }

      await MediaRepository.saveJobAnalysisResult(idTrabajo, {
        pesoEstimadoKg: parsed.estimatedWeightKg,
        confianzaModelo: parsed.confidence,
        versionModelo: parsed.modelVersion,
        observacionesModelo: parsed.notes,
        urlRemotaMedia: parsed.mediaUrl
      });

      return { processed: true, quotaExceeded: false };
    } catch (err) {
      const backoffMs = this.calculateBackoffMs(job.intentos);
      const nextRetryIso = new Date(Date.now() + backoffMs).toISOString();
      const message =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'Tiempo de espera agotado al contactar el servicio de análisis. Evidencia conservada.'
          : 'Sin conexión estable con el servicio de análisis. La evidencia permanece guardada localmente.';

      await MediaRepository.markJobAnalysisError(idTrabajo, {
        errorMsg: message,
        httpStatus: null,
        isQuotaExceeded: false,
        nextRetryIso
      });
      return { processed: false, quotaExceeded: false };
    } finally {
      inFlightJobIds.delete(idTrabajo);
    }
  },

  async processPendingQueue(): Promise<void> {
    if (queueProcessingLock) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    queueProcessingLock = true;
    try {
      await MediaRepository.recoverInterruptedJobs(inFlightJobIds);
      const pendingJobs = await MediaRepository.getPendingAnalysisJobs();

      for (const job of pendingJobs) {
        if (job.intentos >= 12) continue;
        const result = await this.analyzeSingleJob(job.idTrabajo);
        if (result.quotaExceeded) {
          // Detener el lote actual para no agotar más cuota ni acumular errores 429
          break;
        }
      }
    } finally {
      queueProcessingLock = false;
    }
  },

  async retryImmediately(idTrabajo: string): Promise<void> {
    await MediaRepository.scheduleImmediateRetry(idTrabajo);
    await this.analyzeSingleJob(idTrabajo);
  }
};
