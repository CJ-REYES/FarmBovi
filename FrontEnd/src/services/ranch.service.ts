import { ApiError, ranchesApi } from '../lib/api';
import { db } from '../lib/database/db';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import type { LocalRanch } from '../lib/database/schema';
import type { RanchInput } from '../types/auth';
import { AuthService } from './auth.service';

export interface RanchMutationResult {
  ranch: LocalRanch;
  synced: boolean;
  syncMessage: string;
}

export function validateRanchInput(input: RanchInput): string | null {
  if (!input.nombre.trim()) {
    return 'El nombre del rancho es obligatorio.';
  }
  if (!input.ubicacionGeneral.trim()) {
    return 'La ubicación general del rancho es obligatoria.';
  }
  if (!input.estado.trim()) {
    return 'El estado del rancho es obligatorio.';
  }
  return null;
}

export const RanchService = {
  async list(preferRemote = true): Promise<LocalRanch[]> {
    if (preferRemote && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        const remoteList = await ranchesApi.list(false);
        const now = new Date().toISOString();
        await db.transaction('rw', [db.ranches], async () => {
          for (const r of remoteList) {
            await db.ranches.put({
              id: r.idRancho,
              remoteId: r.idRancho,
              ranchId: r.idRancho,
              nombre: r.nombre,
              ubicacionGeneral: r.ubicacionGeneral,
              estado: r.estado,
              createdAt: r.creadoEn || now,
              updatedAt: now,
              syncStatus: 'synced',
              serverVersion: r.versionRegistro ?? 1,
              deletedAt: r.eliminadoEn ?? null
            });
          }
        });
      } catch {
        // Fallback al caché local IndexedDB
      }
    }

    const local = await db.ranches.filter((r) => !r.deletedAt).toArray();
    return local.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  },

  /**
   * Registro estricto contra el Backend (`POST /api/ranchos`) para el flujo de onboarding
   * tras crear cuenta o iniciar sesión sin rancho. Delega todas las validaciones al Backend.
   */
  async registerOnBackend(input: RanchInput): Promise<RanchMutationResult> {
    const idRancho = crypto.randomUUID();
    const now = new Date().toISOString();

    const created = await ranchesApi.create({
      idRancho,
      nombre: input.nombre.trim(),
      ubicacionGeneral: input.ubicacionGeneral.trim(),
      estado: input.estado.trim()
    });

    const syncedRanch: LocalRanch = {
      id: created.idRancho,
      remoteId: created.idRancho,
      ranchId: created.idRancho,
      nombre: created.nombre,
      ubicacionGeneral: created.ubicacionGeneral,
      estado: created.estado,
      createdAt: created.creadoEn || now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: created.versionRegistro ?? 1,
      deletedAt: null
    };

    await db.ranches.put(syncedRanch);
    AuthService.appendRanchToSession({
      idRancho: created.idRancho,
      nombre: created.nombre,
      rol: 'Admin'
    });

    return {
      ranch: syncedRanch,
      synced: true,
      syncMessage: `Rancho "${created.nombre}" registrado en el servidor (rol Admin asignado).`
    };
  },

  /**
   * Crea un rancho contra `POST /api/ranchos` (el Backend asigna automáticamente rol Admin al creador).
   * Si no hay conexión o el servidor no responde por red, guarda en IndexedDB + outbox para sincronizar luego.
   */
  async create(input: RanchInput): Promise<RanchMutationResult> {
    const validationErr = validateRanchInput(input);
    if (validationErr) {
      throw new Error(validationErr);
    }

    const idRancho = crypto.randomUUID();
    const nombre = input.nombre.trim();
    const ubicacionGeneral = input.ubicacionGeneral.trim();
    const estado = input.estado.trim() || 'Activo';
    const now = new Date().toISOString();

    const isOnline = typeof navigator === 'undefined' || navigator.onLine;

    if (isOnline && AuthService.getSnapshot()?.token) {
      try {
        const created = await ranchesApi.create({
          idRancho,
          nombre,
          ubicacionGeneral,
          estado
        });

        const syncedRanch: LocalRanch = {
          id: created.idRancho,
          remoteId: created.idRancho,
          ranchId: created.idRancho,
          nombre: created.nombre,
          ubicacionGeneral: created.ubicacionGeneral,
          estado: created.estado,
          createdAt: created.creadoEn || now,
          updatedAt: now,
          syncStatus: 'synced',
          serverVersion: created.versionRegistro ?? 1,
          deletedAt: null
        };

        await db.ranches.put(syncedRanch);
        AuthService.appendRanchToSession({
          idRancho: created.idRancho,
          nombre: created.nombre,
          rol: 'Admin'
        });

        return {
          ranch: syncedRanch,
          synced: true,
          syncMessage: `Rancho "${created.nombre}" registrado y sincronizado con el servidor (rol Admin asignado).`
        };
      } catch (err) {
        // Errores de validación o permisos del servidor se propagan explícitamente
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
          throw err;
        }
        // Error transitorio de red -> continuar con guardado offline-first
      }
    }

    const localRanch: LocalRanch = {
      id: idRancho,
      ranchId: idRancho,
      nombre,
      ubicacionGeneral,
      estado,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      serverVersion: null,
      deletedAt: null
    };

    await db.transaction('rw', [db.ranches, db.outbox], async () => {
      await db.ranches.put(localRanch);
      const op = OutboxRepository.createOperationRecord({
        entidad: 'ranches',
        idEntidad: idRancho,
        tipoOperacion: 'CREATE',
        versionBase: null,
        idRancho,
        payload: {
          idRancho,
          nombre,
          ubicacionGeneral,
          estado
        }
      });
      await db.outbox.put(op);
    });

    return {
      ranch: localRanch,
      synced: false,
      syncMessage: isOnline
        ? `Rancho "${nombre}" guardado localmente. Inicia sesión para sincronizarlo con el servidor.`
        : `Sin conexión: rancho "${nombre}" guardado en IndexedDB y encolado para sincronizar al reconectar.`
    };
  },

  async update(idRancho: string, input: RanchInput): Promise<RanchMutationResult> {
    const validationErr = validateRanchInput(input);
    if (validationErr) {
      throw new Error(validationErr);
    }

    const existing = await db.ranches.get(idRancho);
    if (!existing) {
      throw new Error('El rancho seleccionado no existe en el dispositivo.');
    }

    const nombre = input.nombre.trim();
    const ubicacionGeneral = input.ubicacionGeneral.trim();
    const estado = input.estado.trim() || 'Activo';
    const now = new Date().toISOString();
    const isOnline = typeof navigator === 'undefined' || navigator.onLine;

    if (isOnline && AuthService.getSnapshot()?.token && existing.remoteId) {
      try {
        await ranchesApi.update(idRancho, {
          idRancho,
          nombre,
          ubicacionGeneral,
          estado
        });

        const updated: LocalRanch = {
          ...existing,
          nombre,
          ubicacionGeneral,
          estado,
          updatedAt: now,
          syncStatus: 'synced',
          serverVersion:
            typeof existing.serverVersion === 'number'
              ? existing.serverVersion + 1
              : (existing.serverVersion ?? 1)
        };
        await db.ranches.put(updated);
        AuthService.appendRanchToSession({
          idRancho,
          nombre,
          rol: 'Admin'
        });

        return {
          ranch: updated,
          synced: true,
          syncMessage: `Rancho "${nombre}" actualizado y sincronizado con el servidor.`
        };
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
          throw err;
        }
      }
    }

    const updatedLocal: LocalRanch = {
      ...existing,
      nombre,
      ubicacionGeneral,
      estado,
      updatedAt: now,
      syncStatus: 'pending'
    };

    await db.transaction('rw', [db.ranches, db.outbox], async () => {
      await db.ranches.put(updatedLocal);
      const op = OutboxRepository.createOperationRecord({
        entidad: 'ranches',
        idEntidad: idRancho,
        tipoOperacion: 'UPDATE',
        versionBase: existing.serverVersion ?? 1,
        idRancho,
        payload: {
          nombre,
          ubicacionGeneral,
          estado
        }
      });
      await db.outbox.put(op);
    });

    return {
      ranch: updatedLocal,
      synced: false,
      syncMessage: `Cambios del rancho "${nombre}" guardados localmente y encolados para sincronización.`
    };
  }
};
