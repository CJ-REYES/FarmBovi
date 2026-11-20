import type { SyncStatus } from '../lib/database/schema';

export type CattleSex = 'Hembra' | 'Macho';

export type AnimalEstado = 'Activo' | 'Vendido' | 'Baja';

export const ANIMAL_ESTADOS: readonly AnimalEstado[] = ['Activo', 'Vendido', 'Baja'] as const;

export const ANIMAL_SEXOS: readonly CattleSex[] = ['Hembra', 'Macho'] as const;

export const ANIMAL_RAZAS_PREDEFINIDAS: readonly string[] = [
  'Brahman',
  'Suizo',
  'Angus',
  'Indubrasil',
  'Gyr',
  'Cebú',
  'Simmental',
  'Charolais',
  'Holstein',
  'Cruzado'
] as const;

export const ANIMAL_PROCEDENCIAS_PREDEFINIDAS: readonly string[] = [
  'Propio',
  'Nacimiento en rancho',
  'Compra',
  'Traslado',
  'Intercambio'
] as const;

/**
 * Contrato real devuelto/recibido por `AnimalsController` (`BackEnd/Models/Animal.cs`).
 */
export interface BackendAnimalDto {
  idAnimal: string;
  idRancho: string;
  idLote: string | null;
  arete: string;
  raza: string;
  sexo: string;
  fechaNacimiento: string | null;
  fechaIngreso: string;
  procedencia: string;
  estado: string;
  fechaSalida: string | null;
  observaciones: string | null;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro: number;
  eliminadoEn: string | null;
}

/**
 * Payload enviado a `POST /api/animales`, `PUT /api/animales/{id}` y `POST /api/sync/operaciones`.
 * Respeta exactamente los campos definidos en `BackEnd/Models/Animal.cs` sin inventar propiedades.
 */
export interface BackendAnimalPayload {
  idAnimal: string;
  idRancho: string;
  idLote: string | null;
  arete: string;
  raza: string;
  sexo: CattleSex;
  fechaNacimiento: string | null;
  fechaIngreso: string;
  procedencia: string;
  estado: string;
  fechaSalida: string | null;
  observaciones: string | null;
  eliminadoEn?: string | null;
}

/**
 * Contrato real de `LotesController` (`BackEnd/Models/Lote.cs`).
 */
export interface BackendLoteDto {
  idLote: string;
  idRancho: string;
  nombre: string;
  ubicacion: string | null;
  estado: string;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro: number;
  eliminadoEn: string | null;
}

/**
 * Contrato real de `RanchosController` (`BackEnd/Models/Rancho.cs`).
 */
export interface BackendRanchoDto {
  idRancho: string;
  nombre: string;
  ubicacionGeneral: string;
  estado: string;
  idAutor?: string;
  creadoEn?: string;
  versionRegistro: number;
  eliminadoEn: string | null;
}

/**
 * Modelo de dominio de un animal en Frontend alineado con GUID (`idAnimal`) y estado offline-first.
 */
export interface Cattle {
  id: string;
  idAnimal: string;
  remoteId?: string | number;
  idRancho: string;
  idLote: string | null;
  arete: string;
  raza: string;
  sexo: CattleSex;
  fechaNacimiento: string | null;
  fechaIngreso: string;
  procedencia: string;
  estado: string;
  fechaSalida: string | null;
  observaciones: string | null;
  versionRegistro: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
}

/**
 * Datos capturados en el formulario de registro y edición de animales.
 */
export interface CattleInput {
  idRancho: string;
  idLote: string | null;
  arete: string;
  raza: string;
  sexo: CattleSex;
  fechaNacimiento: string | null;
  fechaIngreso: string;
  procedencia: string;
  estado: AnimalEstado;
  fechaSalida: string | null;
  observaciones: string | null;
}

export interface RanchOption {
  id: string;
  nombre: string;
  ubicacionGeneral: string;
  estado: string;
}

export interface LotOption {
  id: string;
  idRancho: string;
  nombre: string;
  ubicacion: string | null;
  estado: string;
}
