import { ApiError, boviScaleApi, hasActiveAuthSession } from '../lib/api';
import { db } from '../lib/database/db';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { MediaRepository } from '../lib/database/repositories/media.repository';
import type { LocalWeighing, LocalWeighingAnalysisJob } from '../lib/database/schema';
import type { AnimalPhotoType, StoredAnimalPhoto } from '../types/media';
import type {
  BoviScaleEstimationStep,
  EstimacionPesoBoviScaleDto,
  SolicitarEstimacionPesoPayload,
  Weighing
} from '../types/weighing';
import { isValidGuid } from './cattle.validation';
import { PhotoCaptureService, validatePhotoBlob } from './photo-capture.service';
import { MediaSyncEngine } from './sync/media-sync.engine';
import { WeighingService } from './weighing.service';

export interface RequestBoviScaleEstimationInput {
  cattleId: string;
  /** Fotografía recién capturada/seleccionada (opcional si se pasa `existingMediaId`). */
  blob?: Blob;
  /** Identificador de una fotografía ya almacenada en IndexedDB. */
  existingMediaId?: string;
  tipo?: AnimalPhotoType;
  nombreArchivo?: string;
  /** Reutilizar el mismo UUID al reintentar garantiza idempotencia en el backend .NET. */
  idSolicitud?: string;
  anguloCaptura?: string;
  distanciaEstimadaCm?: number;
  observaciones?: string;
}

export interface RequestBoviScaleEstimationResult {
  ok: boolean;
  step: BoviScaleEstimationStep;
  idSolicitud: string;
  mediaId?: string;
  photo?: StoredAnimalPhoto;
  estimation?: EstimacionPesoBoviScaleDto;
  weighing?: LocalWeighing;
  domainWeighing?: Weighing;
  queuedOffline?: boolean;
  error?: string;
  httpStatus?: number | null;
  retryable?: boolean;
}

export interface BoviScaleQueueSummary {
  processedCount: number;
  errorCount: number;
  quotaExceeded: boolean;
}

const inFlightJobIds = new Set<string>();
const inFlightRequestIds = new Set<string>();
let queueProcessingLock = false;

function isValidBackendEstimationResponse(
  raw: unknown
): raw is EstimacionPesoBoviScaleDto {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.idPesaje === 'string' &&
    isValidGuid(r.idPesaje) &&
    typeof r.idAnimal === 'string' &&
    isValidGuid(r.idAnimal) &&
    typeof r.pesoEstimadoKg === 'number' &&
    Number.isFinite(r.pesoEstimadoKg) &&
    r.pesoEstimadoKg > 0 &&
    typeof r.unidadPeso === 'string' &&
    r.unidadPeso.trim().toLowerCase() === 'kg'
  );
}

function mapEstimationApiError(err: unknown): {
  message: string;
  httpStatus: number | null;
  retryable: boolean;
} {
  if (err instanceof ApiError) {
    const status = err.status;
    if (status === 401) {
      return {
        message: 'Tu sesión JWT expiró. Inicia sesión nuevamente para solicitar la estimación.',
        httpStatus: 401,
        retryable: false
      };
    }
    if (status === 403) {
      return {
        message:
          err.message ||
          'No tienes permisos sobre el rancho del bovino para solicitar esta estimación.',
        httpStatus: 403,
        retryable: false
      };
    }
    if (status === 404) {
      return {
        message:
          err.message ||
          'El bovino o la fotografía no se encontraron sincronizados en el servidor.',
        httpStatus: 404,
        retryable: false
      };
    }
    if (status === 422) {
      return {
        message:
          err.message ||
          'El modelo de estimación no pudo procesar la fotografía. Captura una imagen más clara del bovino.',
        httpStatus: 422,
        retryable: false
      };
    }
    if (status === 429) {
      return {
        message:
          err.message ||
          'El servicio de estimación alcanzó su límite temporal de solicitudes. Intenta nuevamente más tarde.',
        httpStatus: 429,
        retryable: true
      };
    }
    if (status === 502 || status === 503 || status === 504 || status === 0) {
      return {
        message:
          status === 504
            ? 'El análisis no pudo completarse porque el servicio de estimación excedió el tiempo de espera.'
            : status === 0
              ? 'No fue posible establecer conexión con el servidor para completar el análisis.'
              : 'El análisis no pudo completarse porque el servicio de estimación de peso no respondió correctamente.',
        httpStatus: status,
        retryable: true
      };
    }
    return {
      message: err.message || `El servidor devolvió un error (HTTP ${status}) al procesar la estimación.`,
      httpStatus: status,
      retryable: status >= 500
    };
  }

  return {
    message:
      err instanceof Error && err.message
        ? err.message
        : 'No se pudo completar la estimación de peso.',
    httpStatus: null,
    retryable: true
  };
}

/**
 * Persiste una solicitud de análisis BoviScale pendiente en `db.weighingAnalysisJobs`
 * cuando no hay conexión, sin inventar ni registrar ningún peso en `db.weighings`.
 */
async function upsertPendingOfflineAnalysisRequest(params: {
  idSolicitud: string;
  idMedia: string;
  idBovino: string;
  ranchId?: string;
  angulo?: string;
  distanciaEstimadaCm?: number;
}): Promise<LocalWeighingAnalysisJob> {
  const now = new Date().toISOString();
  const existing = await db.weighingAnalysisJobs.get(params.idSolicitud);
  if (existing && existing.estado !== 'cancelado' && existing.estado !== 'confirmado') {
    await db.weighingAnalysisJobs.update(existing.idTrabajo, {
      estado: 'pendiente_de_analisis',
      proximoIntento: null,
      actualizadoEn: now
    });
    return { ...existing, estado: 'pendiente_de_analisis', proximoIntento: null, actualizadoEn: now };
  }

  const job: LocalWeighingAnalysisJob = {
    idTrabajo: params.idSolicitud,
    idMedia: params.idMedia,
    idBovino: params.idBovino,
    ranchId: params.ranchId,
    idOperacion: null,
    estado: 'pendiente_de_analisis',
    pesoEstimadoKg: null,
    pesoConfirmadoKg: null,
    idPesajeConfirmado: null,
    confianzaModelo: null,
    versionModelo: null,
    observacionesModelo: null,
    metadatosCaptura: {
      angulo: params.angulo || 'Lateral 90°',
      distanciaEstimadaCm: params.distanciaEstimadaCm,
      dispositivo: typeof navigator !== 'undefined' ? navigator.platform : 'PWA'
    },
    intentos: 0,
    ultimoError: null,
    codigoErrorHttp: null,
    proximoIntento: null,
    fechaCreacion: now,
    actualizadoEn: now,
    analizadoEn: null,
    completadoEn: null
  };

  await db.weighingAnalysisJobs.put(job);
  return job;
}

async function markPendingJobCompletedIfExists(dto: EstimacionPesoBoviScaleDto): Promise<void> {
  if (!dto.idSolicitud) return;
  const existing = await db.weighingAnalysisJobs.get(dto.idSolicitud);
  if (!existing) return;

  const now = new Date().toISOString();
  await db.weighingAnalysisJobs.update(existing.idTrabajo, {
    estado: 'confirmado',
    pesoEstimadoKg: dto.pesoEstimadoKg,
    pesoConfirmadoKg: dto.pesoEstimadoKg,
    idPesajeConfirmado: dto.idPesaje,
    confianzaModelo: dto.confianzaModelo,
    versionModelo: dto.versionModelo,
    observacionesModelo: dto.observaciones,
    ultimoError: null,
    codigoErrorHttp: null,
    proximoIntento: null,
    analizadoEn: now,
    actualizadoEn: now,
    completadoEn: now
  });
}

export const BoviScaleAnalysisService = {
  calculateBackoffMs(attempts: number): number {
    const baseMs = 4000;
    const maxMs = 15 * 60 * 1000;
    const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempts));
    const jitter = Math.floor(Math.random() * 1500);
    return exponential + jitter;
  },

  isJobInFlight(idTrabajo: string): boolean {
    return inFlightJobIds.has(idTrabajo);
  },

  /**
   * Lista las solicitudes BoviScale pendientes o con error recuperable conservadas offline.
   */
  async getPendingOfflineRequests(cattleId?: string): Promise<LocalWeighingAnalysisJob[]> {
    const rows = cattleId
      ? await db.weighingAnalysisJobs
          .where('idBovino')
          .equals(cattleId)
          .filter((j) => j.estado !== 'confirmado' && j.estado !== 'cancelado')
          .toArray()
      : await db.weighingAnalysisJobs
          .filter((j) => j.estado !== 'confirmado' && j.estado !== 'cancelado')
          .toArray();

    return rows.sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
  },

  /**
   * Flujo completo React → Backend .NET (`POST /api/media/archivos` + `POST /api/boviscale/estimaciones`)
   * → API Python → MySQL → React (reutilizando `WeighingService` / `WeighingRepository`).
   * - Sin conexión: conserva fotografía + solicitud pendiente en IndexedDB sin inventar ningún peso.
   * - Nunca se comunica directamente con Python.
   */
  async requestWeightEstimation(
    input: RequestBoviScaleEstimationInput,
    onStepChange?: (step: BoviScaleEstimationStep) => void
  ): Promise<RequestBoviScaleEstimationResult> {
    const idSolicitud =
      input.idSolicitud && isValidGuid(input.idSolicitud)
        ? input.idSolicitud
        : crypto.randomUUID();

    if (inFlightRequestIds.has(idSolicitud)) {
      return {
        ok: false,
        step: 'procesando_estimacion',
        idSolicitud,
        error: 'Ya existe una solicitud de estimación en curso para esta fotografía.',
        retryable: false
      };
    }

    const cattleId = (input.cattleId || '').trim();
    if (!cattleId || !isValidGuid(cattleId)) {
      onStepChange?.('error_procesamiento');
      return {
        ok: false,
        step: 'error_procesamiento',
        idSolicitud,
        error: 'Debes seleccionar un animal válido antes de solicitar la estimación de peso.',
        retryable: false
      };
    }

    const animal = await CattleRepository.getById(cattleId);
    if (!animal || animal.deletedAt) {
      onStepChange?.('error_procesamiento');
      return {
        ok: false,
        step: 'error_procesamiento',
        idSolicitud,
        error: 'El animal seleccionado no existe o está desactivado en el dispositivo.',
        retryable: false
      };
    }

    if (!input.blob && !input.existingMediaId) {
      onStepChange?.('error_procesamiento');
      return {
        ok: false,
        step: 'error_procesamiento',
        idSolicitud,
        error: 'Debes capturar o seleccionar una fotografía antes de solicitar la estimación.',
        retryable: false
      };
    }

    if (input.blob) {
      const validation = validatePhotoBlob(input.blob);
      if (!validation.valid) {
        onStepChange?.('error_procesamiento');
        return {
          ok: false,
          step: 'error_procesamiento',
          idSolicitud,
          error: validation.error || 'La fotografía seleccionada no es válida.',
          retryable: false
        };
      }
    }

    onStepChange?.('fotografia_validada');
    inFlightRequestIds.add(idSolicitud);

    let resolvedMediaId = input.existingMediaId;
    let resolvedPhoto: StoredAnimalPhoto | undefined;

    try {
      // 1. Persistir localmente la fotografía en IndexedDB (o recuperar existente)
      if (input.existingMediaId) {
        const existingMedia = await MediaRepository.getById(input.existingMediaId);
        if (!existingMedia) {
          onStepChange?.('error_procesamiento');
          return {
            ok: false,
            step: 'error_procesamiento',
            idSolicitud,
            error: 'La fotografía seleccionada ya no está disponible en el dispositivo.',
            retryable: false
          };
        }
        resolvedMediaId = existingMedia.id;
        resolvedPhoto = PhotoCaptureService.toStoredPhoto(existingMedia);
      } else if (input.blob) {
        const saved = await PhotoCaptureService.savePhoto({
          blob: input.blob,
          cattleId,
          tipo: input.tipo ?? 'BoviScaleVision',
          nombreArchivo: input.nombreArchivo
        });
        resolvedMediaId = saved.photo.id;
        resolvedPhoto = saved.photo;
      }

      if (!resolvedMediaId) {
        onStepChange?.('error_procesamiento');
        return {
          ok: false,
          step: 'error_procesamiento',
          idSolicitud,
          error: 'No se pudo preparar la fotografía para el análisis.',
          retryable: false
        };
      }

      // 2. Comportamiento Offline-First: conservar fotografía + solicitud pendiente sin inventar peso
      const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
      if (!isOnline) {
        await upsertPendingOfflineAnalysisRequest({
          idSolicitud,
          idMedia: resolvedMediaId,
          idBovino: cattleId,
          ranchId: animal.ranchId,
          angulo: input.anguloCaptura,
          distanciaEstimadaCm: input.distanciaEstimadaCm
        });

        onStepChange?.('error_procesamiento');
        return {
          ok: false,
          step: 'error_procesamiento',
          idSolicitud,
          mediaId: resolvedMediaId,
          photo: resolvedPhoto,
          queuedOffline: true,
          error:
            'Sin conexión: el análisis BoviScale requiere conexión con el servidor. La fotografía y la solicitud pendiente quedaron guardadas localmente para recuperarse al reconectar.',
          httpStatus: 0,
          retryable: true
        };
      }

      if (!hasActiveAuthSession()) {
        onStepChange?.('error_procesamiento');
        return {
          ok: false,
          step: 'error_procesamiento',
          idSolicitud,
          mediaId: resolvedMediaId,
          photo: resolvedPhoto,
          error: 'Inicia sesión para enviar la fotografía y solicitar la estimación de peso.',
          httpStatus: 401,
          retryable: false
        };
      }

      // 3. Asegurar que la fotografía esté subida al backend .NET
      let currentMedia = await MediaRepository.getById(resolvedMediaId);
      if (currentMedia && currentMedia.estadoArchivo !== 'subido') {
        const uploadOutcome = await MediaSyncEngine.syncSingleMedia(currentMedia.id);
        currentMedia = await MediaRepository.getById(resolvedMediaId);
        if (currentMedia) {
          resolvedPhoto = PhotoCaptureService.toStoredPhoto(currentMedia);
        }
        if (!uploadOutcome.synced || !currentMedia || currentMedia.estadoArchivo !== 'subido') {
          onStepChange?.('error_procesamiento');
          return {
            ok: false,
            step: 'error_procesamiento',
            idSolicitud,
            mediaId: resolvedMediaId,
            photo: resolvedPhoto,
            error:
              uploadOutcome.error ||
              'No fue posible subir la fotografía al servidor antes de solicitar la estimación.',
            retryable: true
          };
        }
      }

      const remoteMediaId = String(currentMedia?.remoteId || resolvedMediaId);
      const remoteAnimalId = String(animal.remoteId || animal.id);
      const ranchId = animal.ranchId || currentMedia?.ranchId;

      const payload: SolicitarEstimacionPesoPayload = {
        idSolicitud,
        idAnimal: remoteAnimalId,
        idRancho: ranchId && isValidGuid(ranchId) ? ranchId : undefined,
        idArchivo: remoteMediaId,
        fechaPesaje: currentMedia?.fechaCaptura,
        anguloCaptura: input.anguloCaptura?.trim() || undefined,
        distanciaEstimadaCm: input.distanciaEstimadaCm,
        observaciones: input.observaciones?.trim() || undefined
      };

      // 4. Solicitar estimación al backend .NET (que invoca Python y persiste en MySQL)
      onStepChange?.('solicitud_enviada');
      onStepChange?.('procesando_estimacion');

      const responseDto = await boviScaleApi.requestEstimation(payload);

      if (!isValidBackendEstimationResponse(responseDto)) {
        onStepChange?.('error_procesamiento');
        return {
          ok: false,
          step: 'error_procesamiento',
          idSolicitud,
          mediaId: resolvedMediaId,
          photo: resolvedPhoto,
          error:
            'El servidor devolvió una respuesta incompleta o sin peso válido en kg. No se registró ningún pesaje.',
          httpStatus: 502,
          retryable: true
        };
      }

      onStepChange?.('estimacion_recibida');

      // 5. Reutilizar WeighingService + WeighingRepository para registrar el pesaje en el historial local
      const { local, weighing } =
        await WeighingService.recordConfirmedBoviScaleWeighing(responseDto);
      await markPendingJobCompletedIfExists(responseDto);

      onStepChange?.('pesaje_registrado');

      return {
        ok: true,
        step: 'pesaje_registrado',
        idSolicitud,
        mediaId: resolvedMediaId,
        photo: resolvedPhoto,
        estimation: responseDto,
        weighing: local,
        domainWeighing: weighing
      };
    } catch (err) {
      const mapped = mapEstimationApiError(err);
      onStepChange?.('error_procesamiento');
      return {
        ok: false,
        step: 'error_procesamiento',
        idSolicitud,
        mediaId: resolvedMediaId,
        photo: resolvedPhoto,
        error: mapped.message,
        httpStatus: mapped.httpStatus,
        retryable: mapped.retryable
      };
    } finally {
      inFlightRequestIds.delete(idSolicitud);
    }
  },

  async analyzeSingleJob(idTrabajo: string): Promise<{
    processed: boolean;
    quotaExceeded: boolean;
    result?: RequestBoviScaleEstimationResult;
  }> {
    if (inFlightJobIds.has(idTrabajo)) {
      return { processed: false, quotaExceeded: false };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { processed: false, quotaExceeded: false };
    }

    if (!hasActiveAuthSession()) {
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

    inFlightJobIds.add(idTrabajo);

    try {
      await MediaRepository.markJobAnalyzing(idTrabajo);

      const res = await this.requestWeightEstimation({
        cattleId: job.idBovino,
        existingMediaId: job.idMedia,
        idSolicitud: job.idTrabajo,
        anguloCaptura: job.metadatosCaptura?.angulo,
        distanciaEstimadaCm: job.metadatosCaptura?.distanciaEstimadaCm
      });

      if (!res.ok || !res.estimation) {
        const isQuota = res.httpStatus === 429;
        const backoffMs = isQuota
          ? Math.max(5 * 60 * 1000, this.calculateBackoffMs(job.intentos))
          : this.calculateBackoffMs(job.intentos);

        await MediaRepository.markJobAnalysisError(idTrabajo, {
          errorMsg: res.error || 'No se pudo completar el análisis BoviScale.',
          httpStatus: res.httpStatus ?? null,
          isQuotaExceeded: isQuota,
          nextRetryIso: res.retryable ? new Date(Date.now() + backoffMs).toISOString() : null
        });
        return { processed: false, quotaExceeded: isQuota, result: res };
      }

      return { processed: true, quotaExceeded: false, result: res };
    } finally {
      inFlightJobIds.delete(idTrabajo);
    }
  },

  async processPendingQueue(options?: {
    ranchIds?: readonly string[];
  }): Promise<BoviScaleQueueSummary> {
    const summary: BoviScaleQueueSummary = {
      processedCount: 0,
      errorCount: 0,
      quotaExceeded: false
    };

    if (queueProcessingLock) return summary;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return summary;
    if (!hasActiveAuthSession()) return summary;

    const allowedRanches =
      options?.ranchIds !== undefined
        ? new Set(options.ranchIds.filter((id) => isValidGuid(id)))
        : null;

    queueProcessingLock = true;
    try {
      await MediaRepository.recoverInterruptedJobs(inFlightJobIds);
      const pendingJobs = await MediaRepository.getPendingAnalysisJobs();

      for (const job of pendingJobs) {
        if (job.intentos >= 12) continue;
        if (allowedRanches !== null && (!job.ranchId || !allowedRanches.has(job.ranchId))) {
          continue;
        }

        const outcome = await this.analyzeSingleJob(job.idTrabajo);
        if (outcome.processed) {
          summary.processedCount++;
        } else {
          summary.errorCount++;
        }
        if (outcome.quotaExceeded) {
          summary.quotaExceeded = true;
          break;
        }
      }
      return summary;
    } finally {
      queueProcessingLock = false;
    }
  },

  async retryImmediately(idTrabajo: string): Promise<RequestBoviScaleEstimationResult | undefined> {
    await MediaRepository.scheduleImmediateRetry(idTrabajo);
    const outcome = await this.analyzeSingleJob(idTrabajo);
    return outcome.result;
  }
};
