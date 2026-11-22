import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { db } from '../../lib/database/db';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import WeighingPage from './WeighingPage';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';

function setOnlineStatus(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value: online
  });
}

async function seedWorld() {
  const now = new Date().toISOString();
  await RanchRepository.upsertFromServer([
    {
      id: RANCH_A,
      remoteId: RANCH_A,
      ranchId: RANCH_A,
      nombre: 'Rancho La Esperanza',
      ubicacionGeneral: 'Candelaria',
      estado: 'Activo',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    }
  ]);

  await CattleRepository.upsertFromServer([
    {
      id: ANIMAL_1,
      remoteId: ANIMAL_1,
      ranchId: RANCH_A,
      arete: 'MX-850',
      areteSiniiga: 'MX-850',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'M',
      fechaNacimiento: '2024-01-10',
      fechaIngreso: '2024-01-10',
      procedencia: 'Propio',
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

function renderWeighingPage() {
  return render(
    <MemoryRouter initialEntries={['/weighing']}>
      <WeighingPage />
    </MemoryRouter>
  );
}

describe('WeighingPage — Registro de pesajes, gráfica real, último peso, recarga y CRUD offline', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.cattle.clear(),
      db.weighings.clear(),
      db.weighingAnalysisJobs.clear(),
      db.media.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedWorld();
  });

  it('no muestra gráfica ficticia sin datos y valida pesos positivos y campos obligatorios', async () => {
    const user = userEvent.setup();
    renderWeighingPage();

    expect(await screen.findByText(/Datos insuficientes para graficar/i)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Gráfica de evolución real/i })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /Registrar Pesaje Oficial/i })[0]);
    const dialog = await screen.findByRole('dialog');

    // Envío vacío
    await user.click(within(dialog).getByRole('button', { name: /Guardar Pesaje/i }));
    expect(
      await within(dialog).findByText(/El peso real de báscula \(kg\) debe ser un número positivo/i)
    ).toBeInTheDocument();

    // Peso negativo
    await user.type(within(dialog).getByLabelText(/Peso Real de Báscula/i), '-25');
    await user.click(within(dialog).getByRole('button', { name: /Guardar Pesaje/i }));
    expect(
      await within(dialog).findByText(/El peso real de báscula \(kg\) debe ser un número positivo/i)
    ).toBeInTheDocument();
    expect(await db.weighings.count()).toBe(0);
  });

  it('registra 2 pesajes offline, muestra último peso, genera gráfica real, sobrevive recarga, edita y desactiva', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWeighingPage();

    await screen.findByText(/Sin pesajes registrados/i);

    // 1. Primer pesaje (320 kg el 1 feb)
    await user.click(screen.getAllByRole('button', { name: /Registrar Pesaje Oficial/i })[0]);
    const d1 = await screen.findByRole('dialog');
    await user.click(within(d1).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(d1).getByRole('option', { name: /MX-850/i }));
    await user.type(within(d1).getByLabelText(/Peso Real de Báscula/i), '320');
    const fecha1 = within(d1).getByLabelText(/Fecha y Hora del Pesaje/i);
    await user.clear(fecha1);
    await user.type(fecha1, '2026-02-01T08:00');
    await user.type(within(d1).getByLabelText(/Fuente \/ Báscula/i), 'Báscula Corral 1');
    await user.type(within(d1).getByLabelText(/^Responsable/i), 'Carlos Reyes');
    await user.type(within(d1).getByLabelText(/Observaciones/i), 'Pesaje inicial febrero');
    await user.click(within(d1).getByRole('button', { name: /Guardar Pesaje/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Con 1 solo pesaje todavía no dibuja gráfica ficticia
    expect(
      await screen.findByText(/Existe 1 pesaje registrado \(320\.0 kg\)/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Gráfica de evolución real/i })).not.toBeInTheDocument();

    // 2. Segundo pesaje (340 kg el 21 feb -> +20 kg en 20 días = +1.00 kg/día)
    await user.click(screen.getAllByRole('button', { name: /Registrar Pesaje Oficial/i })[0]);
    const d2 = await screen.findByRole('dialog');
    await user.click(within(d2).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(d2).getByRole('option', { name: /MX-850/i }));
    await user.type(within(d2).getByLabelText(/Peso Real de Báscula/i), '340');
    const fecha2 = within(d2).getByLabelText(/Fecha y Hora del Pesaje/i);
    await user.clear(fecha2);
    await user.type(fecha2, '2026-02-21T08:00');
    await user.type(within(d2).getByLabelText(/Fuente \/ Báscula/i), 'Báscula Corral 1');
    await user.type(within(d2).getByLabelText(/^Responsable/i), 'Carlos Reyes');
    await user.click(within(d2).getByRole('button', { name: /Guardar Pesaje/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Ahora sí renderiza la gráfica SVG real con valores 320.0 y 340.0 y GDP +1.00 kg/día
    const svgChart = await screen.findByRole('img', {
      name: /Gráfica de evolución real de peso en kilogramos/i
    });
    expect(svgChart).toBeInTheDocument();
    expect(svgChart.textContent).toContain('320.0');
    expect(svgChart.textContent).toContain('340.0');
    expect(screen.getByText(/\+1\.00/)).toBeInTheDocument();

    // 3. Simular recarga completa de la aplicación
    unmount();
    renderWeighingPage();

    const svgReloaded = await screen.findByRole('img', {
      name: /Gráfica de evolución real de peso en kilogramos/i
    });
    expect(svgReloaded.textContent).toContain('340.0');

    const stored = await db.weighings.toArray();
    const latestStored = stored.find((w) => w.peso === 340)!;

    // 4. Ver detalle y editar el último pesaje (animal inmutable)
    await user.click(screen.getByRole('button', { name: `Ver detalle del pesaje ${latestStored.id}` }));
    const detailAside = await screen.findByLabelText(/Detalle del pesaje seleccionado/i);
    expect(within(detailAside).getByText(new RegExp(latestStored.id))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Editar pesaje ${latestStored.id}` }));
    const editDialog = await screen.findByRole('dialog');
    expect(within(editDialog).getByLabelText(/^Animal/i)).toBeDisabled();

    const pesoInput = within(editDialog).getByLabelText(/Peso Real de Báscula/i);
    await user.clear(pesoInput);
    await user.type(pesoInput, '350');
    await user.click(within(editDialog).getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect((await screen.findAllByText(/350\.0 kg/i)).length).toBeGreaterThanOrEqual(2);

    // 5. Desactivar el segundo pesaje -> gráfica vuelve a pedir 2 pesajes (solo queda 1 activo)
    await user.click(screen.getByRole('button', { name: `Desactivar pesaje ${latestStored.id}` }));
    const deactDialog = await screen.findByRole('dialog');
    await user.click(within(deactDialog).getByRole('button', { name: /Confirmar desactivación/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText(/Datos insuficientes para graficar/i)
    ).toBeInTheDocument();

    // Mostrar pesajes desactivados recupera la fila desactivada en el historial
    await user.click(screen.getByLabelText(/Mostrar pesajes desactivados/i));
    expect(await screen.findByText('Desactivado')).toBeInTheDocument();
  });

  it('toma automáticamente el dato de BoviScale si el animal ya tiene pesaje registrado, o muestra botón para ir a BoviScale si no tiene', async () => {
    const user = userEvent.setup();

    function BoviScaleTargetProbe() {
      const loc = useLocation();
      return <div data-testid="boviscale-route">{`${loc.pathname}${loc.search}`}</div>;
    }

    // 1. Sin pesaje BoviScale -> aparece botón "Pesar en BoviScale" que redirige con el animal preseleccionado
    const { unmount } = render(
      <MemoryRouter initialEntries={['/weighing']}>
        <Routes>
          <Route path="/weighing" element={<WeighingPage />} />
          <Route path="/boviscale" element={<BoviScaleTargetProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText(/Datos insuficientes para graficar/i);
    await user.click(screen.getAllByRole('button', { name: /Registrar Pesaje Oficial/i })[0]);
    const dialogNoBovi = await screen.findByRole('dialog');

    await user.click(within(dialogNoBovi).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(dialogNoBovi).getByRole('option', { name: /MX-850/i }));

    expect(
      await within(dialogNoBovi).findByText(/Sin pesaje registrado en BoviScale/i)
    ).toBeInTheDocument();

    await user.click(within(dialogNoBovi).getByRole('button', { name: /Pesar en BoviScale/i }));
    expect(await screen.findByTestId('boviscale-route')).toHaveTextContent(
      `/boviscale?animal=${ANIMAL_1}&tipo=BoviScaleVision`
    );
    unmount();

    // 2. Con pesaje BoviScale registrado -> precarga automáticamente el peso y muestra comparativa BoviScale vs Báscula
    const now = new Date().toISOString();
    await db.weighingAnalysisJobs.put({
      idTrabajo: 'job-bs-1',
      idMedia: 'media-bs-1',
      idBovino: ANIMAL_1,
      ranchId: RANCH_A,
      idOperacion: null,
      estado: 'pendiente_de_revision',
      pesoEstimadoKg: 432.5,
      pesoConfirmadoKg: null,
      idPesajeConfirmado: null,
      confianzaModelo: 0.92,
      versionModelo: 'boviscale-v1',
      observacionesModelo: null,
      intentos: 1,
      ultimoError: null,
      codigoErrorHttp: null,
      proximoIntento: null,
      fechaCreacion: now,
      actualizadoEn: now,
      analizadoEn: now,
      completadoEn: null
    });

    renderWeighingPage();
    await screen.findByText(/Datos insuficientes para graficar/i);
    await user.click(screen.getAllByRole('button', { name: /Registrar Pesaje Oficial/i })[0]);
    const dialogWithBovi = await screen.findByRole('dialog');

    await user.click(within(dialogWithBovi).getByRole('combobox', { name: /^Animal/i }));
    await user.click(within(dialogWithBovi).getByRole('option', { name: /MX-850/i }));

    expect(
      await within(dialogWithBovi).findByText(/BoviScale vs Báscula: 432\.5 kg/i)
    ).toBeInTheDocument();
    expect(within(dialogWithBovi).getByLabelText(/Peso Real de Báscula/i)).toHaveValue(432.5);
  });
});
