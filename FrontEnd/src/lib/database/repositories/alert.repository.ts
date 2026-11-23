import { db } from '../db';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalAlert } from '../schema';

function compareAlertsChronologically(
  a: LocalAlert,
  b: LocalAlert,
  order: 'asc' | 'desc' = 'asc'
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

class AlertTransactionalRepository extends BaseTransactionalRepository<LocalAlert> {
  constructor() {
    super('alerts', db.alerts);
  }

  async getAllWithOptions(options?: {
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<LocalAlert[]> {
    const items = await db.alerts.toArray();
    const filtered = options?.includeDeleted
      ? items
      : items.filter((a) => !a.deletedAt);

    return filtered.sort((a, b) =>
      compareAlertsChronologically(a, b, options?.order ?? 'asc')
    );
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalAlert | undefined> {
    const direct = await db.alerts.get(id);
    if (direct) return direct;
    return await db.alerts.where('remoteId').equals(id).first();
  }

  async markAsRead(identifier: string | number): Promise<LocalAlert> {
    const now = new Date().toISOString();
    return await this.update(
      identifier,
      { leida: true, estado: 'Completado', fechaCompletado: now },
      { estado: 'Completado', fechaCompletado: now }
    );
  }

  async getUnread(): Promise<LocalAlert[]> {
    return await db.alerts
      .filter((a) => !a.deletedAt && !a.leida && a.estado !== 'Completado' && a.estado !== 'Cancelado')
      .toArray();
  }

  /**
   * Hidrata o actualiza recordatorios desde la respuesta real del Backend
   * sin sobrescribir cambios locales pendientes o en conflicto.
   */
  async upsertManyFromServer(items: LocalAlert[]): Promise<void> {
    if (items.length === 0) return;

    await db.transaction('rw', [db.alerts], async () => {
      for (const incoming of items) {
        const existing =
          (await db.alerts.get(incoming.id)) ??
          (incoming.remoteId !== undefined
            ? await db.alerts.where('remoteId').equals(incoming.remoteId).first()
            : undefined);

        if (existing && (existing.syncStatus === 'pending' || existing.syncStatus === 'conflict')) {
          continue;
        }

        if (existing) {
          await db.alerts.put({
            ...existing,
            ...incoming,
            id: existing.id,
            localNumericId: existing.localNumericId
          });
        } else {
          await db.alerts.put(incoming);
        }
      }
    });
  }
}

export const AlertRepository = new AlertTransactionalRepository();
