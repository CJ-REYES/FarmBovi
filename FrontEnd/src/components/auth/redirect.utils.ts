export interface RedirectLocationState {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
  reason?: 'auth-required' | 'expired';
  registeredEmail?: string;
  infoMsg?: string;
}

const AUTH_PUBLIC_PATHS = new Set(['/', '/login', '/register']);

/**
 * Valida que el destino de redirección post-login sea una ruta interna segura
 * de la aplicación y no cause bucles hacia rutas de autenticación.
 */
export function resolveSafeRedirectPath(state: unknown, fallback = '/dashboard'): string {
  if (!state || typeof state !== 'object') return fallback;
  const { from } = state as RedirectLocationState;
  if (!from || typeof from.pathname !== 'string') return fallback;

  const pathname = from.pathname.trim();
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return fallback;
  if (AUTH_PUBLIC_PATHS.has(pathname)) return fallback;

  const search = typeof from.search === 'string' ? from.search : '';
  const hash = typeof from.hash === 'string' ? from.hash : '';
  return `${pathname}${search}${hash}`;
}
