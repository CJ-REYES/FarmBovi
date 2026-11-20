import { describe, it, expect } from 'vitest';
import type { RanchOption } from '../types/cattle';
import type { LotInput } from '../types/lot';
import {
  LOT_FIELD_LIMITS,
  normalizeLotEstado,
  normalizeLotInput,
  validateLotInput
} from './lot.validation';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const FOREIGN_RANCH = '99999999-9999-4999-8999-999999999999';

const ACTIVE_RANCHES: RanchOption[] = [
  { id: RANCH_A, nombre: 'Rancho La Esperanza', ubicacionGeneral: 'Candelaria', estado: 'Activo' },
  { id: RANCH_B, nombre: 'Rancho San Miguel', ubicacionGeneral: 'Escárcega', estado: 'Activo' }
];

function validInput(overrides: Partial<LotInput> = {}): LotInput {
  return {
    idRancho: RANCH_A,
    nombre: 'Potrero La Ceiba',
    ubicacion: 'Sector Norte, junto al jagüey',
    estado: 'Activo',
    ...overrides
  };
}

describe('lot.validation', () => {
  it('acepta una entrada válida y normaliza espacios y valores opcionales', () => {
    const raw = validInput({
      idRancho: `  ${RANCH_A}  `,
      nombre: '  Potrero Sur  ',
      ubicacion: '   ',
      estado: 'Activo'
    });

    const normalized = normalizeLotInput(raw);
    expect(normalized).toEqual({
      idRancho: RANCH_A,
      nombre: 'Potrero Sur',
      ubicacion: null,
      estado: 'Activo'
    });

    const errors = validateLotInput(normalized, { ranches: ACTIVE_RANCHES });
    expect(errors).toEqual({});
  });

  it('normaliza correctamente el estado del lote', () => {
    expect(normalizeLotEstado('Inactivo')).toBe('Inactivo');
    expect(normalizeLotEstado('  inactivo ')).toBe('Inactivo');
    expect(normalizeLotEstado('Activo')).toBe('Activo');
    expect(normalizeLotEstado(undefined)).toBe('Activo');
    expect(normalizeLotEstado('')).toBe('Activo');
  });

  it('rechaza campos obligatorios faltantes (rancho y nombre)', () => {
    const errors = validateLotInput(
      validInput({ idRancho: '', nombre: '   ' }),
      { ranches: ACTIVE_RANCHES }
    );

    expect(errors.idRancho).toMatch(/rancho/i);
    expect(errors.nombre).toMatch(/obligatorio/i);
  });

  it('rechaza UUID de rancho inválido o vacío de ceros', () => {
    const invalidErrors = validateLotInput(validInput({ idRancho: 'no-es-uuid' }));
    expect(invalidErrors.idRancho).toMatch(/UUID válido/i);

    const zeroErrors = validateLotInput(
      validInput({ idRancho: '00000000-0000-0000-0000-000000000000' })
    );
    expect(zeroErrors.idRancho).toMatch(/UUID válido/i);
  });

  it('valida pertenencia al catálogo de ranchos activos del usuario', () => {
    const errors = validateLotInput(validInput({ idRancho: FOREIGN_RANCH }), {
      ranches: ACTIVE_RANCHES
    });
    expect(errors.idRancho).toMatch(/no pertenece a tus ranchos activos/i);
  });

  it('valida longitudes máximas del contrato SQL (Nombre <= 120, Ubicacion <= 250)', () => {
    const errors = validateLotInput(
      validInput({
        nombre: 'A'.repeat(LOT_FIELD_LIMITS.nombreMax + 1),
        ubicacion: 'U'.repeat(LOT_FIELD_LIMITS.ubicacionMax + 1)
      }),
      { ranches: ACTIVE_RANCHES }
    );

    expect(errors.nombre).toContain(String(LOT_FIELD_LIMITS.nombreMax));
    expect(errors.ubicacion).toContain(String(LOT_FIELD_LIMITS.ubicacionMax));
  });

  it('reporta error de duplicado cuando existe otro potrero con el mismo nombre en el rancho', () => {
    const errors = validateLotInput(validInput(), {
      ranches: ACTIVE_RANCHES,
      duplicateNameExists: true
    });
    expect(errors.nombre).toMatch(/Ya existe un potrero/i);
  });
});
