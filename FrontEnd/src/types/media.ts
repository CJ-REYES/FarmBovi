import type { LocalMedia, MediaSyncState } from '../lib/database/schema';

export type AnimalPhotoType = 'BoviScaleVision' | 'FotoPerfil';

export const PHOTO_CAPTURE_LIMITS = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  maxSizeBytes: 20 * 1024 * 1024, // 20 MB para soportar capturas de máxima resolución de cámara
  jpegQuality: 0.96
} as const;

/**
 * Contrato real de sincronización multimedia con el Backend (`POST/GET/DELETE /api/media/archivos`).
 * En la base de datos únicamente se persiste la ruta relativa (`public/imagenes/perfil-ganado/...`,
 * `public/imagenes/pesaje-ganado/...`, `public/imagenes/perfil-usuario/...`) y las imágenes se
 * almacenan en disco servidas vía `/api/media/...`.
 */
export const MEDIA_BACKEND_DEPENDENCY = {
  entityName: 'ArchivoMultimedia',
  syncPushEnabled: true,
  syncPullEnabled: true,
  summaryMessage:
    'Sincronización multimedia activa: las imágenes se guardan en disco en public/imagenes/ (perfil-ganado, pesaje-ganado, perfil-usuario) y en la base de datos solo se registra su ruta relativa transformada a URL para el Frontend. Sin conexión permanecen seguras en IndexedDB hasta reconectar.'
} as const;

export interface BackendArchivoMultimediaDto {
  idArchivo: string;
  idRancho: string;
  idAnimal: string | null;
  entidadRelacionada: string;
  idEntidadRelacionada: string | null;
  tipo: string;
  nombreArchivo: string;
  mimeType: string;
  tamanoBytes: number;
  checksumSha256: string | null;
  rutaArchivo: string;
  urlPublica: string;
  fechaCaptura: string;
  creadoEn: string;
  versionRegistro: number;
  eliminadoEn: string | null;
}

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
