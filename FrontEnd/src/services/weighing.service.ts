import { hasActiveAuthSession } from '../lib/api';
import { db } from '../lib/database/db';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { WeighingRepository } from '../lib/database/repositories/weighing.repository';
import type { LocalWeighing } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import type {
  BackendPesajePayload,
  EstimacionPesoBoviScaleDto,
  Weighing,
  WeighingInput
} from '../types/weighing';
import { CattleService } from './cattle.service';
import {
  normalizeWeighingInput,
  validateWeighingInput,
  type WeighingValidationErrors
} from './weighing.validation';
import { PushSyncEngine } from './sync/push-sync.engine';

export class WeighingValidationError extends Error {
  readonly fieldErrors: WeighingValidationErrors;

  constructor(message: string, fieldErrors: WeighingValidationErrors) {
    super(message);
    this.name = 'WeighingValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface WeighingMutationResult {
  weighing: Weighing;
  synced: boolean;
  syncMessage?: string;
}

export interface WeighingLoadResult {
  data: Weighing[];
  animals: Cattle[];
  source: 'cache';
  backendNotice: string | null;
}

export interface BoviScaleReference {
  hasWeight: boolean;
  pesoKg: number | null;
  fecha: string | null;
  confianzaModelo: number | null;
  sourceLabel: string | null;
  hasPhotoWithoutWeight: boolean;
  photoCount: number;
}

function normalizeDateTimeForBackend(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  return trimmed;
}

export const WeighingService = {
  toWeighing(local: LocalWeighing): Weighing {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idPesaje: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId,
      pesoRealKg: local.peso,
      fecha: local.fecha,
      fuenteBascula: local.fuenteBascula || 'Báscula registrada en campo',
      responsable: local.responsable || 'No especificado',
      observaciones: local.observaciones?.trim() ? local.observaciones : null,
      origenPesaje: local.origenPesaje === 'boviscale_ia' ? 'boviscale_ia' : 'manual',
      sourceAnalysisJobId: local.sourceAnalysisJobId ?? null,
      sourceMediaId: local.sourceMediaId ?? null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toBackendPayload(idPesaje: string, input: WeighingInput): BackendPesajePayload {
    const normalized = normalizeWeighingInput(input);
    return {
      idPesaje,
      idAnimal: normalized.idAnimal,
      pesoRealKg: normalized.pesoRealKg,
      fecha: normalizeDateTimeForBackend(normalized.fecha),
      fuenteBascula: normalized.fuenteBascula,
      responsable: normalized.responsable,
      observaciones: normalized.observaciones
    };
  },

  async loadAnimals(): Promise<Cattle[]> {
    const localAnimals = await CattleRepository.getAll();
    return localAnimals.map((item) => CattleService.toCattle(item));
  },

  /**
   * Consulta el historial real de pesajes desde IndexedDB.
   * Los pesajes se sincronizan con el servidor mediante Push (`/api/sync/operaciones`)
   * y Pull (`/api/sync/cambios?entidad=weighings`) usando la entidad `Pesaje`.
   */
  async getAll(options?: {
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<WeighingLoadResult> {
    const [localWeighings, animals] = await Promise.all([
      WeighingRepository.getAllWithOptions(options),
      this.loadAnimals()
    ]);

    return {
      data: localWeighings.map((item) => this.toWeighing(item)),
      animals,
      source: 'cache',
      backendNotice: null
    };
  },

  async getById(id: string): Promise<Weighing | undefined> {
    const local = await WeighingRepository.getByIdIncludingDeleted(id);
    return local ? this.toWeighing(local) : undefined;
  },

  /**
   * Reutiliza el repositorio de pesajes para registrar en el historial local un pesaje
   * ya persistido en el backend .NET por el flujo de BoviScale IA.
   */
  async recordConfirmedBoviScaleWeighing(
    dto: EstimacionPesoBoviScaleDto
  ): Promise<{ local: LocalWeighing; weighing: Weighing }> {
    const local = await WeighingRepository.upsertConfirmedFromBoviScale(dto);
    return { local, weighing: this.toWeighing(local) };
  },

  /**
   * Busca el último dato de pesaje registrado en BoviScale para un bovino
   * (desde trabajos de análisis BoviScale o pesajes con origen `boviscale_ia`),
   * o informa si solo tiene capturas fotográficas sin peso estimado todavía.
   */
  async getLatestBoviScaleReference(cattleId: string): Promise<BoviScaleReference> {
    if (!cattleId) {
      return {
        hasWeight: false,
        pesoKg: null,
        fecha: null,
        confianzaModelo: null,
        sourceLabel: null,
        hasPhotoWithoutWeight: false,
        photoCount: 0
      };
    }

    const [jobs, boviScaleWeighings, boviScalePhotos] = await Promise.all([
      db.weighingAnalysisJobs
        .where('idBovino')
        .equals(cattleId)
        .filter((j) => j.estado !== 'cancelado')
        .toArray(),
      db.weighings
        .where('cattleId')
        .equals(cattleId)
        .filter((w) => !w.deletedAt && w.origenPesaje === 'boviscale_ia')
        .toArray(),
      db.media
        .where('cattleId')
        .equals(cattleId)
        .filter((m) => !m.deletedAt && m.tipo === 'BoviScaleVision')
        .toArray()
    ]);

    const jobsWithWeight = jobs
      .map((j) => ({
        pesoKg: j.pesoConfirmadoKg ?? j.pesoEstimadoKg ?? null,
        fecha: j.completadoEn || j.analizadoEn || j.fechaCreacion,
        confianzaModelo: j.confianzaModelo ?? null,
        sourceLabel:
          j.pesoConfirmadoKg != null ? 'Pesaje BoviScale confirmado' : 'Estimación BoviScale'
      }))
      .filter((j): j is { pesoKg: number; fecha: string; confianzaModelo: number | null; sourceLabel: string } =>
        typeof j.pesoKg === 'number' && Number.isFinite(j.pesoKg) && j.pesoKg > 0
      )
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    const weighingsSorted = boviScaleWeighings
      .filter((w) => typeof w.peso === 'number' && Number.isFinite(w.peso) && w.peso > 0)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    const latestJob = jobsWithWeight[0];
    const latestWeighing = weighingsSorted[0];

    if (latestJob && (!latestWeighing || latestJob.fecha >= latestWeighing.fecha)) {
      return {
        hasWeight: true,
        pesoKg: latestJob.pesoKg,
        fecha: latestJob.fecha,
        confianzaModelo: latestJob.confianzaModelo,
        sourceLabel: latestJob.sourceLabel,
        hasPhotoWithoutWeight: false,
        photoCount: boviScalePhotos.length
      };
    }

    if (latestWeighing) {
      return {
        hasWeight: true,
        pesoKg: latestWeighing.peso,
        fecha: latestWeighing.fecha,
        confianzaModelo: null,
        sourceLabel: 'Pesaje registrado en BoviScale',
        hasPhotoWithoutWeight: false,
        photoCount: boviScalePhotos.length
      };
    }

    return {
      hasWeight: false,
      pesoKg: null,
      fecha: null,
      confianzaModelo: null,
      sourceLabel: null,
      hasPhotoWithoutWeight: boviScalePhotos.length > 0,
      photoCount: boviScalePhotos.length
    };
  },

  async attemptPushForEntity(idEntidad: string): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage:
          'Sin conexión: el pesaje se guardó localmente en IndexedDB y se sincronizará al recuperar Internet.'
      };
    }

    if (!hasActiveAuthSession()) {
      return {
        synced: false,
        syncMessage:
          'Guardado localmente en IndexedDB. Inicia sesión para sincronizar este pesaje con el servidor.'
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const ops = await OutboxRepository.getByEntity('weighings', idEntidad);
    const latestOp = ops[ops.length - 1];
    if (!latestOp || latestOp.estado === 'confirmado') {
      return { synced: true };
    }

    if (latestOp.estado === 'conflicto') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'Se detectó un conflicto de versión con el servidor. Revísalo en el Centro de Sincronización.'
      };
    }

    if (latestOp.estado === 'fallido') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'El pesaje se guardó localmente, pero el servidor reportó un error al sincronizarlo.'
      };
    }

    return {
      synced: false,
      syncMessage:
        latestOp.ultimoError ||
        'Pesaje guardado localmente y en cola de sincronización pendiente.'
    };
  },

  async create(rawInput: WeighingInput): Promise<WeighingMutationResult> {
    const animals = await this.loadAnimals();
    const fieldErrors = validateWeighingInput(rawInput, { animals });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del pesaje.';
      throw new WeighingValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeWeighingInput(rawInput);
    const animal = animals.find((a) => a.id === normalized.idAnimal)!;
    const idPesaje = crypto.randomUUID();
    const fechaIso = normalizeDateTimeForBackend(normalized.fecha);
    const payload = this.toBackendPayload(idPesaje, rawInput);

    const createdLocal = await WeighingRepository.create(
      {
        id: idPesaje,
        ranchId: animal.idRancho,
        cattleId: animal.id,
        peso: normalized.pesoRealKg,
        fecha: fechaIso,
        fuenteBascula: normalized.fuenteBascula,
        responsable: normalized.responsable,
        observaciones: normalized.observaciones ?? undefined,
        origenPesaje: 'manual',
        sourceAnalysisJobId: null,
        sourceMediaId: null
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(createdLocal.id);
    const refreshed =
      (await WeighingRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      weighing: this.toWeighing(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async update(id: string, rawInput: WeighingInput): Promise<WeighingMutationResult> {
    const existing = await WeighingRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El pesaje que intentas editar no existe o fue desactivado.');
    }

    // `idAnimal` permanece inmutable en edición para conservar la integridad del expediente
    const enforcedInput: WeighingInput = {
      ...rawInput,
      idAnimal: existing.cattleId
    };

    const animals = await this.loadAnimals();
    const fieldErrors = validateWeighingInput(enforcedInput, { animals });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del pesaje.';
      throw new WeighingValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeWeighingInput(enforcedInput);
    const idPesaje = typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const fechaIso = normalizeDateTimeForBackend(normalized.fecha);
    const payload = this.toBackendPayload(idPesaje, enforcedInput);

    const updatedLocal = await WeighingRepository.update(
      existing.id,
      {
        ranchId: existing.ranchId,
        cattleId: existing.cattleId,
        peso: normalized.pesoRealKg,
        fecha: fechaIso,
        fuenteBascula: normalized.fuenteBascula,
        responsable: normalized.responsable,
        observaciones: normalized.observaciones ?? undefined
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(updatedLocal.id);
    const refreshed =
      (await WeighingRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      weighing: this.toWeighing(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async deactivate(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await WeighingRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El pesaje no fue encontrado.');
    }

    await WeighingRepository.softDelete(existing.id, {
      idPesaje: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity(existing.id);
  }
};
