import { useState, useEffect, useCallback } from 'react';
import { db } from '../lib/database/db';
import { MediaRepository } from '../lib/database/repositories/media.repository';
import { WeighingRepository } from '../lib/database/repositories/weighing.repository';
import { BoviScaleAnalysisService } from '../services/boviscale-analysis.service';
import type {
  LocalCattle,
  LocalMedia,
  LocalWeighing,
  LocalWeighingAnalysisJob,
  OutboxOperationState
} from '../lib/database/schema';

export interface EnrichedBoviScaleJob {
  job: LocalWeighingAnalysisJob;
  media?: LocalMedia;
  cattle?: LocalCattle;
  confirmedWeighing?: LocalWeighing;
  outboxState?: OutboxOperationState;
}

export function useBoviScaleJobs() {
  const [jobs, setJobs] = useState<EnrichedBoviScaleJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const reloadJobs = useCallback(async () => {
    try {
      const rawJobs = await MediaRepository.getAllAnalysisJobs();
      const enriched: EnrichedBoviScaleJob[] = await Promise.all(
        rawJobs.map(async (job) => {
          const [media, cattle, confirmedWeighing, outboxOp] = await Promise.all([
            db.media.get(job.idMedia),
            db.cattle.get(job.idBovino),
            job.idPesajeConfirmado ? db.weighings.get(job.idPesajeConfirmado) : Promise.resolve(undefined),
            job.idOperacion ? db.outbox.get(job.idOperacion) : Promise.resolve(undefined)
          ]);

          return {
            job,
            media,
            cattle,
            confirmedWeighing,
            outboxState: outboxOp?.estado
          };
        })
      );

      setJobs(enriched);
      setError(null);
    } catch (err) {
      console.error('Error al cargar capturas de BoviScale:', err);
      setError('No se pudieron cargar las capturas locales de pesaje.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const init = async () => {
      await reloadJobs();
      if (active && typeof navigator !== 'undefined' && navigator.onLine) {
        await BoviScaleAnalysisService.processPendingQueue();
        if (active) await reloadJobs();
      }
    };

    void init();

    const handleOnline = () => {
      void (async () => {
        await BoviScaleAnalysisService.processPendingQueue();
        if (active) await reloadJobs();
      })();
    };

    window.addEventListener('online', handleOnline);
    const interval = window.setInterval(() => {
      void (async () => {
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          await BoviScaleAnalysisService.processPendingQueue();
        }
        if (active) await reloadJobs();
      })();
    }, 15000);

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.clearInterval(interval);
    };
  }, [reloadJobs]);

  const captureEvidence = async (params: {
    fileOrBlob: Blob;
    idBovino: string;
    angulo?: string;
    distanciaEstimadaCm?: number;
  }) => {
    const result = await MediaRepository.saveCapture({
      fileOrBlob: params.fileOrBlob,
      tipo: 'BoviScaleVision',
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: params.idBovino,
      cattleId: params.idBovino,
      crearTrabajoPesaje: true,
      metadatosCaptura: {
        angulo: params.angulo || 'Lateral 90°',
        distanciaEstimadaCm: params.distanciaEstimadaCm,
        dispositivo: typeof navigator !== 'undefined' ? navigator.platform : 'PWA'
      }
    });

    await reloadJobs();

    // Disparo asíncrono no bloqueante si hay conexión; si no hay red, permanece en pendiente_de_analisis
    if (result.weighingJob && typeof navigator !== 'undefined' && navigator.onLine) {
      void BoviScaleAnalysisService.analyzeSingleJob(result.weighingJob.idTrabajo).then(() => {
        void reloadJobs();
      });
    }

    return result;
  };

  const retryAnalysis = async (idTrabajo: string) => {
    await BoviScaleAnalysisService.retryImmediately(idTrabajo);
    await reloadJobs();
  };

  const confirmWeight = async (params: {
    idTrabajo: string;
    pesoConfirmadoKg: number;
    observaciones?: string;
  }) => {
    const weighing = await WeighingRepository.confirmFromAnalysisJob(params);
    await reloadJobs();
    return weighing;
  };

  const cancelJob = async (idTrabajo: string) => {
    await MediaRepository.cancelAnalysisJob(idTrabajo);
    await reloadJobs();
  };

  return {
    jobs,
    loading,
    error,
    reloadJobs,
    captureEvidence,
    retryAnalysis,
    confirmWeight,
    cancelJob
  };
}
