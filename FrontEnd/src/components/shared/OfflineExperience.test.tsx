import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { CattleProvider } from '../../context/CattleContext';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import { PwaUpdateManager } from '../../pwa/update-manager';
import Topbar from '../layout/Topbar';
import PwaStatus from './PwaStatus';
import SyncStatusPanel from './SyncStatusPanel';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const ANIMAL_ID = '22222222-2222-4222-8222-222222222222';

describe('FE-03 — Experiencia Offline (Topbar, PwaStatus, Reconexión y Datos Locales)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.ranches.clear();
    await db.cattle.clear();
    await db.outbox.clear();

    const now = new Date().toISOString();
    await db.ranches.put({
      id: RANCH_ID,
      remoteId: RANCH_ID,
      ranchId: RANCH_ID,
      nombre: 'Rancho Prueba Offline',
      ubicacionGeneral: 'Veracruz',
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
      arete: 'MX-UX-01',
      areteSiniiga: 'MX-UX-01',
      raza: 'Brahman',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2022-01-01',
      fechaIngreso: '2022-02-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      serverVersion: 1,
      deletedAt: null
    });
  });

  it('refleja pérdida y recuperación de conexión en Topbar y PwaStatus, y gestiona actualizaciones PWA', async () => {
    const user = userEvent.setup();
    await SyncScheduler.refreshState(true);

    render(
      <MemoryRouter>
        <CattleProvider>
          <Topbar onMenuClick={() => undefined} />
          <PwaStatus />
        </CattleProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('En línea')).toBeInTheDocument();

    // 1. Pérdida de conexión -> Topbar y PwaStatus reflejan modo offline
    await act(async () => {
      await SyncScheduler.refreshState(false);
    });

    expect(await screen.findByText(/Sin conexión/i)).toBeInTheDocument();
    expect(await screen.findByText(/Conexión perdida · Modo Offline Activo/i)).toBeInTheDocument();

    // 2. Recuperación de conexión -> aparece aviso de reconexión
    await act(async () => {
      await SyncScheduler.refreshState(true);
    });

    expect(await screen.findByText(/Conexión recuperada/i)).toBeInTheDocument();

    // 3. Actualización pendiente del Service Worker -> llama SKIP_WAITING
    const postMessageSpy = vi.fn();
    const fakeRegistration = {
      waiting: { postMessage: postMessageSpy }
    } as unknown as ServiceWorkerRegistration;

    act(() => {
      PwaUpdateManager.setUpdateAvailable(fakeRegistration);
    });

    const updateBtn = await screen.findByRole('button', { name: /Actualizar/i });
    await user.click(updateBtn);
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('muestra en SyncStatusPanel el inventario de datos disponibles localmente en IndexedDB', async () => {
    await SyncScheduler.refreshState(false);

    render(<SyncStatusPanel />);

    await waitFor(() => {
      expect(screen.getByText(/Datos Disponibles Localmente \(2\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Bovinos:/i)).toBeInTheDocument();
  });
});
