import { ApiError, hasActiveAuthSession, mediaApi } from '../../lib/api';
import { db } from '../../lib/database/db';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import type { LocalMedia } from '../../lib/database/schema';
import type { BackendArchivoMultimediaDto } from '../../types/media';

export interface MediaSyncSummary {
  uploadedCount: number;
  deletedCount: number;
  pulledCount: number;
  errorCount: number;
}

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

async function markMediaOutboxConfirmed(mediaId: string, operationType?: 'CREATE' | 'DELETE'): Promise<void> {
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

async function uploadLocalMediaItem(item: LocalMedia): Promise<boolean> {
  if (!item.blobData || item.deletedAt) {
    return false;
  }

  const now = new Date().toISOString();
  await db.media.update(item.id, {
    estadoArchivo: 'subiendo',
    updatedAt: now
  });

  const fileExtension = (item.mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const fileName = item.nombreArchivo || `${item.tipo.toLowerCase()}_${item.id}.${fileExtension}`;
  const uploadBlob = await ensureUploadableBlob(item.blobData, item.mimeType);
  const formData = new FormData();
  formData.append('archivo', uploadBlob, fileName);
  formData.append('idArchivo', item.id);
  if (item.ranchId) formData.append('idRancho', item.ranchId);
  if (item.cattleId) formData.append('idAnimal', item.cattleId);
  formData.append('entidadRelacionada', item.entidadRelacionada || 'cattle');
  if (item.idEntidadRelacionada) formData.append('idEntidadRelacionada', item.idEntidadRelacionada);
  formData.append('tipo', item.tipo);
  formData.append('nombreArchivo', fileName);
  if (item.checksumSha256) formData.append('checksumSha256', item.checksumSha256);
  if (item.fechaCaptura) formData.append('fechaCaptura', item.fechaCaptura);

  try {
    const uploaded: BackendArchivoMultimediaDto = await mediaApi.upload(formData);
    await db.transaction('rw', [db.media, db.outbox], async () => {
      await db.media.update(item.id, {
        remoteId: uploaded.idArchivo,
        ranchId: uploaded.idRancho,
        urlRemota: uploaded.urlPublica,
        estadoArchivo: 'subido',
        syncStatus: 'synced',
        serverVersion: uploaded.versionRegistro ?? 1,
        ultimoErrorSubida: null,
        updatedAt: new Date().toISOString()
      });
      await markMediaOutboxConfirmed(item.id, 'CREATE');
    });
    return true;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Error al subir la fotografía al servidor.';
    const isPermanent =
      err instanceof ApiError &&
      (err.status === 400 || err.status === 403 || err.status === 409 || err.status === 413);

    await db.transaction('rw', [db.media, db.outbox], async () => {
      await db.media.update(item.id, {
        estadoArchivo: 'error_subida',
        intentosSubida: (item.intentosSubida ?? 0) + 1,
        ultimoErrorSubida: message,
        syncStatus: isPermanent ? 'error' : 'pending',
        updatedAt: new Date().toISOString()
      });

      const ops = await OutboxRepository.getByEntity('media', item.id);
      for (const op of ops) {
        if (op.tipoOperacion === 'CREATE' && op.estado !== 'confirmado') {
          await db.outbox.update(op.idOperacion, {
            estado: isPermanent ? 'fallido' : 'pendiente',
            intentos: op.intentos + 1,
            ultimoError: message,
            proximoIntento: isPermanent ? null : new Date(Date.now() + 15000).toISOString()
          });
        }
      }
    });
    return false;
  }
}

export const MediaSyncEngine = {
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
    if (item.estadoArchivo === 'subido' && item.urlRemota) {
      await markMediaOutboxConfirmed(mediaId, 'CREATE');
      return { synced: true };
    }

    const ok = await uploadLocalMediaItem(item);
    const refreshed = await db.media.get(mediaId);
    return {
      synced: ok,
      error: refreshed?.ultimoErrorSubida ?? undefined
    };
  },

  async pullRemoteMedia(options?: { cattleId?: string }): Promise<number> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
    if (!hasActiveAuthSession()) return 0;

    try {
      const remoteList = await mediaApi.list({
        idAnimal: options?.cattleId,
        incluirEliminados: false
      });
      if (remoteList.length === 0) return 0;

      const now = new Date().toISOString();
      let applied = 0;

      await db.transaction('rw', [db.media], async () => {
        for (const remote of remoteList) {
          const existing =
            (await db.media.where('remoteId').equals(remote.idArchivo).first()) ??
            (await db.media.get(remote.idArchivo));

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
            tamanoBytes: remote.tamanoBytes,
            checksumSha256: remote.checksumSha256 ?? existing?.checksumSha256 ?? null,
            blobData: existing?.blobData,
            urlRemota: remote.urlPublica,
            idOperacionSubida: existing?.idOperacionSubida ?? null,
            estadoArchivo: 'subido',
            intentosSubida: existing?.intentosSubida ?? 0,
            ultimoErrorSubida: null,
            fechaCaptura: remote.fechaCaptura || existing?.fechaCaptura || now,
            createdAt: remote.creadoEn || existing?.createdAt || now,
            updatedAt: now,
            syncStatus: 'synced',
            serverVersion: remote.versionRegistro ?? 1,
            deletedAt: remote.eliminadoEn ?? null
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

  async syncPendingMedia(): Promise<MediaSyncSummary> {
    if (activeMediaSyncPromise) {
      return await activeMediaSyncPromise;
    }

    activeMediaSyncPromise = (async (): Promise<MediaSyncSummary> => {
      const summary: MediaSyncSummary = {
        uploadedCount: 0,
        deletedCount: 0,
        pulledCount: 0,
        errorCount: 0
      };

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return summary;
      }
      if (!hasActiveAuthSession()) {
        return summary;
      }

      // 1. Subir archivos pendientes (FotoPerfil, BoviScaleVision, Documento)
      const pendingMedia = await db.media
        .where('estadoArchivo')
        .anyOf('pendiente_subida', 'error_subida')
        .filter((m) => !m.deletedAt && Boolean(m.blobData))
        .toArray();

      for (const item of pendingMedia) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        const ok = await uploadLocalMediaItem(item);
        if (ok) {
          summary.uploadedCount++;
        } else {
          summary.errorCount++;
        }
      }

      // 2. Sincronizar bajas de archivos multimedia en cola
      const mediaDeleteOps = await db.outbox
        .where('entidad')
        .equals('media')
        .filter((op) => op.tipoOperacion === 'DELETE' && op.estado !== 'confirmado')
        .toArray();

      for (const op of mediaDeleteOps) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        const local = await db.media.get(op.idEntidad);
        const remoteId = typeof local?.remoteId === 'string' ? local.remoteId : null;

        if (!remoteId) {
          await OutboxRepository.discardOperation(op.idOperacion);
          continue;
        }

        try {
          await mediaApi.remove(remoteId);
          await db.transaction('rw', [db.media, db.outbox], async () => {
            await markMediaOutboxConfirmed(op.idEntidad, 'DELETE');
            if (local) {
              await db.media.update(local.id, { syncStatus: 'synced' });
            }
          });
          summary.deletedCount++;
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            await markMediaOutboxConfirmed(op.idEntidad, 'DELETE');
            if (local) {
              await db.media.update(local.id, { syncStatus: 'synced' });
            }
            summary.deletedCount++;
          } else {
            summary.errorCount++;
          }
        }
      }

      // 3. Descargar referencias remotas (solo metadatos + URL pública)
      summary.pulledCount = await this.pullRemoteMedia();

      return summary;
    })().finally(() => {
      activeMediaSyncPromise = null;
    });

    return await activeMediaSyncPromise;
  }
};
