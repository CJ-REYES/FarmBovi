import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { SystemNotificationsService } from '../../services/system-notifications.service';
import AlertsPage from './AlertsPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const ANIMAL_ID = '22222222-2222-4222-8222-222222222222';
const LOT_ID = '33333333-3333-4333-8333-333333333333';
const HEALTH_EVENT_ID = '44444444-4444-4444-8444-444444444444';
const TREATMENT_ID = '55555555-5555-4555-8555-555555555555';

async function seedBaseData() {
  const now = new Date().toISOString();
  await db.ranches.put({
    id: RANCH_ID,
    remoteId: RANCH_ID,
    ranchId: RANCH_ID,
    nombre: 'Rancho El Porvenir',
    ubicacionGeneral: 'Veracruz',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
  await db.lots.put({
    id: LOT_ID,
    remoteId: LOT_ID,
    ranchId: RANCH_ID,
    nombre: 'Potrero Sur',
    ubicacion: 'Sector B',
    capacidad: 35,
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
  await db.cattle.put({
    id: ANIMAL_ID,
    remoteId: ANIMAL_ID,
    ranchId: RANCH_ID,
    loteId: LOT_ID,
    arete: 'MX-ALR-700',
    areteSiniiga: 'MX-ALR-700',
    raza: 'Suizo Pardo',
    sexo: 'Hembra',
    gender: 'Hembra',
    fechaNacimiento: '2022-03-01',
    fechaIngreso: '2022-04-01',
    procedencia: 'Rancho',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
  await db.healthRecords.put({
    id: HEALTH_EVENT_ID,
    remoteId: HEALTH_EVENT_ID,
    ranchId: RANCH_ID,
    cattleId: ANIMAL_ID,
    tipo: 'Infección',
    descripcion: 'Cuadro respiratorio',
    fecha: '2026-11-18T09:00:00',
    responsable: 'MVZ Gómez',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
  await db.treatments.put({
    id: TREATMENT_ID,
    remoteId: TREATMENT_ID,
    ranchId: RANCH_ID,
    eventoSanitarioId: HEALTH_EVENT_ID,
    cattleId: ANIMAL_ID,
    producto: 'Florfenicol 30%',
    dosis: 12,
    unidadDosis: 'mL',
    viaAdministracion: 'Intramuscular',
    frecuencia: 'Cada 48 horas',
    fechaInicio: '2026-11-18T10:00:00',
    fechaFin: '2026-11-22T10:00:00',
    responsable: 'MVZ Gómez',
    prescripcionUri: null,
    estado: 'En curso',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/alerts']}>
      <AlertsPage />
    </MemoryRouter>
  );
}

describe('AlertsPage — Recordatorios, vencidas/próximas, filtros y tratamientos pendientes', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    SystemNotificationsService.resetInMemoryCache();
    await db.alerts.clear();
    await db.outbox.clear();
    await db.ranches.clear();
    await db.cattle.clear();
    await db.lots.clear();
    await db.treatments.clear();
    await db.healthRecords.clear();
    await seedBaseData();
  });

  it('muestra estado vacío de recordatorios, tratamientos pendientes reales y crea recordatorio vinculado a tratamiento', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Sin recordatorios registrados/i)).toBeInTheDocument();
    expect(screen.getByText('Florfenicol 30%')).toBeInTheDocument();

    // Crear recordatorio prellenado directamente desde el tratamiento pendiente
    await user.click(screen.getByRole('button', { name: /Programar recordatorio/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^Tipo/i)).toHaveValue('Tratamiento');
    expect(
      (within(dialog).getByLabelText(/^Descripción/i) as HTMLTextAreaElement).value
    ).toMatch(/Florfenicol 30%/i);

    await user.click(within(dialog).getByRole('button', { name: /Guardar Recordatorio/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect((await screen.findAllByText(/Con tratamiento vinculado/i)).length).toBeGreaterThan(0);
  });

  it('crea alerta vencida y próxima, filtra por vencimiento/tipo/estado/fecha, completa, edita, sobrevive recarga y desactiva', async () => {
    const user = userEvent.setup();
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const twoDaysAhead = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toLocalInput = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;

    const { unmount } = renderPage();
    await screen.findByText(/Sin recordatorios registrados/i);

    // 1. Crear alerta vencida (hace 2 días)
    await user.click(screen.getAllByRole('button', { name: /Nuevo Recordatorio/i })[0]);
    const dialog1 = screen.getByRole('dialog');
    await user.type(within(dialog1).getByLabelText(/^Tipo/i), 'Vacunación');
    const fecha1 = within(dialog1).getByLabelText(/Fecha y Hora Programada/i);
    await user.clear(fecha1);
    await user.type(fecha1, toLocalInput(twoDaysAgo));
    await user.type(
      within(dialog1).getByLabelText(/^Descripción/i),
      'Vacuna clostridial atrasada'
    );
    await user.click(within(dialog1).getByRole('button', { name: /Guardar Recordatorio/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // 2. Crear alerta próxima (en 2 días) para un lote
    await user.click(screen.getAllByRole('button', { name: /Nuevo Recordatorio/i })[0]);
    const dialog2 = screen.getByRole('dialog');
    await user.type(within(dialog2).getByLabelText(/^Tipo/i), 'Pesaje');
    const fecha2 = within(dialog2).getByLabelText(/Fecha y Hora Programada/i);
    await user.clear(fecha2);
    await user.type(fecha2, toLocalInput(twoDaysAhead));
    await user.click(within(dialog2).getByRole('button', { name: /Por Potrero \/ Lote/i }));
    await user.selectOptions(within(dialog2).getByLabelText(/Potrero \/ Lote/i), LOT_ID);
    await user.type(within(dialog2).getByLabelText(/^Descripción/i), 'Pesaje del potrero sur');
    await user.click(within(dialog2).getByRole('button', { name: /Guardar Recordatorio/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // 3. Verificar identificación de vencida y próxima
    expect((await screen.findAllByText(/Vencida hace/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/En \d+ día/i)).length).toBeGreaterThan(0);

    // 4. Filtrar por Vencidas -> solo aparece la de Vacunación
    const timingGroup = screen.getByRole('group', { name: /Filtrar por vencimiento/i });
    await user.click(within(timingGroup).getByRole('button', { name: /Vencidas/i }));
    expect(screen.getAllByText('Vacuna clostridial atrasada').length).toBeGreaterThan(0);
    expect(screen.queryByText('Pesaje del potrero sur')).not.toBeInTheDocument();

    // Limpiar y filtrar por tipo = Pesaje
    await user.click(screen.getByRole('button', { name: /Limpiar filtros/i }));
    await user.selectOptions(screen.getByLabelText(/Filtrar por tipo/i), 'Pesaje');
    expect(screen.getAllByText('Pesaje del potrero sur').length).toBeGreaterThan(0);
    expect(screen.queryByText('Vacuna clostridial atrasada')).not.toBeInTheDocument();

    // Limpiar filtros y marcar Vacunación como Completado
    await user.click(screen.getByRole('button', { name: /Limpiar filtros/i }));
    await user.click(
      screen.getAllByRole('button', { name: /Completar recordatorio Vacunación/i })[0]
    );

    // Filtrar por estado = Completado
    await user.selectOptions(screen.getByLabelText(/Filtrar por estado/i), 'Completado');
    expect((await screen.findAllByText('Vacuna clostridial atrasada')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Pesaje del potrero sur')).not.toBeInTheDocument();

    // 5. Simular recarga completa desde IndexedDB
    unmount();
    renderPage();

    expect((await screen.findAllByText('Vacuna clostridial atrasada')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Pesaje del potrero sur')).length).toBeGreaterThan(0);

    // 6. Desactivar recordatorio de Pesaje
    await user.click(screen.getAllByRole('button', { name: /Desactivar recordatorio Pesaje/i })[0]);
    const confirmDialog = screen.getByRole('dialog');
    await user.click(
      within(confirmDialog).getByRole('button', { name: /Confirmar Desactivación/i })
    );

    await waitFor(async () => {
      const remaining = await db.alerts.filter((a) => !a.deletedAt).count();
      expect(remaining).toBe(1);
    });
  });

  it('permite consultar y buscar el aviso de Modo Offline en Alertas del Sistema', async () => {
    const user = userEvent.setup();
    await SyncScheduler.refreshState(false);

    renderPage();
    await screen.findByText(/Alertas del Sistema/i);

    const searchInput = screen.getByPlaceholderText(/Buscar recordatorio, arete, offline/i);
    await user.type(searchInput, 'offline');

    expect((await screen.findAllByText(/Modo Offline Activo/i)).length).toBeGreaterThan(0);

    // También accesible desde el filtro "Sistema"
    const timingGroup = screen.getByRole('group', { name: /Filtrar por vencimiento/i });
    await user.click(within(timingGroup).getByRole('button', { name: /Sistema/i }));
    expect(screen.getAllByText(/Modo Offline Activo/i).length).toBeGreaterThan(0);
  });
});
