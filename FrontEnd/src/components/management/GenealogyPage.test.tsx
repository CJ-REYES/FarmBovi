import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import type { GenealogiaRegistroDto } from '../../types/genealogy';
import GenealogyPage from './GenealogyPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RANCH_ID = '99999999-9999-4999-8999-999999999999';
const FATHER_ID = '22222222-2222-4222-8222-222222222222';
const MOTHER_ID = '33333333-3333-4333-8333-333333333333';
const CALF_ID = '44444444-4444-4444-8444-444444444444';
const FOREIGN_ANIMAL_ID = '55555555-5555-4555-8555-555555555555';

interface MockAnimal {
  idAnimal: string;
  idRancho: string;
  arete: string;
  raza: string;
  sexo: string;
  fechaNacimiento: string;
  estado: string;
}

function createServerMock() {
  const animals = new Map<string, MockAnimal>([
    [FATHER_ID, { idAnimal: FATHER_ID, idRancho: RANCH_ID, arete: 'MX-SEM-100', raza: 'Brahman', sexo: 'Macho', fechaNacimiento: '2020-02-01', estado: 'Activo' }],
    [MOTHER_ID, { idAnimal: MOTHER_ID, idRancho: RANCH_ID, arete: 'MX-VIE-200', raza: 'Suizo Pardo', sexo: 'Hembra', fechaNacimiento: '2020-04-01', estado: 'Activo' }],
    [CALF_ID, { idAnimal: CALF_ID, idRancho: RANCH_ID, arete: 'MX-BEC-300', raza: 'Cruza', sexo: 'Hembra', fechaNacimiento: '2023-07-10', estado: 'Activo' }],
    [FOREIGN_ANIMAL_ID, { idAnimal: FOREIGN_ANIMAL_ID, idRancho: OTHER_RANCH_ID, arete: 'MX-AJE-999', raza: 'Angus', sexo: 'Macho', fechaNacimiento: '2021-01-01', estado: 'Activo' }]
  ]);

  const linksByAnimal = new Map<string, GenealogiaRegistroDto & { eliminadoEn: string | null }>();

  const json = (status: number, body: unknown, type = 'application/json') =>
    status === 204
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } });

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:5173');
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.pathname.endsWith('/animales') && method === 'GET') {
      return json(
        200,
        Array.from(animals.values())
          .filter((a) => a.idRancho === RANCH_ID)
          .map((a) => ({
            ...a,
            idLote: null,
            fechaIngreso: a.fechaNacimiento,
            procedencia: 'Rancho',
            fechaSalida: null,
            observaciones: null,
            versionRegistro: 1,
            creadoEn: '2026-01-01T00:00:00Z',
            eliminadoEn: null
          }))
      );
    }

    if (url.pathname.endsWith('/genealogia') && method === 'GET') {
      return json(
        200,
        Array.from(linksByAnimal.values()).filter((l) => !l.eliminadoEn)
      );
    }

    if (url.pathname.endsWith('/genealogia') && method === 'POST') {
      const req = body as { idAnimal: string; idPadre: string | null; idMadre: string | null; observaciones?: string | null };
      const existing = linksByAnimal.get(req.idAnimal);
      if (existing && !existing.eliminadoEn) {
        return json(409, { status: 409, title: 'Conflicto', detail: 'Ya existe un registro activo.' }, 'application/problem+json');
      }
      const created = {
        idGenealogia: crypto.randomUUID(),
        idAnimal: req.idAnimal,
        idPadre: req.idPadre,
        idMadre: req.idMadre,
        observaciones: req.observaciones ?? null,
        idAutor: '00000000-0000-4000-8000-000000000001',
        creadoEn: '2026-11-22T12:00:00Z',
        versionRegistro: 1,
        eliminadoEn: null
      };
      linksByAnimal.set(req.idAnimal, created);
      return json(201, created);
    }

    const parentsMatch = url.pathname.match(/\/genealogia\/([^/]+)\/padres$/);
    if (parentsMatch && method === 'GET') {
      const id = parentsMatch[1];
      const animal = animals.get(id);
      if (!animal) return json(404, { status: 404, title: 'No encontrado', detail: 'Animal no encontrado.' }, 'application/problem+json');
      if (animal.idRancho !== RANCH_ID) {
        return json(403, { status: 403, title: 'Acceso denegado.', detail: 'No tienes permisos sobre el rancho de este registro.' }, 'application/problem+json');
      }
      const rel = linksByAnimal.get(id);
      const active = rel && !rel.eliminadoEn ? rel : null;
      const padre = active?.idPadre ? animals.get(active.idPadre) ?? null : null;
      const madre = active?.idMadre ? animals.get(active.idMadre) ?? null : null;
      const ancestros = [];
      if (padre) ancestros.push({ generacion: 1, vinculo: 'Padre', idHijo: id, animal: padre });
      if (madre) ancestros.push({ generacion: 1, vinculo: 'Madre', idHijo: id, animal: madre });
      return json(200, {
        animal,
        padre,
        madre,
        observaciones: active?.observaciones ?? null,
        ancestros,
        idGenealogia: active?.idGenealogia ?? null,
        versionRegistro: active?.versionRegistro ?? null
      });
    }

    const descMatch = url.pathname.match(/\/genealogia\/([^/]+)\/descendientes$/);
    if (descMatch && method === 'GET') {
      const id = descMatch[1];
      const animal = animals.get(id);
      if (!animal) return json(404, { status: 404, title: 'No encontrado', detail: 'Animal no encontrado.' }, 'application/problem+json');
      if (animal.idRancho !== RANCH_ID) {
        return json(403, { status: 403, title: 'Acceso denegado.', detail: 'No tienes permisos sobre el rancho de este registro.' }, 'application/problem+json');
      }
      const descendientes = Array.from(linksByAnimal.values())
        .filter((l) => !l.eliminadoEn && (l.idPadre === id || l.idMadre === id))
        .map((l) => {
          const child = animals.get(l.idAnimal)!;
          return {
            generacion: 1,
            rolProgenitor: l.idPadre === id ? 'Padre' : 'Madre',
            idPadreOMadreDirecto: id,
            descendiente: { ...child, idPadre: l.idPadre, idMadre: l.idMadre }
          };
        });
      return json(200, {
        animal,
        totalDescendientes: descendientes.length,
        descendientes
      });
    }

    const itemMatch = url.pathname.match(/\/genealogia\/([^/]+)$/);
    if (itemMatch && method === 'PUT') {
      const id = itemMatch[1];
      const rel = linksByAnimal.get(id);
      const req = body as { idPadre: string | null; idMadre: string | null; observaciones?: string | null; versionRegistro: number };
      if (!rel || rel.eliminadoEn) return json(404, { status: 404, title: 'No encontrado', detail: 'Sin genealogía activa.' }, 'application/problem+json');
      if (rel.versionRegistro !== req.versionRegistro) return json(409, { status: 409, title: 'Conflicto', detail: 'Versión obsoleta.' }, 'application/problem+json');
      rel.idPadre = req.idPadre;
      rel.idMadre = req.idMadre;
      rel.observaciones = req.observaciones ?? null;
      rel.versionRegistro += 1;
      return json(200, rel);
    }

    if (itemMatch && method === 'DELETE') {
      const id = itemMatch[1];
      const rel = linksByAnimal.get(id);
      if (!rel || rel.eliminadoEn) return json(404, { status: 404, title: 'No encontrado', detail: 'Sin genealogía activa.' }, 'application/problem+json');
      rel.eliminadoEn = new Date().toISOString();
      rel.versionRegistro += 1;
      return json(204, null);
    }

    return json(404, { status: 404, title: 'No encontrado', detail: `Ruta no simulada: ${method} ${url.pathname}` }, 'application/problem+json');
  };

  return { handler, linksByAnimal };
}

function renderPage(initialPath = '/genealogy') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <GenealogyPage />
    </MemoryRouter>
  );
}

describe('GenealogyPage — Integración real con API, árbol, edición, persistencia offline y acceso entre ranchos', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.genealogy.clear();
    await db.cattle.clear();
    await db.outbox.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('consulta un animal sin padres registrados desde el servidor sin mostrar avisos obsoletos ni inventar relaciones', async () => {
    const server = createServerMock();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handler);

    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText(/Selecciona un animal para consultar su árbol genealógico/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Dependencia de Backend documentada/i)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('combobox', { name: /Consultar árbol genealógico de un animal/i })
    );
    await user.type(screen.getByPlaceholderText(/Filtrar animal por arete/i), 'MX-BEC-300');
    await user.click(screen.getByRole('option', { name: /MX-BEC-300/i }));

    expect(
      await screen.findByText(/Sin datos genealógicos registrados para MX-BEC-300/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Servidor')).toBeInTheDocument();
    expect(screen.getByText('Padre no registrado')).toBeInTheDocument();
    expect(screen.getByText('Madre no registrada')).toBeInTheDocument();
    expect(screen.getByText(/Sin descendientes registrados para MX-BEC-300/i)).toBeInTheDocument();
  });

  it('registra, visualiza árbol y descendientes, edita observaciones, consulta offline tras recarga y desactiva en servidor', async () => {
    const server = createServerMock();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handler);

    const user = userEvent.setup();
    const { unmount } = renderPage();

    await screen.findByText(/Selecciona un animal para consultar su árbol genealógico/i);

    // 1. Registrar parentesco (POST /api/genealogia)
    await user.click(screen.getAllByRole('button', { name: /Registrar Parentesco/i })[0]);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-BEC-300/i }));

    await user.click(within(dialog).getByRole('combobox', { name: /^Padre/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-SEM-100/i }));

    await user.click(within(dialog).getByRole('combobox', { name: /^Madre/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-VIE-200/i }));

    await user.type(within(dialog).getByLabelText(/Observaciones/i), 'Empadre controlado 2023');
    await user.click(within(dialog).getByRole('button', { name: /Guardar Parentesco/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // 2. Verificar árbol con padre, madre y observaciones sincronizadas del servidor
    const treeSection = await screen.findByRole('region', {
      name: /Árbol genealógico de MX-BEC-300/i
    });
    expect(within(treeSection).getByText('MX-SEM-100')).toBeInTheDocument();
    expect(within(treeSection).getByText('MX-VIE-200')).toBeInTheDocument();
    expect(within(treeSection).getByText(/Empadre controlado 2023/i)).toBeInTheDocument();

    // 3. Navegar al padre y comprobar descendiente directo
    await user.click(within(treeSection).getByRole('button', { name: /MX-SEM-100/i }));
    const fatherTree = await screen.findByRole('region', {
      name: /Árbol genealógico de MX-SEM-100/i
    });
    expect(within(fatherTree).getByText(/Descendientes Directos \(1\)/i)).toBeInTheDocument();
    expect(within(fatherTree).getByText('MX-BEC-300')).toBeInTheDocument();

    // 4. Editar observaciones (PUT /api/genealogia/{idAnimal} con versionRegistro=1)
    await user.click(screen.getAllByRole('button', { name: /Editar parentesco de MX-BEC-300/i })[0]);
    const editDialog = screen.getByRole('dialog');
    const obsInput = within(editDialog).getByLabelText(/Observaciones/i);
    await user.clear(obsInput);
    await user.type(obsInput, 'Verificado por ADN');
    await user.click(within(editDialog).getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/Verificado por ADN/i)).toBeInTheDocument();
    expect(server.linksByAnimal.get(CALF_ID)?.versionRegistro).toBe(2);

    // 5. Recarga en modo offline: el árbol sigue consultable desde IndexedDB
    unmount();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    renderPage(`/genealogy?animal=${CALF_ID}`);

    const offlineTree = await screen.findByRole('region', {
      name: /Árbol genealógico de MX-BEC-300/i
    });
    expect(within(offlineTree).getByText('MX-SEM-100')).toBeInTheDocument();
    expect(within(offlineTree).getByText('MX-VIE-200')).toBeInTheDocument();
    expect(within(offlineTree).getByText('Caché local')).toBeInTheDocument();

    // 6. Volver online y desactivar vínculo en el servidor (DELETE)
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await user.click(
      screen.getAllByRole('button', { name: /Desactivar parentesco de MX-BEC-300/i })[0]
    );
    const confirmDialog = screen.getByRole('dialog');
    await user.click(
      within(confirmDialog).getByRole('button', { name: /Confirmar Desactivación/i })
    );

    await waitFor(async () => {
      const remaining = await db.genealogy.filter((g) => !g.deletedAt).count();
      expect(remaining).toBe(0);
    });
    expect(server.linksByAnimal.get(CALF_ID)?.eliminadoEn).not.toBeNull();
  });

  it('muestra alerta de acceso denegado (403) cuando se intenta consultar el árbol de un animal de otro rancho', async () => {
    const server = createServerMock();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handler);

    renderPage(`/genealogy?animal=${FOREIGN_ANIMAL_ID}`);

    expect(
      await screen.findByText(/No se pudo consultar el árbol genealógico/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/No tienes permisos sobre el rancho de este registro/i)
    ).toBeInTheDocument();
  });
});
