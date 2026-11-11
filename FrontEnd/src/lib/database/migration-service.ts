import { CattleRepository } from './repositories/cattle.repository';
import type { LocalCattle } from './schema';

const LEGACY_CACHE_KEY = 'farmbovi_cattle_cache_v1';
const MIGRATION_FLAG_KEY = 'farmbovi_indexeddb_migrated';

export const MigrationService = {
  async migrateLegacyCacheIfNeeded(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    const isAlreadyMigrated = localStorage.getItem(MIGRATION_FLAG_KEY);
    if (isAlreadyMigrated === 'true') {
      return true;
    }

    try {
      const legacyDataRaw = localStorage.getItem(LEGACY_CACHE_KEY);
      if (!legacyDataRaw) {
        localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
        return true;
      }

      const legacyItems = JSON.parse(legacyDataRaw);
      if (Array.isArray(legacyItems) && legacyItems.length > 0) {
        const now = new Date().toISOString();
        const recordsToImport: LocalCattle[] = legacyItems.map((item) => ({
          id: item.id ? String(item.id) : crypto.randomUUID(),
          remoteId: item.id || undefined,
          areteSiniiga: item.areteSiniiga || item.tagNumber || 'SIN ARETE',
          nombre: item.nombre || item.name || '',
          raza: item.raza || item.breed || 'Cruzado',
          gender: item.gender || item.sex || 'Hembra',
          fechaNacimiento: item.fechaNacimiento || undefined,
          createdAt: item.createdAt || now,
          updatedAt: now,
          syncStatus: 'synced'
        }));

        await CattleRepository.bulkUpsert(recordsToImport);
      }

      // Marcar migración como completada únicamente tras importación exitosa
      localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
      console.log('Migración de caché local a FarmBoviLocalDB completada exitosamente.');
      return true;
    } catch (error) {
      console.error('Error durante la migración de la caché previa:', error);
      return false;
    }
  }
};
