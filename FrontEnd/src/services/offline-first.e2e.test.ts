import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/database/db';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { CattleService } from './cattle.service';
import { LotService } from './lot.service';
import { MovementService } from './movement.service';
import { FeedingService } from './feeding.service';
import { WeighingService } from './weighing.service';
import { HealthService } from './health.service';
import { ReproductionService } from './reproduction.service';
import { OfflineInventoryService } from './offline-inventory.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import { SyncScheduler } from './sync/sync-scheduler';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const LOT_A_ID = '22222222-2222-4222-8222-222222222222';
const LOT_B_ID = '33333333-3333-4333-8333-333333333333';
const REMOTE_ANIMAL_ID = '44444444-4444-4444-8444-444444444444';

async function clearAllTables() {
  await Promise.all([
    db.ranches.clear(),
    db.lots.clear(),
    db.cattle.clear(),
    db.movements.clear(),
    db.feedingRecords.clear(),
    db.weighings.clear(),
    db.healthRecords.clear(),
    db.treatments.clear(),
    db.reproductionRecords.clear(),
    db.genealogy.clear(),
    db.alerts.clear(),
    db.outbox.clear(),
    db.syncConflicts.clear(),
    db.syncCheckpoints.clear()
  ]);
}

describe('FE-03 — Flujo Offline-First completo (IndexedDB, Outbox, Recarga y Reconexión)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    if (!db.isOpen()) {
      await db.open();
    }
    await clearAllTables();
  });

  it('cumple el recorrido obligatorio de 9 pasos: online -> descarga -> offline -> crear animal y pesaje -> recarga -> reconexión lista para sync', async () => {
    // 1. Abrir la aplicación con Internet y sesión activa
    let onlineFlag = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onlineFlag);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-fe03-test');

    const sentSyncEntities: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/ranchos')) {
        return new Response(
          JSON.stringify([
            {
              idRancho: RANCH_ID,
              nombre: 'Rancho El Porvenir',
              ubicacionGeneral: 'Veracruz',
              estado: 'Activo',
              versionRegistro: 1,
              eliminadoEn: null
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/lotes')) {
        return new Response(
          JSON.stringify([
            {
              idLote: LOT_A_ID,
              idRancho: RANCH_ID,
              nombre: 'Potrero Norte',
              ubicacion: 'Sector A',
              estado: 'Activo',
              versionRegistro: 1,
              eliminadoEn: null
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/animales')) {
        return new Response(
          JSON.stringify([
            {
              idAnimal: REMOTE_ANIMAL_ID,
              idRancho: RANCH_ID,
              idLote: LOT_A_ID,
              arete: 'MX-REM-001',
              raza: 'Brahman',
              sexo: 'Hembra',
              fechaNacimiento: '2022-01-15',
              fechaIngreso: '2022-02-01',
              procedencia: 'Rancho',
              estado: 'Activo',
              fechaSalida: null,
              observaciones: null,
              versionRegistro: 1,
              eliminadoEn: null
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/sync/operaciones') && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as {
          idOperacion: string;
          entidad: string;
          idRegistro: string;
        };
        sentSyncEntities.push(body.entidad);
        return new Response(
          JSON.stringify({
            idOperacion: body.idOperacion,
            entidad: body.entidad,
            idRegistro: body.idRegistro,
            operacion: 'Crear',
            versionResultante: 1,
            idCambio: crypto.randomUUID(),
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

    // 2. Descargar los datos necesarios con Internet
    const [initialLots, initialCattle] = await Promise.all([
      LotService.getAll(),
      CattleService.getAll()
    ]);
    expect(initialLots.data).toHaveLength(1);
    expect(initialCattle.data).toHaveLength(1);
    expect(initialCattle.data[0].arete).toBe('MX-REM-001');

    // 3. Desactivar Internet
    onlineFlag = false;
    window.dispatchEvent(new Event('offline'));

    // 4. Registrar un animal offline
    const offlineAnimal = await CattleService.create({
      idRancho: RANCH_ID,
      idLote: LOT_A_ID,
      arete: 'MX-OFF-777',
      raza: 'Suizo Pardo',
      sexo: 'Hembra',
      fechaNacimiento: '2023-06-10',
      fechaIngreso: '2023-07-01',
      procedencia: 'Nacimiento en potrero',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: 'Capturado sin cobertura'
    });
    expect(offlineAnimal.synced).toBe(false);
    expect(offlineAnimal.animal.syncStatus).toBe('pending');

    // 5. Registrar un pesaje offline para ese animal
    const offlineWeighing = await WeighingService.create({
      idAnimal: offlineAnimal.animal.id,
      pesoRealKg: 342.5,
      fecha: '2026-11-19T08:30',
      fuenteBascula: 'Báscula corral norte',
      responsable: 'Carlos Reyes',
      observaciones: 'Pesaje matutino en campo'
    });
    expect(offlineWeighing.synced).toBe(false);
    expect(offlineWeighing.weighing.syncStatus).toBe('pending');

    // 6. Simular cierre y recarga completa de la aplicación (cerrar y reabrir Dexie)
    db.close();
    await db.open();
    await SyncScheduler.handleAppStartup();

    // 7. Comprobar que los registros descargados y creados offline continúan disponibles
    const reloadedCattle = await CattleService.getAll();
    const reloadedWeighings = await WeighingService.getAll({
      cattleId: offlineAnimal.animal.id
    });
    const inventory = await OfflineInventoryService.getSnapshot();

    expect(reloadedCattle.data.map((a) => a.arete)).toEqual(
      expect.arrayContaining(['MX-REM-001', 'MX-OFF-777'])
    );
    expect(reloadedWeighings.data).toHaveLength(1);
    expect(reloadedWeighings.data[0].pesoRealKg).toBe(342.5);
    expect(inventory.hasLocalData).toBe(true);
    expect(inventory.counts.cattle).toBe(2);
    expect(inventory.counts.weighings).toBe(1);
    expect(inventory.pendingOperationsCount).toBe(2);

    // 8. Recuperar la conexión
    onlineFlag = true;
    window.dispatchEvent(new Event('online'));

    // 9. Comprobar que las operaciones están íntegras y preparadas para sincronizarse en orden
    const pendingOps = await OutboxRepository.getUnconfirmedOrdered();
    expect(pendingOps).toHaveLength(2);
    const uniqueOpIds = new Set(pendingOps.map((op) => op.idOperacion));
    expect(uniqueOpIds.size).toBe(2);

    for (const op of pendingOps) {
      expect(op.idOperacion).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(op.idDispositivo).toBeTruthy();
      expect(op.idRancho).toBe(RANCH_ID);
      expect(op.estado).toBe('pendiente');
      expect(op.fechaCreacion).toBeTruthy();
      expect(op.payload).toBeTruthy();
    }

    // Ejecutar Push y confirmar prioridad referencial: Animal primero, luego Pesaje
    const pushSummary = await PushSyncEngine.pushPendingOperations();
    expect(pushSummary.confirmedCount).toBe(2);
    expect(sentSyncEntities).toEqual(['Animal', 'Pesaje']);
  });

  it('soporta offline todos los flujos requeridos (animal, movimiento, alimentación, pesaje, salud/tratamiento, reproducción), evita duplicados y recupera operaciones interrumpidas', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const now = new Date().toISOString();
    await db.ranches.put({
      id: RANCH_ID,
      remoteId: RANCH_ID,
      ranchId: RANCH_ID,
      nombre: 'Rancho Offline',
      ubicacionGeneral: 'Veracruz',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });
    await db.lots.bulkPut([
      {
        id: LOT_A_ID,
        remoteId: LOT_A_ID,
        ranchId: RANCH_ID,
        nombre: 'Potrero A',
        capacidad: 30,
        estado: 'Activo',
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: 1,
        deletedAt: null
      },
      {
        id: LOT_B_ID,
        remoteId: LOT_B_ID,
        ranchId: RANCH_ID,
        nombre: 'Potrero B',
        capacidad: 30,
        estado: 'Activo',
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        serverVersion: 1,
        deletedAt: null
      }
    ]);

    // 1. Crear animal
    const { animal } = await CattleService.create({
      idRancho: RANCH_ID,
      idLote: LOT_A_ID,
      arete: 'MX-ALL-101',
      raza: 'Holstein',
      sexo: 'Hembra',
      fechaNacimiento: '2022-04-01',
      fechaIngreso: '2022-05-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null
    });

    // 2. Registrar movimiento
    await MovementService.create({
      idAnimal: animal.id,
      tipo: 'CambioInterno',
      idLoteOrigen: LOT_A_ID,
      idLoteDestino: LOT_B_ID,
      origenExterno: null,
      destinoExterno: null,
      fecha: '2026-11-18T09:00',
      motivo: 'Rotación de pastura'
    });

    // 3. Registrar alimentación
    await FeedingService.create({
      idAnimal: animal.id,
      idLote: null,
      alimento: 'Silo de maíz',
      racion: 'Ración mantenimiento',
      cantidad: 12.5,
      unidad: 'kg',
      frecuencia: 'Diaria',
      inicio: '2026-11-18T10:00',
      fin: null,
      cambioDieta: null
    });

    // 4. Registrar pesaje
    await WeighingService.create({
      idAnimal: animal.id,
      pesoRealKg: 410,
      fecha: '2026-11-18T11:00',
      fuenteBascula: 'Báscula digital',
      responsable: 'Operador campo',
      observaciones: null
    });

    // 5. Registrar evento sanitario + tratamiento
    const { event: healthEvent } = await HealthService.createEvent({
      idAnimal: animal.id,
      tipo: 'Revisión',
      fecha: '2026-11-18T12:00',
      sintomas: 'Decaimiento leve',
      diagnostico: 'Preventivo',
      profesionalDiagnostico: 'MVZ Ruiz',
      evidenciaDiagnosticoUri: null,
      responsable: 'MVZ Ruiz',
      observaciones: null
    });

    const { treatment } = await HealthService.createTreatment({
      idEventoSanitario: healthEvent.id,
      producto: 'Complejo B',
      dosis: 5,
      unidadDosis: 'mL',
      viaAdministracion: 'Intramuscular',
      frecuencia: 'Única',
      fechaInicio: '2026-11-18T12:30',
      fechaFin: null,
      responsable: 'MVZ Ruiz',
      prescripcionUri: null,
      estado: 'Pendiente'
    });

    // 6. Registrar evento reproductivo
    await ReproductionService.create({
      idAnimal: animal.id,
      tipo: 'Celo',
      fecha: '2026-11-18T14:00',
      resultado: 'Pendiente',
      observaciones: 'Detectado por la tarde'
    });

    // Verificar todas las operaciones en outbox con IDs únicos y metadatos
    const ops = await OutboxRepository.getUnconfirmedOrdered();
    const entitiesQueued = new Set(ops.map((op) => op.entidad));
    expect(entitiesQueued).toEqual(
      new Set([
        'cattle',
        'movements',
        'feedingRecords',
        'weighings',
        'healthRecords',
        'treatments',
        'reproductionRecords'
      ])
    );
    expect(new Set(ops.map((op) => op.idOperacion)).size).toBe(ops.length);

    // Simular cierre abrupto con una operación atascada en 'en_proceso' y confirmar recuperación
    const treatmentOp = ops.find((op) => op.entidad === 'treatments')!;
    await db.outbox.update(treatmentOp.idOperacion, { estado: 'en_proceso' });
    const recoveredCount = await OutboxRepository.recoverInterruptedOperations(new Set());
    expect(recoveredCount).toBe(1);
    const recoveredOp = await OutboxRepository.getByOperationId(treatmentOp.idOperacion);
    expect(recoveredOp?.estado).toBe('pendiente');

    // Regresión BUG #1: confirmar una operación de `treatments` debe actualizar `db.treatments.syncStatus`
    await OutboxRepository.markConfirmed({
      idOperacion: treatmentOp.idOperacion,
      remoteId: treatment.id,
      versionServidor: 1
    });
    const updatedTreatment = await db.treatments.get(treatment.id);
    expect(updatedTreatment?.syncStatus).toBe('synced');
  });
});
