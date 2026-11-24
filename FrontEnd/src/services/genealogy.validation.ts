import type { Cattle } from '../types/cattle';
import type {
  AncestroGenealogicoDto,
  AnimalGenealogyProfile,
  AnimalResumenGenealogiaDto,
  DescendantLink,
  DescendienteGenealogicoDto,
  DescendientesAnimalResponse,
  GenealogyInput,
  GenealogyRecord,
  PadresAnimalResponse
} from '../types/genealogy';
import { isValidGuid } from './cattle.validation';

export const GENEALOGY_MAX_OBSERVACIONES_LENGTH = 500;

export type GenealogyValidationField =
  | 'idAnimal'
  | 'idPadre'
  | 'idMadre'
  | 'observaciones'
  | 'general';

export type GenealogyValidationErrors = Partial<Record<GenealogyValidationField, string>>;

const UNKNOWN_SEX_VALUES = new Set([
  'desconocido',
  'desconocida',
  'unknown',
  'nd',
  'n/a',
  'indefinido',
  'indeterminado',
  'sin especificar'
]);

function normalizeOptId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeObservaciones(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() || '';
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeGenealogyInput(input: GenealogyInput): {
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
  observaciones: string | null;
} {
  return {
    idAnimal: input.idAnimal.trim(),
    idPadre: normalizeOptId(input.idPadre),
    idMadre: normalizeOptId(input.idMadre),
    observaciones: normalizeObservaciones(input.observaciones)
  };
}

export function isUnknownSex(sexo: string | undefined | null): boolean {
  if (!sexo || sexo.trim().length === 0) return true;
  return UNKNOWN_SEX_VALUES.has(sexo.trim().toLowerCase());
}

export function isMaleSex(sexo: string | undefined | null): boolean {
  if (!sexo) return false;
  const lowered = sexo.trim().toLowerCase();
  return lowered === 'macho' || lowered === 'masculino' || lowered === 'm' || lowered === 'male';
}

export function isFemaleSex(sexo: string | undefined | null): boolean {
  if (!sexo) return false;
  const lowered = sexo.trim().toLowerCase();
  return (
    lowered === 'hembra' ||
    lowered === 'femenino' ||
    lowered === 'h' ||
    lowered === 'f' ||
    lowered === 'female'
  );
}

export function isValidFatherSex(sexo: string | undefined | null): boolean {
  return isUnknownSex(sexo) || isMaleSex(sexo);
}

export function isValidMotherSex(sexo: string | undefined | null): boolean {
  return isUnknownSex(sexo) || isFemaleSex(sexo);
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
  const { idAnimal, idPadre, idMadre, observaciones } = normalized;

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
        rec.id !== context.editingRecordId &&
        rec.idGenealogia !== context.editingRecordId
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

  if (observaciones && observaciones.length > GENEALOGY_MAX_OBSERVACIONES_LENGTH) {
    errors.observaciones = `Las observaciones no pueden exceder ${GENEALOGY_MAX_OBSERVACIONES_LENGTH} caracteres.`;
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
      } else if (!isValidFatherSex(fatherAnimal.sexo)) {
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
      } else if (!isValidMotherSex(motherAnimal.sexo)) {
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

export function summaryDtoToCattle(
  dto: AnimalResumenGenealogiaDto,
  animalById?: Map<string, Cattle>
): Cattle {
  const existing = animalById?.get(dto.idAnimal);
  if (existing) return existing;

  const now = new Date().toISOString();
  return {
    id: dto.idAnimal,
    idAnimal: dto.idAnimal,
    remoteId: dto.idAnimal,
    idRancho: dto.idRancho,
    idLote: null,
    arete: dto.arete,
    raza: dto.raza,
    sexo: isMaleSex(dto.sexo) ? 'Macho' : 'Hembra',
    fechaNacimiento: dto.fechaNacimiento,
    fechaIngreso: dto.fechaNacimiento ?? now.slice(0, 10),
    procedencia: '',
    estado: dto.estado,
    fechaSalida: null,
    observaciones: null,
    versionRegistro: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncStatus: 'synced'
  };
}

export function cattleToSummaryDto(animal: Cattle): AnimalResumenGenealogiaDto {
  return {
    idAnimal: animal.id,
    idRancho: animal.idRancho,
    arete: animal.arete,
    raza: animal.raza,
    sexo: animal.sexo,
    fechaNacimiento: animal.fechaNacimiento,
    estado: animal.estado
  };
}

/**
 * Construye el perfil genealógico directamente a partir de las respuestas reales del servidor
 * (`GET /api/genealogia/{idAnimal}/padres` y `GET /api/genealogia/{idAnimal}/descendientes`).
 */
export function buildGenealogyProfileFromServer(params: {
  parentsResponse: PadresAnimalResponse;
  descendantsResponse: DescendientesAnimalResponse;
  animals: Cattle[];
  localRecord?: GenealogyRecord | null;
}): AnimalGenealogyProfile {
  const { parentsResponse, descendantsResponse, animals, localRecord } = params;
  const animalById = new Map<string, Cattle>();
  for (const a of animals) {
    if (!a.deletedAt) animalById.set(a.id, a);
  }

  const focalAnimal = summaryDtoToCattle(parentsResponse.animal, animalById);
  const padre = parentsResponse.padre ? summaryDtoToCattle(parentsResponse.padre, animalById) : null;
  const madre = parentsResponse.madre ? summaryDtoToCattle(parentsResponse.madre, animalById) : null;

  const gen2Ancestors = parentsResponse.ancestros.filter((a) => a.generacion === 2);
  const findAncestor = (childId: string | undefined, vinculo: 'Padre' | 'Madre'): Cattle | null => {
    if (!childId) return null;
    const match = gen2Ancestors.find(
      (a) => a.idHijo === childId && a.vinculo.toLowerCase() === vinculo.toLowerCase()
    );
    return match ? summaryDtoToCattle(match.animal, animalById) : null;
  };

  const abueloPaterno = findAncestor(padre?.id, 'Padre');
  const abuelaPaterna = findAncestor(padre?.id, 'Madre');
  const abueloMaterno = findAncestor(madre?.id, 'Padre');
  const abuelaMaterna = findAncestor(madre?.id, 'Madre');

  const directDescendants: DescendantLink[] = descendantsResponse.descendientes
    .filter((d) => d.generacion === 1)
    .map((d) => {
      const child = summaryDtoToCattle(d.descendiente, animalById);
      const isFather = d.descendiente.idPadre === focalAnimal.id;
      const isMother = d.descendiente.idMadre === focalAnimal.id;
      const role: DescendantLink['role'] =
        isFather && isMother
          ? 'ambos'
          : isFather || d.rolProgenitor.toLowerCase() === 'padre'
            ? 'padre'
            : 'madre';
      return {
        animal: child,
        recordId: d.descendiente.idAnimal,
        role,
        generacion: d.generacion
      };
    })
    .sort((a, b) => a.animal.arete.localeCompare(b.animal.arete, 'es'));

  const now = new Date().toISOString();
  const hasDirectLink = Boolean(
    parentsResponse.idGenealogia || parentsResponse.padre || parentsResponse.madre
  );

  const resolvedRecord: GenealogyRecord | null = hasDirectLink
    ? {
        id: localRecord?.id ?? parentsResponse.idGenealogia ?? focalAnimal.id,
        idGenealogia:
          parentsResponse.idGenealogia ?? localRecord?.idGenealogia ?? focalAnimal.id,
        remoteId: parentsResponse.idGenealogia ?? localRecord?.remoteId,
        idRancho: focalAnimal.idRancho,
        idAnimal: focalAnimal.id,
        idPadre: parentsResponse.padre?.idAnimal ?? null,
        idMadre: parentsResponse.madre?.idAnimal ?? null,
        observaciones: parentsResponse.observaciones ?? null,
        versionRegistro: parentsResponse.versionRegistro ?? localRecord?.versionRegistro ?? 1,
        createdAt: localRecord?.createdAt ?? now,
        updatedAt: localRecord?.updatedAt ?? now,
        deletedAt: null,
        syncStatus: localRecord?.syncStatus === 'pending' ? 'pending' : 'synced'
      }
    : null;

  const hasAnyGenealogyData = Boolean(
    padre ||
      madre ||
      abueloPaterno ||
      abuelaPaterna ||
      abueloMaterno ||
      abuelaMaterna ||
      parentsResponse.ancestros.length > 0 ||
      descendantsResponse.totalDescendientes > 0
  );

  return {
    animal: focalAnimal,
    record: resolvedRecord,
    observaciones: parentsResponse.observaciones ?? null,
    padre,
    madre,
    abueloPaterno,
    abuelaPaterna,
    abueloMaterno,
    abuelaMaterna,
    ancestros: parentsResponse.ancestros,
    descendientes: directDescendants,
    descendientesMultigeneracion: descendantsResponse.descendientes,
    totalDescendientes: descendantsResponse.totalDescendientes,
    hasAnyGenealogyData
  };
}

/**
 * Construye el perfil genealógico local (fallback offline) a partir de los registros en IndexedDB,
 * soportando múltiples generaciones de ancestros y descendientes sin inventar datos ni ciclar.
 */
export function buildAnimalGenealogyProfile(
  focalAnimalId: string,
  animals: Cattle[],
  records: GenealogyRecord[],
  maxDepth = 3
): AnimalGenealogyProfile | null {
  const animalById = new Map<string, Cattle>();
  for (const a of animals) {
    if (!a.deletedAt) {
      animalById.set(a.id, a);
    }
  }

  const focalAnimal = animalById.get(focalAnimalId);
  if (!focalAnimal) return null;

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

  // Ancestros BFS (coincide con el contrato `AncestroGenealogicoDto` del Backend)
  const ancestros: AncestroGenealogicoDto[] = [];
  const visitedAnc = new Set<string>([focalAnimalId]);
  let ancFrontier: string[] = [focalAnimalId];
  for (let gen = 1; gen <= maxDepth && ancFrontier.length > 0; gen++) {
    const nextFrontier: string[] = [];
    for (const currentId of ancFrontier) {
      const rec = recordByAnimalId.get(currentId);
      if (!rec) continue;
      if (rec.idPadre) {
        const p = animalById.get(rec.idPadre);
        if (p) {
          ancestros.push({
            generacion: gen,
            vinculo: 'Padre',
            idHijo: currentId,
            animal: cattleToSummaryDto(p)
          });
          if (!visitedAnc.has(p.id)) {
            visitedAnc.add(p.id);
            nextFrontier.push(p.id);
          }
        }
      }
      if (rec.idMadre) {
        const m = animalById.get(rec.idMadre);
        if (m) {
          ancestros.push({
            generacion: gen,
            vinculo: 'Madre',
            idHijo: currentId,
            animal: cattleToSummaryDto(m)
          });
          if (!visitedAnc.has(m.id)) {
            visitedAnc.add(m.id);
            nextFrontier.push(m.id);
          }
        }
      }
    }
    ancFrontier = nextFrontier;
  }

  // Descendientes BFS (coincide con el contrato `DescendienteGenealogicoDto` del Backend)
  const descendientesMultigeneracion: DescendienteGenealogicoDto[] = [];
  const directDescendantMap = new Map<string, DescendantLink>();
  const visitedDesc = new Set<string>([focalAnimalId]);
  let descFrontier: string[] = [focalAnimalId];

  for (let gen = 1; gen <= maxDepth && descFrontier.length > 0; gen++) {
    const frontierSet = new Set(descFrontier);
    const nextFrontier: string[] = [];

    for (const rec of recordByAnimalId.values()) {
      const isFather = Boolean(rec.idPadre && frontierSet.has(rec.idPadre));
      const isMother = Boolean(rec.idMadre && frontierSet.has(rec.idMadre));
      if (!isFather && !isMother) continue;

      const child = animalById.get(rec.idAnimal);
      if (!child || visitedDesc.has(child.id)) continue;
      visitedDesc.add(child.id);

      const directParentId = isFather ? rec.idPadre! : rec.idMadre!;
      const rolProgenitor = isFather ? 'Padre' : 'Madre';

      descendientesMultigeneracion.push({
        generacion: gen,
        rolProgenitor,
        idPadreOMadreDirecto: directParentId,
        descendiente: {
          ...cattleToSummaryDto(child),
          idPadre: rec.idPadre,
          idMadre: rec.idMadre
        }
      });

      if (gen === 1) {
        directDescendantMap.set(child.id, {
          animal: child,
          recordId: rec.id,
          role:
            rec.idPadre === focalAnimalId && rec.idMadre === focalAnimalId
              ? 'ambos'
              : rec.idPadre === focalAnimalId
                ? 'padre'
                : 'madre',
          generacion: 1
        });
      }

      nextFrontier.push(child.id);
    }

    descFrontier = nextFrontier;
  }

  const descendientes = Array.from(directDescendantMap.values()).sort((a, b) =>
    a.animal.arete.localeCompare(b.animal.arete, 'es')
  );

  const hasAnyGenealogyData = Boolean(
    padre ||
      madre ||
      abueloPaterno ||
      abuelaPaterna ||
      abueloMaterno ||
      abuelaMaterna ||
      ancestros.length > 0 ||
      descendientesMultigeneracion.length > 0
  );

  return {
    animal: focalAnimal,
    record: focalRecord,
    observaciones: focalRecord?.observaciones ?? null,
    padre,
    madre,
    abueloPaterno,
    abuelaPaterna,
    abueloMaterno,
    abuelaMaterna,
    ancestros,
    descendientes,
    descendientesMultigeneracion,
    totalDescendientes: descendientesMultigeneracion.length,
    hasAnyGenealogyData
  };
}
