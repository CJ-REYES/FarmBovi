import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/database/db';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { ConflictRepository } from '../lib/database/repositories/conflict.repository';
import { MovementService, MovementValidationError } from './movement.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import type { BackendMovimientoAnimalDto, MovementInput } from '../types/movement';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const LOT_A1 = '22222222-2222-4222-8222-222222222221';
const LOT_A2 = '22222222-2222-4222-8222-222222222222';
const LOT_A3 = '22222222-2222-4222-8222-222222222223';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';
const ANIMAL_2 = '33333333-3333-4333-8333-333333333332';

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
      id: LOT_A1,
      remoteId: LOT_A1,
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
      id: LOT_A2,
      remoteId: LOT_A2,
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
      id: LOT_A3,
      remoteId: LOT_A3,
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
      loteId: LOT_A1,
      arete: 'MX-301',
      areteSiniiga: 'MX-301',
      raza: 'Brahman',
      sexo: 'Hembra',
      gender: 'H',
      fechaNacimiento: '2024-01-15',
      fechaIngreso: '2024-01-15',
      procedencia: 'Propio',
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
      id: ANIMAL_2,
      remoteId: ANIMAL_2,
      ranchId: RANCH_A,
      loteId: LOT_A2,
      arete: 'MX-302',
      areteSiniiga: 'MX-302',
      raza: 'Nelore',
      sexo: 'Macho',
      gender: 'M',
      fechaNacimiento: '2024-02-10',
      fechaIngreso: '2024-02-10',
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

function makeMove(overrides: Partial<MovementInput> = {}): MovementInput {
  return {
    idAnimal: ANIMAL_1,
    tipo: 'CambioInterno',
    fecha: '2026-03-10T08:30',
    idLoteOrigen: LOT_A1,
    idLoteDestino: LOT_A2,
    origenExterno: null,
    destinoExterno: null,
    motivo: 'Rotación de potrero',
    ...overrides
  };
}

describe('MovementService — CRUD offline-first, cronología y sincronización Push', () => {
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

  it('crea un CambioInterno offline, actualiza atómicamente el potrero del animal y encola ambas operaciones', async () => {
    const created = await MovementService.create(makeMove());

    expect(created.synced).toBe(false);
    expect(created.movement.id).toBe(created.movement.idMovimiento);
    expect(created.movement.idAnimal).toBe(ANIMAL_1);
    expect(created.movement.idLoteOrigen).toBe(LOT_A1);
    expect(created.movement.idLoteDestino).toBe(LOT_A2);
    expect(created.movement.tipo).toBe('CambioInterno');
    expect(created.movement.syncStatus).toBe('pending');

    // Efecto atómico en el animal local
    const updatedAnimal = await db.cattle.get(ANIMAL_1);
    expect(updatedAnimal?.loteId).toBe(LOT_A2);
    expect(updatedAnimal?.syncStatus).toBe('pending');

    // Operaciones encoladas en outbox
    const movementOps = await OutboxRepository.getByEntity('movements', created.movement.id);
    expect(movementOps).toHaveLength(1);
    expect(movementOps[0].tipoOperacion).toBe('CREATE');
    expect(movementOps[0].payload).toEqual({
      idMovimiento: created.movement.id,
      idAnimal: ANIMAL_1,
      idLoteOrigen: LOT_A1,
      idLoteDestino: LOT_A2,
      tipo: 'CambioInterno',
      fecha: '2026-03-10T08:30:00',
      origenExterno: null,
      destinoExterno: null,
      motivo: 'Rotación de potrero'
    });

    const cattleOps = await OutboxRepository.getByEntity('cattle', ANIMAL_1);
    expect(cattleOps).toHaveLength(1);
    expect(cattleOps[0].tipoOperacion).toBe('UPDATE');
  });

  it('ordena el historial estrictamente de forma cronológica (asc y desc)', async () => {
    const m1 = await MovementService.create(
      makeMove({ fecha: '2026-02-01T10:00', idLoteOrigen: LOT_A1, idLoteDestino: LOT_A2 })
    );
    const m2 = await MovementService.create(
      makeMove({ fecha: '2026-03-15T14:00', idLoteOrigen: LOT_A2, idLoteDestino: LOT_A3 })
    );
    const m3 = await MovementService.create(
      makeMove({ fecha: '2026-02-20T09:00', idLoteOrigen: LOT_A3, idLoteDestino: LOT_A1 })
    );

    const desc = await MovementService.getAll({ order: 'desc' });
    expect(desc.data.map((m) => m.id)).toEqual([m2.movement.id, m3.movement.id, m1.movement.id]);

    const asc = await MovementService.getAll({ order: 'asc' });
    expect(asc.data.map((m) => m.id)).toEqual([m1.movement.id, m3.movement.id, m2.movement.id]);
  });

  it('al registrar Venta actualiza el estado del animal a Vendido e impide traslados posteriores inconsistentes', async () => {
    await MovementService.create({
      idAnimal: ANIMAL_1,
      tipo: 'Venta',
      fecha: '2026-03-12T11:00',
      idLoteOrigen: LOT_A1,
      idLoteDestino: null,
      origenExterno: null,
      destinoExterno: 'Comprador Regional',
      motivo: 'Venta en pie'
    });

    const soldAnimal = await db.cattle.get(ANIMAL_1);
    expect(soldAnimal?.estado).toBe('Vendido');
    expect(soldAnimal?.fechaSalida).toBe('2026-03-12');

    // No debe permitir un CambioInterno posterior sobre un animal ya vendido
    await expect(
      MovementService.create(
        makeMove({ idAnimal: ANIMAL_1, idLoteOrigen: LOT_A1, idLoteDestino: LOT_A2 })
      )
    ).rejects.toThrow(MovementValidationError);
  });

  it('sincroniza movimientos creados offline vía POST /api/sync/operaciones con contrato exacto de MovimientoAnimal', async () => {
    const created = await MovementService.create({
      idAnimal: ANIMAL_1,
      tipo: 'Traslado',
      fecha: '2026-03-10T12:00',
      idLoteOrigen: LOT_A1,
      idLoteDestino: null,
      origenExterno: null,
      destinoExterno: 'Feria Ganadera Campeche',
      motivo: 'Exhibición temporal'
    });

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const capturedBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      capturedBodies.push(parsed);
      return new Response(
        JSON.stringify({
          idOperacion: parsed.idOperacion,
          entidad: parsed.entidad,
          idRegistro: parsed.idRegistro,
          operacion: parsed.operacion,
          version: 1,
          versionResultante: 1,
          idCambio: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          ocurrioEn: '2026-11-19T21:55:00Z',
          aplicadoEn: '2026-11-19T21:55:00Z',
          duplicadoIgnorado: false,
          datos: parsed.payload
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const pushSummary = await PushSyncEngine.pushPendingOperations();
      expect(pushSummary.status).toBe('completed');
      expect(pushSummary.confirmedCount).toBe(1);
      expect(pushSummary.validationErrorCount).toBe(0);
      expect(pushSummary.transientErrorCount).toBe(0);

      expect(capturedBodies).toHaveLength(1);
      const body = capturedBodies[0];
      expect(body.entidad).toBe('MovimientoAnimal');
      expect(body.operacion).toBe('Crear');
      expect(body.idRancho).toBe(RANCH_A);
      expect(body.idRegistro).toBe(created.movement.id);

      const sentPayload = body.payload as Record<string, unknown>;
      expect(Object.keys(sentPayload).sort()).toEqual([
        'destinoExterno',
        'fecha',
        'idAnimal',
        'idLoteDestino',
        'idLoteOrigen',
        'idMovimiento',
        'motivo',
        'origenExterno',
        'tipo'
      ]);
      expect(sentPayload.cattleId).toBeUndefined();
      expect(sentPayload.origenLotId).toBeUndefined();

      const synced = await MovementService.getById(created.movement.id);
      expect(synced?.syncStatus).toBe('synced');
      expect(synced?.versionRegistro).toBe(1);
      expect(await db.movements.count()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mantiene inmutable idAnimal al editar, gestiona conflicto 409 y permite borrado lógico conservando auditoría', async () => {
    const created = await MovementService.create(makeMove());

    await db.movements.update(created.movement.id, {
      syncStatus: 'synced',
      serverVersion: 1,
      remoteId: created.movement.id
    });
    await db.outbox.clear();

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const fetch409 = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tipoConflicto: 'VERSION_MISMATCH',
          mensaje: 'Versión remota más reciente.',
          idOperacion: 'op-mov-409',
          entidad: 'MovimientoAnimal',
          idRegistro: created.movement.id,
          versionEnviada: 1,
          versionServidor: 4,
          camposModificados: ['motivo'],
          estadoServidor: {
            idMovimiento: created.movement.id,
            idAnimal: ANIMAL_1,
            tipo: 'CambioInterno',
            motivo: 'Motivo remoto v4'
          }
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetch409);

    try {
      const updated = await MovementService.update(created.movement.id, {
        idAnimal: ANIMAL_2, // Debe ignorarse por inmutabilidad
        tipo: 'CambioInterno',
        fecha: '2026-03-10T09:00',
        idLoteOrigen: LOT_A1,
        idLoteDestino: LOT_A3,
        origenExterno: null,
        destinoExterno: null,
        motivo: 'Ajuste de potrero destino'
      });

      expect(updated.movement.idAnimal).toBe(ANIMAL_1);
      expect(updated.movement.idLoteDestino).toBe(LOT_A3);
      expect(updated.movement.syncStatus).toBe('conflict');

      const conflicts = await ConflictRepository.getPendingConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].entidad).toBe('movements');
      expect(conflicts[0].versionServidor).toBe(4);
    } finally {
      vi.unstubAllGlobals();
    }

    // Desactivación lógica offline conserva registro
    setOnlineStatus(false);
    await MovementService.deactivate(created.movement.id);

    const activeOnly = await MovementService.getAll({ includeDeleted: false });
    expect(activeOnly.data).toHaveLength(0);

    const withDeleted = await MovementService.getAll({ includeDeleted: true });
    expect(withDeleted.data).toHaveLength(1);
    expect(withDeleted.data[0].deletedAt).toBeTruthy();
  });

  it('hidrata desde GET /api/movimientos-animales y hace fallback limpio a IndexedDB ante error 401', async () => {
    const localMove = await MovementService.create(makeMove());
    setOnlineStatus(true);

    const fetch401 = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mensaje: 'No autenticado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch401);

    try {
      const fallback = await MovementService.getAll();
      expect(fallback.source).toBe('cache');
      expect(fallback.warning).toMatch(/401/);
      expect(fallback.data.some((m) => m.id === localMove.movement.id)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }

    const remoteId = '66666666-6666-4666-8666-666666666666';
    const remoteItems: BackendMovimientoAnimalDto[] = [
      {
        idMovimiento: remoteId,
        idAnimal: ANIMAL_2,
        idLoteOrigen: null,
        idLoteDestino: LOT_A2,
        tipo: 'Alta',
        fecha: '2026-01-20T08:00:00Z',
        origenExterno: 'Rancho Proveedor',
        destinoExterno: null,
        motivo: 'Compra de semental',
        creadoEn: '2026-01-20T08:05:00Z',
        versionRegistro: 1,
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
      const hydrated = await MovementService.getAll({ order: 'desc' });
      expect(hydrated.source).toBe('server');
      expect(hydrated.warning).toBeNull();
      expect(hydrated.data.some((m) => m.id === remoteId && m.tipo === 'Alta')).toBe(true);
      expect(hydrated.data.some((m) => m.id === localMove.movement.id)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
