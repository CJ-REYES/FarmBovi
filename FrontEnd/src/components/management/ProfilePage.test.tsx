import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CattleProvider } from '../../context/CattleContext';
import { AuthService } from '../../services/auth.service';
import ProfilePage from './ProfilePage';

const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('ProfilePage — CRUD de usuario, cambio de contraseña, configuración y foto de perfil por URL', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    AuthService.logout();

    const session = {
      token: 'jwt-profile-test',
      expiraEn: new Date(Date.now() + 3600_000).toISOString(),
      idUsuario: USER_ID,
      nombre: 'Carlos Original',
      correo: 'carlos@rancho.com',
      ranchos: [],
      fotoPerfilUrl: null,
      configuracion: {
        unidadPeso: 'kg',
        diasAvisoAlertas: 7,
        sincronizacionAutomatica: true,
        formatoFecha: 'dd/MM/yyyy',
        ranchoPredeterminadoId: null
      }
    };
    window.sessionStorage.setItem('farmbovi_access_token', session.token);
    window.sessionStorage.setItem('farmbovi_session_user', JSON.stringify(session));
    AuthService.reloadFromSessionStorage();
  });

  it('actualiza perfil, cambia contraseña, guarda configuración y sube/muestra/elimina foto de perfil por URL', async () => {
    const user = userEvent.setup();
    let currentPhotoUrl: string | null = null;
    let currentName = 'Carlos Original';
    let currentEmail = 'carlos@rancho.com';
    let currentConfig = {
      unidadPeso: 'kg',
      diasAvisoAlertas: 7,
      sincronizacionAutomatica: true,
      formatoFecha: 'dd/MM/yyyy',
      ranchoPredeterminadoId: null as string | null
    };

    const buildUserDto = () => ({
      idUsuario: USER_ID,
      nombre: currentName,
      correo: currentEmail,
      estado: 'Activo',
      creadoEn: new Date().toISOString(),
      fotoPerfilUrl: currentPhotoUrl,
      configuracion: currentConfig
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();

      if (url.endsWith('/usuarios/me') && method === 'GET') {
        return new Response(JSON.stringify(buildUserDto()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/usuarios/me') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { nombre: string; correo: string };
        currentName = body.nombre;
        currentEmail = body.correo;
        return new Response(JSON.stringify(buildUserDto()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/usuarios/me/contrasena') && method === 'PUT') {
        return new Response(JSON.stringify({ mensaje: 'Contraseña actualizada correctamente.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/usuarios/me/configuracion') && method === 'PUT') {
        currentConfig = JSON.parse(String(init?.body)) as typeof currentConfig;
        return new Response(JSON.stringify(buildUserDto()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/usuarios/me/foto') && method === 'POST') {
        currentPhotoUrl = `/api/media/uploads/usuarios/${USER_ID}/perfil_123.png`;
        return new Response(JSON.stringify(buildUserDto()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/usuarios/me/foto') && method === 'DELETE') {
        currentPhotoUrl = null;
        return new Response(JSON.stringify(buildUserDto()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    render(
      <MemoryRouter>
        <CattleProvider>
          <ProfilePage />
        </CattleProvider>
      </MemoryRouter>
    );

    // 1. Actualizar datos de usuario
    const nameInput = await screen.findByLabelText(/Nombre completo/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Carlos Reyes');
    await user.click(screen.getByRole('button', { name: /Guardar Datos/i }));
    expect(
      await screen.findByText(/Datos del usuario actualizados correctamente/i)
    ).toBeInTheDocument();
    expect(AuthService.getSnapshot()?.nombre).toBe('Carlos Reyes');

    // 2. Cambiar contraseña
    await user.type(screen.getByLabelText(/Contraseña actual/i), 'Carlos123_');
    await user.type(screen.getByLabelText(/^Nueva contraseña/i), 'NuevaClave456!');
    await user.type(screen.getByLabelText(/Confirmar nueva contraseña/i), 'NuevaClave456!');
    await user.click(screen.getByRole('button', { name: /Actualizar Contraseña/i }));
    expect(
      await screen.findByText(/Contraseña actualizada correctamente/i)
    ).toBeInTheDocument();

    // 3. Guardar configuración
    await user.selectOptions(screen.getByLabelText(/Unidad de peso/i), 'lb');
    await user.click(screen.getByRole('button', { name: /Guardar Configuración/i }));
    expect(
      await screen.findByText(/Configuración del usuario guardada en el servidor/i)
    ).toBeInTheDocument();
    expect(AuthService.getSnapshot()?.configuracion?.unidadPeso).toBe('lb');

    // 4. Subir foto de perfil -> debe renderizar <img src="/api/media/uploads/...">
    const fileInput = screen.getByLabelText(/Seleccionar foto de perfil/i) as HTMLInputElement;
    const fakePng = new File([new Uint8Array([137, 80, 78, 71])], 'avatar.png', {
      type: 'image/png'
    });
    await user.upload(fileInput, fakePng);

    const avatarImg = await screen.findByAltText(/Foto de perfil de Carlos Reyes/i);
    expect(avatarImg).toHaveAttribute(
      'src',
      `/api/media/uploads/usuarios/${USER_ID}/perfil_123.png`
    );

    // 5. Quitar foto de perfil
    await user.click(screen.getByRole('button', { name: /Quitar foto/i }));
    await waitFor(() => {
      expect(screen.queryByAltText(/Foto de perfil de Carlos Reyes/i)).not.toBeInTheDocument();
    });
  });
});
