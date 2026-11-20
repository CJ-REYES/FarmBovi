import { describe, it, expect } from 'vitest';
import type { Cattle, LotOption } from '../types/cattle';
import type { MovementInput } from '../types/movement';
import {
  MOVEMENT_FIELD_LIMITS,
  normalizeMovementInput,
  normalizeMovementType,
  validateMovementInput
} from './movement.validation';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const LOT_A1 = '33333333-3333-4333-8333-333333333331';
const LOT_A2 = '33333333-3333-4333-8333-333333333332';
const LOT_B1 = '33333333-3333-4333-8333-333333333333';
const ANIMAL_ACTIVE = '44444444-4444-4444-8444-444444444441';
const ANIMAL_SOLD = '44444444-4444-4444-8444-444444444442';

const LOTS: LotOption[] = [
  { id: LOT_A1, idRancho: RANCH_A, nombre: 'Potrero Norte', ubicacion: null, estado: 'Activo' },
  { id: LOT_A2, idRancho: RANCH_A, nombre: 'Potrero Sur', ubicacion: null, estado: 'Activo' },
  { id: LOT_B1, idRancho: RANCH_B, nombre: 'Potrero Otro Rancho', ubicacion: null, estado: 'Activo' }
];

const ANIMALS: Cattle[] = [
  {
    id: ANIMAL_ACTIVE,
    idAnimal: ANIMAL_ACTIVE,
    idRancho: RANCH_A,
    idLote: LOT_A1,
    arete: 'MX-100',
    raza: 'Brahman',
    sexo: 'Hembra',
    fechaNacimiento: '2024-05-10',
    fechaIngreso: '2024-05-10',
    procedencia: 'Propio',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2024-05-10T00:00:00Z',
    updatedAt: '2024-05-10T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  },
  {
    id: ANIMAL_SOLD,
    idAnimal: ANIMAL_SOLD,
    idRancho: RANCH_A,
    idLote: null,
    arete: 'MX-200',
    raza: 'Angus',
    sexo: 'Macho',
    fechaNacimiento: '2023-01-10',
    fechaIngreso: '2023-01-10',
    procedencia: 'Propio',
    estado: 'Vendido',
    fechaSalida: '2025-10-01',
    observaciones: null,
    versionRegistro: 2,
    createdAt: '2023-01-10T00:00:00Z',
    updatedAt: '2025-10-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

function validInternalMove(overrides: Partial<MovementInput> = {}): MovementInput {
  return {
    idAnimal: ANIMAL_ACTIVE,
    tipo: 'CambioInterno',
    fecha: '2026-03-10T09:30',
    idLoteOrigen: LOT_A1,
    idLoteDestino: LOT_A2,
    origenExterno: null,
    destinoExterno: null,
    motivo: 'Rotación de pradera',
    ...overrides
  };
}

describe('movement.validation', () => {
  it('acepta movimientos válidos y normaliza tipos y campos según el tipo', () => {
    expect(normalizeMovementType('Cambio interno')).toBe('CambioInterno');
    expect(normalizeMovementType('venta')).toBe('Venta');

    const normalized = normalizeMovementInput(
      validInternalMove({
        origenExterno: 'Debe limpiarse en CambioInterno',
        destinoExterno: 'Debe limpiarse',
        motivo: '  Rotación mensual  '
      })
    );
    expect(normalized.origenExterno).toBeNull();
    expect(normalized.destinoExterno).toBeNull();
    expect(normalized.motivo).toBe('Rotación mensual');

    const errors = validateMovementInput(normalized, {
      animals: ANIMALS,
      lots: LOTS,
      now: new Date('2026-03-15T12:00:00Z')
    });
    expect(errors).toEqual({});
  });

  it('rechaza campos obligatorios faltantes e impide mover un animal ya vendido o dado de baja', () => {
    const emptyErrors = validateMovementInput(
      validInternalMove({ idAnimal: '', fecha: '', idLoteDestino: null }),
      { animals: ANIMALS, lots: LOTS }
    );
    expect(emptyErrors.idAnimal).toMatch(/seleccionar el animal/i);
    expect(emptyErrors.fecha).toMatch(/obligatoria/i);
    expect(emptyErrors.idLoteDestino).toMatch(/potrero de destino/i);

    const soldErrors = validateMovementInput(
      validInternalMove({ idAnimal: ANIMAL_SOLD, idLoteOrigen: null }),
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(soldErrors.idAnimal).toMatch(/Vendido/i);

    // Un Alta sí permite reingresar un animal vendido
    const reentryErrors = validateMovementInput(
      {
        idAnimal: ANIMAL_SOLD,
        tipo: 'Alta',
        fecha: '2026-03-10T10:00',
        idLoteOrigen: null,
        idLoteDestino: LOT_A1,
        origenExterno: 'Recompra',
        destinoExterno: null,
        motivo: 'Reingreso al rancho'
      },
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(reentryErrors).toEqual({});
  });

  it('impide movimientos inconsistentes: origen igual a destino o destino al mismo potrero actual', () => {
    const sameLotErrors = validateMovementInput(
      validInternalMove({ idLoteOrigen: LOT_A1, idLoteDestino: LOT_A1 }),
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(sameLotErrors.idLoteDestino).toMatch(/no puede ser igual/i);

    const alreadyInLotErrors = validateMovementInput(
      validInternalMove({ idLoteOrigen: null, idLoteDestino: LOT_A1 }),
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(alreadyInLotErrors.idLoteDestino).toMatch(/ya se encuentra asignado/i);
  });

  it('rechaza potrero de destino de otro rancho en Alta o CambioInterno (regla del Backend)', () => {
    const crossRanchErrors = validateMovementInput(
      validInternalMove({ idLoteDestino: LOT_B1 }),
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(crossRanchErrors.idLoteDestino).toMatch(/mismo rancho/i);
  });

  it('valida fechas futuras y fechas anteriores al nacimiento del animal', () => {
    const futureErrors = validateMovementInput(
      validInternalMove({ fecha: '2026-03-20T10:00' }),
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(futureErrors.fecha).toMatch(/futuro/i);

    const beforeBirthErrors = validateMovementInput(
      validInternalMove({ fecha: '2024-01-01T10:00' }),
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(beforeBirthErrors.fecha).toMatch(/nacimiento/i);
  });

  it('valida reglas específicas de Traslado, Venta, Baja y longitudes máximas', () => {
    const trasladoSinDestino = validateMovementInput(
      {
        idAnimal: ANIMAL_ACTIVE,
        tipo: 'Traslado',
        fecha: '2026-03-10T09:00',
        idLoteOrigen: LOT_A1,
        idLoteDestino: null,
        origenExterno: null,
        destinoExterno: null,
        motivo: null
      },
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(trasladoSinDestino.destinoExterno).toMatch(/destino/i);

    const bajaSinMotivo = validateMovementInput(
      {
        idAnimal: ANIMAL_ACTIVE,
        tipo: 'Baja',
        fecha: '2026-03-10T09:00',
        idLoteOrigen: LOT_A1,
        idLoteDestino: null,
        origenExterno: null,
        destinoExterno: null,
        motivo: null
      },
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(bajaSinMotivo.motivo).toMatch(/obligatorio/i);

    const lengthErrors = validateMovementInput(
      {
        idAnimal: ANIMAL_ACTIVE,
        tipo: 'Traslado',
        fecha: '2026-03-10T09:00',
        idLoteOrigen: LOT_A1,
        idLoteDestino: null,
        origenExterno: 'O'.repeat(MOVEMENT_FIELD_LIMITS.origenExternoMax + 1),
        destinoExterno: 'D'.repeat(MOVEMENT_FIELD_LIMITS.destinoExternoMax + 1),
        motivo: 'M'.repeat(MOVEMENT_FIELD_LIMITS.motivoMax + 1)
      },
      { animals: ANIMALS, lots: LOTS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(lengthErrors.origenExterno).toContain(String(MOVEMENT_FIELD_LIMITS.origenExternoMax));
    expect(lengthErrors.destinoExterno).toContain(String(MOVEMENT_FIELD_LIMITS.destinoExternoMax));
    expect(lengthErrors.motivo).toContain(String(MOVEMENT_FIELD_LIMITS.motivoMax));
  });
});
