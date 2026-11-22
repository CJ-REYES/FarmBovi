import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { CattleProvider } from '../../context/CattleContext';
import { AuthService } from '../../services/auth.service';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import LandingPage from '../public/LandingPage';
import Topbar from '../layout/Topbar';
import AuthPage from './AuthPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('LandingPage, Flujo Auth + Onboarding de Rancho validado en Backend y Botón Sincronizar', () => {
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

    // Cambiar módulo interactivo a BoviScale Vision
    await user.click(screen.getByRole('button', { name: /BoviScale Vision/i }));
    expect(screen.getByText(/Almacenamiento binario en IndexedDB/i)).toBeInTheDocument();
  });

  it('muestra solo 2 pestañas (Iniciar Sesión y Crear Cuenta) y al iniciar sesión CON rancho en Backend navega directo a /dashboard sin mostrar formulario de rancho', async () => {
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
    expect(screen.queryByRole('heading', { name: /Registra tu Rancho/i })).not.toBeInTheDocument();
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

  it('al iniciar sesión SIN ranchos registrados en Backend muestra automáticamente el formulario de Registra tu Rancho y al enviarlo navega a /dashboard', async () => {
    const user = userEvent.setup();
    let capturedRanchBody: Record<string, unknown> | null = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
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
      if (url.includes('/ranchos') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/ranchos') && init?.method === 'POST') {
        capturedRanchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            idRancho: capturedRanchBody.idRancho || RANCH_ID,
            nombre: capturedRanchBody.nombre,
            ubicacionGeneral: capturedRanchBody.ubicacionGeneral,
            estado: capturedRanchBody.estado,
            creadoEn: new Date().toISOString(),
            versionRegistro: 1
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<AuthPage initialMode="login" />} />
          <Route path="/dashboard" element={<div>Panel con Rancho Recién Creado</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Correo electrónico/i), 'nuevo@rancho.com');
    await user.type(screen.getByLabelText(/^Contraseña/i), 'Secreto123!');
    await user.click(screen.getByRole('button', { name: /Iniciar Sesión/i }));

    // Backend devolvió 0 ranchos -> aparece automáticamente el Paso 2
    expect(
      await screen.findByRole('heading', { name: /Registra tu Rancho/i, level: 2 })
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nombre del rancho/i), 'Rancho Santa Clara');
    await user.type(screen.getByLabelText(/Ubicación general/i), 'Candelaria, Campeche');
    await user.click(screen.getByRole('button', { name: /Guardar Rancho y Entrar/i }));

    expect(await screen.findByText('Panel con Rancho Recién Creado')).toBeInTheDocument();
    expect(capturedRanchBody).not.toBeNull();
    expect(capturedRanchBody!.nombre).toBe('Rancho Santa Clara');
    expect(capturedRanchBody!.ubicacionGeneral).toBe('Candelaria, Campeche');
    expect(capturedRanchBody!.estado).toBe('Activo');
    expect(await db.ranches.count()).toBe(1);
  });

  it('al crear una cuenta (Paso 1) autentica contra Backend, detecta 0 ranchos y pide registrar el rancho (Paso 2)', async () => {
    const user = userEvent.setup();
    const captured: {
      user: Record<string, unknown> | null;
      ranch: Record<string, unknown> | null;
    } = { user: null, ranch: null };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/usuarios') && init?.method === 'POST') {
        captured.user = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            idUsuario: USER_ID,
            nombre: captured.user.nombre,
            correo: captured.user.correo,
            estado: captured.user.estado,
            creadoEn: new Date().toISOString()
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'jwt-cuenta-nueva',
            expiraEn: new Date(Date.now() + 3600_000).toISOString(),
            idUsuario: USER_ID,
            nombre: 'Ana Ganadera',
            ranchos: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/ranchos') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/ranchos') && init?.method === 'POST') {
        captured.ranch = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            idRancho: captured.ranch.idRancho || RANCH_ID,
            nombre: captured.ranch.nombre,
            ubicacionGeneral: captured.ranch.ubicacionGeneral,
            estado: captured.ranch.estado,
            creadoEn: new Date().toISOString(),
            versionRegistro: 1
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<AuthPage initialMode="register" />} />
          <Route path="/dashboard" element={<div>Onboarding Completo</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Nombre completo/i), 'Ana Ganadera');
    await user.type(screen.getByLabelText(/Correo electrónico/i), 'ana@rancho.com');
    await user.type(screen.getByLabelText(/^Contraseña \*/i), 'Ganado2026!');
    await user.type(screen.getByLabelText(/Confirmar contraseña/i), 'Ganado2026!');
    await user.click(screen.getByRole('button', { name: /Crear Cuenta y Continuar/i }));

    // Paso 2 aparece automáticamente tras crear la cuenta
    expect(
      await screen.findByRole('heading', { name: /Registra tu Rancho/i, level: 2 })
    ).toBeInTheDocument();
    expect(captured.user).toEqual({
      nombre: 'Ana Ganadera',
      correo: 'ana@rancho.com',
      contrasena: 'Ganado2026!',
      estado: 'Activo'
    });

    await user.type(screen.getByLabelText(/Nombre del rancho/i), 'Rancho La Esperanza');
    await user.type(screen.getByLabelText(/Ubicación general/i), 'Tabasco, México');
    await user.click(screen.getByRole('button', { name: /Guardar Rancho y Entrar/i }));

    expect(await screen.findByText('Onboarding Completo')).toBeInTheDocument();
    expect(captured.ranch?.nombre).toBe('Rancho La Esperanza');
    expect(captured.ranch?.ubicacionGeneral).toBe('Tabasco, México');
  });

  it('al entrar a /ranch-setup cuando el Backend confirma que ya tiene rancho redirige directo a /dashboard sin mostrar formulario', async () => {
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-con-rancho');
    window.sessionStorage.setItem(
      'farmbovi_session_user',
      JSON.stringify({
        token: 'jwt-con-rancho',
        expiraEn: new Date(Date.now() + 3600_000).toISOString(),
        idUsuario: USER_ID,
        nombre: 'Admin Existente',
        correo: 'admin@rancho.com',
        ranchos: []
      })
    );
    AuthService.reloadFromSessionStorage();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/ranchos')) {
        return new Response(
          JSON.stringify([
            {
              idRancho: RANCH_ID,
              nombre: 'Rancho Existente',
              ubicacionGeneral: 'Chiapas, México',
              estado: 'Activo',
              creadoEn: new Date().toISOString(),
              versionRegistro: 1
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(
      <MemoryRouter initialEntries={['/ranch-setup']}>
        <Routes>
          <Route path="/ranch-setup" element={<AuthPage initialMode="ranch" />} />
          <Route path="/dashboard" element={<div>Ya Tiene Rancho - Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Ya Tiene Rancho - Dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Registra tu Rancho/i })).not.toBeInTheDocument();
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

    // Enviar formulario vacío/incompleto -> NO debe bloquearse en cliente, debe ir al Backend
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
});
