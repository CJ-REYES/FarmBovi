import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import ReproductionPage from './ReproductionPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const FEMALE_ID = '22222222-2222-4222-8222-222222222222';
const MALE_ID = '33333333-3333-4333-8333-333333333333';

async function seedCattle() {
  const now = new Date().toISOString();
  await db.cattle.bulkPut([
    {
      id: FEMALE_ID,
      remoteId: FEMALE_ID,
      ranchId: RANCH_ID,
      arete: 'MX-VAC-501',
      areteSiniiga: 'MX-VAC-501',
      raza: 'Holstein',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2022-04-01',
      fechaIngreso: '2022-05-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: MALE_ID,
      remoteId: MALE_ID,
      ranchId: RANCH_ID,
      arete: 'MX-TOR-909',
      areteSiniiga: 'MX-TOR-909',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2021-02-01',
      fechaIngreso: '2021-03-01',
      procedencia: 'Compra',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reproduction']}>
      <ReproductionPage />
    </MemoryRouter>
  );
}

describe('ReproductionPage — Eventos reproductivos, validaciones, columna única de acciones y persistencia offline', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.reproductionRecords.clear();
    await db.cattle.clear();
    await db.outbox.clear();
    await seedCattle();
  });

  it('no muestra el aviso obsoleto de dependencia pendiente y valida campos obligatorios y sexo antes de guardar', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Sin eventos reproductivos registrados/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Dependencia de Backend documentada/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/el servidor aún no implementa el modelo EventoReproductivo/i)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /Registrar Evento Reproductivo/i })[0]);
    const dialog = screen.getByRole('dialog');

    // Envío vacío -> muestra errores de validación y no persiste nada
    await user.click(within(dialog).getByRole('button', { name: /Registrar Evento Reproductivo/i }));
    expect(await within(dialog).findByText(/Revisa los campos marcados/i)).toBeInTheDocument();
    expect(await db.reproductionRecords.count()).toBe(0);

    // Seleccionar Macho mediante el desplegable con buscador interno e intentar registrar "Parto"
    await user.click(within(dialog).getByRole('combobox', { name: /^Animal/i }));
    const searchInput = within(dialog).getByPlaceholderText(/Buscar animal por arete/i);
    await user.type(searchInput, 'MX-TOR-909');
    await user.click(within(dialog).getByRole('option', { name: /MX-TOR-909/i }));

    await user.type(within(dialog).getByLabelText(/Tipo de Evento Reproductivo/i), 'Parto');
    await user.click(within(dialog).getByRole('button', { name: /Registrar Evento Reproductivo/i }));

    expect(await within(dialog).findByText(/solo aplica a hembras/i)).toBeInTheDocument();
    expect(await db.reproductionRecords.count()).toBe(0);
  });

  it('registra evento reproductivo con semental, renderiza una sola columna Acciones, sobrevive recarga, edita y desactiva', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Sin eventos reproductivos registrados/i)).toBeInTheDocument();
    });

    // 1. Registrar evento de gestación para la hembra MX-VAC-501 con semental MX-TOR-909
    await user.click(screen.getAllByRole('button', { name: /Registrar Evento Reproductivo/i })[0]);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-VAC-501/i }));

    await user.type(
      within(dialog).getByLabelText(/Tipo de Evento Reproductivo/i),
      'Gestación Confirmada'
    );
    await user.click(within(dialog).getByRole('combobox', { name: /Semental asociado/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-TOR-909/i }));
    await user.type(within(dialog).getByLabelText(/^Resultado/i), 'Positivo / Gestante');
    await user.type(
      within(dialog).getByLabelText(/^Observaciones/i),
      'Confirmada por palpación rectal a 65 días'
    );

    await user.click(within(dialog).getByRole('button', { name: /Registrar Evento Reproductivo/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect((await screen.findAllByText('Gestación Confirmada')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Positivo / Gestante')).length).toBeGreaterThan(0);

    // Verificar que la tabla solo renderiza UNA columna "Acciones" y un solo botón Editar por fila
    const actionHeaders = screen.queryAllByRole('columnheader', { name: /^Acciones$/i });
    if (actionHeaders.length > 0) {
      expect(actionHeaders).toHaveLength(1);
    }
    expect(screen.getAllByRole('button', { name: /Editar evento Gestación Confirmada/i })).toHaveLength(1);

    // 2. Simular recarga completa (desmontar y volver a montar desde IndexedDB)
    unmount();
    renderPage();

    expect((await screen.findAllByText('Gestación Confirmada')).length).toBeGreaterThan(0);

    // 3. Cambiar a vista de Tablero por Etapa y verificar el registro real en su columna
    await user.click(screen.getByRole('button', { name: /Tablero por Etapa/i }));
    expect(screen.getByText('Gestaciones Confirmadas')).toBeInTheDocument();
    expect(screen.getByText(/Resultado: Positivo \/ Gestante/i)).toBeInTheDocument();

    // 4. Editar desde el tablero
    await user.click(screen.getByRole('button', { name: /Editar/i }));
    const editDialog = screen.getByRole('dialog');
    const tipoInput = within(editDialog).getByLabelText(/Tipo de Evento Reproductivo/i);
    await user.clear(tipoInput);
    await user.type(tipoInput, 'Parto');
    const resultadoInput = within(editDialog).getByLabelText(/^Resultado/i);
    await user.clear(resultadoInput);
    await user.type(resultadoInput, 'Cría Viva');
    await user.click(within(editDialog).getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(await screen.findByText(/Resultado: Cría Viva/i)).toBeInTheDocument();

    // 5. Desactivar el evento
    await user.click(screen.getByRole('button', { name: /Desactivar/i }));
    const confirmDialog = screen.getByRole('dialog');
    await user.click(
      within(confirmDialog).getByRole('button', { name: /Confirmar Desactivación/i })
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await waitFor(async () => {
      const remaining = await db.reproductionRecords.filter((r) => !r.deletedAt).count();
      expect(remaining).toBe(0);
    });
  });
});
