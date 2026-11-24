import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import Topbar from '../components/layout/Topbar';
import { CattleProvider } from '../context/CattleContext';
import { db } from '../lib/database/db';
import { SystemNotificationsService } from '../services/system-notifications.service';
import { SyncScheduler } from '../services/sync/sync-scheduler';
import { markAlertsAsSeen, resetUnreadAlertsCache } from './useUnreadAlerts';

describe('Indicadores de alertas no vistas (Sidebar y Topbar)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetUnreadAlertsCache();
    SystemNotificationsService.resetInMemoryCache();
    await Promise.all([
      db.alerts.clear(),
      db.syncConflicts.clear(),
      db.outbox.clear(),
      db.ranches.clear(),
      db.cattle.clear()
    ]);
    await SyncScheduler.refreshState(true);
  });

  afterEach(() => {
    resetUnreadAlertsCache();
    SystemNotificationsService.resetInMemoryCache();
    vi.restoreAllMocks();
  });

  function renderLayoutIndicators() {
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <CattleProvider>
          <Sidebar onCloseMobile={() => undefined} />
          <Topbar onMenuClick={() => undefined} />
        </CattleProvider>
      </MemoryRouter>
    );
  }

  it('no muestra puntos rojos cuando no hay avisos por ver (incluso si hay recordatorios completados o historial previo)', async () => {
    const now = new Date().toISOString();
    // Sembrar un recordatorio completado y una entrada antigua en el historial del sistema
    await db.alerts.put({
      id: crypto.randomUUID(),
      tipo: 'Pesaje',
      prioridad: 'Baja',
      mensaje: 'Pesaje completado',
      leida: true,
      estado: 'Completado',
      fecha: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    });
    SystemNotificationsService.recordEvent({
      codigo: 'online-recovered',
      titulo: 'Conexión recuperada',
      descripcion: 'Historial previo',
      categoria: 'offline',
      severidad: 'success'
    });

    renderLayoutIndicators();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ir a alertas y recordatorios/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('sidebar-alerts-dot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('topbar-alerts-dot')).not.toBeInTheDocument();
  });

  it('muestra los puntos rojos cuando llega un aviso pendiente o una notificación nueva y los oculta al marcarlos como vistos', async () => {
    renderLayoutIndicators();

    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-alerts-dot')).not.toBeInTheDocument();
      expect(screen.queryByTestId('topbar-alerts-dot')).not.toBeInTheDocument();
    });

    // 1. Llega un recordatorio vencido/próximo por ver -> aparecen ambos puntos rojos
    const dueSoon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    await act(async () => {
      await db.alerts.put({
        id: crypto.randomUUID(),
        tipo: 'Vacunación',
        prioridad: 'Media',
        mensaje: 'Aplicar vacuna hoy',
        leida: false,
        estado: 'Pendiente',
        fecha: dueSoon,
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        deletedAt: null
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-alerts-dot')).toBeInTheDocument();
      expect(screen.getByTestId('topbar-alerts-dot')).toBeInTheDocument();
    });

    // 2. El usuario entra a Alertas y las ve -> desaparecen ambos puntos rojos
    await act(async () => {
      await markAlertsAsSeen();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('sidebar-alerts-dot')).not.toBeInTheDocument();
      expect(screen.queryByTestId('topbar-alerts-dot')).not.toBeInTheDocument();
    });

    // 3. Posteriormente se genera una nueva notificación del sistema -> reaparecen los puntos rojos
    await new Promise((resolve) => setTimeout(resolve, 15));
    act(() => {
      SystemNotificationsService.recordEvent({
        codigo: 'sync-warning',
        titulo: 'Aviso del sistema',
        descripcion: 'Nueva notificación por revisar',
        categoria: 'sync',
        severidad: 'warning'
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-alerts-dot')).toBeInTheDocument();
      expect(screen.getByTestId('topbar-alerts-dot')).toBeInTheDocument();
    });
  });
});
