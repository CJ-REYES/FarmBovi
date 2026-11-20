import type { Cattle } from '../types/cattle';
import type {
  AnimalGenealogyProfile,
  DescendantLink,
  GenealogyInput,
  GenealogyRecord
} from '../types/genealogy';
import { isValidGuid } from './cattle.validation';

export type GenealogyValidationField = 'idAnimal' | 'idPadre' | 'idMadre' | 'general';

export type GenealogyValidationErrors = Partial<Record<GenealogyValidationField, string>>;

function normalizeOptId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeGenealogyInput(input: GenealogyInput): GenealogyInput {
  return {
    idAnimal: input.idAnimal.trim(),
    idPadre: normalizeOptId(input.idPadre),
    idMadre: normalizeOptId(input.idMadre)
  };
}

export function isMaleSex(sexo: string | undefined | null): boolean {
  if (!sexo) return false;
  const lowered = sexo.trim().toLowerCase();
  return lowered === 'macho' || lowered === 'm' || lowered === 'male';
}

export function isFemaleSex(sexo: string | undefined | null): boolean {
  if (!sexo) return false;
  const lowered = sexo.trim().toLowerCase();
  return lowered === 'hembra' || lowered === 'h' || lowered === 'f' || lowered === 'female';
}

/**
 * Verifica si asignar `candidateParentId` como progenitor de `childId`
 * formaría un ciclo genealógico (es decir, si `childId` ya es ancestro de `candidateParentId`).
 */
export function wouldCreateGenealogyCycle(
  childId: string,
  candidateParentId: string,
  records: GenealogyRecord[],
  editingRecordId?: string
): boolean {
  if (childId === candidateParentId) return true;

  const byAnimalId = new Map<string, GenealogyRecord>();
  for (const rec of records) {
    if (rec.deletedAt) continue;
    if (editingRecordId && rec.id === editingRecordId) continue;
    if (!byAnimalId.has(rec.idAnimal)) {
      byAnimalId.set(rec.idAnimal, rec);
    }
  }

  const visited = new Set<string>();
  const stack: string[] = [candidateParentId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === childId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const parentRec = byAnimalId.get(current);
    if (!parentRec) continue;
    if (parentRec.idPadre && !visited.has(parentRec.idPadre)) {
      stack.push(parentRec.idPadre);
    }
    if (parentRec.idMadre && !visited.has(parentRec.idMadre)) {
      stack.push(parentRec.idMadre);
    }
  }

  return false;
}

export interface ValidateGenealogyContext {
  animals?: Cattle[];
  existingRecords?: GenealogyRecord[];
  editingRecordId?: string;
}

export function validateGenealogyInput(
  rawInput: GenealogyInput,
  context: ValidateGenealogyContext = {}
): GenealogyValidationErrors {
  const errors: GenealogyValidationErrors = {};
  const normalized = normalizeGenealogyInput(rawInput);
  const { idAnimal, idPadre, idMadre } = normalized;

  let childAnimal: Cattle | undefined;
  let fatherAnimal: Cattle | undefined;
  let motherAnimal: Cattle | undefined;

  if (!idAnimal) {
    errors.idAnimal = 'Debes seleccionar el animal al que se le registrará el parentesco.';
  } else if (!isValidGuid(idAnimal)) {
    errors.idAnimal = 'El identificador del animal debe ser un UUID válido.';
  } else if (context.animals) {
    childAnimal = context.animals.find((a) => a.id === idAnimal && !a.deletedAt);
    if (!childAnimal) {
      errors.idAnimal = 'El animal seleccionado no existe o está desactivado.';
    }
  }

  // Evitar relaciones duplicadas para el mismo animal
  if (!errors.idAnimal && context.existingRecords) {
    const duplicate = context.existingRecords.find(
      (rec) =>
        !rec.deletedAt &&
        rec.idAnimal === idAnimal &&
        rec.id !== context.editingRecordId
    );
    if (duplicate) {
      errors.idAnimal =
        'Este animal ya tiene un registro de parentesco activo. Edita el registro existente en lugar de duplicarlo.';
    }
  }

  if (!idPadre && !idMadre) {
    errors.general =
      'Debes seleccionar al menos un progenitor (padre o madre) para guardar el parentesco.';
  }

  if (idPadre) {
    if (!isValidGuid(idPadre)) {
      errors.idPadre = 'El identificador del padre debe ser un UUID válido.';
    } else if (idPadre === idAnimal) {
      errors.idPadre = 'Un animal no puede ser su propio padre.';
    } else if (context.animals) {
      fatherAnimal = context.animals.find((a) => a.id === idPadre && !a.deletedAt);
      if (!fatherAnimal) {
        errors.idPadre = 'El padre seleccionado no existe o está desactivado.';
      } else if (!isMaleSex(fatherAnimal.sexo)) {
        errors.idPadre = `El padre seleccionado (${fatherAnimal.arete}) está registrado como ${fatherAnimal.sexo}; debe ser Macho.`;
      } else if (
        childAnimal?.idRancho &&
        fatherAnimal.idRancho &&
        childAnimal.idRancho !== fatherAnimal.idRancho
      ) {
        errors.idPadre = 'El padre seleccionado pertenece a un rancho distinto al del animal.';
      } else if (
        childAnimal?.fechaNacimiento &&
        fatherAnimal.fechaNacimiento &&
        fatherAnimal.fechaNacimiento.slice(0, 10) >= childAnimal.fechaNacimiento.slice(0, 10)
      ) {
        errors.idPadre =
          'La fecha de nacimiento del padre debe ser anterior a la del animal.';
      }
    }
  }

  if (idMadre) {
    if (!isValidGuid(idMadre)) {
      errors.idMadre = 'El identificador de la madre debe ser un UUID válido.';
    } else if (idMadre === idAnimal) {
      errors.idMadre = 'Un animal no puede ser su propia madre.';
    } else if (context.animals) {
      motherAnimal = context.animals.find((a) => a.id === idMadre && !a.deletedAt);
      if (!motherAnimal) {
        errors.idMadre = 'La madre seleccionada no existe o está desactivada.';
      } else if (!isFemaleSex(motherAnimal.sexo)) {
        errors.idMadre = `La madre seleccionada (${motherAnimal.arete}) está registrada como ${motherAnimal.sexo}; debe ser Hembra.`;
      } else if (
        childAnimal?.idRancho &&
        motherAnimal.idRancho &&
        childAnimal.idRancho !== motherAnimal.idRancho
      ) {
        errors.idMadre = 'La madre seleccionada pertenece a un rancho distinto al del animal.';
      } else if (
        childAnimal?.fechaNacimiento &&
        motherAnimal.fechaNacimiento &&
        motherAnimal.fechaNacimiento.slice(0, 10) >= childAnimal.fechaNacimiento.slice(0, 10)
      ) {
        errors.idMadre =
          'La fecha de nacimiento de la madre debe ser anterior a la del animal.';
      }
    }
  }

  if (idPadre && idMadre && idPadre === idMadre) {
    errors.idMadre = 'El padre y la madre no pueden ser el mismo animal.';
  }

  // Prevención de ciclos ancestrales (p. ej. asignar a un descendiente como padre o madre)
  if (!errors.idAnimal && context.existingRecords) {
    if (
      idPadre &&
      !errors.idPadre &&
      wouldCreateGenealogyCycle(idAnimal, idPadre, context.existingRecords, context.editingRecordId)
    ) {
      errors.idPadre =
        'Relación inválida: el animal seleccionado como padre ya figura como descendiente de este ejemplar (ciclo genealógico).';
    }
    if (
      idMadre &&
      !errors.idMadre &&
      wouldCreateGenealogyCycle(idAnimal, idMadre, context.existingRecords, context.editingRecordId)
    ) {
      errors.idMadre =
        'Relación inválida: el animal seleccionado como madre ya figura como descendiente de este ejemplar (ciclo genealógico).';
    }
  }

  return errors;
}

/**
 * Construye el perfil genealógico real de un animal (padres, abuelos y descendientes directos)
 * estrictamente a partir de los vínculos registrados, sin inventar relaciones ni duplicar hijos.
 */
export function buildAnimalGenealogyProfile(
  focalAnimalId: string,
  animals: Cattle[],
  records: GenealogyRecord[]
): AnimalGenealogyProfile | null {
  const animalById = new Map<string, Cattle>();
  for (const a of animals) {
    if (!a.deletedAt) {
      animalById.set(a.id, a);
    }
  }

  const focalAnimal = animalById.get(focalAnimalId);
  if (!focalAnimal) return null;

  // Deduplicar registros activos por idAnimal (si hubiera datos legados repetidos, prevalece el más reciente)
  const recordByAnimalId = new Map<string, GenealogyRecord>();
  const activeRecords = records
    .filter((r) => !r.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const rec of activeRecords) {
    if (!recordByAnimalId.has(rec.idAnimal)) {
      recordByAnimalId.set(rec.idAnimal, rec);
    }
  }

  const focalRecord = recordByAnimalId.get(focalAnimalId) ?? null;

  const resolveParent = (
    parentId: string | null | undefined,
    excluded: Set<string>
  ): Cattle | null => {
    if (!parentId || excluded.has(parentId)) return null;
    return animalById.get(parentId) ?? null;
  };

  const visitedSelf = new Set<string>([focalAnimalId]);
  const padre = resolveParent(focalRecord?.idPadre, visitedSelf);
  const madre = resolveParent(focalRecord?.idMadre, visitedSelf);

  const visitedPaternal = new Set<string>([focalAnimalId]);
  if (padre) visitedPaternal.add(padre.id);
  const padreRec = padre ? recordByAnimalId.get(padre.id) : undefined;
  const abueloPaterno = resolveParent(padreRec?.idPadre, visitedPaternal);
  const abuelaPaterna = resolveParent(padreRec?.idMadre, visitedPaternal);

  const visitedMaternal = new Set<string>([focalAnimalId]);
  if (madre) visitedMaternal.add(madre.id);
  const madreRec = madre ? recordByAnimalId.get(madre.id) : undefined;
  const abueloMaterno = resolveParent(madreRec?.idPadre, visitedMaternal);
  const abuelaMaterna = resolveParent(madreRec?.idMadre, visitedMaternal);

  // Descendientes directos deduplicados
  const descendantMap = new Map<string, DescendantLink>();
  for (const rec of recordByAnimalId.values()) {
    if (rec.idAnimal === focalAnimalId) continue;
    const isFather = rec.idPadre === focalAnimalId;
    const isMother = rec.idMadre === focalAnimalId;
    if (!isFather && !isMother) continue;

    const child = animalById.get(rec.idAnimal);
    if (!child) continue;

    descendantMap.set(child.id, {
      animal: child,
      recordId: rec.id,
      role: isFather && isMother ? 'ambos' : isFather ? 'padre' : 'madre'
    });
  }

  const descendientes = Array.from(descendantMap.values()).sort((a, b) =>
    a.animal.arete.localeCompare(b.animal.arete, 'es')
  );

  const hasAnyGenealogyData = Boolean(
    padre ||
      madre ||
      abueloPaterno ||
      abuelaPaterna ||
      abueloMaterno ||
      abuelaMaterna ||
      descendientes.length > 0
  );

  return {
    animal: focalAnimal,
    record: focalRecord,
    padre,
    madre,
    abueloPaterno,
    abuelaPaterna,
    abueloMaterno,
    abuelaMaterna,
    descendientes,
    hasAnyGenealogyData
  };
}
