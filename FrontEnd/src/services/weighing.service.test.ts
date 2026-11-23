import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/database/db';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { ConflictRepository } from '../lib/database/repositories/conflict.repository';
import { WeighingService, WeighingValidationError } from './weighing.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import type { WeighingInput } from '../types/weighing';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
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

  await CattleRepository.upsertFromServer([
    {
      id: ANIMAL_1,
      remoteId: ANIMAL_1,
      ranchId: RANCH_A,
      arete: 'MX-801',
      areteSiniiga: 'MX-801',
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
    },
    {
      id: ANIMAL_2,
      remoteId: ANIMAL_2,
      ranchId: RANCH_A,
      arete: 'MX-802',
      areteSiniiga: 'MX-802',
      raza: 'Nelore',
      sexo: 'Hembra',
      gender: 'H',
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

function makeInput(overrides: Partial<WeighingInput> = {}): WeighingInput {
  return {
    idAnimal: ANIMAL_1,
    pesoRealKg: '385.5',
    fecha: '2026-03-01T08:00',
    fuenteBascula: 'Báscula digital corral principal',
    responsable: 'Carlos Reyes',
    observaciones: 'Control mensual',
    ...overrides
  };
}

describe('WeighingService — CRUD offline-first, contrato ER Pesaje y sincronización Push', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.cattle.clear(),
      db.weighings.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedWorld();
  });

  it('crea pesaje offline en IndexedDB y encola el payload exacto del modelo ER Pesaje', async () => {
    const created = await WeighingService.create(makeInput());

    expect(created.synced).toBe(false);
    expect(created.weighing.id).toBe(created.weighing.idPesaje);
    expect(created.weighing.pesoRealKg).toBe(385.5);
    expect(created.weighing.fuenteBascula).toBe('Báscula digital corral principal');
    expect(created.weighing.responsable).toBe('Carlos Reyes');
    expect(created.weighing.syncStatus).toBe('pending');

    const ops = await OutboxRepository.getByEntity('weighings', created.weighing.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].tipoOperacion).toBe('CREATE');
    expect(ops[0].payload).toEqual({
      idPesaje: created.weighing.id,
      idAnimal: ANIMAL_1,
      pesoRealKg: 385.5,
      fecha: '2026-03-01T08:00:00',
      fuenteBascula: 'Báscula digital corral principal',
      responsable: 'Carlos Reyes',
      observaciones: 'Control mensual'
    });
  });

  it('rechaza pesos negativos o cero antes de persistir', async () => {
    await expect(WeighingService.create(makeInput({ pesoRealKg: '-5' }))).rejects.toThrow(
      WeighingValidationError
    );
    await expect(WeighingService.create(makeInput({ pesoRealKg: 0 }))).rejects.toThrow(
      WeighingValidationError
    );
    expect(await db.weighings.count()).toBe(0);
  });

  it('sincroniza pesajes offline vía POST /api/sync/operaciones cuando el servidor habilita Pesaje', async () => {
    const created = await WeighingService.create(makeInput());

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const capturedBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      capturedBodies.push(parsed);
      return new Response(
        JSON.stringify({
          idOperacion: parsed.idOperacion,
          entidad: 'Pesaje',
          idRegistro: parsed.idRegistro,
          operacion: 'Crear',
          version: 1,
          versionResultante: 1,
          idCambio: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          ocurrioEn: '2026-11-19T22:30:00Z',
          aplicadoEn: '2026-11-19T22:30:00Z',
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

      const body = capturedBodies[0];
      expect(body.entidad).toBe('Pesaje');
      expect(body.operacion).toBe('Crear');
      expect(body.idRancho).toBe(RANCH_A);
      expect(body.idRegistro).toBe(created.weighing.id);

      const sentPayload = body.payload as Record<string, unknown>;
      expect(Object.keys(sentPayload).sort()).toEqual([
        'fecha',
        'fuenteBascula',
        'idAnimal',
        'idPesaje',
        'observaciones',
        'pesoRealKg',
        'responsable'
      ]);
      expect(sentPayload.cattleId).toBeUndefined();
      expect(sentPayload.peso).toBeUndefined();

      const synced = await WeighingService.getById(created.weighing.id);
      expect(synced?.syncStatus).toBe('synced');
      expect(await db.weighings.count()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mantiene la operación segura en cola pendiente cuando el Backend actual responde entidad no soportada', async () => {
    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const fetchUnsupported = vi.fn().mockResolvedValue(
      new Response("La entidad 'Pesaje' no está soportada para sincronización.", {
        status: 400,
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    vi.stubGlobal('fetch', fetchUnsupported);

    try {
      const result = await WeighingService.create(makeInput());
      expect(result.synced).toBe(false);
      expect(result.weighing.syncStatus).toBe('pending');

      const ops = await OutboxRepository.getByEntity('weighings', result.weighing.id);
      expect(ops).toHaveLength(1);
      // Error transitorio reintentable: conserva proximoIntento programado y mantiene el registro local en 'pending'
      expect(ops[0].proximoIntento).toBeTruthy();
      expect(ops[0].ultimoError).toMatch(/aún no habilita/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mantiene idAnimal inmutable en edición, registra conflicto 409 y permite desactivación lógica', async () => {
    const created = await WeighingService.create(makeInput());
    await db.weighings.update(created.weighing.id, {
      syncStatus: 'synced',
      serverVersion: 1,
      remoteId: created.weighing.id
    });
    await db.outbox.clear();

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const fetch409 = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tipoConflicto: 'VERSION_MISMATCH',
          mensaje: 'Versión remota más reciente en Pesaje.',
          idOperacion: 'op-pes-409',
          entidad: 'Pesaje',
          idRegistro: created.weighing.id,
          versionEnviada: 1,
          versionServidor: 2,
          camposModificados: ['pesoRealKg'],
          estadoServidor: { idPesaje: created.weighing.id, pesoRealKg: 390 }
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetch409);

    try {
      const updated = await WeighingService.update(
        created.weighing.id,
        makeInput({ idAnimal: ANIMAL_2, pesoRealKg: '392.4' })
      );
      expect(updated.weighing.idAnimal).toBe(ANIMAL_1);
      expect(updated.weighing.pesoRealKg).toBe(392.4);
      expect(updated.weighing.syncStatus).toBe('conflict');

      const conflicts = await ConflictRepository.getPendingConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].entidad).toBe('weighings');
    } finally {
      vi.unstubAllGlobals();
    }

    setOnlineStatus(false);
    await WeighingService.deactivate(created.weighing.id);

    const active = await WeighingService.getAll({ includeDeleted: false });
    expect(active.data).toHaveLength(0);

    const all = await WeighingService.getAll({ includeDeleted: true });
    expect(all.data).toHaveLength(1);
    expect(all.data[0].deletedAt).toBeTruthy();
  });
});
