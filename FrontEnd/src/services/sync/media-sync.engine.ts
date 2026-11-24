import {
  ApiError,
  PERSISTED_SESSION_META_KEY,
  hasActiveAuthSession,
  mediaApi
} from '../../lib/api';
import { db } from '../../lib/database/db';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { SyncMetadataRepository } from '../../lib/database/repositories/sync-metadata.repository';
import type { LocalMedia } from '../../lib/database/schema';
import { PHOTO_CAPTURE_LIMITS, type BackendArchivoMultimediaDto } from '../../types/media';
import { isValidGuid } from '../cattle.validation';

export const MAX_MEDIA_UPLOAD_RETRIES = 5;
export const MEDIA_RETRY_BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

export interface MediaSyncSummary {
  uploadedCount: number;
  deletedCount: number;
  pulledCount: number;
  errorCount: number;
  skippedDuplicateCount?: number;
  skippedForeignRanchCount?: number;
  skippedBackoffCount?: number;
  authRequired?: boolean;
  offlineInterrupted?: boolean;
}

export interface MediaSyncOptions {
  ranchIds?: readonly string[];
  skipPull?: boolean;
}

const inFlightMediaIds = new Set<string>();
let activeMediaSyncPromise: Promise<MediaSyncSummary> | null = null;

function normalizeMediaType(raw: string): LocalMedia['tipo'] {
  const norm = raw.trim().toLowerCase();
  if (norm === 'boviscalevision') return 'BoviScaleVision';
  if (norm === 'documento') return 'Documento';
  return 'FotoPerfil';
}

function normalizeRelatedEntity(raw: string): LocalMedia['entidadRelacionada'] {
  if (raw === 'weighings' || raw === 'healthRecords') return raw;
  return 'cattle';
}

function resolveRemoteContentUrl(dto: BackendArchivoMultimediaDto): string {
  return dto.urlContenido || dto.urlPublica || `/api/media/archivos/${dto.idArchivo}/contenido`;
}

function computeNextRetryIso(attemptNumber: number, retryAfterMs?: number | null): string {
  const backoffIndex = Math.min(
    Math.max(0, attemptNumber - 1),
    MEDIA_RETRY_BACKOFF_MS.length - 1
  );
  const delayMs =
    typeof retryAfterMs === 'number' && retryAfterMs > 0
      ? Math.min(retryAfterMs, 10 * 60 * 1000)
      : MEDIA_RETRY_BACKOFF_MS[backoffIndex];
  return new Date(Date.now() + delayMs).toISOString();
}

function readAuthorizedSessionRanchIds(): { hasSession: boolean; ranchIds: string[] } {
  if (typeof window === 'undefined') {
    return { hasSession: false, ranchIds: [] };
  }
  const candidates: Array<string | null> = [];
  try {
    if (window.sessionStorage) {
      candidates.push(window.sessionStorage.getItem('farmbovi_session_user'));
    }
  } catch {
    // Ignorar errores de almacenamiento
  }
  try {
    if (window.localStorage) {
      candidates.push(window.localStorage.getItem(PERSISTED_SESSION_META_KEY));
    }
  } catch {
    // Ignorar errores de almacenamiento
  }

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as {
        idUsuario?: unknown;
        ranchos?: Array<{ idRancho?: string }>;
      };
      if (typeof parsed.idUsuario !== 'string') continue;

      const ranchIds = Array.isArray(parsed.ranchos)
        ? Array.from(
            new Set(
              parsed.ranchos
                .map((r) => (typeof r?.idRancho === 'string' ? r.idRancho.trim() : ''))
                .filter((id) => isValidGuid(id))
            )
          )
        : [];
      return { hasSession: true, ranchIds };
    } catch {
      // Continuar con el siguiente candidato
    }
  }

  return { hasSession: false, ranchIds: [] };
}

function resolveAuthorizedRanchSet(explicitRanchIds?: readonly string[]): ReadonlySet<string> | null {
  if (explicitRanchIds !== undefined) {
    return new Set(explicitRanchIds.filter((id) => isValidGuid(id)));
  }
  const sessionInfo = readAuthorizedSessionRanchIds();
  if (sessionInfo.hasSession) {
    return new Set(sessionInfo.ranchIds);
  }
  return null;
}

function isRanchAllowed(
  ranchId: string | null | undefined,
  allowedSet: ReadonlySet<string> | null
): boolean {
  if (allowedSet === null) return true;
  if (!ranchId || !isValidGuid(ranchId)) return false;
  return allowedSet.has(ranchId);
}

async function resolveItemRanchId(item: LocalMedia): Promise<string | null> {
  if (item.ranchId && isValidGuid(item.ranchId)) {
    return item.ranchId;
  }
  const cattleId = item.cattleId || item.idEntidadRelacionada;
  if (cattleId && isValidGuid(cattleId)) {
    const animal = await db.cattle.get(cattleId);
    if (animal?.ranchId && isValidGuid(animal.ranchId)) {
      return animal.ranchId;
    }
  }
  return null;
}

async function markMediaOutboxConfirmed(
  mediaId: string,
  operationType?: 'CREATE' | 'DELETE'
): Promise<void> {
  const ops = await OutboxRepository.getByEntity('media', mediaId);
  const targetOps = ops.filter(
    (op) => op.estado !== 'confirmado' && (!operationType || op.tipoOperacion === operationType)
  );
  for (const op of targetOps) {
    await db.outbox.update(op.idOperacion, {
      estado: 'confirmado',
      ultimoError: null,
      proximoIntento: null
    });
  }
}

async function ensureUploadableBlob(raw: Blob, fallbackMime: string): Promise<Blob> {
  if (typeof Blob !== 'undefined' && raw instanceof Blob) {
    return raw;
  }
  if (typeof raw.arrayBuffer === 'function') {
    const buf = await raw.arrayBuffer();
    return new Blob([buf], { type: raw.type || fallbackMime || 'image/jpeg' });
  }
  return new Blob([raw as unknown as BlobPart], { type: fallbackMime || 'image/jpeg' });
}

type UploadOutcome =
  | 'uploaded'
  | 'duplicate_skipped'
  | 'foreign_ranch'
  | 'deferred_parent_pending'
  | 'auth_required'
  | 'offline'
  | 'error';

async function uploadLocalMediaItem(
  item: LocalMedia,
  allowedRanchSet: ReadonlySet<string> | null
): Promise<UploadOutcome> {
  if (item.deletedAt) {
    return 'duplicate_skipped';
  }
  if (inFlightMediaIds.has(item.id)) {
    return 'duplicate_skipped';
  }

  // Respetar estrictamente los permisos del usuario por rancho
  const resolvedRanchId = await resolveItemRanchId(item);
  if (!isRanchAllowed(resolvedRanchId, allowedRanchSet)) {
    return 'foreign_ranch';
  }

  // Evitar subir dos veces un archivo ya confirmado en el servidor
  if (item.estadoArchivo === 'subido' && (item.remoteId || item.urlRemota)) {
    await markMediaOutboxConfirmed(item.id, 'CREATE');
    return 'duplicate_skipped';
  }

  // Evitar subir duplicado exacto por (cattleId, checksumSha256) si ya existe una copia confirmada
  if (item.cattleId && item.checksumSha256) {
    const alreadySyncedSibling = await db.media
      .where('cattleId')
      .equals(item.cattleId)
      .filter(
        (m) =>
          m.id !== item.id &&
          !m.deletedAt &&
          m.checksumSha256 === item.checksumSha256 &&
          m.tipo === item.tipo &&
          m.estadoArchivo === 'subido' &&
          Boolean(m.remoteId || m.urlRemota)
      )
      .first();

    if (alreadySyncedSibling) {
      const now = new Date().toISOString();
      await db.transaction('rw', [db.media, db.outbox], async () => {
        await db.media.update(item.id, {
          remoteId: alreadySyncedSibling.remoteId ?? alreadySyncedSibling.id,
          ranchId: alreadySyncedSibling.ranchId ?? resolvedRanchId ?? item.ranchId,
          urlRemota: alreadySyncedSibling.urlRemota ?? null,
          rutaArchivoRemota: alreadySyncedSibling.rutaArchivoRemota ?? null,
          proveedorAlmacenamiento: alreadySyncedSibling.proveedorAlmacenamiento ?? null,
          estadoRemoto: alreadySyncedSibling.estadoRemoto ?? 'Disponible',
          fechaCarga: alreadySyncedSibling.fechaCarga ?? now,
          estadoArchivo: 'subido',
          syncStatus: 'synced',
          serverVersion: alreadySyncedSibling.serverVersion ?? 1,
          ultimoErrorSubida: null,
          proximoIntentoSubida: null,
          errorSubidaPermanente: false,
          updatedAt: now
        });
        await markMediaOutboxConfirmed(item.id, 'CREATE');
      });
      return 'duplicate_skipped';
    }
  }

  if (!item.blobData) {
    const now = new Date().toISOString();
    const missingMsg = 'El binario local de la fotografía no está disponible en el dispositivo.';
    await db.transaction('rw', [db.media, db.outbox], async () => {
      await db.media.update(item.id, {
        estadoArchivo: 'error_subida',
        syncStatus: 'error',
        errorSubidaPermanente: true,
        proximoIntentoSubida: null,
        ultimoErrorSubida: missingMsg,
        updatedAt: now
      });
      const ops = await OutboxRepository.getByEntity('media', item.id);
      for (const op of ops) {
        if (op.tipoOperacion === 'CREATE' && op.estado !== 'confirmado') {
          await db.outbox.update(op.idOperacion, {
            estado: 'fallido',
            ultimoError: missingMsg,
            proximoIntento: null
          });
        }
      }
    });
    return 'error';
  }

  // Manejar archivos demasiado grandes antes de transmitir (sin eliminar el Blob local ni bloquear otras fotos)
  const effectiveSize = item.blobData.size || item.tamanoBytes;
  if (effectiveSize > PHOTO_CAPTURE_LIMITS.maxSizeBytes) {
    const maxMb = Math.round(PHOTO_CAPTURE_LIMITS.maxSizeBytes / (1024 * 1024));
    const sizeMsg = `El archivo supera el tamaño máximo permitido de ${maxMb} MB. Comprime o reemplaza la fotografía.`;
    const now = new Date().toISOString();
    await db.transaction('rw', [db.media, db.outbox], async () => {
      await db.media.update(item.id, {
        estadoArchivo: 'error_subida',
        syncStatus: 'error',
        errorSubidaPermanente: true,
        proximoIntentoSubida: null,
        ultimoErrorSubida: sizeMsg,
        updatedAt: now
      });
      const ops = await OutboxRepository.getByEntity('media', item.id);
      for (const op of ops) {
        if (op.tipoOperacion === 'CREATE' && op.estado !== 'confirmado') {
          await db.outbox.update(op.idOperacion, {
            estado: 'fallido',
            ultimoError: sizeMsg,
            proximoIntento: null
          });
        }
      }
    });
    await SyncMetadataRepository.recordError('media', {
      phase: 'media',
      message: sizeMsg,
      code: 413,
      ranchId: resolvedRanchId ?? null
    });
    return 'error';
  }

  // Si el animal padre aún está pendiente de sincronizar (creado offline), diferir sin quemar reintentos
  if (item.cattleId) {
    const parentAnimal = await db.cattle.get(item.cattleId);
    if (parentAnimal && parentAnimal.syncStatus === 'pending' && !parentAnimal.remoteId) {
      return 'deferred_parent_pending';
    }
  }

  inFlightMediaIds.add(item.id);

  try {
    const now = new Date().toISOString();
    await db.transaction('rw', [db.media, db.outbox], async () => {
      await db.media.update(item.id, {
        estadoArchivo: 'subiendo',
        updatedAt: now
      });
      const ops = await OutboxRepository.getByEntity('media', item.id);
      for (const op of ops) {
        if (op.tipoOperacion === 'CREATE' && op.estado === 'pendiente') {
          await db.outbox.update(op.idOperacion, { estado: 'en_proceso' });
        }
      }
    });

    const fileExtension = (item.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const fileName = item.nombreArchivo || `${item.tipo.toLowerCase()}_${item.id}.${fileExtension}`;
    const uploadBlob = await ensureUploadableBlob(item.blobData, item.mimeType);
    const formData = new FormData();
    formData.append('archivo', uploadBlob, fileName);
    formData.append('idArchivo', item.id);
    if (resolvedRanchId) formData.append('idRancho', resolvedRanchId);
    if (item.cattleId) formData.append('idAnimal', item.cattleId);
    formData.append('entidadRelacionada', item.entidadRelacionada || 'cattle');
    if (item.idEntidadRelacionada) formData.append('idEntidadRelacionada', item.idEntidadRelacionada);
    formData.append('tipo', item.tipo);
    formData.append('nombreArchivo', fileName);
    if (item.checksumSha256) formData.append('checksumSha256', item.checksumSha256);
    if (item.fechaCaptura) formData.append('fechaCaptura', item.fechaCaptura);

    try {
      const uploaded: BackendArchivoMultimediaDto = await mediaApi.upload(formData);
      const confirmedUrl = resolveRemoteContentUrl(uploaded);

      if (!uploaded?.idArchivo || !confirmedUrl) {
        throw new ApiError(
          'El servidor no devolvió confirmación completa de metadatos multimedia.',
          502
        );
      }

      const confirmedAt = new Date().toISOString();
      // Nunca se elimina el Blob local antes ni durante la confirmación remota;
      // solo tras recibir confirmación válida se asocian los metadatos remotos y se confirma el outbox.
      await db.transaction('rw', [db.media, db.outbox], async () => {
        await db.media.update(item.id, {
          remoteId: uploaded.idArchivo,
          ranchId: uploaded.idRancho || resolvedRanchId || item.ranchId,
          urlRemota: confirmedUrl,
          rutaArchivoRemota: uploaded.rutaArchivo ?? null,
          proveedorAlmacenamiento: uploaded.proveedorAlmacenamiento ?? 'LocalFileSystem',
          extension: uploaded.extension ?? item.extension ?? null,
          estadoRemoto: uploaded.estado ?? 'Disponible',
          fechaCarga: uploaded.fechaCarga ?? uploaded.creadoEn ?? confirmedAt,
          checksumSha256: uploaded.checksumSha256 ?? item.checksumSha256 ?? null,
          tamanoBytes: uploaded.tamanoBytes || item.tamanoBytes,
          estadoArchivo: 'subido',
          syncStatus: 'synced',
          serverVersion: uploaded.versionRegistro ?? 1,
          ultimoErrorSubida: null,
          proximoIntentoSubida: null,
          errorSubidaPermanente: false,
          updatedAt: confirmedAt
        });
        await markMediaOutboxConfirmed(item.id, 'CREATE');
      });

      await SyncMetadataRepository.recordSuccess('media', 'media', uploaded.idRancho);
      return 'uploaded';
    } catch (err) {
      const status = err instanceof ApiError ? err.status : null;
      const rawMessage =
        err instanceof Error ? err.message : 'Error al subir la fotografía al servidor.';

      // Sesión expirada (401) o pérdida de red durante la subida:
      // restaurar a pendiente_subida conservando Blob local y sin quemar intentos
      const isAuthError = status === 401;
      const isOfflineDrop =
        (typeof navigator !== 'undefined' && !navigator.onLine) || status === 0;

      if (isAuthError || isOfflineDrop) {
        const revertMessage = isAuthError
          ? 'Sesión expirada (401). Inicia sesión nuevamente para subir fotografías.'
          : 'Conexión perdida durante la subida. El archivo permanece seguro y se reintentará al reconectar.';
        const nowRevert = new Date().toISOString();
        await db.transaction('rw', [db.media, db.outbox], async () => {
          await db.media.update(item.id, {
            estadoArchivo: 'pendiente_subida',
            ultimoErrorSubida: revertMessage,
            proximoIntentoSubida: null,
            errorSubidaPermanente: false,
            syncStatus: 'pending',
            updatedAt: nowRevert
          });
          const ops = await OutboxRepository.getByEntity('media', item.id);
          for (const op of ops) {
            if (op.tipoOperacion === 'CREATE' && op.estado !== 'confirmado') {
              await db.outbox.update(op.idOperacion, {
                estado: 'pendiente',
                ultimoError: revertMessage,
                proximoIntento: null
              });
            }
          }
        });
        await SyncMetadataRepository.recordError('media', {
          phase: 'media',
          message: revertMessage,
          code: isAuthError ? 401 : 0,
          ranchId: resolvedRanchId ?? null
        });
        return isAuthError ? 'auth_required' : 'offline';
      }

      const isPermanent =
        status === 400 || status === 403 || status === 409 || status === 413;
      const nextAttempt = (item.intentosSubida ?? 0) + 1;
      const exhaustedRetries = !isPermanent && nextAttempt >= MAX_MEDIA_UPLOAD_RETRIES;

      const userFriendlyMessage =
        status === 413
          ? 'La fotografía excede el tamaño máximo permitido por el servidor (10 MB).'
          : status === 403
            ? 'No tienes permisos en el rancho para subir esta fotografía.'
            : exhaustedRetries
              ? `Error tras ${nextAttempt} intentos: ${rawMessage}. Puedes reintentar manualmente.`
              : rawMessage;

      const nextRetryIso =
        isPermanent || exhaustedRetries
          ? null
          : computeNextRetryIso(nextAttempt, err instanceof ApiError ? err.retryAfterMs : null);
      const nowErr = new Date().toISOString();

      await db.transaction('rw', [db.media, db.outbox], async () => {
        await db.media.update(item.id, {
          estadoArchivo: 'error_subida',
          intentosSubida: nextAttempt,
          ultimoErrorSubida: userFriendlyMessage,
          proximoIntentoSubida: nextRetryIso,
          errorSubidaPermanente: isPermanent,
          syncStatus: isPermanent || exhaustedRetries ? 'error' : 'pending',
          updatedAt: nowErr
        });

        const ops = await OutboxRepository.getByEntity('media', item.id);
        for (const op of ops) {
          if (op.tipoOperacion === 'CREATE' && op.estado !== 'confirmado') {
            await db.outbox.update(op.idOperacion, {
              estado: isPermanent || exhaustedRetries ? 'fallido' : 'pendiente',
              intentos: op.intentos + 1,
              ultimoError: userFriendlyMessage,
              proximoIntento: nextRetryIso
            });
          }
        }
      });

      await SyncMetadataRepository.recordError('media', {
        phase: 'media',
        message: userFriendlyMessage,
        code: status,
        ranchId: resolvedRanchId ?? null
      });
      return 'error';
    }
  } finally {
    inFlightMediaIds.delete(item.id);
  }
}

export const MediaSyncEngine = {
  /**
   * Recupera fotografías y operaciones en outbox que quedaron en curso tras un cierre
   * o reinicio inesperado de la aplicación/navegador, conservando intacto el Blob local.
   */
  async recoverInterruptedUploads(): Promise<number> {
    const stuckMedia = await db.media.where('estadoArchivo').equals('subiendo').toArray();
    const stuckOps = await db.outbox
      .where('entidad')
      .equals('media')
      .filter((op) => op.estado === 'en_proceso')
      .toArray();

    let recovered = 0;
    const now = new Date().toISOString();

    for (const item of stuckMedia) {
      if (!inFlightMediaIds.has(item.id) && !item.deletedAt) {
        await db.media.update(item.id, {
          estadoArchivo: 'pendiente_subida',
          proximoIntentoSubida: null,
          updatedAt: now
        });
        recovered++;
      }
    }

    for (const op of stuckOps) {
      if (!inFlightMediaIds.has(op.idEntidad)) {
        await db.outbox.update(op.idOperacion, {
          estado: 'pendiente'
        });
      }
    }

    return recovered;
  },

  async syncSingleMedia(mediaId: string): Promise<{ synced: boolean; error?: string }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { synced: false };
    }
    if (!hasActiveAuthSession()) {
      return { synced: false };
    }

    const item = await db.media.get(mediaId);
    if (!item || item.deletedAt) {
      return { synced: false };
    }
    if (item.estadoArchivo === 'subido' && (item.remoteId || item.urlRemota)) {
      await markMediaOutboxConfirmed(mediaId, 'CREATE');
      return { synced: true };
    }

    const allowedRanchSet = resolveAuthorizedRanchSet();
    const outcome = await uploadLocalMediaItem(item, allowedRanchSet);
    const refreshed = await db.media.get(mediaId);
    return {
      synced: outcome === 'uploaded' || outcome === 'duplicate_skipped',
      error: refreshed?.ultimoErrorSubida ?? undefined
    };
  },

  /**
   * Permite reintentar manualmente una fotografía específica o todas las fotografías con
   * errores recuperables en cola local.
   */
  async retryFailedMedia(mediaId?: string): Promise<MediaSyncSummary> {
    const now = new Date().toISOString();

    if (mediaId) {
      const item = await db.media.get(mediaId);
      if (item && !item.deletedAt && item.estadoArchivo !== 'subido') {
        await db.transaction('rw', [db.media, db.outbox], async () => {
          await db.media.update(item.id, {
            estadoArchivo: 'pendiente_subida',
            intentosSubida: 0,
            proximoIntentoSubida: null,
            errorSubidaPermanente: false,
            ultimoErrorSubida: null,
            syncStatus: 'pending',
            updatedAt: now
          });
          const ops = await OutboxRepository.getByEntity('media', item.id);
          for (const op of ops) {
            if (op.tipoOperacion === 'CREATE' && op.estado !== 'confirmado') {
              await db.outbox.update(op.idOperacion, {
                estado: 'pendiente',
                intentos: 0,
                proximoIntento: null,
                ultimoError: null
              });
            }
          }
        });
      }

      const res = await this.syncSingleMedia(mediaId);
      return {
        uploadedCount: res.synced ? 1 : 0,
        deletedCount: 0,
        pulledCount: 0,
        errorCount: res.synced ? 0 : 1
      };
    }

    const failedItems = await db.media
      .where('estadoArchivo')
      .equals('error_subida')
      .filter((m) => !m.deletedAt && !m.errorSubidaPermanente && Boolean(m.blobData))
      .toArray();

    for (const item of failedItems) {
      await db.transaction('rw', [db.media, db.outbox], async () => {
        await db.media.update(item.id, {
          estadoArchivo: 'pendiente_subida',
          intentosSubida: 0,
          proximoIntentoSubida: null,
          ultimoErrorSubida: null,
          syncStatus: 'pending',
          updatedAt: now
        });
        const ops = await OutboxRepository.getByEntity('media', item.id);
        for (const op of ops) {
          if (op.tipoOperacion === 'CREATE' && op.estado !== 'confirmado') {
            await db.outbox.update(op.idOperacion, {
              estado: 'pendiente',
              intentos: 0,
              proximoIntento: null,
              ultimoError: null
            });
          }
        }
      });
    }

    return await this.syncPendingMedia({ skipPull: true });
  },

  /**
   * Descarga únicamente METADATOS remotos (`GET /api/media/archivos`) respetando permisos
   * por rancho y propagando bajas remotas. Nunca descarga los binarios de las imágenes automáticamente.
   */
  async pullRemoteMedia(options?: {
    cattleId?: string;
    ranchId?: string;
    ranchIds?: readonly string[];
  }): Promise<number> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
    if (!hasActiveAuthSession()) return 0;

    const allowedRanchSet = resolveAuthorizedRanchSet(options?.ranchIds);

    // Determinar los ranchos objetivo para evitar descargar metadatos de ranchos ajenos
    const ranchQueries: Array<string | undefined> = [];
    if (options?.ranchId && isValidGuid(options.ranchId)) {
      if (!isRanchAllowed(options.ranchId, allowedRanchSet)) {
        return 0;
      }
      ranchQueries.push(options.ranchId);
    } else if (options?.ranchIds && options.ranchIds.length > 0) {
      const validTargets = options.ranchIds.filter((id) => isRanchAllowed(id, allowedRanchSet));
      if (validTargets.length === 0) return 0;
      ranchQueries.push(...validTargets);
    } else if (allowedRanchSet !== null) {
      if (allowedRanchSet.size === 0) return 0;
      ranchQueries.push(undefined);
    } else {
      ranchQueries.push(undefined);
    }

    try {
      const remoteList: BackendArchivoMultimediaDto[] = [];
      for (const targetRanchId of ranchQueries) {
        const page = await mediaApi.list({
          idRancho: targetRanchId,
          idAnimal: options?.cattleId,
          incluirEliminados: true
        });
        remoteList.push(...page);
      }

      if (remoteList.length === 0) return 0;

      const now = new Date().toISOString();
      let applied = 0;

      await db.transaction('rw', [db.media], async () => {
        for (const remote of remoteList) {
          if (!isRanchAllowed(remote.idRancho, allowedRanchSet)) {
            continue;
          }

          const existing =
            (await db.media.where('remoteId').equals(remote.idArchivo).first()) ??
            (await db.media.get(remote.idArchivo));

          const isDeletedRemotely =
            Boolean(remote.eliminadoEn) ||
            (remote.estado ?? '').trim().toLowerCase() === 'eliminado';

          if (isDeletedRemotely) {
            if (existing && !existing.deletedAt && existing.syncStatus !== 'pending') {
              await db.media.update(existing.id, {
                deletedAt: remote.eliminadoEn ?? now,
                estadoRemoto: 'Eliminado',
                blobData: undefined,
                syncStatus: 'synced',
                serverVersion: remote.versionRegistro ?? existing.serverVersion ?? 1,
                updatedAt: now
              });
              applied++;
            }
            continue;
          }

          if (existing && (existing.syncStatus === 'pending' || existing.deletedAt)) {
            continue;
          }

          const record: LocalMedia = {
            id: existing?.id || remote.idArchivo,
            remoteId: remote.idArchivo,
            ranchId: remote.idRancho,
            cattleId: remote.idAnimal ?? existing?.cattleId,
            entidadRelacionada: normalizeRelatedEntity(remote.entidadRelacionada),
            idEntidadRelacionada:
              remote.idEntidadRelacionada ?? remote.idAnimal ?? existing?.idEntidadRelacionada,
            tipo: normalizeMediaType(remote.tipo),
            nombreArchivo: remote.nombreArchivo,
            mimeType: remote.mimeType,
            extension: remote.extension ?? existing?.extension ?? null,
            tamanoBytes: remote.tamanoBytes,
            checksumSha256: remote.checksumSha256 ?? existing?.checksumSha256 ?? null,
            // Conservar Blob si ya existe localmente en este dispositivo; en un nuevo dispositivo
            // queda undefined para cargarse bajo demanda solo cuando el usuario visualice la foto.
            blobData: existing?.blobData,
            urlRemota: resolveRemoteContentUrl(remote),
            rutaArchivoRemota: remote.rutaArchivo ?? existing?.rutaArchivoRemota ?? null,
            proveedorAlmacenamiento:
              remote.proveedorAlmacenamiento ?? existing?.proveedorAlmacenamiento ?? 'LocalFileSystem',
            estadoRemoto: remote.estado ?? 'Disponible',
            fechaCarga: remote.fechaCarga ?? remote.creadoEn ?? existing?.fechaCarga ?? now,
            idOperacionSubida: existing?.idOperacionSubida ?? null,
            estadoArchivo: 'subido',
            intentosSubida: existing?.intentosSubida ?? 0,
            ultimoErrorSubida: null,
            proximoIntentoSubida: null,
            errorSubidaPermanente: false,
            fechaCaptura: remote.fechaCaptura || existing?.fechaCaptura || now,
            createdAt: remote.creadoEn || existing?.createdAt || now,
            updatedAt: now,
            syncStatus: 'synced',
            serverVersion: remote.versionRegistro ?? 1,
            deletedAt: null
          };

          await db.media.put(record);
          applied++;
        }
      });

      return applied;
    } catch {
      return 0;
    }
  },

  async syncPendingMedia(options?: MediaSyncOptions): Promise<MediaSyncSummary> {
    if (activeMediaSyncPromise) {
      return await activeMediaSyncPromise;
    }

    activeMediaSyncPromise = (async (): Promise<MediaSyncSummary> => {
      const summary: MediaSyncSummary = {
        uploadedCount: 0,
        deletedCount: 0,
        pulledCount: 0,
        errorCount: 0,
        skippedDuplicateCount: 0,
        skippedForeignRanchCount: 0,
        skippedBackoffCount: 0
      };

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return summary;
      }
      if (!hasActiveAuthSession()) {
        return summary;
      }

      const allowedRanchSet = resolveAuthorizedRanchSet(options?.ranchIds);

      // 1. Recuperar subidas interrumpidas por cierre o reinicio previo de la aplicación
      await this.recoverInterruptedUploads();

      // 2. Subir fotografías elegibles en cola local (pendientes o errores recuperables con backoff cumplido)
      const nowIso = new Date().toISOString();
      const candidates = await db.media
        .where('estadoArchivo')
        .anyOf('pendiente_subida', 'error_subida')
        .filter((m) => !m.deletedAt)
        .toArray();

      // Orden FIFO por fecha de captura
      candidates.sort((a, b) => a.fechaCaptura.localeCompare(b.fechaCaptura));

      for (const item of candidates) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          summary.offlineInterrupted = true;
          return summary;
        }

        if (item.estadoArchivo === 'error_subida') {
          if (item.errorSubidaPermanente) {
            continue;
          }
          if ((item.intentosSubida ?? 0) >= MAX_MEDIA_UPLOAD_RETRIES) {
            continue;
          }
          if (item.proximoIntentoSubida && item.proximoIntentoSubida > nowIso) {
            summary.skippedBackoffCount = (summary.skippedBackoffCount ?? 0) + 1;
            continue;
          }
        }

        const outcome = await uploadLocalMediaItem(item, allowedRanchSet);
        if (outcome === 'uploaded') {
          summary.uploadedCount++;
        } else if (outcome === 'duplicate_skipped') {
          summary.skippedDuplicateCount = (summary.skippedDuplicateCount ?? 0) + 1;
        } else if (outcome === 'foreign_ranch') {
          summary.skippedForeignRanchCount = (summary.skippedForeignRanchCount ?? 0) + 1;
        } else if (outcome === 'deferred_parent_pending') {
          // El animal padre aún no ha sido sincronizado; se reintentará en el próximo ciclo sin error
          continue;
        } else if (outcome === 'auth_required') {
          summary.authRequired = true;
          return summary;
        } else if (outcome === 'offline') {
          summary.offlineInterrupted = true;
          return summary;
        } else {
          // Error aislado en esta fotografía: registrar y continuar sin bloquear las demás
          summary.errorCount++;
        }
      }

      // 3. Sincronizar bajas autorizadas de archivos multimedia en cola
      const mediaDeleteOps = await db.outbox
        .where('entidad')
        .equals('media')
        .filter((op) => op.tipoOperacion === 'DELETE' && op.estado !== 'confirmado' && op.estado !== 'fallido')
        .toArray();

      for (const op of mediaDeleteOps) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          summary.offlineInterrupted = true;
          return summary;
        }

        const local = await db.media.get(op.idEntidad);
        const targetRanchId = op.idRancho || local?.ranchId || null;
        if (!isRanchAllowed(targetRanchId, allowedRanchSet)) {
          summary.skippedForeignRanchCount = (summary.skippedForeignRanchCount ?? 0) + 1;
          continue;
        }

        const remoteId =
          typeof local?.remoteId === 'string'
            ? local.remoteId
            : typeof (op.payload as { id?: unknown } | null)?.id === 'string'
              ? String((op.payload as { id: string }).id)
              : null;

        if (!remoteId) {
          await OutboxRepository.discardOperation(op.idOperacion);
          continue;
        }

        try {
          await mediaApi.remove(remoteId);
          await db.transaction('rw', [db.media, db.outbox], async () => {
            await markMediaOutboxConfirmed(op.idEntidad, 'DELETE');
            if (local) {
              await db.media.update(local.id, {
                estadoRemoto: 'Eliminado',
                blobData: undefined,
                syncStatus: 'synced',
                updatedAt: new Date().toISOString()
              });
            }
          });
          summary.deletedCount++;
        } catch (err) {
          const status = err instanceof ApiError ? err.status : null;

          if (status === 404) {
            await db.transaction('rw', [db.media, db.outbox], async () => {
              await markMediaOutboxConfirmed(op.idEntidad, 'DELETE');
              if (local) {
                await db.media.update(local.id, {
                  estadoRemoto: 'Eliminado',
                  blobData: undefined,
                  syncStatus: 'synced',
                  updatedAt: new Date().toISOString()
                });
              }
            });
            summary.deletedCount++;
          } else if (status === 401) {
            summary.authRequired = true;
            return summary;
          } else if (status === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) {
            summary.offlineInterrupted = true;
            return summary;
          } else if (status === 403) {
            const msg = 'No tienes permisos en el rancho para eliminar esta fotografía del servidor.';
            await db.outbox.update(op.idOperacion, {
              estado: 'fallido',
              intentos: op.intentos + 1,
              ultimoError: msg,
              proximoIntento: null
            });
            await SyncMetadataRepository.recordError('media', {
              phase: 'media',
              message: msg,
              code: 403,
              ranchId: targetRanchId
            });
            summary.errorCount++;
          } else {
            const msg = err instanceof Error ? err.message : 'Error al eliminar la fotografía remota.';
            const nextAttempt = op.intentos + 1;
            const nextRetry = computeNextRetryIso(
              nextAttempt,
              err instanceof ApiError ? err.retryAfterMs : null
            );
            await db.outbox.update(op.idOperacion, {
              estado: nextAttempt >= MAX_MEDIA_UPLOAD_RETRIES ? 'fallido' : 'pendiente',
              intentos: nextAttempt,
              ultimoError: msg,
              proximoIntento: nextAttempt >= MAX_MEDIA_UPLOAD_RETRIES ? null : nextRetry
            });
            summary.errorCount++;
          }
        }
      }

      // 4. Descargar únicamente metadatos remotos (sin bajar binarios innecesarios)
      if (!options?.skipPull) {
        summary.pulledCount = await this.pullRemoteMedia({
          ranchIds: options?.ranchIds
        });
      }

      return summary;
    })().finally(() => {
      activeMediaSyncPromise = null;
    });

    return await activeMediaSyncPromise;
  }
};
