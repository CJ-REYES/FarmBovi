import { ApiError, genealogyApi } from '../lib/api';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { GenealogyRepository } from '../lib/database/repositories/genealogy.repository';
import type { LocalGenealogy } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import type {
  ActualizarGenealogiaRequest,
  AnimalGenealogyProfile,
  DescendientesAnimalResponse,
  GenealogiaRegistroDto,
  GenealogyInput,
  GenealogyRecord,
  PadresAnimalResponse,
  RegistrarGenealogiaRequest
} from '../types/genealogy';
import { CattleService } from './cattle.service';
import {
  buildAnimalGenealogyProfile,
  buildGenealogyProfileFromServer,
  cattleToSummaryDto,
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
  synced: boolean;
  syncMessage: string;
}

export interface GenealogyLoadResult {
  records: GenealogyRecord[];
  animals: Cattle[];
  source: 'server' | 'cache';
  warning: string | null;
}

export interface GenealogyParentsResult {
  data: PadresAnimalResponse;
  source: 'server' | 'cache';
  warning: string | null;
}

export interface GenealogyDescendantsResult {
  data: DescendientesAnimalResponse;
  source: 'server' | 'cache';
  warning: string | null;
}

export interface GenealogyTreeResult {
  profile: AnimalGenealogyProfile;
  parents: PadresAnimalResponse;
  descendants: DescendientesAnimalResponse;
  source: 'server' | 'cache';
  warning: string | null;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function isNetworkOrConnectivityFailure(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 0;
  }
  return err instanceof TypeError || (err instanceof Error && /network|fetch|conexión/i.test(err.message));
}

function extractProblemDetailMessage(err: ApiError, fallback: string): string {
  if (err.data && typeof err.data === 'object') {
    const record = err.data as Record<string, unknown>;
    if (typeof record.detail === 'string' && record.detail.trim().length > 0) {
      return record.detail.trim();
    }
    if (typeof record.mensaje === 'string' && record.mensaje.trim().length > 0) {
      return record.mensaje.trim();
    }
    if (record.errors && typeof record.errors === 'object') {
      const values = Object.values(record.errors as Record<string, unknown>)
        .flatMap((v) => (Array.isArray(v) ? v : [v]))
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
      if (values.length > 0) return values[0];
    }
  }
  return err.message || fallback;
}

function buildLocalOfflineMessage(action: 'guardado' | 'actualizado' | 'desactivado'): string {
  return `Sin conexión con el servidor: el vínculo genealógico fue ${action} localmente en IndexedDB y quedó en cola pendiente.`;
}

function resolveVersionNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && !Number.isNaN(Number(value)) && Number(value) >= 1) {
    return Math.trunc(Number(value));
  }
  return 1;
}

async function persistParentsResponseToCache(response: PadresAnimalResponse): Promise<void> {
  const ranchId = response.animal.idRancho;
  const childId = response.animal.idAnimal;
  const existingDirect = await GenealogyRepository.getByCattleId(childId);

  if (response.padre || response.madre || response.idGenealogia) {
    if (!existingDirect || existingDirect.syncStatus === 'synced') {
      await GenealogyRepository.upsertConfirmedFromServer({
        idGenealogia: response.idGenealogia ?? existingDirect?.id ?? crypto.randomUUID(),
        idAnimal: childId,
        idPadre: response.padre?.idAnimal ?? null,
        idMadre: response.madre?.idAnimal ?? null,
        observaciones: response.observaciones ?? null,
        ranchId,
        versionRegistro: response.versionRegistro ?? resolveVersionNumber(existingDirect?.serverVersion)
      });
    }
  } else if (existingDirect && existingDirect.syncStatus === 'synced') {
    await GenealogyRepository.markDeletedFromServer(childId);
  }

  // Persistir también relaciones de ancestros (generación >= 2) para consulta offline del árbol
  const groupedByChild = new Map<string, { padreId: string | null; madreId: string | null }>();
  for (const anc of response.ancestros) {
    if (anc.generacion < 2) continue;
    const entry = groupedByChild.get(anc.idHijo) ?? { padreId: null, madreId: null };
    if (anc.vinculo.toLowerCase() === 'padre') {
      entry.padreId = anc.animal.idAnimal;
    } else if (anc.vinculo.toLowerCase() === 'madre') {
      entry.madreId = anc.animal.idAnimal;
    }
    groupedByChild.set(anc.idHijo, entry);
  }

  for (const [ancChildId, rel] of groupedByChild.entries()) {
    const existing = await GenealogyRepository.getByCattleId(ancChildId);
    if (existing && existing.syncStatus !== 'synced') continue;
    await GenealogyRepository.upsertConfirmedFromServer({
      idGenealogia:
        typeof existing?.remoteId === 'string' ? existing.remoteId : existing?.id ?? crypto.randomUUID(),
      idAnimal: ancChildId,
      idPadre: rel.padreId ?? existing?.padreId ?? null,
      idMadre: rel.madreId ?? existing?.madreId ?? null,
      observaciones: existing?.observaciones ?? null,
      ranchId,
      versionRegistro: resolveVersionNumber(existing?.serverVersion)
    });
  }
}

async function persistDescendantsResponseToCache(response: DescendientesAnimalResponse): Promise<void> {
  for (const item of response.descendientes) {
    const desc = item.descendiente;
    if (!desc.idPadre && !desc.idMadre) continue;

    const existing = await GenealogyRepository.getByCattleId(desc.idAnimal);
    if (existing && existing.syncStatus !== 'synced') continue;

    await GenealogyRepository.upsertConfirmedFromServer({
      idGenealogia:
        typeof existing?.remoteId === 'string' ? existing.remoteId : existing?.id ?? crypto.randomUUID(),
      idAnimal: desc.idAnimal,
      idPadre: desc.idPadre,
      idMadre: desc.idMadre,
      observaciones: existing?.observaciones ?? null,
      ranchId: desc.idRancho,
      versionRegistro: resolveVersionNumber(existing?.serverVersion)
    });
  }
}

export const GenealogyService = {
  toGenealogyRecord(local: LocalGenealogy): GenealogyRecord {
    return {
      id: local.id,
      idGenealogia: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId,
      idPadre: local.padreId?.trim() ? local.padreId.trim() : null,
      idMadre: local.madreId?.trim() ? local.madreId.trim() : null,
      observaciones: local.observaciones ?? null,
      versionRegistro: resolveVersionNumber(local.serverVersion),
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toRegisterRequest(input: GenealogyInput): RegistrarGenealogiaRequest {
    const normalized = normalizeGenealogyInput(input);
    return {
      idAnimal: normalized.idAnimal,
      idPadre: normalized.idPadre,
      idMadre: normalized.idMadre,
      observaciones: normalized.observaciones
    };
  },

  toUpdateRequest(input: GenealogyInput, versionRegistro: number): ActualizarGenealogiaRequest {
    const normalized = normalizeGenealogyInput(input);
    return {
      idPadre: normalized.idPadre,
      idMadre: normalized.idMadre,
      observaciones: normalized.observaciones,
      versionRegistro
    };
  },

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
   * Consulta todos los parentescos desde el servidor (`GET /api/genealogia`) como fuente de verdad
   * cuando hay conexión, reconcilia la copia local en IndexedDB para consulta offline, y hace
   * fallback limpio al caché local cuando no hay conectividad.
   */
  async getAll(options?: {
    includeDeleted?: boolean;
    idRancho?: string;
  }): Promise<GenealogyLoadResult> {
    const animals = await this.loadAnimals({ preferRemote: true });
    const ranchByAnimal = new Map<string, string>();
    for (const a of animals) {
      if (a.idRancho) ranchByAnimal.set(a.id, a.idRancho);
    }

    let source: 'server' | 'cache' = 'cache';
    let warning: string | null = null;

    if (isOnline()) {
      try {
        const remoteList = await genealogyApi.list({
          idRancho: options?.idRancho,
          incluirEliminados: Boolean(options?.includeDeleted)
        });

        await GenealogyRepository.reconcileServerSnapshot(
          remoteList.map((dto) => ({
            idGenealogia: dto.idGenealogia,
            idAnimal: dto.idAnimal,
            idPadre: dto.idPadre,
            idMadre: dto.idMadre,
            observaciones: dto.observaciones ?? null,
            ranchId: ranchByAnimal.get(dto.idAnimal),
            createdAt: dto.creadoEn,
            versionRegistro: dto.versionRegistro
          })),
          {
            scopedRanchId: options?.idRancho,
            includeDeleted: Boolean(options?.includeDeleted)
          }
        );

        source = 'server';
      } catch (err) {
        if (err instanceof ApiError && err.status === 403 && options?.idRancho) {
          throw new ApiError(
            extractProblemDetailMessage(err, 'No tienes permisos sobre el rancho solicitado.'),
            403,
            err.data
          );
        }
        if (err instanceof ApiError && err.status === 401) {
          warning =
            'Sesión no autenticada en el servidor (401). Mostrando registros de genealogía guardados localmente.';
        } else if (err instanceof ApiError && err.status === 403) {
          warning = extractProblemDetailMessage(
            err,
            'Sin permisos para consultar genealogía en el servidor (403). Mostrando copia local.'
          );
        } else {
          warning =
            err instanceof Error
              ? `${err.message} Mostrando genealogía guardada localmente en IndexedDB.`
              : 'No se pudo consultar el servidor. Mostrando genealogía local.';
        }
      }
    }

    const localRecords = await GenealogyRepository.getAllWithOptions({
      includeDeleted: options?.includeDeleted
    });
    const scopedRecords = options?.idRancho
      ? localRecords.filter((r) => !r.ranchId || r.ranchId === options.idRancho)
      : localRecords;

    return {
      records: scopedRecords.map((r) => this.toGenealogyRecord(r)),
      animals,
      source,
      warning
    };
  },

  async getById(idGenealogia: string): Promise<GenealogyRecord | undefined> {
    if (isOnline()) {
      try {
        const dto = await genealogyApi.getById(idGenealogia);
        const animal = await CattleRepository.getByIdIncludingDeleted(dto.idAnimal);
        const saved = await GenealogyRepository.upsertConfirmedFromServer({
          idGenealogia: dto.idGenealogia,
          idAnimal: dto.idAnimal,
          idPadre: dto.idPadre,
          idMadre: dto.idMadre,
          observaciones: dto.observaciones ?? null,
          ranchId: animal?.ranchId,
          createdAt: dto.creadoEn,
          versionRegistro: dto.versionRegistro
        });
        return this.toGenealogyRecord(saved);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          throw new ApiError(extractProblemDetailMessage(err, err.message), err.status, err.data);
        }
        if (!isNetworkOrConnectivityFailure(err)) {
          throw err;
        }
      }
    }

    const local = await GenealogyRepository.getByIdIncludingDeleted(idGenealogia);
    return local ? this.toGenealogyRecord(local) : undefined;
  },

  async getByCattleId(cattleId: string): Promise<GenealogyRecord | undefined> {
    const local = await GenealogyRepository.getByCattleId(cattleId);
    return local ? this.toGenealogyRecord(local) : undefined;
  },

  /**
   * Consulta padre, madre y ancestros de un animal contra `GET /api/genealogia/{idAnimal}/padres`,
   * persiste en IndexedDB para uso offline y hace fallback a caché únicamente ante falta de red.
   */
  async getParents(
    idAnimal: string,
    options?: { profundidad?: number; animals?: Cattle[] }
  ): Promise<GenealogyParentsResult> {
    const profundidad = Math.min(10, Math.max(1, Math.trunc(options?.profundidad ?? 3)));

    if (isOnline()) {
      try {
        const data = await genealogyApi.getParents(idAnimal, profundidad);
        await persistParentsResponseToCache(data);
        return { data, source: 'server', warning: null };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 400 || err.status === 403 || err.status === 404)) {
          throw new ApiError(extractProblemDetailMessage(err, err.message), err.status, err.data);
        }
        if (!isNetworkOrConnectivityFailure(err) && !(err instanceof ApiError && err.status === 401)) {
          throw err;
        }
        const fallback = await this.buildOfflineParentsResponse(idAnimal, profundidad, options?.animals);
        if (!fallback) throw err;
        return {
          data: fallback,
          source: 'cache',
          warning:
            err instanceof Error
              ? `${err.message} Mostrando progenitores desde el caché local.`
              : 'Mostrando progenitores desde el caché local.'
        };
      }
    }

    const fallback = await this.buildOfflineParentsResponse(idAnimal, profundidad, options?.animals);
    if (!fallback) {
      throw new Error('No se encontró el animal en el caché local para consultar sus padres.');
    }
    return { data: fallback, source: 'cache', warning: null };
  },

  /**
   * Consulta descendientes de un animal contra `GET /api/genealogia/{idAnimal}/descendientes`,
   * persiste en IndexedDB para uso offline y hace fallback a caché únicamente ante falta de red.
   */
  async getDescendants(
    idAnimal: string,
    options?: { profundidad?: number; animals?: Cattle[] }
  ): Promise<GenealogyDescendantsResult> {
    const profundidad = Math.min(10, Math.max(1, Math.trunc(options?.profundidad ?? 3)));

    if (isOnline()) {
      try {
        const data = await genealogyApi.getDescendants(idAnimal, profundidad);
        await persistDescendantsResponseToCache(data);
        return { data, source: 'server', warning: null };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 400 || err.status === 403 || err.status === 404)) {
          throw new ApiError(extractProblemDetailMessage(err, err.message), err.status, err.data);
        }
        if (!isNetworkOrConnectivityFailure(err) && !(err instanceof ApiError && err.status === 401)) {
          throw err;
        }
        const fallback = await this.buildOfflineDescendantsResponse(
          idAnimal,
          profundidad,
          options?.animals
        );
        if (!fallback) throw err;
        return {
          data: fallback,
          source: 'cache',
          warning:
            err instanceof Error
              ? `${err.message} Mostrando descendientes desde el caché local.`
              : 'Mostrando descendientes desde el caché local.'
        };
      }
    }

    const fallback = await this.buildOfflineDescendantsResponse(
      idAnimal,
      profundidad,
      options?.animals
    );
    if (!fallback) {
      throw new Error('No se encontró el animal en el caché local para consultar sus descendientes.');
    }
    return { data: fallback, source: 'cache', warning: null };
  },

  /**
   * Consulta el árbol genealógico completo de un animal combinando `/padres` y `/descendientes`
   * desde el servidor (o caché local si está offline).
   */
  async getAnimalTree(
    idAnimal: string,
    options?: { profundidad?: number; animals?: Cattle[] }
  ): Promise<GenealogyTreeResult> {
    const profundidad = Math.min(10, Math.max(1, Math.trunc(options?.profundidad ?? 3)));
    const animals = options?.animals ?? (await this.loadAnimals());

    const [parentsRes, descendantsRes, localRec] = await Promise.all([
      this.getParents(idAnimal, { profundidad, animals }),
      this.getDescendants(idAnimal, { profundidad, animals }),
      GenealogyRepository.getByCattleId(idAnimal)
    ]);

    const profile = buildGenealogyProfileFromServer({
      parentsResponse: parentsRes.data,
      descendantsResponse: descendantsRes.data,
      animals,
      localRecord: localRec ? this.toGenealogyRecord(localRec) : null
    });

    const source: 'server' | 'cache' =
      parentsRes.source === 'server' && descendantsRes.source === 'server' ? 'server' : 'cache';
    const warning = parentsRes.warning ?? descendantsRes.warning;

    return {
      profile,
      parents: parentsRes.data,
      descendants: descendantsRes.data,
      source,
      warning
    };
  },

  async buildOfflineParentsResponse(
    idAnimal: string,
    profundidad: number,
    providedAnimals?: Cattle[]
  ): Promise<PadresAnimalResponse | null> {
    const [animals, localRecords] = await Promise.all([
      providedAnimals ? Promise.resolve(providedAnimals) : this.loadAnimals(),
      GenealogyRepository.getAllWithOptions({ includeDeleted: false })
    ]);
    const records = localRecords.map((r) => this.toGenealogyRecord(r));
    const profile = buildAnimalGenealogyProfile(idAnimal, animals, records, profundidad);
    if (!profile) return null;

    return {
      animal: cattleToSummaryDto(profile.animal),
      padre: profile.padre ? cattleToSummaryDto(profile.padre) : null,
      madre: profile.madre ? cattleToSummaryDto(profile.madre) : null,
      observaciones: profile.observaciones,
      ancestros: profile.ancestros,
      idGenealogia: profile.record?.idGenealogia ?? null,
      versionRegistro: profile.record?.versionRegistro ?? null
    };
  },

  async buildOfflineDescendantsResponse(
    idAnimal: string,
    profundidad: number,
    providedAnimals?: Cattle[]
  ): Promise<DescendientesAnimalResponse | null> {
    const [animals, localRecords] = await Promise.all([
      providedAnimals ? Promise.resolve(providedAnimals) : this.loadAnimals(),
      GenealogyRepository.getAllWithOptions({ includeDeleted: false })
    ]);
    const records = localRecords.map((r) => this.toGenealogyRecord(r));
    const profile = buildAnimalGenealogyProfile(idAnimal, animals, records, profundidad);
    if (!profile) return null;

    return {
      animal: cattleToSummaryDto(profile.animal),
      totalDescendientes: profile.totalDescendientes,
      descendientes: profile.descendientesMultigeneracion
    };
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
    const registerRequest = this.toRegisterRequest(normalized);

    if (isOnline()) {
      try {
        const dto: GenealogiaRegistroDto = await genealogyApi.register(registerRequest);
        const persisted = await GenealogyRepository.upsertConfirmedFromServer({
          idGenealogia: dto.idGenealogia,
          idAnimal: dto.idAnimal,
          idPadre: dto.idPadre,
          idMadre: dto.idMadre,
          observaciones: dto.observaciones ?? null,
          ranchId: animal.idRancho,
          createdAt: dto.creadoEn,
          versionRegistro: dto.versionRegistro
        });

        return {
          record: this.toGenealogyRecord(persisted),
          synced: true,
          syncMessage: 'Vínculo genealógico registrado y sincronizado con el servidor.'
        };
      } catch (err) {
        if (err instanceof ApiError && !isNetworkOrConnectivityFailure(err)) {
          throw new ApiError(
            extractProblemDetailMessage(err, 'No se pudo registrar el vínculo genealógico.'),
            err.status,
            err.data
          );
        }
        if (!isNetworkOrConnectivityFailure(err)) {
          throw err;
        }
      }
    }

    const idGenealogia = crypto.randomUUID();
    const createdLocal = await GenealogyRepository.create(
      {
        id: idGenealogia,
        ranchId: animal.idRancho,
        cattleId: animal.id,
        padreId: normalized.idPadre ?? undefined,
        madreId: normalized.idMadre ?? undefined,
        observaciones: normalized.observaciones
      },
      registerRequest
    );

    return {
      record: this.toGenealogyRecord(createdLocal),
      synced: false,
      syncMessage: buildLocalOfflineMessage('guardado')
    };
  },

  async update(idOrAnimalId: string, rawInput: GenealogyInput): Promise<GenealogyMutationResult> {
    const existing =
      (await GenealogyRepository.resolveByIdentifier(idOrAnimalId)) ??
      (await GenealogyRepository.getByCattleId(idOrAnimalId));

    const targetAnimalId = existing?.cattleId ?? rawInput.idAnimal.trim();
    if (!targetAnimalId) {
      throw new Error('El vínculo genealógico que intentas editar no existe o fue desactivado.');
    }
    if (existing?.deletedAt) {
      throw new Error('El vínculo genealógico que intentas editar fue desactivado.');
    }

    // `idAnimal` permanece inmutable al editar
    const enforcedInput: GenealogyInput = {
      ...rawInput,
      idAnimal: targetAnimalId
    };

    const [animals, allLocal] = await Promise.all([
      this.loadAnimals(),
      GenealogyRepository.getAllWithOptions({ includeDeleted: false })
    ]);
    const existingRecords = allLocal.map((r) => this.toGenealogyRecord(r));

    const fieldErrors = validateGenealogyInput(enforcedInput, {
      animals,
      existingRecords,
      editingRecordId: existing?.id
    });
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos de parentesco.';
      throw new GenealogyValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeGenealogyInput(enforcedInput);
    const animal = animals.find((a) => a.id === targetAnimalId);
    let versionRegistro = resolveVersionNumber(existing?.serverVersion);

    if (isOnline()) {
      // Si no teníamos versión confiable del servidor, consultarla desde /padres antes de PUT
      if (!existing || existing.syncStatus !== 'synced' || existing.serverVersion === null) {
        try {
          const parents = await genealogyApi.getParents(targetAnimalId, 1);
          if (parents.versionRegistro && parents.versionRegistro >= 1) {
            versionRegistro = parents.versionRegistro;
          }
        } catch {
          // Continuar con la versión local conocida
        }
      }

      const updateRequest = this.toUpdateRequest(normalized, versionRegistro);

      try {
        const dto = await genealogyApi.update(targetAnimalId, updateRequest);
        const persisted = await GenealogyRepository.upsertConfirmedFromServer({
          idGenealogia: dto.idGenealogia,
          idAnimal: dto.idAnimal,
          idPadre: dto.idPadre,
          idMadre: dto.idMadre,
          observaciones: dto.observaciones ?? null,
          ranchId: existing?.ranchId || animal?.idRancho,
          createdAt: dto.creadoEn,
          versionRegistro: dto.versionRegistro
        });

        return {
          record: this.toGenealogyRecord(persisted),
          synced: true,
          syncMessage: 'Vínculo genealógico actualizado y sincronizado con el servidor.'
        };
      } catch (err) {
        if (err instanceof ApiError && !isNetworkOrConnectivityFailure(err)) {
          throw new ApiError(
            extractProblemDetailMessage(err, 'No se pudo actualizar el vínculo genealógico.'),
            err.status,
            err.data
          );
        }
        if (!isNetworkOrConnectivityFailure(err)) {
          throw err;
        }
      }
    }

    if (!existing) {
      throw new Error('Sin conexión: no se encontró el registro local para editar.');
    }

    const updatedLocal = await GenealogyRepository.update(
      existing.id,
      {
        ranchId: existing.ranchId,
        cattleId: existing.cattleId,
        padreId: normalized.idPadre ?? undefined,
        madreId: normalized.idMadre ?? undefined,
        observaciones: normalized.observaciones
      },
      this.toUpdateRequest(normalized, versionRegistro)
    );

    return {
      record: this.toGenealogyRecord(updatedLocal),
      synced: false,
      syncMessage: buildLocalOfflineMessage('actualizado')
    };
  },

  async deactivate(idOrAnimalId: string): Promise<{ synced: boolean; syncMessage: string }> {
    const existing =
      (await GenealogyRepository.resolveByIdentifier(idOrAnimalId)) ??
      (await GenealogyRepository.getByCattleId(idOrAnimalId));
    if (!existing) {
      throw new Error('El vínculo genealógico no fue encontrado.');
    }

    let versionRegistro = resolveVersionNumber(existing.serverVersion);

    if (isOnline()) {
      if (existing.syncStatus !== 'synced' || existing.serverVersion === null) {
        try {
          const parents = await genealogyApi.getParents(existing.cattleId, 1);
          if (parents.versionRegistro && parents.versionRegistro >= 1) {
            versionRegistro = parents.versionRegistro;
          }
        } catch {
          // Mantener versión local conocida
        }
      }

      try {
        await genealogyApi.remove(existing.cattleId, versionRegistro);
        await GenealogyRepository.markDeletedFromServer(existing.cattleId, versionRegistro + 1);
        return {
          synced: true,
          syncMessage: 'Vínculo genealógico desactivado en el servidor.'
        };
      } catch (err) {
        if (err instanceof ApiError && !isNetworkOrConnectivityFailure(err)) {
          throw new ApiError(
            extractProblemDetailMessage(err, 'No se pudo desactivar el vínculo genealógico.'),
            err.status,
            err.data
          );
        }
        if (!isNetworkOrConnectivityFailure(err)) {
          throw err;
        }
      }
    }

    await GenealogyRepository.softDelete(existing.id, {
      idGenealogia: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id,
      idAnimal: existing.cattleId,
      versionRegistro
    });

    return {
      synced: false,
      syncMessage: buildLocalOfflineMessage('desactivado')
    };
  }
};
