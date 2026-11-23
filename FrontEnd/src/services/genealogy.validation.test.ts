import { describe, expect, it } from 'vitest';
import type { Cattle } from '../types/cattle';
import type { GenealogyRecord } from '../types/genealogy';
import {
  buildAnimalGenealogyProfile,
  validateGenealogyInput
} from './genealogy.validation';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '99999999-9999-4999-8999-999999999999';
const GRANDPA_ID = '22222222-2222-4222-8222-222222222222';
const FATHER_ID = '33333333-3333-4333-8333-333333333333';
const MOTHER_ID = '44444444-4444-4444-8444-444444444444';
const CALF_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_RANCH_BULL = '66666666-6666-4666-8666-666666666666';

function makeAnimal(
  id: string,
  arete: string,
  sexo: 'Macho' | 'Hembra',
  fechaNacimiento: string,
  idRancho = RANCH_A
): Cattle {
  return {
    id,
    idAnimal: id,
    idRancho,
    idLote: null,
    arete,
    raza: 'Brahman',
    sexo,
    fechaNacimiento,
    fechaIngreso: fechaNacimiento,
    procedencia: 'Rancho',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'synced'
  };
}

const ANIMALS: Cattle[] = [
  makeAnimal(GRANDPA_ID, 'MX-ABU-01', 'Macho', '2018-01-10'),
  makeAnimal(FATHER_ID, 'MX-TOR-02', 'Macho', '2020-05-15'),
  makeAnimal(MOTHER_ID, 'MX-VAC-03', 'Hembra', '2020-06-20'),
  makeAnimal(CALF_ID, 'MX-CRI-04', 'Hembra', '2023-03-01'),
  makeAnimal(OTHER_RANCH_BULL, 'MX-EXT-05', 'Macho', '2019-01-01', RANCH_B)
];

const EXISTING_RECORDS: GenealogyRecord[] = [
  {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    idGenealogia: 'aaaa1111-1111-4111-8111-111111111111',
    idRancho: RANCH_A,
    idAnimal: FATHER_ID,
    idPadre: GRANDPA_ID,
    idMadre: null,
    versionRegistro: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    deletedAt: null,
    syncStatus: 'pending'
  },
  {
    id: 'bbbb2222-2222-4222-8222-222222222222',
    idGenealogia: 'bbbb2222-2222-4222-8222-222222222222',
    idRancho: RANCH_A,
    idAnimal: CALF_ID,
    idPadre: FATHER_ID,
    idMadre: MOTHER_ID,
    versionRegistro: 1,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    deletedAt: null,
    syncStatus: 'pending'
  }
];

describe('genealogy.validation', () => {
  it('impide relaciones duplicadas para un animal con vínculo activo y exige al menos un progenitor', () => {
    const dupErrors = validateGenealogyInput(
      { idAnimal: CALF_ID, idPadre: FATHER_ID, idMadre: null },
      { animals: ANIMALS, existingRecords: EXISTING_RECORDS }
    );
    expect(dupErrors.idAnimal).toMatch(/ya tiene un registro de parentesco activo/i);

    const emptyParents = validateGenealogyInput(
      { idAnimal: MOTHER_ID, idPadre: null, idMadre: null },
      { animals: ANIMALS, existingRecords: EXISTING_RECORDS }
    );
    expect(emptyParents.general).toMatch(/al menos un progenitor/i);
  });

  it('valida sexo, mismo rancho, no auto-parentesco y orden de fecha de nacimiento', () => {
    const badSex = validateGenealogyInput(
      { idAnimal: CALF_ID, idPadre: MOTHER_ID, idMadre: FATHER_ID },
      { animals: ANIMALS, existingRecords: [] }
    );
    expect(badSex.idPadre).toMatch(/debe ser Macho/i);
    expect(badSex.idMadre).toMatch(/debe ser Hembra/i);

    const selfParent = validateGenealogyInput(
      { idAnimal: CALF_ID, idPadre: CALF_ID, idMadre: null },
      { animals: ANIMALS, existingRecords: [] }
    );
    expect(selfParent.idPadre).toMatch(/su propio padre/i);

    const crossRanch = validateGenealogyInput(
      { idAnimal: CALF_ID, idPadre: OTHER_RANCH_BULL, idMadre: null },
      { animals: ANIMALS, existingRecords: [] }
    );
    expect(crossRanch.idPadre).toMatch(/rancho distinto/i);

    const youngerFather = validateGenealogyInput(
      { idAnimal: GRANDPA_ID, idPadre: FATHER_ID, idMadre: null },
      { animals: ANIMALS, existingRecords: [] }
    );
    expect(youngerFather.idPadre).toMatch(/anterior a la del animal/i);
  });

  it('detecta ciclos genealógicos multi-generación', () => {
    const youngBullNoDate = makeAnimal(
      '77777777-7777-4777-8777-777777777777',
      'MX-CYC-01',
      'Macho',
      '2023-05-01'
    );
    const grandpaNoDate: Cattle = { ...ANIMALS[0], fechaNacimiento: null };
    const animalsWithoutBirth = [grandpaNoDate, ANIMALS[1], ANIMALS[2], ANIMALS[3], youngBullNoDate];

    // GRANDPA -> FATHER -> CALF; intentar poner FATHER como padre de GRANDPA forma ciclo
    const cycleErrors = validateGenealogyInput(
      { idAnimal: GRANDPA_ID, idPadre: FATHER_ID, idMadre: null },
      { animals: animalsWithoutBirth, existingRecords: EXISTING_RECORDS }
    );
    expect(cycleErrors.idPadre).toMatch(/ciclo genealógico/i);
  });

  it('construye perfil genealógico real con abuelos, padres y descendientes sin inventar datos', () => {
    const calfProfile = buildAnimalGenealogyProfile(CALF_ID, ANIMALS, EXISTING_RECORDS);
    expect(calfProfile).not.toBeNull();
    expect(calfProfile?.padre?.arete).toBe('MX-TOR-02');
    expect(calfProfile?.madre?.arete).toBe('MX-VAC-03');
    expect(calfProfile?.abueloPaterno?.arete).toBe('MX-ABU-01');
    expect(calfProfile?.abuelaPaterna).toBeNull();
    expect(calfProfile?.descendientes).toHaveLength(0);
    expect(calfProfile?.hasAnyGenealogyData).toBe(true);

    const fatherProfile = buildAnimalGenealogyProfile(FATHER_ID, ANIMALS, EXISTING_RECORDS);
    expect(fatherProfile?.padre?.arete).toBe('MX-ABU-01');
    expect(fatherProfile?.descendientes).toHaveLength(1);
    expect(fatherProfile?.descendientes[0].animal.arete).toBe('MX-CRI-04');
    expect(fatherProfile?.descendientes[0].role).toBe('padre');

    // Animal sin ningún vínculo -> hasAnyGenealogyData = false (nunca inventa relaciones)
    const emptyProfile = buildAnimalGenealogyProfile(OTHER_RANCH_BULL, ANIMALS, EXISTING_RECORDS);
    expect(emptyProfile?.hasAnyGenealogyData).toBe(false);
    expect(emptyProfile?.padre).toBeNull();
    expect(emptyProfile?.madre).toBeNull();
    expect(emptyProfile?.descendientes).toHaveLength(0);
  });
});
