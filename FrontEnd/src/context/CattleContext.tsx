import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Cattle, CattleInput } from '../types/cattle';
import { CattleService } from '../services/cattle.service';
import { MigrationService } from '../lib/database/migration-service';

interface CattleContextType {
  cattle: Cattle[];
  loading: boolean;
  source: 'cache' | 'server' | 'unavailable';
  error: string | null;
  refresh: () => Promise<void>;
  save: (data: CattleInput, id?: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

const CattleContext = createContext<CattleContextType | undefined>(undefined);

export function CattleProvider({ children }: { children: ReactNode }) {
  const [cattle, setCattle] = useState<Cattle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [source, setSource] = useState<'cache' | 'server' | 'unavailable'>('cache');
  const [error, setError] = useState<string | null>(null);

 const fetchCattle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await MigrationService.migrateLegacyCacheIfNeeded();
      const result = await CattleService.getAll();

      const normalizedCattle: Cattle[] = result.data.map((item) => {
        return {
          ...item,
          // Conservamos el id exacto proveniente de toCattle (remoto o negativo)
          earTag: item.earTag || item.tagNumber || item.areteSiniiga || '',
          name: item.name || item.nombre || '',
          breed: item.breed || item.raza || '',
          sex: item.sex || 'Hembra'
        } as Cattle; // Casting seguro
      });

      setCattle(normalizedCattle);
      setSource(result.source);
    } catch (err) {
      console.error('Error al consultar datos de bovinos:', err);
      setError('No se pudo cargar la información ganadera.');
      setSource('unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCattle();
  }, [fetchCattle]);

  const save = async (data: CattleInput, id?: number) => {
    setLoading(true);
    try {
      await CattleService.save(data, id);
      await fetchCattle();
    } catch (err) {
      console.error('Error al guardar bovino:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: number) => {
    setLoading(true);
    try {
      await CattleService.delete(id);
      await fetchCattle();
    } catch (err) {
      console.error('Error al eliminar bovino:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return (
    <CattleContext.Provider value={{ cattle, loading, source, error, refresh: fetchCattle, save, remove }}>
      {children}
    </CattleContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSharedCattle() {
  const context = useContext(CattleContext);
  if (!context) {
    throw new Error('useSharedCattle debe utilizarse dentro de un CattleProvider');
  }
  return context;
}
