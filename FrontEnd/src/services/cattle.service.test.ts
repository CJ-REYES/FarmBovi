import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/database/db';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import { LotRepository } from '../lib/database/repositories/lot.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { ConflictRepository } from '../lib/database/repositories/conflict.repository';
import { CattleService, CattleValidationError } from './cattle.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import type { BackendAnimalDto, CattleInput } from '../types/cattle';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const LOT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_LOT_ID = '33333333-3333-4333-8333-333333333333';

function setOnlineStatus(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

function makeInput(overrides: Partial<CattleInput> = {}): CattleInput {
  return {
    idRancho: RANCH_ID,
    idLote: LOT_ID,
    arete: 'MX-501',
    raza: 'Brahman',
    sexo: 'Hembra',
    fechaNacimiento: '2024-02-15',
    fechaIngreso: '2025-01-10',
    procedencia: 'Propio',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: 'Lote inicial',
    ...overrides
  };
}

async function seedRanchAndLot() {
  const now = new Date().toISOString();
  await RanchRepository.upsertFromServer([
    {
      id: RANCH_ID,
      remoteId: RANCH_ID,
      ranchId: RANCH_ID,
      nombre: 'Rancho La Esperanza',
      ubicacionGeneral: 'Candelaria, Campeche',
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
      id: LOT_ID,
      remoteId: LOT_ID,
      ranchId: RANCH_ID,
      nombre: 'Potrero Norte',
      capacidad: 50,
      ubicacion: 'Zona Norte',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: OTHER_LOT_ID,
      remoteId: OTHER_LOT_ID,
      ranchId: '99999999-9999-4999-8999-999999999999',
      nombre: 'Potrero Ajeno',
      capacidad: 30,
      ubicacion: 'Otro Rancho',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    }
  ]);
}

describe('CattleService — CRUD offline-first, validaciones y sincronización Push', () => {
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
    await seedRanchAndLot();
  });

  it('crea un animal offline con UUID estable, lo persiste en IndexedDB y lo encola en outbox', async () => {
    const result = await CattleService.create(makeInput());

    expect(result.synced).toBe(false);
    expect(result.animal.id).toBe(result.animal.idAnimal);
    expect(result.animal.syncStatus).toBe('pending');
    expect(result.animal.arete).toBe('MX-501');
    expect(result.animal.idRancho).toBe(RANCH_ID);
    expect(result.animal.idLote).toBe(LOT_ID);

    // Verificar persistencia directa en IndexedDB (recuperación tras recarga)
    const persisted = await CattleService.getById(result.animal.id);
    expect(persisted?.arete).toBe('MX-501');
    expect(persisted?.procedencia).toBe('Propio');

    const ops = await OutboxRepository.getByEntity('cattle', result.animal.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].tipoOperacion).toBe('CREATE');
    expect(ops[0].estado).toBe('pendiente');
    expect(ops[0].payload).toMatchObject({
      idAnimal: result.animal.id,
      idRancho: RANCH_ID,
      idLote: LOT_ID,
      arete: 'MX-501',
      raza: 'Brahman',
      sexo: 'Hembra',
      procedencia: 'Propio',
      estado: 'Activo'
    });
  });

  it('impide duplicar arete en el mismo rancho y rechaza lotes de otro rancho', async () => {
    await CattleService.create(makeInput({ arete: 'MX-777' }));

    await expect(
      CattleService.create(makeInput({ arete: 'mx-777' }))
    ).rejects.toThrow(CattleValidationError);

    await expect(
      CattleService.create(makeInput({ arete: 'MX-778', idLote: OTHER_LOT_ID }))
    ).rejects.toThrow(CattleValidationError);
  });

  it('sincroniza un animal creado offline con POST /api/sync/operaciones respetando el contrato real sin duplicarlo', async () => {
    const created = await CattleService.create(makeInput({ arete: 'OFF-901' }));
    expect(created.animal.syncStatus).toBe('pending');

    // Simular recuperación de red + sesión JWT activa
    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'test-jwt-token');

    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          idOperacion: capturedBody.idOperacion,
          entidad: 'Animal',
          idRegistro: created.animal.id,
          operacion: 'Crear',
          version: 1,
          versionResultante: 1,
          idCambio: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          ocurrioEn: '2026-11-19T21:30:00Z',
          aplicadoEn: '2026-11-19T21:30:00Z',
          duplicadoIgnorado: false,
          datos: {
            idAnimal: created.animal.id,
            idRancho: RANCH_ID,
            arete: 'OFF-901'
          }
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const summary = await PushSyncEngine.pushPendingOperations();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summary.status).toBe('completed');
    expect(summary.confirmedCount).toBe(1);
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!['entidad']).toBe('Animal');
    expect(capturedBody!['operacion']).toBe('Crear');
    expect(capturedBody!['idRancho']).toBe(RANCH_ID);
    expect(capturedBody!['idRegistro']).toBe(created.animal.id);
    expect(typeof capturedBody!['idDispositivo']).toBe('string');

    const payload = capturedBody!['payload'] as Record<string, unknown>;
    expect(payload.arete).toBe('OFF-901');
    expect(payload.sexo).toBe('Hembra');
    expect(payload).not.toHaveProperty('areteSiniiga');
    expect(payload).not.toHaveProperty('categoria');

    const allLocal = await db.cattle.toArray();
    expect(allLocal).toHaveLength(1);
    expect(allLocal[0].syncStatus).toBe('synced');
    expect(allLocal[0].serverVersion).toBe(1);
    expect(allLocal[0].remoteId).toBe(created.animal.id);
  });

  it('edita un animal conservando idRancho inmutable y gestiona conflicto 409 de concurrencia optimista', async () => {
    const created = await CattleService.create(makeInput({ arete: 'EDIT-10' }));
    await db.cattle.update(created.animal.id, {
      syncStatus: 'synced',
      serverVersion: 1,
      remoteId: created.animal.id
    });
    await db.outbox.clear();

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'test-jwt-token');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tipoConflicto: 'VERSION_MISMATCH',
          mensaje: 'Conflicto de versión: servidor tiene v2.',
          idOperacion: 'op',
          entidad: 'Animal',
          idRegistro: created.animal.id,
          versionEnviada: 1,
          versionServidor: 2,
          camposModificados: [],
          estadoServidor: {
            idAnimal: created.animal.id,
            idRancho: RANCH_ID,
            arete: 'EDIT-10',
            raza: 'Angus',
            sexo: 'Hembra'
          }
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const updated = await CattleService.update(
      created.animal.id,
      makeInput({
        idRancho: '99999999-9999-4999-8999-999999999999', // Debe ignorarse por inmutabilidad
        arete: 'EDIT-10',
        raza: 'Suizo'
      })
    );

    expect(updated.animal.idRancho).toBe(RANCH_ID);
    expect(updated.animal.raza).toBe('Suizo');
    expect(updated.synced).toBe(false);
    expect(updated.animal.syncStatus).toBe('conflict');

    const conflicts = await ConflictRepository.getPendingConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].versionServidor).toBe(2);
  });

  it('permite desactivación lógica (soft delete) y registro de salida (Vendido/Baja) conservando el expediente', async () => {
    const a1 = await CattleService.create(makeInput({ arete: 'SAL-01' }));
    const exitResult = await CattleService.registerExit(a1.animal.id, {
      estado: 'Vendido',
      fechaSalida: '2026-11-18',
      observaciones: 'Vendido en subasta'
    });

    expect(exitResult.animal.estado).toBe('Vendido');
    expect(exitResult.animal.fechaSalida).toBe('2026-11-18');
    expect(exitResult.animal.deletedAt).toBeNull();

    const a2 = await CattleService.create(makeInput({ arete: 'DEL-02' }));
    await CattleService.deactivate(a2.animal.id);

    const activeOnly = await CattleService.getAll({ includeDeleted: false });
    expect(activeOnly.data.map((x) => x.arete)).toEqual(['SAL-01']);

    const withDeleted = await CattleService.getAll({ includeDeleted: true });
    const deactivated = withDeleted.data.find((x) => x.id === a2.animal.id);
    expect(deactivated?.deletedAt).not.toBeNull();

    const ops = await OutboxRepository.getByEntity('cattle', a2.animal.id);
    expect(ops.some((op) => op.tipoOperacion === 'DELETE')).toBe(true);
  });

  it('hidrata animales reales desde GET /api/animales y cae a caché local ante error 401 sin perder pendientes', async () => {
    // 1. Crear animal pendiente local
    await CattleService.create(makeInput({ arete: 'LOC-01' }));

    // 2. Respuesta real del Backend con un animal remoto
    setOnlineStatus(true);
    const remoteAnimal: BackendAnimalDto = {
      idAnimal: '55555555-5555-4555-8555-555555555555',
      idRancho: RANCH_ID,
      idLote: LOT_ID,
      arete: 'SRV-99',
      raza: 'Angus',
      sexo: 'Macho',
      fechaNacimiento: '2023-05-01T00:00:00Z',
      fechaIngreso: '2024-01-10T00:00:00Z',
      procedencia: 'Compra',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: 'Desde servidor',
      versionRegistro: 3,
      eliminadoEn: null
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes('/animales')) {
        return new Response(JSON.stringify([remoteAnimal]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const onlineResult = await CattleService.getAll();
    expect(onlineResult.source).toBe('server');
    expect(onlineResult.data.map((a) => a.arete).sort()).toEqual(['LOC-01', 'SRV-99']);
    const srv = onlineResult.data.find((a) => a.arete === 'SRV-99');
    expect(srv?.id).toBe(remoteAnimal.idAnimal);
    expect(srv?.sexo).toBe('Macho');
    expect(srv?.versionRegistro).toBe(3);

    // 3. Simular error 401 del servidor -> debe conservar caché local con aviso claro
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ mensaje: 'Token vencido' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const fallbackResult = await CattleService.getAll();
    expect(fallbackResult.source).toBe('cache');
    expect(fallbackResult.warning).toMatch(/401/i);
    expect(fallbackResult.data).toHaveLength(2);
  });
});
