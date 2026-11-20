import { describe, it, expect } from 'vitest';
import type { Cattle } from '../types/cattle';
import type { Weighing, WeighingInput } from '../types/weighing';
import {
  WEIGHING_FIELD_LIMITS,
  computeWeightAnalytics,
  normalizeWeighingInput,
  validateWeighingInput
} from './weighing.validation';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';

const ANIMALS: Cattle[] = [
  {
    id: ANIMAL_1,
    idAnimal: ANIMAL_1,
    idRancho: RANCH_A,
    idLote: null,
    arete: 'MX-700',
    raza: 'Brahman',
    sexo: 'Macho',
    fechaNacimiento: '2024-06-01',
    fechaIngreso: '2024-06-01',
    procedencia: 'Propio',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

function validInput(overrides: Partial<WeighingInput> = {}): WeighingInput {
  return {
    idAnimal: ANIMAL_1,
    pesoRealKg: '412.5',
    fecha: '2026-03-10T08:00',
    fuenteBascula: 'Báscula digital corral 1',
    responsable: 'Carlos Reyes',
    observaciones: 'Pesaje matutino en ayuno',
    ...overrides
  };
}

describe('weighing.validation y analítica real de crecimiento', () => {
  it('acepta pesaje válido y normaliza decimales y espacios', () => {
    const normalized = normalizeWeighingInput(
      validInput({
        pesoRealKg: ' 412,5678 ',
        fuenteBascula: '  Báscula 1  ',
        responsable: '  Carlos  ',
        observaciones: '   '
      })
    );

    expect(normalized.pesoRealKg).toBe(412.568);
    expect(normalized.fuenteBascula).toBe('Báscula 1');
    expect(normalized.responsable).toBe('Carlos');
    expect(normalized.observaciones).toBeNull();

    const errors = validateWeighingInput(validInput(), {
      animals: ANIMALS,
      now: new Date('2026-03-15T12:00:00Z')
    });
    expect(errors).toEqual({});
  });

  it('rechaza pesos inválidos (<= 0, no numéricos o fuera de rango) y campos obligatorios vacíos', () => {
    expect(
      validateWeighingInput(validInput({ pesoRealKg: '0' }), { animals: ANIMALS }).pesoRealKg
    ).toMatch(/positivo mayor que cero/i);

    expect(
      validateWeighingInput(validInput({ pesoRealKg: '-45' }), { animals: ANIMALS }).pesoRealKg
    ).toMatch(/positivo mayor que cero/i);

    expect(
      validateWeighingInput(validInput({ pesoRealKg: WEIGHING_FIELD_LIMITS.pesoMaxKg + 1 }), {
        animals: ANIMALS
      }).pesoRealKg
    ).toContain(String(WEIGHING_FIELD_LIMITS.pesoMaxKg));

    const emptyErrors = validateWeighingInput(
      validInput({ idAnimal: '', pesoRealKg: '', fecha: '', fuenteBascula: '', responsable: '' }),
      { animals: ANIMALS }
    );
    expect(emptyErrors.idAnimal).toMatch(/seleccionar el animal/i);
    expect(emptyErrors.pesoRealKg).toMatch(/mayor que cero/i);
    expect(emptyErrors.fecha).toMatch(/obligatorias/i);
    expect(emptyErrors.fuenteBascula).toMatch(/obligatoria/i);
    expect(emptyErrors.responsable).toMatch(/obligatorio/i);
  });

  it('rechaza fechas futuras y fechas anteriores al nacimiento del animal', () => {
    const futureErrors = validateWeighingInput(validInput({ fecha: '2026-03-20T08:00' }), {
      animals: ANIMALS,
      now: new Date('2026-03-15T12:00:00Z')
    });
    expect(futureErrors.fecha).toMatch(/futuro/i);

    const beforeBirthErrors = validateWeighingInput(validInput({ fecha: '2024-01-01T08:00' }), {
      animals: ANIMALS,
      now: new Date('2026-03-15T12:00:00Z')
    });
    expect(beforeBirthErrors.fecha).toMatch(/nacimiento/i);
  });

  it('calcula último peso real, delta y GDP exacta sin generar datos ficticios', () => {
    // Con 0 pesajes -> todo nulo/vacío
    const empty = computeWeightAnalytics([], ANIMALS);
    expect(empty.latestWeighing).toBeNull();
    expect(empty.averageGdpKgDay).toBeNull();
    expect(empty.evolutionPoints).toHaveLength(0);

    const w1: Weighing = {
      id: 'w-1',
      idPesaje: 'w-1',
      idRancho: RANCH_A,
      idAnimal: ANIMAL_1,
      pesoRealKg: 300,
      fecha: '2026-02-01T08:00:00',
      fuenteBascula: 'Báscula 1',
      responsable: 'Carlos',
      observaciones: null,
      origenPesaje: 'manual',
      sourceAnalysisJobId: null,
      sourceMediaId: null,
      versionRegistro: 1,
      createdAt: '2026-02-01T08:00:00Z',
      updatedAt: '2026-02-01T08:00:00Z',
      deletedAt: null,
      syncStatus: 'pending'
    };

    const w2: Weighing = {
      ...w1,
      id: 'w-2',
      idPesaje: 'w-2',
      pesoRealKg: 320,
      fecha: '2026-02-21T08:00:00',
      createdAt: '2026-02-21T08:00:00Z',
      updatedAt: '2026-02-21T08:00:00Z'
    };

    const wDeleted: Weighing = {
      ...w1,
      id: 'w-deleted',
      idPesaje: 'w-deleted',
      pesoRealKg: 999,
      fecha: '2026-03-01T08:00:00',
      deletedAt: '2026-03-02T00:00:00Z'
    };

    const analytics = computeWeightAnalytics([w2, w1, wDeleted], ANIMALS, ANIMAL_1);
    expect(analytics.latestWeighing?.id).toBe('w-2');
    expect(analytics.latestWeighing?.pesoRealKg).toBe(320);
    // +20 kg en 20 días exactos = 1.0 kg/día
    expect(analytics.averageGdpKgDay).toBe(1);
    expect(analytics.deltaByWeighingId.get('w-2')?.deltaKg).toBe(20);
    expect(analytics.deltaByWeighingId.get('w-2')?.gdpKgDay).toBe(1);
    expect(analytics.evolutionPoints.map((p) => p.pesoKg)).toEqual([300, 320]);
  });
});
