import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { AuthService } from '../../services/auth.service';
import { resolveSafeRedirectPath, type RedirectLocationState } from './redirect.utils';

export interface ProtectedRouteProps {
  children?: ReactNode;
}

/**
 * Guardia de rutas privadas del Frontend.
 * Sin sesión o con JWT expirado -> redirige a `/login` guardando la ruta solicitada.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation();
  const { isAuthenticated, isExpired } = useAuth();

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

  return children ? <>{children}</> : <Outlet />;
}

export interface PublicOnlyRouteProps {
  children?: ReactNode;
}

/**
 * Guardia para rutas exclusivas de visitantes no autenticados (`/login`, `/register`).
 * Si ya tiene sesión válida -> redirige al destino original o `/dashboard`.
 */
export function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    const target = resolveSafeRedirectPath(location.state, '/dashboard');
    return <Navigate to={target} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
