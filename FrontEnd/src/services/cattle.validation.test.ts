import { describe, it, expect } from 'vitest';
import {
  calculateAnimalAge,
  isValidGuid,
  normalizeCattleInput,
  validateCattleInput
} from './cattle.validation';
import type { CattleInput, LotOption, RanchOption } from '../types/cattle';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const LOT_A = '33333333-3333-4333-8333-333333333333';
const LOT_B = '44444444-4444-4444-8444-444444444444';

const ranches: RanchOption[] = [
  { id: RANCH_A, nombre: 'Rancho Norte', ubicacionGeneral: 'Campeche', estado: 'Activo' },
  { id: RANCH_B, nombre: 'Rancho Sur', ubicacionGeneral: 'Tabasco', estado: 'Activo' }
];

const lots: LotOption[] = [
  { id: LOT_A, idRancho: RANCH_A, nombre: 'Potrero 1', ubicacion: 'Norte', estado: 'Activo' },
  { id: LOT_B, idRancho: RANCH_B, nombre: 'Potrero Sur', ubicacion: 'Sur', estado: 'Activo' }
];

function validInput(overrides: Partial<CattleInput> = {}): CattleInput {
  return {
    idRancho: RANCH_A,
    idLote: LOT_A,
    arete: 'MX-1001',
    raza: 'Brahman',
    sexo: 'Hembra',
    fechaNacimiento: '2024-03-10',
    fechaIngreso: '2025-01-15',
    procedencia: 'Propio',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: 'Sin incidencias',
    ...overrides
  };
}

describe('cattle.validation', () => {
  it('valida correctamente un animal completo conforme al contrato Backend', () => {
    const errors = validateCattleInput(validInput(), {
      ranches,
      lots,
      today: '2026-11-19'
    });
    expect(errors).toEqual({});
  });

  it('reporta errores específicos cuando faltan campos obligatorios', () => {
    const errors = validateCattleInput(
      {
        idRancho: '',
        idLote: null,
        arete: '   ',
        raza: '',
        sexo: 'Hembra',
        fechaNacimiento: null,
        fechaIngreso: '',
        procedencia: '',
        estado: 'Activo',
        fechaSalida: null,
        observaciones: null
      },
      { today: '2026-11-19' }
    );

    expect(errors.idRancho).toBeDefined();
    expect(errors.arete).toBeDefined();
    expect(errors.raza).toBeDefined();
    expect(errors.fechaIngreso).toBeDefined();
    expect(errors.procedencia).toBeDefined();
  });

  it('rechaza UUID inválido para rancho o potrero y rechaza lote de otro rancho (Regla 04)', () => {
    expect(isValidGuid('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(isValidGuid('123')).toBe(false);
    expect(isValidGuid(RANCH_A)).toBe(true);

    const wrongLotErrors = validateCattleInput(validInput({ idRancho: RANCH_A, idLote: LOT_B }), {
      ranches,
      lots,
      today: '2026-11-19'
    });
    expect(wrongLotErrors.idLote).toMatch(/mismo rancho/i);
  });

  it('valida coherencia de fechas y obligatoriedad de fechaSalida en Vendido/Baja (Regla 08)', () => {
    const errors = validateCattleInput(
      validInput({
        fechaNacimiento: '2026-12-01',
        fechaIngreso: '2026-11-10',
        estado: 'Vendido',
        fechaSalida: null
      }),
      { ranches, lots, today: '2026-11-19' }
    );

    expect(errors.fechaNacimiento).toMatch(/futura/i);
    expect(errors.fechaIngreso).toMatch(/anterior a la fecha de nacimiento/i);
    expect(errors.fechaSalida).toMatch(/fecha de salida/i);
  });

  it('bloquea arete duplicado en el mismo rancho (Regla 03)', () => {
    const errors = validateCattleInput(validInput(), {
      ranches,
      lots,
      duplicateAreteExists: true,
      today: '2026-11-19'
    });
    expect(errors.arete).toMatch(/ya existe/i);
  });

  it('normaliza espacios y limpia fechaSalida cuando el animal está Activo', () => {
    const normalized = normalizeCattleInput(
      validInput({
        arete: '  MX-200  ',
        procedencia: '  Compra  ',
        estado: 'Activo',
        fechaSalida: '2026-01-01'
      })
    );
    expect(normalized.arete).toBe('MX-200');
    expect(normalized.procedencia).toBe('Compra');
    expect(normalized.fechaSalida).toBeNull();
  });

  it('calcula edad derivada de forma determinista', () => {
    expect(calculateAnimalAge('2024-05-10', new Date(2026, 10, 19))).toBe('2 años, 6 meses');
    expect(calculateAnimalAge('2026-08-01', new Date(2026, 10, 19))).toBe('3 meses');
    expect(calculateAnimalAge(null)).toBe('Sin fecha');
  });
});
