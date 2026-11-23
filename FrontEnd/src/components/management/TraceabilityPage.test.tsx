import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import { LotRepository } from '../../lib/database/repositories/lot.repository';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import { CattleProvider } from '../../context/CattleContext';
import TraceabilityPage from './TraceabilityPage';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const LOT_NORTE = '22222222-2222-4222-8222-222222222221';
const LOT_SUR = '22222222-2222-4222-8222-222222222222';
const LOT_ENGORDA = '22222222-2222-4222-8222-222222222223';
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
      id: LOT_NORTE,
      remoteId: LOT_NORTE,
      ranchId: RANCH_A,
      nombre: 'Potrero Norte',
      capacidad: 0,
      ubicacion: 'Norte',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: LOT_SUR,
      remoteId: LOT_SUR,
      ranchId: RANCH_A,
      nombre: 'Potrero Sur',
      capacidad: 0,
      ubicacion: 'Sur',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: LOT_ENGORDA,
      remoteId: LOT_ENGORDA,
      ranchId: RANCH_A,
      nombre: 'Potrero Engorda',
      capacidad: 0,
      ubicacion: 'Este',
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
      loteId: LOT_NORTE,
      arete: 'MX-550',
      areteSiniiga: 'MX-550',
      raza: 'Brahman',
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

function renderTraceabilityPage() {
  return render(
    <MemoryRouter initialEntries={['/traceability']}>
      <CattleProvider>
        <TraceabilityPage />
      </CattleProvider>
    </MemoryRouter>
  );
}

describe('TraceabilityPage — Historial cronológico, validaciones, CRUD y persistencia offline', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.lots.clear(),
      db.cattle.clear(),
      db.movements.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedWorld();
  });

  it('valida campos obligatorios e impide movimientos inconsistentes con mismo origen y destino', async () => {
    const user = userEvent.setup();
    renderTraceabilityPage();

    await screen.findByText(/Sin movimientos registrados/i);

    await user.click(screen.getAllByRole('button', { name: /Registrar Movimiento/i })[0]);
    const dialog = await screen.findByRole('dialog');

    // Envío vacío -> muestra errores y no guarda
    await user.click(within(dialog).getByRole('button', { name: /Registrar Movimiento/i }));
    expect(
      await within(dialog).findByText(/Debes seleccionar el animal involucrado/i)
    ).toBeInTheDocument();
    expect(await db.movements.count()).toBe(0);

    // Seleccionar animal mediante el desplegable buscable (prellena origen = Potrero Norte) e intentar mismo destino = Potrero Norte
    await user.click(within(dialog).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-550/i }));
    await user.selectOptions(within(dialog).getByLabelText(/Potrero de Destino/i), LOT_NORTE);
    await user.click(within(dialog).getByRole('button', { name: /Registrar Movimiento/i }));

    expect(
      await within(dialog).findByText(/El potrero de destino no puede ser igual al potrero de origen/i)
    ).toBeInTheDocument();
    expect(await db.movements.count()).toBe(0);
  });

  it('registra movimientos offline en orden cronológico, sobrevive recarga, edita y desactiva', async () => {
    const user = userEvent.setup();
    const { unmount } = renderTraceabilityPage();

    await screen.findByText(/Sin movimientos registrados/i);

    // 1. Registrar movimiento antiguo (febrero)
    await user.click(screen.getAllByRole('button', { name: /Registrar Movimiento/i })[0]);
    const d1 = await screen.findByRole('dialog');
    await user.click(within(d1).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(d1).getByRole('option', { name: /MX-550/i }));
    const fecha1 = within(d1).getByLabelText(/Fecha y Hora/i);
    await user.clear(fecha1);
    await user.type(fecha1, '2026-02-05T08:00');
    await user.selectOptions(within(d1).getByLabelText(/Potrero de Destino/i), LOT_SUR);
    await user.type(within(d1).getByLabelText(/Motivo/i), 'Primer traslado febrero');
    await user.click(within(d1).getByRole('button', { name: /Registrar Movimiento/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/Primer traslado febrero/i)).toBeInTheDocument();

    // Verificar que el animal se actualizó atómicamente a Potrero Sur
    expect((await db.cattle.get(ANIMAL_1))?.loteId).toBe(LOT_SUR);

    // 2. Registrar segundo movimiento más reciente (marzo)
    await user.click(screen.getByRole('button', { name: /Registrar Movimiento/i }));
    const d2 = await screen.findByRole('dialog');
    await user.click(within(d2).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(d2).getByRole('option', { name: /MX-550/i }));
    const fecha2 = within(d2).getByLabelText(/Fecha y Hora/i);
    await user.clear(fecha2);
    await user.type(fecha2, '2026-03-10T15:30');
    await user.selectOptions(within(d2).getByLabelText(/Potrero de Destino/i), LOT_ENGORDA);
    await user.type(within(d2).getByLabelText(/Motivo/i), 'Segundo traslado marzo');
    await user.click(within(d2).getByRole('button', { name: /Registrar Movimiento/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // 3. Verificar orden cronológico descendente (marzo primero, febrero después)
    const timelineDesc = await screen.findByLabelText(/Historial cronológico de movimientos/i);
    const itemsDesc = within(timelineDesc).getAllByRole('listitem');
    expect(itemsDesc).toHaveLength(2);
    expect(within(itemsDesc[0]).getByText(/Segundo traslado marzo/i)).toBeInTheDocument();
    expect(within(itemsDesc[1]).getByText(/Primer traslado febrero/i)).toBeInTheDocument();

    // Cambiar a orden ascendente -> febrero primero, marzo después
    await user.click(screen.getByRole('button', { name: /Cambiar orden cronológico/i }));
    await waitFor(() => {
      const itemsAsc = within(
        screen.getByLabelText(/Historial cronológico de movimientos/i)
      ).getAllByRole('listitem');
      expect(within(itemsAsc[0]).getByText(/Primer traslado febrero/i)).toBeInTheDocument();
      expect(within(itemsAsc[1]).getByText(/Segundo traslado marzo/i)).toBeInTheDocument();
    });

    // 4. Simular recarga completa de la app -> ambos registros persisten en IndexedDB
    unmount();
    renderTraceabilityPage();

    const timelineReloaded = await screen.findByLabelText(/Historial cronológico de movimientos/i);
    expect(within(timelineReloaded).getAllByRole('listitem')).toHaveLength(2);

    const allStored = await db.movements.toArray();
    const marchMove = allStored.find((m) => m.motivo.includes('marzo'))!;

    // 5. Consultar detalle y editar el movimiento (animal inmutable)
    await user.click(screen.getByRole('button', { name: `Ver detalle del movimiento ${marchMove.id}` }));
    const detailAside = await screen.findByLabelText(/Detalle del movimiento seleccionado/i);
    expect(within(detailAside).getByText(new RegExp(marchMove.id))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Editar movimiento ${marchMove.id}` }));
    const editDialog = await screen.findByRole('dialog');
    expect(within(editDialog).getByLabelText(/^Animal/i)).toBeDisabled();

    const motivoInput = within(editDialog).getByLabelText(/Motivo/i);
    await user.clear(motivoInput);
    await user.type(motivoInput, 'Traslado marzo actualizado');
    await user.click(within(editDialog).getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const updatedMatches = await screen.findAllByText(/Traslado marzo actualizado/i);
    expect(updatedMatches.length).toBeGreaterThanOrEqual(2);

    // 6. Desactivar lógicamente el movimiento -> desaparece y reaparece con el toggle
    await user.click(screen.getByRole('button', { name: `Desactivar movimiento ${marchMove.id}` }));
    const deactDialog = await screen.findByRole('dialog');
    await user.click(within(deactDialog).getByRole('button', { name: /Confirmar desactivación/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText(/Traslado marzo actualizado/i)).not.toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/Mostrar movimientos desactivados/i));
    expect(await screen.findByText(/Traslado marzo actualizado/i)).toBeInTheDocument();
    expect(screen.getByText('Desactivado')).toBeInTheDocument();
  });

  it('permite trasladar un bovino a otro rancho desde el modal Trasladar entre Ranchos y actualiza IndexedDB y la línea de tiempo', async () => {
    const user = userEvent.setup();
    const RANCH_B = '11111111-1111-4111-8111-111111111122';
    const LOT_B1 = '22222222-2222-4222-8222-222222222299';
    const now = new Date().toISOString();

    await RanchRepository.upsertFromServer([
      {
        id: RANCH_B,
        remoteId: RANCH_B,
        ranchId: RANCH_B,
        nombre: 'Rancho San Miguel',
        ubicacionGeneral: 'Sur',
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
        id: LOT_B1,
        remoteId: LOT_B1,
        ranchId: RANCH_B,
        nombre: 'Potrero Destino B',
        capacidad: 20,
        ubicacion: 'Sector Sur',
        estado: 'Activo',
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: 1,
        deletedAt: null
      }
    ]);

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-transfer-test');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/movimientos-animales/traslado-rancho/animal')) {
        return new Response(
          JSON.stringify({
            modo: 'Animal',
            ranchoOrigenId: RANCH_A,
            ranchoOrigenNombre: 'Rancho La Esperanza',
            ranchoDestinoId: RANCH_B,
            ranchoDestinoNombre: 'Rancho San Miguel',
            animalesTrasladados: 1,
            loteTrasladado: null,
            animales: [
              {
                idAnimal: ANIMAL_1,
                idRancho: RANCH_B,
                idLote: LOT_B1,
                arete: 'MX-550',
                raza: 'Brahman',
                sexo: 'Hembra',
                fechaIngreso: '2025-05-01',
                procedencia: 'Propio',
                estado: 'Activo',
                versionRegistro: 2
              }
            ],
            movimientos: [
              {
                idMovimiento: '77777777-7777-4777-8777-777777777701',
                idAnimal: ANIMAL_1,
                idLoteOrigen: LOT_NORTE,
                idLoteDestino: LOT_B1,
                tipo: 'Traslado',
                fecha: '2026-11-22T15:00:00',
                origenExterno: 'Rancho: Rancho La Esperanza',
                destinoExterno: 'Rancho: Rancho San Miguel',
                motivo: 'Cambio de rancho por pastura',
                versionRegistro: 1
              }
            ],
            mensaje: "Bovino 'MX-550' trasladado de 'Rancho La Esperanza' a 'Rancho San Miguel'."
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    renderTraceabilityPage();
    await screen.findByText(/Sin movimientos registrados/i);

    await user.click(screen.getByRole('button', { name: /Trasladar entre Ranchos/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('combobox', { name: /Bovino a trasladar/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-550/i }));
    await user.selectOptions(within(dialog).getByLabelText(/Rancho de Destino/i), RANCH_B);
    await user.selectOptions(within(dialog).getByLabelText(/Potrero en Rancho Destino/i), LOT_B1);
    await user.type(
      within(dialog).getByLabelText(/Motivo/i),
      'Cambio de rancho por pastura'
    );
    await user.click(within(dialog).getByRole('button', { name: /Confirmar Traslado/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(
      await screen.findByText(/Bovino 'MX-550' trasladado de 'Rancho La Esperanza' a 'Rancho San Miguel'/i)
    ).toBeInTheDocument();

    const updatedAnimal = await db.cattle.get(ANIMAL_1);
    expect(updatedAnimal?.ranchId).toBe(RANCH_B);
    expect(updatedAnimal?.loteId).toBe(LOT_B1);

    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });
});
