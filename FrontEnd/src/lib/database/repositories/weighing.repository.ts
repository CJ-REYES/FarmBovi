import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { BaseTransactionalRepository } from './base-transactional.repository';
import { OutboxRepository } from './outbox.repository';
import type { LocalWeighing } from '../schema';

const inFlightConfirmationJobs = new Set<string>();

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
   * Convierte un trabajo analizado y revisado por el usuario en un pesaje definitivo
   * y encola su operación en db.outbox dentro de una transacción Dexie atómica e idempotente.
   */
  async confirmFromAnalysisJob(params: {
    idTrabajo: string;
    pesoConfirmadoKg: number;
    fecha?: string;
    observaciones?: string;
  }): Promise<LocalWeighing> {
    if (!Number.isFinite(params.pesoConfirmadoKg) || params.pesoConfirmadoKg <= 0) {
      throw new Error('El peso confirmado debe ser un valor numérico mayor a 0 kg.');
    }

    if (inFlightConfirmationJobs.has(params.idTrabajo)) {
      throw new Error('Ya existe una confirmación en curso para esta captura.');
    }

    inFlightConfirmationJobs.add(params.idTrabajo);

    try {
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

          // Protección idempotente: si ya fue confirmado previamente, no duplica pesajes ni outbox
          if (job.estado === 'confirmado' && job.idPesajeConfirmado) {
            const existingConfirmed = await db.weighings.get(job.idPesajeConfirmado);
            if (existingConfirmed && !existingConfirmed.deletedAt) {
              return existingConfirmed;
            }
          }

          const alreadyLinked = await db.weighings
            .where('sourceAnalysisJobId')
            .equals(job.idTrabajo)
            .filter((w) => !w.deletedAt)
            .first();
          if (alreadyLinked) {
            return alreadyLinked;
          }

          if (job.estado !== 'pendiente_de_revision') {
            throw new Error(
              'La captura aún no cuenta con una estimación revisable del servicio de análisis.'
            );
          }

          const now = new Date().toISOString();
          const weighingId = crypto.randomUUID();
          const fechaPesaje = params.fecha || now;

          const defaultNote =
            job.pesoEstimadoKg !== null && job.pesoEstimadoKg !== undefined
              ? `Validado BoviScale IA (Est. modelo: ${job.pesoEstimadoKg.toFixed(1)} kg)`
              : 'Validado BoviScale IA';

          const confirmedWeighing: LocalWeighing = {
            id: weighingId,
            localNumericId: computeStableNegativeId(weighingId),
            ranchId: job.ranchId,
            cattleId: job.idBovino,
            peso: Number(params.pesoConfirmadoKg.toFixed(2)),
            fecha: fechaPesaje,
            observaciones: params.observaciones?.trim() || defaultNote,
            origenPesaje: 'boviscale_ia',
            sourceAnalysisJobId: job.idTrabajo,
            sourceMediaId: job.idMedia,
            createdAt: now,
            updatedAt: now,
            syncStatus: 'pending',
            serverVersion: null,
            deletedAt: null
          };

          await db.weighings.put(confirmedWeighing);

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

          await db.weighingAnalysisJobs.update(job.idTrabajo, {
            estado: 'confirmado',
            idOperacion: outboxOp.idOperacion,
            pesoConfirmadoKg: confirmedWeighing.peso,
            idPesajeConfirmado: weighingId,
            actualizadoEn: now,
            completadoEn: now
          });

          return confirmedWeighing;
        }
      );
    } finally {
      inFlightConfirmationJobs.delete(params.idTrabajo);
    }
  }
}

export const WeighingRepository = new WeighingTransactionalRepository();
