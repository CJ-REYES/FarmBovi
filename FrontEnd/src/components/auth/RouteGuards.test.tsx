import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { APP_ROUTES } from '../../routes';
import { CattleProvider } from '../../context/CattleContext';
import { apiRequest } from '../../lib/api';
import { db } from '../../lib/database/db';
import { AuthService } from '../../services/auth.service';
import type { AuthSession } from '../../types/auth';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function seedSession(overrides: Partial<AuthSession> = {}): AuthSession {
  const session: AuthSession = {
    token: 'jwt-valid-token',
    expiraEn: new Date(Date.now() + 3600_000).toISOString(),
    idUsuario: USER_ID,
    nombre: 'Carlos Reyes',
    correo: 'carlos@rancho.com',
    ranchos: [{ idRancho: RANCH_ID, nombre: 'Rancho El Encino', rol: 'Admin' }],
    ...overrides
  };
  window.sessionStorage.setItem('farmbovi_access_token', session.token);
  window.sessionStorage.setItem('farmbovi_session_user', JSON.stringify(session));
  AuthService.reloadFromSessionStorage();
  return session;
}

function renderRealRouter(initialEntry: string) {
  const router = createMemoryRouter(APP_ROUTES, { initialEntries: [initialEntry] });
  const view = render(
    <CattleProvider>
      <RouterProvider router={router} />
    </CattleProvider>
  );
  return { router, ...view };
}

describe('Protección de Rutas del Frontend (ProtectedRoute y PublicOnlyRoute)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    AuthService.logout();
    await db.ranches.clear();
    await db.cattle.clear();
    await db.outbox.clear();
  });

  it.each([
    '/dashboard',
    '/cattle',
    '/lots',
    '/boviscale',
    '/alerts',
    '/settings',
    '/profile',
    '/ranch-setup',
    '/ruta-inexistente'
  ])('bloquea la ruta protegida %s sin sesión y redirige a /login', async (protectedPath) => {
    const { router } = renderRealRouter(protectedPath);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(
      screen.getByRole('heading', { name: /Inicia sesión en FarmBovi/i })
    ).toBeInTheDocument();
  });

  it('mantiene pública la Landing Page (/) sin sesión', () => {
    const { router } = renderRealRouter('/');
    expect(router.state.location.pathname).toBe('/');
    expect(
      screen.getByRole('heading', { name: /Control y Seguimiento Ganadero/i })
    ).toBeInTheDocument();
  });

  it('redirige a /login al intentar abrir /cattle sin sesión y devuelve a /cattle tras autenticar con rancho', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'jwt-reingreso',
            expiraEn: new Date(Date.now() + 3600_000).toISOString(),
            idUsuario: USER_ID,
            nombre: 'Carlos Reyes',
            ranchos: [{ idRancho: RANCH_ID, nombre: 'Rancho El Encino', rol: 'Admin' }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/ranchos')) {
        return new Response(
          JSON.stringify([
            {
              idRancho: RANCH_ID,
              nombre: 'Rancho El Encino',
              ubicacionGeneral: 'Veracruz, México',
              estado: 'Activo',
              creadoEn: new Date().toISOString(),
              versionRegistro: 1
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const { router } = renderRealRouter('/cattle');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });

    await user.type(screen.getByLabelText(/Correo electrónico/i), 'carlos@rancho.com');
    await user.type(screen.getByLabelText(/^Contraseña/i), 'Secreto123!');
    await user.click(screen.getByRole('button', { name: /Iniciar Sesión/i }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/cattle');
    });
  });

  it('redirige a /ranch-setup cuando un usuario autenticado SIN ranchos intenta abrir /dashboard', async () => {
    seedSession({ ranchos: [] });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/ranchos')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const { router } = renderRealRouter('/dashboard');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/ranch-setup');
    });
    expect(
      await screen.findByRole('heading', { name: /Registra tu Rancho/i, level: 2 })
    ).toBeInTheDocument();
  });

  it('redirige a /dashboard cuando un usuario ya autenticado con rancho intenta abrir /login o /register', async () => {
    seedSession();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const { router } = renderRealRouter('/login');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard');
    });
  });

  it('rechaza sesiones con token expirado y redirige a /login', async () => {
    seedSession({ expiraEn: new Date(Date.now() - 60_000).toISOString() });

    const { router } = renderRealRouter('/dashboard');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(window.sessionStorage.getItem('farmbovi_access_token')).toBeNull();
  });

  it('cierra sesión y redirige a /login automáticamente cuando el Backend responde HTTP 401 a una petición autenticada', async () => {
    seedSession();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/animales-protegidos')) {
        return new Response(JSON.stringify({ mensaje: 'Token inválido o expirado.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const { router } = renderRealRouter('/dashboard');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard');
    });

    await act(async () => {
      await expect(apiRequest('/animales-protegidos')).rejects.toThrow();
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(window.sessionStorage.getItem('farmbovi_access_token')).toBeNull();
  });
});
