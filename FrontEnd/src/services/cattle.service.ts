import { cattleApi } from '../lib/api';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { computeStableNegativeId } from '../lib/database/migrations';
import type { Cattle, CattleInput, CattleSex } from '../types/cattle';
import type { LocalCattle } from '../lib/database/schema';

export type ExtendedCattle = Partial<Cattle> & {
  localId: string;
  areteSiniiga?: string;
  tagNumber?: string;
  nombre?: string;
  name?: string;
  raza?: string;
  breed?: string;
  gender?: string;
  sex?: CattleSex;
  fechaNacimiento?: string;
  birthDate?: string | null;
  syncStatus?: 'synced' | 'pending' | 'conflict' | 'error';
};

export const CattleService = {
  toCattle(local: LocalCattle): ExtendedCattle {
    const sexValue: CattleSex = local.gender === 'Macho' ? 'Macho' : 'Hembra';
    const persistentNumericId =
      typeof local.remoteId === 'number'
        ? local.remoteId
        : (local.localNumericId ?? computeStableNegativeId(local.id));

    return {
      id: persistentNumericId,
      localId: local.id,
      tagNumber: local.areteSiniiga,
      areteSiniiga: local.areteSiniiga,
      nombre: local.nombre,
      name: local.nombre || '',
      breed: local.raza,
      raza: local.raza,
      sex: sexValue,
      gender: local.gender,
      birthDate: local.fechaNacimiento || null,
      fechaNacimiento: local.fechaNacimiento,
      syncStatus: local.syncStatus
    };
  },

  async getAll(): Promise<{ data: ExtendedCattle[]; source: 'server' | 'cache' }> {
    const localRecords = await CattleRepository.getAll();

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteData: Cattle[] = await cattleApi.list();
        const now = new Date().toISOString();

        const serverUpserts: LocalCattle[] = [];
        for (const remote of remoteData) {
          const existingByRemote = await CattleRepository.getByRemoteId(remote.id);
          const localUuid = existingByRemote?.id || crypto.randomUUID();
          const remoteAsAny = remote as ExtendedCattle;

          serverUpserts.push({
            id: localUuid,
            localNumericId: existingByRemote?.localNumericId ?? computeStableNegativeId(localUuid),
            remoteId: remote.id,
            areteSiniiga: remoteAsAny.areteSiniiga || remoteAsAny.tagNumber || '',
            nombre: remoteAsAny.nombre || remoteAsAny.name || '',
            raza: remoteAsAny.raza || remoteAsAny.breed || 'Cruzado',
            gender: remoteAsAny.gender || remoteAsAny.sex || 'Hembra',
            fechaNacimiento: remoteAsAny.fechaNacimiento || remoteAsAny.birthDate || undefined,
            createdAt: existingByRemote?.createdAt || now,
            updatedAt: now,
            syncStatus: 'synced',
            serverVersion: existingByRemote?.serverVersion ?? null,
            deletedAt: null
          });
        }

        if (serverUpserts.length > 0) {
          await CattleRepository.upsertFromServer(serverUpserts);
        }

        const updatedLocal = await CattleRepository.getAll();
        return { data: updatedLocal.map(this.toCattle), source: 'server' };
      } catch (err) {
        console.warn('API remota no disponible. Sirviendo desde DB Local:', err);
      }
    }

    return { data: localRecords.map(this.toCattle), source: 'cache' };
  },

  async save(input: CattleInput, id?: number | string): Promise<void> {
    if (id !== undefined && id !== null) {
      await CattleRepository.update(id, input, input);
    } else {
      await CattleRepository.create(
        {
          areteSiniiga: input.areteSiniiga,
          nombre: input.nombre,
          raza: input.raza,
          gender: input.gender,
          fechaNacimiento: input.fechaNacimiento
        },
        input
      );
    }
  },

  async delete(id: number | string): Promise<void> {
    await CattleRepository.softDelete(id);
  }
};
