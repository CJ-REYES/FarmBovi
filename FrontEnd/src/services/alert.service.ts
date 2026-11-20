import { readSessionAuthToken, remindersApi } from '../lib/api';
import { AlertRepository } from '../lib/database/repositories/alert.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import type { LocalAlert } from '../lib/database/schema';
import type {
  AlertInput,
  AlertRecord,
  BackendRecordatorioDto,
  BackendRecordatorioPayload
} from '../types/alert';
import type { Cattle, RanchOption } from '../types/cattle';
import type { Treatment } from '../types/health';
import type { Lot } from '../types/lot';
import { CattleService } from './cattle.service';
import { HealthService } from './health.service';
import { isTreatmentPending } from './health.validation';
import { LotService } from './lot.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import {
  deriveAlertPriority,
  normalizeAlertEstado,
  normalizeAlertInput,
  validateAlertInput,
  type AlertValidationErrors
} from './alert.validation';

export class AlertValidationError extends Error {
  readonly fieldErrors: AlertValidationErrors;

  constructor(message: string, fieldErrors: AlertValidationErrors) {
    super(message);
    this.name = 'AlertValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export interface AlertMutationResult {
  alert: AlertRecord;
  synced: boolean;
  syncMessage?: string;
}

export interface AlertsLoadResult {
  alerts: AlertRecord[];
  pendingTreatments: Treatment[];
  ranches: RanchOption[];
  animals: Cattle[];
  lots: Lot[];
  source: 'api' | 'cache';
  warning: string | null;
}

function normalizeDateTimeForBackend(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  return trimmed;
}

export const AlertService = {
  toAlertRecord(local: LocalAlert): AlertRecord {
    const parsedVersion =
      typeof local.serverVersion === 'number'
        ? local.serverVersion
        : typeof local.serverVersion === 'string' && !Number.isNaN(Number(local.serverVersion))
          ? Number(local.serverVersion)
          : 1;

    const estado = normalizeAlertEstado(
      local.estado ?? (local.leida ? 'Completado' : 'Pendiente')
    );

    return {
      id: local.id,
      idRecordatorio: typeof local.remoteId === 'string' ? local.remoteId : local.id,
      remoteId: local.remoteId,
      idRancho: local.ranchId || '',
      idAnimal: local.cattleId ?? null,
      idLote: local.lotId ?? null,
      idTratamiento: local.treatmentId ?? null,
      idResponsable: local.responsableId ?? null,
      tipo: local.tipo,
      descripcion: local.mensaje,
      fechaProgramada: local.fecha,
      estado,
      fechaCompletado: local.fechaCompletado ?? null,
      versionRegistro: parsedVersion,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      deletedAt: local.deletedAt ?? null,
      syncStatus: local.syncStatus
    };
  },

  fromBackendDto(dto: BackendRecordatorioDto): LocalAlert {
    const now = new Date().toISOString();
    const estado = normalizeAlertEstado(dto.estado);
    return {
      id: dto.idRecordatorio,
      remoteId: dto.idRecordatorio,
      ranchId: dto.idRancho,
      tipo: dto.tipo,
      prioridad: deriveAlertPriority(estado, dto.fechaProgramada),
      mensaje: dto.descripcion,
      leida: estado === 'Completado',
      fecha: dto.fechaProgramada,
      cattleId: dto.idAnimal ?? null,
      lotId: dto.idLote ?? null,
      treatmentId: dto.idTratamiento ?? null,
      responsableId: dto.idResponsable ?? null,
      estado,
      fechaCompletado: dto.fechaCompletado ?? null,
      createdAt: dto.creadoEn || now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: dto.versionRegistro ?? 1,
      deletedAt: dto.eliminadoEn ?? null
    };
  },

  toBackendPayload(idRecordatorio: string, input: AlertInput): BackendRecordatorioPayload {
    const normalized = normalizeAlertInput(input);
    return {
      idRecordatorio,
      idRancho: normalized.idRancho,
      idAnimal: normalized.idAnimal,
      idLote: normalized.idLote,
      idTratamiento: normalized.idTratamiento,
      idResponsable: normalized.idResponsable,
      tipo: normalized.tipo,
      descripcion: normalized.descripcion,
      fechaProgramada: normalizeDateTimeForBackend(normalized.fechaProgramada),
      estado: normalized.estado,
      fechaCompletado: normalized.fechaCompletado
        ? normalizeDateTimeForBackend(normalized.fechaCompletado)
        : null
    };
  },

  async loadContextData(): Promise<{
    ranches: RanchOption[];
    animals: Cattle[];
    lots: Lot[];
    treatments: Treatment[];
  }> {
    const [localRanches, cattleResult, lotsResult, healthResult] = await Promise.all([
      RanchRepository.getAll(),
      CattleService.getAll().catch(() => ({ data: [] as Cattle[] })),
      LotService.getAll().catch(() => ({ data: [] as Lot[] })),
      HealthService.getAll({ includeDeleted: false }).catch(() => ({
        treatments: [] as Treatment[]
      }))
    ]);

    const ranches: RanchOption[] = localRanches.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      ubicacionGeneral: r.ubicacionGeneral,
      estado: r.estado
    }));

    return {
      ranches,
      animals: cattleResult.data,
      lots: lotsResult.data,
      treatments: healthResult.treatments
    };
  },

  /**
   * Consulta recordatorios conectando con `GET /api/recordatorios` cuando hay red y sesión,
   * hidratando IndexedDB sin sobrescribir cambios locales pendientes, y reuniendo
   * tratamientos pendientes reales del módulo de Salud.
   */
  async getAll(options?: {
    includeDeleted?: boolean;
    order?: 'asc' | 'desc';
  }): Promise<AlertsLoadResult> {
    const includeDeleted = Boolean(options?.includeDeleted);
    const order = options?.order ?? 'asc';
    const isOnline = typeof navigator !== 'undefined' && navigator.onLine;
    const hasToken = Boolean(readSessionAuthToken());

    let source: 'api' | 'cache' = 'cache';
    let warning: string | null = null;

    if (isOnline && hasToken) {
      try {
        const remoteItems = await remindersApi.list(includeDeleted);
        const mapped = remoteItems.map((dto) => this.fromBackendDto(dto));
        await AlertRepository.upsertManyFromServer(mapped);
        source = 'api';
      } catch (err) {
        warning =
          err instanceof Error
            ? `Mostrando recordatorios locales: no se pudo actualizar desde /api/recordatorios (${err.message}).`
            : 'Mostrando recordatorios locales: el servidor no respondió.';
      }
    }

    const [localAlerts, context] = await Promise.all([
      AlertRepository.getAllWithOptions({ includeDeleted, order }),
      this.loadContextData()
    ]);

    const pendingTreatments = context.treatments.filter(
      (t) => !t.deletedAt && isTreatmentPending(t.estado)
    );

    return {
      alerts: localAlerts.map((item) => this.toAlertRecord(item)),
      pendingTreatments,
      ranches: context.ranches,
      animals: context.animals,
      lots: context.lots,
      source,
      warning
    };
  },

  async attemptPushForEntity(idEntidad: string): Promise<{ synced: boolean; syncMessage?: string }> {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return {
        synced: false,
        syncMessage:
          'Sin conexión: el recordatorio se guardó en IndexedDB y se sincronizará al recuperar Internet.'
      };
    }

    if (!readSessionAuthToken()) {
      return {
        synced: false,
        syncMessage:
          'Guardado localmente en IndexedDB. Inicia sesión para sincronizar con el servidor.'
      };
    }

    await PushSyncEngine.pushPendingOperations();

    const ops = await OutboxRepository.getByEntity('alerts', idEntidad);
    const latestOp = ops[ops.length - 1];
    if (!latestOp || latestOp.estado === 'confirmado') {
      return { synced: true };
    }

    if (latestOp.estado === 'conflicto') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'Conflicto de versión con el servidor. Revísalo en el Centro de Sincronización.'
      };
    }

    if (latestOp.estado === 'fallido') {
      return {
        synced: false,
        syncMessage:
          latestOp.ultimoError ||
          'El recordatorio se guardó localmente, pero el servidor reportó un error al sincronizarlo.'
      };
    }

    return {
      synced: false,
      syncMessage:
        latestOp.ultimoError || 'Recordatorio guardado localmente y pendiente de sincronización.'
    };
  },

  async create(rawInput: AlertInput): Promise<AlertMutationResult> {
    const context = await this.loadContextData();
    const fieldErrors = validateAlertInput(rawInput, context);
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del recordatorio.';
      throw new AlertValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeAlertInput(rawInput);
    const idRecordatorio = crypto.randomUUID();
    const fechaIso = normalizeDateTimeForBackend(normalized.fechaProgramada);
    const fechaCompIso = normalized.fechaCompletado
      ? normalizeDateTimeForBackend(normalized.fechaCompletado)
      : null;
    const payload = this.toBackendPayload(idRecordatorio, normalized);

    const createdLocal = await AlertRepository.create(
      {
        id: idRecordatorio,
        ranchId: normalized.idRancho,
        tipo: normalized.tipo,
        prioridad: deriveAlertPriority(normalized.estado, fechaIso),
        mensaje: normalized.descripcion,
        leida: normalized.estado === 'Completado',
        fecha: fechaIso,
        cattleId: normalized.idAnimal,
        lotId: normalized.idLote,
        treatmentId: normalized.idTratamiento,
        responsableId: normalized.idResponsable,
        estado: normalized.estado,
        fechaCompletado: fechaCompIso
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(createdLocal.id);
    const refreshed =
      (await AlertRepository.getByIdIncludingDeleted(createdLocal.id)) ?? createdLocal;

    return {
      alert: this.toAlertRecord(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async update(id: string, rawInput: AlertInput): Promise<AlertMutationResult> {
    const existing = await AlertRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El recordatorio que intentas editar no existe o fue desactivado.');
    }

    const context = await this.loadContextData();
    const fieldErrors = validateAlertInput(rawInput, context);
    if (Object.keys(fieldErrors).length > 0) {
      const firstMsg = Object.values(fieldErrors)[0] || 'Revisa los datos del recordatorio.';
      throw new AlertValidationError(firstMsg, fieldErrors);
    }

    const normalized = normalizeAlertInput(rawInput);
    const idRecordatorio =
      typeof existing.remoteId === 'string' ? existing.remoteId : existing.id;
    const fechaIso = normalizeDateTimeForBackend(normalized.fechaProgramada);
    const fechaCompIso =
      normalized.estado === 'Completado'
        ? normalizeDateTimeForBackend(
            normalized.fechaCompletado || existing.fechaCompletado || new Date().toISOString()
          )
        : normalized.fechaCompletado
          ? normalizeDateTimeForBackend(normalized.fechaCompletado)
          : null;

    const payload = this.toBackendPayload(idRecordatorio, {
      ...normalized,
      fechaCompletado: fechaCompIso
    });

    const updatedLocal = await AlertRepository.update(
      existing.id,
      {
        ranchId: normalized.idRancho,
        tipo: normalized.tipo,
        prioridad: deriveAlertPriority(normalized.estado, fechaIso),
        mensaje: normalized.descripcion,
        leida: normalized.estado === 'Completado',
        fecha: fechaIso,
        cattleId: normalized.idAnimal,
        lotId: normalized.idLote,
        treatmentId: normalized.idTratamiento,
        responsableId: normalized.idResponsable,
        estado: normalized.estado,
        fechaCompletado: fechaCompIso
      },
      payload
    );

    const syncOutcome = await this.attemptPushForEntity(updatedLocal.id);
    const refreshed =
      (await AlertRepository.getByIdIncludingDeleted(updatedLocal.id)) ?? updatedLocal;

    return {
      alert: this.toAlertRecord(refreshed),
      synced: syncOutcome.synced,
      syncMessage: syncOutcome.syncMessage
    };
  },

  async setEstado(
    id: string,
    nextEstado: 'Pendiente' | 'En curso' | 'Completado' | 'Cancelado'
  ): Promise<AlertMutationResult> {
    const existing = await AlertRepository.resolveByIdentifier(id);
    if (!existing || existing.deletedAt) {
      throw new Error('El recordatorio no existe o fue desactivado.');
    }
    const current = this.toAlertRecord(existing);
    return await this.update(existing.id, {
      idRancho: current.idRancho,
      idAnimal: current.idAnimal,
      idLote: current.idLote,
      idTratamiento: current.idTratamiento,
      idResponsable: current.idResponsable,
      tipo: current.tipo,
      descripcion: current.descripcion,
      fechaProgramada: current.fechaProgramada,
      estado: nextEstado,
      fechaCompletado: nextEstado === 'Completado' ? new Date().toISOString() : null
    });
  },

  async deactivate(id: string): Promise<{ synced: boolean; syncMessage?: string }> {
    const existing = await AlertRepository.resolveByIdentifier(id);
    if (!existing) {
      throw new Error('El recordatorio no fue encontrado.');
    }

    await AlertRepository.softDelete(existing.id, {
      idRecordatorio: typeof existing.remoteId === 'string' ? existing.remoteId : existing.id
    });

    return await this.attemptPushForEntity(existing.id);
  }
};
