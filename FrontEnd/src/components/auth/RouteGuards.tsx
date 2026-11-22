import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { AuthService } from '../../services/auth.service';
import { resolveSafeRedirectPath, type RedirectLocationState } from './redirect.utils';

export interface ProtectedRouteProps {
  /**
   * Si es `true` (valor por defecto), exige además que el usuario tenga al menos un rancho
   * registrado; de lo contrario redirige a `/ranch-setup` para validar contra el Backend.
   */
  requireRanch?: boolean;
  children?: ReactNode;
}

/**
 * Guardia de rutas privadas del Frontend.
 * - Sin sesión o con JWT expirado -> redirige a `/login` guardando la ruta solicitada.
 * - Con sesión pero sin rancho (cuando `requireRanch` es true) -> redirige a `/ranch-setup`.
 */
export function ProtectedRoute({ requireRanch = true, children }: ProtectedRouteProps) {
  const location = useLocation();
  const { isAuthenticated, isExpired, hasRanch } = useAuth();

  useEffect(() => {
    if (isExpired) {
      AuthService.logout();
    }
  }, [isExpired]);

  if (!isAuthenticated) {
    const state: RedirectLocationState = {
      from: {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash
      },
      reason: isExpired ? 'expired' : 'auth-required'
    };
    return <Navigate to="/login" replace state={state} />;
  }

  if (requireRanch && !hasRanch) {
    const state: RedirectLocationState = {
      from: {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash
      },
      reason: 'ranch-required'
    };
    return <Navigate to="/ranch-setup" replace state={state} />;
  }

  return children ? <>{children}</> : <Outlet />;
}

export interface PublicOnlyRouteProps {
  children?: ReactNode;
}

/**
 * Guardia para rutas exclusivas de visitantes no autenticados (`/login`, `/register`).
 * - Si ya tiene sesión y rancho -> redirige al destino original o `/dashboard`.
 * - Si ya tiene sesión pero sin rancho -> redirige a `/ranch-setup`.
 */
export function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const location = useLocation();
  const { isAuthenticated, hasRanch } = useAuth();

  if (isAuthenticated) {
    if (hasRanch) {
      const target = resolveSafeRedirectPath(location.state, '/dashboard');
      return <Navigate to={target} replace />;
    }
    return <Navigate to="/ranch-setup" replace state={location.state} />;
  }

  return children ? <>{children}</> : <Outlet />;
}
