import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import { LotRepository } from '../../lib/database/repositories/lot.repository';
import { CattleProvider } from '../../context/CattleContext';
import CattleListPage from './CattleListPage';
import CattleForm from './CattleForm';
import CattleDetailPage from './CattleDetailPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const LOT_ID = '22222222-2222-4222-8222-222222222222';

function renderCattleApp(initialEntry = '/cattle') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CattleProvider>
        <Routes>
          <Route path="/cattle" element={<CattleListPage />} />
          <Route path="/cattle/new" element={<CattleForm />} />
          <Route path="/cattle/:id/edit" element={<CattleForm />} />
          <Route path="/cattle/:id" element={<CattleDetailPage />} />
        </Routes>
      </CattleProvider>
    </MemoryRouter>
  );
}

describe('Módulo de Animales — Flujo UI completo (crear, consultar, recargar, editar y desactivar)', () => {
  beforeEach(async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false
    });
    window.sessionStorage.clear();
    await Promise.all([
      db.ranches.clear(),
      db.lots.clear(),
      db.cattle.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear()
    ]);

    const now = new Date().toISOString();
    await RanchRepository.upsertFromServer([
      {
        id: RANCH_ID,
        remoteId: RANCH_ID,
        ranchId: RANCH_ID,
        nombre: 'Rancho San José',
        ubicacionGeneral: 'Campeche',
        estado: 'Activo',
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: 1,
        deletedAt: null
      }
    ]);
    await LotRepository.upsertFromServer([
      {
        id: LOT_ID,
        remoteId: LOT_ID,
        ranchId: RANCH_ID,
        nombre: 'Potrero La Ceiba',
        capacidad: 40,
        ubicacion: 'Este',
        estado: 'Activo',
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: 1,
        deletedAt: null
      }
    ]);
  });

  it('muestra validaciones específicas al enviar el formulario incompleto', async () => {
    const user = userEvent.setup();
    renderCattleApp('/cattle/new');

    await waitFor(() => {
      expect(screen.getByLabelText(/Arete \/ Identificación/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Registrar Animal/i }));

    expect(
      await screen.findByText(/El arete \/ identificación del animal es obligatorio/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/La raza del animal es obligatoria/i)).toBeInTheDocument();
    expect(await db.cattle.count()).toBe(0);
  });

  it('registra un animal offline, lo muestra en detalle, persiste tras recarga, permite editar y desactivar', async () => {
    const user = userEvent.setup();

    // 1. Alta completa desde CattleForm
    const firstRender = renderCattleApp('/cattle/new');

    await waitFor(() => {
      expect(screen.getByLabelText(/^Rancho/i)).toHaveValue(RANCH_ID);
    });

    await user.selectOptions(screen.getByLabelText(/Potrero \/ Lote asignado/i), LOT_ID);
    await user.type(screen.getByLabelText(/Arete \/ Identificación/i), 'MX-9080');
    await user.selectOptions(screen.getByLabelText(/^Sexo/i), 'Macho');
    await user.selectOptions(screen.getByLabelText(/^Raza/i), 'Angus');
    await user.clear(screen.getByLabelText(/Procedencia/i));
    await user.type(screen.getByLabelText(/Procedencia/i), 'Compra local');
    await user.type(screen.getByLabelText(/Fecha de Nacimiento/i), '2024-06-01');
    await user.type(screen.getByLabelText(/Observaciones/i), 'Sano al ingreso');

    await user.click(screen.getByRole('button', { name: /Registrar Animal/i }));

    // 2. Navega al expediente del animal con confirmación y todos los campos reales
    expect(await screen.findByRole('heading', { name: /MX-9080/i })).toBeInTheDocument();
    expect(screen.getByText(/Potrero La Ceiba/i)).toBeInTheDocument();
    expect(screen.getByText(/Compra local/i)).toBeInTheDocument();
    expect(screen.getByText(/Sano al ingreso/i)).toBeInTheDocument();

    // 3. Simular recarga completa de la aplicación (desmontar y volver a montar)
    firstRender.unmount();
    renderCattleApp('/cattle');

    expect(await screen.findByText('MX-9080')).toBeInTheDocument();
    expect(screen.getByText('Angus')).toBeInTheDocument();
    expect(screen.getByText(/Pendiente/i)).toBeInTheDocument();

    // 4. Editar animal existente
    await user.click(screen.getByRole('link', { name: /Editar MX-9080/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Arete \/ Identificación/i)).toHaveValue('MX-9080');
    });
    expect(screen.getByLabelText(/^Rancho/i)).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/^Raza/i), 'Brahman');
    await user.click(screen.getByRole('button', { name: /Guardar Cambios/i }));

    expect(await screen.findByText(/Expediente Individual/i)).toBeInTheDocument();
    expect(screen.getByText('Brahman')).toBeInTheDocument();

    // 5. Volver al listado y desactivar mediante modal accesible
    await user.click(screen.getByRole('button', { name: /Volver al inventario/i }));
    expect(await screen.findByRole('heading', { name: /Inventario de Animales/i })).toBeInTheDocument();
    expect(await screen.findByText('MX-9080')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Desactivar o registrar salida de MX-9080/i })
    );
    await user.click(await screen.findByRole('button', { name: /Confirmar desactivación/i }));

    await waitFor(() => {
      expect(screen.getByText(/No hay animales registrados/i)).toBeInTheDocument();
    });

    // 6. Al activar "Mostrar animales desactivados" se conserva el registro histórico
    await user.click(screen.getByLabelText(/Mostrar animales desactivados/i));
    expect(await screen.findByText('MX-9080')).toBeInTheDocument();
  });
});
