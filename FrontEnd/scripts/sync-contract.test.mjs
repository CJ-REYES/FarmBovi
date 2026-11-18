import assert from 'node:assert/strict';
import test from 'node:test';
import { CheckpointRepository } from '../src/lib/database/repositories/checkpoint.repository.ts';
import { SYNC_ENTITY_TABLES, getSyncEntityTable } from '../src/services/sync/sync-pull.mapper.ts';
import { PULL_ENTITY_ORDER, SyncPullEngine } from '../src/services/sync/sync-pull.engine.ts';
import { SyncHttpClient } from '../src/services/sync/sync-http.client.ts';
import { validateSyncPullResponse } from '../src/services/sync/sync-response.validator.ts';

const ranchId = '33333333-3333-4333-8333-333333333333';

function pullResponse(overrides = {}) {
  return {
    entidad: 'cattle',
    cambios: [{
      remoteId: '55555555-5555-4555-8555-555555555555',
      clientUuid: null,
      operacion: 'UPSERT',
      versionServidor: 1,
      datos: { areteSiniiga: 'A-1', raza: 'Holstein', gender: 'Hembra', ranchId },
      eliminado: false,
      actualizadoEnServidor: '2026-11-17T10:00:00.000Z'
    }],
    siguienteCursorOpaco: 'opaque-cursor',
    hayMasPaginas: false,
    fechaServidor: '2026-11-17T10:00:01.000Z',
    ...overrides
  };
}

test('valida el contrato normalizado del endpoint Pull', () => {
  const result = validateSyncPullResponse(pullResponse(), 'cattle');

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.cambios[0].remoteId, '55555555-5555-4555-8555-555555555555');
  assert.equal(result.value.cambios[0].operacion, 'UPSERT');
  assert.equal(result.value.siguienteCursorOpaco, 'opaque-cursor');
});

test('acepta eliminaciones como tombstones sin datos', () => {
  const result = validateSyncPullResponse(pullResponse({
    cambios: [{
      remoteId: '55555555-5555-4555-8555-555555555555',
      operacion: 'DELETE',
      versionServidor: 2,
      datos: null,
      eliminado: true,
      actualizadoEnServidor: '2026-11-17T10:00:00.000Z'
    }]
  }), 'cattle');

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.cambios[0].eliminado, true);
  assert.equal(result.value.cambios[0].datos, null);
});

test('rechaza entidad incorrecta, cursor ausente y tombstone inconsistente', () => {
  assert.equal(validateSyncPullResponse(pullResponse({ entidad: 'lots' }), 'cattle').valid, false);
  assert.equal(validateSyncPullResponse(pullResponse({ siguienteCursorOpaco: null, hayMasPaginas: true }), 'cattle').valid, false);
  assert.equal(validateSyncPullResponse(pullResponse({
    cambios: [{ ...pullResponse().cambios[0], operacion: 'DELETE', eliminado: true, datos: { arete: 'A-1' } }]
  }), 'cattle').valid, false);
});

test('cada entidad local sincronizable tiene tabla para upserts y eliminaciones', () => {
  const entities = [
    'cattle', 'weighings', 'healthRecords', 'feedingRecords', 'reproductionRecords',
    'lots', 'movements', 'genealogy', 'alerts', 'media'
  ];
  assert.deepEqual(Object.keys(SYNC_ENTITY_TABLES).sort(), [...entities].sort());
  for (const entity of entities) assert.ok(getSyncEntityTable(entity));
});

test('Pull agenda únicamente entidades que el backend reconoce hoy', () => {
  assert.deepEqual(PULL_ENTITY_ORDER, [
    'lots', 'cattle', 'healthRecords', 'feedingRecords', 'movements', 'alerts'
  ]);
});

test('si falla el lote, Pull informa y conserva el cursor confirmado anterior', async () => {
  const previousCheckpoint = {
    entidad: 'cattle',
    cursorOpaco: 'cursor-confirmado',
    ultimaFechaServidor: '2026-11-17T09:00:00.000Z',
    actualizadoEn: '2026-11-17T09:00:00.000Z'
  };
  const originals = {
    getByEntity: CheckpointRepository.getByEntity,
    availability: SyncHttpClient.getEndpointAvailability,
    fetchChanges: SyncHttpClient.fetchChanges,
    applyBatch: SyncPullEngine.applyBatchAtomically
  };
  let requestedCursor;

  try {
    CheckpointRepository.getByEntity = async () => previousCheckpoint;
    SyncHttpClient.getEndpointAvailability = () => ({ pullDisponible: true });
    SyncHttpClient.fetchChanges = async (request) => {
      requestedCursor = request.cursorOpaco;
      return pullResponse();
    };
    SyncPullEngine.applyBatchAtomically = async () => {
      throw new Error('fallo simulado de IndexedDB');
    };

    const result = await SyncPullEngine.pullEntity('cattle', { ranchId });

    assert.equal(requestedCursor, 'cursor-confirmado');
    assert.equal(result.status, 'transaction_failed');
    assert.equal(result.currentCursor, 'cursor-confirmado');
  } finally {
    CheckpointRepository.getByEntity = originals.getByEntity;
    SyncHttpClient.getEndpointAvailability = originals.availability;
    SyncHttpClient.fetchChanges = originals.fetchChanges;
    SyncPullEngine.applyBatchAtomically = originals.applyBatch;
  }
});

test('un cursor vacío del servidor conserva el último cursor almacenado', () => {
  const next = CheckpointRepository.buildNextCheckpoint({
    entidad: 'cattle',
    currentCheckpoint: {
      entidad: 'cattle', cursorOpaco: 'cursor-confirmado',
      ultimaFechaServidor: '2026-11-17T09:00:00.000Z', actualizadoEn: '2026-11-17T09:00:00.000Z'
    },
    siguienteCursorOpaco: null
  });
  assert.equal(next.cursorOpaco, 'cursor-confirmado');
});
