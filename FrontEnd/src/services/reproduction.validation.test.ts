import { describe, expect, it } from 'vitest';
import type { Cattle } from '../types/cattle';
import {
  classifyReproductionStage,
  normalizeReproductionInput,
  validateReproductionInput
} from './reproduction.validation';

const FEMALE_ID = '11111111-1111-4111-8111-111111111111';
const MALE_ID = '22222222-2222-4222-8222-222222222222';
const RANCH_ID = '33333333-3333-4333-8333-333333333333';

const ANIMALS: Cattle[] = [
  {
    id: FEMALE_ID,
    idAnimal: FEMALE_ID,
    idRancho: RANCH_ID,
    idLote: null,
    arete: 'MX-H-101',
    raza: 'Holstein',
    sexo: 'Hembra',
    fechaNacimiento: '2022-05-10',
    fechaIngreso: '2022-06-01',
    procedencia: 'Nacimiento en rancho',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2022-06-01T00:00:00Z',
    updatedAt: '2022-06-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  },
  {
    id: MALE_ID,
    idAnimal: MALE_ID,
    idRancho: RANCH_ID,
    idLote: null,
    arete: 'MX-M-202',
    raza: 'Brahman',
    sexo: 'Macho',
    fechaNacimiento: '2021-03-15',
    fechaIngreso: '2021-04-01',
    procedencia: 'Compra',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2021-04-01T00:00:00Z',
    updatedAt: '2021-04-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

describe('reproduction.validation', () => {
  it('valida campos obligatorios y normaliza entradas opcionales', () => {
    const errors = validateReproductionInput(
      {
        idAnimal: '',
        tipo: '   ',
        fecha: '',
        resultado: null,
        observaciones: null
      },
      { animals: ANIMALS }
    );

    expect(errors.idAnimal).toBeTruthy();
    expect(errors.tipo).toBeTruthy();
    expect(errors.fecha).toBeTruthy();

    const normalized = normalizeReproductionInput({
      idAnimal: ` ${FEMALE_ID} `,
      tipo: '  Inseminación Artificial  ',
      fecha: ' 2026-11-10T09:30 ',
      resultado: '   ',
      observaciones: '  Pajilla toro #44  '
    });
    expect(normalized.idAnimal).toBe(FEMALE_ID);
    expect(normalized.tipo).toBe('Inseminación Artificial');
    expect(normalized.resultado).toBeNull();
    expect(normalized.observaciones).toBe('Pajilla toro #44');
  });

  it('impide registrar eventos exclusivos de hembra en un animal Macho, pero permite Monta Natural', () => {
    const femaleOnlyError = validateReproductionInput(
      {
        idAnimal: MALE_ID,
        tipo: 'Parto',
        fecha: '2026-11-10T08:00',
        resultado: 'Cría Viva',
        observaciones: null
      },
      { animals: ANIMALS, now: new Date('2026-11-19T12:00:00Z') }
    );
    expect(femaleOnlyError.idAnimal).toMatch(/solo aplica a hembras/i);

    const neutralAllowed = validateReproductionInput(
      {
        idAnimal: MALE_ID,
        tipo: 'Monta Natural',
        fecha: '2026-11-10T08:00',
        resultado: 'Exitoso',
        observaciones: 'Empadre en potrero norte'
      },
      { animals: ANIMALS, now: new Date('2026-11-19T12:00:00Z') }
    );
    expect(neutralAllowed).toEqual({});
  });

  it('rechaza fechas futuras y fechas anteriores al nacimiento del animal', () => {
    const futureErrors = validateReproductionInput(
      {
        idAnimal: FEMALE_ID,
        tipo: 'Celo',
        fecha: '2026-12-25T10:00',
        resultado: null,
        observaciones: null
      },
      { animals: ANIMALS, now: new Date('2026-11-19T12:00:00Z') }
    );
    expect(futureErrors.fecha).toMatch(/futuro/i);

    const beforeBirthErrors = validateReproductionInput(
      {
        idAnimal: FEMALE_ID,
        tipo: 'Celo',
        fecha: '2022-01-10T10:00',
        resultado: null,
        observaciones: null
      },
      { animals: ANIMALS, now: new Date('2026-11-19T12:00:00Z') }
    );
    expect(beforeBirthErrors.fecha).toMatch(/anterior al nacimiento/i);
  });

  it('clasifica correctamente eventos reales en las 3 etapas reproductivas', () => {
    expect(classifyReproductionStage('Inseminación Artificial', null)).toBe('servicios');
    expect(classifyReproductionStage('Celo', 'Pendiente')).toBe('servicios');
    expect(classifyReproductionStage('Palpación / Diagnóstico', 'Positivo / Gestante')).toBe(
      'gestaciones'
    );
    expect(classifyReproductionStage('Gestación Confirmada', null)).toBe('gestaciones');
    expect(classifyReproductionStage('Parto', 'Cría Viva')).toBe('partos');
    expect(classifyReproductionStage('Destete', null)).toBe('partos');
  });
});
