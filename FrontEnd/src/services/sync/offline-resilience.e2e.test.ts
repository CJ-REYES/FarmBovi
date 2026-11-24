import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, PERSISTED_SESSION_META_KEY, authApi, ranchesApi } from '../../lib/api';
import { db } from '../../lib/database/db';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { SyncMetadataRepository } from '../../lib/database/repositories/sync-metadata.repository';
import type { LocalLot, LocalMedia, LocalRanch } from '../../lib/database/schema';
import { AuthService } from '../auth.service';
import { ConnectivityService } from '../connectivity.service';
import { LotService } from '../lot.service';
import { MediaSyncEngine } from './media-sync.engine';
import { PushSyncEngine } from './push-sync.engine';
import { SyncEngine } from './sync-engine';
import { SyncHttpClient } from './sync-http.client';
import { SyncCrossTabLock } from './sync-lock';
import { PULL_ENTITY_ORDER, SyncPullEngine } from './sync-pull.engine';
import { SyncScheduler } from './sync-scheduler';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

function seedSession(params: {
  userId: string;
  token?: string;
  ranchIds: string[];
  preferredRanchId?: string | null;
}): void {
  const sessionObj = {
    token: params.token ?? 'jwt-valid-token',
    authMode: 'bearer',
    expiraEn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    idUsuario: params.userId,
    nombre: `Usuario ${params.userId.slice(0, 4)}`,
    correo: `${params.userId.slice(0, 4)}@farmbovi.test`,
    ranchos: params.ranchIds.map((id, idx) => ({
      idRancho: id,
      nombre: `Rancho ${idx + 1}`,
      rol: 'Admin'
    })),
    fotoPerfilUrl: null,
    configuracion: {
      unidadPeso: 'kg',
      diasAvisoAlertas: 7,
      sincronizacionAutomatica: true,
      formatoFecha: 'dd/MM/yyyy',
      ranchoPredeterminadoId: params.preferredRanchId ?? params.ranchIds[0] ?? null
    }
  };

  window.sessionStorage.setItem('farmbovi_access_token', sessionObj.token);
  window.sessionStorage.setItem('farmbovi_session_user', JSON.stringify(sessionObj));
  window.localStorage.setItem(PERSISTED_SESSION_META_KEY, JSON.stringify(sessionObj));
}

async function seedRanch(id: string, nombre: string): Promise<void> {
  const now = new Date().toISOString();
  const ranch: LocalRanch = {
    id,
    remoteId: id,
    ranchId: id,
    nombre,
    ubicacionGeneral: 'Zona Ganadera',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  };
  await db.ranches.put(ranch);
}

describe('Motor Offline-First — Resiliencia ante interrupciones, reinicios, JWT y multi-rancho', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    SyncScheduler.stop();
    SyncCrossTabLock.forceReleaseLocalLease();
    window.sessionStorage.clear();
    window.localStorage.clear();
    setNavigatorOnline(true);

    await Promise.all([
      db.ranches.clear(),
      db.lots.clear(),
      db.cattle.clear(),
      db.weighings.clear(),
      db.healthRecords.clear(),
      db.treatments.clear(),
      db.feedingRecords.clear(),
      db.reproductionRecords.clear(),
      db.movements.clear(),
      db.genealogy.clear(),
      db.alerts.clear(),
      db.media.clear(),
      db.weighingAnalysisJobs.clear(),
      db.outbox.clear(),
      db.syncCheckpoints.clear(),
      db.syncConflicts.clear(),
      db.syncMetadata.clear()
    ]);

    SyncHttpClient.configureEndpoints({
      pushEndpoint: 'http://localhost:5000/api/sync/operaciones',
      pullEndpoint: 'http://localhost:5000/api/sync/cambios'
    });

    vi.spyOn(ConnectivityService, 'checkBackendAvailability').mockImplementation(async () => ({
      isOnline: navigator.onLine,
      backendReachable: navigator.onLine,
      checkedEndpoint: 'http://localhost:5000/api/health',
      httpStatus: navigator.onLine ? 200 : null,
      checkedAt: new Date().toISOString()
    }));

    vi.spyOn(MediaSyncEngine, 'syncPendingMedia').mockResolvedValue({
      uploadedCount: 0,
      deletedCount: 0,
      pulledCount: 0,
      errorCount: 0
    });
  });

  afterEach(() => {
    SyncScheduler.stop();
    SyncCrossTabLock.forceReleaseLocalLease();
    vi.restoreAllMocks();
    setNavigatorOnline(true);
  });

  it('1. Pérdida de conexión durante Push: conserva la operación intacta sin marcarla sincronizada ni quemar intentos, refleja estado offline y recupera al reconectar', async () => {
    await seedRanch(RANCH_A, 'Rancho Norte');
    const created = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Potrero Resiliente',
      ubicacion: 'Sector A',
      estado: 'Activo'
    });

    const initialOp = (await db.outbox.where('idEntidad').equals(created.lot.id).first())!;
    expect(initialOp).toBeDefined();
    const originalOpId = initialOp.idOperacion;

    const sentOpIds: string[] = [];
    const sendSpy = vi.spyOn(SyncHttpClient, 'sendOperation').mockImplementation(async (dto) => {
      sentOpIds.push(dto.idOperacion);
      if (sentOpIds.length === 1) {
        // Simula pérdida repentina de red justo durante el vuelo de la petición HTTP
        setNavigatorOnline(false);
        return {
          idOperacion: dto.idOperacion,
          entidad: dto.entidad,
          idEntidad: dto.idEntidad,
          resultado: 'TRANSIENT_ERROR',
          mensaje: 'Failed to fetch',
          codigoHttp: 0
        };
      }
      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        remoteId: dto.idEntidad,
        versionServidor: 1,
        resultado: 'ACCEPTED'
      };
    });

    const pullSpy = vi.spyOn(SyncPullEngine, 'pullAllEntities').mockResolvedValue(
      PULL_ENTITY_ORDER.map((entidad) => ({
        entidad,
        ranchId: RANCH_A,
        status: 'completed' as const,
        pagesProcessed: 1,
        appliedCount: 0,
        deletedCount: 0,
        conflictCount: 0,
        skippedPendingCount: 0,
        previousCursor: null,
        currentCursor: 'cursor-ok'
      }))
    );

    // Intento 1: se corta el internet a mitad del Push
    const interruptedCycle = await SyncScheduler.triggerSync('manual');
    expect(interruptedCycle?.push.status).toBe('offline');
    expect(interruptedCycle?.offlineInterrupted).toBe(true);
    expect(interruptedCycle?.allTasksCompleted).toBe(false);
    // No debió ejecutar Pull porque Push detectó desconexión
    expect(pullSpy).not.toHaveBeenCalled();

    // SyncScheduler debe reflejar estado real offline (nunca isOnline=true falso)
    const snapOffline = SyncScheduler.getSnapshot();
    expect(snapOffline.isOnline).toBe(false);
    expect(snapOffline.state).toBe('offline');

    // La operación sigue pendiente con el mismo idOperacion y 0 intentos quemados
    const opAfterDrop = await db.outbox.get(originalOpId);
    expect(opAfterDrop?.estado).toBe('pendiente');
    expect(opAfterDrop?.intentos).toBe(0);
    expect((await db.lots.get(created.lot.id))?.syncStatus).toBe('pending');

    // Intento 2: regresa el internet -> envía el mismo idOperacion y confirma
    setNavigatorOnline(true);
    const recoveredCycle = await SyncScheduler.triggerSync('online_recovered');
    expect(recoveredCycle?.allTasksCompleted).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sentOpIds[0]).toBe(originalOpId);
    expect(sentOpIds[1]).toBe(originalOpId);

    const opAfterRecovery = await db.outbox.get(originalOpId);
    expect(opAfterRecovery?.estado).toBe('confirmado');
    expect((await db.lots.get(created.lot.id))?.syncStatus).toBe('synced');
    expect(SyncScheduler.getSnapshot().state).toBe('synced');
  });

  it('2. Reinicio del navegador tras operación/media interrumpida: recupera en_proceso y subiendo, mantiene idOperacion + idDispositivo e idempotencia ALREADY_PROCESSED', async () => {
    await seedRanch(RANCH_A, 'Rancho Reinicio');
    const created = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Potrero Crash',
      ubicacion: 'Norte',
      estado: 'Activo'
    });
    const op = (await db.outbox.where('idEntidad').equals(created.lot.id).first())!;

    // Simular cierre abrupto del navegador dejando Outbox en 'en_proceso' y Media en 'subiendo'
    await db.outbox.update(op.idOperacion, {
      estado: 'en_proceso',
      idDispositivo: null
    });

    const mediaId = crypto.randomUUID();
    const stuckMedia: LocalMedia = {
      id: mediaId,
      ranchId: RANCH_A,
      entidadRelacionada: 'cattle',
      tipo: 'FotoPerfil',
      nombreArchivo: 'vaca.jpg',
      mimeType: 'image/jpeg',
      tamanoBytes: 128,
      blobData: new Blob(['img'], { type: 'image/jpeg' }),
      estadoArchivo: 'subiendo',
      intentosSubida: 0,
      fechaCaptura: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
      deletedAt: null
    };
    await db.media.put(stuckMedia);

    // Reapertura de la app (offline): debe recuperar ambos sin perder nada
    setNavigatorOnline(false);
    await SyncScheduler.handleAppStartup();

    expect((await db.outbox.get(op.idOperacion))?.estado).toBe('pendiente');
    expect((await db.media.get(mediaId))?.estadoArchivo).toBe('pendiente_subida');

    // Al volver a estar en línea, reenvía con idDispositivo persistido y recibe ALREADY_PROCESSED
    setNavigatorOnline(true);
    let capturedDeviceId: string | null | undefined;
    let capturedOpId: string | undefined;

    vi.spyOn(SyncHttpClient, 'sendOperation').mockImplementation(async (dto) => {
      capturedDeviceId = dto.idDispositivo;
      capturedOpId = dto.idOperacion;
      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        remoteId: dto.idEntidad,
        versionServidor: 1,
        resultado: 'ALREADY_PROCESSED'
      };
    });

    const pushSummary = await PushSyncEngine.pushPendingOperations();
    expect(pushSummary.confirmedCount).toBe(1);
    expect(pushSummary.alreadyProcessedCount).toBe(1);
    expect(capturedOpId).toBe(op.idOperacion);
    expect(capturedDeviceId).toBeTruthy();

    // Verificar que idDispositivo quedó persistido en IndexedDB y no hubo duplicados
    const persistedOp = await db.outbox.get(op.idOperacion);
    expect(persistedOp?.estado).toBe('confirmado');
    expect(persistedOp?.idDispositivo).toBe(capturedDeviceId);
    expect(await db.lots.count()).toBe(1);
    expect((await db.lots.get(created.lot.id))?.syncStatus).toBe('synced');
  });

  it('3. Pérdida de conexión durante Pull multipágina: conserva el checkpoint de la página 1 confirmada, registra error y reanuda exactamente desde cursor_1', async () => {
    await seedRanch(RANCH_A, 'Rancho Pull');
    const lot1Id = crypto.randomUUID();
    const lot2Id = crypto.randomUUID();
    const now = new Date().toISOString();

    let callCount = 0;
    const requestedCursors: Array<string | null> = [];

    vi.spyOn(SyncHttpClient, 'fetchChanges').mockImplementation(async (req) => {
      callCount++;
      requestedCursors.push(req.cursorOpaco);

      if (callCount === 1) {
        return {
          entidad: 'lots',
          cambios: [
            {
              remoteId: lot1Id,
              clientUuid: lot1Id,
              operacion: 'UPSERT',
              versionServidor: 1,
              eliminado: false,
              actualizadoEnServidor: now,
              datos: {
                idLote: lot1Id,
                idRancho: RANCH_A,
                nombre: 'Lote Página 1',
                estado: 'Activo'
              }
            }
          ],
          siguienteCursorOpaco: 'cursor_page_1',
          hayMasPaginas: true,
          fechaServidor: now
        };
      }

      if (callCount === 2) {
        // Se corta la conexión al solicitar página 2
        setNavigatorOnline(false);
        throw new ApiError('Sin conexión', 0);
      }

      // Al reconectar, reanuda desde cursor_page_1
      return {
        entidad: 'lots',
        cambios: [
          {
            remoteId: lot2Id,
            clientUuid: lot2Id,
            operacion: 'UPSERT',
            versionServidor: 1,
            eliminado: false,
            actualizadoEnServidor: now,
            datos: {
              idLote: lot2Id,
              idRancho: RANCH_A,
              nombre: 'Lote Página 2',
              estado: 'Activo'
            }
          }
        ],
        siguienteCursorOpaco: 'cursor_page_2',
        hayMasPaginas: false,
        fechaServidor: now
      };
    });

    const firstPull = await SyncPullEngine.pullEntity('lots', {
      ranchId: RANCH_A,
      pageSize: 1,
      maxRetriesPerPage: 0,
      retryDelayMs: 0
    });

    expect(firstPull.status).toBe('offline');
    expect(firstPull.pagesProcessed).toBe(1);
    expect(firstPull.appliedCount).toBe(1);
    expect(firstPull.currentCursor).toBe('cursor_page_1');
    expect(await CheckpointRepository.getCursor('lots', RANCH_A)).toBe('cursor_page_1');
    expect(await db.lots.get(lot1Id)).toBeDefined();
    expect(await db.lots.get(lot2Id)).toBeUndefined();

    const metaAfterDrop = await SyncMetadataRepository.getByEntity('lots');
    expect(metaAfterDrop?.lastErrorPhase).toBe('pull');
    expect(metaAfterDrop?.lastErrorCode).toBe(0);

    // Reconexión: reanuda desde cursor_page_1 sin re-descargar página 1
    setNavigatorOnline(true);
    const secondPull = await SyncPullEngine.pullEntity('lots', {
      ranchId: RANCH_A,
      pageSize: 1,
      maxRetriesPerPage: 0,
      retryDelayMs: 0
    });

    expect(secondPull.status).toBe('completed');
    expect(secondPull.appliedCount).toBe(1);
    expect(secondPull.currentCursor).toBe('cursor_page_2');
    expect(requestedCursors).toEqual([null, 'cursor_page_1', 'cursor_page_1']);
    expect(await db.lots.get(lot2Id)).toBeDefined();

    // El error de Pull en syncMetadata se limpia al completar exitosamente
    const metaAfterRecover = await SyncMetadataRepository.getByEntity('lots');
    expect(metaAfterRecover?.lastError).toBeNull();
    expect(metaAfterRecover?.consecutiveFailures).toBe(0);
  });

  it('4. Respuestas parciales, HTTP 503 con backoff y HTTP 422 en Pull: nunca confirma sin validación y registra errores por entidad', async () => {
    await seedRanch(RANCH_A, 'Rancho Errores');
    const created = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Potrero 503',
      ubicacion: 'Este',
      estado: 'Activo'
    });
    const op = (await db.outbox.where('idEntidad').equals(created.lot.id).first())!;

    // Simular respuesta HTTP 503 con Retry-After -> aplica backoff y registra error en syncMetadata
    vi.spyOn(SyncHttpClient, 'sendOperation').mockResolvedValueOnce({
      idOperacion: op.idOperacion,
      entidad: 'lots',
      idEntidad: created.lot.id,
      resultado: 'TRANSIENT_ERROR',
      mensaje: 'Servicio temporalmente no disponible (503)',
      codigoHttp: 503,
      retryAfterMs: 30_000
    });

    const firstPush = await PushSyncEngine.pushPendingOperations();
    expect(firstPush.transientErrorCount).toBe(1);
    expect(firstPush.confirmedCount).toBe(0);

    const opAfter503 = await db.outbox.get(op.idOperacion);
    expect(opAfter503?.estado).toBe('fallido');
    expect(opAfter503?.intentos).toBe(1);
    expect(opAfter503?.proximoIntento).toBeTruthy();

    // Antes de que venza el backoff, NO debe despacharse de nuevo
    const dispatchableNow = await OutboxRepository.getDispatchableOperations();
    expect(dispatchableNow).toHaveLength(0);

    const metaAfter503 = await SyncMetadataRepository.getByEntity('lots');
    expect(metaAfter503?.lastErrorPhase).toBe('push');
    expect(metaAfter503?.lastErrorCode).toBe(503);
    expect(metaAfter503?.consecutiveFailures).toBe(1);

    // Pull con HTTP 422 preserva el cursor y registra error por entidad
    vi.spyOn(SyncHttpClient, 'fetchChanges').mockRejectedValueOnce(
      new ApiError('Cursor inválido o registro corrupto', 422)
    );
    const failedPull = await SyncPullEngine.pullEntity('cattle', {
      ranchId: RANCH_A,
      maxRetriesPerPage: 0,
      retryDelayMs: 0
    });
    expect(failedPull.status).toBe('transaction_failed');
    expect(failedPull.httpStatus).toBe(422);
    expect(await CheckpointRepository.getCursor('cattle', RANCH_A)).toBeNull();

    const cattleMeta = await SyncMetadataRepository.getByEntity('cattle');
    expect(cattleMeta?.lastErrorPhase).toBe('pull');
    expect(cattleMeta?.lastErrorCode).toBe(422);
  });

  it('5. Expiración del JWT (401) durante Push y Pull: detiene el lote sin quemar intentos, omite Pull y reanuda al re-autenticar', async () => {
    await seedRanch(RANCH_A, 'Rancho JWT');
    const lot1 = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Lote JWT 1',
      ubicacion: null,
      estado: 'Activo'
    });
    const lot2 = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Lote JWT 2',
      ubicacion: null,
      estado: 'Activo'
    });

    const op1 = (await db.outbox.where('idEntidad').equals(lot1.lot.id).first())!;
    const op2 = (await db.outbox.where('idEntidad').equals(lot2.lot.id).first())!;

    const sendSpy = vi.spyOn(SyncHttpClient, 'sendOperation').mockResolvedValueOnce({
      idOperacion: op1.idOperacion,
      entidad: 'lots',
      idEntidad: lot1.lot.id,
      resultado: 'TRANSIENT_ERROR',
      mensaje: 'Sesión expirada (401).',
      codigoHttp: 401
    });
    const pullSpy = vi.spyOn(SyncPullEngine, 'pullAllEntities');

    const authCycle = await SyncScheduler.triggerSync('manual');
    expect(authCycle?.push.status).toBe('auth_required');
    expect(authCycle?.authRequired).toBe(true);
    expect(authCycle?.allTasksCompleted).toBe(false);
    // Solo intentó la 1ª operación; al recibir 401 abortó la 2ª y tampoco ejecutó Pull
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(pullSpy).not.toHaveBeenCalled();

    // Ninguna de las 2 operaciones quemó intentos ni se borró
    expect((await db.outbox.get(op1.idOperacion))?.estado).toBe('pendiente');
    expect((await db.outbox.get(op1.idOperacion))?.intentos).toBe(0);
    expect((await db.outbox.get(op2.idOperacion))?.estado).toBe('pendiente');
    expect((await db.outbox.get(op2.idOperacion))?.intentos).toBe(0);

    expect(SyncScheduler.getSnapshot().authRequired).toBe(true);
    expect(SyncScheduler.getSnapshot().state).toBe('error');

    // Simular 401 directo en Pull: debe marcar auth_required y detener entidades restantes
    const fetchSpy = vi
      .spyOn(SyncHttpClient, 'fetchChanges')
      .mockRejectedValueOnce(new ApiError('Token JWT expirado', 401));
    const pullResults = await SyncPullEngine.pullAllEntities({
      ranchId: RANCH_A,
      maxRetriesPerPage: 0
    });
    expect(pullResults).toHaveLength(1);
    expect(pullResults[0].status).toBe('auth_required');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('6. Sincronización multi-rancho: descarga ambos ranchos autorizados y aísla sus checkpoints en cursorsByRanch sin mezclarlos', async () => {
    await seedRanch(RANCH_A, 'Rancho Alfa');
    await seedRanch(RANCH_B, 'Rancho Beta');
    seedSession({
      userId: USER_A,
      ranchIds: [RANCH_A, RANCH_B],
      preferredRanchId: RANCH_A
    });

    const lotAId = crypto.randomUUID();
    const lotBId = crypto.randomUUID();
    const now = new Date().toISOString();

    vi.spyOn(SyncHttpClient, 'fetchChanges').mockImplementation(async (req) => {
      if (req.entidad === 'lots' && req.ranchId === RANCH_A) {
        return {
          entidad: 'lots',
          cambios:
            req.cursorOpaco === null
              ? [
                  {
                    remoteId: lotAId,
                    clientUuid: lotAId,
                    operacion: 'UPSERT',
                    versionServidor: 1,
                    eliminado: false,
                    actualizadoEnServidor: now,
                    datos: { idLote: lotAId, idRancho: RANCH_A, nombre: 'Lote Alfa', estado: 'Activo' }
                  }
                ]
              : [],
          siguienteCursorOpaco: 'cursor_rancho_A_v1',
          hayMasPaginas: false,
          fechaServidor: now
        };
      }

      if (req.entidad === 'lots' && req.ranchId === RANCH_B) {
        return {
          entidad: 'lots',
          cambios:
            req.cursorOpaco === null
              ? [
                  {
                    remoteId: lotBId,
                    clientUuid: lotBId,
                    operacion: 'UPSERT',
                    versionServidor: 1,
                    eliminado: false,
                    actualizadoEnServidor: now,
                    datos: { idLote: lotBId, idRancho: RANCH_B, nombre: 'Lote Beta', estado: 'Activo' }
                  }
                ]
              : [],
          siguienteCursorOpaco: 'cursor_rancho_B_v1',
          hayMasPaginas: false,
          fechaServidor: now
        };
      }

      return {
        entidad: req.entidad,
        cambios: [],
        siguienteCursorOpaco: `cursor_${req.ranchId}_${req.entidad}`,
        hayMasPaginas: false,
        fechaServidor: now
      };
    });

    const cycle = await SyncEngine.sync({ retryDelayMs: 0 });
    expect(cycle?.allTasksCompleted).toBe(true);
    expect(cycle?.syncedRanchIds).toEqual([RANCH_A, RANCH_B]);

    // Ambos lotes se descargaron en IndexedDB
    expect((await db.lots.get(lotAId))?.ranchId).toBe(RANCH_A);
    expect((await db.lots.get(lotBId))?.ranchId).toBe(RANCH_B);

    // Cada rancho conserva su propio cursor aislado dentro de db.syncCheckpoints
    expect(await CheckpointRepository.getCursor('lots', RANCH_A)).toBe('cursor_rancho_A_v1');
    expect(await CheckpointRepository.getCursor('lots', RANCH_B)).toBe('cursor_rancho_B_v1');
  });

  it('7. Cambio de usuario: purga filas synced de TODAS las tablas de la cuenta anterior, conserva cambios pendientes sin enviarlos con 403', async () => {
    window.localStorage.setItem('farmbovi_last_user_id', USER_A);
    await seedRanch(RANCH_A, 'Rancho Usuario A');

    const now = new Date().toISOString();
    const syncedCattleId = crypto.randomUUID();

    // Sembrar registros `synced` del Usuario A en múltiples tablas
    await db.lots.put({
      id: crypto.randomUUID(),
      remoteId: crypto.randomUUID(),
      ranchId: RANCH_A,
      nombre: 'Lote Synced A',
      capacidad: 50,
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });
    await db.cattle.put({
      id: syncedCattleId,
      remoteId: syncedCattleId,
      ranchId: RANCH_A,
      arete: 'A-001',
      areteSiniiga: 'A-001',
      raza: 'Angus',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaIngreso: now,
      procedencia: 'Rancho',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });
    await db.reproductionRecords.put({
      id: crypto.randomUUID(),
      remoteId: crypto.randomUUID(),
      ranchId: RANCH_A,
      cattleId: syncedCattleId,
      evento: 'DeteccionCelo',
      fecha: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });
    await db.weighings.put({
      id: crypto.randomUUID(),
      remoteId: crypto.randomUUID(),
      ranchId: RANCH_A,
      cattleId: syncedCattleId,
      peso: 420,
      fecha: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });
    await SyncMetadataRepository.recordError('lots', {
      phase: 'pull',
      message: 'Error previo cuenta A',
      code: 500,
      ranchId: RANCH_A
    });

    // Además, el Usuario A dejó 1 lote pendiente sin sincronizar en RANCH_A
    const pendingLotA = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Lote Pendiente A (no debe perderse)',
      ubicacion: null,
      estado: 'Activo'
    });

    // Inicia sesión el Usuario B (autorizado únicamente a RANCH_B)
    vi.spyOn(authApi, 'login').mockResolvedValue({
      token: 'jwt-user-b',
      expiraEn: new Date(Date.now() + 3600_000).toISOString(),
      idUsuario: USER_B,
      nombre: 'Usuario B',
      correo: 'b@farmbovi.test',
      ranchos: [{ idRancho: RANCH_B, nombre: 'Rancho B', rol: 'Admin' }],
      fotoPerfilUrl: null,
      configuracion: {
        unidadPeso: 'kg',
        diasAvisoAlertas: 7,
        sincronizacionAutomatica: true,
        formatoFecha: 'dd/MM/yyyy',
        ranchoPredeterminadoId: RANCH_B
      }
    });
    vi.spyOn(ranchesApi, 'list').mockResolvedValue([
      {
        idRancho: RANCH_B,
        nombre: 'Rancho B',
        ubicacionGeneral: 'Sur',
        estado: 'Activo',
        creadoEn: now,
        eliminadoEn: null,
        versionRegistro: 1
      }
    ]);

    await AuthService.login('b@farmbovi.test', 'Secret123!');

    // Todas las filas synced del Usuario A se purgaron (cattle, weighings, reproduction, syncMetadata)
    expect(await db.cattle.count()).toBe(0);
    expect(await db.weighings.count()).toBe(0);
    expect(await db.reproductionRecords.count()).toBe(0);
    expect(await db.syncMetadata.count()).toBe(0);
    expect(await db.ranches.get(RANCH_A)).toBeUndefined();
    expect(await db.ranches.get(RANCH_B)).toBeDefined();

    // El lote pendiente del Usuario A NO se perdió
    const preservedLot = await db.lots.get(pendingLotA.lot.id);
    expect(preservedLot).toBeDefined();
    expect(preservedLot?.syncStatus).toBe('pending');

    // Al ejecutar Push como Usuario B, la operación de RANCH_A NO se envía al servidor (cero 403)
    const sendSpy = vi.spyOn(SyncHttpClient, 'sendOperation');
    const pushSummary = await PushSyncEngine.pushPendingOperations();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(pushSummary.skippedForeignRanchCount).toBe(1);

    const opA = await db.outbox.where('idEntidad').equals(pendingLotA.lot.id).first();
    expect(opA?.estado).toBe('pendiente');
    expect(opA?.intentos).toBe(0);
  });

  it('8. Prevención de ejecuciones simultáneas conflictivas entre pestañas (SyncCrossTabLock)', async () => {
    await seedRanch(RANCH_A, 'Rancho Lock');
    await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Lote Lock',
      ubicacion: null,
      estado: 'Activo'
    });

    // Simular que otra pestaña ya posee el candado activo en localStorage
    window.localStorage.setItem(
      'farmbovi_sync_cross_tab_lock_v1',
      JSON.stringify({
        ownerId: 'otra-pestana-activa',
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 30_000
      })
    );

    const sendSpy = vi.spyOn(SyncHttpClient, 'sendOperation');
    const blockedResult = await SyncEngine.sync({ ranchId: RANCH_A });
    expect(blockedResult).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();

    // Al liberarse el candado, SyncEngine adquiere el lock y ejecuta Push + Pull
    SyncCrossTabLock.forceReleaseLocalLease();
    sendSpy.mockResolvedValue({
      idOperacion: (await db.outbox.toArray())[0].idOperacion,
      entidad: 'lots',
      idEntidad: (await db.lots.toArray())[0].id,
      remoteId: (await db.lots.toArray())[0].id,
      versionServidor: 1,
      resultado: 'ACCEPTED'
    });
    vi.spyOn(SyncPullEngine, 'pullAllEntities').mockResolvedValue(
      PULL_ENTITY_ORDER.map((entidad) => ({
        entidad,
        ranchId: RANCH_A,
        status: 'completed' as const,
        pagesProcessed: 1,
        appliedCount: 0,
        deletedCount: 0,
        conflictCount: 0,
        skippedPendingCount: 0,
        previousCursor: null,
        currentCursor: 'cursor-after-lock'
      }))
    );

    const okResult = await SyncEngine.sync({ ranchId: RANCH_A });
    expect(okResult?.allTasksCompleted).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('9. Actualización de la interfaz tras Pull incluso cuando otra entidad tuvo conflicto/error en Push', async () => {
    await seedRanch(RANCH_A, 'Rancho UI');
    const createdLot = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Lote Con Conflicto',
      ubicacion: null,
      estado: 'Activo'
    });
    const lotOp = (await db.outbox.where('idEntidad').equals(createdLot.lot.id).first())!;

    const onLotsUpdated = vi.fn();
    const unsubscribe = SyncScheduler.subscribeToDataUpdates(['lots'], onLotsUpdated);

    // Push devuelve conflicto (allTasksCompleted será false, lastCompletedSyncAt NO avanza)
    vi.spyOn(SyncHttpClient, 'sendOperation').mockResolvedValue({
      idOperacion: lotOp.idOperacion,
      entidad: 'lots',
      idEntidad: createdLot.lot.id,
      resultado: 'CONFLICT',
      versionServidor: 3,
      estadoServidor: { nombre: 'Nombre Remoto' },
      mensaje: 'Conflicto de versión'
    });

    // Pull descarga 1 lote nuevo de otro dispositivo
    const remoteLotId = crypto.randomUUID();
    const now = new Date().toISOString();
    vi.spyOn(SyncHttpClient, 'fetchChanges').mockImplementation(async (req) => {
      if (req.entidad === 'lots') {
        return {
          entidad: 'lots',
          cambios: [
            {
              remoteId: remoteLotId,
              clientUuid: remoteLotId,
              operacion: 'UPSERT',
              versionServidor: 1,
              eliminado: false,
              actualizadoEnServidor: now,
              datos: {
                idLote: remoteLotId,
                idRancho: RANCH_A,
                nombre: 'Lote Nuevo Remoto',
                estado: 'Activo'
              }
            }
          ],
          siguienteCursorOpaco: 'cursor_ui_1',
          hayMasPaginas: false,
          fechaServidor: now
        };
      }
      return {
        entidad: req.entidad,
        cambios: [],
        siguienteCursorOpaco: null,
        hayMasPaginas: false,
        fechaServidor: now
      };
    });

    const partialCycle = await SyncScheduler.triggerSync('manual');
    expect(partialCycle?.allTasksCompleted).toBe(false);
    expect(partialCycle?.hasDataChanges).toBe(true);
    expect(SyncScheduler.getSnapshot().lastDataChangeAt).toBe(partialCycle?.finishedAt);

    // El suscriptor de la vista de Lotes SÍ se disparó para refrescar la UI
    expect(onLotsUpdated).toHaveBeenCalledTimes(1);
    const savedRemoteLot = await db.lots.get(remoteLotId);
    expect((savedRemoteLot as LocalLot | undefined)?.nombre).toBe('Lote Nuevo Remoto');

    unsubscribe();
  });

  it('10. Respuesta HTTP 200 parcial/incompleta en Push (sin versionServidor o idOperacion distinto): jamás marca confirmado ni elimina de Outbox', async () => {
    await seedRanch(RANCH_A, 'Rancho Parcial');
    const created = await LotService.create({
      idRancho: RANCH_A,
      nombre: 'Potrero Respuesta Parcial',
      ubicacion: 'Oeste',
      estado: 'Activo'
    });
    const op = (await db.outbox.where('idEntidad').equals(created.lot.id).first())!;

    // Simular respuesta HTTP 200 incompleta (sin versionServidor) directamente en fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          idOperacion: op.idOperacion,
          entidad: 'Lote',
          idRegistro: created.lot.id,
          estado: 'Aplicada'
          // versionServidor intencionalmente ausente
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const summary = await PushSyncEngine.pushPendingOperations();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(summary.confirmedCount).toBe(0);
    expect(summary.transientErrorCount).toBe(1);

    // La operación sigue en Outbox (NO confirmada, NO eliminada) y el lote sigue pending
    const persistedOp = await db.outbox.get(op.idOperacion);
    expect(persistedOp).toBeDefined();
    expect(persistedOp?.estado).toBe('fallido');
    expect(persistedOp?.ultimoError).toMatch(/Respuesta del servidor no válida/i);
    expect((await db.lots.get(created.lot.id))?.syncStatus).toBe('pending');
  });
});
