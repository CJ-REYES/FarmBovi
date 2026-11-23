import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import HealthPage from './HealthPage';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';

function setOnlineStatus(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

async function seedWorld() {
  const now = new Date().toISOString();
  await RanchRepository.upsertFromServer([
    {
      id: RANCH_A,
      remoteId: RANCH_A,
      ranchId: RANCH_A,
      nombre: 'Rancho La Esperanza',
      ubicacionGeneral: 'Candelaria',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    }
  ]);

  await CattleRepository.upsertFromServer([
    {
      id: ANIMAL_1,
      remoteId: ANIMAL_1,
      ranchId: RANCH_A,
      arete: 'MX-950',
      areteSiniiga: 'MX-950',
      raza: 'Indubrasil',
      sexo: 'Hembra',
      gender: 'H',
      fechaNacimiento: '2024-01-10',
      fechaIngreso: '2024-01-10',
      procedencia: 'Propio',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    }
  ]);
}

function renderHealthPage() {
  return render(
    <MemoryRouter initialEntries={['/health']}>
      <HealthPage />
    </MemoryRouter>
  );
}

describe('HealthPage — Eventos Sanitarios, Tratamientos Pendientes, CRUD y recarga offline', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.cattle.clear(),
      db.healthRecords.clear(),
      db.treatments.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedWorld();
  });

  it('valida campos obligatorios del evento sanitario antes de guardar', async () => {
    const user = userEvent.setup();
    renderHealthPage();

    await screen.findByText(/Sin eventos sanitarios registrados/i);

    await user.click(screen.getAllByRole('button', { name: /Registrar Evento Sanitario/i })[0]);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /Registrar Evento/i }));

    expect(
      await within(dialog).findByText(/Debes seleccionar el animal del evento sanitario/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/El tipo de evento sanitario es obligatorio/i)
    ).toBeInTheDocument();
    expect(await db.healthRecords.count()).toBe(0);
  });

  it('permite abrir Nuevo Tratamiento aunque no existan eventos previos, creando el evento sanitario automáticamente', async () => {
    const user = userEvent.setup();
    renderHealthPage();

    await screen.findByText(/Sin eventos sanitarios registrados/i);

    const newTreatmentBtn = screen.getByRole('button', { name: /Nuevo Tratamiento/i });
    expect(newTreatmentBtn).not.toBeDisabled();
    await user.click(newTreatmentBtn);

    const trDialog = await screen.findByRole('dialog');
    await user.click(within(trDialog).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(trDialog).getByRole('option', { name: /MX-950/i }));

    await user.type(within(trDialog).getByLabelText(/Producto \/ Medicamento/i), 'Vitamina ADE');
    await user.type(within(trDialog).getByLabelText(/^Dosis/i), '5');
    await user.type(within(trDialog).getByLabelText(/^Frecuencia/i), 'Dosis única');
    await user.type(within(trDialog).getByLabelText(/Responsable de Aplicación/i), 'MVZ Laura');
    await user.click(within(trDialog).getByRole('button', { name: /Guardar Tratamiento/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(await db.healthRecords.count()).toBe(1);
    expect(await db.treatments.count()).toBe(1);

    await user.click(screen.getByRole('tab', { name: /Tratamientos \(1 pend\.\)/i }));
    expect(await screen.findByText('Vitamina ADE')).toBeInTheDocument();
  });

  it('registra evento y tratamiento pendiente offline, sobrevive recarga, bloquea borrado con tratamiento activo y completa ciclo', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHealthPage();

    await screen.findByText(/Sin eventos sanitarios registrados/i);

    // 1. Registrar evento usando el selector buscable por arete
    await user.click(screen.getAllByRole('button', { name: /Registrar Evento Sanitario/i })[0]);
    const evDialog = await screen.findByRole('dialog');

    await user.click(within(evDialog).getByRole('combobox', { name: /^Animal/i }));
    await user.type(within(evDialog).getByRole('searchbox', { name: /Buscar animal por arete/i }), '950');
    await user.click(within(evDialog).getByRole('option', { name: /MX-950/i }));

    await user.type(within(evDialog).getByLabelText(/Tipo de Evento/i), 'Desparasitación');
    await user.type(within(evDialog).getByLabelText(/^Responsable/i), 'MVZ Laura');
    await user.type(within(evDialog).getByLabelText(/^Diagnóstico/i), 'Control parasitario trimestral');
    await user.click(within(evDialog).getByRole('button', { name: /Registrar Evento/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Desparasitación')).toBeInTheDocument();

    // 2. Registrar tratamiento pendiente asociado al evento
    await user.click(screen.getByRole('button', { name: /Agregar tratamiento a Desparasitación/i }));
    const trDialog = await screen.findByRole('dialog');

    await user.type(within(trDialog).getByLabelText(/Producto \/ Medicamento/i), 'Ivermectina 1%');
    await user.type(within(trDialog).getByLabelText(/^Dosis/i), '8');
    await user.type(within(trDialog).getByLabelText(/^Frecuencia/i), 'Dosis única');
    await user.type(within(trDialog).getByLabelText(/Responsable de Aplicación/i), 'MVZ Laura');
    await user.click(within(trDialog).getByRole('button', { name: /Guardar Tratamiento/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // 3. Simular recarga completa -> ambos persisten en IndexedDB
    unmount();
    renderHealthPage();

    expect(await screen.findByText('Desparasitación')).toBeInTheDocument();

    // 4. Consultar pestaña de Tratamientos Pendientes
    await user.click(screen.getByRole('tab', { name: /Tratamientos \(1 pend\.\)/i }));
    expect(await screen.findByText('Ivermectina 1%')).toBeInTheDocument();

    // Marcar tratamiento como Completado -> desaparece del filtro "Solo pendientes"
    await user.click(screen.getByRole('button', { name: /Completar tratamiento Ivermectina 1%/i }));
    await waitFor(() => {
      expect(screen.queryByText('Ivermectina 1%')).not.toBeInTheDocument();
    });

    // Al desmarcar "Solo pendientes" vuelve a aparecer como Completado
    await user.click(screen.getByLabelText(/Solo tratamientos pendientes/i));
    expect(await screen.findByText('Ivermectina 1%')).toBeInTheDocument();

    // 5. Volver a Historial Sanitario e intentar desactivar evento con tratamiento activo -> bloqueado
    await user.click(screen.getByRole('tab', { name: /Historial Sanitario/i }));
    await user.click(screen.getByRole('button', { name: /Desactivar evento Desparasitación/i }));
    const deactEvDialog = await screen.findByRole('dialog');
    await user.click(within(deactEvDialog).getByRole('button', { name: /Confirmar desactivación/i }));

    expect(
      await within(deactEvDialog).findByText(/tiene 1 tratamiento\(s\) activo\(s\)/i)
    ).toBeInTheDocument();
    await user.click(within(deactEvDialog).getByRole('button', { name: /Cancelar/i }));

    // 6. Editar evento (animal bloqueado)
    await user.click(screen.getByRole('button', { name: /Editar evento Desparasitación/i }));
    const editEvDialog = await screen.findByRole('dialog');
    expect(within(editEvDialog).getByRole('combobox', { name: /^Animal/i })).toBeDisabled();
    const tipoInput = within(editEvDialog).getByLabelText(/Tipo de Evento/i);
    await user.clear(tipoInput);
    await user.type(tipoInput, 'Desparasitación Interna');
    await user.click(within(editEvDialog).getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Desparasitación Interna')).toBeInTheDocument();
  });
});
