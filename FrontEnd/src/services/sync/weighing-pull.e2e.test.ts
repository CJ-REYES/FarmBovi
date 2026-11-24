import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/database/db';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import type { LocalWeighing } from '../../lib/database/schema';
import { WeighingService } from '../weighing.service';
import { PushSyncEngine } from './push-sync.engine';
import { SyncEngine } from './sync-engine';
import { SyncPullEngine } from './sync-pull.engine';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const ANIMAL_A = '33333333-3333-4333-8333-333333333331';
const ANIMAL_B = '33333333-3333-4333-8333-333333333332';

interface ServerWeighingRecord {
  idPesaje: string;
  idRancho: string;
  idAnimal: string;
  pesoRealKg: number;
  fecha: string;
  fuenteBascula: string;
  responsable: string;
  observaciones: string | null;
  origenPesaje: string;
  version: number;
  eliminadoEn: string | null;
  createdAt: string;
}

interface ServerChangeEntry {
  seq: number;
  idCambio: string;
  idRancho: string;
  entidad: 'Pesaje';
  idRegistro: string;
  operacion: 'Crear' | 'Actualizar' | 'Eliminar';
  version: number;
  datos: Record<string, unknown> | null;
  ocurrioEn: string;
}

class WeighingBackendSyncSimulator {
  readonly weighings = new Map<string, ServerWeighingRecord>();
  readonly animalRanchById = new Map<string, string>([
    [ANIMAL_A, RANCH_A],
    [ANIMAL_B, RANCH_B]
  ]);
  readonly authorizedRanchByUser = new Set<string>([RANCH_A]);
  readonly processedOps = new Map<string, Record<string, unknown>>();
  readonly changeLog: ServerChangeEntry[] = [];
  readonly pullQueries: URLSearchParams[] = [];

  private seq = 0;
  failNextPullCount = 0;
  injectInvalidWeighingOnNextPull = false;

  private encodeCursor(seq: number): string {
    return btoa(`2026-11-22T10:00:00.000Z|${seq}`)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private decodeCursor(cursor: string): number {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    const decoded = atob(`${padded}${'='.repeat(padLength)}`);
    const [, seqStr] = decoded.split('|');
    return Number(seqStr || '0');
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  appendDirectChange(entry: Omit<ServerChangeEntry, 'seq' | 'idCambio'>): ServerChangeEntry {
    this.seq++;
    const full: ServerChangeEntry = {
      ...entry,
      seq: this.seq,
      idCambio: crypto.randomUUID()
    };
    this.changeLog.push(full);
    return full;
  }

  handleFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:5173');
    const method = (init?.method || 'GET').toUpperCase();

    if (url.pathname.endsWith('/sync/operaciones') && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return this.handlePush(body);
    }

    if (url.pathname.endsWith('/sync/cambios') && method === 'GET') {
      return this.handlePull(url.searchParams);
    }

    return this.json(404, { mensaje: `Ruta no simulada: ${method} ${url.pathname}` });
  };

  private handlePush(body: Record<string, unknown>): Response {
    const idOperacion = String(body.idOperacion || '');
    const idRancho = String(body.idRancho || '');
    const idRegistro = String(body.idRegistro || '');
    const operacion = String(body.operacion || '') as 'Crear' | 'Actualizar' | 'Eliminar';
    const payload = (body.payload && typeof body.payload === 'object'
      ? body.payload
      : {}) as Record<string, unknown>;

    if (!this.authorizedRanchByUser.has(idRancho)) {
      return this.json(403, { mensaje: 'Sin acceso al rancho.' });
    }

    const prev = this.processedOps.get(idOperacion);
    if (prev) {
      return this.json(200, { ...prev, duplicadoIgnorado: true });
    }

    const now = new Date(Date.now() + this.seq * 1000).toISOString();

    if (operacion === 'Crear') {
      const idAnimal = String(payload.idAnimal || '');
      if (this.animalRanchById.get(idAnimal) !== idRancho) {
        return this.json(403, { mensaje: 'El animal no pertenece al rancho.' });
      }

      const record: ServerWeighingRecord = {
        idPesaje: idRegistro,
        idRancho,
        idAnimal,
        pesoRealKg: Number(payload.pesoRealKg),
        fecha: String(payload.fecha || now),
        fuenteBascula: String(payload.fuenteBascula || 'Báscula registrada en campo'),
        responsable: String(payload.responsable || 'Operador de campo'),
        observaciones: payload.observaciones === undefined ? null : (payload.observaciones as string | null),
        origenPesaje: String(payload.origenPesaje || 'manual'),
        version: 1,
        eliminadoEn: null,
        createdAt: now
      };
      this.weighings.set(idRegistro, record);
      const change = this.appendDirectChange({
        idRancho,
        entidad: 'Pesaje',
        idRegistro,
        operacion: 'Crear',
        version: 1,
        datos: this.toPullPayload(record),
        ocurrioEn: now
      });

      const receipt = {
        idOperacion,
        entidad: 'Pesaje',
        idRegistro,
        operacion,
        version: 1,
        versionResultante: 1,
        idCambio: change.idCambio,
        aplicadoEn: now,
        estadoServidor: change.datos,
        duplicadoIgnorado: false
      };
      this.processedOps.set(idOperacion, receipt);
      return this.json(201, receipt);
    }

    const existing = this.weighings.get(idRegistro);
    if (!existing) {
      return this.json(404, { mensaje: 'Pesaje no encontrado.' });
    }

    const nextVersion = existing.version + 1;
    if (operacion === 'Actualizar') {
      if (payload.pesoRealKg !== undefined) existing.pesoRealKg = Number(payload.pesoRealKg);
      if (payload.fecha !== undefined) existing.fecha = String(payload.fecha);
      if (payload.fuenteBascula !== undefined) existing.fuenteBascula = String(payload.fuenteBascula);
      if (payload.responsable !== undefined) existing.responsable = String(payload.responsable);
      if ('observaciones' in payload) {
        existing.observaciones = payload.observaciones === null ? null : String(payload.observaciones);
      }
      if (payload.origenPesaje !== undefined) existing.origenPesaje = String(payload.origenPesaje);
    } else {
      existing.eliminadoEn = now;
    }
    existing.version = nextVersion;

    const change = this.appendDirectChange({
      idRancho: existing.idRancho,
      entidad: 'Pesaje',
      idRegistro,
      operacion,
      version: nextVersion,
      datos: operacion === 'Eliminar' ? null : this.toPullPayload(existing),
      ocurrioEn: now
    });

    const receipt = {
      idOperacion,
      entidad: 'Pesaje',
      idRegistro,
      operacion,
      version: nextVersion,
      versionResultante: nextVersion,
      idCambio: change.idCambio,
      aplicadoEn: now,
      estadoServidor: change.datos,
      duplicadoIgnorado: false
    };
    this.processedOps.set(idOperacion, receipt);
    return this.json(200, receipt);
  }

  private toPullPayload(record: ServerWeighingRecord): Record<string, unknown> {
    return {
      ranchId: record.idRancho,
      idAnimal: record.idAnimal,
      cattleId: record.idAnimal,
      pesoRealKg: record.pesoRealKg,
      peso: record.pesoRealKg,
      fecha: record.fecha,
      fuenteBascula: record.fuenteBascula,
      responsable: record.responsable,
      observaciones: record.observaciones,
      origenPesaje: record.origenPesaje,
      createdAt: record.createdAt
    };
  }

  private handlePull(params: URLSearchParams): Response {
    this.pullQueries.push(new URLSearchParams(params));

    if (this.failNextPullCount > 0) {
      this.failNextPullCount--;
      return this.json(503, { mensaje: 'Fallo temporal de servidor al consultar pesajes.' });
    }

    const entidad = params.get('entidad') || '';
    const ranchId = params.get('ranchId') || params.get('idRancho') || '';
    const cursor = params.get('cursorOpaco') || params.get('cursor') || '';
    const limite = Math.min(500, Math.max(1, Number(params.get('limite') || '100')));

    if (!this.authorizedRanchByUser.has(ranchId)) {
      return this.json(403, { mensaje: 'El usuario no tiene membresía activa en el rancho.' });
    }

    if (entidad !== 'weighings') {
      return this.json(200, {
        entidad,
        cambios: [],
        siguienteCursorOpaco: cursor || null,
        hayMasPaginas: false,
        fechaServidor: new Date().toISOString()
      });
    }

    if (this.injectInvalidWeighingOnNextPull) {
      this.injectInvalidWeighingOnNextPull = false;
      return this.json(200, {
        entidad: 'weighings',
        cambios: [
          {
            remoteId: crypto.randomUUID(),
            clientUuid: null,
            operacion: 'UPSERT',
            versionServidor: 1,
            datos: {
              ranchId,
              cattleId: ANIMAL_A,
              pesoRealKg: 350,
              fecha: '2026-11-22T10:00:00Z'
            },
            eliminado: false,
            actualizadoEnServidor: '2026-11-22T10:00:00Z'
          },
          {
            // Registro inválido (peso 0) -> debe abortar toda la transacción Dexie y no avanzar cursor
            remoteId: crypto.randomUUID(),
            clientUuid: null,
            operacion: 'UPSERT',
            versionServidor: 1,
            datos: {
              ranchId,
              cattleId: ANIMAL_A,
              pesoRealKg: 0,
              fecha: '2026-11-22T10:01:00Z'
            },
            eliminado: false,
            actualizadoEnServidor: '2026-11-22T10:01:00Z'
          }
        ],
        siguienteCursorOpaco: this.encodeCursor(999),
        hayMasPaginas: false,
        fechaServidor: new Date().toISOString()
      });
    }

    const afterSeq = cursor ? this.decodeCursor(cursor) : 0;
    const eligible = this.changeLog.filter(
      (c) => c.idRancho === ranchId && c.seq > afterSeq
    );

    const slice = eligible.slice(0, limite);
    const hasMore = eligible.length > limite;
    const last = slice[slice.length - 1];
    const nextCursor = last ? this.encodeCursor(last.seq) : cursor || null;

    return this.json(200, {
      entidad: 'weighings',
      cambios: slice.map((c) => ({
        remoteId: c.idRegistro,
        clientUuid: null,
        operacion: c.operacion === 'Eliminar' ? 'DELETE' : 'UPSERT',
        versionServidor: c.version,
        datos: c.operacion === 'Eliminar' ? null : c.datos,
        eliminado: c.operacion === 'Eliminar',
        actualizadoEnServidor: c.ocurrioEn
      })),
      siguienteCursorOpaco: nextCursor,
      hayMasPaginas: hasMore,
      fechaServidor: new Date().toISOString()
    });
  }
}

async function clearDeviceDb() {
  await Promise.all([
    db.ranches.clear(),
    db.lots.clear(),
    db.cattle.clear(),
    db.weighings.clear(),
    db.healthRecords.clear(),
    db.feedingRecords.clear(),
    db.movements.clear(),
    db.alerts.clear(),
    db.outbox.clear(),
    db.syncConflicts.clear(),
    db.syncCheckpoints.clear()
  ]);
}

async function seedDeviceBase(ranchId = RANCH_A, animalId = ANIMAL_A) {
  const now = '2026-11-20T00:00:00.000Z';
  await RanchRepository.upsertFromServer([
    {
      id: ranchId,
      remoteId: ranchId,
      ranchId,
      nombre: 'Rancho Principal',
      ubicacionGeneral: 'Norte',
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
      id: animalId,
      remoteId: animalId,
      ranchId,
      arete: 'BOV-100',
      areteSiniiga: 'BOV-100',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'M',
      fechaNacimiento: '2024-01-01',
      fechaIngreso: '2024-01-01',
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

describe('Pesaje Pull E2E — Alta, actualización, baja, paginación, reintento, 2 dispositivos y aislamiento', () => {
  let server: WeighingBackendSyncSimulator;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearDeviceDb();
    window.sessionStorage.clear();
    window.localStorage.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });

    server = new WeighingBackendSyncSimulator();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handleFetch);
    await seedDeviceBase(RANCH_A, ANIMAL_A);
  });

  it('sincroniza pesaje nuevo, actualizado (incluyendo limpieza de observaciones) y eliminado entre Dispositivo A y Dispositivo B', async () => {
    // Dispositivo A crea, edita y limpia observaciones offline -> Push
    window.localStorage.setItem('farmbovi_device_id', 'device-a-weigh');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    const created = await WeighingService.create({
      idAnimal: ANIMAL_A,
      pesoRealKg: 380.5,
      fecha: '2026-11-22T08:00:00Z',
      fuenteBascula: 'Báscula Corral A',
      responsable: 'Carlos',
      observaciones: 'Primer pesaje del mes'
    });
    expect(created.weighing.syncStatus).toBe('pending');

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    const push1 = await PushSyncEngine.pushPendingOperations();
    expect(push1.confirmedCount).toBe(1);

    // Dispositivo B (Dexie limpio) descarga el pesaje nuevo vía Pull
    await clearDeviceDb();
    await seedDeviceBase(RANCH_A, ANIMAL_A);
    window.localStorage.setItem('farmbovi_device_id', 'device-b-weigh');

    const pull1 = await SyncPullEngine.pullEntity('weighings', { ranchId: RANCH_A });
    expect(pull1.status).toBe('completed');
    expect(pull1.appliedCount).toBe(1);
    expect(pull1.currentCursor).not.toBeNull();

    const localOnB1 = await db.weighings.get(created.weighing.id);
    expect(localOnB1).toBeDefined();
    expect(localOnB1?.peso).toBe(380.5);
    expect(localOnB1?.ranchId).toBe(RANCH_A);
    expect(localOnB1?.observaciones).toBe('Primer pesaje del mes');
    expect(localOnB1?.syncStatus).toBe('synced');
    expect(localOnB1?.serverVersion).toBe(1);

    // Servidor recibe actualización (nuevo peso y observaciones = null) desde Dispositivo A
    const existingRecord = server.weighings.get(created.weighing.id)!;
    existingRecord.pesoRealKg = 395.25;
    existingRecord.observaciones = null;
    existingRecord.version = 2;
    server.appendDirectChange({
      idRancho: RANCH_A,
      entidad: 'Pesaje',
      idRegistro: created.weighing.id,
      operacion: 'Actualizar',
      version: 2,
      datos: {
        ranchId: RANCH_A,
        idAnimal: ANIMAL_A,
        cattleId: ANIMAL_A,
        pesoRealKg: 395.25,
        peso: 395.25,
        fecha: existingRecord.fecha,
        fuenteBascula: existingRecord.fuenteBascula,
        responsable: existingRecord.responsable,
        observaciones: null,
        origenPesaje: 'manual',
        createdAt: existingRecord.createdAt
      },
      ocurrioEn: '2026-11-22T09:00:00Z'
    });

    const pull2 = await SyncPullEngine.pullEntity('weighings', { ranchId: RANCH_A });
    expect(pull2.status).toBe('completed');
    expect(pull2.appliedCount).toBe(1);
    expect(await db.weighings.count()).toBe(1);

    const localOnB2 = await db.weighings.get(created.weighing.id);
    expect(localOnB2?.peso).toBe(395.25);
    expect(localOnB2?.observaciones).toBeUndefined();
    expect(localOnB2?.serverVersion).toBe(2);
    expect(localOnB2?.syncStatus).toBe('synced');

    // Servidor recibe eliminación lógica desde Dispositivo A
    existingRecord.version = 3;
    existingRecord.eliminadoEn = '2026-11-22T10:00:00Z';
    server.appendDirectChange({
      idRancho: RANCH_A,
      entidad: 'Pesaje',
      idRegistro: created.weighing.id,
      operacion: 'Eliminar',
      version: 3,
      datos: null,
      ocurrioEn: '2026-11-22T10:00:00Z'
    });

    const pull3 = await SyncPullEngine.pullEntity('weighings', { ranchId: RANCH_A });
    expect(pull3.status).toBe('completed');
    expect(pull3.deletedCount).toBe(1);

    const localOnB3 = await db.weighings.get(created.weighing.id);
    expect(localOnB3?.deletedAt).toBe('2026-11-22T10:00:00Z');
    expect(localOnB3?.serverVersion).toBe(3);
    expect(localOnB3?.syncStatus).toBe('synced');
  });

  it('pagina múltiples páginas con cursor opaco sin duplicados y respeta aislamiento por rancho', async () => {
    // 5 pesajes del Rancho A + 2 pesajes del Rancho B
    for (let i = 1; i <= 5; i++) {
      const id = crypto.randomUUID();
      server.appendDirectChange({
        idRancho: RANCH_A,
        entidad: 'Pesaje',
        idRegistro: id,
        operacion: 'Crear',
        version: 1,
        datos: {
          ranchId: RANCH_A,
          idAnimal: ANIMAL_A,
          cattleId: ANIMAL_A,
          pesoRealKg: 300 + i * 10,
          peso: 300 + i * 10,
          fecha: `2026-11-22T0${i}:00:00Z`,
          fuenteBascula: 'Báscula Digital',
          responsable: 'Operador A',
          origenPesaje: 'manual'
        },
        ocurrioEn: `2026-11-22T0${i}:00:00Z`
      });
    }

    for (let i = 1; i <= 2; i++) {
      server.appendDirectChange({
        idRancho: RANCH_B,
        entidad: 'Pesaje',
        idRegistro: crypto.randomUUID(),
        operacion: 'Crear',
        version: 1,
        datos: {
          ranchId: RANCH_B,
          idAnimal: ANIMAL_B,
          cattleId: ANIMAL_B,
          pesoRealKg: 500 + i,
          peso: 500 + i,
          fecha: `2026-11-22T0${i}:30:00Z`
        },
        ocurrioEn: `2026-11-22T0${i}:30:00Z`
      });
    }

    const summary = await SyncPullEngine.pullEntity('weighings', {
      ranchId: RANCH_A,
      pageSize: 2,
      retryDelayMs: 0
    });

    expect(summary.status).toBe('completed');
    expect(summary.pagesProcessed).toBe(3);
    expect(summary.appliedCount).toBe(5);
    expect(summary.currentCursor).not.toBeNull();

    const stored = await db.weighings.toArray();
    expect(stored).toHaveLength(5);
    expect(stored.every((w) => w.ranchId === RANCH_A && w.syncStatus === 'synced')).toBe(true);

    // Intentar Pull de un rancho no autorizado falla con 403 y no avanza checkpoint
    const prevCursor = await CheckpointRepository.getCursor('weighings');
    const unauthorized = await SyncPullEngine.pullEntity('weighings', {
      ranchId: RANCH_B,
      retryDelayMs: 0
    });
    expect(unauthorized.status).toBe('transaction_failed');
    expect(await CheckpointRepository.getCursor('weighings')).toBe(prevCursor);
  });

  it('reintenta ante fallo transitorio 503 sin duplicar y revierte atómicamente si falla la persistencia sin avanzar cursor ni marcar synced', async () => {
    const validId = crypto.randomUUID();
    server.appendDirectChange({
      idRancho: RANCH_A,
      entidad: 'Pesaje',
      idRegistro: validId,
      operacion: 'Crear',
      version: 1,
      datos: {
        ranchId: RANCH_A,
        idAnimal: ANIMAL_A,
        cattleId: ANIMAL_A,
        pesoRealKg: 410,
        peso: 410,
        fecha: '2026-11-22T11:00:00Z'
      },
      ocurrioEn: '2026-11-22T11:00:00Z'
    });

    // 1. Fallo 503 transitorio -> reintenta automáticamente y completa sin duplicados
    server.failNextPullCount = 1;
    const retrySummary = await SyncPullEngine.pullEntity('weighings', {
      ranchId: RANCH_A,
      maxRetriesPerPage: 2,
      retryDelayMs: 0
    });
    expect(retrySummary.status).toBe('completed');
    expect(retrySummary.retriesPerformed).toBe(1);
    expect(retrySummary.appliedCount).toBe(1);
    const cursorAfterValid = await CheckpointRepository.getCursor('weighings');
    expect(cursorAfterValid).not.toBeNull();
    expect(await db.weighings.count()).toBe(1);

    // 2. Lote con 1 pesaje bueno + 1 pesaje inválido (peso 0) -> la transacción Dexie revierte TODO
    //    No persiste el pesaje bueno parcial, no marca nada como synced y NO avanza el cursor.
    server.injectInvalidWeighingOnNextPull = true;
    const failedBatch = await SyncPullEngine.pullEntity('weighings', {
      ranchId: RANCH_A,
      maxRetriesPerPage: 0,
      retryDelayMs: 0
    });
    expect(failedBatch.status).toBe('transaction_failed');
    expect(await db.weighings.count()).toBe(1);
    expect(await CheckpointRepository.getCursor('weighings')).toBe(cursorAfterValid);
    expect(failedBatch.currentCursor).toBe(cursorAfterValid);
  });

  it('protege la monotonicidad de versiones y sincroniza vía SyncEngine.sync() completo', async () => {
    const weighingId = crypto.randomUUID();
    const newerLocal: LocalWeighing = {
      id: weighingId,
      remoteId: weighingId,
      ranchId: RANCH_A,
      cattleId: ANIMAL_A,
      peso: 455,
      fecha: '2026-11-22T12:00:00Z',
      fuenteBascula: 'Báscula Oficial',
      responsable: 'Admin',
      observaciones: 'Versión más reciente',
      origenPesaje: 'manual',
      createdAt: '2026-11-22T12:00:00Z',
      updatedAt: '2026-11-22T12:00:00Z',
      syncStatus: 'synced',
      serverVersion: 3,
      deletedAt: null
    };
    await db.weighings.put(newerLocal);

    // Replay de una versión antigua (v1) en Pull no debe degradar v3
    server.appendDirectChange({
      idRancho: RANCH_A,
      entidad: 'Pesaje',
      idRegistro: weighingId,
      operacion: 'Crear',
      version: 1,
      datos: {
        ranchId: RANCH_A,
        idAnimal: ANIMAL_A,
        cattleId: ANIMAL_A,
        pesoRealKg: 300,
        peso: 300,
        fecha: '2026-11-22T08:00:00Z'
      },
      ocurrioEn: '2026-11-22T08:00:00Z'
    });

    const cycle = await SyncEngine.sync({ ranchId: RANCH_A, retryDelayMs: 0 });
    expect(cycle).not.toBeNull();
    expect(cycle?.pullCompleted).toBe(true);

    const afterReplay = await db.weighings.get(weighingId);
    expect(afterReplay?.peso).toBe(455);
    expect(afterReplay?.serverVersion).toBe(3);
  });
});
