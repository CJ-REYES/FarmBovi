export interface Tratamiento {
  idTratamiento: string
  idEventoSanitario: string
  idAnimal: string
  animalArete?: string | null
  animalNombre?: string | null
  producto: string
  dosis: number
  unidadDosis: string
  viaAdministracion?: string | null
  frecuencia: string
  fechaInicio: string
  fechaFin?: string | null
  responsable: string
  prescripcionUri?: string | null
  estado: string
  idAutor: string
  creadoEn: string
  versionRegistro: number
  eliminadoEn?: string | null
}

export interface TratamientoInput {
  idEventoSanitario: string
  producto: string
  dosis: number
  unidadDosis: string
  viaAdministracion?: string | null
  frecuencia: string
  fechaInicio: string
  fechaFin?: string | null
  responsable: string
  prescripcionUri?: string | null
  estado: string
  idAutor?: string | null
}

export interface EventoSanitario {
  idEventoSanitario: string
  idAnimal: string
  animalArete?: string | null
  animalNombre?: string | null
  tipo: string
  fecha: string
  sintomas?: string | null
  diagnostico?: string | null
  profesionalDiagnostico?: string | null
  evidenciaDiagnosticoUri?: string | null
  responsable: string
  observaciones?: string | null
  idAutor: string
  creadoEn: string
  versionRegistro: number
  eliminadoEn?: string | null
  tratamientos: Tratamiento[]
}

export interface EventoSanitarioInput {
  idAnimal: string
  tipo: string
  fecha: string
  sintomas?: string | null
  diagnostico?: string | null
  profesionalDiagnostico?: string | null
  evidenciaDiagnosticoUri?: string | null
  responsable: string
  observaciones?: string | null
  idAutor?: string | null
}

export interface Recordatorio {
  idRecordatorio: string
  idRancho: string
  idAnimal?: string | null
  animalArete?: string | null
  animalNombre?: string | null
  idLote?: string | null
  idTratamiento?: string | null
  tratamientoProducto?: string | null
  idResponsable?: string | null
  tipo: string
  descripcion: string
  fechaProgramada: string
  estado: string
  fechaCompletado?: string | null
  idAutor: string
  creadoEn: string
  versionRegistro: number
  eliminadoEn?: string | null
}

export interface RecordatorioInput {
  idRancho?: string | null
  idAnimal?: string | null
  idLote?: string | null
  idTratamiento?: string | null
  idResponsable?: string | null
  tipo: string
  descripcion: string
  fechaProgramada: string
  estado: string
  fechaCompletado?: string | null
  idAutor?: string | null
}

export const TIPOS_EVENTO_SANITARIO = [
  'Vacunación',
  'Desparasitación',
  'Revisión clínica',
  'Enfermedad',
  'Lesión / Herida',
  'Prueba diagnóstica',
  'Cuarentena',
  'Cirugía menor',
] as const

export const UNIDADES_DOSIS = [
  'ml',
  'mg',
  'g',
  'UI',
  'dosis',
  'tableta',
  'bolo',
] as const

export const VIAS_ADMINISTRACION = [
  'Intramuscular (IM)',
  'Subcutánea (SC)',
  'Oral (PO)',
  'Intravenosa (IV)',
  'Tópica / Pour-on',
  'Intramamaria',
] as const

export const ESTADOS_TRATAMIENTO = [
  'En curso',
  'Programado',
  'Completado',
  'Suspendido',
] as const

export const TIPOS_RECORDATORIO = [
  'Aplicación de tratamiento',
  'Refuerzo de vacuna',
  'Desparasitación programada',
  'Revisión veterinaria',
  'Retiro de cuarentena',
  'Sanidad general del rancho',
] as const

export const ESTADOS_RECORDATORIO = [
  'Pendiente',
  'Completado',
  'Cancelado',
] as const
