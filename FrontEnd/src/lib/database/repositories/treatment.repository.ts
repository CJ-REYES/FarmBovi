import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalTreatment } from '../schema';

function compareTreatmentsChronologically(
  a: LocalTreatment,
  b: LocalTreatment,
  order: 'asc' | 'desc' = 'desc'
): number {
  const timeA = Date.parse(a.fechaInicio);
  const timeB = Date.parse(b.fechaInicio);
  let diff =
    !Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB
      ? timeA - timeB
      : a.fechaInicio.localeCompare(b.fechaInicio);

  if (diff === 0) {
    diff = a.createdAt.localeCompare(b.createdAt);
  }
  if (diff === 0) {
    diff = a.id.localeCompare(b.id);
  }

  return order === 'asc' ? diff : -diff;
}

class TreatmentTransactionalRepository extends BaseTransactionalRepository<LocalTreatment> {
  constructor() {
    super('treatments', db.treatments);
  }

  async getAllWithOptions(options?: {
    eventoSanitarioId?: string;
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<LocalTreatment[]> {
    let items: LocalTreatment[];
    if (options?.eventoSanitarioId) {
      items = await db.treatments
        .where('eventoSanitarioId')
        .equals(options.eventoSanitarioId)
        .toArray();
    } else if (options?.cattleId) {
      items = await db.treatments.where('cattleId').equals(options.cattleId).toArray();
    } else {
      items = await db.treatments.toArray();
    }

    if (options?.cattleId && options?.eventoSanitarioId) {
      items = items.filter((t) => t.cattleId === options.cattleId);
    }

    if (!options?.includeDeleted) {
      items = items.filter((t) => !t.deletedAt);
    }

    return items.sort((a, b) => compareTreatmentsChronologically(a, b, options?.order ?? 'desc'));
  }

  async countActiveByHealthEvent(eventoSanitarioId: string): Promise<number> {
    const items = await db.treatments
      .where('eventoSanitarioId')
      .equals(eventoSanitarioId)
      .filter((t) => !t.deletedAt)
      .toArray();
    return items.length;
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalTreatment | undefined> {
    const direct = await db.treatments.get(id);
    if (direct) return direct;
    return await db.treatments.where('remoteId').equals(id).first();
  }
}

export const TreatmentRepository = new TreatmentTransactionalRepository();
