import type { LocalMedia, MediaSyncState } from '../lib/database/schema';

export type AnimalPhotoType = 'BoviScaleVision' | 'FotoPerfil';

export const PHOTO_CAPTURE_LIMITS = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  /** Alineado con el límite de seguridad del Backend (`MediaStorage:MaxFileSizeBytes` = 10 MB). */
  maxSizeBytes: 10 * 1024 * 1024,
  jpegQuality: 0.96
} as const;

/**
 * Contrato real de sincronización multimedia con el Backend (`POST/GET/DELETE /api/media/archivos`).
 * Los binarios privados residen en el proveedor físico configurado (`IMediaStorageProvider`) y se
 * sirven únicamente mediante autorización por rancho en `GET /api/media/archivos/{id}/contenido`.
 */
export const MEDIA_BACKEND_DEPENDENCY = {
  entityName: 'ArchivoMultimedia',
  syncPushEnabled: true,
  syncPullEnabled: true,
  summaryMessage:
    'Sincronización multimedia activa: las fotografías se persisten primero como Blob en IndexedDB y se sincronizan al almacenamiento privado por rancho en el servidor. Sin conexión permanecen seguras en cola local hasta reconectar.'
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
  extension?: string;
  tamanoBytes: number;
  checksumSha256: string | null;
  proveedorAlmacenamiento?: string;
  rutaArchivo: string;
  estado?: string;
  urlContenido?: string;
  urlPublica: string;
  fechaCaptura: string;
  fechaCarga?: string;
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
  extension?: string | null;
  tamanoBytes: number;
  checksumSha256: string | null;
  blobData?: Blob;
  urlRemota: string | null;
  rutaArchivoRemota?: string | null;
  proveedorAlmacenamiento?: string | null;
  estadoRemoto?: string | null;
  fechaCarga?: string | null;
  idOperacionSubida: string | null;
  estadoArchivo: MediaSyncState;
  intentosSubida: number;
  ultimoErrorSubida: string | null;
  proximoIntentoSubida?: string | null;
  errorSubidaPermanente?: boolean;
  fechaCaptura: string;
  syncStatus: LocalMedia['syncStatus'];
  deletedAt: string | null;
}

export interface PhotoStorageSummary {
  totalPhotos: number;
  pendingUploads: number;
  failedUploads?: number;
  totalBytes: number;
  browserUsageBytes?: number;
  browserQuotaBytes?: number;
  browserUsagePercentage?: number;
  isPersisted: boolean;
}
