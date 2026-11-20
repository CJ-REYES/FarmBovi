import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/database/db';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { ConflictRepository } from '../lib/database/repositories/conflict.repository';
import { LotService, LotValidationError } from './lot.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import type { BackendLoteDto } from '../types/cattle';
import type { LotInput } from '../types/lot';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const FOREIGN_RANCH = '99999999-9999-4999-8999-999999999999';

function setOnlineStatus(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

function makeInput(overrides: Partial<LotInput> = {}): LotInput {
  return {
    idRancho: RANCH_A,
    nombre: 'Potrero La Ceiba',
    ubicacion: 'Sector Norte',
    estado: 'Activo',
    ...overrides
  };
}

async function seedRanches() {
  const now = new Date().toISOString();
  await RanchRepository.upsertFromServer([
    {
      id: RANCH_A,
      remoteId: RANCH_A,
      ranchId: RANCH_A,
      nombre: 'Rancho La Esperanza',
      ubicacionGeneral: 'Candelaria, Campeche',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: RANCH_B,
      remoteId: RANCH_B,
      ranchId: RANCH_B,
      nombre: 'Rancho San Miguel',
      ubicacionGeneral: 'Escárcega, Campeche',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    }
  ]);
}

describe('LotService — CRUD offline-first, reglas de rancho y sincronización Push', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.lots.clear(),
      db.cattle.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedRanches();
  });

  it('crea un potrero offline con UUID estable, lo guarda en IndexedDB y encola el payload real del Backend', async () => {
    const result = await LotService.create(makeInput());

    expect(result.synced).toBe(false);
    expect(result.lot.id).toBe(result.lot.idLote);
    expect(result.lot.idRancho).toBe(RANCH_A);
    expect(result.lot.nombre).toBe('Potrero La Ceiba');
    expect(result.lot.ubicacion).toBe('Sector Norte');
    expect(result.lot.estado).toBe('Activo');
    expect(result.lot.syncStatus).toBe('pending');

    const persisted = await LotService.getById(result.lot.id);
    expect(persisted?.nombre).toBe('Potrero La Ceiba');

    const ops = await OutboxRepository.getByEntity('lots', result.lot.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].tipoOperacion).toBe('CREATE');
    expect(ops[0].payload).toEqual({
      idLote: result.lot.id,
      idRancho: RANCH_A,
      nombre: 'Potrero La Ceiba',
      ubicacion: 'Sector Norte',
      estado: 'Activo'
    });
  });

  it('impide nombres duplicados en el mismo rancho, pero permite el mismo nombre en otro rancho', async () => {
    await LotService.create(makeInput({ nombre: 'Potrero Norte' }));

    await expect(
      LotService.create(makeInput({ idRancho: RANCH_A, nombre: '  potrero norte  ' }))
    ).rejects.toThrow(LotValidationError);

    const otherRanchResult = await LotService.create(
      makeInput({ idRancho: RANCH_B, nombre: 'Potrero Norte' })
    );
    expect(otherRanchResult.lot.idRancho).toBe(RANCH_B);
    expect(otherRanchResult.lot.nombre).toBe('Potrero Norte');
  });

  it('rechaza crear un potrero en un rancho que no pertenece a los ranchos activos del usuario', async () => {
    await expect(
      LotService.create(makeInput({ idRancho: FOREIGN_RANCH }))
    ).rejects.toThrow(LotValidationError);
  });

  it('sincroniza un potrero creado offline vía POST /api/sync/operaciones sin campos inventados ni duplicados', async () => {
    const created = await LotService.create(makeInput({ nombre: 'Potrero El Roble' }));

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const capturedBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      capturedBodies.push(parsed);
      return new Response(
        JSON.stringify({
          idOperacion: parsed.idOperacion,
          entidad: 'Lote',
          idRegistro: parsed.idRegistro,
          operacion: 'Crear',
          version: 1,
          versionResultante: 1,
          idCambio: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          ocurrioEn: '2026-11-19T21:40:00Z',
          aplicadoEn: '2026-11-19T21:40:00Z',
          duplicadoIgnorado: false,
          datos: {
            idLote: created.lot.id,
            idRancho: RANCH_A,
            nombre: 'Potrero El Roble',
            ubicacion: 'Sector Norte',
            estado: 'Activo'
          }
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const pushResult = await PushSyncEngine.pushPendingOperations();
      expect(pushResult.status).toBe('completed');
      expect(pushResult.confirmedCount).toBe(1);
      expect(pushResult.validationErrorCount).toBe(0);
      expect(pushResult.transientErrorCount).toBe(0);
      expect(pushResult.conflictCount).toBe(0);
      expect(capturedBodies).toHaveLength(1);

      const body = capturedBodies[0];
      expect(body.entidad).toBe('Lote');
      expect(body.operacion).toBe('Crear');
      expect(body.idRancho).toBe(RANCH_A);
      expect(body.idRegistro).toBe(created.lot.id);

      const sentPayload = body.payload as Record<string, unknown>;
      expect(Object.keys(sentPayload).sort()).toEqual([
        'estado',
        'idLote',
        'idRancho',
        'nombre',
        'ubicacion'
      ]);
      expect(sentPayload.capacidad).toBeUndefined();
      expect(sentPayload.superficie).toBeUndefined();

      const syncedLocal = await LotService.getById(created.lot.id);
      expect(syncedLocal?.syncStatus).toBe('synced');
      expect(syncedLocal?.versionRegistro).toBe(1);

      // Verificar que no se creó ningún duplicado
      const allLots = await db.lots.toArray();
      expect(allLots).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mantiene inmutable idRancho al editar y registra conflicto ante respuesta 409 del servidor', async () => {
    const created = await LotService.create(makeInput({ nombre: 'Potrero Original' }));

    // Marcar como sincronizado en versión 1 antes de editar
    await db.lots.update(created.lot.id, {
      syncStatus: 'synced',
      serverVersion: 1,
      remoteId: created.lot.id
    });
    await db.outbox.clear();

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tipoConflicto: 'VERSION_MISMATCH',
          mensaje: 'La versión enviada no coincide con la versión actual del servidor.',
          idOperacion: 'op-lot-conflict',
          entidad: 'Lote',
          idRegistro: created.lot.id,
          versionEnviada: 1,
          versionServidor: 3,
          camposModificados: ['nombre'],
          estadoServidor: {
            idLote: created.lot.id,
            idRancho: RANCH_A,
            nombre: 'Potrero Remoto v3',
            ubicacion: 'Zona Norte',
            estado: 'Activo'
          }
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      // Aunque se pase RANCH_B, el servicio debe conservar RANCH_A (regla AllowedUpdateProperties del Backend)
      const updated = await LotService.update(created.lot.id, {
        idRancho: RANCH_B,
        nombre: 'Potrero Actualizado',
        ubicacion: 'Zona Este',
        estado: 'Activo'
      });

      expect(updated.synced).toBe(false);
      expect(updated.lot.idRancho).toBe(RANCH_A);
      expect(updated.lot.nombre).toBe('Potrero Actualizado');
      expect(updated.lot.syncStatus).toBe('conflict');

      const conflicts = await ConflictRepository.getPendingConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].entidad).toBe('lots');
      expect(conflicts[0].idEntidad).toBe(created.lot.id);
      expect(conflicts[0].versionServidor).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bloquea el borrado lógico cuando tiene animales activos, permite marcarlo Inactivo y permite desactivarlo cuando queda vacío', async () => {
    const created = await LotService.create(makeInput({ nombre: 'Potrero Ocupado' }));

    // Asociar un animal activo a este potrero
    const animalId = '44444444-4444-4444-8444-444444444444';
    await CattleRepository.upsertFromServer([
      {
        id: animalId,
        remoteId: animalId,
        ranchId: RANCH_A,
        loteId: created.lot.id,
        arete: 'MX-777',
        areteSiniiga: 'MX-777',
        raza: 'Brahman',
        sexo: 'Hembra',
        gender: 'H',
        fechaNacimiento: '2024-01-01',
        fechaIngreso: '2025-01-01',
        procedencia: 'Propio',
        estado: 'Activo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'synced',
        serverVersion: 1,
        deletedAt: null
      }
    ]);

    // Verificar consulta de animales en el potrero y conteo real
    const loaded = await LotService.getAll();
    const target = loaded.data.find((l) => l.id === created.lot.id);
    expect(target?.activeAnimalsCount).toBe(1);

    const assigned = await LotService.getAnimalsInLot(created.lot.id);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].arete).toBe('MX-777');

    // Borrado lógico bloqueado mientras tenga animales activos
    await expect(LotService.deactivate(created.lot.id)).rejects.toThrow(/animal\(es\) activo\(s\)/i);

    // Sí permite cambiar estado operativo a Inactivo
    const inactiveRes = await LotService.setEstado(created.lot.id, 'Inactivo');
    expect(inactiveRes.lot.estado).toBe('Inactivo');

    // Al trasladar/quitar el animal, el borrado lógico procede correctamente
    await db.cattle.update(animalId, { loteId: undefined });

    const deactivated = await LotService.deactivate(created.lot.id);
    expect(deactivated.synced).toBe(false);

    const stored = await LotRepository.getByIdIncludingDeleted(created.lot.id);
    expect(stored?.deletedAt).toBeTruthy();

    const ops = await OutboxRepository.getByEntity('lots', created.lot.id);
    expect(ops.some((op) => op.tipoOperacion === 'DELETE')).toBe(true);
  });

  it('hidrata potreros desde GET /api/lotes y realiza fallback a IndexedDB ante error 401 sin perder pendientes', async () => {
    const offlineLot = await LotService.create(makeInput({ nombre: 'Potrero Local Pendiente' }));
    setOnlineStatus(true);

    // 1. Error 401 del servidor -> fallback limpio con advertencia
    const fetch401 = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mensaje: 'No autenticado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch401);

    try {
      const fallback = await LotService.getAll();
      expect(fallback.source).toBe('cache');
      expect(fallback.warning).toMatch(/401/);
      expect(fallback.data.some((l) => l.id === offlineLot.lot.id)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }

    // 2. Respuesta 200 real desde /api/lotes y /api/ranchos
    const remoteLotId = '55555555-5555-4555-8555-555555555555';
    const remoteLots: BackendLoteDto[] = [
      {
        idLote: remoteLotId,
        idRancho: RANCH_A,
        nombre: 'Potrero Remoto API',
        ubicacion: 'Sector Oeste',
        estado: 'Activo',
        creadoEn: '2026-01-15T10:00:00Z',
        versionRegistro: 2,
        eliminadoEn: null
      }
    ];

    const fetch200 = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/lotes')) {
        return new Response(JSON.stringify(remoteLots), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetch200);

    try {
      const hydrated = await LotService.getAll();
      expect(hydrated.source).toBe('server');
      expect(hydrated.warning).toBeNull();
      // Conserva tanto el remoto como el local pendiente
      expect(hydrated.data.some((l) => l.id === remoteLotId && l.nombre === 'Potrero Remoto API')).toBe(true);
      expect(hydrated.data.some((l) => l.id === offlineLot.lot.id)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
