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
  syncStatus?: 'synced' | 'pending' | 'conflict' | 'error';
};

// Mapa en memoria para vincular temporalmente IDs numéricos de la UI con UUIDs de IndexedDB
const offlineIdMap = new Map<number, string>();
let nextOfflineId = -1;

function getOfflineNumericId(uuid: string): number {
  for (const [key, val] of offlineIdMap.entries()) {
    if (val === uuid) return key;
  }
  const newId = nextOfflineId--;
  offlineIdMap.set(newId, uuid);
  return newId;
}

export const CattleService = {
  toCattle(local: LocalCattle): ExtendedCattle {
    const sexValue: CattleSex = local.gender === 'Macho' ? 'Macho' : 'Hembra';

    // Si no tiene un ID de servidor, le asignamos un número negativo local
    const numericId = typeof local.remoteId === 'number'
      ? local.remoteId
      : getOfflineNumericId(local.id);

    return {
      id: numericId,
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

        const pendingRemoteIds = localRecords
          .filter(r => r.syncStatus === 'pending' && r.remoteId)
          .map(r => String(r.remoteId));

        const localUpserts: LocalCattle[] = remoteData
          .filter(remote => !pendingRemoteIds.includes(String(remote.id)))
          .map((remote: Cattle) => {
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
        console.warn('API remota no disponible. Sirviendo desde DB Local:', err);
      }
    }
    return { data: localRecords.map(this.toCattle), source: 'cache' };
  },

  async save(input: CattleInput, id?: number): Promise<void> {
    if (id) {
      // Rastreamos el UUID real usando el mapa si es un ID negativo
      const uuid = offlineIdMap.get(id);
      const existing = await CattleRepository.getByRemoteId(id) || await CattleRepository.getById(uuid || String(id));
      if (!existing) throw new Error("Registro no encontrado localmente.");

      await CattleRepository.executeOutboxTransaction(
        { id: existing.id, ...input },
        'UPDATE',
        input
      );
    } else {
      await CattleRepository.executeOutboxTransaction(
        { ...input } as Partial<LocalCattle>,
        'CREATE',
        input
      );
    }
  },

  async delete(id: number): Promise<void> {
    // Convertimos el ID de la UI a UUID nuevamente
    const uuid = offlineIdMap.get(id);
    const existing = await CattleRepository.getByRemoteId(id) || await CattleRepository.getById(uuid || String(id));

    if (existing) {
      await CattleRepository.executeOutboxTransaction(
        { id: existing.id },
        'DELETE',
        { id }
      );
    }
  }
};
