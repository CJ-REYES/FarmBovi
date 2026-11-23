import { describe, expect, it } from 'vitest';
import type { Cattle, RanchOption } from '../types/cattle';
import type { Lot } from '../types/lot';
import type { Treatment } from '../types/health';
import {
  classifyAlertTiming,
  formatAlertRelativeTiming,
  validateAlertInput
} from './alert.validation';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const ANIMAL_A = '33333333-3333-4333-8333-333333333333';
const ANIMAL_B = '44444444-4444-4444-8444-444444444444';
const LOT_A = '55555555-5555-4555-8555-555555555555';
const EVENT_A = '66666666-6666-4666-8666-666666666666';
const TREATMENT_A = '77777777-7777-4777-8777-777777777777';

const RANCHES: RanchOption[] = [
  { id: RANCH_A, nombre: 'El Porvenir', ubicacionGeneral: 'Veracruz', estado: 'Activo' },
  { id: RANCH_B, nombre: 'La Loma', ubicacionGeneral: 'Tabasco', estado: 'Activo' }
];

const ANIMALS: Cattle[] = [
  {
    id: ANIMAL_A,
    idAnimal: ANIMAL_A,
    idRancho: RANCH_A,
    idLote: LOT_A,
    arete: 'MX-AL-01',
    raza: 'Brahman',
    sexo: 'Hembra',
    fechaNacimiento: '2022-01-01',
    fechaIngreso: '2022-02-01',
    procedencia: 'Rancho',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2022-02-01T00:00:00Z',
    updatedAt: '2022-02-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  },
  {
    id: ANIMAL_B,
    idAnimal: ANIMAL_B,
    idRancho: RANCH_B,
    idLote: null,
    arete: 'MX-AL-02',
    raza: 'Holstein',
    sexo: 'Macho',
    fechaNacimiento: '2022-01-01',
    fechaIngreso: '2022-02-01',
    procedencia: 'Rancho',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2022-02-01T00:00:00Z',
    updatedAt: '2022-02-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

const LOTS: Lot[] = [
  {
    id: LOT_A,
    idLote: LOT_A,
    idRancho: RANCH_A,
    nombre: 'Potrero Norte',
    ubicacion: 'Zona A',
    estado: 'Activo',
    activeAnimalsCount: 1,
    versionRegistro: 1,
    createdAt: '2022-01-01T00:00:00Z',
    updatedAt: '2022-01-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

const TREATMENTS: Treatment[] = [
  {
    id: TREATMENT_A,
    idTratamiento: TREATMENT_A,
    idEventoSanitario: EVENT_A,
    idAnimal: ANIMAL_A,
    idRancho: RANCH_A,
    producto: 'Oxitetraciclina LA',
    dosis: 10,
    unidadDosis: 'mL',
    viaAdministracion: 'Intramuscular',
    frecuencia: 'Cada 48 horas',
    fechaInicio: '2026-11-18T08:00:00',
    fechaFin: '2026-11-22T08:00:00',
    responsable: 'MVZ Ruiz',
    prescripcionUri: null,
    estado: 'Pendiente',
    versionRegistro: 1,
    createdAt: '2026-11-18T08:00:00Z',
    updatedAt: '2026-11-18T08:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

describe('alert.validation', () => {
  it('valida campos obligatorios y límites exactos de longitud del Backend', () => {
    const emptyErrors = validateAlertInput(
      {
        idRancho: '',
        idAnimal: null,
        idLote: null,
        idTratamiento: null,
        idResponsable: null,
        tipo: '   ',
        descripcion: '  ',
        fechaProgramada: '',
        estado: 'Pendiente',
        fechaCompletado: null
      },
      { ranches: RANCHES, animals: ANIMALS, lots: LOTS, treatments: TREATMENTS }
    );

    expect(emptyErrors.idRancho).toBeTruthy();
    expect(emptyErrors.tipo).toBeTruthy();
    expect(emptyErrors.descripcion).toBeTruthy();
    expect(emptyErrors.fechaProgramada).toBeTruthy();

    const tooLongErrors = validateAlertInput(
      {
        idRancho: RANCH_A,
        idAnimal: null,
        idLote: null,
        idTratamiento: null,
        idResponsable: null,
        tipo: 'X'.repeat(36),
        descripcion: 'D'.repeat(251),
        fechaProgramada: '2026-11-20T09:00',
        estado: 'Pendiente',
        fechaCompletado: null
      },
      { ranches: RANCHES }
    );
    expect(tooLongErrors.tipo).toMatch(/35/);
    expect(tooLongErrors.descripcion).toMatch(/250/);
  });

  it('aplica Regla 12 (animal y lote excluyentes) y reglas de pertenencia de rancho y tratamiento', () => {
    const bothAnimalAndLot = validateAlertInput(
      {
        idRancho: RANCH_A,
        idAnimal: ANIMAL_A,
        idLote: LOT_A,
        idTratamiento: null,
        idResponsable: null,
        tipo: 'Vacunación',
        descripcion: 'Aplicar dosis',
        fechaProgramada: '2026-11-20T09:00',
        estado: 'Pendiente',
        fechaCompletado: null
      },
      { ranches: RANCHES, animals: ANIMALS, lots: LOTS, treatments: TREATMENTS }
    );
    expect(bothAnimalAndLot.idLote).toMatch(/excluyentes/i);

    const treatmentWithLot = validateAlertInput(
      {
        idRancho: RANCH_A,
        idAnimal: null,
        idLote: LOT_A,
        idTratamiento: TREATMENT_A,
        idResponsable: null,
        tipo: 'Tratamiento',
        descripcion: 'Refuerzo antibiótico',
        fechaProgramada: '2026-11-20T09:00',
        estado: 'Pendiente',
        fechaCompletado: null
      },
      { ranches: RANCHES, animals: ANIMALS, lots: LOTS, treatments: TREATMENTS }
    );
    expect(treatmentWithLot.idTratamiento).toMatch(/no puede asignarse a un lote/i);

    const crossRanchAnimal = validateAlertInput(
      {
        idRancho: RANCH_A,
        idAnimal: ANIMAL_B,
        idLote: null,
        idTratamiento: null,
        idResponsable: null,
        tipo: 'Pesaje',
        descripcion: 'Pesaje mensual',
        fechaProgramada: '2026-11-20T09:00',
        estado: 'Pendiente',
        fechaCompletado: null
      },
      { ranches: RANCHES, animals: ANIMALS, lots: LOTS, treatments: TREATMENTS }
    );
    expect(crossRanchAnimal.idAnimal).toMatch(/pertenecer al rancho/i);
  });

  it('clasifica correctamente alertas vencidas, próximas, programadas, completadas y canceladas', () => {
    const now = new Date('2026-11-19T12:00:00Z');

    expect(
      classifyAlertTiming({ estado: 'Pendiente', fechaProgramada: '2026-11-17T12:00:00Z' }, now)
    ).toBe('vencida');
    expect(
      formatAlertRelativeTiming(
        { estado: 'Pendiente', fechaProgramada: '2026-11-17T12:00:00Z' },
        now
      )
    ).toMatch(/Vencida hace 2 días/i);

    expect(
      classifyAlertTiming({ estado: 'Pendiente', fechaProgramada: '2026-11-22T12:00:00Z' }, now)
    ).toBe('proxima');
    expect(
      formatAlertRelativeTiming(
        { estado: 'Pendiente', fechaProgramada: '2026-11-22T12:00:00Z' },
        now
      )
    ).toMatch(/En 3 días/i);

    expect(
      classifyAlertTiming({ estado: 'En curso', fechaProgramada: '2026-12-10T12:00:00Z' }, now)
    ).toBe('programada');

    expect(
      classifyAlertTiming({ estado: 'Completado', fechaProgramada: '2026-11-01T12:00:00Z' }, now)
    ).toBe('completada');

    expect(
      classifyAlertTiming({ estado: 'Cancelado', fechaProgramada: '2026-11-01T12:00:00Z' }, now)
    ).toBe('cancelada');
  });
});
