import { describe, it, expect } from 'vitest';
import type { Cattle, LotOption } from '../types/cattle';
import type { FeedingInput } from '../types/feeding';
import {
  FEEDING_FIELD_LIMITS,
  normalizeFeedingInput,
  validateFeedingInput
} from './feeding.validation';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const LOT_1 = '22222222-2222-4222-8222-222222222221';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';

const LOTS: LotOption[] = [
  { id: LOT_1, idRancho: RANCH_A, nombre: 'Potrero Engorda', ubicacion: 'Norte', estado: 'Activo' }
];

const ANIMALS: Cattle[] = [
  {
    id: ANIMAL_1,
    idAnimal: ANIMAL_1,
    idRancho: RANCH_A,
    idLote: LOT_1,
    arete: 'MX-401',
    raza: 'Brahman',
    sexo: 'Macho',
    fechaNacimiento: '2024-01-10',
    fechaIngreso: '2024-01-10',
    procedencia: 'Propio',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2024-01-10T00:00:00Z',
    updatedAt: '2024-01-10T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

function validLotFeeding(overrides: Partial<FeedingInput> = {}): FeedingInput {
  return {
    idAnimal: null,
    idLote: LOT_1,
    alimento: 'Silo de maíz',
    racion: 'Engorda fase 1',
    cantidad: '18.5',
    unidad: 'kg',
    frecuencia: '2 veces al día',
    inicio: '2026-03-01T07:00',
    fin: '2026-03-31T18:00',
    cambioDieta: 'Suplemento mineral',
    ...overrides
  };
}

describe('feeding.validation', () => {
  it('acepta registros válidos por lote y por animal individual, normalizando decimales y espacios', () => {
    const lotNormalized = normalizeFeedingInput(
      validLotFeeding({ alimento: '  Silo de maíz  ', cantidad: '12,3456', unidad: ' kg ' })
    );
    expect(lotNormalized.alimento).toBe('Silo de maíz');
    expect(lotNormalized.cantidad).toBe(12.346);
    expect(lotNormalized.unidad).toBe('kg');

    expect(validateFeedingInput(validLotFeeding(), { animals: ANIMALS, lots: LOTS })).toEqual({});

    const animalInput = validLotFeeding({ idLote: null, idAnimal: ANIMAL_1 });
    expect(validateFeedingInput(animalInput, { animals: ANIMALS, lots: LOTS })).toEqual({});
  });

  it('aplica la Regla 05 del Backend: XOR(idAnimal, idLote)', () => {
    const noneErrors = validateFeedingInput(
      validLotFeeding({ idAnimal: null, idLote: null }),
      { animals: ANIMALS, lots: LOTS }
    );
    expect(noneErrors.target).toMatch(/potrero\/lote o un animal/i);

    const bothErrors = validateFeedingInput(
      validLotFeeding({ idAnimal: ANIMAL_1, idLote: LOT_1 }),
      { animals: ANIMALS, lots: LOTS }
    );
    expect(bothErrors.target).toMatch(/mutuamente excluyentes/i);
  });

  it('rechaza cantidades inválidas (<= 0, no numéricas o mayores a decimal(10,3))', () => {
    expect(
      validateFeedingInput(validLotFeeding({ cantidad: '0' }), { animals: ANIMALS, lots: LOTS })
        .cantidad
    ).toMatch(/mayor que cero/i);

    expect(
      validateFeedingInput(validLotFeeding({ cantidad: '-5' }), { animals: ANIMALS, lots: LOTS })
        .cantidad
    ).toMatch(/mayor que cero/i);

    expect(
      validateFeedingInput(validLotFeeding({ cantidad: '' }), { animals: ANIMALS, lots: LOTS })
        .cantidad
    ).toMatch(/mayor que cero/i);

    expect(
      validateFeedingInput(
        validLotFeeding({ cantidad: FEEDING_FIELD_LIMITS.cantidadMax + 1 }),
        { animals: ANIMALS, lots: LOTS }
      ).cantidad
    ).toContain(String(FEEDING_FIELD_LIMITS.cantidadMax));
  });

  it('rechaza fecha de fin anterior a la fecha de inicio y campos obligatorios vacíos', () => {
    const dateErrors = validateFeedingInput(
      validLotFeeding({ inicio: '2026-03-15T10:00', fin: '2026-03-10T10:00' }),
      { animals: ANIMALS, lots: LOTS }
    );
    expect(dateErrors.fin).toMatch(/no puede ser anterior/i);

    const missingErrors = validateFeedingInput(
      validLotFeeding({
        alimento: '',
        racion: '   ',
        unidad: '',
        frecuencia: '',
        inicio: ''
      }),
      { animals: ANIMALS, lots: LOTS }
    );
    expect(missingErrors.alimento).toMatch(/obligatorio/i);
    expect(missingErrors.racion).toMatch(/obligatoria/i);
    expect(missingErrors.unidad).toMatch(/obligatoria/i);
    expect(missingErrors.frecuencia).toMatch(/obligatoria/i);
    expect(missingErrors.inicio).toMatch(/obligatoria/i);
  });

  it('valida longitudes máximas del contrato SQL y existencia de referencias', () => {
    const lengthErrors = validateFeedingInput(
      validLotFeeding({
        alimento: 'A'.repeat(FEEDING_FIELD_LIMITS.alimentoMax + 1),
        racion: 'R'.repeat(FEEDING_FIELD_LIMITS.racionMax + 1),
        unidad: 'U'.repeat(FEEDING_FIELD_LIMITS.unidadMax + 1),
        frecuencia: 'F'.repeat(FEEDING_FIELD_LIMITS.frecuenciaMax + 1),
        cambioDieta: 'C'.repeat(FEEDING_FIELD_LIMITS.cambioDietaMax + 1)
      }),
      { animals: ANIMALS, lots: LOTS }
    );
    expect(lengthErrors.alimento).toContain(String(FEEDING_FIELD_LIMITS.alimentoMax));
    expect(lengthErrors.racion).toContain(String(FEEDING_FIELD_LIMITS.racionMax));
    expect(lengthErrors.unidad).toContain(String(FEEDING_FIELD_LIMITS.unidadMax));
    expect(lengthErrors.frecuencia).toContain(String(FEEDING_FIELD_LIMITS.frecuenciaMax));
    expect(lengthErrors.cambioDieta).toContain(String(FEEDING_FIELD_LIMITS.cambioDietaMax));

    const missingLotErrors = validateFeedingInput(
      validLotFeeding({ idLote: '99999999-9999-4999-8999-999999999999' }),
      { animals: ANIMALS, lots: LOTS }
    );
    expect(missingLotErrors.idLote).toMatch(/no existe/i);
  });
});
