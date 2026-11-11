import { cattleApi } from '../lib/api';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import type { Cattle, CattleInput, CattleSex } from '../types/cattle';
import type { LocalCattle } from '../lib/database/schema';

type ExtendedCattle = Partial<Cattle> & {
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
};

export const CattleService = {
  toCattle(local: LocalCattle): ExtendedCattle {
    const sexValue: CattleSex = local.gender === 'Macho' ? 'Macho' : 'Hembra';

    return {
      id: typeof local.remoteId === 'number' ? local.remoteId : Number(local.id) || 0,
      tagNumber: local.areteSiniiga,
      areteSiniiga: local.areteSiniiga,
      nombre: local.nombre,
      name: local.nombre || '', // Se asegura de retornar un valor de tipo string
      breed: local.raza,
      raza: local.raza,
      sex: sexValue,
      gender: local.gender,
      birthDate: local.fechaNacimiento || null,
      fechaNacimiento: local.fechaNacimiento
    };
  },

  async getAll(): Promise<{ data: ExtendedCattle[]; source: 'server' | 'cache' }> {
    const localRecords = await CattleRepository.getAll();
    const localCattleList = localRecords.map(this.toCattle);

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remoteData: Cattle[] = await cattleApi.list();
        const now = new Date().toISOString();

        const localUpserts: LocalCattle[] = remoteData.map((remote: Cattle) => {
          const remoteAsAny = remote as ExtendedCattle;
          return {
            id: String(remote.id),
            remoteId: remote.id,
            areteSiniiga: remoteAsAny.areteSiniiga || remoteAsAny.tagNumber || '',
            nombre: remoteAsAny.nombre || remoteAsAny.name || '',
            raza: remoteAsAny.raza || remoteAsAny.breed || 'Cruzado',
            gender: remoteAsAny.gender || remoteAsAny.sex || 'Hembra',
            fechaNacimiento: remoteAsAny.fechaNacimiento || remoteAsAny.birthDate || undefined,
            createdAt: now,
            updatedAt: now,
            syncStatus: 'synced'
          };
        });

        await CattleRepository.bulkUpsert(localUpserts);
        const updatedLocal = await CattleRepository.getAll();
        return { data: updatedLocal.map(this.toCattle), source: 'server' };
      } catch (err) {
        console.warn('API remota no disponible. Sirviendo desde IndexedDB:', err);
      }
    }

    return { data: localCattleList, source: 'cache' };
  },

  async save(input: CattleInput, id?: number): Promise<void> {
    if (id) {
      const existing = await CattleRepository.getByRemoteId(id) || await CattleRepository.getById(String(id));
      if (existing) {
        await CattleRepository.update(existing.id, {
          areteSiniiga: input.areteSiniiga,
          nombre: input.nombre,
          raza: input.raza,
          gender: input.gender,
          fechaNacimiento: input.fechaNacimiento,
          syncStatus: typeof navigator !== 'undefined' && navigator.onLine ? 'synced' : 'pending'
        });
      }
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await cattleApi.update(id, input);
      }
    } else {
      const localRecord = await CattleRepository.create({
        areteSiniiga: input.areteSiniiga,
        nombre: input.nombre,
        raza: input.raza,
        gender: input.gender,
        fechaNacimiento: input.fechaNacimiento,
        syncStatus: typeof navigator !== 'undefined' && navigator.onLine ? 'synced' : 'pending'
      });

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const remoteResult = await cattleApi.create(input);
        if (remoteResult && remoteResult.id) {
          await CattleRepository.update(localRecord.id, {
            remoteId: remoteResult.id,
            syncStatus: 'synced'
          });
        }
      }
    }
  },

  async delete(id: number): Promise<void> {
    const existing = await CattleRepository.getByRemoteId(id) || await CattleRepository.getById(String(id));
    if (existing) {
      await CattleRepository.delete(existing.id);
    }
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await cattleApi.remove(id);
    }
  }
};
