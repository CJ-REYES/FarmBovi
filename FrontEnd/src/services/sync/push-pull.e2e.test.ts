import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/database/db';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import type {
  LocalCattle,
  LocalLot,
  LocalMovement,
  LocalOutboxQueue,
  LocalSyncCheckpoint,
  LocalSyncConflict
} from '../../lib/database/schema';
import { CattleService } from '../cattle.service';
import { LotService } from '../lot.service';
import { MovementService } from '../movement.service';
import { ConnectivityService } from '../connectivity.service';
import { ConflictResolver } from './conflict-resolver';
import { PushSyncEngine } from './push-sync.engine';
import { SyncEngine } from './sync-engine';
import { SyncPullEngine } from './sync-pull.engine';
import { SyncScheduler } from './sync-scheduler';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';

interface ServerEntityRecord {
  id: string;
  entidad: string;
  idRancho: string;
  version: number;
  eliminadoEn: string | null;
  datos: Record<string, unknown>;
}

interface ServerChangeLogItem {
  seq: number;
  idCambio: string;
  idRancho: string;
  entidad: string;
  idRegistro: string;
  operacion: 'Crear' | 'Actualizar' | 'Eliminar';
  version: number;
  datos: Record<string, unknown> | null;
  ocurrioEn: string;
}

interface DeviceLocalSnapshot {
  ranches: unknown[];
  lots: LocalLot[];
  cattle: LocalCattle[];
  movements: LocalMovement[];
  outbox: LocalOutboxQueue[];
  syncConflicts: LocalSyncConflict[];
  syncCheckpoints: LocalSyncCheckpoint[];
  deviceId: string;
}

/**
 * Simulador fiel al contrato real del Backend (`SincronizacionController.cs` + `SyncController.cs`):
 * - `POST /api/sync/operaciones` con idempotencia por `idOperacion`, validación de `idRancho`,
 *   `idDispositivo` / `X-Device-Id`, control de concurrencia optimista (`409 VERSION_MISMATCH`
 *   y `409 DELETED_ON_SERVER`) y registro en `CambiosServidor`.
 * - `GET /api/sync/cambios` con paginación y cursores opacos Base64Url y mapeo de entidades.
 */
class BackendSyncServerSimulator {
  readonly records = new Map<string, ServerEntityRecord>();
  readonly processedOps = new Map<
    string,
    {
      idOperacion: string;
      entidad: string;
      idRegistro: string;
      operacion: string;
      version: number;
      idCambio: string;
      ocurrioEn: string;
      datos: Record<string, unknown> | null;
    }
  >();
  readonly changeLog: ServerChangeLogItem[] = [];
  readonly receivedPushRequests: Array<{
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }> = [];
  readonly receivedPullQueries: URLSearchParams[] = [];

  private seq = 0;
  failNextPushCount = 0;
  failNextPullCount = 0;
  failPullWith422OnCursor: string | null = null;

  private encodeCursor(seq: number): string {
    return btoa(`2026-11-22T00:00:00.000Z|${seq}`)
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

  private toJsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  handleFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:5173');
    const method = (init?.method || 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((val, key) => {
        headers[key.toLowerCase()] = val;
      });
    }

    if (url.pathname.endsWith('/sync/operaciones') && method === 'POST') {
      return this.handlePush(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>, headers);
    }

    if (url.pathname.endsWith('/sync/cambios') && method === 'GET') {
      return this.handlePull(url.searchParams);
    }

    return this.toJsonResponse(404, { mensaje: `Ruta no simulada: ${method} ${url.pathname}` });
  };

  private handlePush(body: Record<string, unknown>, headers: Record<string, string>): Response {
    this.receivedPushRequests.push({ body, headers });

    if (this.failNextPushCount > 0) {
      this.failNextPushCount--;
      return this.toJsonResponse(503, { mensaje: 'Servicio temporalmente no disponible' });
    }

    const idOperacion = String(body.idOperacion || '');
    const idRancho = String(body.idRancho || '');
    const idDispositivo = String(body.idDispositivo || '');
    const entidad = String(body.entidad || '');
    const idRegistro = String(body.idRegistro || '');
    const operacion = String(body.operacion || '') as 'Crear' | 'Actualizar' | 'Eliminar';
    const versionBase =
      body.versionBase !== null && body.versionBase !== undefined ? Number(body.versionBase) : null;
    const payload = (body.payload && typeof body.payload === 'object'
      ? body.payload
      : {}) as Record<string, unknown>;

    if (!idOperacion) {
      return this.toJsonResponse(400, { mensaje: 'El identificador de operación (idOperacion) es obligatorio.' });
    }
    if (!idRancho) {
      return this.toJsonResponse(400, { mensaje: 'El identificador del rancho (idRancho) es obligatorio.' });
    }
    if (!idDispositivo || headers['x-device-id'] !== idDispositivo) {
      return this.toJsonResponse(400, { mensaje: 'idDispositivo inválido o no coincide con X-Device-Id.' });
    }

    // Idempotencia (RegistroSyncServidor)
    const prev = this.processedOps.get(idOperacion);
    if (prev) {
      return this.toJsonResponse(200, {
        ...prev,
        versionResultante: prev.version,
        aplicadoEn: prev.ocurrioEn,
        estadoServidor: prev.datos,
        duplicadoIgnorado: true
      });
    }

    const key = `${entidad}:${idRegistro}`;
    const existing = this.records.get(key);
    const now = new Date(Date.now() + this.seq * 1000).toISOString();

    if (operacion === 'Crear') {
      const record: ServerEntityRecord = {
        id: idRegistro,
        entidad,
        idRancho,
        version: 1,
        eliminadoEn: null,
        datos: { ...payload, idRancho }
      };
      this.records.set(key, record);
      const idCambio = crypto.randomUUID();
      this.seq++;
      this.changeLog.push({
        seq: this.seq,
        idCambio,
        idRancho,
        entidad,
        idRegistro,
        operacion: 'Crear',
        version: 1,
        datos: { ...record.datos },
        ocurrioEn: now
      });

      const receipt = {
        idOperacion,
        entidad,
        idRegistro,
        operacion,
        version: 1,
        idCambio,
        ocurrioEn: now,
        datos: record.datos
      };
      this.processedOps.set(idOperacion, receipt);
      return this.toJsonResponse(201, {
        ...receipt,
        versionResultante: 1,
        aplicadoEn: now,
        estadoServidor: record.datos,
        duplicadoIgnorado: false
      });
    }

    // Actualizar o Eliminar requieren versionBase >= 1 y registro existente
    if (!existing) {
      return this.toJsonResponse(404, { mensaje: `No se encontró ${idRegistro} en ${entidad}.` });
    }
    if (versionBase === null || versionBase < 1) {
      return this.toJsonResponse(400, { mensaje: 'Debe enviar versionBase >= 1.' });
    }

    if (existing.eliminadoEn) {
      return this.toJsonResponse(409, {
        tipoConflicto: 'DELETED_ON_SERVER',
        mensaje: 'El registro ya fue eliminado previamente en el servidor por otro dispositivo.',
        idOperacion,
        entidad,
        idRegistro,
        versionEnviada: versionBase,
        versionServidor: existing.version,
        camposModificados: [],
        estadoServidor: { ...existing.datos, eliminadoEn: existing.eliminadoEn }
      });
    }

    if (versionBase !== existing.version) {
      return this.toJsonResponse(409, {
        tipoConflicto: 'VERSION_MISMATCH',
        mensaje: `Conflicto de versión: enviado v${versionBase}, servidor v${existing.version}.`,
        idOperacion,
        entidad,
        idRegistro,
        versionEnviada: versionBase,
        versionServidor: existing.version,
        camposModificados: Object.keys(payload).map((campo) => ({
          campo,
          valorServidor: existing.datos[campo] ?? null,
          valorCliente: payload[campo] ?? null
        })),
        estadoServidor: { ...existing.datos }
      });
    }

    const nextVersion = existing.version + 1;
    if (operacion === 'Actualizar') {
      existing.datos = { ...existing.datos, ...payload };
    } else {
      existing.eliminadoEn = now;
    }
    existing.version = nextVersion;

    const idCambio = crypto.randomUUID();
    this.seq++;
    this.changeLog.push({
      seq: this.seq,
      idCambio,
      idRancho,
      entidad,
      idRegistro,
      operacion,
      version: nextVersion,
      datos: operacion === 'Eliminar' ? null : { ...existing.datos },
      ocurrioEn: now
    });

    const receipt = {
      idOperacion,
      entidad,
      idRegistro,
      operacion,
      version: nextVersion,
      idCambio,
      ocurrioEn: now,
      datos: operacion === 'Eliminar' ? null : { ...existing.datos }
    };
    this.processedOps.set(idOperacion, receipt);

    return this.toJsonResponse(200, {
      ...receipt,
      versionResultante: nextVersion,
      aplicadoEn: now,
      estadoServidor: receipt.datos,
      duplicadoIgnorado: false
    });
  }

  private handlePull(params: URLSearchParams): Response {
    this.receivedPullQueries.push(new URLSearchParams(params));

    if (this.failNextPullCount > 0) {
      this.failNextPullCount--;
      return this.toJsonResponse(503, { mensaje: 'Fallo temporal al consultar cambios Pull' });
    }

    const entidad = params.get('entidad') || '';
    const ranchId = params.get('ranchId') || params.get('idRancho') || '';
    const cursor = params.get('cursorOpaco') || params.get('cursor') || '';
    const limite = Math.min(500, Math.max(1, Number(params.get('limite') || '100')));

    if (this.failPullWith422OnCursor && cursor === this.failPullWith422OnCursor) {
      return this.toJsonResponse(422, {
        codigo: 'DATOS_INCOMPLETOS',
        mensaje: 'El cambio remoto no se pudo serializar.',
        entidad,
        idCambio: crypto.randomUUID(),
        entidadServidor: entidad,
        remoteId: crypto.randomUUID(),
        cursorVigente: cursor
      });
    }

    if (!ranchId) {
      return this.toJsonResponse(400, { mensaje: 'Indica ranchId.' });
    }

    const serverEntitiesByClient: Record<string, string[]> = {
      cattle: ['Animal'],
      lots: ['Lote'],
      weighings: ['Pesaje'],
      healthRecords: ['EventoSanitario', 'Tratamiento'],
      feedingRecords: ['Alimentacion'],
      movements: ['MovimientoAnimal'],
      alerts: ['Recordatorio']
    };

    const allowedServerEntities = serverEntitiesByClient[entidad];
    if (!allowedServerEntities) {
      return this.toJsonResponse(400, { mensaje: 'La entidad no tiene sincronización Pull configurada.' });
    }

    const afterSeq = cursor ? this.decodeCursor(cursor) : 0;
    const matching = this.changeLog.filter(
      (c) => c.idRancho === ranchId && allowedServerEntities.includes(c.entidad) && c.seq > afterSeq
    );

    const hasMore = matching.length > limite;
    const page = matching.slice(0, limite);
    const lastDelivered = page[page.length - 1] ?? null;

    const mapData = (clientEnt: string, raw: Record<string, unknown> | null) => {
      if (!raw) return null;
      if (clientEnt === 'cattle') {
        return {
          ranchId: raw.idRancho,
          areteSiniiga: raw.arete,
          raza: raw.raza,
          gender: raw.sexo,
          fechaNacimiento: raw.fechaNacimiento,
          loteId: raw.idLote ?? null
        };
      }
      if (clientEnt === 'lots') {
        return {
          ranchId: raw.idRancho,
          nombre: raw.nombre,
          ubicacion: raw.ubicacion ?? null
        };
      }
      if (clientEnt === 'movements') {
        return {
          ranchId: raw.idRancho,
          cattleId: raw.idAnimal,
          fecha: raw.fecha,
          motivo: raw.motivo ?? '',
          origenLotId: raw.idLoteOrigen ?? null,
          destinoLotId: raw.idLoteDestino ?? null
        };
      }
      if (clientEnt === 'weighings') {
        return {
          ranchId: raw.idRancho,
          cattleId: raw.idAnimal,
          pesoRealKg: raw.pesoRealKg,
          peso: raw.pesoRealKg,
          fecha: raw.fecha,
          fuenteBascula: raw.fuenteBascula ?? 'Báscula registrada en campo',
          responsable: raw.responsable ?? 'Operador de campo',
          observaciones: raw.observaciones ?? null,
          origenPesaje: raw.origenPesaje ?? 'manual'
        };
      }
      return raw;
    };

    const cambios = page.map((item) => {
      const deleted = item.operacion === 'Eliminar';
      return {
        remoteId: item.idRegistro,
        clientUuid: null, // Igual al Backend real (`SyncController.cs` línea 203)
        operacion: deleted ? 'DELETE' : 'UPSERT',
        versionServidor: item.version,
        datos: deleted ? null : mapData(entidad, item.datos),
        eliminado: deleted,
        actualizadoEnServidor: item.ocurrioEn
      };
    });

    const nextCursor = lastDelivered ? this.encodeCursor(lastDelivered.seq) : cursor || null;

    return this.toJsonResponse(200, {
      entidad,
      cambios,
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
    db.movements.clear(),
    db.healthRecords.clear(),
    db.treatments.clear(),
    db.feedingRecords.clear(),
    db.alerts.clear(),
    db.outbox.clear(),
    db.syncConflicts.clear(),
    db.syncCheckpoints.clear()
  ]);
}

async function seedRanchOnActiveDevice(deviceId: string) {
  window.localStorage.setItem('farmbovi_device_id', deviceId);
  const now = new Date().toISOString();
  await db.ranches.put({
    id: RANCH_ID,
    remoteId: RANCH_ID,
    ranchId: RANCH_ID,
    nombre: 'Rancho La Esperanza',
    ubicacionGeneral: 'Veracruz',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
}

async function snapshotActiveDevice(deviceId: string): Promise<DeviceLocalSnapshot> {
  return {
    ranches: await db.ranches.toArray(),
    lots: await db.lots.toArray(),
    cattle: await db.cattle.toArray(),
    movements: await db.movements.toArray(),
    outbox: await db.outbox.toArray(),
    syncConflicts: await db.syncConflicts.toArray(),
    syncCheckpoints: await db.syncCheckpoints.toArray(),
    deviceId
  };
}

async function restoreDevice(snap: DeviceLocalSnapshot): Promise<void> {
  await clearDeviceDb();
  window.localStorage.setItem('farmbovi_device_id', snap.deviceId);
  if (snap.ranches.length > 0) await db.ranches.bulkPut(snap.ranches as never[]);
  if (snap.lots.length > 0) await db.lots.bulkPut(snap.lots);
  if (snap.cattle.length > 0) await db.cattle.bulkPut(snap.cattle);
  if (snap.movements.length > 0) await db.movements.bulkPut(snap.movements);
  if (snap.outbox.length > 0) await db.outbox.bulkPut(snap.outbox);
  if (snap.syncConflicts.length > 0) await db.syncConflicts.bulkPut(snap.syncConflicts);
  if (snap.syncCheckpoints.length > 0) await db.syncCheckpoints.bulkPut(snap.syncCheckpoints);
}

describe('PAQUETE FE-05 — Integración Push/Pull extremo a extremo entre 2 dispositivos', () => {
  let server: BackendSyncServerSimulator;

  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    await clearDeviceDb();
    server = new BackendSyncServerSimulator();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handleFetch);
    vi.spyOn(ConnectivityService, 'checkBackendAvailability').mockImplementation(async () => ({
      isOnline: navigator.onLine,
      backendReachable: navigator.onLine,
      checkedEndpoint: '/api/sync/cambios',
      httpStatus: navigator.onLine ? 200 : null,
      checkedAt: new Date().toISOString()
    }));
  });

  it('cubre el ciclo completo con 2 dispositivos: offline -> Push -> confirmación + idempotencia -> Pull paginado -> actualización -> conflictos (VERSION_MISMATCH y DELETED_ON_SERVER) -> eliminaciones -> reintentos -> reconexión', async () => {
    // =========================================================================
    // 1. REGISTRO OFFLINE EN DISPOSITIVO A
    // =========================================================================
    await seedRanchOnActiveDevice('device-A-campo');
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const lot1Res = await LotService.create({
      idRancho: RANCH_ID,
      nombre: 'Potrero Norte',
      ubicacion: 'Sector A',
      estado: 'Activo'
    });
    const lot2Res = await LotService.create({
      idRancho: RANCH_ID,
      nombre: 'Potrero Sur',
      ubicacion: 'Sector B',
      estado: 'Activo'
    });
    const cattleRes = await CattleService.create({
      idRancho: RANCH_ID,
      idLote: lot1Res.lot.id,
      arete: 'MX-SYNC-001',
      raza: 'Brahman',
      sexo: 'Hembra',
      fechaNacimiento: '2023-01-10',
      fechaIngreso: '2023-02-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: 'Registro inicial en campo'
    });
    const movRes = await MovementService.create({
      idAnimal: cattleRes.animal.id,
      idLoteOrigen: lot1Res.lot.id,
      idLoteDestino: lot2Res.lot.id,
      tipo: 'CambioInterno',
      fecha: '2026-11-20T10:00:00.000Z',
      origenExterno: null,
      destinoExterno: null,
      motivo: 'Rotación de pastoreo'
    });

    expect(lot1Res.synced).toBe(false);
    expect(cattleRes.synced).toBe(false);
    expect(movRes.synced).toBe(false);
    // lot1 CREATE + lot2 CREATE + cattle CREATE + movement CREATE (+ posible cattle UPDATE de lote)
    expect(await db.outbox.count()).toBeGreaterThanOrEqual(4);

    // =========================================================================
    // 2 y 3. ENVÍO PUSH + CONFIRMACIÓN DEL SERVIDOR + REINTENTO CON IDEMPOTENCIA
    // =========================================================================
    onlineSpy.mockReturnValue(true);

    // Simular 1 fallo transitorio 503 en la primera operación -> prueba de reintento sin pérdida local
    server.failNextPushCount = 1;
    const firstAttempt = await PushSyncEngine.pushPendingOperations();
    expect(firstAttempt.transientErrorCount).toBe(1);

    // El registro local sigue intacto y la operación fallida conserva su idOperacion original
    const failedOps = await db.outbox.where('estado').equals('fallido').toArray();
    expect(failedOps).toHaveLength(1);
    const retriedOpId = failedOps[0].idOperacion;
    expect(await db.lots.get(lot1Res.lot.id)).toBeDefined();

    // Reintentar manualmente conservando idOperacion y completar el envío de todas las operaciones
    await OutboxRepository.resetAllFailedForRetry();
    const pushComplete = await PushSyncEngine.pushPendingOperations();
    expect(pushComplete.status).toBe('completed');
    expect(pushComplete.transientErrorCount).toBe(0);
    expect(pushComplete.confirmedCount).toBeGreaterThanOrEqual(1);

    // Verificar que TODAS las operaciones fueron confirmadas (incluyendo movimiento con idRancho resuelto)
    const allOpsAfterPush = await db.outbox.toArray();
    expect(allOpsAfterPush.every((op) => op.estado === 'confirmado')).toBe(true);
    expect(allOpsAfterPush.some((op) => op.idOperacion === retriedOpId)).toBe(true);

    // Verificar DTO real enviado al servidor (idOperacion, idDispositivo, X-Device-Id, idRancho)
    const movementPushReq = server.receivedPushRequests.find(
      (r) => r.body.entidad === 'MovimientoAnimal'
    );
    expect(movementPushReq).toBeDefined();
    expect(movementPushReq?.body.idRancho).toBe(RANCH_ID);
    expect(movementPushReq?.body.idDispositivo).toBe('device-A-campo');
    expect(movementPushReq?.headers['x-device-id']).toBe('device-A-campo');

    // No repetir operaciones ya confirmadas
    const pushCountBefore = server.receivedPushRequests.length;
    const noopPush = await PushSyncEngine.pushPendingOperations();
    expect(noopPush.status).toBe('nothing_to_push');
    expect(server.receivedPushRequests.length).toBe(pushCountBefore);

    // Verificar reconocimiento explícito de operación duplicada (idempotencia ALREADY_PROCESSED)
    const cattleCreateOp = allOpsAfterPush.find(
      (op) => op.entidad === 'cattle' && op.tipoOperacion === 'CREATE'
    )!;
    await db.outbox.update(cattleCreateOp.idOperacion, { estado: 'pendiente' });
    const dupSummary = await PushSyncEngine.pushPendingOperations();
    expect(dupSummary.alreadyProcessedCount).toBe(1);
    expect(dupSummary.confirmedCount).toBe(1);
    expect(await db.cattle.count()).toBe(1);

    // Pull inicial en Dispositivo A para avanzar sus propios cursores
    await SyncEngine.pullChanges({ pageSize: 1, retryDelayMs: 0 });
    const deviceASnap1 = await snapshotActiveDevice('device-A-campo');

    // =========================================================================
    // 4. DESCARGA PULL PAGINADA EN DISPOSITIVO B (CON REINTENTO TRANSITORIO)
    // =========================================================================
    await clearDeviceDb();
    await seedRanchOnActiveDevice('device-B-oficina');

    // Provocar 1 fallo 503 transitorio en Pull para verificar reintento automático sin avanzar cursor prematuro
    server.failNextPullCount = 1;
    const pullDeviceB = await SyncEngine.pullChanges({
      pageSize: 1, // Forzar paginación real (2 lotes en 2 páginas)
      maxRetriesPerPage: 2,
      retryDelayMs: 0
    });

    const lotsPull = pullDeviceB.find((p) => p.entidad === 'lots')!;
    const cattlePull = pullDeviceB.find((p) => p.entidad === 'cattle')!;
    const movementsPull = pullDeviceB.find((p) => p.entidad === 'movements')!;

    expect(lotsPull.status).toBe('completed');
    expect(lotsPull.pagesProcessed).toBeGreaterThanOrEqual(2);
    expect(lotsPull.retriesPerformed).toBe(1);
    // 2 cambios para el mismo bovino (CREATE v1 + UPDATE de lote por movimiento v2) sin duplicar registro
    expect(cattlePull.appliedCount).toBe(2);
    expect(movementsPull.appliedCount).toBe(1);

    // Comprobar que Dispositivo B recibió exactamente los registros sin duplicados
    expect(await db.lots.count()).toBe(2);
    expect(await db.cattle.count()).toBe(1);
    expect(await db.movements.count()).toBe(1);
    const cattleOnB = await db.cattle.get(cattleRes.animal.id);
    expect(cattleOnB?.arete).toBe('MX-SYNC-001');
    expect(cattleOnB?.serverVersion).toBe(2);
    expect(cattleOnB?.syncStatus).toBe('synced');

    // Re-ejecutar Pull en Dispositivo B -> cursor vigente evita reprocesar o duplicar
    const secondPullB = await SyncEngine.pullChanges({ pageSize: 1, retryDelayMs: 0 });
    expect(secondPullB.every((p) => p.appliedCount === 0)).toBe(true);
    expect(await db.cattle.count()).toBe(1);

    // =========================================================================
    // 5. ACTUALIZACIÓN LOCAL EN DISPOSITIVO B -> PUSH -> PULL EN DISPOSITIVO A
    // =========================================================================
    onlineSpy.mockReturnValue(false);
    await CattleService.update(cattleRes.animal.id, {
      idRancho: RANCH_ID,
      idLote: lot2Res.lot.id,
      arete: 'MX-SYNC-001',
      raza: 'Brahman Rojo',
      sexo: 'Hembra',
      fechaNacimiento: '2023-01-10',
      fechaIngreso: '2023-02-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: 'Actualizado en oficina'
    });
    onlineSpy.mockReturnValue(true);
    const pushUpdateB = await PushSyncEngine.pushPendingOperations();
    expect(pushUpdateB.confirmedCount).toBe(1);
    expect((await db.cattle.get(cattleRes.animal.id))?.serverVersion).toBe(3);

    const deviceBSnap1 = await snapshotActiveDevice('device-B-oficina');

    // Volver a Dispositivo A: Pull descarga la actualización (v2 -> v3)
    await restoreDevice(deviceASnap1);
    await SyncEngine.pullChanges({ pageSize: 10, retryDelayMs: 0 });
    const cattleOnAUpdated = await db.cattle.get(cattleRes.animal.id);
    expect(cattleOnAUpdated?.raza).toBe('Brahman Rojo');
    expect(cattleOnAUpdated?.serverVersion).toBe(3);

    // =========================================================================
    // 6. CONFLICTOS (VERSION_MISMATCH + RESOLUCIÓN MERGE + DELETED_ON_SERVER)
    // =========================================================================
    // Dispositivo A edita offline desde v3
    onlineSpy.mockReturnValue(false);
    await CattleService.update(cattleRes.animal.id, {
      idRancho: RANCH_ID,
      idLote: lot2Res.lot.id,
      arete: 'MX-SYNC-001',
      raza: 'Brahman Campo',
      sexo: 'Hembra',
      fechaNacimiento: '2023-01-10',
      fechaIngreso: '2023-02-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: 'Nota de campo A'
    });
    const deviceASnapWithOfflineEdit = await snapshotActiveDevice('device-A-campo');

    // Mientras tanto Dispositivo B edita el mismo bovino desde v3 y sube primero (v3 -> v4)
    await restoreDevice(deviceBSnap1);
    onlineSpy.mockReturnValue(false);
    await CattleService.update(cattleRes.animal.id, {
      idRancho: RANCH_ID,
      idLote: lot1Res.lot.id,
      arete: 'MX-SYNC-001',
      raza: 'Brahman Oficina',
      sexo: 'Hembra',
      fechaNacimiento: '2023-01-10',
      fechaIngreso: '2023-02-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: 'Nota de oficina B'
    });
    onlineSpy.mockReturnValue(true);
    const pushB4 = await PushSyncEngine.pushPendingOperations();
    expect(pushB4.confirmedCount).toBe(1);
    const deviceBSnapV4 = await snapshotActiveDevice('device-B-oficina');

    // Dispositivo A intenta subir su cambio (versionBase: 3 vs servidor v4) -> 409 VERSION_MISMATCH
    await restoreDevice(deviceASnapWithOfflineEdit);
    onlineSpy.mockReturnValue(true);
    const conflictPush = await PushSyncEngine.pushPendingOperations();
    expect(conflictPush.conflictCount).toBe(1);

    const pendingConflicts = await ConflictResolver.getPendingConflicts();
    expect(pendingConflicts).toHaveLength(1);
    expect(pendingConflicts[0].tipoConflicto).toBe('VERSION_MISMATCH');
    expect(pendingConflicts[0].versionBase).toBe(3);
    expect(pendingConflicts[0].versionServidor).toBe(4);

    // Verificar que los datos locales de A NO fueron sobrescritos antes de resolver
    expect((await db.cattle.get(cattleRes.animal.id))?.raza).toBe('Brahman Campo');

    // Resolver combinando campos (raza local + observaciones del servidor) y sincronizar -> v5
    await ConflictResolver.resolveWithMerge(
      pendingConflicts[0].idConflicto,
      { raza: 'Brahman Combinado', observaciones: 'Nota de oficina B' },
      'Fusión validada'
    );
    const pushAfterMerge = await PushSyncEngine.pushPendingOperations();
    expect(pushAfterMerge.confirmedCount).toBe(1);
    expect((await db.cattle.get(cattleRes.animal.id))?.serverVersion).toBe(5);
    expect(await ConflictResolver.getPendingConflicts()).toHaveLength(0);

    const deviceASnapV5 = await snapshotActiveDevice('device-A-campo');

    // =========================================================================
    // 7. ELIMINACIONES + CONFLICTO DELETED_ON_SERVER
    // =========================================================================
    // Dispositivo B descarga v5 y elimina (baja lógica) el bovino -> v6
    await restoreDevice(deviceBSnapV4);
    await SyncEngine.pullChanges({ pageSize: 10, retryDelayMs: 0 });
    expect((await db.cattle.get(cattleRes.animal.id))?.serverVersion).toBe(5);

    onlineSpy.mockReturnValue(false);
    await CattleService.deactivate(cattleRes.animal.id);
    await LotService.deactivate(lot2Res.lot.id);
    onlineSpy.mockReturnValue(true);
    const pushDeleteB = await PushSyncEngine.pushPendingOperations();
    expect(pushDeleteB.confirmedCount).toBe(2);

    // Dispositivo A intenta editar ese mismo animal desde v5 -> 409 DELETED_ON_SERVER
    await restoreDevice(deviceASnapV5);
    onlineSpy.mockReturnValue(false);
    await CattleService.update(cattleRes.animal.id, {
      idRancho: RANCH_ID,
      idLote: lot1Res.lot.id,
      arete: 'MX-SYNC-001',
      raza: 'Brahman Tardío',
      sexo: 'Hembra',
      fechaNacimiento: '2023-01-10',
      fechaIngreso: '2023-02-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null
    });
    onlineSpy.mockReturnValue(true);
    const deletedConflictPush = await PushSyncEngine.pushPendingOperations();
    expect(deletedConflictPush.conflictCount).toBe(1);

    const deletedConflicts = await ConflictResolver.getPendingConflicts();
    expect(deletedConflicts).toHaveLength(1);
    expect(deletedConflicts[0].tipoConflicto).toBe('DELETED_ON_SERVER');

    // Aceptar eliminación del servidor -> queda marcado eliminado (tombstone) sin duplicar
    await ConflictResolver.resolveWithServer(deletedConflicts[0].idConflicto);
    const deletedOnA = await db.cattle.get(cattleRes.animal.id);
    expect(deletedOnA?.deletedAt).toBeTruthy();
    expect(deletedOnA?.syncStatus).toBe('synced');

    // Pull en Dispositivo A también aplica la eliminación remota limpia de lot2 (tombstone DELETE)
    const pullDeletesA = await SyncEngine.pullChanges({ pageSize: 10, retryDelayMs: 0 });
    const lotDeletePull = pullDeletesA.find((p) => p.entidad === 'lots')!;
    expect(lotDeletePull.deletedCount).toBe(1);
    expect((await db.lots.get(lot2Res.lot.id))?.deletedAt).toBeTruthy();

    // =========================================================================
    // 8. PROTECCIÓN DEL CURSOR ANTE ERROR EN PULL (422)
    // =========================================================================
    const lotCursorBeforeError = await CheckpointRepository.getCursor('lots');
    server.failPullWith422OnCursor = lotCursorBeforeError;
    const failedPull = await SyncPullEngine.pullEntity('lots', {
      ranchId: RANCH_ID,
      maxRetriesPerPage: 2,
      retryDelayMs: 0
    });
    expect(failedPull.status).toBe('transaction_failed');
    expect(failedPull.currentCursor).toBe(lotCursorBeforeError);
    expect(await CheckpointRepository.getCursor('lots')).toBe(lotCursorBeforeError);
    server.failPullWith422OnCursor = null;

    // =========================================================================
    // 9. RECONEXIÓN DESPUÉS DE PÉRDIDA DE INTERNET (SyncScheduler)
    // =========================================================================
    onlineSpy.mockReturnValue(false);
    await SyncScheduler.refreshState(false);
    expect(SyncScheduler.getSnapshot().state).toBe('offline');

    await LotService.create({
      idRancho: RANCH_ID,
      nombre: 'Potrero Reconexión',
      ubicacion: 'Sector C',
      estado: 'Activo'
    });
    await SyncScheduler.refreshState(false);
    expect(SyncScheduler.getSnapshot().counts.pendingOperationsCount).toBeGreaterThanOrEqual(1);

    // Recuperar Internet -> ciclo Push + Pull completo
    onlineSpy.mockReturnValue(true);
    const reconnectCycle = await SyncScheduler.triggerSync('online_recovered');
    expect(reconnectCycle?.allTasksCompleted).toBe(true);
    expect(SyncScheduler.getSnapshot().state).toBe('synced');
    expect(SyncScheduler.getSnapshot().lastCompletedSyncAt).toBeTruthy();
    expect(SyncScheduler.getSnapshot().counts.pendingOperationsCount).toBe(0);
    expect(SyncScheduler.getSnapshot().counts.confirmedOperationsCount).toBeGreaterThan(0);
  });
});
