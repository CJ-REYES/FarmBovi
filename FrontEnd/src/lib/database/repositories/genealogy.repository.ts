import { db } from '../db';
import { computeStableNegativeId } from '../migrations';
import { BaseTransactionalRepository } from './base-transactional.repository';
import type { LocalGenealogy } from '../schema';

class GenealogyTransactionalRepository extends BaseTransactionalRepository<LocalGenealogy> {
  constructor() {
    super('genealogy', db.genealogy);
  }

  async getAllWithOptions(options?: {
    includeDeleted?: boolean;
  }): Promise<LocalGenealogy[]> {
    const items = await db.genealogy.toArray();
    const filtered = options?.includeDeleted
      ? items
      : items.filter((g) => !g.deletedAt);

    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getByIdIncludingDeleted(id: string): Promise<LocalGenealogy | undefined> {
    const direct = await db.genealogy.get(id);
    if (direct) return direct;
    const byRemote = await db.genealogy.where('remoteId').equals(id).first();
    if (byRemote) return byRemote;
    return await db.genealogy.where('cattleId').equals(id).first();
  }

  async getByCattleId(cattleId: string): Promise<LocalGenealogy | undefined> {
    return await db.genealogy
      .where('cattleId')
      .equals(cattleId)
      .filter((g) => !g.deletedAt)
      .first();
  }

  async getDescendantsOf(animalId: string): Promise<LocalGenealogy[]> {
    const [asFather, asMother] = await Promise.all([
      db.genealogy.where('padreId').equals(animalId).filter((g) => !g.deletedAt).toArray(),
      db.genealogy.where('madreId').equals(animalId).filter((g) => !g.deletedAt).toArray()
    ]);

    const uniqueByCattleId = new Map<string, LocalGenealogy>();
    for (const rec of [...asFather, ...asMother]) {
      if (!uniqueByCattleId.has(rec.cattleId)) {
        uniqueByCattleId.set(rec.cattleId, rec);
      }
    }

    return Array.from(uniqueByCattleId.values());
  }

  /**
   * Persiste una relación genealógica confirmada por el servidor como `synced`
   * evitando duplicados por `cattleId` y confirmando cualquier operación local pendiente previa.
   */
  async upsertConfirmedFromServer(record: {
    idGenealogia: string;
    idAnimal: string;
    idPadre: string | null;
    idMadre: string | null;
    observaciones: string | null;
    ranchId?: string;
    createdAt?: string;
    versionRegistro: number;
    deletedAt?: string | null;
  }): Promise<LocalGenealogy> {
    const now = new Date().toISOString();
    return await db.transaction('rw', [db.genealogy, db.outbox], async () => {
      const existingByRemote =
        (await db.genealogy.get(record.idGenealogia)) ??
        (await db.genealogy.where('remoteId').equals(record.idGenealogia).first());
      const existingByAnimal = await db.genealogy
        .where('cattleId')
        .equals(record.idAnimal)
        .first();

      const existing = existingByRemote ?? existingByAnimal;

      // Si existía un registro duplicado distinto para el mismo animal, limpiarlo antes de guardar
      if (existingByRemote && existingByAnimal && existingByRemote.id !== existingByAnimal.id) {
        await db.genealogy.delete(existingByAnimal.id);
      }

      const stableId = existing?.id ?? record.idGenealogia;
      const persisted: LocalGenealogy = {
        id: stableId,
        localNumericId: existing?.localNumericId ?? computeStableNegativeId(stableId),
        remoteId: record.idGenealogia,
        ranchId: record.ranchId || existing?.ranchId,
        cattleId: record.idAnimal,
        padreId: record.idPadre ?? undefined,
        madreId: record.idMadre ?? undefined,
        observaciones: record.observaciones ?? null,
        createdAt: record.createdAt || existing?.createdAt || now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: record.versionRegistro,
        deletedAt: record.deletedAt ?? null
      };

      await db.genealogy.put(persisted);

      const pendingOps = await db.outbox
        .where('idEntidad')
        .equals(stableId)
        .filter((op) => op.entidad === 'genealogy' && op.estado !== 'confirmado')
        .toArray();
      for (const op of pendingOps) {
        await db.outbox.update(op.idOperacion, {
          estado: 'confirmado',
          ultimoError: null,
          proximoIntento: null
        });
      }

      return persisted;
    });
  }

  /**
   * Marca como desactivado lógicamente en caché un registro ya eliminado en el servidor,
   * sin encolar una nueva operación de outbox.
   */
  async markDeletedFromServer(idAnimal: string, nextVersion?: number): Promise<void> {
    const now = new Date().toISOString();
    await db.transaction('rw', [db.genealogy, db.outbox], async () => {
      const matches = await db.genealogy.where('cattleId').equals(idAnimal).toArray();
      for (const item of matches) {
        await db.genealogy.update(item.id, {
          deletedAt: now,
          updatedAt: now,
          syncStatus: 'synced',
          serverVersion: nextVersion ?? (Number(item.serverVersion ?? 1) + 1)
        });

        const pendingOps = await db.outbox
          .where('idEntidad')
          .equals(item.id)
          .filter((op) => op.entidad === 'genealogy' && op.estado !== 'confirmado')
          .toArray();
        for (const op of pendingOps) {
          await db.outbox.update(op.idOperacion, {
            estado: 'confirmado',
            ultimoError: null,
            proximoIntento: null
          });
        }
      }
    });
  }

  /**
   * Reconcilia una instantánea autoritativa del servidor contra IndexedDB:
   * - Actualiza/inserta todos los registros remotos sin sobrescribir cambios locales pendientes.
   * - Si el servidor ya no devuelve un registro que localmente figuraba `synced` y activo,
   *   lo marca como eliminado lógicamente en caché para mantener consistencia real.
   */
  async reconcileServerSnapshot(
    remoteItems: Array<{
      idGenealogia: string;
      idAnimal: string;
      idPadre: string | null;
      idMadre: string | null;
      observaciones: string | null;
      ranchId?: string;
      createdAt: string;
      versionRegistro: number;
    }>,
    options?: {
      scopedRanchId?: string;
      includeDeleted?: boolean;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    const remoteByAnimal = new Map(remoteItems.map((item) => [item.idAnimal, item]));

    await db.transaction('rw', db.genealogy, async () => {
      const localAll = await db.genealogy.toArray();
      const localByAnimal = new Map<string, LocalGenealogy>();
      const localByRemoteId = new Map<string, LocalGenealogy>();

      for (const local of localAll) {
        if (!localByAnimal.has(local.cattleId)) {
          localByAnimal.set(local.cattleId, local);
        }
        if (typeof local.remoteId === 'string') {
          localByRemoteId.set(local.remoteId, local);
        }
      }

      for (const remote of remoteItems) {
        const existing =
          localByRemoteId.get(remote.idGenealogia) ?? localByAnimal.get(remote.idAnimal);

        if (existing && existing.syncStatus !== 'synced') {
          continue;
        }

        const stableId = existing?.id ?? remote.idGenealogia;
        await db.genealogy.put({
          id: stableId,
          localNumericId: existing?.localNumericId ?? computeStableNegativeId(stableId),
          remoteId: remote.idGenealogia,
          ranchId: remote.ranchId || existing?.ranchId,
          cattleId: remote.idAnimal,
          padreId: remote.idPadre ?? undefined,
          madreId: remote.idMadre ?? undefined,
          observaciones: remote.observaciones ?? null,
          createdAt: remote.createdAt || existing?.createdAt || now,
          updatedAt: now,
          syncStatus: 'synced',
          serverVersion: remote.versionRegistro,
          deletedAt: null
        });
      }

      if (!options?.includeDeleted) {
        for (const local of localAll) {
          if (local.deletedAt || local.syncStatus !== 'synced') continue;
          if (options?.scopedRanchId && local.ranchId && local.ranchId !== options.scopedRanchId) {
            continue;
          }
          if (!remoteByAnimal.has(local.cattleId)) {
            await db.genealogy.update(local.id, {
              deletedAt: now,
              updatedAt: now,
              syncStatus: 'synced'
            });
          }
        }
      }
    });
  }
}

export const GenealogyRepository = new GenealogyTransactionalRepository();
