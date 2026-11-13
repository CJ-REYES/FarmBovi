import { db } from '../db';
import { OutboxRepository } from './outbox.repository';
import type {
  LocalMedia,
  LocalWeighingAnalysisJob,
  WeighingJobState
} from '../schema';

export interface SaveMediaCaptureOptions {
  fileOrBlob: Blob;
  tipo: 'FotoPerfil' | 'BoviScaleVision' | 'Documento';
  entidadRelacionada?: 'cattle' | 'weighings' | 'healthRecords';
  idEntidadRelacionada?: string;
  cattleId?: string;
  nombreArchivo?: string;
  ranchId?: string;
  crearTrabajoPesaje?: boolean;
  metadatosCaptura?: LocalWeighingAnalysisJob['metadatosCaptura'];
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

export const MediaRepository = {
  async saveCapture(options: SaveMediaCaptureOptions): Promise<{
    media: LocalMedia;
    weighingJob?: LocalWeighingAnalysisJob;
  }> {
    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    if (options.fileOrBlob.size === 0) {
      throw new Error('El archivo seleccionado está vacío.');
    }
    if (options.fileOrBlob.size > MAX_SIZE_BYTES) {
      throw new Error('El archivo excede el límite máximo permitido de 10 MB.');
    }

    const mimeType = options.fileOrBlob.type || 'image/jpeg';
    if (options.crearTrabajoPesaje && !ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
      throw new Error('Formato de imagen no compatible. Utiliza JPEG, PNG o WebP.');
    }

    try {
      return await db.transaction(
        'rw',
        [db.media, db.weighingAnalysisJobs, db.outbox],
        async () => {
          const now = new Date().toISOString();
          const mediaId = crypto.randomUUID();
          const extension = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          const cattleUuid = options.cattleId || options.idEntidadRelacionada;

          if (options.crearTrabajoPesaje && !cattleUuid) {
            throw new Error('Debe seleccionar un bovino antes de capturar evidencia para pesaje.');
          }

          let uploadOperationId: string | null = null;
          if (!options.crearTrabajoPesaje) {
            const uploadOperation = OutboxRepository.createOperationRecord({
              entidad: 'media',
              idEntidad: mediaId,
              tipoOperacion: 'CREATE',
              versionBase: null,
              payload: {
                mediaId,
                cattleId: cattleUuid,
                tipo: options.tipo,
                mimeType,
                tamanoBytes: options.fileOrBlob.size,
                fechaCaptura: now
              }
            });
            await db.outbox.put(uploadOperation);
            uploadOperationId = uploadOperation.idOperacion;
          }

          const mediaRecord: LocalMedia = {
            id: mediaId,
            ranchId: options.ranchId,
            cattleId: cattleUuid,
            entidadRelacionada: options.entidadRelacionada || 'cattle',
            idEntidadRelacionada: cattleUuid,
            tipo: options.tipo,
            nombreArchivo:
              options.nombreArchivo || `${options.tipo.toLowerCase()}-${mediaId}.${extension}`,
            mimeType,
            tamanoBytes: options.fileOrBlob.size,
            checksumSha256: null,
            blobData: options.fileOrBlob,
            urlRemota: null,
            idOperacionSubida: uploadOperationId,
            estadoArchivo: 'pendiente_subida',
            intentosSubida: 0,
            ultimoErrorSubida: null,
            fechaCaptura: now,
            createdAt: now,
            updatedAt: now,
            syncStatus: 'pending',
            serverVersion: null,
            deletedAt: null
          };

          await db.media.put(mediaRecord);

          let weighingJob: LocalWeighingAnalysisJob | undefined;

          if (options.crearTrabajoPesaje && cattleUuid) {
            const jobId = crypto.randomUUID();
            weighingJob = {
              idTrabajo: jobId,
              idMedia: mediaId,
              idBovino: cattleUuid,
              ranchId: options.ranchId,
              idOperacion: null,
              estado: 'pendiente_de_analisis',
              pesoEstimadoKg: null,
              pesoConfirmadoKg: null,
              idPesajeConfirmado: null,
              confianzaModelo: null,
              versionModelo: null,
              observacionesModelo: null,
              metadatosCaptura: options.metadatosCaptura,
              intentos: 0,
              ultimoError: null,
              codigoErrorHttp: null,
              proximoIntento: null,
              fechaCreacion: now,
              actualizadoEn: now,
              analizadoEn: null,
              completadoEn: null
            };

            await db.weighingAnalysisJobs.put(weighingJob);
          }

          return { media: mediaRecord, weighingJob };
        }
      );
    } catch (err) {
      console.error('Error al persistir evidencia en IndexedDB:', err);
      throw new Error(
        err instanceof Error ? err.message : 'No se pudo guardar la evidencia localmente.',
        { cause: err }
      );
    }
  },

  async getById(id: string): Promise<LocalMedia | undefined> {
    const record = await db.media.get(id);
    return record && !record.deletedAt ? record : undefined;
  },

  async getByCattleId(cattleId: string): Promise<LocalMedia[]> {
    return await db.media
      .where('cattleId')
      .equals(cattleId)
      .filter((m) => !m.deletedAt)
      .toArray();
  },

  async getAllAnalysisJobs(): Promise<LocalWeighingAnalysisJob[]> {
    const jobs = await db.weighingAnalysisJobs
      .filter((j) => j.estado !== 'cancelado')
      .toArray();
    return jobs.sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
  },

  async getPendingAnalysisJobs(nowIso: string = new Date().toISOString()): Promise<LocalWeighingAnalysisJob[]> {
    const candidates = await db.weighingAnalysisJobs
      .where('estado')
      .anyOf('pendiente_de_analisis', 'error_analisis', 'cuota_excedida')
      .sortBy('fechaCreacion');

    return candidates.filter((job) => !job.proximoIntento || job.proximoIntento <= nowIso);
  },

  async recoverInterruptedJobs(activeInFlightIds: ReadonlySet<string>): Promise<number> {
    const stuckJobs = await db.weighingAnalysisJobs
      .where('estado')
      .equals('enviando_analisis')
      .toArray();

    let recovered = 0;
    const now = new Date().toISOString();
    for (const job of stuckJobs) {
      if (!activeInFlightIds.has(job.idTrabajo)) {
        await db.weighingAnalysisJobs.update(job.idTrabajo, {
          estado: 'pendiente_de_analisis',
          actualizadoEn: now
        });
        recovered++;
      }
    }
    return recovered;
  },

  async markJobAnalyzing(idTrabajo: string): Promise<void> {
    await db.transaction('rw', [db.weighingAnalysisJobs, db.media], async () => {
      const job = await db.weighingAnalysisJobs.get(idTrabajo);
      if (!job) return;
      const now = new Date().toISOString();
      await db.weighingAnalysisJobs.update(idTrabajo, {
        estado: 'enviando_analisis',
        actualizadoEn: now
      });
      await db.media.update(job.idMedia, {
        estadoArchivo: 'subiendo',
        updatedAt: now
      });
    });
  },

  async saveJobAnalysisResult(
    idTrabajo: string,
    result: {
      pesoEstimadoKg: number;
      confianzaModelo?: number | null;
      versionModelo?: string | null;
      observacionesModelo?: string | null;
      urlRemotaMedia?: string | null;
    }
  ): Promise<void> {
    await db.transaction('rw', [db.weighingAnalysisJobs, db.media], async () => {
      const job = await db.weighingAnalysisJobs.get(idTrabajo);
      if (!job || job.estado === 'confirmado' || job.estado === 'cancelado') return;

      const now = new Date().toISOString();
      await db.weighingAnalysisJobs.update(idTrabajo, {
        estado: 'pendiente_de_revision',
        pesoEstimadoKg: result.pesoEstimadoKg,
        confianzaModelo: result.confianzaModelo ?? null,
        versionModelo: result.versionModelo ?? null,
        observacionesModelo: result.observacionesModelo ?? null,
        ultimoError: null,
        codigoErrorHttp: null,
        proximoIntento: null,
        analizadoEn: now,
        actualizadoEn: now
      });

      await db.media.update(job.idMedia, {
        estadoArchivo: 'subido',
        urlRemota: result.urlRemotaMedia ?? null,
        ultimoErrorSubida: null,
        updatedAt: now
      });
    });
  },

  async markJobAnalysisError(
    idTrabajo: string,
    params: {
      errorMsg: string;
      httpStatus?: number | null;
      isQuotaExceeded?: boolean;
      nextRetryIso: string | null;
    }
  ): Promise<void> {
    await db.transaction('rw', [db.weighingAnalysisJobs, db.media], async () => {
      const job = await db.weighingAnalysisJobs.get(idTrabajo);
      if (!job || job.estado === 'confirmado' || job.estado === 'cancelado') return;

      const now = new Date().toISOString();
      const nextState: WeighingJobState = params.isQuotaExceeded
        ? 'cuota_excedida'
        : 'error_analisis';

      await db.weighingAnalysisJobs.update(idTrabajo, {
        estado: nextState,
        intentos: job.intentos + 1,
        ultimoError: params.errorMsg,
        codigoErrorHttp: params.httpStatus ?? null,
        proximoIntento: params.nextRetryIso,
        actualizadoEn: now
      });

      const media = await db.media.get(job.idMedia);
      if (media) {
        await db.media.update(job.idMedia, {
          estadoArchivo: 'error_subida',
          intentosSubida: media.intentosSubida + 1,
          ultimoErrorSubida: params.errorMsg,
          updatedAt: now
        });
      }
    });
  },

  async scheduleImmediateRetry(idTrabajo: string): Promise<void> {
    const job = await db.weighingAnalysisJobs.get(idTrabajo);
    if (!job) return;
    if (job.estado === 'confirmado' || job.estado === 'cancelado' || job.estado === 'enviando_analisis') {
      return;
    }

    await db.weighingAnalysisJobs.update(idTrabajo, {
      estado: 'pendiente_de_analisis',
      proximoIntento: null,
      actualizadoEn: new Date().toISOString()
    });
  },

  async cancelAnalysisJob(idTrabajo: string): Promise<void> {
    await db.transaction('rw', [db.weighingAnalysisJobs, db.media], async () => {
      const job = await db.weighingAnalysisJobs.get(idTrabajo);
      if (!job || job.estado === 'cancelado' || job.estado === 'confirmado') return;

      const now = new Date().toISOString();
      await db.weighingAnalysisJobs.update(idTrabajo, {
        estado: 'cancelado',
        actualizadoEn: now
      });
      await db.media.update(job.idMedia, {
        deletedAt: now,
        updatedAt: now
      });
    });
  },
  async getPendingUploads(): Promise<LocalMedia[]> {
    return await db.media
      .where('estadoArchivo')
      .anyOf('pendiente_subida', 'error_subida')
      .filter((m) => !m.deletedAt)
      .toArray();
  },

  async getWeighingJobsByCattle(idBovino: string): Promise<LocalWeighingAnalysisJob[]> {
    const jobs = await db.weighingAnalysisJobs
      .where('idBovino')
      .equals(idBovino)
      .filter((j) => j.estado !== 'cancelado')
      .toArray();
    return jobs.sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
  },

  async getWeighingJobsByState(estado: WeighingJobState): Promise<LocalWeighingAnalysisJob[]> {
    return await db.weighingAnalysisJobs.where('estado').equals(estado).sortBy('fechaCreacion');
  },

  async softDeleteMedia(mediaId: string): Promise<void> {
    await db.transaction('rw', [db.media, db.outbox], async () => {
      const existing = await db.media.get(mediaId);
      if (!existing || existing.deletedAt) return;

      const now = new Date().toISOString();
      await db.media.update(mediaId, {
        deletedAt: now,
        updatedAt: now,
        syncStatus: 'pending'
      });

      const deleteOp = OutboxRepository.createOperationRecord({
        entidad: 'media',
        idEntidad: mediaId,
        tipoOperacion: 'DELETE',
        versionBase: existing.serverVersion ?? null,
        payload: { id: existing.remoteId ?? existing.id }
      });

      await db.outbox.put(deleteOp);
    });
  }

};
