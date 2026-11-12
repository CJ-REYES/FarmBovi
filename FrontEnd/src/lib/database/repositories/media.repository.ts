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

export const MediaRepository = {
  async saveCapture(options: SaveMediaCaptureOptions): Promise<{
    media: LocalMedia;
    weighingJob?: LocalWeighingAnalysisJob;
  }> {
    const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    if (options.fileOrBlob.size > MAX_SIZE_BYTES) {
      throw new Error('El archivo excede el límite máximo permitido de 10MB.');
    }

    try {
      return await db.transaction(
        'rw',
        db.media,
        db.weighingAnalysisJobs,
        db.outbox,
        async () => {
          const now = new Date().toISOString();
          const mediaId = crypto.randomUUID();
          const mimeType = options.fileOrBlob.type || 'image/jpeg';
          const extension = mimeType.split('/')[1] || 'jpg';
          const cattleUuid = options.cattleId || options.idEntidadRelacionada;

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

          const mediaRecord: LocalMedia = {
            id: mediaId,
            ranchId: options.ranchId,
            cattleId: cattleUuid,
            entidadRelacionada: options.entidadRelacionada || 'cattle',
            idEntidadRelacionada: cattleUuid,
            tipo: options.tipo,
            nombreArchivo: options.nombreArchivo || `${options.tipo.toLowerCase()}-${mediaId}.${extension}`,
            mimeType,
            tamanoBytes: options.fileOrBlob.size,
            checksumSha256: null,
            blobData: options.fileOrBlob,
            urlRemota: null,
            idOperacionSubida: uploadOperation.idOperacion,
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
          await db.outbox.put(uploadOperation);

          let weighingJob: LocalWeighingAnalysisJob | undefined;

          if (options.crearTrabajoPesaje && cattleUuid) {
            const jobId = crypto.randomUUID();
            const jobOperation = OutboxRepository.createOperationRecord({
              entidad: 'weighingAnalysisJobs',
              idEntidad: jobId,
              tipoOperacion: 'CREATE',
              versionBase: null,
              payload: {
                idTrabajo: jobId,
                idMedia: mediaId,
                idBovino: cattleUuid,
                metadatosCaptura: options.metadatosCaptura ?? null
              }
            });

            weighingJob = {
              idTrabajo: jobId,
              idMedia: mediaId,
              idBovino: cattleUuid,
              ranchId: options.ranchId,
              idOperacion: jobOperation.idOperacion,
              estado: 'pendiente_envio',
              pesoEstimadoKg: null,
              confianzaModelo: null,
              versionModelo: null,
              metadatosCaptura: options.metadatosCaptura,
              intentos: 0,
              ultimoError: null,
              fechaCreacion: now,
              actualizadoEn: now,
              completadoEn: null
            };

            await db.weighingAnalysisJobs.put(weighingJob);
            await db.outbox.put(jobOperation);
          }

          return { media: mediaRecord, weighingJob };
        }
      );
    } catch (err) {
      console.error('Error al persistir archivo multimedia en IndexedDB:', err);
      throw new Error('No se pudo guardar el archivo localmente en IndexedDB.', { cause: err });
    }
  },

  async getById(id: string): Promise<LocalMedia | undefined> {
    return await db.media.get(id);
  },

  async getByCattleId(cattleId: string): Promise<LocalMedia[]> {
    return await db.media
      .where('cattleId')
      .equals(cattleId)
      .filter((m) => !m.deletedAt)
      .toArray();
  },

  async getPendingUploads(): Promise<LocalMedia[]> {
    return await db.media
      .where('estadoArchivo')
      .anyOf('pendiente_subida', 'error_subida')
      .filter((m) => !m.deletedAt)
      .toArray();
  },

  async getWeighingJobsByCattle(idBovino: string): Promise<LocalWeighingAnalysisJob[]> {
    return await db.weighingAnalysisJobs
      .where('idBovino')
      .equals(idBovino)
      .sortBy('fechaCreacion');
  },

  async getWeighingJobsByState(estado: WeighingJobState): Promise<LocalWeighingAnalysisJob[]> {
    return await db.weighingAnalysisJobs.where('estado').equals(estado).sortBy('fechaCreacion');
  }
};
