import type { SyncStatus } from '../lib/database/schema';
import type { Cattle } from './cattle';

/**
 * DTOs reales del Backend (`BackEnd/DTOs/GenealogiaDtos.cs` y `BackEnd/Controllers/GenealogiaController.cs`).
 */
export interface RegistrarGenealogiaRequest {
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
  observaciones?: string | null;
}

export interface ActualizarGenealogiaRequest {
  idPadre: string | null;
  idMadre: string | null;
  observaciones?: string | null;
  versionRegistro: number;
}

export interface AnimalResumenGenealogiaDto {
  idAnimal: string;
  idRancho: string;
  arete: string;
  raza: string;
  sexo: string;
  fechaNacimiento: string | null;
  estado: string;
}

export interface GenealogiaRegistroDto {
  idGenealogia: string;
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
  observaciones: string | null;
  idAutor: string;
  creadoEn: string;
  versionRegistro: number;
}

export interface AncestroGenealogicoDto {
  generacion: number;
  vinculo: string;
  idHijo: string;
  animal: AnimalResumenGenealogiaDto;
}

export interface PadresAnimalResponse {
  animal: AnimalResumenGenealogiaDto;
  padre: AnimalResumenGenealogiaDto | null;
  madre: AnimalResumenGenealogiaDto | null;
  observaciones: string | null;
  ancestros: AncestroGenealogicoDto[];
  idGenealogia?: string | null;
  versionRegistro?: number | null;
}

export interface AnimalResumenGenealogicoDetalleDto extends AnimalResumenGenealogiaDto {
  idPadre: string | null;
  idMadre: string | null;
}

export interface DescendienteGenealogicoDto {
  generacion: number;
  rolProgenitor: string;
  idPadreOMadreDirecto: string;
  descendiente: AnimalResumenGenealogicoDetalleDto;
}

export interface DescendientesAnimalResponse {
  animal: AnimalResumenGenealogiaDto;
  totalDescendientes: number;
  descendientes: DescendienteGenealogicoDto[];
}

/**
 * Modelo de dominio en UI/caché local alineado con `GenealogiaRegistroDto`.
 */
export interface GenealogyRecord {
  id: string;
  idGenealogia: string;
  remoteId?: string | number;
  idRancho: string;
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
  observaciones: string | null;
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
  observaciones?: string | null;
}

export interface DescendantLink {
  animal: Cattle;
  recordId: string;
  role: 'padre' | 'madre' | 'ambos';
  generacion?: number;
}

export interface AnimalGenealogyProfile {
  animal: Cattle;
  record: GenealogyRecord | null;
  observaciones: string | null;
  padre: Cattle | null;
  madre: Cattle | null;
  abueloPaterno: Cattle | null;
  abuelaPaterna: Cattle | null;
  abueloMaterno: Cattle | null;
  abuelaMaterna: Cattle | null;
  ancestros: AncestroGenealogicoDto[];
  descendientes: DescendantLink[];
  descendientesMultigeneracion: DescendienteGenealogicoDto[];
  totalDescendientes: number;
  hasAnyGenealogyData: boolean;
}
