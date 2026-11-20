import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import GenealogyPage from './GenealogyPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const FATHER_ID = '22222222-2222-4222-8222-222222222222';
const MOTHER_ID = '33333333-3333-4333-8333-333333333333';
const CALF_ID = '44444444-4444-4444-8444-444444444444';

async function seedAnimals() {
  const now = new Date().toISOString();
  await db.cattle.bulkPut([
    {
      id: FATHER_ID,
      remoteId: FATHER_ID,
      ranchId: RANCH_ID,
      arete: 'MX-SEM-100',
      areteSiniiga: 'MX-SEM-100',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2020-02-01',
      fechaIngreso: '2020-03-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: MOTHER_ID,
      remoteId: MOTHER_ID,
      ranchId: RANCH_ID,
      arete: 'MX-VIE-200',
      areteSiniiga: 'MX-VIE-200',
      raza: 'Suizo Pardo',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2020-04-01',
      fechaIngreso: '2020-05-01',
      procedencia: 'Rancho',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    },
    {
      id: CALF_ID,
      remoteId: CALF_ID,
      ranchId: RANCH_ID,
      arete: 'MX-BEC-300',
      areteSiniiga: 'MX-BEC-300',
      raza: 'Cruza',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2023-07-10',
      fechaIngreso: '2023-07-10',
      procedencia: 'Nacimiento',
      estado: 'Activo',
      fechaSalida: null,
      observaciones: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    }
  ]);
}

function renderPage(initialPath = '/genealogy') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <GenealogyPage />
    </MemoryRouter>
  );
}

describe('GenealogyPage — Árbol genealógico visual, búsqueda, anti-duplicados y persistencia offline', () => {
  beforeEach(async () => {
    await db.genealogy.clear();
    await db.cattle.clear();
    await db.outbox.clear();
    await seedAnimals();
  });

  it('muestra mensajes claros cuando un animal no tiene datos genealógicos y no inventa relaciones', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Dependencia de Backend documentada/i)).toBeInTheDocument();
    });

    // Buscar y seleccionar MX-BEC-300 en el selector de árbol
    await user.click(
      screen.getByRole('combobox', { name: /Consultar árbol genealógico de un animal/i })
    );
    await user.type(screen.getByPlaceholderText(/Filtrar animal por arete/i), 'MX-BEC-300');
    await user.click(screen.getByRole('option', { name: /MX-BEC-300/i }));

    expect(
      await screen.findByText(/Sin datos genealógicos registrados para MX-BEC-300/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Padre no registrado')).toBeInTheDocument();
    expect(screen.getByText('Madre no registrada')).toBeInTheDocument();
    expect(screen.getByText(/Sin descendientes registrados para MX-BEC-300/i)).toBeInTheDocument();
  });

  it('registra padre y madre, visualiza árbol y descendientes, impide duplicados, sobrevive recarga y desactiva', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Dependencia de Backend documentada/i)).toBeInTheDocument();
    });

    // 1. Abrir formulario y registrar parentesco para MX-BEC-300
    await user.click(screen.getAllByRole('button', { name: /Registrar Parentesco/i })[0]);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-BEC-300/i }));

    await user.click(within(dialog).getByRole('combobox', { name: /^Padre/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-SEM-100/i }));

    await user.click(within(dialog).getByRole('combobox', { name: /^Madre/i }));
    await user.click(within(dialog).getByRole('option', { name: /MX-VIE-200/i }));

    await user.click(within(dialog).getByRole('button', { name: /Guardar Parentesco/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // 2. Verificar visualización del árbol con Padre (MX-SEM-100) y Madre (MX-VIE-200)
    const treeSection = await screen.findByRole('region', {
      name: /Árbol genealógico de MX-BEC-300/i
    });
    expect(within(treeSection).getByText('MX-SEM-100')).toBeInTheDocument();
    expect(within(treeSection).getByText('MX-VIE-200')).toBeInTheDocument();

    // 3. Navegar al padre en el árbol y verificar que MX-BEC-300 aparece como descendiente directo
    await user.click(within(treeSection).getByRole('button', { name: /MX-SEM-100/i }));
    const fatherTree = await screen.findByRole('region', {
      name: /Árbol genealógico de MX-SEM-100/i
    });
    expect(within(fatherTree).getByText(/Descendientes Directos \(1\)/i)).toBeInTheDocument();
    expect(within(fatherTree).getByText('MX-BEC-300')).toBeInTheDocument();

    // 4. Intentar duplicar el parentesco para MX-BEC-300 -> bloqueado por validación
    await user.click(screen.getAllByRole('button', { name: /Registrar Parentesco/i })[0]);
    const dupDialog = screen.getByRole('dialog');
    await user.click(within(dupDialog).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(dupDialog).getByRole('option', { name: /MX-BEC-300/i }));
    await user.click(within(dupDialog).getByRole('combobox', { name: /^Padre/i }));
    await user.click(within(dupDialog).getByRole('option', { name: /MX-SEM-100/i }));
    await user.click(within(dupDialog).getByRole('button', { name: /Guardar Parentesco/i }));

    expect(
      await within(dupDialog).findByText(/ya tiene un registro de parentesco activo/i)
    ).toBeInTheDocument();
    await user.click(within(dupDialog).getByRole('button', { name: /Cancelar/i }));

    // 5. Simular recarga completa desde IndexedDB
    unmount();
    renderPage(`/genealogy?animal=${CALF_ID}`);

    const reloadedTree = await screen.findByRole('region', {
      name: /Árbol genealógico de MX-BEC-300/i
    });
    expect(within(reloadedTree).getByText('MX-SEM-100')).toBeInTheDocument();
    expect(within(reloadedTree).getByText('MX-VIE-200')).toBeInTheDocument();

    // 6. Desactivar vínculo desde el directorio
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
  });
});
