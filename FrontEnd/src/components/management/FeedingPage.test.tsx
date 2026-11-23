import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import { LotRepository } from '../../lib/database/repositories/lot.repository';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import FeedingPage from './FeedingPage';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const LOT_ENGORDA = '22222222-2222-4222-8222-222222222221';
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

  await LotRepository.upsertFromServer([
    {
      id: LOT_ENGORDA,
      remoteId: LOT_ENGORDA,
      ranchId: RANCH_A,
      nombre: 'Potrero Engorda',
      capacidad: 0,
      ubicacion: 'Norte',
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
      loteId: LOT_ENGORDA,
      arete: 'MX-600',
      areteSiniiga: 'MX-600',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'M',
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

function renderFeedingPage() {
  return render(
    <MemoryRouter initialEntries={['/feeding']}>
      <FeedingPage />
    </MemoryRouter>
  );
}

describe('FeedingPage — Flujo CRUD completo, XOR lote/animal, validaciones y recarga offline', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.lots.clear(),
      db.cattle.clear(),
      db.feedingRecords.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedWorld();
  });

  it('valida campos obligatorios, cantidad > 0 y fecha fin >= inicio antes de guardar', async () => {
    const user = userEvent.setup();
    renderFeedingPage();

    await screen.findByText(/Sin registros de alimentación/i);

    await user.click(screen.getAllByRole('button', { name: /Registrar Alimentación/i })[0]);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /Registrar Alimentación/i }));

    expect(
      await within(dialog).findByText(/El nombre del alimento es obligatorio/i)
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/La cantidad debe ser un número mayor que cero/i)).toBeInTheDocument();
    expect(await db.feedingRecords.count()).toBe(0);

    // Probar fecha de fin anterior a fecha de inicio
    const inicioInput = within(dialog).getByLabelText(/Fecha y Hora de Inicio/i);
    const finInput = within(dialog).getByLabelText(/Fecha y Hora de Fin/i);
    await user.clear(inicioInput);
    await user.type(inicioInput, '2026-03-20T10:00');
    await user.type(finInput, '2026-03-10T10:00');
    await user.click(within(dialog).getByRole('button', { name: /Registrar Alimentación/i }));

    expect(
      await within(dialog).findByText(/La fecha de fin no puede ser anterior/i)
    ).toBeInTheDocument();
    expect(await db.feedingRecords.count()).toBe(0);
  });

  it('registra por lote y por animal offline, sobrevive recarga, edita y desactiva', async () => {
    const user = userEvent.setup();
    const { unmount } = renderFeedingPage();

    await screen.findByText(/Sin registros de alimentación/i);

    // 1. Crear alimentación para Potrero / Lote
    await user.click(screen.getAllByRole('button', { name: /Registrar Alimentación/i })[0]);
    const d1 = await screen.findByRole('dialog');

    await user.selectOptions(
      within(d1).getByRole('combobox', { name: /Potrero \/ Lote/i }),
      LOT_ENGORDA
    );
    await user.type(within(d1).getByLabelText(/^Alimento/i), 'Silo de Maíz');
    await user.type(within(d1).getByLabelText(/^Ración/i), 'Engorda Fase 1');
    await user.type(within(d1).getByLabelText(/^Cantidad/i), '30.5');
    await user.type(within(d1).getByLabelText(/^Frecuencia/i), '2 veces al día');
    await user.type(within(d1).getByLabelText(/Cambio de Dieta/i), 'Alta energía');
    await user.click(within(d1).getByRole('button', { name: /Registrar Alimentación/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Silo de Maíz')).toBeInTheDocument();

    // 2. Crear alimentación para Animal individual
    await user.click(screen.getByRole('button', { name: /Registrar Alimentación/i }));
    const d2 = await screen.findByRole('dialog');

    await user.click(within(d2).getByText('Animal Individual'));
    await user.click(within(d2).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(d2).getByRole('option', { name: /MX-600/i }));
    await user.type(within(d2).getByLabelText(/^Alimento/i), 'Suplemento Mineral');
    await user.type(within(d2).getByLabelText(/^Ración/i), 'Refuerzo individual');
    await user.type(within(d2).getByLabelText(/^Cantidad/i), '250');
    const unidadInput = within(d2).getByLabelText(/^Unidad/i);
    await user.clear(unidadInput);
    await user.type(unidadInput, 'g');
    await user.type(within(d2).getByLabelText(/^Frecuencia/i), 'Diaria');
    await user.click(within(d2).getByRole('button', { name: /Registrar Alimentación/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Suplemento Mineral')).toBeInTheDocument();

    // 3. Simular recarga completa -> ambos registros persisten en IndexedDB
    unmount();
    renderFeedingPage();

    expect(await screen.findByText('Silo de Maíz')).toBeInTheDocument();
    expect(screen.getByText('Suplemento Mineral')).toBeInTheDocument();

    // 4. Ver detalle de Silo de Maíz y editarlo
    await user.click(screen.getByRole('button', { name: /Ver detalle de Silo de Maíz/i }));
    const detailAside = await screen.findByLabelText(/Detalle del registro de alimentación/i);
    expect(within(detailAside).getByText('Alta energía')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Editar Silo de Maíz/i }));
    const editDialog = await screen.findByRole('dialog');
    const alimentoInput = within(editDialog).getByLabelText(/^Alimento/i);
    await user.clear(alimentoInput);
    await user.type(alimentoInput, 'Silo de Maíz Mejorado');
    await user.click(within(editDialog).getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const updatedMatches = await screen.findAllByText('Silo de Maíz Mejorado');
    expect(updatedMatches.length).toBeGreaterThanOrEqual(2);

    // 5. Desactivar lógicamente -> desaparece y reaparece con toggle
    await user.click(screen.getByRole('button', { name: /Desactivar Silo de Maíz Mejorado/i }));
    const deactDialog = await screen.findByRole('dialog');
    await user.click(within(deactDialog).getByRole('button', { name: /Confirmar desactivación/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText('Silo de Maíz Mejorado')).not.toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/Mostrar registros desactivados/i));
    expect(await screen.findByText('Silo de Maíz Mejorado')).toBeInTheDocument();
    expect(screen.getByText('Desactivado')).toBeInTheDocument();
  });
});
