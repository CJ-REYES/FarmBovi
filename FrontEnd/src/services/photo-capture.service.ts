import { StorageManager } from '../lib/database/db';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { MediaRepository } from '../lib/database/repositories/media.repository';
import type { LocalMedia } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import {
  MEDIA_BACKEND_DEPENDENCY,
  PHOTO_CAPTURE_LIMITS,
  type AnimalPhotoType,
  type PhotoStorageSummary,
  type StoredAnimalPhoto
} from '../types/media';
import { CattleService } from './cattle.service';
import { isValidGuid } from './cattle.validation';

export interface PhotoValidationResult {
  valid: boolean;
  error?: string;
}

export interface SaveAnimalPhotoInput {
  blob: Blob;
  cattleId: string;
  tipo: AnimalPhotoType;
  nombreArchivo?: string;
}

export interface SaveAnimalPhotoResult {
  photo: StoredAnimalPhoto;
  synced: false;
  syncMessage: string;
}

export interface LoadPhotosResult {
  photos: StoredAnimalPhoto[];
  animals: Cattle[];
  storage: PhotoStorageSummary;
  backendNotice: string;
}

export function formatBytesHuman(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function validatePhotoBlob(fileOrBlob: Blob | null | undefined): PhotoValidationResult {
  if (!fileOrBlob) {
    return { valid: false, error: 'Debes capturar o seleccionar una fotografía.' };
  }

  if (fileOrBlob.size <= 0) {
    return { valid: false, error: 'El archivo seleccionado está vacío (0 bytes).' };
  }

  if (fileOrBlob.size > PHOTO_CAPTURE_LIMITS.maxSizeBytes) {
    const maxMb = Math.round(PHOTO_CAPTURE_LIMITS.maxSizeBytes / (1024 * 1024));
    return {
      valid: false,
      error: `La fotografía supera el límite máximo permitido de ${maxMb} MB (${formatBytesHuman(fileOrBlob.size)}).`
    };
  }

  const normalizedMime = (fileOrBlob.type || '').trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!PHOTO_CAPTURE_LIMITS.allowedMimeTypes.includes(normalizedMime)) {
    return {
      valid: false,
      error: 'Formato de imagen no compatible. Utiliza únicamente archivos JPEG, PNG o WebP.'
    };
  }

  return { valid: true };
}

export interface CapturedPhotoResult {
  blob: Blob;
  width?: number;
  height?: number;
  captureMode: 'native-sensor' | 'video-frame';
}

interface BrowserPhotoCapabilities {
  imageWidth?: { min: number; max: number; step?: number };
  imageHeight?: { min: number; max: number; step?: number };
}

interface BrowserImageCapture {
  getPhotoCapabilities?: () => Promise<BrowserPhotoCapabilities>;
  takePhoto: (photoSettings?: { imageWidth?: number; imageHeight?: number }) => Promise<Blob>;
}

type BrowserImageCaptureConstructor = new (track: MediaStreamTrack) => BrowserImageCapture;

async function readImageBlobDimensions(
  blob: Blob
): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== 'function') {
    return undefined;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height };
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
}

/**
 * Captura un fotograma del `<video>` activo en su resolución nativa completa
 * (sin reescalado artificial ni Base64) y libera el framebuffer inmediatamente.
 */
export async function captureVideoFrameAsBlob(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Promise<{ blob: Blob; width: number; height: number }> {
  const targetWidth = video.videoWidth || 1280;
  const targetHeight = video.videoHeight || 720;

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error('No se pudo inicializar el contexto gráfico para capturar la fotografía.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('No fue posible generar la imagen binaria desde la cámara.'));
        }
      },
      'image/jpeg',
      PHOTO_CAPTURE_LIMITS.jpegQuality
    );
  });

  // Liberar el framebuffer del canvas inmediatamente para no retener memoria
  canvas.width = 0;
  canvas.height = 0;

  return { blob, width: targetWidth, height: targetHeight };
}

/**
 * Captura la fotografía con la máxima calidad que permita el hardware de la cámara:
 * 1. Usa `ImageCapture.takePhoto()` con las máximas dimensiones del sensor (`getPhotoCapabilities`)
 *    cuando el navegador/dispositivo lo soporta (resolución fotográfica nativa completa).
 * 2. Si el navegador no soporta `ImageCapture` (p. ej. Safari/iOS/Firefox) o el controlador rechaza
 *    la foto nativa, captura el fotograma completo del `<video>` en su resolución nativa sin recorte.
 */
export async function captureHighestQualityPhoto(
  stream: MediaStream | null,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Promise<CapturedPhotoResult> {
  const videoTrack =
    stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks()[0] : undefined;

  if (videoTrack && typeof window !== 'undefined' && 'ImageCapture' in window) {
    const ImageCaptureCtor = (
      window as unknown as { ImageCapture?: BrowserImageCaptureConstructor }
    ).ImageCapture;

    if (typeof ImageCaptureCtor === 'function') {
      try {
        const imageCapture = new ImageCaptureCtor(videoTrack);
        let photoSettings: { imageWidth?: number; imageHeight?: number } | undefined;

        if (typeof imageCapture.getPhotoCapabilities === 'function') {
          try {
            const caps = await imageCapture.getPhotoCapabilities();
            const maxW = caps.imageWidth?.max;
            const maxH = caps.imageHeight?.max;
            if (typeof maxW === 'number' && typeof maxH === 'number' && maxW > 0 && maxH > 0) {
              photoSettings = { imageWidth: maxW, imageHeight: maxH };
            }
          } catch {
            // Continuar con takePhoto() usando resolución fotográfica nativa por defecto
          }
        }

        let rawBlob: Blob | null = null;
        try {
          rawBlob = photoSettings
            ? await imageCapture.takePhoto(photoSettings)
            : await imageCapture.takePhoto();
        } catch {
          if (photoSettings) {
            rawBlob = await imageCapture.takePhoto();
          }
        }

        if (rawBlob && rawBlob.size > 0) {
          const normalizedBlob = rawBlob.type
            ? rawBlob
            : new Blob([rawBlob], { type: 'image/jpeg' });
          if (validatePhotoBlob(normalizedBlob).valid) {
            const dims = await readImageBlobDimensions(normalizedBlob);
            return {
              blob: normalizedBlob,
              width: dims?.width ?? photoSettings?.imageWidth,
              height: dims?.height ?? photoSettings?.imageHeight,
              captureMode: 'native-sensor'
            };
          }
        }
      } catch {
        // Fallback transparente a captura de fotograma en máxima resolución del stream
      }
    }
  }

  const frame = await captureVideoFrameAsBlob(video, canvas);
  return {
    blob: frame.blob,
    width: frame.width,
    height: frame.height,
    captureMode: 'video-frame'
  };
}

export const PhotoCaptureService = {
  toStoredPhoto(local: LocalMedia): StoredAnimalPhoto {
    return {
      id: local.id,
      cattleId: local.cattleId || local.idEntidadRelacionada || '',
      ranchId: local.ranchId || '',
      tipo: local.tipo,
      nombreArchivo: local.nombreArchivo,
      mimeType: local.mimeType,
      tamanoBytes: local.tamanoBytes,
      checksumSha256: local.checksumSha256 ?? null,
      blobData: local.blobData,
      urlRemota: local.urlRemota ?? null,
      idOperacionSubida: local.idOperacionSubida ?? null,
      estadoArchivo: local.estadoArchivo,
      intentosSubida: local.intentosSubida,
      ultimoErrorSubida: local.ultimoErrorSubida ?? null,
      fechaCaptura: local.fechaCaptura,
      syncStatus: local.syncStatus,
      deletedAt: local.deletedAt ?? null
    };
  },

  async loadAnimals(preferRemote = true): Promise<Cattle[]> {
    if (preferRemote) {
      try {
        const res = await CattleService.getAll();
        return res.data;
      } catch {
        // Fallback determinista al caché local offline
      }
    }
    const local = await CattleRepository.getAll();
    return local.map((item) => CattleService.toCattle(item));
  },

  async getStorageSummary(allActiveMedia?: LocalMedia[]): Promise<PhotoStorageSummary> {
    const mediaList = allActiveMedia ?? (await MediaRepository.getAllActive());
    const [estimate, isPersisted] = await Promise.all([
      StorageManager.getStorageEstimate(),
      StorageManager.checkIsPersisted()
    ]);

    let totalBytes = 0;
    let pendingUploads = 0;
    for (const item of mediaList) {
      totalBytes += item.tamanoBytes || item.blobData?.size || 0;
      if (item.estadoArchivo === 'pendiente_subida' || item.estadoArchivo === 'subiendo') {
        pendingUploads++;
      }
    }

    return {
      totalPhotos: mediaList.length,
      pendingUploads,
      totalBytes,
      browserUsageBytes: estimate.usage,
      browserQuotaBytes: estimate.quota,
      browserUsagePercentage: estimate.percentage,
      isPersisted
    };
  },

  async listPhotos(options?: { cattleId?: string }): Promise<LoadPhotosResult> {
    const [allActive, filteredActive, animals] = await Promise.all([
      MediaRepository.getAllActive(),
      options?.cattleId
        ? MediaRepository.getAllActive({ cattleId: options.cattleId })
        : MediaRepository.getAllActive(),
      this.loadAnimals(true)
    ]);

    const storage = await this.getStorageSummary(allActive);

    return {
      photos: filteredActive.map((m) => this.toStoredPhoto(m)),
      animals,
      storage,
      backendNotice: MEDIA_BACKEND_DEPENDENCY.summaryMessage
    };
  },

  async savePhoto(input: SaveAnimalPhotoInput): Promise<SaveAnimalPhotoResult> {
    const cattleId = input.cattleId.trim();
    if (!cattleId || !isValidGuid(cattleId)) {
      throw new Error('Debes seleccionar un animal válido para asociar la fotografía.');
    }

    const validation = validatePhotoBlob(input.blob);
    if (!validation.valid) {
      throw new Error(validation.error || 'Fotografía inválida.');
    }

    const animals = await this.loadAnimals(false);
    const animal = animals.find((a) => a.id === cattleId && !a.deletedAt);
    if (!animal) {
      throw new Error('El animal seleccionado no existe o está desactivado en el dispositivo.');
    }

    const extension = (input.blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const safeArete = (animal.arete || animal.id.slice(0, 8)).replace(/[^A-Za-z0-9_-]/g, '_');
    const defaultName = `${input.tipo.toLowerCase()}_${safeArete}_${Date.now()}.${extension}`;

    const { media } = await MediaRepository.saveCapture({
      fileOrBlob: input.blob,
      tipo: input.tipo,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: animal.id,
      cattleId: animal.id,
      ranchId: animal.idRancho,
      nombreArchivo: input.nombreArchivo || defaultName,
      crearTrabajoPesaje: false
    });

    const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
    return {
      photo: this.toStoredPhoto(media),
      synced: false,
      syncMessage: isOnline
        ? `Fotografía guardada localmente como Blob (${formatBytesHuman(media.tamanoBytes)}) asociada a ${animal.arete}. Quedó registrada como pendiente de sincronización cuando el Backend habilite el endpoint multimedia.`
        : `Sin conexión: fotografía guardada en IndexedDB (${formatBytesHuman(media.tamanoBytes)}) asociada a ${animal.arete} y encolada para sincronización posterior.`
    };
  },

  async deletePhoto(mediaId: string): Promise<{ synced: false; syncMessage: string }> {
    await MediaRepository.softDeleteMedia(mediaId);
    return {
      synced: false,
      syncMessage: 'Fotografía eliminada del historial local y marcada para sincronización.'
    };
  }
};
