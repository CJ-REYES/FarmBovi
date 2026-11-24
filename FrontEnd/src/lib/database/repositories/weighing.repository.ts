import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { BaseTransactionalRepository } from './base-transactional.repository';
import { OutboxRepository } from './outbox.repository';
import type { LocalWeighing } from '../schema';
import type { EstimacionPesoBoviScaleDto } from '../../../types/weighing';

const inFlightConfirmationJobs = new Set<string>();

function compareWeighingsChronologically(
  a: LocalWeighing,
  b: LocalWeighing,
  order: 'asc' | 'desc' = 'desc'
): number {
  const timeA = Date.parse(a.fecha);
  const timeB = Date.parse(b.fecha);
  let diff =
    !Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB
      ? timeA - timeB
      : a.fecha.localeCompare(b.fecha);

  if (diff === 0) {
    diff = a.createdAt.localeCompare(b.createdAt);
  }
  if (diff === 0) {
    diff = a.id.localeCompare(b.id);
  }

  return order === 'asc' ? diff : -diff;
}

class WeighingTransactionalRepository extends BaseTransactionalRepository<LocalWeighing> {
  constructor() {
    super('weighings', db.weighings);
  }

  async getAllWithOptions(options?: {
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<LocalWeighing[]> {
    let items: LocalWeighing[];
    if (options?.cattleId) {
      items = await db.weighings.where('cattleId').equals(options.cattleId).toArray();
    } else {
      items = await db.weighings.toArray();
    }

    if (!options?.includeDeleted) {
      items = items.filter((w) => !w.deletedAt);
    }

    return items.sort((a, b) => compareWeighingsChronologically(a, b, options?.order ?? 'desc'));
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalWeighing | undefined> {
    const direct = await db.weighings.get(id);
    if (direct) return direct;
    return await db.weighings.where('remoteId').equals(id).first();
  }

  async getByCattleId(cattleId: string): Promise<LocalWeighing[]> {
    return await this.getAllWithOptions({ cattleId, includeDeleted: false, order: 'desc' });
  }

  /**
   * Registra o actualiza de forma idempotente en IndexedDB un pesaje ya validado y persistido
   * en el backend .NET a partir de BoviScale IA, conservando intactos los pesajes anteriores
   * del bovino y evitando duplicados por `idPesaje` o `idSolicitud`.
   */
  async upsertConfirmedFromBoviScale(dto: EstimacionPesoBoviScaleDto): Promise<LocalWeighing> {
    if (!Number.isFinite(dto.pesoEstimadoKg) || dto.pesoEstimadoKg <= 0) {
      throw new Error('El peso confirmado desde BoviScale debe ser mayor a 0 kg.');
    }

    return await db.transaction('rw', [db.weighings], async () => {
      const now = new Date().toISOString();

      // Protección idempotente contra respuestas duplicadas por idPesaje o idSolicitud
      const existingById = await db.weighings.get(dto.idPesaje);
      const existingByRequest =
        !existingById && dto.idSolicitud
          ? await db.weighings
              .where('sourceAnalysisJobId')
              .equals(dto.idSolicitud)
              .filter((w) => !w.deletedAt)
              .first()
          : undefined;

      const existing = existingById ?? existingByRequest;
      const targetId = existing?.id ?? dto.idPesaje;

      const record: LocalWeighing = {
        id: targetId,
        localNumericId: existing?.localNumericId ?? computeStableNegativeId(targetId),
        remoteId: dto.idPesaje,
        ranchId: dto.idRancho,
        cattleId: dto.idAnimal,
        peso: Number(dto.pesoEstimadoKg.toFixed(3)),
        fecha: dto.fechaPesaje || now,
        fuenteBascula: dto.fuenteBascula || 'BoviScale IA',
        responsable: dto.responsable || 'Operador de campo',
        observaciones: dto.observaciones ?? undefined,
        origenPesaje: 'boviscale_ia',
        sourceAnalysisJobId: dto.idSolicitud || existing?.sourceAnalysisJobId || null,
        sourceMediaId: dto.idArchivoMultimedia ?? existing?.sourceMediaId ?? null,
        createdAt: dto.creadoEn || existing?.createdAt || now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: dto.versionRegistro ?? existing?.serverVersion ?? 1,
        deletedAt: null
      };

      await db.weighings.put(record);
      return record;
    });
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
