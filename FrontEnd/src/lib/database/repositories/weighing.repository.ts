import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { BaseTransactionalRepository } from './base-transactional.repository';
import { OutboxRepository } from './outbox.repository';
import type { LocalWeighing } from '../schema';

class WeighingTransactionalRepository extends BaseTransactionalRepository<LocalWeighing> {
  constructor() {
    super('weighings', db.weighings);
  }

  async getByCattleId(cattleId: string): Promise<LocalWeighing[]> {
    const items = await db.weighings
      .where('cattleId')
      .equals(cattleId)
      .filter((w) => !w.deletedAt)
      .toArray();
    return items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  /**
   * Promueve un trabajo de análisis BoviScale a un pesaje confirmado en una sola
   * transacción atómica sobre weighings, weighingAnalysisJobs y outbox.
   */
  async confirmFromAnalysisJob(params: {
    idTrabajo: string;
    pesoConfirmadoKg: number;
    fecha?: string;
    observaciones?: string;
  }): Promise<LocalWeighing> {
    return await db.transaction(
      'rw',
      [db.weighings, db.weighingAnalysisJobs, db.outbox],
      async () => {
        const job = await db.weighingAnalysisJobs.get(params.idTrabajo);
        if (!job) {
          throw new Error('Trabajo de análisis de pesaje no encontrado.');
        }
        if (job.estado === 'cancelado') {
          throw new Error('No se puede confirmar un trabajo de análisis cancelado.');
        }

        const now = new Date().toISOString();
        const weighingId = crypto.randomUUID();
        const fechaPesaje = params.fecha || now;

        const confirmedWeighing: LocalWeighing = {
          id: weighingId,
          localNumericId: computeStableNegativeId(weighingId),
          ranchId: job.ranchId,
          cattleId: job.idBovino,
          peso: params.pesoConfirmadoKg,
          fecha: fechaPesaje,
          observaciones:
            params.observaciones ??
            `Confirmado desde BoviScale (${job.pesoEstimadoKg ?? params.pesoConfirmadoKg} kg est.)`,
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending',
          serverVersion: null,
          deletedAt: null
        };

        await db.weighings.put(confirmedWeighing);

        await db.weighingAnalysisJobs.update(job.idTrabajo, {
          estado: 'completado',
          pesoEstimadoKg: job.pesoEstimadoKg ?? params.pesoConfirmadoKg,
          actualizadoEn: now,
          completadoEn: now
        });

        const outboxOp = OutboxRepository.createOperationRecord({
          entidad: 'weighings',
          idEntidad: weighingId,
          tipoOperacion: 'CREATE',
          versionBase: null,
          payload: {
            ...confirmedWeighing,
            sourceAnalysisJobId: job.idTrabajo,
            sourceMediaId: job.idMedia
          }
        });

        await db.outbox.put(outboxOp);
        return confirmedWeighing;
      }
    );
  }
}

export const WeighingRepository = new WeighingTransactionalRepository();
