import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/database/db';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { remindersApi } from '../lib/api';
import { AlertService } from './alert.service';

const RANCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANIMAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function seedContext() {
  const now = new Date().toISOString();
  await db.ranches.put({
    id: RANCH_ID,
    remoteId: RANCH_ID,
    ranchId: RANCH_ID,
    nombre: 'Rancho El Porvenir',
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
    arete: 'MX-SRV-01',
    areteSiniiga: 'MX-SRV-01',
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
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
}

describe('AlertService — CRUD offline, sincronización Push y lectura desde /api/recordatorios', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    await db.alerts.clear();
    await db.outbox.clear();
    await db.ranches.clear();
    await db.cattle.clear();
    await db.lots.clear();
    await db.treatments.clear();
    await db.healthRecords.clear();
    await seedContext();
  });

  it('crea, edita, completa y desactiva recordatorios offline en IndexedDB + outbox', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const created = await AlertService.create({
      idRancho: RANCH_ID,
      idAnimal: ANIMAL_ID,
      idLote: null,
      idTratamiento: null,
      idResponsable: null,
      tipo: 'Vacunación',
      descripcion: 'Aplicar vacuna contra rabia paralítica',
      fechaProgramada: '2026-11-22T09:00',
      estado: 'Pendiente',
      fechaCompletado: null
    });

    expect(created.synced).toBe(false);
    expect(created.alert.syncStatus).toBe('pending');
    expect(created.alert.tipo).toBe('Vacunación');
    expect(created.alert.idAnimal).toBe(ANIMAL_ID);

    const ops = await OutboxRepository.getByEntity('alerts', created.alert.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].tipoOperacion).toBe('CREATE');

    const completed = await AlertService.setEstado(created.alert.id, 'Completado');
    expect(completed.alert.estado).toBe('Completado');
    expect(completed.alert.fechaCompletado).toBeTruthy();

    await AlertService.deactivate(created.alert.id);
    const loaded = await AlertService.getAll({ includeDeleted: false });
    expect(loaded.alerts).toHaveLength(0);
  });

  it('hidrata desde GET /api/recordatorios sin sobrescribir pendientes locales y sincroniza por Push', async () => {
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    const remoteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    vi.spyOn(remindersApi, 'list').mockResolvedValue([
      {
        idRecordatorio: remoteId,
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_ID,
        idLote: null,
        idTratamiento: null,
        idResponsable: null,
        tipo: 'Sanitario',
        descripcion: 'Revisión veterinaria programada desde servidor',
        fechaProgramada: '2026-11-21T10:00:00Z',
        estado: 'Pendiente',
        fechaCompletado: null,
        versionRegistro: 2,
        eliminadoEn: null
      }
    ]);

    const loaded = await AlertService.getAll();
    expect(loaded.source).toBe('api');
    expect(loaded.alerts).toHaveLength(1);
    expect(loaded.alerts[0].id).toBe(remoteId);
    expect(loaded.alerts[0].syncStatus).toBe('synced');

    // Simular push exitoso a POST /api/sync/operaciones para un nuevo recordatorio
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/sync/operaciones')) {
        return new Response(
          JSON.stringify({
            idOperacion: 'op-mock',
            entidad: 'Recordatorio',
            idRegistro: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            operacion: 'Crear',
            versionResultante: 1,
            idCambio: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            aplicadoEn: new Date().toISOString(),
            duplicadoIgnorado: false
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    // Ajustar el mock para devolver exactamente el idOperacion recibido
    fetchSpy.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/sync/operaciones') && typeof init?.body === 'string') {
        const reqBody = JSON.parse(init.body) as {
          idOperacion: string;
          idRegistro: string;
          entidad: string;
        };
        expect(reqBody.entidad).toBe('Recordatorio');
        return new Response(
          JSON.stringify({
            idOperacion: reqBody.idOperacion,
            entidad: 'Recordatorio',
            idRegistro: reqBody.idRegistro,
            operacion: 'Crear',
            versionResultante: 1,
            idCambio: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            aplicadoEn: new Date().toISOString(),
            duplicadoIgnorado: false
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const syncedCreate = await AlertService.create({
      idRancho: RANCH_ID,
      idAnimal: ANIMAL_ID,
      idLote: null,
      idTratamiento: null,
      idResponsable: null,
      tipo: 'Pesaje',
      descripcion: 'Pesaje de control quincenal',
      fechaProgramada: '2026-11-23T08:00',
      estado: 'Pendiente',
      fechaCompletado: null
    });

    expect(syncedCreate.synced).toBe(true);
    expect(syncedCreate.alert.syncStatus).toBe('synced');
  });
});
