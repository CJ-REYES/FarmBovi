export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';
export type OutboxOperationType = 'CREATE' | 'UPDATE' | 'DELETE';
export type OutboxStatus = 'pending' | 'syncing' | 'failed';

export interface BaseLocalEntity {
  id: string;
  remoteId?: string | number;
  ranchId?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  serverVersion?: number;
  deletedAt?: string | null;
}

export interface LocalCattle extends BaseLocalEntity {
  areteSiniiga: string;
  nombre?: string;
  raza: string;
  gender: string;
  fechaNacimiento?: string;
  loteId?: string;
}

export interface LocalOutboxQueue {
  id: string;
  entity: string;
  entityId: string;
  operation: OutboxOperationType;
  payload: unknown;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
}

// Interfaces adicionales ya existentes: LocalWeighing, LocalHealthRecord...
export interface LocalWeighing extends BaseLocalEntity { cattleId: string; peso: number; fecha: string; observaciones?: string; }
export interface LocalHealthRecord extends BaseLocalEntity { cattleId: string; tipo: string; descripcion: string; fecha: string; }
export interface LocalFeedingRecord extends BaseLocalEntity { lotId?: string; tipoAlimento: string; cantidadKg: number; fecha: string; }
export interface LocalReproductionRecord extends BaseLocalEntity { cattleId: string; evento: string; fecha: string; observaciones?: string; }
export interface LocalLot extends BaseLocalEntity { nombre: string; capacidad: number; ubicacion?: string; }
export interface LocalMovement extends BaseLocalEntity { cattleId: string; fecha: string; motivo: string; }
export interface LocalGenealogy extends BaseLocalEntity { cattleId: string; padreId?: string; madreId?: string; }
export interface LocalAlert extends BaseLocalEntity { tipo: string; prioridad: string; mensaje: string; leida: boolean; fecha: string; }
export interface LocalMedia extends BaseLocalEntity { tipo: string; blobData?: Blob; urlRemota?: string; }
export interface LocalSyncMetadata { entityName: string; lastSyncedAt?: string; lastServerVersion?: number; }
