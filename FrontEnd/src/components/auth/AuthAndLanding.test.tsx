import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { CattleProvider } from '../../context/CattleContext';
import { AuthService } from '../../services/auth.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { SyncEngine } from '../../services/sync/sync-engine';
import LandingPage from '../public/LandingPage';
import Topbar from '../layout/Topbar';
import AuthPage from './AuthPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('LandingPage, AuthPage (Login / Crear Cuenta sin formulario de rancho) y Botón Sincronizar', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    AuthService.logout();
    await db.ranches.clear();
    await db.outbox.clear();
    await db.cattle.clear();
  });

  it('renderiza la Landing Page profesional con enlaces a Iniciar Sesión / Crear Cuenta y módulos interactivos', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <LandingPage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: /Control y Seguimiento Ganadero/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Iniciar Sesión/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Crear Cuenta/i }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /BoviScale Vision/i }));
    expect(screen.getByText(/Almacenamiento binario en IndexedDB/i)).toBeInTheDocument();
  });

  it('muestra solo 2 pestañas (Iniciar Sesión y Crear Cuenta) y al iniciar sesión navega directo a /dashboard sin mostrar formulario de rancho', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'jwt-real-token-123',
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

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<AuthPage initialMode="login" />} />
          <Route path="/dashboard" element={<div>Panel Principal Activo</div>} />
        </Routes>
      </MemoryRouter>
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent(/Iniciar Sesión/i);
    expect(tabs[1]).toHaveTextContent(/Crear Cuenta/i);

    await user.type(screen.getByLabelText(/Correo electrónico/i), 'carlos@rancho.com');
    await user.type(screen.getByLabelText(/^Contraseña/i), 'Secreto123!');
    await user.click(screen.getByRole('button', { name: /Iniciar Sesión/i }));

    expect(await screen.findByText('Panel Principal Activo')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nombre del rancho/i)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('farmbovi_access_token')).toBe('jwt-real-token-123');
    expect(AuthService.getSnapshot()?.nombre).toBe('Carlos Reyes');

    const storedRanch = await db.ranches.get(RANCH_ID);
    expect(storedRanch?.nombre).toBe('Rancho El Encino');

    const loginCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/auth/login'));
    expect(loginCall).toBeDefined();
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      correo: 'carlos@rancho.com',
      contrasena: 'Secreto123!'
    });
  });

  it('al iniciar sesión sin ranchos registrados entra directo a /dashboard sin pedir formulario de rancho', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'jwt-sin-rancho',
            expiraEn: new Date(Date.now() + 3600_000).toISOString(),
            idUsuario: USER_ID,
            nombre: 'Productor Nuevo',
            ranchos: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<AuthPage initialMode="login" />} />
          <Route path="/dashboard" element={<div>Acceso Directo al Panel</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Correo electrónico/i), 'nuevo@rancho.com');
    await user.type(screen.getByLabelText(/^Contraseña/i), 'Secreto123!');
    await user.click(screen.getByRole('button', { name: /Iniciar Sesión/i }));

    expect(await screen.findByText('Acceso Directo al Panel')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nombre del rancho/i)).not.toBeInTheDocument();
  });

  it('al crear cuenta envía POST /api/auth/register y redirige a /login con el correo precargado (sin entrar directo al dashboard)', async () => {
    const user = userEvent.setup();
    const captured: { user: Record<string, unknown> | null } = { user: null };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/register') && init?.method === 'POST') {
        captured.user = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            token: 'jwt-cuenta-nueva',
            expiraEn: new Date(Date.now() + 3600_000).toISOString(),
            idUsuario: USER_ID,
            nombre: captured.user.nombre,
            correo: captured.user.correo,
            ranchos: [],
            fotoPerfilUrl: null,
            configuracion: {
              unidadPeso: 'kg',
              diasAvisoAlertas: 7,
              sincronizacionAutomatica: true,
              formatoFecha: 'dd/MM/yyyy',
              ranchoPredeterminadoId: null
            }
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<AuthPage key="register" initialMode="register" />} />
          <Route path="/login" element={<AuthPage key="login" initialMode="login" />} />
          <Route path="/dashboard" element={<div>Panel tras Crear Cuenta</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Nombre completo/i), 'Ana Ganadera');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'ana@rancho.com');
    await user.type(screen.getByLabelText(/^Contraseña \*/i), 'Ganado2026!');
    await user.type(screen.getByLabelText(/Confirmar contraseña/i), 'Ganado2026!');
    await user.click(screen.getByRole('button', { name: /^Crear Cuenta$/i }));

    // Debe llevar a Iniciar Sesión y NO entrar directo al dashboard
    expect(
      await screen.findByRole('heading', { name: /Inicia sesión en FarmBovi/i })
    ).toBeInTheDocument();
    expect(screen.queryByText('Panel tras Crear Cuenta')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('farmbovi_access_token')).toBeNull();
    expect(screen.getByLabelText(/Correo electrónico/i)).toHaveValue('ana@rancho.com');
    expect(screen.getByRole('status')).toHaveTextContent(/Cuenta creada correctamente/i);
    expect(captured.user).toEqual({
      nombre: 'Ana Ganadera',
      correo: 'ana@rancho.com',
      contrasena: 'Ganado2026!'
    });
  });

  it('delega las validaciones al Backend y muestra exactamente el mensaje de error HTTP 400 retornado por el servidor', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            title: 'One or more validation errors occurred.',
            errors: {
              Correo: ['El correo electrónico no tiene un formato válido.'],
              Contrasena: ['La contraseña debe tener al menos 8 caracteres.']
            }
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthPage initialMode="login" />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /Iniciar Sesión/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/El correo electrónico no tiene un formato válido/i);
  });

  it('muestra el botón Sincronizar en el Topbar y ejecuta triggerManualSync al hacer clic en línea', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await SyncScheduler.refreshState(true);
    const syncSpy = vi.spyOn(SyncScheduler, 'triggerManualSync').mockResolvedValue(null);

    render(
      <MemoryRouter>
        <CattleProvider>
          <Topbar onMenuClick={() => undefined} onOpenSyncPanel={() => undefined} />
        </CattleProvider>
      </MemoryRouter>
    );

    const syncBtn = await screen.findByRole('button', { name: /Sincronizar datos/i });
    expect(syncBtn).toBeInTheDocument();

    await user.click(syncBtn);
    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('persiste la sesión PWA de forma segura sin guardar el JWT crudo en localStorage y la rehidrata vía GET /api/auth/session al reabrir', async () => {
    const futureExp = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'secret-jwt-never-in-localstorage',
            expiraEn: futureExp,
            idUsuario: '88888888-8888-4888-8888-888888888888',
            nombre: 'Sofía PWA',
            correo: 'sofia@rancho.mx',
            ranchos: [
              {
                idRancho: '99999999-9999-4999-8999-999999999999',
                nombre: 'Rancho Persistente',
                rol: 'Admin'
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/ranchos')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/auth/session')) {
        return new Response(
          JSON.stringify({
            expiraEn: futureExp,
            idUsuario: '88888888-8888-4888-8888-888888888888',
            nombre: 'Sofía PWA',
            correo: 'sofia@rancho.mx',
            ranchos: [
              {
                idRancho: '99999999-9999-4999-8999-999999999999',
                nombre: 'Rancho Persistente',
                rol: 'Admin'
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/auth/logout')) {
        return new Response(JSON.stringify({ mensaje: 'Sesión cerrada.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await AuthService.login('sofia@rancho.mx', 'ClaveSegura123!');

    // El JWT crudo NUNCA debe existir en localStorage (solo metadatos no sensibles)
    const rawMeta = window.localStorage.getItem('farmbovi_session_meta');
    expect(rawMeta).not.toBeNull();
    expect(rawMeta).not.toContain('secret-jwt-never-in-localstorage');

    // Simular cierre y reapertura del navegador/PWA (sessionStorage vacío, cookie HttpOnly activa)
    window.sessionStorage.clear();
    const reopened = await AuthService.bootstrapSession();
    expect(reopened).not.toBeNull();
    expect(reopened?.authMode).toBe('cookie');
    expect(reopened?.correo).toBe('sofia@rancho.mx');
    expect(
      fetchSpy.mock.calls.some(([url, init]) => {
        const u = typeof url === 'string' ? url : url.toString();
        return u.includes('/auth/session') && (init as RequestInit | undefined)?.credentials === 'include';
      })
    ).toBe(true);

    // Logout limpia sessionStorage, localStorage y notifica POST /api/auth/logout
    AuthService.logout();
    expect(window.localStorage.getItem('farmbovi_session_meta')).toBeNull();
    expect(window.sessionStorage.getItem('farmbovi_access_token')).toBeNull();
  });

  it('aisla IndexedDB al cambiar de cuenta: purga ranchos/checkpoints ajenos y evita GET /api/sync/cambios 403', async () => {
    const foreignRanchId = 'ba9af3cd-2fae-47a9-9fd8-1bbbfd0619aa';
    const now = new Date().toISOString();

    // Sembrar rancho y checkpoint residuales de otra cuenta en IndexedDB
    await db.ranches.put({
      id: foreignRanchId,
      remoteId: foreignRanchId,
      ranchId: foreignRanchId,
      nombre: 'EL DORADO (otra cuenta)',
      ubicacionGeneral: 'Sonora',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });
    await db.syncCheckpoints.put({
      entidad: 'cattle',
      cursorOpaco: 'cursor-ajeno-123',
      ultimaFechaServidor: now,
      actualizadoEn: now
    });

    const futureExp = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'jwt-new-user-0-ranches',
            expiraEn: futureExp,
            idUsuario: '77777777-7777-4777-8777-777777777777',
            nombre: 'Cuenta Nueva Sin Rancho',
            correo: 'nuevo@farmbovi.mx',
            ranchos: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/ranchos')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await AuthService.login('nuevo@farmbovi.mx', 'ClaveSegura123!');

    // El rancho y checkpoint de la cuenta anterior debieron purgarse
    expect(await db.ranches.get(foreignRanchId)).toBeUndefined();
    expect(await db.syncCheckpoints.toArray()).toHaveLength(0);

    // Pull NO debe enviar el rancho ajeno (0 llamadas a /sync/cambios -> 0 errores 403)
    fetchSpy.mockClear();
    const pullResults = await SyncEngine.pullChanges();
    expect(pullResults.every((r) => r.status === 'completed')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
