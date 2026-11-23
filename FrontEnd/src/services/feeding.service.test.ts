import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/database/db';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { ConflictRepository } from '../lib/database/repositories/conflict.repository';
import { FeedingService, FeedingValidationError } from './feeding.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import type { BackendAlimentacionDto, FeedingInput } from '../types/feeding';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const LOT_1 = '22222222-2222-4222-8222-222222222221';
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
      id: LOT_1,
      remoteId: LOT_1,
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
      loteId: LOT_1,
      arete: 'MX-810',
      areteSiniiga: 'MX-810',
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

function makeInput(overrides: Partial<FeedingInput> = {}): FeedingInput {
  return {
    idAnimal: null,
    idLote: LOT_1,
    alimento: 'Silo de maíz',
    racion: 'Ración engorda 18%',
    cantidad: '25.5',
    unidad: 'kg',
    frecuencia: '2 veces al día',
    inicio: '2026-03-01T07:00',
    fin: '2026-03-20T19:00',
    cambioDieta: 'Ajuste gradual de proteína',
    ...overrides
  };
}

describe('FeedingService — CRUD offline-first, Regla XOR y sincronización Push', () => {
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

  it('crea alimentación offline por lote y por animal, persiste en IndexedDB y encola el contrato exacto', async () => {
    const byLot = await FeedingService.create(makeInput());
    expect(byLot.synced).toBe(false);
    expect(byLot.record.id).toBe(byLot.record.idAlimentacion);
    expect(byLot.record.targetType).toBe('lote');
    expect(byLot.record.idLote).toBe(LOT_1);
    expect(byLot.record.idAnimal).toBeNull();
    expect(byLot.record.cantidad).toBe(25.5);
    expect(byLot.record.syncStatus).toBe('pending');

    const byAnimal = await FeedingService.create(
      makeInput({ idLote: null, idAnimal: ANIMAL_1, alimento: 'Sales minerales', cantidad: '0.25' })
    );
    expect(byAnimal.record.targetType).toBe('animal');
    expect(byAnimal.record.idAnimal).toBe(ANIMAL_1);
    expect(byAnimal.record.idLote).toBeNull();

    const ops = await OutboxRepository.getByEntity('feedingRecords', byLot.record.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].tipoOperacion).toBe('CREATE');
    expect(ops[0].payload).toEqual({
      idAlimentacion: byLot.record.id,
      idAnimal: null,
      idLote: LOT_1,
      alimento: 'Silo de maíz',
      racion: 'Ración engorda 18%',
      cantidad: 25.5,
      unidad: 'kg',
      frecuencia: '2 veces al día',
      inicio: '2026-03-01T07:00:00',
      fin: '2026-03-20T19:00:00',
      cambioDieta: 'Ajuste gradual de proteína'
    });
  });

  it('rechaza violaciones de XOR(idAnimal, idLote) y cantidades <= 0', async () => {
    await expect(
      FeedingService.create(makeInput({ idAnimal: ANIMAL_1, idLote: LOT_1 }))
    ).rejects.toThrow(FeedingValidationError);

    await expect(
      FeedingService.create(makeInput({ cantidad: 0 }))
    ).rejects.toThrow(FeedingValidationError);
  });

  it('sincroniza alimentación creada offline vía POST /api/sync/operaciones sin campos locales heredados', async () => {
    const created = await FeedingService.create(makeInput());

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const capturedBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      capturedBodies.push(parsed);
      return new Response(
        JSON.stringify({
          idOperacion: parsed.idOperacion,
          entidad: 'Alimentacion',
          idRegistro: parsed.idRegistro,
          operacion: 'Crear',
          version: 1,
          versionResultante: 1,
          idCambio: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          ocurrioEn: '2026-11-19T22:10:00Z',
          aplicadoEn: '2026-11-19T22:10:00Z',
          duplicadoIgnorado: false,
          datos: parsed.payload
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const summary = await PushSyncEngine.pushPendingOperations();
      expect(summary.status).toBe('completed');
      expect(summary.confirmedCount).toBe(1);
      expect(summary.validationErrorCount).toBe(0);
      expect(summary.transientErrorCount).toBe(0);

      expect(capturedBodies).toHaveLength(1);
      const body = capturedBodies[0];
      expect(body.entidad).toBe('Alimentacion');
      expect(body.operacion).toBe('Crear');
      expect(body.idRancho).toBe(RANCH_A);
      expect(body.idRegistro).toBe(created.record.id);

      const sentPayload = body.payload as Record<string, unknown>;
      expect(Object.keys(sentPayload).sort()).toEqual([
        'alimento',
        'cambioDieta',
        'cantidad',
        'fin',
        'frecuencia',
        'idAlimentacion',
        'idAnimal',
        'idLote',
        'inicio',
        'racion',
        'unidad'
      ]);
      expect(sentPayload.tipoAlimento).toBeUndefined();
      expect(sentPayload.cantidadKg).toBeUndefined();
      expect(sentPayload.lotId).toBeUndefined();

      const synced = await FeedingService.getById(created.record.id);
      expect(synced?.syncStatus).toBe('synced');
      expect(synced?.versionRegistro).toBe(1);
      expect(await db.feedingRecords.count()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('permite editar, gestiona conflicto 409 y soporta borrado lógico conservando historial', async () => {
    const created = await FeedingService.create(makeInput());
    await db.feedingRecords.update(created.record.id, {
      syncStatus: 'synced',
      serverVersion: 1,
      remoteId: created.record.id
    });
    await db.outbox.clear();

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const fetch409 = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tipoConflicto: 'VERSION_MISMATCH',
          mensaje: 'Conflicto de versión en alimentación.',
          idOperacion: 'op-feed-409',
          entidad: 'Alimentacion',
          idRegistro: created.record.id,
          versionEnviada: 1,
          versionServidor: 3,
          camposModificados: ['cantidad'],
          estadoServidor: {
            idAlimentacion: created.record.id,
            alimento: 'Silo de maíz',
            cantidad: 30
          }
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetch409);

    try {
      const updated = await FeedingService.update(
        created.record.id,
        makeInput({ idLote: null, idAnimal: ANIMAL_1, cantidad: '15.25' })
      );
      expect(updated.record.targetType).toBe('animal');
      expect(updated.record.cantidad).toBe(15.25);
      expect(updated.record.syncStatus).toBe('conflict');

      const conflicts = await ConflictRepository.getPendingConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].entidad).toBe('feedingRecords');
      expect(conflicts[0].versionServidor).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }

    setOnlineStatus(false);
    await FeedingService.deactivate(created.record.id);

    const activeOnly = await FeedingService.getAll({ includeDeleted: false });
    expect(activeOnly.data).toHaveLength(0);

    const withDeleted = await FeedingService.getAll({ includeDeleted: true });
    expect(withDeleted.data).toHaveLength(1);
    expect(withDeleted.data[0].deletedAt).toBeTruthy();
  });

  it('hidrata desde GET /api/alimentacion y hace fallback limpio ante 401 sin perder pendientes', async () => {
    const localRec = await FeedingService.create(makeInput({ alimento: 'Forraje Local' }));
    setOnlineStatus(true);

    const fetch401 = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mensaje: 'No autenticado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch401);

    try {
      const fallback = await FeedingService.getAll();
      expect(fallback.source).toBe('cache');
      expect(fallback.warning).toMatch(/401/);
      expect(fallback.data.some((r) => r.id === localRec.record.id)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }

    const remoteId = '77777777-7777-4777-8777-777777777777';
    const remoteItems: BackendAlimentacionDto[] = [
      {
        idAlimentacion: remoteId,
        idAnimal: null,
        idLote: LOT_1,
        alimento: 'Concentrado Remoto API',
        racion: 'Mantenimiento',
        cantidad: 14,
        unidad: 'kg',
        frecuencia: 'Diaria',
        inicio: '2026-02-10T08:00:00Z',
        fin: null,
        cambioDieta: null,
        creadoEn: '2026-02-10T08:00:00Z',
        versionRegistro: 2,
        eliminadoEn: null
      }
    ];

    const fetch200 = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(remoteItems), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch200);

    try {
      const hydrated = await FeedingService.getAll();
      expect(hydrated.source).toBe('server');
      expect(hydrated.warning).toBeNull();
      expect(hydrated.data.some((r) => r.id === remoteId && r.alimento === 'Concentrado Remoto API')).toBe(true);
      expect(hydrated.data.some((r) => r.id === localRec.record.id)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
