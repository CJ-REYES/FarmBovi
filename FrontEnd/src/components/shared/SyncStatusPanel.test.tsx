import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../../lib/database/db';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { SyncMetadataRepository } from '../../lib/database/repositories/sync-metadata.repository';
import { SyncScheduler } from '../../services/sync/sync-scheduler';
import SyncStatusPanel from './SyncStatusPanel';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const ANIMAL_ID = '22222222-2222-4222-8222-222222222222';

describe('SyncStatusPanel (FE-05) — Estado de sincronización, métricas y reintento manual', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.outbox.clear();
    await db.syncConflicts.clear();
    await db.syncCheckpoints.clear();
    await db.syncMetadata.clear();
    await db.media.clear();
    await db.cattle.clear();
  });

  it('muestra operaciones pendientes, exitosas, fallidas, conflictos y permite reintentar fallidas', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    // Sembrar 1 operación confirmada (exitosa), 1 pendiente y 1 fallida (incluso con backoff activo)
    const confirmedOp = OutboxRepository.createOperationRecord({
      entidad: 'cattle',
      idEntidad: ANIMAL_ID,
      tipoOperacion: 'CREATE',
      idRancho: RANCH_ID,
      payload: { arete: 'MX-OK-01' }
    });
    await db.outbox.put({ ...confirmedOp, estado: 'confirmado' });

    const pendingOp = OutboxRepository.createOperationRecord({
      entidad: 'lots',
      idEntidad: '33333333-3333-4333-8333-333333333333',
      tipoOperacion: 'CREATE',
      idRancho: RANCH_ID,
      payload: { nombre: 'Potrero Pendiente' }
    });
    await db.outbox.put(pendingOp);

    const failedOp = OutboxRepository.createOperationRecord({
      entidad: 'cattle',
      idEntidad: '44444444-4444-4444-8444-444444444444',
      tipoOperacion: 'UPDATE',
      versionBase: 1,
      idRancho: RANCH_ID,
      payload: { raza: 'Angus' }
    });
    await db.outbox.put({
      ...failedOp,
      estado: 'fallido',
      intentos: 2,
      ultimoError: 'Error 503 temporal',
      proximoIntento: new Date(Date.now() + 60_000).toISOString()
    });

    await SyncScheduler.refreshState(true);
    const retrySpy = vi.spyOn(SyncScheduler, 'retryFailedOperations').mockResolvedValue(null);

    render(<SyncStatusPanel />);

    expect(await screen.findByText('Operaciones pendientes')).toBeInTheDocument();
    expect(screen.getByText('Operaciones exitosas')).toBeInTheDocument();
    expect(screen.getByText('Operaciones fallidas')).toBeInTheDocument();
    expect(screen.getByText('Conflictos activos')).toBeInTheDocument();
    expect(screen.getByText(/Última sincronización completa \(Push \+ Pull\)/i)).toBeInTheDocument();

    // Botón de reintento global y por operación fallida (incluso si tiene proximoIntento programado)
    const retryAllBtn = await screen.findByRole('button', { name: /Reintentar fallidas \(1\)/i });
    expect(await screen.findByRole('button', { name: /^Reintentar$/i })).toBeInTheDocument();

    await user.click(retryAllBtn);
    await waitFor(() => {
      expect(retrySpy).toHaveBeenCalledTimes(1);
    });
  });

  it('muestra el registro persistente de errores por entidad desde syncMetadata', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await SyncMetadataRepository.recordError('reproductionRecords', {
      phase: 'pull',
      message: 'Error 503 descargando eventos reproductivos',
      code: 503,
      ranchId: RANCH_ID
    });

    await SyncScheduler.refreshState(true);
    render(<SyncStatusPanel />);

    expect(await screen.findByText(/Errores Registrados por Entidad \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Error 503 descargando eventos reproductivos/i)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503/i)).toBeInTheDocument();
  });
});
