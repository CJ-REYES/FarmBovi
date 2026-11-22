import {
  ApiError,
  healthEventsApi,
  hasActiveAuthSession,
  treatmentsApi
} from '../lib/api';
import { computeStableNegativeId } from '../lib/database/migrations';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { HealthRepository } from '../lib/database/repositories/health.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { TreatmentRepository } from '../lib/database/repositories/treatment.repository';
import type { LocalHealthRecord, LocalTreatment } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import type {
  BackendEventoSanitarioDto,
  BackendEventoSanitarioPayload,
  BackendTratamientoDto,
  BackendTratamientoPayload,
  HealthEvent,
  HealthEventInput,
  Treatment,
  TreatmentEstado,
  TreatmentInput
} from '../types/health';
import { CattleService } from './cattle.service';
import {
  normalizeHealthEventInput,
  normalizeTreatmentEstado,
  normalizeTreatmentInput,
  validateHealthEventInput,
  validateTreatmentInput,
  type HealthEventValidationErrors,
  type TreatmentValidationErrors
} from './health.validation';
import { PushSyncEngine } from './sync/push-sync.engine';

export class HealthValidationError extends Error {
  readonly fieldErrors: HealthEventValidationErrors;

  constructor(message: string, fieldErrors: HealthEventValidationErrors) {
    super(message);
    this.name = 'HealthValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class TreatmentValidationError extends Error {
  readonly fieldErrors: TreatmentValidationErrors;

  constructor(message: string, fieldErrors: TreatmentValidationErrors) {
    super(message);
    this.name = 'TreatmentValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface HealthEventMutationResult {
  event: HealthEvent;
  synced: boolean;
  syncMessage?: string;
}

export interface TreatmentMutationResult {
  treatment: Treatment;
  synced: boolean;
  syncMessage?: string;
}

export interface HealthLoadResult {
  events: HealthEvent[];
  treatments: Treatment[];
  animals: Cattle[];
  source: 'server' | 'cache';
  warning: string | null;
}

function normalizeDateTimeForBackend(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  return trimmed;
}

function buildCompactDescription(input: {
  diagnostico?: string | null;
  sintomas?: string | null;
  observaciones?: string | null;
  tipo: string;
}): string {
  return (
    input.diagnostico?.trim() ||
    input.sintomas?.trim() ||
    input.observaciones?.trim() ||
    input.tipo
  );
}

function mapBackendEventToLocal(
  remote: BackendEventoSanitarioDto,
  ranchId: string | undefined,
  existing?: LocalHealthRecord
): LocalHealthRecord {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idEventoSanitario;
  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idEventoSanitario,
    ranchId: ranchId || existing?.ranchId,
    cattleId: remote.idAnimal,
    tipo: remote.tipo.trim(),
    descripcion: buildCompactDescription(remote),
    fecha: remote.fecha,
    sintomas: remote.sintomas ?? null,
    diagnostico: remote.diagnostico ?? null,
    profesionalDiagnostico: remote.profesionalDiagnostico ?? null,
    evidenciaDiagnosticoUri: remote.evidenciaDiagnosticoUri ?? null,
    responsable: remote.responsable.trim(),
    observaciones: remote.observaciones ?? null,
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

function mapBackendTreatmentToLocal(
  remote: BackendTratamientoDto,
  ranchId: string | undefined,
  cattleId: string | undefined,
  existing?: LocalTreatment
): LocalTreatment {
  const now = new Date().toISOString();
  const id = existing?.id || remote.idTratamiento;
  return {
    id,
    localNumericId: existing?.localNumericId ?? computeStableNegativeId(id),
    remoteId: remote.idTratamiento,
    ranchId: ranchId || existing?.ranchId,
    eventoSanitarioId: remote.idEventoSanitario,
    cattleId: cattleId || existing?.cattleId || '',
    producto: remote.producto.trim(),
    dosis: Number(remote.dosis),
    unidadDosis: remote.unidadDosis.trim(),
    viaAdministracion: remote.viaAdministracion ?? null,
    frecuencia: remote.frecuencia.trim(),
    fechaInicio: remote.fechaInicio,
    fechaFin: remote.fechaFin ?? null,
    responsable: remote.responsable.trim(),
    prescripcionUri: remote.prescripcionUri ?? null,
    estado: normalizeTreatmentEstado(remote.estado),
    createdAt: remote.creadoEn || existing?.createdAt || now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: remote.versionRegistro ?? 1,
    deletedAt: remote.eliminadoEn ?? null
  };
}

export const HealthService = {
  toHealthEvent(local: LocalHealthRecord): HealthEvent {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idEventoSanitario: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId,
      tipo: local.tipo,
      fecha: local.fecha,
      sintomas: local.sintomas ?? null,
      diagnostico: local.diagnostico ?? null,
      profesionalDiagnostico: local.profesionalDiagnostico ?? null,
      evidenciaDiagnosticoUri: local.evidenciaDiagnosticoUri ?? null,
      responsable: local.responsable || 'No especificado',
      observaciones:
        local.observaciones !== undefined
          ? local.observaciones
          : local.descripcion && local.descripcion !== local.tipo
            ? local.descripcion
            : null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toTreatment(local: LocalTreatment): Treatment {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    return {
      id: local.id,
      idTratamiento: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idEventoSanitario: local.eventoSanitarioId,
      idAnimal: local.cattleId,
      producto: local.producto,
      dosis: local.dosis,
      unidadDosis: local.unidadDosis,
      viaAdministracion: local.viaAdministracion ?? null,
      frecuencia: local.frecuencia,
      fechaInicio: local.fechaInicio,
      fechaFin: local.fechaFin ?? null,
      responsable: local.responsable,
      prescripcionUri: local.prescripcionUri ?? null,
      estado: normalizeTreatmentEstado(local.estado),
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  toEventBackendPayload(
    idEventoSanitario: string,
    input: HealthEventInput
  ): BackendEventoSanitarioPayload {
    const normalized = normalizeHealthEventInput(input);
    return {
      idEventoSanitario,
      idAnimal: normalized.idAnimal,
      tipo: normalized.tipo,
      fecha: normalizeDateTimeForBackend(normalized.fecha),
      sintomas: normalized.sintomas,
      diagnostico: normalized.diagnostico,
      profesionalDiagnostico: normalized.profesionalDiagnostico,
      evidenciaDiagnosticoUri: normalized.evidenciaDiagnosticoUri,
      responsable: normalized.responsable,
      observaciones: normalized.observaciones
    };
  },

  toTreatmentBackendPayload(
    idTratamiento: string,
    input: TreatmentInput
  ): BackendTratamientoPayload {
    const normalized = normalizeTreatmentInput(input);
    return {
      idTratamiento,
      idEventoSanitario: normalized.idEventoSanitario,
      producto: normalized.producto,
      dosis: normalized.dosis,
      unidadDosis: normalized.unidadDosis,
      viaAdministracion: normalized.viaAdministracion,
      frecuencia: normalized.frecuencia,
      fechaInicio: normalizeDateTimeForBackend(normalized.fechaInicio),
      fechaFin: normalized.fechaFin ? normalizeDateTimeForBackend(normalized.fechaFin) : null,
      responsable: normalized.responsable,
      prescripcionUri: normalized.prescripcionUri,
      estado: normalized.estado
    };
  },

  async loadAnimals(): Promise<Cattle[]> {
    const localAnimals = await CattleRepository.getAll();
    return localAnimals.map((item) => CattleService.toCattle(item));
  },

  async getAll(options?: {
    cattleId?: string;
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<HealthLoadResult> {
    let source: 'server' | 'cache' = 'cache';
    let warning: string | null = null;

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const [eventsRes, treatmentsRes] = await Promise.allSettled([
        healthEventsApi.list(Boolean(options?.includeDeleted)),
        treatmentsApi.list(Boolean(options?.includeDeleted))
      ]);

      const allAnimals = await CattleRepository.getAllWithOptions({ includeDeleted: true });
      const ranchByAnimal = new Map<string, string>();
      for (const a of allAnimals) {
        if (a.ranchId) {
          ranchByAnimal.set(a.id, a.ranchId);
          if (typeof a.remoteId === 'string') ranchByAnimal.set(a.remoteId, a.ranchId);
        }
      }

      if (eventsRes.status === 'fulfilled') {
        const upserts: LocalHealthRecord[] = [];
        for (const remote of eventsRes.value) {
          const existing = await HealthRepository.resolveByIdentifier(remote.idEventoSanitario);
          upserts.push(mapBackendEventToLocal(remote, ranchByAnimal.get(remote.idAnimal), existing));
        }
        if (upserts.length > 0) {
          await HealthRepository.upsertFromServer(upserts);
        }
        source = 'server';
      } else {
        const reason = eventsRes.reason;
        if (reason instanceof ApiError && reason.status === 401) {
          warning =
            'Sesión no autenticada en el servidor (401). Mostrando historial sanitario local guardado en IndexedDB.';
        } else if (reason instanceof ApiError && reason.status === 403) {
          warning =
            'Sin permisos para consultar sanidad en el servidor (403). Mostrando copia local.';
        } else {
          warning =
            reason instanceof Error
              ? `${reason.message} Mostrando historial sanitario local.`
              : 'No se pudo consultar el servidor. Mostrando historial sanitario local.';
        }
      }

      if (treatmentsRes.status === 'fulfilled') {
        const allEvents = await HealthRepository.getAllWithOptions({ includeDeleted: true });
        const eventMeta = new Map<string, { ranchId?: string; cattleId: string }>();
        for (const ev of allEvents) {
          eventMeta.set(ev.id, { ranchId: ev.ranchId, cattleId: ev.cattleId });
          if (typeof ev.remoteId === 'string') {
            eventMeta.set(ev.remoteId, { ranchId: ev.ranchId, cattleId: ev.cattleId });
          }
        }

        const upserts: LocalTreatment[] = [];
        for (const remote of treatmentsRes.value) {
          const existing = await TreatmentRepository.resolveByIdentifier(remote.idTratamiento);
          const meta = eventMeta.get(remote.idEventoSanitario);
          upserts.push(
            mapBackendTreatmentToLocal(remote, meta?.ranchId, meta?.cattleId, existing)
          );
        }
        if (upserts.length > 0) {
          await TreatmentRepository.upsertFromServer(upserts);
        }
        source = 'server';
      } else if (!warning) {
        const reason = treatmentsRes.reason;
        warning =
          reason instanceof Error
            ? `${reason.message} Mostrando tratamientos locales.`
            : 'No se pudieron consultar los tratamientos remotos. Mostrando copia local.';
      }
    }

    const [localEvents, localTreatments, animals] = await Promise.all([
      HealthRepository.getAllWithOptions(options),
      TreatmentRepository.getAllWithOptions(options),
      this.loadAnimals()
    ]);

    return {
      events: localEvents.map((e) => this.toHealthEvent(e)),
      treatments: localTreatments.map((t) => this.toTreatment(t)),
      animals,
      source,
      warning
    };
  },

  async attemptPushForEntity(
    entidad: 'healthRecords' | 'treatments',
    idEntidad: string
  ): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage:
          'Sin conexión: guardado localmente en IndexedDB y encolado para sincronizarse al recuperar Internet.'
      };
    }

    if (!hasActiveAuthSession()) {
      return {
        synced: false,
        syncMessage:
          'Guardado localmente en IndexedDB. Inicia sesión para sincronizar este cambio con el servidor.'
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const ops = await OutboxRepository.getByEntity(entidad, idEntidad);
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
          'Guardado localmente, pero el servidor reportó un error al sincronizar.'
      };
    }

    return {
      synced: false,
      syncMessage: 'Guardado localmente y en cola de sincronización.'
    };
  },

  async createEvent(rawInput: HealthEventInput): Promise<HealthEventMutationResult> {
    const animals = await this.loadAnimals();
    const fieldErrors = validateHealthEventInput(rawInput, { animals });
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del evento sanitario.';
      throw new HealthValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeHealthEventInput(rawInput);
    const animal = animals.find((a) => a.id === normalized.idAnimal)!;
    const idEvento = crypto.randomUUID();
    const fechaIso = normalizeDateTimeForBackend(normalized.fecha);
    const payload = this.toEventBackendPayload(idEvento, normalized);

    const createdLocal = await HealthRepository.create(
      {
        id: idEvento,
        ranchId: animal.idRancho,
        cattleId: animal.id,
        tipo: normalized.tipo,
        descripcion: buildCompactDescription(normalized),
        fecha: fechaIso,
        sintomas: normalized.sintomas,
        diagnostico: normalized.diagnostico,
        profesionalDiagnostico: normalized.profesionalDiagnostico,
        evidenciaDiagnosticoUri: normalized.evidenciaDiagnosticoUri,
        responsable: normalized.responsable,
        observaciones: normalized.observaciones
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity('healthRecords', createdLocal.id);
    const refreshed =
      (await HealthRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      event: this.toHealthEvent(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async updateEvent(id: string, rawInput: HealthEventInput): Promise<HealthEventMutationResult> {
    const existing = await HealthRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El evento sanitario que intentas editar no existe o fue desactivado.');
    }

    // Regla `SincronizacionController` AllowedUpdateProperties["EventoSanitario"]: IdAnimal inmutable en edición.
    const enforcedInput: HealthEventInput = {
      ...rawInput,
      idAnimal: existing.cattleId
    };

    const animals = await this.loadAnimals();
    const fieldErrors = validateHealthEventInput(enforcedInput, { animals });
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del evento sanitario.';
      throw new HealthValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeHealthEventInput(enforcedInput);
    const idEvento = typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const fechaIso = normalizeDateTimeForBackend(normalized.fecha);
    const payload = this.toEventBackendPayload(idEvento, normalized);

    const updatedLocal = await HealthRepository.update(
      existing.id,
      {
        ranchId: existing.ranchId,
        cattleId: existing.cattleId,
        tipo: normalized.tipo,
        descripcion: buildCompactDescription(normalized),
        fecha: fechaIso,
        sintomas: normalized.sintomas,
        diagnostico: normalized.diagnostico,
        profesionalDiagnostico: normalized.profesionalDiagnostico,
        evidenciaDiagnosticoUri: normalized.evidenciaDiagnosticoUri,
        responsable: normalized.responsable,
        observaciones: normalized.observaciones
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity('healthRecords', updatedLocal.id);
    const refreshed =
      (await HealthRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      event: this.toHealthEvent(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  /**
   * Desactivación lógica de evento sanitario (`DELETE /api/eventos-sanitarios/{id}`).
   * Respeta la regla del Backend: no puede eliminarse si tiene tratamientos activos asociados.
   */
  async deactivateEvent(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await HealthRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El evento sanitario no fue encontrado.');
    }

    const activeTreatments = await TreatmentRepository.countActiveByHealthEvent(existing.id);
    if (activeTreatments > 0) {
      throw new Error(
        `No se puede desactivar este evento sanitario porque tiene ${activeTreatments} tratamiento(s) activo(s) asociado(s). Desactiva primero los tratamientos.`
      );
    }

    await HealthRepository.softDelete(existing.id, {
      idEventoSanitario: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity('healthRecords', existing.id);
  },

  async createTreatment(rawInput: TreatmentInput): Promise<TreatmentMutationResult> {
    const activeLocalEvents = await HealthRepository.getAllWithOptions({ includeDeleted: false });
    const events = activeLocalEvents.map((e) => this.toHealthEvent(e));

    const fieldErrors = validateTreatmentInput(rawInput, { events });
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del tratamiento.';
      throw new TreatmentValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeTreatmentInput(rawInput);
    const parentEvent = events.find((e) => e.id === normalized.idEventoSanitario)!;
    const idTratamiento = crypto.randomUUID();
    const inicioIso = normalizeDateTimeForBackend(normalized.fechaInicio);
    const finIso = normalized.fechaFin ? normalizeDateTimeForBackend(normalized.fechaFin) : null;
    const payload = this.toTreatmentBackendPayload(idTratamiento, rawInput);

    const createdLocal = await TreatmentRepository.create(
      {
        id: idTratamiento,
        ranchId: parentEvent.idRancho,
        eventoSanitarioId: parentEvent.id,
        cattleId: parentEvent.idAnimal,
        producto: normalized.producto,
        dosis: normalized.dosis,
        unidadDosis: normalized.unidadDosis,
        viaAdministracion: normalized.viaAdministracion,
        frecuencia: normalized.frecuencia,
        fechaInicio: inicioIso,
        fechaFin: finIso,
        responsable: normalized.responsable,
        prescripcionUri: normalized.prescripcionUri,
        estado: normalized.estado
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity('treatments', createdLocal.id);
    const refreshed =
      (await TreatmentRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      treatment: this.toTreatment(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async updateTreatment(id: string, rawInput: TreatmentInput): Promise<TreatmentMutationResult> {
    const existing = await TreatmentRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El tratamiento que intentas editar no existe o fue desactivado.');
    }

    // Regla `SincronizacionController` AllowedUpdateProperties["Tratamiento"]: IdEventoSanitario inmutable en edición.
    const enforcedInput: TreatmentInput = {
      ...rawInput,
      idEventoSanitario: existing.eventoSanitarioId
    };

    const allEvents = (await HealthRepository.getAllWithOptions({ includeDeleted: true })).map((e) =>
      this.toHealthEvent(e)
    );
    const fieldErrors = validateTreatmentInput(enforcedInput, { events: allEvents });
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del tratamiento.';
      throw new TreatmentValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeTreatmentInput(enforcedInput);
    const idTratamiento = typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const inicioIso = normalizeDateTimeForBackend(normalized.fechaInicio);
    const finIso = normalized.fechaFin ? normalizeDateTimeForBackend(normalized.fechaFin) : null;
    const payload = this.toTreatmentBackendPayload(idTratamiento, enforcedInput);

    const updatedLocal = await TreatmentRepository.update(
      existing.id,
      {
        ranchId: existing.ranchId,
        eventoSanitarioId: existing.eventoSanitarioId,
        cattleId: existing.cattleId,
        producto: normalized.producto,
        dosis: normalized.dosis,
        unidadDosis: normalized.unidadDosis,
        viaAdministracion: normalized.viaAdministracion,
        frecuencia: normalized.frecuencia,
        fechaInicio: inicioIso,
        fechaFin: finIso,
        responsable: normalized.responsable,
        prescripcionUri: normalized.prescripcionUri,
        estado: normalized.estado
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity('treatments', updatedLocal.id);
    const refreshed =
      (await TreatmentRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      treatment: this.toTreatment(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async setTreatmentEstado(
    id: string,
    estado: TreatmentEstado
  ): Promise<TreatmentMutationResult> {
    const existing = await TreatmentRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('Tratamiento no encontrado.');
    }

    return await this.updateTreatment(existing.id, {
      idEventoSanitario: existing.eventoSanitarioId,
      producto: existing.producto,
      dosis: existing.dosis,
      unidadDosis: existing.unidadDosis,
      viaAdministracion: existing.viaAdministracion ?? null,
      frecuencia: existing.frecuencia,
      fechaInicio: existing.fechaInicio,
      fechaFin: existing.fechaFin ?? null,
      responsable: existing.responsable,
      prescripcionUri: existing.prescripcionUri ?? null,
      estado
    });
  },

  async deactivateTreatment(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await TreatmentRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El tratamiento no fue encontrado.');
    }

    await TreatmentRepository.softDelete(existing.id, {
      idTratamiento: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity('treatments', existing.id);
  }
};
