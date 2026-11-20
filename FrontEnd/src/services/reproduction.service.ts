import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { ReproductionRepository } from '../lib/database/repositories/reproduction.repository';
import type { LocalReproductionRecord } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import {
  REPRODUCTION_BACKEND_DEPENDENCY,
  type BackendEventoReproductivoPayload,
  type ReproductionEvent,
  type ReproductionEventInput
} from '../types/reproduction';
import { CattleService } from './cattle.service';
import {
  normalizeReproductionInput,
  validateReproductionInput,
  type ReproductionValidationErrors
} from './reproduction.validation';

export class ReproductionValidationError extends Error {
  readonly fieldErrors: ReproductionValidationErrors;

  constructor(message: string, fieldErrors: ReproductionValidationErrors) {
    super(message);
    this.name = 'ReproductionValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface ReproductionMutationResult {
  event: ReproductionEvent;
  synced: false;
  syncMessage: string;
}

export interface ReproductionLoadResult {
  data: ReproductionEvent[];
  animals: Cattle[];
  source: 'cache';
  backendNotice: string;
}

function normalizeDateTimeForStorage(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  return trimmed;
}

function buildPendingSyncMessage(action: 'guardado' | 'actualizado' | 'desactivado'): string {
  const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
  if (!isOnline) {
    return `Sin conexión: el evento reproductivo fue ${action} localmente en IndexedDB y quedó en cola pendiente.`;
  }
  return `Evento reproductivo ${action} localmente en IndexedDB (cola pendiente). El Backend aún no expone endpoints para EventoReproductivo, por lo que no se simula sincronización remota.`;
}

export const ReproductionService = {
  toReproductionEvent(local: LocalReproductionRecord): ReproductionEvent {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idEventoReproductivo: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId,
      tipo: local.evento,
      fecha: local.fecha,
      resultado: local.resultado?.trim() ? local.resultado.trim() : null,
      observaciones: local.observaciones?.trim() ? local.observaciones.trim() : null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toBackendPayload(
    idEventoReproductivo: string,
    input: ReproductionEventInput
  ): BackendEventoReproductivoPayload {
    const normalized = normalizeReproductionInput(input);
    return {
      idEventoReproductivo,
      idAnimal: normalized.idAnimal,
      tipo: normalized.tipo,
      fecha: normalizeDateTimeForStorage(normalized.fecha),
      resultado: normalized.resultado,
      observaciones: normalized.observaciones
    };
  },

  /**
   * Obtiene el catálogo real de animales conectando con el endpoint real `/api/animales`
   * cuando hay red y sesión activa (via `CattleService.getAll()`), o usando el caché
   * local de IndexedDB cuando se trabaja offline.
   */
  async loadAnimals(options?: { preferRemote?: boolean }): Promise<Cattle[]> {
    if (options?.preferRemote) {
      try {
        const cattleResult = await CattleService.getAll();
        return cattleResult.data;
      } catch {
        // Fallback determinista al caché local si la red o la sesión fallan
      }
    }

    const localAnimals = await CattleRepository.getAll();
    return localAnimals.map((item) => CattleService.toCattle(item));
  },

  /**
   * Consulta el historial real de eventos reproductivos desde IndexedDB.
   *
   * Dependencia documentada (`REPRODUCTION_BACKEND_DEPENDENCY`):
   * - `BackEnd/Data/FarmDbContext.cs` no contiene la entidad `EventoReproductivo`.
   * - No existe controlador REST ni soporte en `SincronizacionController` / `SyncController`.
   * - Por ello NO se invocan endpoints inexistentes ni se simula sincronización remota.
   * - Los animales del rancho sí se hidratan desde el endpoint real `GET /api/animales`
   *   cuando hay conectividad y autenticación válida.
   */
  async getAll(options?: {
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<ReproductionLoadResult> {
    const [localRecords, animals] = await Promise.all([
      ReproductionRepository.getAllWithOptions(options),
      this.loadAnimals({ preferRemote: true })
    ]);

    return {
      data: localRecords.map((item) => this.toReproductionEvent(item)),
      animals,
      source: 'cache',
      backendNotice: REPRODUCTION_BACKEND_DEPENDENCY.summaryMessage
    };
  },

  async getById(id: string): Promise<ReproductionEvent | undefined> {
    const local = await ReproductionRepository.getByIdIncludingDeleted(id);
    return local ? this.toReproductionEvent(local) : undefined;
  },

  async create(rawInput: ReproductionEventInput): Promise<ReproductionMutationResult> {
    const animals = await this.loadAnimals();
    const fieldErrors = validateReproductionInput(rawInput, { animals });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del evento reproductivo.';
      throw new ReproductionValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeReproductionInput(rawInput);
    const animal = animals.find((a) => a.id === normalized.idAnimal)!;
    const idEventoReproductivo = crypto.randomUUID();
    const fechaIso = normalizeDateTimeForStorage(normalized.fecha);
    const payload = this.toBackendPayload(idEventoReproductivo, rawInput);

    const createdLocal = await ReproductionRepository.create(
      {
        id: idEventoReproductivo,
        ranchId: animal.idRancho,
        cattleId: animal.id,
        evento: normalized.tipo,
        fecha: fechaIso,
        resultado: normalized.resultado,
        observaciones: normalized.observaciones ?? undefined
      },
      payload
    );

    return {
      event: this.toReproductionEvent(createdLocal),
      synced: false,
      syncMessage: buildPendingSyncMessage('guardado')
    };
  },

  async update(id: string, rawInput: ReproductionEventInput): Promise<ReproductionMutationResult> {
    const existing = await ReproductionRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El evento reproductivo que intentas editar no existe o fue desactivado.');
    }

    // `idAnimal` permanece inmutable en edición para conservar la integridad del expediente
    const enforcedInput: ReproductionEventInput = {
      ...rawInput,
      idAnimal: existing.cattleId
    };

    const animals = await this.loadAnimals();
    const fieldErrors = validateReproductionInput(enforcedInput, { animals });

    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del evento reproductivo.';
      throw new ReproductionValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeReproductionInput(enforcedInput);
    const idEventoReproductivo =
      typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const fechaIso = normalizeDateTimeForStorage(normalized.fecha);
    const payload = this.toBackendPayload(idEventoReproductivo, enforcedInput);

    const updatedLocal = await ReproductionRepository.update(
      existing.id,
      {
        ranchId: existing.ranchId,
        cattleId: existing.cattleId,
        evento: normalized.tipo,
        fecha: fechaIso,
        resultado: normalized.resultado,
        observaciones: normalized.observaciones ?? undefined
      },
      payload
    );

    return {
      event: this.toReproductionEvent(updatedLocal),
      synced: false,
      syncMessage: buildPendingSyncMessage('actualizado')
    };
  },

  async deactivate(id: string): Promise<{ synced: false; syncMessage: string }> {
    const existing = await ReproductionRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El evento reproductivo no fue encontrado.');
    }

    await ReproductionRepository.softDelete(existing.id, {
      idEventoReproductivo: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return {
      synced: false,
      syncMessage: buildPendingSyncMessage('desactivado')
    };
  }
};
