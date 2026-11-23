import type { SyncStatus } from '../lib/database/schema';
import type { Cattle } from './cattle';

/**
 * Dependencia explícita con el Backend (ver `docs/08-contrato-sincronizacion.md` §Alcance real de Pull
 * y `BackEnd/Data/FarmDbContext.cs`).
 * No existe aún la entidad `Genealogia` ni columnas `IdPadre`/`IdMadre` en `Animal`,
 * ni endpoints REST o Sync Push/Pull habilitados para genealogía.
 */
export const GENEALOGY_BACKEND_DEPENDENCY = {
  entityName: 'Genealogia',
  missingRestEndpoint: '/api/genealogia',
  syncPushEnabled: false,
  syncPullEnabled: false,
  requiredBackendFields: [
    'IdGenealogia',
    'IdAnimal',
    'IdPadre',
    'IdMadre',
    'VersionRegistro',
    'EliminadoEn'
  ],
  summaryMessage:
    'Dependencia de Backend pendiente: el servidor aún no implementa el modelo Genealogia ni sus endpoints REST o de sincronización Push/Pull (tampoco expone IdPadre/IdMadre en Animal). Los parentescos registrados manualmente se guardan localmente en IndexedDB y permanecen en cola pendiente sin simular sincronización remota ni generar relaciones automáticas.'
} as const;

export interface GenealogyRecord {
  id: string;
  idGenealogia: string;
  remoteId?: string | number;
  idRancho: string;
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

export interface GenealogyInput {
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
}

export interface BackendGenealogiaPayload {
  idGenealogia: string;
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
}

export interface DescendantLink {
  animal: Cattle;
  recordId: string;
  role: 'padre' | 'madre' | 'ambos';
}

export interface AnimalGenealogyProfile {
  animal: Cattle;
  record: GenealogyRecord | null;
  padre: Cattle | null;
  madre: Cattle | null;
  abueloPaterno: Cattle | null;
  abuelaPaterna: Cattle | null;
  abueloMaterno: Cattle | null;
  abuelaMaterna: Cattle | null;
  descendientes: DescendantLink[];
  hasAnyGenealogyData: boolean;
}
