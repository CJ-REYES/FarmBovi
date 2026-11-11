export type SyncStatus = 'synced' | 'pending' | 'conflict' | 'error';

export interface BaseLocalEntity {
  id: string;                  // UUID v4 local (Primary Key)
  remoteId?: string | number;  // ID en el backend .NET 10
  ranchId?: string;            // Identificador del rancho
  createdAt: string;           // ISO 8601 string
  updatedAt: string;           // ISO 8601 string
  syncStatus: SyncStatus;      // Estado de sincronización offline
  serverVersion?: number;      // Versión de concurrencia optimista del servidor
  deletedAt?: string | null;   // Marca de borrado lógico (soft-delete)
}

export interface LocalCattle extends BaseLocalEntity {
  areteSiniiga: string;
  nombre?: string;
  raza: string;
  gender: string;              // 'Macho' | 'Hembra'
  fechaNacimiento?: string;
  loteId?: string;
}

export interface LocalWeighing extends BaseLocalEntity {
  cattleId: string;            // Relación con LocalCattle.id
  peso: number;                // En kilogramos
  fecha: string;
  observaciones?: string;
}

export interface LocalHealthRecord extends BaseLocalEntity {
  cattleId: string;
  tipo: 'Vacunacion' | 'Desparasitacion' | 'Tratamiento' | 'Diagnostico';
  descripcion: string;
  fecha: string;
  proximaAplicacion?: string;
}

export interface LocalFeedingRecord extends BaseLocalEntity {
  lotId?: string;
  tipoAlimento: string;
  cantidadKg: number;
  fecha: string;
}

export interface LocalReproductionRecord extends BaseLocalEntity {
  cattleId: string;
  evento: 'Servicio' | 'Gestacion' | 'Parto' | 'Palpacion';
  fecha: string;
  observaciones?: string;
}

export interface LocalLot extends BaseLocalEntity {
  nombre: string;
  capacidad: number;
  ubicacion?: string;
}

export interface LocalMovement extends BaseLocalEntity {
  cattleId: string;
  origenLotId?: string;
  destinoLotId?: string;
  fecha: string;
  motivo: string;
}

export interface LocalGenealogy extends BaseLocalEntity {
  cattleId: string;
  padreId?: string;
  madreId?: string;
}

export interface LocalAlert extends BaseLocalEntity {
  tipo: 'Sanitaria' | 'Reproduccion' | 'Operativa';
  prioridad: 'Alta' | 'Media' | 'Baja';
  mensaje: string;
  leida: boolean;
  fecha: string;
}

export interface LocalMedia extends BaseLocalEntity {
  cattleId?: string;
  tipo: 'FotoPerfil' | 'BoviScaleVision' | 'Documento';
  blobData?: Blob;             // Almacenamiento binario local optimizado
  urlRemota?: string;
}

export interface LocalOutboxQueue {
  id: string;                  // UUID de la tarea en cola
  entityType: string;          // 'cattle' | 'weighings' | etc.
  entityId: string;            // ID local del registro afectado
  action: 'create' | 'update' | 'delete';
  payload: string;             // JSON stringificado del DTO adaptado
  createdAt: string;
  attempts: number;
}

export interface LocalSyncMetadata {
  entityName: string;          // Nombre de la tabla
  lastSyncedAt?: string;       // Última sincronización exitosa
  lastServerVersion?: number;
}
