import { useState, useEffect, useCallback, useRef } from 'react';

export function useOfflineEntity<T>(loader: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const mutationInProgressRef = useRef<boolean>(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loader();
      setItems(data);
    } catch (err) {
      console.error('Error al leer registros desde IndexedDB:', err);
      setError(err instanceof Error ? err.message : 'Error al cargar datos locales.');
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await loader();
        if (active) {
          setItems(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Error al cargar datos locales.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loader]);

  const runMutation = useCallback(
    async <R>(mutationFn: () => Promise<R>): Promise<R> => {
      if (mutationInProgressRef.current) {
        throw new Error('Ya existe una operación en curso.');
      }
      mutationInProgressRef.current = true;
      try {
        const result = await mutationFn();
        await reload();
        return result;
      } finally {
        mutationInProgressRef.current = false;
      }
    },
    [reload]
  );

  return { items, loading, error, reload, runMutation };
}
