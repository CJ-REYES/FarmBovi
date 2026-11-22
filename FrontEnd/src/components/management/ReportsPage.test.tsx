import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { ReportsService } from '../../services/reports.service';
import ReportsPage from './ReportsPage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const LOT_A = '22222222-2222-4222-8222-222222222221';
const LOT_B = '22222222-2222-4222-8222-222222222222';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';
const ANIMAL_2 = '33333333-3333-4333-8333-333333333332';

async function seedOfflineIndexedDb() {
  const now = '2026-11-20T10:00:00Z';
  await db.ranches.put({
    id: RANCH_ID,
    remoteId: RANCH_ID,
    ranchId: RANCH_ID,
    nombre: 'Rancho El Encino',
    ubicacionGeneral: 'Veracruz',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    deletedAt: null
  });

  await db.lots.bulkPut([
    {
      id: LOT_A,
      remoteId: LOT_A,
      ranchId: RANCH_ID,
      nombre: 'Potrero El Cedro',
      capacidad: 30,
      ubicacion: 'Norte',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    },
    {
      id: LOT_B,
      remoteId: LOT_B,
      ranchId: RANCH_ID,
      nombre: 'Potrero La Palma',
      capacidad: 25,
      ubicacion: 'Sur',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    }
  ]);

  await db.cattle.bulkPut([
    {
      id: ANIMAL_1,
      remoteId: ANIMAL_1,
      ranchId: RANCH_ID,
      arete: 'FB-101',
      areteSiniiga: 'FB-101',
      raza: 'Brahman',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2023-02-01',
      fechaIngreso: '2024-01-15',
      procedencia: 'Propio',
      estado: 'Activo',
      fechaSalida: null,
      loteId: LOT_A,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    },
    {
      id: ANIMAL_2,
      remoteId: ANIMAL_2,
      ranchId: RANCH_ID,
      arete: 'FB-102',
      areteSiniiga: 'FB-102',
      raza: 'Angus',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2026-06-01',
      fechaIngreso: '2026-06-01',
      procedencia: 'Nacimiento en rancho',
      estado: 'Activo',
      fechaSalida: null,
      loteId: LOT_B,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    }
  ]);

  await db.weighings.bulkPut([
    {
      id: 'w-101',
      ranchId: RANCH_ID,
      cattleId: ANIMAL_1,
      peso: 410,
      fecha: '2026-10-01T08:00:00Z',
      fuenteBascula: 'Báscula 1',
      responsable: 'Carlos',
      origenPesaje: 'manual',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      deletedAt: null
    },
    {
      id: 'w-102',
      ranchId: RANCH_ID,
      cattleId: ANIMAL_1,
      peso: 440,
      fecha: '2026-11-05T08:00:00Z',
      fuenteBascula: 'Báscula 1',
      responsable: 'Carlos',
      origenPesaje: 'manual',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      deletedAt: null
    }
  ]);

  await db.healthRecords.put({
    id: 'h-101',
    remoteId: 'h-101',
    ranchId: RANCH_ID,
    cattleId: ANIMAL_1,
    tipo: 'Vacunación',
    descripcion: 'Vacuna triple',
    fecha: '2026-11-02T09:00:00Z',
    responsable: 'MVZ Ana',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    deletedAt: null
  });

  await db.treatments.bulkPut([
    {
      id: 't-101',
      remoteId: 't-101',
      ranchId: RANCH_ID,
      eventoSanitarioId: 'h-101',
      cattleId: ANIMAL_1,
      producto: 'Oxitetraciclina',
      dosis: 10,
      unidadDosis: 'mL',
      frecuencia: 'Diaria',
      fechaInicio: '2026-11-02',
      responsable: 'MVZ Ana',
      estado: 'Pendiente',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    },
    {
      id: 't-102',
      remoteId: 't-102',
      ranchId: RANCH_ID,
      eventoSanitarioId: 'h-101',
      cattleId: ANIMAL_1,
      producto: 'Complejo B',
      dosis: 5,
      unidadDosis: 'mL',
      frecuencia: 'Dosis única',
      fechaInicio: '2026-11-02',
      responsable: 'MVZ Ana',
      estado: 'Completado',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      deletedAt: null
    }
  ]);

  await db.feedingRecords.put({
    id: 'f-101',
    remoteId: 'f-101',
    ranchId: RANCH_ID,
    lotId: LOT_A,
    tipoAlimento: 'Silo de Sorgo',
    cantidadKg: 85,
    racion: 'Mañana',
    unidad: 'kg',
    frecuencia: 'Diaria',
    fecha: '2026-11-04T07:00:00Z',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    deletedAt: null
  });

  await db.reproductionRecords.put({
    id: 'r-101',
    ranchId: RANCH_ID,
    cattleId: ANIMAL_1,
    evento: 'Monta Natural',
    fecha: '2026-11-06T10:00:00Z',
    resultado: 'Pendiente',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
    deletedAt: null
  });

  await db.movements.put({
    id: 'm-101',
    remoteId: 'm-101',
    ranchId: RANCH_ID,
    cattleId: ANIMAL_2,
    origenLotId: LOT_A,
    destinoLotId: LOT_B,
    tipo: 'CambioInterno',
    fecha: '2026-11-08T10:00:00Z',
    motivo: 'Destete',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    deletedAt: null
  });
}

describe('ReportsPage — Indicadores reales, filtros, modo offline, estado vacío y errores', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([
      db.ranches.clear(),
      db.lots.clear(),
      db.cattle.clear(),
      db.weighings.clear(),
      db.healthRecords.clear(),
      db.treatments.clear(),
      db.feedingRecords.clear(),
      db.reproductionRecords.clear(),
      db.movements.clear()
    ]);
  });

  it('muestra estado vacío real sin cifras ficticias cuando no existen registros en IndexedDB', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    );

    expect(
      await screen.findByText(/Aún no hay registros para generar reportes/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-total-animales')).not.toBeInTheDocument();
  });

  it('calcula todos los indicadores offline desde IndexedDB, coincide con los totales reales y responde a los filtros y exportación', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await seedOfflineIndexedDb();

    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-report-download');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('kpi-total-animales')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-total-pesajes')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-eventos-sanitarios')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-tratamientos-pendientes')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-alimentacion')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-reproduccion')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-movimientos')).toHaveTextContent('1');

    // Verificar indicador offline visible y documentación de dependencias Backend
    expect(screen.getByText(/Modo offline · Indicadores calculados desde IndexedDB/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Transparencia de Fuentes y Dependencias Pendientes del Backend/i)
    ).toBeInTheDocument();

    // Filtrar por Potrero El Cedro (solo ANIMAL_1)
    await user.selectOptions(screen.getByLabelText(/Potrero \/ Lote/i), LOT_A);
    await waitFor(() => {
      expect(screen.getByTestId('kpi-total-animales')).toHaveTextContent('1');
    });
    expect(screen.getByTestId('kpi-total-pesajes')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-alimentacion')).toHaveTextContent('1');

    // Limpiar filtros y probar validación de rango de fechas invertido
    await user.click(screen.getByRole('button', { name: /Limpiar filtros/i }));
    await user.type(screen.getByLabelText(/Fecha desde/i), '2026-11-20');
    await user.type(screen.getByLabelText(/Fecha hasta/i), '2026-11-01');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /La fecha inicial no puede ser posterior a la fecha final/i
    );

    // Exportar CSV, JSON y PDFs (Individual y por Lote)
    await user.click(screen.getByRole('button', { name: /Exportar CSV/i }));
    expect(await screen.findByText(/Archivo CSV descargado/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^JSON$/i }));
    expect(await screen.findByText(/Reporte JSON descargado/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Descargar PDF Individual/i }));
    expect(await screen.findByText(/PDF generado y descargado.*1 página/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Descargar PDF del Lote/i }));
    expect(await screen.findByText(/PDF generado y descargado.*2 páginas/i)).toBeInTheDocument();

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(4);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(4);
  });

  it('muestra estado de error y permite reintentar cuando falla la carga del dataset', async () => {
    const user = userEvent.setup();
    const loadSpy = vi
      .spyOn(ReportsService, 'loadDataset')
      .mockRejectedValueOnce(new Error('Fallo de lectura en IndexedDB'));

    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/No se pudieron cargar los reportes/i)).toBeInTheDocument();
    expect(screen.getByText(/Fallo de lectura en IndexedDB/i)).toBeInTheDocument();

    loadSpy.mockRestore();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await user.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(
      await screen.findByText(/Aún no hay registros para generar reportes/i)
    ).toBeInTheDocument();
  });
});
