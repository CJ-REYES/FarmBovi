import { useState, useEffect, useCallback } from 'react';
import { ConnectivityService } from '../services/connectivity.service';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

export function useConnectivity(pollIntervalMs = 30000) {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [status, setStatus] = useState<ConnectionStatus>('checking');

  const checkRealConnectivity = useCallback(async () => {
    const probe = await ConnectivityService.checkBackendAvailability();
    setIsOnline(probe.isOnline);
    setStatus(probe.isOnline ? 'online' : 'offline');
    return probe.isOnline;
  }, []);

  useEffect(() => {
    let active = true;

    const runProbe = async () => {
      const probe = await ConnectivityService.checkBackendAvailability();
      if (active) {
        setIsOnline(probe.isOnline);
        setStatus(probe.isOnline ? 'online' : 'offline');
      }
    };

    const unsubscribe = ConnectivityService.subscribe((probe) => {
      if (active) {
        setIsOnline(probe.isOnline);
        setStatus(probe.isOnline ? 'online' : 'offline');
      }
    });

    const handleOnline = () => {
      void runProbe();
    };
    const handleOffline = () => {
      if (active) {
        setIsOnline(false);
        setStatus('offline');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    void runProbe();
    const interval = window.setInterval(() => {
      void runProbe();
    }, pollIntervalMs);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(interval);
    };
  }, [pollIntervalMs]);

  return { isOnline, status, recheck: checkRealConnectivity };
}
