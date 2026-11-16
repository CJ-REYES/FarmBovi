import { BACKEND_ROUTES, buildApiUrl, buildSafeHeaders } from '../lib/api';

export interface ConnectivityProbeResult {
  isOnline: boolean;
  backendReachable: boolean;
  checkedEndpoint: string;
  httpStatus: number | null;
  checkedAt: string;
}

export const ConnectivityService = {
  getProbeEndpoint(): string {
    return buildApiUrl(BACKEND_ROUTES.ANIMALES);
  },

  async checkBackendAvailability(timeoutMs = 5000): Promise<ConnectivityProbeResult> {
    const checkedEndpoint = this.getProbeEndpoint();
    const checkedAt = new Date().toISOString();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        isOnline: false,
        backendReachable: false,
        checkedEndpoint,
        httpStatus: null,
        checkedAt
      };
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
      // Si el proxy de desarrollo devuelve HTML (index.html) o 502/503/504, el backend real está caído
      const isBadGateway =
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        contentType.includes('text/html');

      if (isBadGateway) {
        return {
          isOnline: false,
          backendReachable: false,
          checkedEndpoint,
          httpStatus: response.status,
          checkedAt
        };
      }

      // 200-299, 401, 403 o 405 confirman que el servidor ASP.NET Core respondió activamente
      const reachable =
        response.ok ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 405;

      return {
        isOnline: reachable,
        backendReachable: reachable,
        checkedEndpoint,
        httpStatus: response.status,
        checkedAt
      };
    } catch {
      return {
        isOnline: false,
        backendReachable: false,
        checkedEndpoint,
        httpStatus: null,
        checkedAt
      };
    }
  }
};
