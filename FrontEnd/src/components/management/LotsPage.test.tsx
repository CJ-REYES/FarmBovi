import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import { CattleProvider } from '../../context/CattleContext';
import LotsPage from './LotsPage';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';

function setOnlineStatus(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

async function seedRanches() {
  const now = new Date().toISOString();
  await RanchRepository.upsertFromServer([
    {
      id: RANCH_A,
      remoteId: RANCH_A,
      ranchId: RANCH_A,
      nombre: 'Rancho La Esperanza',
      ubicacionGeneral: 'Candelaria, Campeche',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: RANCH_B,
      remoteId: RANCH_B,
      ranchId: RANCH_B,
      nombre: 'Rancho San Miguel',
      ubicacionGeneral: 'Escárcega, Campeche',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    }
  ]);
}

function renderLotsPage() {
  return render(
    <MemoryRouter initialEntries={['/lots']}>
      <CattleProvider>
        <LotsPage />
      </CattleProvider>
    </MemoryRouter>
  );
}

describe('LotsPage — Flujo CRUD completo, detalle, validaciones y recarga offline', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.lots.clear(),
      db.cattle.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedRanches();
  });

  it('valida campos obligatorios antes de guardar y no persiste registros inválidos', async () => {
    const user = userEvent.setup();
    renderLotsPage();

    await screen.findByText(/Sin potreros registrados/i);

    const createButtons = screen.getAllByRole('button', { name: /Crear Potrero/i });
    await user.click(createButtons[0]);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Crear Potrero/i }));

    expect(
      await within(dialog).findByText(/Debes seleccionar o indicar el rancho/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/El nombre del potrero \/ lote es obligatorio/i)
    ).toBeInTheDocument();

    expect(await db.lots.count()).toBe(0);
  });

  it('crea offline, consulta detalle con animales asignados, sobrevive recarga, edita y desactiva', async () => {
    const user = userEvent.setup();
    const { unmount } = renderLotsPage();

    await screen.findByText(/Sin potreros registrados/i);

    // 1. Crear potrero offline
    await user.click(screen.getAllByRole('button', { name: /Crear Potrero/i })[0]);
    const createDialog = await screen.findByRole('dialog');

    await user.selectOptions(within(createDialog).getByLabelText(/^Rancho/i), RANCH_A);
    await user.type(within(createDialog).getByLabelText(/Nombre del Potrero/i), 'Potrero La Ceiba');
    await user.type(within(createDialog).getByLabelText(/Ubicación/i), 'Sector Norte');

    await user.click(within(createDialog).getByRole('button', { name: /Crear Potrero/i }));

    // Confirmación y visibilidad en listado con insignia Pendiente
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Potrero La Ceiba')).toBeInTheDocument();
    expect(screen.getByText(/Pendiente/i)).toBeInTheDocument();

    const storedLots = await db.lots.toArray();
    expect(storedLots).toHaveLength(1);
    const createdLotId = storedLots[0].id;

    // Sembrar un animal activo dentro de ese potrero para comprobar el detalle y la protección de borrado
    const animalId = '77777777-7777-4777-8777-777777777777';
    await CattleRepository.upsertFromServer([
      {
        id: animalId,
        remoteId: animalId,
        ranchId: RANCH_A,
        loteId: createdLotId,
        arete: 'MX-909',
        areteSiniiga: 'MX-909',
        raza: 'Nelore',
        sexo: 'Macho',
        gender: 'M',
        fechaNacimiento: '2024-03-01',
        fechaIngreso: '2025-02-01',
        procedencia: 'Propio',
        estado: 'Activo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'synced',
        serverVersion: 1,
        deletedAt: null
      }
    ]);

    // 2. Simular recarga completa de la aplicación (desmontar y volver a montar)
    unmount();
    renderLotsPage();

    expect(await screen.findByText('Potrero La Ceiba')).toBeInTheDocument();

    // 3. Seleccionar el potrero y comprobar el panel de detalle con el animal asignado
    await user.click(screen.getByRole('button', { name: /Consultar detalle de Potrero La Ceiba/i }));
    const detailAside = await screen.findByLabelText(/Detalle del potrero seleccionado/i);
    expect(within(detailAside).getByText('Sector Norte')).toBeInTheDocument();
    expect(within(detailAside).getByText(new RegExp(createdLotId))).toBeInTheDocument();
    expect(await within(detailAside).findByRole('link', { name: 'MX-909' })).toHaveAttribute(
      'href',
      `/cattle/${animalId}`
    );

    // 4. Editar potrero (verificar que el rancho está bloqueado)
    await user.click(screen.getByRole('button', { name: /Editar Potrero La Ceiba/i }));
    const editDialog = await screen.findByRole('dialog');
    expect(within(editDialog).getByLabelText(/^Rancho/i)).toBeDisabled();

    const nameInput = within(editDialog).getByLabelText(/Nombre del Potrero/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Potrero La Ceiba Sur');
    await user.click(within(editDialog).getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const updatedMatches = await screen.findAllByText('Potrero La Ceiba Sur');
    // Se actualiza tanto la fila de la tabla como el panel de detalle abierto
    expect(updatedMatches.length).toBeGreaterThanOrEqual(2);

    // 5. Intentar desactivar lógicamente con animal asignado -> debe bloquear con mensaje claro
    await user.click(screen.getByRole('button', { name: /Desactivar Potrero La Ceiba Sur/i }));
    const deactDialog = await screen.findByRole('dialog');
    const actionSelect = within(deactDialog).getByLabelText(/Acción/i);
    // Por defecto sugiere Inactivo cuando hay animales; forzamos soft_delete para verificar la regla
    await user.selectOptions(actionSelect, 'soft_delete');
    await user.click(within(deactDialog).getByRole('button', { name: /Confirmar desactivación/i }));

    expect(
      await within(deactDialog).findByText(/No se puede desactivar el potrero/i)
    ).toBeInTheDocument();

    // Cambiar a Inactivo sí funciona
    await user.selectOptions(actionSelect, 'Inactivo');
    await user.click(within(deactDialog).getByRole('button', { name: /Aplicar cambio/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // 6. Crear un potrero vacío y desactivarlo lógicamente -> desaparece del listado y reaparece con el toggle
    await user.click(screen.getByRole('button', { name: /Crear Potrero/i }));
    const secondDialog = await screen.findByRole('dialog');
    await user.selectOptions(within(secondDialog).getByLabelText(/^Rancho/i), RANCH_B);
    await user.type(within(secondDialog).getByLabelText(/Nombre del Potrero/i), 'Potrero Temporal');
    await user.click(within(secondDialog).getByRole('button', { name: /Crear Potrero/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Potrero Temporal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Desactivar Potrero Temporal/i }));
    const tempDeactDialog = await screen.findByRole('dialog');
    await user.click(within(tempDeactDialog).getByRole('button', { name: /Confirmar desactivación/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('Potrero Temporal')).not.toBeInTheDocument();
    });

    // Activar toggle "Mostrar potreros desactivados"
    await user.click(screen.getByLabelText(/Mostrar potreros desactivados/i));
    expect(await screen.findByText('Potrero Temporal')).toBeInTheDocument();
    expect(screen.getByText('Desactivado')).toBeInTheDocument();
  });
});
