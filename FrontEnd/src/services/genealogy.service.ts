import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { GenealogyRepository } from '../lib/database/repositories/genealogy.repository';
import type { LocalGenealogy } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import {
  GENEALOGY_BACKEND_DEPENDENCY,
  type BackendGenealogiaPayload,
  type GenealogyInput,
  type GenealogyRecord
} from '../types/genealogy';
import { CattleService } from './cattle.service';
import {
  normalizeGenealogyInput,
  validateGenealogyInput,
  type GenealogyValidationErrors
} from './genealogy.validation';

export class GenealogyValidationError extends Error {
  readonly fieldErrors: GenealogyValidationErrors;

  constructor(message: string, fieldErrors: GenealogyValidationErrors) {
    super(message);
    this.name = 'GenealogyValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface GenealogyMutationResult {
  record: GenealogyRecord;
  synced: false;
  syncMessage: string;
}

export interface GenealogyLoadResult {
  records: GenealogyRecord[];
  animals: Cattle[];
  source: 'cache';
  backendNotice: string;
}

function buildPendingSyncMessage(action: 'guardado' | 'actualizado' | 'desactivado'): string {
  const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
  if (!isOnline) {
    return `Sin conexión: el vínculo genealógico fue ${action} localmente en IndexedDB y quedó en cola pendiente.`;
  }
  return `Vínculo genealógico ${action} localmente en IndexedDB (cola pendiente). El Backend aún no expone endpoints para Genealogia, por lo que no se simula sincronización remota.`;
}

export const GenealogyService = {
  toGenealogyRecord(local: LocalGenealogy): GenealogyRecord {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idGenealogia: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId,
      idPadre: local.padreId?.trim() ? local.padreId.trim() : null,
      idMadre: local.madreId?.trim() ? local.madreId.trim() : null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toBackendPayload(idGenealogia: string, input: GenealogyInput): BackendGenealogiaPayload {
    const normalized = normalizeGenealogyInput(input);
    return {
      idGenealogia,
      idAnimal: normalized.idAnimal,
      idPadre: normalized.idPadre,
      idMadre: normalized.idMadre
    };
  },

  /**
   * Hidrata los animales reales desde el endpoint `GET /api/animales` cuando hay
   * conectividad y sesión activa (vía `CattleService.getAll()`), o usa caché local offline.
   */
  async loadAnimals(options?: { preferRemote?: boolean }): Promise<Cattle[]> {
    if (options?.preferRemote) {
      try {
        const result = await CattleService.getAll();
        return result.data;
      } catch {
        // Fallback determinista al caché local
      }
    }

    const localAnimals = await CattleRepository.getAll();
    return localAnimals.map((item) => CattleService.toCattle(item));
  },

  /**
   * Consulta todos los parentescos registrados en IndexedDB y los animales reales del rancho.
   *
   * Dependencia documentada (`GENEALOGY_BACKEND_DEPENDENCY`):
   * - `BackEnd/Data/FarmDbContext.cs` no incluye `Genealogia` y `Animal` no posee `IdPadre`/`IdMadre`.
   * - No se llaman endpoints inexistentes ni se inventan relaciones automáticamente.
   */
  async getAll(options?: { includeDeleted?: boolean }): Promise<GenealogyLoadResult> {
    const [localRecords, animals] = await Promise.all([
      GenealogyRepository.getAllWithOptions(options),
      this.loadAnimals({ preferRemote: true })
    ]);

    return {
      records: localRecords.map((r) => this.toGenealogyRecord(r)),
      animals,
      source: 'cache',
      backendNotice: GENEALOGY_BACKEND_DEPENDENCY.summaryMessage
    };
  },

  async getByCattleId(cattleId: string): Promise<GenealogyRecord | undefined> {
    const local = await GenealogyRepository.getByCattleId(cattleId);
    return local ? this.toGenealogyRecord(local) : undefined;
  },

  async create(rawInput: GenealogyInput): Promise<GenealogyMutationResult> {
    const [animals, existingLocal] = await Promise.all([
      this.loadAnimals(),
      GenealogyRepository.getAllWithOptions({ includeDeleted: false })
    ]);
    const existingRecords = existingLocal.map((r) => this.toGenealogyRecord(r));

    const fieldErrors = validateGenealogyInput(rawInput, {
      animals,
      existingRecords
    });
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos de parentesco.';
      throw new GenealogyValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeGenealogyInput(rawInput);
    const animal = animals.find((a) => a.id === normalized.idAnimal)!;
    const idGenealogia = crypto.randomUUID();
    const payload = this.toBackendPayload(idGenealogia, normalized);

    const createdLocal = await GenealogyRepository.create(
      {
        id: idGenealogia,
        ranchId: animal.idRancho,
        cattleId: animal.id,
        padreId: normalized.idPadre ?? undefined,
        madreId: normalized.idMadre ?? undefined
      },
      payload
    );

    return {
      record: this.toGenealogyRecord(createdLocal),
      synced: false,
      syncMessage: buildPendingSyncMessage('guardado')
    };
  },

  async update(id: string, rawInput: GenealogyInput): Promise<GenealogyMutationResult> {
    const existing = await GenealogyRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El vínculo genealógico que intentas editar no existe o fue desactivado.');
    }

    // `idAnimal` permanece inmutable al editar para evitar duplicados o reasignaciones inconsistentes
    const enforcedInput: GenealogyInput = {
      ...rawInput,
      idAnimal: existing.cattleId
    };

    const [animals, allLocal] = await Promise.all([
      this.loadAnimals(),
      GenealogyRepository.getAllWithOptions({ includeDeleted: false })
    ]);
    const existingRecords = allLocal.map((r) => this.toGenealogyRecord(r));

    const fieldErrors = validateGenealogyInput(enforcedInput, {
      animals,
      existingRecords,
      editingRecordId: existing.id
    });
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos de parentesco.';
      throw new GenealogyValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeGenealogyInput(enforcedInput);
    const idGenealogia = typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const payload = this.toBackendPayload(idGenealogia, normalized);

    const updatedLocal = await GenealogyRepository.update(
      existing.id,
      {
        ranchId: existing.ranchId,
        cattleId: existing.cattleId,
        padreId: normalized.idPadre ?? undefined,
        madreId: normalized.idMadre ?? undefined
      },
      payload
    );

    return {
      record: this.toGenealogyRecord(updatedLocal),
      synced: false,
      syncMessage: buildPendingSyncMessage('actualizado')
    };
  },

  async deactivate(id: string): Promise<{ synced: false; syncMessage: string }> {
    const existing = await GenealogyRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El vínculo genealógico no fue encontrado.');
    }

    await GenealogyRepository.softDelete(existing.id, {
      idGenealogia: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return {
      synced: false,
      syncMessage: buildPendingSyncMessage('desactivado')
    };
  }
};
