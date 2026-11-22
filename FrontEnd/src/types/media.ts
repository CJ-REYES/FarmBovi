import type { LocalMedia, MediaSyncState } from '../lib/database/schema';

export type AnimalPhotoType = 'BoviScaleVision' | 'FotoPerfil';

export const PHOTO_CAPTURE_LIMITS = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  maxSizeBytes: 20 * 1024 * 1024, // 20 MB para soportar capturas de máxima resolución de cámara
  jpegQuality: 0.96
} as const;

/**
 * Dependencia explícita con el Backend (ver `docs/08-contrato-sincronizacion.md` §Alcance real de Pull).
 * Aún no existe endpoint de almacenamiento binario/multimedia (`ArchivoMultimedia`) en el servidor.
 */
export const MEDIA_BACKEND_DEPENDENCY = {
  entityName: 'ArchivoMultimedia',
  syncPushEnabled: false,
  syncPullEnabled: false,
  summaryMessage:
    'Almacenamiento local offline-first activo: las fotografías se guardan como Blob con sus metadatos en IndexedDB y quedan en cola pendiente de subida hasta que el Backend habilite el endpoint multimedia (ArchivoMultimedia). Esta versión cubre captura, almacenamiento y cola de sincronización sin estimación automática de peso por IA.'
} as const;

export interface StoredAnimalPhoto {
  id: string;
  cattleId: string;
  ranchId: string;
  tipo: LocalMedia['tipo'];
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  checksumSha256: string | null;
  blobData?: Blob;
  urlRemota: string | null;
  idOperacionSubida: string | null;
  estadoArchivo: MediaSyncState;
  intentosSubida: number;
  ultimoErrorSubida: string | null;
  fechaCaptura: string;
  syncStatus: LocalMedia['syncStatus'];
  deletedAt: string | null;
}

export interface PhotoStorageSummary {
  totalPhotos: number;
  pendingUploads: number;
  totalBytes: number;
  browserUsageBytes?: number;
  browserQuotaBytes?: number;
  browserUsagePercentage?: number;
  isPersisted: boolean;
}
