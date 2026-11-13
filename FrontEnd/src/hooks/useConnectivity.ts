import { useState, useEffect, useCallback } from 'react';
import { authApi } from '../lib/api';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

export function useConnectivity(pollIntervalMs = 30000) {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [status, setStatus] = useState<ConnectionStatus>('checking');

  const checkRealConnectivity = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOnline(false);
      setStatus('offline');
      return;
    }

    try {
      const response = await fetch('/api/cattle', {
        method: 'HEAD',
        cache: 'no-store',
        headers: authApi.token() ? { Authorization: `Bearer ${authApi.token()}` } : {},
        signal: AbortSignal.timeout(4000)
      });

      const online = response.ok || response.status === 401 || response.status === 403;
      setIsOnline(online);
      setStatus(online ? 'online' : 'offline');
    } catch {
      setIsOnline(false);
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => void checkRealConnectivity();
    const handleOffline = () => {
      setIsOnline(false);
      setStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkRealConnectivity();
    const interval = window.setInterval(checkRealConnectivity, pollIntervalMs);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(interval);
    };
  }, [checkRealConnectivity, pollIntervalMs]);

  return { isOnline, status, recheck: checkRealConnectivity };
}
