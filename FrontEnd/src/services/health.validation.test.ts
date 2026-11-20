import { describe, it, expect } from 'vitest';
import type { Cattle } from '../types/cattle';
import type { HealthEvent, HealthEventInput, TreatmentInput } from '../types/health';
import {
  HEALTH_EVENT_LIMITS,
  TREATMENT_LIMITS,
  isTreatmentPending,
  normalizeHealthEventInput,
  normalizeTreatmentInput,
  validateHealthEventInput,
  validateTreatmentInput
} from './health.validation';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';
const EVENT_1 = '44444444-4444-4444-8444-444444444441';

const ANIMALS: Cattle[] = [
  {
    id: ANIMAL_1,
    idAnimal: ANIMAL_1,
    idRancho: RANCH_A,
    idLote: null,
    arete: 'MX-910',
    raza: 'Brahman',
    sexo: 'Hembra',
    fechaNacimiento: '2024-03-01',
    fechaIngreso: '2024-03-01',
    procedencia: 'Propio',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2024-03-01T00:00:00Z',
    updatedAt: '2024-03-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

const EVENTS: HealthEvent[] = [
  {
    id: EVENT_1,
    idEventoSanitario: EVENT_1,
    idRancho: RANCH_A,
    idAnimal: ANIMAL_1,
    tipo: 'Enfermedad',
    fecha: '2026-03-10T09:00:00',
    sintomas: 'Fiebre',
    diagnostico: 'Infección respiratoria',
    profesionalDiagnostico: 'MVZ Laura',
    evidenciaDiagnosticoUri: null,
    responsable: 'Carlos Reyes',
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2026-03-10T09:00:00Z',
    updatedAt: '2026-03-10T09:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  }
];

function validEventInput(overrides: Partial<HealthEventInput> = {}): HealthEventInput {
  return {
    idAnimal: ANIMAL_1,
    tipo: 'Vacunación',
    fecha: '2026-03-10T09:00',
    sintomas: null,
    diagnostico: 'Preventivo aftosa',
    profesionalDiagnostico: 'MVZ Laura',
    evidenciaDiagnosticoUri: null,
    responsable: 'Carlos Reyes',
    observaciones: 'Lote sano',
    ...overrides
  };
}

function validTreatmentInput(overrides: Partial<TreatmentInput> = {}): TreatmentInput {
  return {
    idEventoSanitario: EVENT_1,
    producto: 'Oxitetraciclina LA',
    dosis: '10.5',
    unidadDosis: 'mL',
    viaAdministracion: 'Intramuscular',
    frecuencia: 'Cada 48 horas',
    fechaInicio: '2026-03-10T10:00',
    fechaFin: '2026-03-16T10:00',
    responsable: 'MVZ Laura',
    prescripcionUri: null,
    estado: 'Pendiente',
    ...overrides
  };
}

describe('health.validation — Eventos Sanitarios y Tratamientos', () => {
  it('valida y normaliza eventos sanitarios válidos', () => {
    const normalized = normalizeHealthEventInput(
      validEventInput({ tipo: '  Vacunación  ', sintomas: '   ', responsable: ' Carlos ' })
    );
    expect(normalized.tipo).toBe('Vacunación');
    expect(normalized.sintomas).toBeNull();
    expect(normalized.responsable).toBe('Carlos');

    expect(
      validateHealthEventInput(normalized, {
        animals: ANIMALS,
        now: new Date('2026-03-15T12:00:00Z')
      })
    ).toEqual({});
  });

  it('rechaza campos obligatorios vacíos, fechas futuras y fechas anteriores al nacimiento en eventos', () => {
    const empty = validateHealthEventInput(
      validEventInput({ idAnimal: '', tipo: '', fecha: '', responsable: '' }),
      { animals: ANIMALS }
    );
    expect(empty.idAnimal).toMatch(/seleccionar el animal/i);
    expect(empty.tipo).toMatch(/obligatorio/i);
    expect(empty.fecha).toMatch(/obligatoria/i);
    expect(empty.responsable).toMatch(/obligatorio/i);

    const future = validateHealthEventInput(validEventInput({ fecha: '2026-03-25T10:00' }), {
      animals: ANIMALS,
      now: new Date('2026-03-15T12:00:00Z')
    });
    expect(future.fecha).toMatch(/futuro/i);

    const beforeBirth = validateHealthEventInput(validEventInput({ fecha: '2023-12-01T10:00' }), {
      animals: ANIMALS,
      now: new Date('2026-03-15T12:00:00Z')
    });
    expect(beforeBirth.fecha).toMatch(/nacimiento/i);

    const tooLong = validateHealthEventInput(
      validEventInput({ tipo: 'T'.repeat(HEALTH_EVENT_LIMITS.tipoMax + 1) }),
      { animals: ANIMALS, now: new Date('2026-03-15T12:00:00Z') }
    );
    expect(tooLong.tipo).toContain(String(HEALTH_EVENT_LIMITS.tipoMax));
  });

  it('valida tratamientos (dosis > 0, fechaFin >= fechaInicio, evento existente) y estados pendientes', () => {
    const normalized = normalizeTreatmentInput(validTreatmentInput({ dosis: '10,2556' }));
    expect(normalized.dosis).toBe(10.256);

    expect(validateTreatmentInput(validTreatmentInput(), { events: EVENTS })).toEqual({});

    const invalid = validateTreatmentInput(
      validTreatmentInput({
        idEventoSanitario: '',
        producto: '',
        dosis: '0',
        unidadDosis: '',
        frecuencia: '',
        fechaInicio: '2026-03-15T10:00',
        fechaFin: '2026-03-10T10:00',
        responsable: ''
      }),
      { events: EVENTS }
    );
    expect(invalid.idEventoSanitario).toMatch(/evento sanitario/i);
    expect(invalid.producto).toMatch(/obligatorio/i);
    expect(invalid.dosis).toMatch(/mayor que cero/i);
    expect(invalid.unidadDosis).toMatch(/obligatoria/i);
    expect(invalid.frecuencia).toMatch(/obligatoria/i);
    expect(invalid.fechaFin).toMatch(/no puede ser anterior/i);
    expect(invalid.responsable).toMatch(/obligatorio/i);

    const tooLong = validateTreatmentInput(
      validTreatmentInput({ producto: 'P'.repeat(TREATMENT_LIMITS.productoMax + 1) }),
      { events: EVENTS }
    );
    expect(tooLong.producto).toContain(String(TREATMENT_LIMITS.productoMax));

    expect(isTreatmentPending('Pendiente')).toBe(true);
    expect(isTreatmentPending('En curso')).toBe(true);
    expect(isTreatmentPending('Completado')).toBe(false);
    expect(isTreatmentPending('Suspendido')).toBe(false);
  });
});
