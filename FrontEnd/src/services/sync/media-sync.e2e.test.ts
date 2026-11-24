import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BlobImage from '../../components/shared/BlobImage';
import { PERSISTED_SESSION_META_KEY } from '../../lib/api';
import { db } from '../../lib/database/db';
import { MediaRepository } from '../../lib/database/repositories/media.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import type { LocalCattle, LocalMedia, LocalRanch } from '../../lib/database/schema';
import type { BackendArchivoMultimediaDto } from '../../types/media';
import { CattleService } from '../cattle.service';
import { ConnectivityService } from '../connectivity.service';
import { PhotoCaptureService } from '../photo-capture.service';
import { MediaSyncEngine } from './media-sync.engine';
import { SyncEngine } from './sync-engine';
import { SyncHttpClient } from './sync-http.client';
import { SyncCrossTabLock } from './sync-lock';
import { PULL_ENTITY_ORDER, SyncPullEngine } from './sync-pull.engine';
import { SyncScheduler } from './sync-scheduler';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const ANIMAL_A = '33333333-3333-4333-8333-333333333333';
const ANIMAL_B = '44444444-4444-4444-8444-444444444444';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PNG_BYTES_1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const PNG_BYTES_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x03, 0x04]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

function seedSession(params: { userId: string; ranchIds: string[]; token?: string }): void {
  const token = params.token ?? `jwt-${params.userId.slice(0, 6)}`;
  const sessionObj = {
    token,
    authMode: 'bearer',
    expiraEn: new Date(Date.now() + 3600_000).toISOString(),
    idUsuario: params.userId,
    nombre: `Usuario ${params.userId.slice(0, 4)}`,
    correo: `${params.userId.slice(0, 4)}@farmbovi.test`,
    ranchos: params.ranchIds.map((id, i) => ({
      idRancho: id,
      nombre: `Rancho ${i + 1}`,
      rol: 'Administrador'
    })),
    fotoPerfilUrl: null,
    configuracion: {
      unidadPeso: 'kg',
      diasAvisoAlertas: 7,
      sincronizacionAutomatica: true,
      formatoFecha: 'dd/MM/yyyy',
      ranchoPredeterminadoId: params.ranchIds[0] ?? null
    }
  };
  window.sessionStorage.setItem('farmbovi_access_token', token);
  window.sessionStorage.setItem('farmbovi_session_user', JSON.stringify(sessionObj));
  window.localStorage.setItem(PERSISTED_SESSION_META_KEY, JSON.stringify(sessionObj));
}

async function seedRanchAndAnimal(
  ranchId: string,
  animalId: string,
  arete: string,
  syncStatus: 'synced' | 'pending' = 'synced'
): Promise<void> {
  const now = new Date().toISOString();
  const ranch: LocalRanch = {
    id: ranchId,
    remoteId: ranchId,
    ranchId,
    nombre: `Rancho ${arete}`,
    ubicacionGeneral: 'Norte',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  };
  const animal: LocalCattle = {
    id: animalId,
    remoteId: syncStatus === 'synced' ? animalId : undefined,
    ranchId,
    arete,
    areteSiniiga: arete,
    raza: 'Holstein',
    sexo: 'Hembra',
    gender: 'Hembra',
    fechaIngreso: '2026-01-01',
    procedencia: 'Propio',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus,
    serverVersion: syncStatus === 'synced' ? 1 : null,
    deletedAt: null
  };
  await db.ranches.put(ranch);
  await db.cattle.put(animal);
}

function makeServerDto(overrides: Partial<BackendArchivoMultimediaDto>): BackendArchivoMultimediaDto {
  const idArchivo = overrides.idArchivo ?? crypto.randomUUID();
  const idRancho = overrides.idRancho ?? RANCH_A;
  const idAnimal = overrides.idAnimal ?? ANIMAL_A;
  const now = new Date().toISOString();
  return {
    idArchivo,
    idRancho,
    idAnimal,
    entidadRelacionada: 'cattle',
    idEntidadRelacionada: idAnimal,
    tipo: 'FotoPerfil',
    nombreArchivo: 'vaca.png',
    mimeType: 'image/png',
    extension: '.png',
    tamanoBytes: PNG_BYTES_1.byteLength,
    checksumSha256: null,
    proveedorAlmacenamiento: 'LocalFileSystem',
    rutaArchivo: `${idRancho.replace(/-/g, '')}/perfil-ganado/${idAnimal?.replace(/-/g, '')}/${idArchivo.replace(/-/g, '')}_nonce.png`,
    estado: 'Disponible',
    urlContenido: `/api/media/archivos/${idArchivo}/contenido`,
    urlPublica: `/api/media/archivos/${idArchivo}/contenido`,
    fechaCaptura: now,
    fechaCarga: now,
    creadoEn: now,
    versionRegistro: 1,
    eliminadoEn: null,
    ...overrides
  };
}

function mockCompletedPull(): void {
  vi.spyOn(SyncPullEngine, 'pullAllEntities').mockImplementation(async (opts) =>
    PULL_ENTITY_ORDER.map((entidad) => ({
      entidad,
      ranchId: opts?.ranchId ?? RANCH_A,
      status: 'completed' as const,
      pagesProcessed: 1,
      appliedCount: 0,
      deletedCount: 0,
      conflictCount: 0,
      skippedPendingCount: 0,
      previousCursor: null,
      currentCursor: 'cursor-1'
    }))
  );
}

describe('Flujo completo de sincronización de fotografías integrado en SyncEngine', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    SyncScheduler.stop();
    SyncCrossTabLock.forceReleaseLocalLease();
    window.sessionStorage.clear();
    window.localStorage.clear();
    setOnline(true);

    if (!db.isOpen()) await db.open();
    await Promise.all([
      db.ranches.clear(),
      db.cattle.clear(),
      db.media.clear(),
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
  });

  afterEach(() => {
    SyncScheduler.stop();
    SyncCrossTabLock.forceReleaseLocalLease();
    vi.restoreAllMocks();
    setOnline(true);
  });

  it('1. Captura offline + recuperación de conexión integrada en SyncEngine: sube animal primero, luego fotografía y conserva Blob local', async () => {
    seedSession({ userId: USER_A, ranchIds: [RANCH_A] });
    await seedRanchAndAnimal(RANCH_A, ANIMAL_A, 'MX-001');
    // Crear segundo animal completamente offline para probar orden Push -> Media
    setOnline(false);

    const createdAnimal = await CattleService.create({
      idRancho: RANCH_A,
      idLote: null,
      arete: 'MX-OFF-900',
      raza: 'Angus',
      sexo: 'Hembra',
      fechaNacimiento: null,
      fechaIngreso: '2026-11-24',
      procedencia: 'Propio',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null
    });

    const blob = new Blob([PNG_BYTES_1], { type: 'image/png' });
    const saved = await PhotoCaptureService.savePhoto({
      blob,
      cattleId: createdAnimal.animal.id,
      tipo: 'FotoPerfil',
      nombreArchivo: 'offline_angus.png'
    });

    expect(saved.synced).toBe(false);
    expect(saved.photo.estadoArchivo).toBe('pendiente_subida');
    expect(saved.photo.cattleId).toBe(createdAnimal.animal.id);
    expect(saved.photo.ranchId).toBe(RANCH_A);
    expect(saved.photo.blobData).toBeInstanceOf(Blob);

    const callOrder: string[] = [];
    vi.spyOn(SyncHttpClient, 'sendOperation').mockImplementation(async (dto) => {
      callOrder.push(`push:${dto.entidad}`);
      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        remoteId: dto.idEntidad,
        versionServidor: 1,
        resultado: 'ACCEPTED'
      };
    });
    mockCompletedPull();

    const uploadedServerItems: BackendArchivoMultimediaDto[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/media/archivos') && init?.method === 'POST') {
        callOrder.push('media:upload');
        const fd = init.body as FormData;
        const dto = makeServerDto({
          idArchivo: String(fd.get('idArchivo')),
          idRancho: String(fd.get('idRancho')),
          idAnimal: String(fd.get('idAnimal')),
          nombreArchivo: String(fd.get('nombreArchivo')),
          tamanoBytes: PNG_BYTES_1.byteLength
        });
        uploadedServerItems.push(dto);
        return new Response(JSON.stringify(dto), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/media/archivos') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify(uploadedServerItems), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    // Recuperar conexión -> ejecutar ciclo único del SyncEngine existente
    setOnline(true);
    const cycle = await SyncEngine.sync();

    expect(cycle).not.toBeNull();
    expect(cycle?.allTasksCompleted).toBe(true);
    expect(cycle?.media?.uploadedCount).toBe(1);
    expect(cycle?.hasDataChanges).toBe(true);

    // El animal se envió en Push antes de subir la fotografía
    expect(callOrder.indexOf('push:cattle')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('media:upload')).toBeGreaterThan(callOrder.indexOf('push:cattle'));

    // Metadatos remotos asociados, outbox confirmado y Blob local intacto
    const syncedMedia = (await db.media.get(saved.photo.id))!;
    expect(syncedMedia.estadoArchivo).toBe('subido');
    expect(syncedMedia.syncStatus).toBe('synced');
    expect(syncedMedia.remoteId).toBe(saved.photo.id);
    expect(syncedMedia.urlRemota).toBe(`/api/media/archivos/${saved.photo.id}/contenido`);
    expect(syncedMedia.proveedorAlmacenamiento).toBe('LocalFileSystem');
    expect(syncedMedia.estadoRemoto).toBe('Disponible');
    expect(syncedMedia.fechaCarga).toBeTruthy();
    expect(syncedMedia.blobData).toBeDefined();

    const ops = await OutboxRepository.getByEntity('media', saved.photo.id);
    expect(ops[0].estado).toBe('confirmado');
  });

  it('2. Subida interrumpida (cierre abrupto y caída de red en vuelo): recupera tras reinicio sin perder el Blob ni duplicar', async () => {
    seedSession({ userId: USER_A, ranchIds: [RANCH_A] });
    await seedRanchAndAnimal(RANCH_A, ANIMAL_A, 'MX-INT-1');

    // Guardar offline y simular cierre abrupto dejando estado en 'subiendo' y outbox 'en_proceso'
    setOnline(false);
    const saved = await PhotoCaptureService.savePhoto({
      blob: new Blob([PNG_BYTES_1], { type: 'image/png' }),
      cattleId: ANIMAL_A,
      tipo: 'BoviScaleVision'
    });
    const op = (await OutboxRepository.getByEntity('media', saved.photo.id))[0];
    await db.media.update(saved.photo.id, { estadoArchivo: 'subiendo' });
    await db.outbox.update(op.idOperacion, { estado: 'en_proceso' });

    // Simular cierre y reapertura de la aplicación (IndexedDB close -> open)
    db.close();
    await db.open();

    // Intento 1 tras reabrir: se cae la red a mitad del POST
    setOnline(true);
    mockCompletedPull();
    const sentMediaIds: string[] = [];
    let attempt = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/media/archivos') && init?.method === 'POST') {
        attempt++;
        const fd = init.body as FormData;
        const idArchivo = String(fd.get('idArchivo'));
        sentMediaIds.push(idArchivo);

        if (attempt === 1) {
          setOnline(false);
          throw new TypeError('Failed to fetch');
        }

        return new Response(
          JSON.stringify(
            makeServerDto({
              idArchivo,
              idRancho: RANCH_A,
              idAnimal: ANIMAL_A,
              tipo: 'BoviScaleVision'
            })
          ),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const droppedSummary = await MediaSyncEngine.syncPendingMedia();
    expect(droppedSummary.offlineInterrupted).toBe(true);
    expect(droppedSummary.uploadedCount).toBe(0);

    // Confirmar que tras caída de red: vuelve a 'pendiente_subida', NO pierde Blob y NO quema intentos
    const afterDrop = (await db.media.get(saved.photo.id))!;
    expect(afterDrop.estadoArchivo).toBe('pendiente_subida');
    expect(afterDrop.intentosSubida).toBe(0);
    expect(afterDrop.blobData).toBeDefined();

    // Intento 2: regresa la red -> sube el mismo idArchivo y confirma
    setOnline(true);
    const recoveredCycle = await SyncEngine.sync();
    expect(recoveredCycle?.media?.uploadedCount).toBe(1);
    expect(sentMediaIds).toEqual([saved.photo.id, saved.photo.id]);

    const afterRecovery = (await db.media.get(saved.photo.id))!;
    expect(afterRecovery.estadoArchivo).toBe('subido');
    expect(afterRecovery.syncStatus).toBe('synced');
    expect(afterRecovery.blobData).toBeDefined();
  });

  it('3. Reintentos con backoff, errores recuperables, archivos demasiado grandes y no bloqueo de otras fotografías', async () => {
    seedSession({ userId: USER_A, ranchIds: [RANCH_A] });
    await seedRanchAndAnimal(RANCH_A, ANIMAL_A, 'MX-RET-1');
    setOnline(false);

    // Foto 1: sufrirá un error 503 recuperable en el primer intento
    const photoTransient = await PhotoCaptureService.savePhoto({
      blob: new Blob([PNG_BYTES_1], { type: 'image/png' }),
      cattleId: ANIMAL_A,
      tipo: 'FotoPerfil',
      nombreArchivo: 'recuperable.png'
    });

    // Foto 2: fotografía válida en la misma cola que NO debe quedar bloqueada por Foto 1
    const photoHealthy = await PhotoCaptureService.savePhoto({
      blob: new Blob([PNG_BYTES_2], { type: 'image/png' }),
      cattleId: ANIMAL_A,
      tipo: 'BoviScaleVision',
      nombreArchivo: 'sana.png'
    });

    // Foto 3: archivo que supera 10 MB insertado en cola (p. ej. límite previo/413)
    const oversizedId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.media.put({
      id: oversizedId,
      ranchId: RANCH_A,
      cattleId: ANIMAL_A,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_A,
      tipo: 'FotoPerfil',
      nombreArchivo: 'gigante.jpg',
      mimeType: 'image/jpeg',
      tamanoBytes: 12 * 1024 * 1024,
      blobData: { size: 12 * 1024 * 1024, type: 'image/jpeg' } as Blob,
      estadoArchivo: 'pendiente_subida',
      intentosSubida: 0,
      ultimoErrorSubida: null,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      deletedAt: null
    });

    setOnline(true);
    let transientCalls = 0;
    let oversizedCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/media/archivos') && init?.method === 'POST') {
        const fd = init.body as FormData;
        const idArchivo = String(fd.get('idArchivo'));

        if (idArchivo === oversizedId) {
          oversizedCalls++;
          return new Response(JSON.stringify({ detail: 'Archivo demasiado grande' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (idArchivo === photoTransient.photo.id) {
          transientCalls++;
          if (transientCalls === 1) {
            return new Response(JSON.stringify({ detail: 'Servicio temporalmente saturado' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }

        return new Response(
          JSON.stringify(makeServerDto({ idArchivo, idRancho: RANCH_A, idAnimal: ANIMAL_A })),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    // Ciclo 1: Foto 1 falla (503 recuperable), Foto 2 SÍ sube sin bloquearse, Foto 3 se rechaza por tamaño (> 10 MB) sin transmitir
    const cycle1 = await MediaSyncEngine.syncPendingMedia({ skipPull: true });
    expect(cycle1.uploadedCount).toBe(1);
    expect(cycle1.errorCount).toBe(2);
    expect(oversizedCalls).toBe(0);

    const healthyInDb = (await db.media.get(photoHealthy.photo.id))!;
    expect(healthyInDb.estadoArchivo).toBe('subido');

    const transientInDb = (await db.media.get(photoTransient.photo.id))!;
    expect(transientInDb.estadoArchivo).toBe('error_subida');
    expect(transientInDb.errorSubidaPermanente).toBe(false);
    expect(transientInDb.intentosSubida).toBe(1);
    expect(transientInDb.proximoIntentoSubida).toBeTruthy();
    expect(transientInDb.ultimoErrorSubida).toMatch(/saturado/i);
    expect(transientInDb.blobData).toBeDefined(); // Blob local conservado

    const oversizedInDb = (await db.media.get(oversizedId))!;
    expect(oversizedInDb.estadoArchivo).toBe('error_subida');
    expect(oversizedInDb.errorSubidaPermanente).toBe(true);
    expect(oversizedInDb.ultimoErrorSubida).toMatch(/10 MB/i);
    expect(oversizedInDb.blobData).toBeDefined(); // Nunca borrar Blob sin confirmación

    // Ciclo 2 inmediato: respeta backoff de Foto 1 y NO reintenta Foto 3 (permanente)
    const cycle2 = await MediaSyncEngine.syncPendingMedia({ skipPull: true });
    expect(cycle2.skippedBackoffCount).toBe(1);
    expect(cycle2.uploadedCount).toBe(0);
    expect(transientCalls).toBe(1);

    // Reintento manual/recuperado de Foto 1 -> sube y confirma
    const retryRes = await PhotoCaptureService.retryPhotoUpload(photoTransient.photo.id);
    expect(retryRes.synced).toBe(true);
    expect(transientCalls).toBe(2);

    const recoveredTransient = (await db.media.get(photoTransient.photo.id))!;
    expect(recoveredTransient.estadoArchivo).toBe('subido');
    expect(recoveredTransient.ultimoErrorSubida).toBeNull();
  });

  it('4. Archivo duplicado: evita guardar y subir dos veces exactamente la misma fotografía para el mismo animal', async () => {
    seedSession({ userId: USER_A, ranchIds: [RANCH_A] });
    await seedRanchAndAnimal(RANCH_A, ANIMAL_A, 'MX-DUP-1');

    let uploadCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/media/archivos') && init?.method === 'POST') {
        uploadCalls++;
        const fd = init.body as FormData;
        return new Response(
          JSON.stringify(
            makeServerDto({
              idArchivo: String(fd.get('idArchivo')),
              idRancho: RANCH_A,
              idAnimal: ANIMAL_A
            })
          ),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const first = await PhotoCaptureService.savePhoto({
      blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }),
      cattleId: ANIMAL_A,
      tipo: 'FotoPerfil',
      nombreArchivo: 'misma_vaca.jpg'
    });
    expect(first.synced).toBe(true);
    expect(first.duplicated).toBeFalsy();
    expect(uploadCalls).toBe(1);

    // Capturar/seleccionar exactamente los mismos bytes otra vez para el mismo animal y tipo
    const second = await PhotoCaptureService.savePhoto({
      blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }),
      cattleId: ANIMAL_A,
      tipo: 'FotoPerfil',
      nombreArchivo: 'copia_misma_vaca.jpg'
    });
    expect(second.duplicated).toBe(true);
    expect(second.photo.id).toBe(first.photo.id);
    expect(uploadCalls).toBe(1); // No se subió una segunda vez

    const activePhotos = await MediaRepository.getByCattleId(ANIMAL_A);
    expect(activePhotos).toHaveLength(1);

    // Re-ejecutar syncPendingMedia tampoco vuelve a subir el archivo ya sincronizado
    const extraSync = await MediaSyncEngine.syncPendingMedia({ skipPull: true });
    expect(extraSync.uploadedCount).toBe(0);
    expect(uploadCalls).toBe(1);
  });

  it('5. Cambio de dispositivo: sincroniza solo metadatos sin descargar binarios innecesarios y visualiza bajo demanda con autorización', async () => {
    seedSession({ userId: USER_A, ranchIds: [RANCH_A], token: 'jwt-device-2' });
    await seedRanchAndAnimal(RANCH_A, ANIMAL_A, 'MX-DEV2');
    mockCompletedPull();

    const remoteId = crypto.randomUUID();
    const remoteDto = makeServerDto({
      idArchivo: remoteId,
      idRancho: RANCH_A,
      idAnimal: ANIMAL_A,
      nombreArchivo: 'foto_dispositivo_1.png'
    });

    const contentDownloadHeaders: Array<string | null> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(`/media/archivos/${remoteId}/contenido`)) {
        const headers = new Headers(init?.headers);
        contentDownloadHeaders.push(headers.get('Authorization'));
        return new Response(PNG_BYTES_1, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      }
      if (url.includes('/media/archivos')) {
        return new Response(JSON.stringify([remoteDto]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    // Dispositivo 2 inicia con IndexedDB sin fotos locales y sincroniza vía SyncEngine
    const cycle = await SyncEngine.sync();
    expect(cycle?.media?.pulledCount).toBe(1);

    // Regla: NO descargar binarios innecesarios durante la sincronización
    expect(contentDownloadHeaders).toHaveLength(0);

    const pulled = (await db.media.get(remoteId))!;
    expect(pulled).toBeDefined();
    expect(pulled.cattleId).toBe(ANIMAL_A);
    expect(pulled.estadoArchivo).toBe('subido');
    expect(pulled.blobData).toBeUndefined();
    expect(pulled.urlRemota).toBe(`/api/media/archivos/${remoteId}/contenido`);
    expect(pulled.proveedorAlmacenamiento).toBe('LocalFileSystem');

    // Al visualizar en UI con <BlobImage>, descarga bajo demanda adjuntando Authorization Bearer
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:farmbovi-device2-img');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const { container, unmount } = render(
      createElement(BlobImage, {
        blob: pulled.blobData,
        remoteUrl: pulled.urlRemota,
        alt: 'Foto sincronizada desde otro dispositivo'
      })
    );

    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('blob:farmbovi-device2-img');
      expect(img?.getAttribute('loading')).toBe('lazy');
    });

    expect(contentDownloadHeaders).toEqual(['Bearer jwt-device-2']);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(revokeSpy).toHaveBeenCalledWith('blob:farmbovi-device2-img');
  });

  it('6. Eliminación autorizada y aislamiento por rancho: propaga baja a otro dispositivo y bloquea acceso de rancho ajeno', async () => {
    seedSession({ userId: USER_A, ranchIds: [RANCH_A] });
    await seedRanchAndAnimal(RANCH_A, ANIMAL_A, 'MX-DEL-A');
    await seedRanchAndAnimal(RANCH_B, ANIMAL_B, 'MX-DEL-B');

    const mediaId = crypto.randomUUID();
    const now = new Date().toISOString();
    const syncedA: LocalMedia = {
      id: mediaId,
      remoteId: mediaId,
      ranchId: RANCH_A,
      cattleId: ANIMAL_A,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_A,
      tipo: 'FotoPerfil',
      nombreArchivo: 'a_eliminar.png',
      mimeType: 'image/png',
      tamanoBytes: PNG_BYTES_1.byteLength,
      blobData: new Blob([PNG_BYTES_1], { type: 'image/png' }),
      urlRemota: `/api/media/archivos/${mediaId}/contenido`,
      estadoArchivo: 'subido',
      intentosSubida: 0,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    };
    await db.media.put(syncedA);

    // También guardar una foto pendiente perteneciente a Rancho B (ajeno a Usuario A)
    const foreignMediaId = crypto.randomUUID();
    await db.media.put({
      ...syncedA,
      id: foreignMediaId,
      remoteId: undefined,
      ranchId: RANCH_B,
      cattleId: ANIMAL_B,
      idEntidadRelacionada: ANIMAL_B,
      urlRemota: null,
      estadoArchivo: 'pendiente_subida',
      syncStatus: 'pending'
    });

    const deletedRemoteIds: string[] = [];
    const uploadedRemoteIds: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes(`/media/archivos/${mediaId}`) && init?.method === 'DELETE') {
        deletedRemoteIds.push(mediaId);
        return new Response(null, { status: 204 });
      }
      if (url.includes('/media/archivos') && init?.method === 'POST') {
        const fd = init.body as FormData;
        uploadedRemoteIds.push(String(fd.get('idArchivo')));
        return new Response(JSON.stringify({ detail: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/media/archivos')) {
        // Simular que el servidor ahora reporta el registro como eliminado
        return new Response(
          JSON.stringify([
            makeServerDto({
              idArchivo: mediaId,
              idRancho: RANCH_A,
              idAnimal: ANIMAL_A,
              estado: 'Eliminado',
              eliminadoEn: now,
              versionRegistro: 2
            })
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    // Usuario A elimina su fotografía de Rancho A -> sincroniza DELETE y NO toca la foto de Rancho B
    const delRes = await PhotoCaptureService.deletePhoto(mediaId);
    expect(delRes.synced).toBe(true);
    expect(deletedRemoteIds).toEqual([mediaId]);
    expect(uploadedRemoteIds).toHaveLength(0);

    const afterDelete = (await db.media.get(mediaId))!;
    expect(afterDelete.deletedAt).toBeTruthy();
    expect(afterDelete.estadoRemoto).toBe('Eliminado');
    expect(afterDelete.blobData).toBeUndefined();

    // Foto de Rancho B sigue intacta en cola local (respeto estricto de permisos por rancho)
    const foreignAfter = (await db.media.get(foreignMediaId))!;
    expect(foreignAfter.estadoArchivo).toBe('pendiente_subida');
    expect(foreignAfter.ultimoErrorSubida ?? null).toBeNull();

    // Simular Dispositivo 2 que todavía tenía la foto en caché -> al hacer pullRemoteMedia se marca eliminada
    await db.media.put({
      ...syncedA,
      deletedAt: null,
      blobData: undefined,
      syncStatus: 'synced'
    });
    const reconciled = await MediaSyncEngine.pullRemoteMedia({ ranchId: RANCH_A });
    expect(reconciled).toBe(1);
    const device2After = (await db.media.get(mediaId))!;
    expect(device2After.deletedAt).toBeTruthy();
    expect(device2After.estadoRemoto).toBe('Eliminado');

    // Intento de eliminación no autorizada (servidor responde 403) -> NO confirma falsamente el outbox
    seedSession({ userId: USER_B, ranchIds: [RANCH_A] });
    const unauthorizedMediaId = crypto.randomUUID();
    await db.media.put({
      ...syncedA,
      id: unauthorizedMediaId,
      remoteId: unauthorizedMediaId,
      deletedAt: null
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'No tienes permisos sobre el rancho.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const forbiddenDel = await PhotoCaptureService.deletePhoto(unauthorizedMediaId);
    expect(forbiddenDel.synced).toBe(false);
    const delOps = await OutboxRepository.getByEntity('media', unauthorizedMediaId);
    expect(delOps.some((o) => o.tipoOperacion === 'DELETE' && o.estado === 'fallido')).toBe(true);
  });
});
