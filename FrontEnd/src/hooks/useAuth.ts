import { useSyncExternalStore } from 'react';
import { AuthService, isSessionExpired } from '../services/auth.service';
import type { AuthSession } from '../types/auth';

export function useAuth(): {
  session: AuthSession | null;
  isAuthenticated: boolean;
  isExpired: boolean;
  hasRanch: boolean;
  logout: () => void;
} {
  const session = useSyncExternalStore(
    AuthService.subscribe,
    AuthService.getSnapshot,
    AuthService.getSnapshot
  );

  const hasSession = Boolean(session && (session.token || session.authMode === 'cookie'));
  const isExpired = hasSession && isSessionExpired(session);
  const isAuthenticated = hasSession && !isExpired;
  const hasRanch = isAuthenticated && Boolean(session && session.ranchos.length > 0);

  return {
    session: isAuthenticated ? session : null,
    isAuthenticated,
    isExpired,
    hasRanch,
    logout: () => AuthService.logout()
  };
}
