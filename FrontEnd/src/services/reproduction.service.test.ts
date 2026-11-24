import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/database/db';
import { CheckpointRepository } from '../lib/database/repositories/checkpoint.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { CattleService } from './cattle.service';
import {
  ReproductionService,
  ReproductionValidationError
} from './reproduction.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import { SyncPullEngine } from './sync/sync-pull.engine';

const RANCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FEMALE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MALE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function seedAnimals() {
  const now = new Date().toISOString();
  await db.ranches.put({
    id: RANCH_ID,
    remoteId: RANCH_ID,
    ranchId: RANCH_ID,
    nombre: 'El Dorado',
    ubicacionGeneral: 'Norte',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    deletedAt: null
  });

  await db.cattle.bulkPut([
    {
      id: FEMALE_ID,
      remoteId: FEMALE_ID,
      ranchId: RANCH_ID,
      arete: 'MX-REP-01',
      areteSiniiga: 'MX-REP-01',
      raza: 'Suizo Pardo',
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
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: MALE_ID,
      remoteId: MALE_ID,
      ranchId: RANCH_ID,
      arete: 'MX-REP-02',
      areteSiniiga: 'MX-REP-02',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2021-01-01',
      fechaIngreso: '2021-02-01',
      procedencia: 'Compra',
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

describe('ReproductionService — Integración REST + sincronización offline-first Push/Pull', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    await Promise.all([
      db.ranches.clear(),
      db.reproductionRecords.clear(),
      db.cattle.clear(),
      db.outbox.clear(),
      db.syncCheckpoints.clear(),
      db.syncConflicts.clear()
    ]);
    await seedAnimals();
  });

  it('opera 100% offline en IndexedDB + outbox y conserva idAnimal inmutable al editar', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const created = await ReproductionService.create({
      idAnimal: FEMALE_ID,
      idSemental: MALE_ID,
      tipo: 'Inseminación',
      fecha: '2026-11-12T08:30',
      resultado: 'Pendiente',
      observaciones: 'Primer servicio del ciclo'
    });

    expect(created.synced).toBe(false);
    expect(created.event.syncStatus).toBe('pending');
    expect(created.event.idSemental).toBe(MALE_ID);
    expect(created.event.tipo).toBe('Inseminación');

    const opsAfterCreate = await OutboxRepository.getByEntity(
      'reproductionRecords',
      created.event.id
    );
    expect(opsAfterCreate).toHaveLength(1);
    expect(opsAfterCreate[0].tipoOperacion).toBe('CREATE');

    const updated = await ReproductionService.update(created.event.id, {
      idAnimal: MALE_ID,
      idSemental: MALE_ID,
      tipo: 'Confirmación de gestación',
      fecha: '2026-11-18T10:00',
      resultado: 'Positivo / Gestante',
      observaciones: 'Palpación confirmada a 60 días'
    });

    expect(updated.synced).toBe(false);
    expect(updated.event.idAnimal).toBe(FEMALE_ID);
    expect(updated.event.tipo).toBe('Confirmación de gestación');

    const deactivated = await ReproductionService.deactivate(created.event.id);
    expect(deactivated.synced).toBe(false);

    const activeList = await ReproductionService.getAll({ includeDeleted: false });
    expect(activeList.data).toHaveLength(0);
    expect(activeList.warning).toBeNull();
  });

  it('sincroniza un registro creado previamente antes de habilitar la integración (cola pendiente legada) y descarga por Pull', async () => {
    // 1. Simular exactamente el registro creado por el usuario ANTES de la integración:
    //    guardado en db.reproductionRecords y en db.outbox con fecha local sin sufijo 'Z' e Intentos: 0
    const legacyEventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const legacyOpId = 'e9890484-1111-4111-8111-111111111111';
    await db.reproductionRecords.put({
      id: legacyEventId,
      ranchId: RANCH_ID,
      cattleId: FEMALE_ID,
      evento: 'Monta Natural',
      fecha: '2026-11-05T08:12:00',
      resultado: null,
      createdAt: '2026-11-23T20:12:47.000Z',
      updatedAt: '2026-11-23T20:12:47.000Z',
      syncStatus: 'pending',
      serverVersion: null,
      deletedAt: null
    });
    await db.outbox.put({
      id: legacyOpId,
      idOperacion: legacyOpId,
      entidad: 'reproductionRecords',
      idEntidad: legacyEventId,
      idRancho: RANCH_ID,
      tipoOperacion: 'CREATE',
      versionBase: null,
      payload: {
        idEventoReproductivo: legacyEventId,
        idAnimal: FEMALE_ID,
        tipo: 'Monta Natural',
        fecha: '2026-11-05T08:12:00',
        resultado: null,
        observaciones: null
      },
      estado: 'pendiente',
      intentos: 0,
      ultimoError: null,
      proximoIntento: null,
      fechaCreacion: '2026-11-23T20:12:47.000Z'
    });

    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    const pushedBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/sync/operaciones') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        pushedBodies.push(body);
        return new Response(
          JSON.stringify({
            idOperacion: body.idOperacion,
            entidad: 'EventoReproductivo',
            idRegistro: body.idRegistro,
            operacion: 'Crear',
            version: 1,
            idCambio: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            ocurrioEn: '2026-11-23T20:25:00.000Z',
            duplicadoIgnorado: false,
            datos: body.payload
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/sync/cambios') && url.includes('entidad=reproductionRecords')) {
        return new Response(
          JSON.stringify({
            entidad: 'reproductionRecords',
            cambios: [
              {
                remoteId: legacyEventId,
                clientUuid: null,
                operacion: 'UPSERT',
                versionServidor: 1,
                datos: {
                  ranchId: RANCH_ID,
                  idAnimal: FEMALE_ID,
                  idSemental: MALE_ID,
                  tipo: 'Monta Natural',
                  fecha: '2026-11-05T14:12:00.000Z',
                  resultado: 'Exitoso',
                  observaciones: 'Sincronizado desde otro dispositivo'
                },
                eliminado: false,
                actualizadoEnServidor: '2026-11-23T20:25:00.000Z'
              }
            ],
            siguienteCursorOpaco: 'cursor-repro-v1',
            hayMasPaginas: false,
            fechaServidor: '2026-11-23T20:25:01.000Z'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    // 2. Ejecutar Push: el registro legado debe confirmarse limpiamente
    const pushSummary = await PushSyncEngine.pushPendingOperations();
    expect(pushSummary.confirmedCount).toBe(1);
    expect(pushedBodies).toHaveLength(1);
    expect(pushedBodies[0].entidad).toBe('EventoReproductivo');
    const sentPayload = pushedBodies[0].payload as Record<string, unknown>;
    expect(sentPayload.idAnimal).toBe(FEMALE_ID);
    expect(sentPayload.tipo).toBe('Monta Natural');
    expect(String(sentPayload.fecha)).toMatch(/Z$/);

    const confirmedLocal = await db.reproductionRecords.get(legacyEventId);
    expect(confirmedLocal?.syncStatus).toBe('synced');
    expect(confirmedLocal?.serverVersion).toBe(1);

    // 3. Ejecutar Pull: debe persistir en Dexie y crear el checkpoint de reproductionRecords
    const pullSummary = await SyncPullEngine.pullEntity('reproductionRecords', {
      ranchId: RANCH_ID
    });
    expect(pullSummary.status).toBe('completed');
    expect(pullSummary.appliedCount).toBe(1);

    const cp = await CheckpointRepository.getByEntity('reproductionRecords');
    expect(cp?.cursorOpaco).toBe('cursor-repro-v1');

    const updatedByPull = await db.reproductionRecords.get(legacyEventId);
    expect(updatedByPull?.sementalId).toBe(MALE_ID);
    expect(updatedByPull?.resultado).toBe('Exitoso');
  });

  it('lanza ReproductionValidationError cuando se intenta registrar un parto en un Macho o un semental Hembra', async () => {
    await expect(
      ReproductionService.create({
        idAnimal: MALE_ID,
        tipo: 'Parto',
        fecha: '2026-11-10T09:00',
        resultado: 'Cría Viva',
        observaciones: null
      })
    ).rejects.toBeInstanceOf(ReproductionValidationError);

    await expect(
      ReproductionService.create({
        idAnimal: FEMALE_ID,
        idSemental: FEMALE_ID,
        tipo: 'Servicio o monta',
        fecha: '2026-11-10T09:00',
        resultado: null,
        observaciones: null
      })
    ).rejects.toBeInstanceOf(ReproductionValidationError);

    expect(await db.reproductionRecords.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('hidrata animales y eventos desde los endpoints reales cuando hay sesión activa', async () => {
    const cattleSpy = vi.spyOn(CattleService, 'getAll');
    const result = await ReproductionService.getAll();

    expect(cattleSpy).toHaveBeenCalledTimes(1);
    expect(result.animals).toHaveLength(2);
  });
});
