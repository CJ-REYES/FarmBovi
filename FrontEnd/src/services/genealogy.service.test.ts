import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { db } from '../lib/database/db';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import type {
  AncestroGenealogicoDto,
  AnimalResumenGenealogiaDto,
  DescendienteGenealogicoDto,
  GenealogiaRegistroDto
} from '../types/genealogy';
import { GenealogyService, GenealogyValidationError } from './genealogy.service';

const RANCH_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RANCH_B = '99999999-9999-4999-8999-999999999999';
const GRANDPA_ID = '11111111-1111-4111-8111-111111111111';
const FATHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MOTHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CALF_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_RANCH_ANIMAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

interface MockAnimal {
  idAnimal: string;
  idRancho: string;
  arete: string;
  raza: string;
  sexo: string;
  fechaNacimiento: string | null;
  estado: string;
}

interface MockGenealogyRow extends GenealogiaRegistroDto {
  eliminadoEn: string | null;
}

/**
 * Simulador fiel a `GenealogiaController.cs` + `GenealogiaService.cs` (PR #31).
 */
class GenealogyApiServerSimulator {
  readonly animals = new Map<string, MockAnimal>();
  readonly rowsByAnimal = new Map<string, MockGenealogyRow>();
  readonly authorizedRanches = new Set<string>([RANCH_A]);
  readonly requests: Array<{ method: string; path: string; body?: unknown }> = [];

  constructor() {
    const list: MockAnimal[] = [
      { idAnimal: GRANDPA_ID, idRancho: RANCH_A, arete: 'MX-ABU-00', raza: 'Brahman', sexo: 'Macho', fechaNacimiento: '2017-01-01', estado: 'Activo' },
      { idAnimal: FATHER_ID, idRancho: RANCH_A, arete: 'MX-PAD-01', raza: 'Brahman', sexo: 'Macho', fechaNacimiento: '2020-01-01', estado: 'Activo' },
      { idAnimal: MOTHER_ID, idRancho: RANCH_A, arete: 'MX-MAD-02', raza: 'Holstein', sexo: 'Hembra', fechaNacimiento: '2020-03-01', estado: 'Activo' },
      { idAnimal: CALF_ID, idRancho: RANCH_A, arete: 'MX-CRI-03', raza: 'Cruza', sexo: 'Hembra', fechaNacimiento: '2023-05-01', estado: 'Activo' },
      { idAnimal: OTHER_RANCH_ANIMAL, idRancho: RANCH_B, arete: 'MX-OTR-99', raza: 'Angus', sexo: 'Macho', fechaNacimiento: '2021-01-01', estado: 'Activo' }
    ];
    for (const a of list) this.animals.set(a.idAnimal, a);
  }

  private json(status: number, body: unknown, contentType = 'application/json'): Response {
    if (status === 204) {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': contentType }
    });
  }

  private problem(status: number, title: string, detail: string): Response {
    return this.json(status, { status, title, detail }, 'application/problem+json');
  }

  private toSummary(a: MockAnimal): AnimalResumenGenealogiaDto {
    return {
      idAnimal: a.idAnimal,
      idRancho: a.idRancho,
      arete: a.arete,
      raza: a.raza,
      sexo: a.sexo,
      fechaNacimiento: a.fechaNacimiento,
      estado: a.estado
    };
  }

  private createsCycle(idAnimal: string, idPadre: string | null, idMadre: string | null): boolean {
    const visited = new Set<string>();
    const stack: string[] = [];
    if (idPadre) stack.push(idPadre);
    if (idMadre) stack.push(idMadre);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (curr === idAnimal) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);
      const rel = this.rowsByAnimal.get(curr);
      if (!rel || rel.eliminadoEn) continue;
      if (rel.idPadre) stack.push(rel.idPadre);
      if (rel.idMadre) stack.push(rel.idMadre);
    }
    return false;
  }

  seedLink(idAnimal: string, idPadre: string | null, idMadre: string | null, observaciones: string | null = null): MockGenealogyRow {
    const row: MockGenealogyRow = {
      idGenealogia: crypto.randomUUID(),
      idAnimal,
      idPadre,
      idMadre,
      observaciones,
      idAutor: '00000000-0000-4000-8000-000000000001',
      creadoEn: '2026-11-22T10:00:00Z',
      versionRegistro: 1,
      eliminadoEn: null
    };
    this.rowsByAnimal.set(idAnimal, row);
    return row;
  }

  handleFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:5173');
    const method = (init?.method || 'GET').toUpperCase();
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.requests.push({ method, path: `${url.pathname}${url.search}`, body: parsedBody });

    // GET /api/animales
    if (url.pathname.endsWith('/animales') && method === 'GET') {
      const visible = Array.from(this.animals.values())
        .filter((a) => this.authorizedRanches.has(a.idRancho))
        .map((a) => ({
          idAnimal: a.idAnimal,
          idRancho: a.idRancho,
          idLote: null,
          arete: a.arete,
          raza: a.raza,
          sexo: a.sexo,
          fechaNacimiento: a.fechaNacimiento,
          fechaIngreso: a.fechaNacimiento ?? '2024-01-01',
          procedencia: 'Rancho',
          estado: a.estado,
          fechaSalida: null,
          observaciones: null,
          versionRegistro: 1,
          creadoEn: '2026-11-01T00:00:00Z',
          eliminadoEn: null
        }));
      return this.json(200, visible);
    }

    // GET /api/genealogia
    if (url.pathname.endsWith('/genealogia') && method === 'GET') {
      const idRancho = url.searchParams.get('idRancho');
      if (idRancho && !this.authorizedRanches.has(idRancho)) {
        return this.problem(403, 'Acceso denegado.', 'No tienes permisos sobre el rancho solicitado.');
      }
      const incluirEliminados = url.searchParams.get('incluirEliminados') === 'true';
      const items = Array.from(this.rowsByAnimal.values()).filter((row) => {
        const animal = this.animals.get(row.idAnimal);
        if (!animal || !this.authorizedRanches.has(animal.idRancho)) return false;
        if (idRancho && animal.idRancho !== idRancho) return false;
        if (!incluirEliminados && row.eliminadoEn) return false;
        return true;
      });
      return this.json(200, items);
    }

    // POST /api/genealogia
    if (url.pathname.endsWith('/genealogia') && method === 'POST') {
      const body = parsedBody as { idAnimal: string; idPadre: string | null; idMadre: string | null; observaciones?: string | null };
      const animal = this.animals.get(body.idAnimal);
      if (!animal) return this.problem(400, 'Error de validación.', 'El animal descendiente especificado no existe.');
      if (!this.authorizedRanches.has(animal.idRancho)) {
        return this.problem(403, 'Acceso denegado.', 'No tienes permisos sobre el rancho de este registro.');
      }
      if (!body.idPadre && !body.idMadre) {
        return this.problem(400, 'Error de validación.', 'Debe especificar al menos un padre o una madre.');
      }
      if (body.idPadre === body.idAnimal || body.idMadre === body.idAnimal) {
        return this.problem(400, 'Error de validación.', 'Un animal no puede ser su propio padre o madre.');
      }
      if (body.idPadre) {
        const p = this.animals.get(body.idPadre);
        if (!p) return this.problem(400, 'Error de validación.', 'El padre no existe.');
        if (!this.authorizedRanches.has(p.idRancho)) return this.problem(403, 'Acceso denegado.', 'Sin permisos sobre el rancho del padre.');
        if (p.idRancho !== animal.idRancho) return this.problem(400, 'Error de validación.', 'La relación genealógica debe mantenerse dentro del mismo rancho.');
      }
      if (this.createsCycle(body.idAnimal, body.idPadre, body.idMadre)) {
        return this.problem(400, 'Error de validación.', 'La relación solicitada genera un ciclo genealógico.');
      }
      const existing = this.rowsByAnimal.get(body.idAnimal);
      if (existing && !existing.eliminadoEn) {
        return this.problem(409, 'Conflicto de recurso.', 'El animal ya tiene un registro de genealogía activo.');
      }
      const created = this.seedLink(body.idAnimal, body.idPadre, body.idMadre, body.observaciones ?? null);
      return this.json(201, created);
    }

    // GET /api/genealogia/{idAnimal}/padres
    const parentsMatch = url.pathname.match(/\/genealogia\/([^/]+)\/padres$/);
    if (parentsMatch && method === 'GET') {
      const idAnimal = parentsMatch[1];
      const depth = Number(url.searchParams.get('profundidad') || '1');
      const animal = this.animals.get(idAnimal);
      if (!animal) return this.problem(404, 'Recurso no encontrado.', 'El animal especificado no existe.');
      if (!this.authorizedRanches.has(animal.idRancho)) {
        return this.problem(403, 'Acceso denegado.', 'No tienes permisos sobre el rancho de este registro.');
      }
      const direct = this.rowsByAnimal.get(idAnimal);
      const activeDirect = direct && !direct.eliminadoEn ? direct : null;
      const padre = activeDirect?.idPadre ? this.animals.get(activeDirect.idPadre) ?? null : null;
      const madre = activeDirect?.idMadre ? this.animals.get(activeDirect.idMadre) ?? null : null;

      const ancestros: AncestroGenealogicoDto[] = [];
      const visited = new Set<string>([idAnimal]);
      let frontier = [idAnimal];
      for (let gen = 1; gen <= depth && frontier.length > 0; gen++) {
        const next: string[] = [];
        for (const cid of frontier) {
          const rel = this.rowsByAnimal.get(cid);
          if (!rel || rel.eliminadoEn) continue;
          if (rel.idPadre) {
            const p = this.animals.get(rel.idPadre);
            if (p && p.idRancho === animal.idRancho) {
              ancestros.push({ generacion: gen, vinculo: 'Padre', idHijo: cid, animal: this.toSummary(p) });
              if (!visited.has(p.idAnimal)) { visited.add(p.idAnimal); next.push(p.idAnimal); }
            }
          }
          if (rel.idMadre) {
            const m = this.animals.get(rel.idMadre);
            if (m && m.idRancho === animal.idRancho) {
              ancestros.push({ generacion: gen, vinculo: 'Madre', idHijo: cid, animal: this.toSummary(m) });
              if (!visited.has(m.idAnimal)) { visited.add(m.idAnimal); next.push(m.idAnimal); }
            }
          }
        }
        frontier = next;
      }

      return this.json(200, {
        animal: this.toSummary(animal),
        padre: padre ? this.toSummary(padre) : null,
        madre: madre ? this.toSummary(madre) : null,
        observaciones: activeDirect?.observaciones ?? null,
        ancestros,
        idGenealogia: activeDirect?.idGenealogia ?? null,
        versionRegistro: activeDirect?.versionRegistro ?? null
      });
    }

    // GET /api/genealogia/{idAnimal}/descendientes
    const descMatch = url.pathname.match(/\/genealogia\/([^/]+)\/descendientes$/);
    if (descMatch && method === 'GET') {
      const idAnimal = descMatch[1];
      const depth = Number(url.searchParams.get('profundidad') || '1');
      const animal = this.animals.get(idAnimal);
      if (!animal) return this.problem(404, 'Recurso no encontrado.', 'El animal especificado no existe.');
      if (!this.authorizedRanches.has(animal.idRancho)) {
        return this.problem(403, 'Acceso denegado.', 'No tienes permisos sobre el rancho de este registro.');
      }

      const descendientes: DescendienteGenealogicoDto[] = [];
      const visited = new Set<string>([idAnimal]);
      let frontier = [idAnimal];
      for (let gen = 1; gen <= depth && frontier.length > 0; gen++) {
        const set = new Set(frontier);
        const next: string[] = [];
        for (const rel of this.rowsByAnimal.values()) {
          if (rel.eliminadoEn) continue;
          const child = this.animals.get(rel.idAnimal);
          if (!child || child.idRancho !== animal.idRancho || visited.has(child.idAnimal)) continue;
          if (rel.idPadre && set.has(rel.idPadre)) {
            visited.add(child.idAnimal);
            descendientes.push({
              generacion: gen,
              rolProgenitor: 'Padre',
              idPadreOMadreDirecto: rel.idPadre,
              descendiente: { ...this.toSummary(child), idPadre: rel.idPadre, idMadre: rel.idMadre }
            });
            next.push(child.idAnimal);
          } else if (rel.idMadre && set.has(rel.idMadre)) {
            visited.add(child.idAnimal);
            descendientes.push({
              generacion: gen,
              rolProgenitor: 'Madre',
              idPadreOMadreDirecto: rel.idMadre,
              descendiente: { ...this.toSummary(child), idPadre: rel.idPadre, idMadre: rel.idMadre }
            });
            next.push(child.idAnimal);
          }
        }
        frontier = next;
      }

      return this.json(200, {
        animal: this.toSummary(animal),
        totalDescendientes: descendientes.length,
        descendientes
      });
    }

    // PUT /api/genealogia/{idAnimal}
    const putMatch = url.pathname.match(/\/genealogia\/([^/]+)$/);
    if (putMatch && method === 'PUT') {
      const idAnimal = putMatch[1];
      const body = parsedBody as { idPadre: string | null; idMadre: string | null; observaciones?: string | null; versionRegistro: number };
      const existing = this.rowsByAnimal.get(idAnimal);
      if (!existing || existing.eliminadoEn) {
        return this.problem(404, 'Recurso no encontrado.', 'No existe un registro de genealogía activo para este animal.');
      }
      if (existing.versionRegistro !== body.versionRegistro) {
        return this.problem(409, 'Conflicto de recurso.', 'El registro de genealogía fue modificado por otro usuario.');
      }
      if (this.createsCycle(idAnimal, body.idPadre, body.idMadre)) {
        return this.problem(400, 'Error de validación.', 'La relación solicitada genera un ciclo genealógico.');
      }
      existing.idPadre = body.idPadre;
      existing.idMadre = body.idMadre;
      existing.observaciones = body.observaciones ?? null;
      existing.versionRegistro += 1;
      return this.json(200, existing);
    }

    // DELETE /api/genealogia/{idAnimal}?versionRegistro=X
    if (putMatch && method === 'DELETE') {
      const idAnimal = putMatch[1];
      const version = Number(url.searchParams.get('versionRegistro') || '0');
      const existing = this.rowsByAnimal.get(idAnimal);
      if (!existing || existing.eliminadoEn) {
        return this.problem(404, 'Recurso no encontrado.', 'El animal no tiene genealogía activa registrada.');
      }
      if (existing.versionRegistro !== version) {
        return this.problem(409, 'Conflicto de recurso.', 'Conflicto de versión al eliminar genealogía.');
      }
      existing.eliminadoEn = new Date().toISOString();
      existing.versionRegistro += 1;
      return this.json(204, null);
    }

    return this.problem(404, 'No encontrado', `Ruta no simulada: ${method} ${url.pathname}`);
  };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
}

describe('GenealogyService — Integración real con /api/genealogia, caché offline y aislamiento por rancho', () => {
  let server: GenealogyApiServerSimulator;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.genealogy.clear();
    await db.cattle.clear();
    await db.outbox.clear();
    setOnline(true);

    server = new GenealogyApiServerSimulator();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handleFetch);
  });

  it('consulta listado, padres, descendientes y árbol multigeneración desde el servidor y los persiste para consulta offline', async () => {
    server.seedLink(FATHER_ID, GRANDPA_ID, null, 'Línea paterna');
    server.seedLink(CALF_ID, FATHER_ID, MOTHER_ID, 'Cría directa');

    const loaded = await GenealogyService.getAll();
    expect(loaded.source).toBe('server');
    expect(loaded.warning).toBeNull();
    expect(loaded.records).toHaveLength(2);
    expect(loaded.records.every((r) => r.syncStatus === 'synced')).toBe(true);

    // Consulta del árbol completo del becerro (padre, madre y abuelo paterno)
    const calfTree = await GenealogyService.getAnimalTree(CALF_ID, { profundidad: 3 });
    expect(calfTree.source).toBe('server');
    expect(calfTree.profile.padre?.arete).toBe('MX-PAD-01');
    expect(calfTree.profile.madre?.arete).toBe('MX-MAD-02');
    expect(calfTree.profile.abueloPaterno?.arete).toBe('MX-ABU-00');
    expect(calfTree.profile.observaciones).toBe('Cría directa');

    // Consulta de descendientes desde el abuelo (padre + becerro = 2 generaciones)
    const grandpaDesc = await GenealogyService.getDescendants(GRANDPA_ID, { profundidad: 3 });
    expect(grandpaDesc.source).toBe('server');
    expect(grandpaDesc.data.totalDescendientes).toBe(2);

    // Animal sin padres registrados devuelve nulos y listas vacías sin errores
    const rootParents = await GenealogyService.getParents(GRANDPA_ID, { profundidad: 2 });
    expect(rootParents.data.padre).toBeNull();
    expect(rootParents.data.madre).toBeNull();
    expect(rootParents.data.ancestros).toHaveLength(0);

    // Al perder conexión, la consulta del árbol funciona desde IndexedDB sin llamar fetch
    setOnline(false);
    const requestCountBeforeOffline = server.requests.length;
    const offlineTree = await GenealogyService.getAnimalTree(CALF_ID, { profundidad: 3 });
    expect(offlineTree.source).toBe('cache');
    expect(offlineTree.profile.padre?.arete).toBe('MX-PAD-01');
    expect(offlineTree.profile.abueloPaterno?.arete).toBe('MX-ABU-00');
    expect(server.requests.length).toBe(requestCountBeforeOffline);
  });

  it('crea (POST), actualiza con versionRegistro (PUT) y elimina lógicamente (DELETE) contra la API y actualiza caché local', async () => {
    await GenealogyService.getAll();

    // 1. POST /api/genealogia
    const created = await GenealogyService.create({
      idAnimal: CALF_ID,
      idPadre: FATHER_ID,
      idMadre: null,
      observaciones: 'Registro inicial'
    });
    expect(created.synced).toBe(true);
    expect(created.record.syncStatus).toBe('synced');
    expect(created.record.versionRegistro).toBe(1);
    expect(created.record.observaciones).toBe('Registro inicial');

    // 2. PUT /api/genealogia/{idAnimal} enviando versionRegistro=1 -> retorna versionRegistro=2
    const updated = await GenealogyService.update(created.record.id, {
      idAnimal: CALF_ID,
      idPadre: FATHER_ID,
      idMadre: MOTHER_ID,
      observaciones: 'Madre agregada'
    });
    expect(updated.synced).toBe(true);
    expect(updated.record.versionRegistro).toBe(2);
    expect(updated.record.idMadre).toBe(MOTHER_ID);
    expect(updated.record.observaciones).toBe('Madre agregada');

    // Conflicto 409 si alguien intenta editar con versión desactualizada en el servidor
    server.rowsByAnimal.get(CALF_ID)!.versionRegistro = 99;
    await expect(
      GenealogyService.update(created.record.id, {
        idAnimal: CALF_ID,
        idPadre: FATHER_ID,
        idMadre: null,
        observaciones: 'Obsoleto'
      })
    ).rejects.toMatchObject({ status: 409 });

    // Restaurar versión real y eliminar (DELETE /api/genealogia/{idAnimal}?versionRegistro=2)
    server.rowsByAnimal.get(CALF_ID)!.versionRegistro = 2;
    const removed = await GenealogyService.deactivate(created.record.id);
    expect(removed.synced).toBe(true);
    expect(await db.genealogy.filter((g) => !g.deletedAt).count()).toBe(0);
  });

  it('rechaza relaciones inválidas, ciclos y acceso entre ranchos (403) sin contaminar caché local', async () => {
    server.seedLink(FATHER_ID, GRANDPA_ID, null);
    await GenealogyService.getAll();

    // Ciclo detectado localmente antes de llamar al servidor
    await expect(
      GenealogyService.create({
        idAnimal: GRANDPA_ID,
        idPadre: FATHER_ID,
        idMadre: null
      })
    ).rejects.toBeInstanceOf(GenealogyValidationError);

    // Acceso a rancho ajeno -> 403 Forbidden propagado explícitamente
    await expect(GenealogyService.getParents(OTHER_RANCH_ANIMAL)).rejects.toMatchObject({
      status: 403
    });
    await expect(GenealogyService.getDescendants(OTHER_RANCH_ANIMAL)).rejects.toMatchObject({
      status: 403
    });
    await expect(GenealogyService.getAll({ idRancho: RANCH_B })).rejects.toMatchObject({
      status: 403
    });

    // Si el servidor rechaza con 400 (ciclo desconocido localmente), propaga ApiError y no guarda en Dexie
    const countBefore = await db.genealogy.count();
    await db.genealogy.clear(); // Simular caché incompleto que desconoce la arista del servidor
    await expect(
      GenealogyService.create({
        idAnimal: GRANDPA_ID,
        idPadre: FATHER_ID,
        idMadre: null
      })
    ).rejects.toSatisfy((err: unknown) => err instanceof GenealogyValidationError || (err instanceof ApiError && err.status === 400));
    expect(await db.genealogy.count()).toBe(0);
    expect(countBefore).toBe(1);
  });

  it('preserva cambios localmente en IndexedDB + Outbox cuando el usuario trabaja offline', async () => {
    await GenealogyService.getAll();
    setOnline(false);

    const createdOffline = await GenealogyService.create({
      idAnimal: CALF_ID,
      idPadre: FATHER_ID,
      idMadre: MOTHER_ID,
      observaciones: 'Capturado en corral sin señal'
    });

    expect(createdOffline.synced).toBe(false);
    expect(createdOffline.record.syncStatus).toBe('pending');
    expect(createdOffline.record.observaciones).toBe('Capturado en corral sin señal');

    const outboxOps = await OutboxRepository.getByEntity('genealogy', createdOffline.record.id);
    expect(outboxOps).toHaveLength(1);
    expect(outboxOps[0].tipoOperacion).toBe('CREATE');
  });
});
