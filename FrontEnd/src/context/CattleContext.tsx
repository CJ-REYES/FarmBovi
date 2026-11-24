import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Cattle, CattleInput, LotOption, RanchOption } from '../types/cattle';
import { CattleService, type CattleMutationResult } from '../services/cattle.service';
import { MigrationService } from '../lib/database/migration-service';
import { SyncScheduler } from '../services/sync/sync-scheduler';
import { CattleContext } from './cattle-context';

export function CattleProvider({ children }: { children: ReactNode }) {
  const [cattle, setCattle] = useState<Cattle[]>([]);
  const [ranches, setRanches] = useState<RanchOption[]>([]);
  const [lots, setLots] = useState<LotOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [source, setSource] = useState<'cache' | 'server' | 'unavailable'>('cache');
  const [error, setError] = useState<string | null>(null);
  const [apiWarning, setApiWarning] = useState<string | null>(null);
  const mutationLockRef = useRef<boolean>(false);
  const lastOptionsRef = useRef<{ ranchId?: string; includeDeleted?: boolean } | undefined>(
    undefined
  );

  const loadCattle = useCallback(
    async (options?: { ranchId?: string; includeDeleted?: boolean }) => {
      if (options !== undefined) {
        lastOptionsRef.current = options;
      }
      setLoading(true);
      setError(null);
      try {
        await MigrationService.migrateLegacyCacheIfNeeded();
        const result = await CattleService.getAll(lastOptionsRef.current);
        setCattle(result.data);
        setRanches(result.ranches);
        setLots(result.lots);
        setSource(result.source);
        setApiWarning(result.warning);
      } catch (err) {
        console.error('Error al consultar datos de animales:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar la información ganadera desde el almacenamiento local.'
        );
        setSource('unavailable');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await MigrationService.migrateLegacyCacheIfNeeded();
        const result = await CattleService.getAll(lastOptionsRef.current);
        if (!active) return;
        setCattle(result.data);
        setRanches(result.ranches);
        setLots(result.lots);
        setSource(result.source);
        setApiWarning(result.warning);
        setError(null);
      } catch (err) {
        if (!active) return;
        console.error('Error inicial cargando animales:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar la información ganadera.'
        );
        setSource('unavailable');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    const unsubscribe = SyncScheduler.subscribeToDataUpdates(['cattle', 'lots', 'ranches'], () => {
      void loadCattle();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadCattle]);

  const create = useCallback(
    async (data: CattleInput): Promise<CattleMutationResult> => {
      if (mutationLockRef.current) {
        throw new Error('Ya hay un guardado en curso. Espera un momento.');
      }
      mutationLockRef.current = true;
      try {
        const result = await CattleService.create(data);
        await loadCattle();
        return result;
      } finally {
        mutationLockRef.current = false;
      }
    },
    [loadCattle]
  );

  const update = useCallback(
    async (id: string, data: CattleInput): Promise<CattleMutationResult> => {
      if (mutationLockRef.current) {
        throw new Error('Ya hay un guardado en curso. Espera un momento.');
      }
      mutationLockRef.current = true;
      try {
        const result = await CattleService.update(id, data);
        await loadCattle();
        return result;
      } finally {
        mutationLockRef.current = false;
      }
    },
    [loadCattle]
  );

  const registerExit = useCallback(
    async (
      id: string,
      params: { estado: 'Vendido' | 'Baja'; fechaSalida: string; observaciones?: string | null }
    ): Promise<CattleMutationResult> => {
      if (mutationLockRef.current) {
        throw new Error('Ya hay una operación en curso.');
      }
      mutationLockRef.current = true;
      try {
        const result = await CattleService.registerExit(id, params);
        await loadCattle();
        return result;
      } finally {
        mutationLockRef.current = false;
      }
    },
    [loadCattle]
  );

  const deactivate = useCallback(
    async (id: string): Promise<{ synced: boolean; syncMessage?: string }> => {
      if (mutationLockRef.current) {
        throw new Error('Ya hay una operación en curso.');
      }
      mutationLockRef.current = true;
      try {
        const result = await CattleService.deactivate(id);
        await loadCattle();
        return result;
      } finally {
        mutationLockRef.current = false;
      }
    },
    [loadCattle]
  );

  const getById = useCallback(async (id: string): Promise<Cattle | undefined> => {
    return await CattleService.getById(id);
  }, []);

  return (
    <CattleContext.Provider
      value={{
        cattle,
        ranches,
        lots,
        loading,
        source,
        error,
        apiWarning,
        refresh: loadCattle,
        getById,
        create,
        update,
        registerExit,
        deactivate
      }}
    >
      {children}
    </CattleContext.Provider>
  );
}
