import type { SyncStatus } from '../lib/database/schema';

/**
 * Sugerencias de tipos de evento reproductivo (no bloquea tipos personalizados
 * hasta que el Backend publique un catálogo formal para `EventoReproductivo`).
 */
export const REPRODUCTION_EVENT_SUGGESTED_TYPES = [
  'Celo',
  'Monta Natural',
  'Inseminación Artificial',
  'Palpación / Diagnóstico',
  'Gestación Confirmada',
  'Secado',
  'Parto',
  'Aborto',
  'Destete'
] as const;

/**
 * Sugerencias para el campo opcional `resultado` alineado a `docs/08-contrato-sincronizacion.md`.
 */
export const REPRODUCTION_RESULT_SUGGESTED = [
  'Pendiente',
  'Positivo / Gestante',
  'Negativo / Vacía',
  'Cría Viva',
  'Cría Muerta',
  'Exitoso',
  'Con Complicaciones'
] as const;

export type ReproductionStage = 'servicios' | 'gestaciones' | 'partos';

/**
 * Dependencia explícita con el Backend (ver `docs/08-contrato-sincronizacion.md` §Alcance real de Pull
 * y `BackEnd/Data/FarmDbContext.cs`).
 * No existen endpoints REST ni soporte de Sync Push/Pull para `EventoReproductivo`.
 */
export const REPRODUCTION_BACKEND_DEPENDENCY = {
  entityName: 'EventoReproductivo',
  missingRestEndpoint: '/api/eventos-reproductivos',
  syncPushEnabled: false,
  syncPullEnabled: false,
  requiredBackendFields: [
    'IdEventoReproductivo',
    'IdAnimal',
    'Tipo',
    'Fecha',
    'Resultado',
    'Observaciones',
    'VersionRegistro',
    'EliminadoEn'
  ],
  summaryMessage:
    'Dependencia de Backend pendiente: el servidor aún no implementa el modelo EventoReproductivo ni sus endpoints REST o de sincronización Push/Pull. Los registros se persisten localmente en IndexedDB y permanecen en cola pendiente sin simular sincronización remota.'
} as const;

/**
 * Contrato de dominio del Frontend para eventos reproductivos, alineado a
 * `LocalReproductionRecord` (IndexedDB) y al contrato planificado `EventoReproductivo`.
 */
export interface ReproductionEvent {
  id: string;
  idEventoReproductivo: string;
  remoteId?: string | number;
  idRancho: string;
  idAnimal: string;
  /** Tipo de evento reproductivo (almacenado en `evento` en IndexedDB por compatibilidad). */
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface ReproductionEventInput {
  idAnimal: string;
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
}

export interface BackendEventoReproductivoPayload {
  idEventoReproductivo: string;
  idAnimal: string;
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
}
