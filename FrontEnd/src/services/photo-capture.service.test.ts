import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/database/db';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { PermissionsManagerService } from './permissions/permissions-manager.service';
import {
  PhotoCaptureService,
  captureHighestQualityPhoto,
  formatBytesHuman,
  validatePhotoBlob
} from './photo-capture.service';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const ANIMAL_ID = '22222222-2222-4222-8222-222222222222';

async function seedAnimal() {
  const now = new Date().toISOString();
  await db.cattle.put({
    id: ANIMAL_ID,
    remoteId: ANIMAL_ID,
    ranchId: RANCH_ID,
    arete: 'MX-PHO-101',
    areteSiniiga: 'MX-PHO-101',
    raza: 'Brahman',
    sexo: 'Hembra',
    gender: 'Hembra',
    fechaNacimiento: '2022-05-01',
    fechaIngreso: '2022-06-01',
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

describe('PhotoCaptureService — Validaciones, Blob en IndexedDB y cola pendiente', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    if (!db.isOpen()) await db.open();
    await db.media.clear();
    await db.cattle.clear();
    await db.outbox.clear();
    await seedAnimal();
  });

  it('valida formato (JPEG/PNG/WebP) y tamaño (> 0 B y <= 20 MB)', () => {
    const emptyBlob = new Blob([], { type: 'image/jpeg' });
    expect(validatePhotoBlob(emptyBlob).valid).toBe(false);

    const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    expect(validatePhotoBlob(pdfBlob).valid).toBe(false);
    expect(validatePhotoBlob(pdfBlob).error).toMatch(/JPEG, PNG o WebP/i);

    const gifBlob = new Blob(['GIF89a'], { type: 'image/gif' });
    expect(validatePhotoBlob(gifBlob).valid).toBe(false);

    // Simular archivo > 20 MB sin asignar 21 MB reales en RAM
    const oversized = { size: 21 * 1024 * 1024, type: 'image/jpeg' } as Blob;
    expect(validatePhotoBlob(oversized).valid).toBe(false);
    expect(validatePhotoBlob(oversized).error).toMatch(/20 MB/i);

    const validJpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], {
      type: 'image/jpeg'
    });
    expect(validatePhotoBlob(validJpeg).valid).toBe(true);

    const validWebp = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], {
      type: 'image/webp'
    });
    expect(validatePhotoBlob(validWebp).valid).toBe(true);

    expect(formatBytesHuman(2048)).toBe('2.0 KB');
  });

  it('captura a máxima resolución del sensor con ImageCapture.takePhoto() y cae a fotograma nativo 4K sin recorte si no está disponible', async () => {
    const nativePhotoBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22])], {
      type: 'image/jpeg'
    });
    const takePhotoSpy = vi.fn().mockResolvedValue(nativePhotoBlob);
    const getPhotoCapsSpy = vi.fn().mockResolvedValue({
      imageWidth: { min: 640, max: 4032 },
      imageHeight: { min: 480, max: 3024 }
    });

    class MockImageCapture {
      getPhotoCapabilities = getPhotoCapsSpy;
      takePhoto = takePhotoSpy;
    }

    const fakeTrack = { kind: 'video' } as MediaStreamTrack;
    const fakeStream = {
      getVideoTracks: () => [fakeTrack]
    } as unknown as MediaStream;

    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 3840, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 2160, configurable: true });
    const canvas = document.createElement('canvas');

    const prevImageCapture = (window as unknown as { ImageCapture?: unknown }).ImageCapture;
    (window as unknown as { ImageCapture?: unknown }).ImageCapture = MockImageCapture;

    try {
      const nativeResult = await captureHighestQualityPhoto(fakeStream, video, canvas);
      expect(nativeResult.captureMode).toBe('native-sensor');
      expect(nativeResult.blob).toBe(nativePhotoBlob);
      expect(nativeResult.width).toBe(4032);
      expect(nativeResult.height).toBe(3024);
      expect(takePhotoSpy).toHaveBeenCalledWith({ imageWidth: 4032, imageHeight: 3024 });
    } finally {
      if (prevImageCapture === undefined) {
        delete (window as unknown as { ImageCapture?: unknown }).ImageCapture;
      } else {
        (window as unknown as { ImageCapture?: unknown }).ImageCapture = prevImageCapture;
      }
    }

    // Fallback cuando ImageCapture no existe: conserva 3840x2160 completos y calidad 0.96
    const drawImageSpy = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      drawImage: drawImageSpy
    } as unknown as CanvasRenderingContext2D);

    let capturedQuality: number | undefined;
    vi.spyOn(canvas, 'toBlob').mockImplementation((cb, _type, quality) => {
      capturedQuality = quality;
      cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }));
    });

    const fallbackResult = await captureHighestQualityPhoto(fakeStream, video, canvas);
    expect(fallbackResult.captureMode).toBe('video-frame');
    expect(fallbackResult.width).toBe(3840);
    expect(fallbackResult.height).toBe(2160);
    expect(capturedQuality).toBe(0.96);
    expect(drawImageSpy).toHaveBeenCalledWith(video, 0, 0, 3840, 2160);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('requestCameraStream ajusta automáticamente el track de video a las capacidades máximas del sensor', async () => {
    const applyConstraintsSpy = vi.fn().mockResolvedValue(undefined);
    const mockTrack = {
      getCapabilities: () => ({
        width: { min: 640, max: 3840 },
        height: { min: 480, max: 2160 },
        focusMode: ['manual', 'continuous']
      }),
      getSettings: () => ({ width: 1280, height: 720 }),
      applyConstraints: applyConstraintsSpy
    };
    const mockStream = {
      getVideoTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream)
      }
    });

    const res = await PermissionsManagerService.requestCameraStream(true);
    expect(res.state).toBe('granted');
    expect(res.stream).toBe(mockStream);
    expect(applyConstraintsSpy).toHaveBeenCalledWith({
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      focusMode: 'continuous'
    });
  });

  it('guarda fotografía offline como Blob (no Base64), encola en outbox, sobrevive cierre/reapertura y permite eliminar', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const photoBlob = new Blob([bytes], { type: 'image/jpeg' });

    const saved = await PhotoCaptureService.savePhoto({
      blob: photoBlob,
      cattleId: ANIMAL_ID,
      tipo: 'BoviScaleVision',
      nombreArchivo: 'perfil_lateral.jpg'
    });

    expect(saved.synced).toBe(false);
    expect(saved.photo.cattleId).toBe(ANIMAL_ID);
    expect(saved.photo.estadoArchivo).toBe('pendiente_subida');
    expect(saved.photo.syncStatus).toBe('pending');
    expect(saved.photo.idOperacionSubida).toBeTruthy();

    // Confirmar que la captura se entrega como Blob binario (nunca cadena Base64)
    expect(saved.photo.blobData).toBeInstanceOf(Blob);
    expect(typeof saved.photo.blobData).not.toBe('string');

    // Confirmar metadatos y persistencia real en IndexedDB (nunca Base64)
    const rawInDb = await db.media.get(saved.photo.id);
    expect(rawInDb).toBeDefined();
    expect(rawInDb?.blobData).toBeDefined();
    expect(typeof rawInDb?.blobData).not.toBe('string');
    expect(rawInDb?.mimeType).toBe('image/jpeg');
    expect(rawInDb?.tamanoBytes).toBe(bytes.byteLength);

    // Confirmar operación en outbox lista para sincronización posterior
    const outboxOps = await OutboxRepository.getByEntity('media', saved.photo.id);
    expect(outboxOps).toHaveLength(1);
    expect(outboxOps[0].tipoOperacion).toBe('CREATE');
    expect(outboxOps[0].estado).toBe('pendiente');
    expect(outboxOps[0].idRancho).toBe(RANCH_ID);

    // Simular cierre y reapertura de la aplicación
    db.close();
    await db.open();

    const reloaded = await PhotoCaptureService.listPhotos({ cattleId: ANIMAL_ID });
    expect(reloaded.photos).toHaveLength(1);
    expect(reloaded.photos[0].id).toBe(saved.photo.id);
    expect(reloaded.photos[0].blobData).toBeDefined();
    expect(typeof reloaded.photos[0].blobData).not.toBe('string');
    expect(reloaded.storage.totalPhotos).toBe(1);
    expect(reloaded.storage.pendingUploads).toBe(1);

    // Eliminar (baja lógica)
    await PhotoCaptureService.deletePhoto(saved.photo.id);
    const afterDelete = await PhotoCaptureService.listPhotos({ cattleId: ANIMAL_ID });
    expect(afterDelete.photos).toHaveLength(0);
  });

  it('sincroniza la imagen vía POST /api/media/archivos cuando hay red y sesión, guardando URL remota y confirmando el outbox', async () => {
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-media-sync');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/media/archivos') && init?.method === 'POST') {
        const body = init.body as FormData;
        const idArchivo = String(body.get('idArchivo') || crypto.randomUUID());
        return new Response(
          JSON.stringify({
            idArchivo,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            entidadRelacionada: 'cattle',
            idEntidadRelacionada: ANIMAL_ID,
            tipo: 'FotoPerfil',
            nombreArchivo: 'perfil.jpg',
            mimeType: 'image/jpeg',
            tamanoBytes: 512,
            checksumSha256: null,
            rutaArchivo: `public/imagenes/perfil-ganado/${ANIMAL_ID}/perfil_1.jpg`,
            urlPublica: `/api/media/public/imagenes/perfil-ganado/${ANIMAL_ID}/perfil_1.jpg`,
            fechaCaptura: new Date().toISOString(),
            creadoEn: new Date().toISOString(),
            versionRegistro: 1,
            eliminadoEn: null
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    const saved = await PhotoCaptureService.savePhoto({
      blob,
      cattleId: ANIMAL_ID,
      tipo: 'FotoPerfil'
    });

    expect(saved.synced).toBe(true);
    expect(saved.photo.estadoArchivo).toBe('subido');
    expect(saved.photo.syncStatus).toBe('synced');
    expect(saved.photo.urlRemota).toContain('/api/media/public/imagenes/perfil-ganado/');
    expect(fetchSpy).toHaveBeenCalled();

    const ops = await OutboxRepository.getByEntity('media', saved.photo.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].estado).toBe('confirmado');

    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });
});
