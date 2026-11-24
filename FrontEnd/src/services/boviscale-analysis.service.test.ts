import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSISTED_SESSION_META_KEY, registerUnauthorizedHandler } from '../lib/api';
import { db } from '../lib/database/db';
import type { LocalRanch } from '../lib/database/schema';
import type { BoviScaleEstimationStep } from '../types/weighing';
import { BoviScaleAnalysisService } from './boviscale-analysis.service';
import { SyncEngine } from './sync/sync-engine';
import { SyncCrossTabLock } from './sync/sync-lock';
import { PULL_ENTITY_ORDER, SyncPullEngine } from './sync/sync-pull.engine';
import { WeighingService } from './weighing.service';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const RANCH_B_ID = '99999999-9999-4999-8999-999999999999';
const ANIMAL_ID = '22222222-2222-4222-8222-222222222222';
const ANIMAL_B_ID = '88888888-8888-4888-8888-888888888888';
const VALID_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

async function seedAnimal(): Promise<void> {
  const now = new Date().toISOString();
  await db.cattle.put({
    id: ANIMAL_ID,
    remoteId: ANIMAL_ID,
    ranchId: RANCH_ID,
    arete: 'MX-BS-101',
    areteSiniiga: 'MX-BS-101',
    raza: 'Brahman',
    sexo: 'Hembra',
    gender: 'Hembra',
    fechaIngreso: '2026-01-10',
    procedencia: 'Propio',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
}

describe('BoviScaleAnalysisService — Integración con Backend .NET (/api/boviscale/estimaciones)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    registerUnauthorizedHandler(null);
    window.sessionStorage.clear();
    window.localStorage.clear();
    setOnline(true);

    if (!db.isOpen()) await db.open();
    await Promise.all([
      db.cattle.clear(),
      db.media.clear(),
      db.weighings.clear(),
      db.outbox.clear(),
      db.weighingAnalysisJobs.clear()
    ]);
    await seedAnimal();
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-boviscale-test');
  });

  afterEach(() => {
    registerUnauthorizedHandler(null);
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    setOnline(true);
  });

  it('ejecuta flujo completo exitoso vía Backend .NET, recorre todos los estados y actualiza db.weighings sin duplicar outbox', async () => {
    const pesajeId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const steps: BoviScaleEstimationStep[] = [];
    const calledUrls: string[] = [];
    let estimationPayload: Record<string, unknown> | null = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      calledUrls.push(url);

      if (url.includes('/api/media/archivos') && init?.method === 'POST') {
        const fd = init.body as FormData;
        const idArchivo = String(fd.get('idArchivo'));
        const now = new Date().toISOString();
        return new Response(
          JSON.stringify({
            idArchivo,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            entidadRelacionada: 'cattle',
            idEntidadRelacionada: ANIMAL_ID,
            tipo: 'BoviScaleVision',
            nombreArchivo: 'lateral.png',
            mimeType: 'image/png',
            extension: '.png',
            tamanoBytes: VALID_PNG.byteLength,
            checksumSha256: null,
            proveedorAlmacenamiento: 'LocalFileSystem',
            rutaArchivo: `ranch/pesaje-ganado/${idArchivo}.png`,
            estado: 'Disponible',
            urlContenido: `/api/media/archivos/${idArchivo}/contenido`,
            urlPublica: `/api/media/archivos/${idArchivo}/contenido`,
            fechaCaptura: now,
            fechaCarga: now,
            creadoEn: now,
            versionRegistro: 1,
            eliminadoEn: null
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/boviscale/estimaciones') && init?.method === 'POST') {
        estimationPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
        const now = new Date().toISOString();
        return new Response(
          JSON.stringify({
            idPesaje: pesajeId,
            idSolicitud: requestId,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            idArchivoMultimedia: estimationPayload.idArchivo,
            pesoEstimadoKg: 482.5,
            unidadPeso: 'kg',
            confianzaModelo: 0.91,
            versionModelo: 'boviscale-v1.2.0',
            observaciones: 'Modelo: Postura lateral óptima',
            origenPesaje: 'boviscale_ia',
            fuenteBascula: 'BoviScale IA (boviscale-v1.2.0)',
            responsable: 'Carlos Ganadero',
            fechaPesaje: now,
            creadoEn: now,
            versionRegistro: 1,
            duplicadoIgnorado: false,
            tiempoProcesamientoMs: 1120
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const result = await BoviScaleAnalysisService.requestWeightEstimation(
      {
        cattleId: ANIMAL_ID,
        blob: new Blob([VALID_PNG], { type: 'image/png' }),
        tipo: 'BoviScaleVision',
        nombreArchivo: 'lateral.png',
        idSolicitud: requestId
      },
      (step) => steps.push(step)
    );

    expect(result.ok).toBe(true);
    expect(result.step).toBe('pesaje_registrado');
    expect(result.estimation?.pesoEstimadoKg).toBe(482.5);
    expect(result.estimation?.unidadPeso).toBe('kg');
    expect(steps).toEqual([
      'fotografia_validada',
      'solicitud_enviada',
      'procesando_estimacion',
      'estimacion_recibida',
      'pesaje_registrado'
    ]);

    // Nunca se comunica directamente con Python; únicamente llama al backend /api/*
    expect(calledUrls.every((u) => u.startsWith('/api/'))).toBe(true);
    expect(estimationPayload).toMatchObject({
      idSolicitud: requestId,
      idAnimal: ANIMAL_ID,
      idRancho: RANCH_ID
    });

    // Historial de pesajes actualizado en IndexedDB como sincronizado (sin duplicar outbox)
    const weighings = await db.weighings.where('cattleId').equals(ANIMAL_ID).toArray();
    expect(weighings).toHaveLength(1);
    expect(weighings[0].id).toBe(pesajeId);
    expect(weighings[0].peso).toBe(482.5);
    expect(weighings[0].origenPesaje).toBe('boviscale_ia');
    expect(weighings[0].syncStatus).toBe('synced');

    const weighingOutboxOps = await db.outbox.where('entidad').equals('weighings').count();
    expect(weighingOutboxOps).toBe(0);
  });

  it('valida presencia de animal y fotografía antes de enviar ninguna petición HTTP', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const noAnimal = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: '',
      blob: new Blob([VALID_PNG], { type: 'image/png' })
    });
    expect(noAnimal.ok).toBe(false);
    expect(noAnimal.step).toBe('error_procesamiento');
    expect(noAnimal.error).toMatch(/animal válido/i);

    const noPhoto = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID
    });
    expect(noPhoto.ok).toBe(false);
    expect(noPhoto.step).toBe('error_procesamiento');
    expect(noPhoto.error).toMatch(/fotografía/i);

    // Escenario 2: Fotografía inválida (tipo no permitido y vacía)
    const invalidMime = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      blob: new Blob(['MZ\x90\x00'], { type: 'application/x-msdownload' })
    });
    expect(invalidMime.ok).toBe(false);
    expect(invalidMime.step).toBe('error_procesamiento');
    expect(invalidMime.error).toMatch(/JPEG, PNG o WebP/i);

    // Escenario 3: Fotografía demasiado grande (> 10 MB)
    const oversized = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      blob: { size: 11 * 1024 * 1024, type: 'image/jpeg' } as Blob
    });
    expect(oversized.ok).toBe(false);
    expect(oversized.step).toBe('error_procesamiento');
    expect(oversized.error).toMatch(/10 MB/i);

    // Escenario 4: Animal inexistente
    const missingAnimal = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: crypto.randomUUID(),
      blob: new Blob([VALID_PNG], { type: 'image/png' })
    });
    expect(missingAnimal.ok).toBe(false);
    expect(missingAnimal.step).toBe('error_procesamiento');
    expect(missingAnimal.error).toMatch(/no existe/i);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.weighings.count()).toBe(0);
  });

  it('maneja timeout (504), JSON incompleto, peso negativo, unidad incorrecta (lb) y error de persistencia MySQL (500) sin registrar ningún pesaje', async () => {
    const mediaId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.media.put({
      id: mediaId,
      remoteId: mediaId,
      ranchId: RANCH_ID,
      cattleId: ANIMAL_ID,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_ID,
      tipo: 'BoviScaleVision',
      nombreArchivo: 'qa.png',
      mimeType: 'image/png',
      tamanoBytes: VALID_PNG.byteLength,
      blobData: new Blob([VALID_PNG], { type: 'image/png' }),
      urlRemota: `/api/media/archivos/${mediaId}/contenido`,
      estadoArchivo: 'subido',
      intentosSubida: 0,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    });

    // Escenario 8: Timeout (504)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Se agotó el tiempo de espera.' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const res504 = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });
    expect(res504.ok).toBe(false);
    expect(res504.httpStatus).toBe(504);
    expect(res504.retryable).toBe(true);
    expect(res504.error).toMatch(/tiempo de espera/i);

    // Escenario 9: Respuesta JSON incompleta (sin pesoEstimadoKg)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ idPesaje: crypto.randomUUID(), idAnimal: ANIMAL_ID }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const resIncomplete = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });
    expect(resIncomplete.ok).toBe(false);
    expect(resIncomplete.step).toBe('error_procesamiento');

    // Escenario 10: Peso negativo en respuesta
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          idPesaje: crypto.randomUUID(),
          idAnimal: ANIMAL_ID,
          pesoEstimadoKg: -30,
          unidadPeso: 'kg'
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const resNeg = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });
    expect(resNeg.ok).toBe(false);

    // Escenario 11: Unidad de medida incorrecta ("lb")
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          idPesaje: crypto.randomUUID(),
          idAnimal: ANIMAL_ID,
          pesoEstimadoKg: 480,
          unidadPeso: 'lb'
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const resUnit = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });
    expect(resUnit.ok).toBe(false);

    // Escenario 12: Error de persistencia MySQL (500)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: 'Error de persistencia en base de datos.',
          detail: 'No fue posible guardar el pesaje estimado en la base de datos.'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const resDbErr = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });
    expect(resDbErr.ok).toBe(false);
    expect(resDbErr.httpStatus).toBe(500);
    expect(resDbErr.retryable).toBe(true);
    expect(resDbErr.error).toMatch(/base de datos/i);

    // En ninguno de los 5 escenarios de error se creó un pesaje
    expect(await db.weighings.count()).toBe(0);
  });

  it('cuando Python no responde (503/504) o rechaza (422) informa error claro y NO registra ningún pesaje', async () => {
    // Subir foto previa ya sincronizada
    const mediaId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.media.put({
      id: mediaId,
      remoteId: mediaId,
      ranchId: RANCH_ID,
      cattleId: ANIMAL_ID,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_ID,
      tipo: 'BoviScaleVision',
      nombreArchivo: 'vaca.png',
      mimeType: 'image/png',
      tamanoBytes: VALID_PNG.byteLength,
      blobData: new Blob([VALID_PNG], { type: 'image/png' }),
      urlRemota: `/api/media/archivos/${mediaId}/contenido`,
      estadoArchivo: 'subido',
      intentosSubida: 0,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    });

    // 1. 503 Python no responde
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: 'No fue posible establecer conexión con el servicio de estimación.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const res503 = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });
    expect(res503.ok).toBe(false);
    expect(res503.step).toBe('error_procesamiento');
    expect(res503.httpStatus).toBe(503);
    expect(res503.retryable).toBe(true);
    expect(res503.error).toMatch(/no pudo completarse/i);

    // 2. 422 Modelo rechaza fotografía
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: 'No se detectó un bovino en posición lateral.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const res422 = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });
    expect(res422.ok).toBe(false);
    expect(res422.httpStatus).toBe(422);
    expect(res422.retryable).toBe(false);
    expect(res422.error).toMatch(/No se detectó un bovino/i);

    expect(await db.weighings.count()).toBe(0);
  });

  it('si el JWT expiró (401) invoca el manejador de sesión existente y no muestra éxito ni registra pesaje', async () => {
    const unauthorizedSpy = vi.fn();
    registerUnauthorizedHandler(unauthorizedSpy);

    const mediaId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.media.put({
      id: mediaId,
      remoteId: mediaId,
      ranchId: RANCH_ID,
      cattleId: ANIMAL_ID,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_ID,
      tipo: 'BoviScaleVision',
      nombreArchivo: 'vaca.png',
      mimeType: 'image/png',
      tamanoBytes: VALID_PNG.byteLength,
      blobData: new Blob([VALID_PNG], { type: 'image/png' }),
      urlRemota: `/api/media/archivos/${mediaId}/contenido`,
      estadoArchivo: 'subido',
      intentosSubida: 0,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Token expirado.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const res = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId
    });

    expect(res.ok).toBe(false);
    expect(res.step).toBe('error_procesamiento');
    expect(res.httpStatus).toBe(401);
    expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
    expect(await db.weighings.count()).toBe(0);
  });

  it('en modo offline guarda la fotografía y la solicitud pendiente en IndexedDB, no inventa peso y la recupera automáticamente al reconectar vía SyncEngine', async () => {
    // Sembrar un pesaje manual previo para verificar que el historial conserva pesajes anteriores
    const now = new Date().toISOString();
    const ranch: LocalRanch = {
      id: RANCH_ID,
      remoteId: RANCH_ID,
      ranchId: RANCH_ID,
      nombre: 'Rancho Norte',
      ubicacionGeneral: 'Norte',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    };
    await db.ranches.put(ranch);

    const priorManualId = crypto.randomUUID();
    await db.weighings.put({
      id: priorManualId,
      remoteId: priorManualId,
      ranchId: RANCH_ID,
      cattleId: ANIMAL_ID,
      peso: 430,
      fecha: '2026-10-01T10:00:00Z',
      fuenteBascula: 'Báscula mecánica',
      responsable: 'Operador',
      origenPesaje: 'manual',
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-10-01T10:00:00Z',
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });

    const sessionObj = {
      token: 'jwt-boviscale-test',
      authMode: 'bearer',
      expiraEn: new Date(Date.now() + 3600_000).toISOString(),
      idUsuario: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      nombre: 'Ganadero A',
      correo: 'a@farmbovi.test',
      ranchos: [{ idRancho: RANCH_ID, nombre: 'Rancho Norte', rol: 'Administrador' }]
    };
    window.sessionStorage.setItem('farmbovi_session_user', JSON.stringify(sessionObj));
    window.localStorage.setItem(PERSISTED_SESSION_META_KEY, JSON.stringify(sessionObj));

    // 1. Captura y solicitud de análisis sin conexión
    setOnline(false);
    const offlineRes = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      blob: new Blob([VALID_PNG], { type: 'image/png' }),
      tipo: 'BoviScaleVision'
    });

    expect(offlineRes.ok).toBe(false);
    expect(offlineRes.queuedOffline).toBe(true);
    expect(offlineRes.step).toBe('error_procesamiento');
    expect(offlineRes.retryable).toBe(true);
    expect(offlineRes.mediaId).toBeTruthy();
    expect(offlineRes.error).toMatch(/requiere conexión con el servidor/i);

    // No se creó ningún pesaje nuevo mientras estuvo sin conexión (solo sigue el manual previo)
    expect(await db.weighings.count()).toBe(1);

    // La solicitud pendiente quedó guardada en db.weighingAnalysisJobs y sobrevive cierre/reapertura
    db.close();
    await db.open();
    const pendingAfterReopen = await BoviScaleAnalysisService.getPendingOfflineRequests(ANIMAL_ID);
    expect(pendingAfterReopen).toHaveLength(1);
    expect(pendingAfterReopen[0].idTrabajo).toBe(offlineRes.idSolicitud);
    expect(pendingAfterReopen[0].estado).toBe('pendiente_de_analisis');

    // 2. Se restablece la conexión -> SyncEngine sube la foto y recupera la solicitud pendiente
    setOnline(true);
    SyncCrossTabLock.forceReleaseLocalLease();
    const boviPesajeId = crypto.randomUUID();
    vi.spyOn(SyncPullEngine, 'pullAllEntities').mockResolvedValue(
      PULL_ENTITY_ORDER.map((entidad) => ({
        entidad,
        ranchId: RANCH_ID,
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/media/archivos') && init?.method === 'POST') {
        const fd = init.body as FormData;
        const idArchivo = String(fd.get('idArchivo'));
        return new Response(
          JSON.stringify({
            idArchivo,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            entidadRelacionada: 'cattle',
            idEntidadRelacionada: ANIMAL_ID,
            tipo: 'BoviScaleVision',
            nombreArchivo: 'offline.png',
            mimeType: 'image/png',
            extension: '.png',
            tamanoBytes: VALID_PNG.byteLength,
            checksumSha256: null,
            proveedorAlmacenamiento: 'LocalFileSystem',
            rutaArchivo: `ranch/pesaje-ganado/${idArchivo}.png`,
            estado: 'Disponible',
            urlContenido: `/api/media/archivos/${idArchivo}/contenido`,
            urlPublica: `/api/media/archivos/${idArchivo}/contenido`,
            fechaCaptura: now,
            fechaCarga: now,
            creadoEn: now,
            versionRegistro: 1,
            eliminadoEn: null
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/boviscale/estimaciones') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            idPesaje: boviPesajeId,
            idSolicitud: body.idSolicitud,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            idArchivoMultimedia: body.idArchivo,
            pesoEstimadoKg: 495.0,
            unidadPeso: 'kg',
            confianzaModelo: 0.93,
            versionModelo: 'boviscale-v1.3.0',
            observaciones: 'Recuperado tras reconexión',
            origenPesaje: 'boviscale_ia',
            fuenteBascula: 'BoviScale IA (boviscale-v1.3.0)',
            responsable: 'Ganadero A',
            fechaPesaje: '2026-11-24T02:00:00Z',
            creadoEn: now,
            versionRegistro: 1,
            duplicadoIgnorado: false,
            tiempoProcesamientoMs: 880
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const cycle = await SyncEngine.sync();
    expect(cycle?.hasDataChanges).toBe(true);

    // La solicitud pendiente pasó a confirmada y el historial conserva ambos pesajes (manual + BoviScale IA)
    expect(await BoviScaleAnalysisService.getPendingOfflineRequests(ANIMAL_ID)).toHaveLength(0);

    const history = await WeighingService.getAll({ cattleId: ANIMAL_ID });
    expect(history.data).toHaveLength(2);
    expect(history.data.some((w) => w.id === priorManualId && w.origenPesaje === 'manual')).toBe(true);
    expect(
      history.data.some(
        (w) => w.id === boviPesajeId && w.origenPesaje === 'boviscale_ia' && w.pesoRealKg === 495
      )
    ).toBe(true);
  });

  it('reintento exitoso tras 503, respuesta duplicada no crea dos pesajes y bloquea animal de otro rancho (403)', async () => {
    const mediaId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const pesajeId = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.media.put({
      id: mediaId,
      remoteId: mediaId,
      ranchId: RANCH_ID,
      cattleId: ANIMAL_ID,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_ID,
      tipo: 'BoviScaleVision',
      nombreArchivo: 'retry.png',
      mimeType: 'image/png',
      tamanoBytes: VALID_PNG.byteLength,
      blobData: new Blob([VALID_PNG], { type: 'image/png' }),
      urlRemota: `/api/media/archivos/${mediaId}/contenido`,
      estadoArchivo: 'subido',
      intentosSubida: 0,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    });

    // Intento 1: fallo 503 -> no registra pesaje
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Python ocupado' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const failed = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId,
      idSolicitud: requestId
    });
    expect(failed.ok).toBe(false);
    expect(await db.weighings.count()).toBe(0);

    // Intento 2: reintento con el mismo idSolicitud -> éxito
    const successDto = {
      idPesaje: pesajeId,
      idSolicitud: requestId,
      idRancho: RANCH_ID,
      idAnimal: ANIMAL_ID,
      idArchivoMultimedia: mediaId,
      pesoEstimadoKg: 512.4,
      unidadPeso: 'kg',
      confianzaModelo: 0.9,
      versionModelo: 'boviscale-v1.3.0',
      observaciones: null,
      origenPesaje: 'boviscale_ia',
      fuenteBascula: 'BoviScale IA (boviscale-v1.3.0)',
      responsable: 'Carlos',
      fechaPesaje: now,
      creadoEn: now,
      versionRegistro: 1,
      duplicadoIgnorado: false,
      tiempoProcesamientoMs: 900
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(successDto), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const retryOk = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId,
      idSolicitud: requestId
    });
    expect(retryOk.ok).toBe(true);
    expect(await db.weighings.count()).toBe(1);

    // Intento 3: respuesta duplicada del servidor (duplicadoIgnorado=true) -> sigue existiendo exactamente 1 pesaje
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ...successDto, duplicadoIgnorado: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const dupRes = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_ID,
      existingMediaId: mediaId,
      idSolicitud: requestId
    });
    expect(dupRes.ok).toBe(true);
    expect(await db.weighings.count()).toBe(1);

    // Animal de otro rancho -> 403 Forbidden sin crear pesaje y processPendingQueue respeta ranchIds
    await db.cattle.put({
      id: ANIMAL_B_ID,
      remoteId: ANIMAL_B_ID,
      ranchId: RANCH_B_ID,
      arete: 'MX-EXT-99',
      areteSiniiga: 'MX-EXT-99',
      raza: 'Angus',
      sexo: 'Macho',
      gender: 'Macho',
      fechaIngreso: '2026-01-10',
      procedencia: 'Propio',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });
    const mediaBId = crypto.randomUUID();
    await db.media.put({
      id: mediaBId,
      remoteId: mediaBId,
      ranchId: RANCH_B_ID,
      cattleId: ANIMAL_B_ID,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_B_ID,
      tipo: 'BoviScaleVision',
      nombreArchivo: 'ajeno.png',
      mimeType: 'image/png',
      tamanoBytes: VALID_PNG.byteLength,
      blobData: new Blob([VALID_PNG], { type: 'image/png' }),
      urlRemota: `/api/media/archivos/${mediaBId}/contenido`,
      estadoArchivo: 'subido',
      intentosSubida: 0,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'No tienes membresía activa en el rancho.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const forbidden = await BoviScaleAnalysisService.requestWeightEstimation({
      cattleId: ANIMAL_B_ID,
      existingMediaId: mediaBId
    });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.httpStatus).toBe(403);
    expect(await db.weighings.where('cattleId').equals(ANIMAL_B_ID).count()).toBe(0);
  });
});
