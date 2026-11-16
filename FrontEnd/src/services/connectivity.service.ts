import { BACKEND_ROUTES, buildApiUrl, buildSafeHeaders } from '../lib/api';

export interface ConnectivityProbeResult {
  isOnline: boolean;
  backendReachable: boolean;
  checkedEndpoint: string;
  httpStatus: number | null;
  checkedAt: string;
}

type ConnectivityListener = (result: ConnectivityProbeResult) => void;

const listeners = new Set<ConnectivityListener>();
let lastKnownResult: ConnectivityProbeResult | null = null;

function notifyListeners(result: ConnectivityProbeResult): void {
  lastKnownResult = result;
  for (const listener of listeners) {
    try {
      listener(result);
    } catch (err) {
      console.error('Error en suscriptor de conectividad:', err);
    }
  }
}

export const ConnectivityService = {
  getProbeEndpoint(): string {
    return buildApiUrl(BACKEND_ROUTES.ANIMALES);
  },

  getLastResult(): ConnectivityProbeResult | null {
    return lastKnownResult;
  },

  subscribe(listener: ConnectivityListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async checkBackendAvailability(timeoutMs = 5000): Promise<ConnectivityProbeResult> {
    const checkedEndpoint = this.getProbeEndpoint();
    const checkedAt = new Date().toISOString();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const offlineResult: ConnectivityProbeResult = {
        isOnline: false,
        backendReachable: false,
        checkedEndpoint,
        httpStatus: null,
        checkedAt
      };
      notifyListeners(offlineResult);
      return offlineResult;
    }

    try {
      const response = await fetch(checkedEndpoint, {
        method: 'GET',
        headers: buildSafeHeaders(),
        credentials: 'include',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs)
      });

      const contentType = response.headers.get('Content-Type') || '';
      const isBadGateway =
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        contentType.includes('text/html');

      if (isBadGateway) {
        const gatewayResult: ConnectivityProbeResult = {
          isOnline: false,
          backendReachable: false,
          checkedEndpoint,
          httpStatus: response.status,
          checkedAt
        };
        notifyListeners(gatewayResult);
        return gatewayResult;
      }

      // 200-299, 401, 403 o 405 confirman respuesta real del controlador ASP.NET Core
      const reachable =
        response.ok ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 405;

      const probeResult: ConnectivityProbeResult = {
        isOnline: reachable,
        backendReachable: reachable,
        checkedEndpoint,
        httpStatus: response.status,
        checkedAt
      };
      notifyListeners(probeResult);
      return probeResult;
    } catch {
      const failedResult: ConnectivityProbeResult = {
        isOnline: false,
        backendReachable: false,
        checkedEndpoint,
        httpStatus: null,
        checkedAt
      };
      notifyListeners(failedResult);
      return failedResult;
    }
  }
};
