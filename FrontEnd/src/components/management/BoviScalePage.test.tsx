import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CattleProvider } from '../../context/CattleContext';
import { registerUnauthorizedHandler } from '../../lib/api';
import { db } from '../../lib/database/db';
import { MediaRepository } from '../../lib/database/repositories/media.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import CattleDetailPage from '../cattle/CattleDetailPage';
import BoviScalePage from './BoviScalePage';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const ANIMAL_ID = '22222222-2222-4222-8222-222222222222';

async function seedCattle() {
  const now = new Date().toISOString();
  await db.cattle.put({
    id: ANIMAL_ID,
    remoteId: ANIMAL_ID,
    ranchId: RANCH_ID,
    arete: 'MX-BOV-888',
    areteSiniiga: 'MX-BOV-888',
    raza: 'Suizo Pardo',
    sexo: 'Hembra',
    gender: 'Hembra',
    fechaNacimiento: '2022-03-01',
    fechaIngreso: '2022-04-01',
    procedencia: 'Rancho',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    serverVersion: 1,
    deletedAt: null
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/boviscale']}>
      <BoviScalePage />
    </MemoryRouter>
  );
}

describe('BoviScalePage (FE-04) — Cámara, permisos, vista previa Blob, liberación de recursos y persistencia offline', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    registerUnauthorizedHandler(null);
    window.sessionStorage.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    await db.media.clear();
    await db.cattle.clear();
    await db.weighings.clear();
    await db.weighingAnalysisJobs.clear();
    await db.outbox.clear();
    await seedCattle();

    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', {
        writable: true,
        value: vi.fn(() => 'blob:mock-preview-url')
      });
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview-url');
    }

    if (typeof URL.revokeObjectURL !== 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', {
        writable: true,
        value: vi.fn()
      });
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    }
  });

  it('muestra mensajes claros cuando se rechazan permisos de cámara o no existe cámara física', async () => {
    const user = userEvent.setup();

    // Caso 1: permiso rechazado (NotAllowedError)
    const deniedErr = new Error('Permission denied');
    deniedErr.name = 'NotAllowedError';
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(deniedErr)
      }
    });

    renderPage();
    await screen.findByText(/Sin fotografías guardadas/i);

    await user.click(screen.getByRole('button', { name: /Iniciar Cámara/i }));
    expect(await screen.findByText(/Permiso de cámara rechazado/i)).toBeInTheDocument();

    // Caso 2: dispositivo sin cámara (NotFoundError)
    const notFoundErr = new Error('No camera');
    notFoundErr.name = 'NotFoundError';
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(notFoundErr)
      }
    });

    await user.click(screen.getByRole('button', { name: /Iniciar Cámara/i }));
    expect(await screen.findByText(/No se detectó ninguna cámara física/i)).toBeInTheDocument();
  });

  it('captura fotografía desde la cámara, libera los tracks, permite descartar y revoca el ObjectURL', async () => {
    const user = userEvent.setup();
    const stopSpy = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: stopSpy }]
    } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(fakeStream)
      }
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn()
    } as unknown as CanvasRenderingContext2D);

    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }));
    });

    renderPage();
    await screen.findByText(/Sin fotografías guardadas/i);

    // Iniciar cámara -> video activo
    await user.click(screen.getByRole('button', { name: /Iniciar Cámara/i }));
    expect(await screen.findByLabelText(/Vista en vivo de la cámara/i)).toBeInTheDocument();

    // Capturar fotograma -> genera vista previa y libera los tracks inmediatamente
    await user.click(screen.getByRole('button', { name: /Capturar Fotografía/i }));
    expect(
      await screen.findByAltText(/Vista previa de fotografía capturada/i)
    ).toBeInTheDocument();
    expect(stopSpy).toHaveBeenCalled();

    // Descartar -> elimina la vista previa y revoca ObjectURL para liberar memoria
    await user.click(screen.getByRole('button', { name: /Descartar/i }));
    await waitFor(() => {
      expect(
        screen.queryByAltText(/Vista previa de fotografía capturada/i)
      ).not.toBeInTheDocument();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview-url');
  });

  it('criterio de aceptación offline: captura/adjunta foto sin conexión, la asocia al animal, sobrevive recarga y queda pendiente de sincronización', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const { unmount } = renderPage();
    await screen.findByText(/Sin fotografías guardadas/i);

    // 1. Seleccionar animal MX-BOV-888 usando el desplegable con buscador interno
    await user.click(screen.getByRole('combobox', { name: /Animal Asociado/i }));
    await user.type(screen.getByPlaceholderText(/Buscar animal por arete/i), 'MX-BOV-888');
    await user.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: /MX-BOV-888/i })
    );

    // 2. Adjuntar fotografía JPEG válida
    const fileInput = document.getElementById('boviscale-file-input') as HTMLInputElement;
    const validFile = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02])], 'bovino.jpg', {
      type: 'image/jpeg'
    });
    await user.upload(fileInput, validFile);

    expect(
      await screen.findByAltText(/Vista previa de fotografía capturada/i)
    ).toBeInTheDocument();

    // 3. Guardar fotografía en IndexedDB (Blob + metadatos + cola pendiente)
    await user.click(screen.getByRole('button', { name: /Guardar Fotografía/i }));

    await waitFor(async () => {
      expect(await db.media.count()).toBe(1);
    });

    const stored = (await db.media.toArray())[0];
    expect(stored.cattleId).toBe(ANIMAL_ID);
    expect(stored.blobData).toBeDefined();
    expect(typeof stored.blobData).not.toBe('string');
    expect(stored.mimeType).toBe('image/jpeg');
    expect(stored.estadoArchivo).toBe('pendiente_subida');
    expect(stored.syncStatus).toBe('pending');

    const outboxOps = await OutboxRepository.getByEntity('media', stored.id);
    expect(outboxOps).toHaveLength(1);
    expect(outboxOps[0].estado).toBe('pendiente');

    // 4. Simular cierre y reapertura (desmontar y volver a montar) -> fotografía recuperada
    unmount();
    renderPage();

    expect(await screen.findByRole('link', { name: 'MX-BOV-888' })).toBeInTheDocument();
    expect(screen.getAllByText(/Pendiente de subida/i).length).toBeGreaterThan(0);

    // 5. Eliminar del historial local con confirmación
    await user.click(screen.getByRole('button', { name: /Eliminar fotografía/i }));
    const confirmDialog = screen.getByRole('dialog');
    await user.click(
      within(confirmDialog).getByRole('button', { name: /Confirmar Eliminación/i })
    );

    await waitFor(async () => {
      const remaining = await db.media.filter((m) => !m.deletedAt).count();
      expect(remaining).toBe(0);
    });
  });

  it('muestra la Foto de perfil y las capturas BoviScale dentro del expediente individual del animal', async () => {
    await MediaRepository.saveCapture({
      fileOrBlob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01])], {
        type: 'image/jpeg'
      }),
      tipo: 'FotoPerfil',
      cattleId: ANIMAL_ID,
      ranchId: RANCH_ID,
      nombreArchivo: 'perfil_mx888.jpg'
    });

    await MediaRepository.saveCapture({
      fileOrBlob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x02])], {
        type: 'image/jpeg'
      }),
      tipo: 'BoviScaleVision',
      cattleId: ANIMAL_ID,
      ranchId: RANCH_ID,
      nombreArchivo: 'lateral_mx888.jpg'
    });

    render(
      <MemoryRouter initialEntries={[`/cattle/${ANIMAL_ID}`]}>
        <CattleProvider>
          <Routes>
            <Route path="/cattle/:id" element={<CattleDetailPage />} />
          </Routes>
        </CattleProvider>
      </MemoryRouter>
    );

    expect(await screen.findByAltText(/Foto de perfil de MX-BOV-888/i)).toBeInTheDocument();
    expect(await screen.findByText(/Fotos BoviScale \(1\)/i)).toBeInTheDocument();
    expect(await screen.findByAltText(/Foto BoviScale de MX-BOV-888/i)).toBeInTheDocument();
  });

  it('flujo completo BoviScale exitoso en UI: valida foto, muestra procesamiento, despliega peso estimado y actualiza historial sin recargar', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-ui-boviscale');

    const pesajeId = crypto.randomUUID();
    let resolveEstimate!: (res: Response) => void;
    const estimatePromise = new Promise<Response>((resolve) => {
      resolveEstimate = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/media/archivos') && init?.method === 'POST') {
        const fd = init.body as FormData;
        const idArchivo = String(fd.get('idArchivo'));
        const now = new Date().toISOString();
        return new Response(
          JSON.stringify({
            idArchivo,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            entidadRelacionada: 'cattle',
            idEntidadRelacionada: ANIMAL_ID,
            tipo: 'BoviScaleVision',
            nombreArchivo: 'lateral.png',
            mimeType: 'image/png',
            extension: '.png',
            tamanoBytes: 12,
            checksumSha256: null,
            proveedorAlmacenamiento: 'LocalFileSystem',
            rutaArchivo: `ranch/pesaje-ganado/${idArchivo}.png`,
            estado: 'Disponible',
            urlContenido: `/api/media/archivos/${idArchivo}/contenido`,
            urlPublica: `/api/media/archivos/${idArchivo}/contenido`,
            fechaCaptura: now,
            fechaCarga: now,
            creadoEn: now,
            versionRegistro: 1,
            eliminadoEn: null
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/boviscale/estimaciones') && init?.method === 'POST') {
        return await estimatePromise;
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    renderPage();
    await screen.findByText(/Sin fotografías guardadas/i);

    // Estado inicial: Fotografía pendiente
    const statusBox = screen.getByTestId('boviscale-estimation-status');
    expect(within(statusBox).getByText(/Fotografía pendiente/i)).toBeInTheDocument();

    // Seleccionar bovino MX-BOV-888
    await user.click(screen.getByRole('combobox', { name: /Animal Asociado/i }));
    await user.type(screen.getByPlaceholderText(/Buscar animal por arete/i), 'MX-BOV-888');
    await user.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: /MX-BOV-888/i })
    );

    // Adjuntar fotografía PNG válida -> pasa a Fotografía validada
    const fileInput = document.getElementById('boviscale-file-input') as HTMLInputElement;
    const pngFile = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])],
      'lateral.png',
      { type: 'image/png' }
    );
    await user.upload(fileInput, pngFile);
    expect(within(statusBox).getByText(/Fotografía validada/i)).toBeInTheDocument();

    // Solicitar estimación -> muestra estado de procesamiento y NO muestra peso definitivo aún
    await user.click(screen.getByRole('button', { name: /^Estimar Peso$/i }));
    expect(await within(statusBox).findByText(/Procesando estimación/i)).toBeInTheDocument();
    expect(screen.queryByTestId('boviscale-estimation-result')).not.toBeInTheDocument();

    // Backend .NET devuelve respuesta confirmada desde Python + MySQL
    const now = new Date().toISOString();
    resolveEstimate(
      new Response(
        JSON.stringify({
          idPesaje: pesajeId,
          idSolicitud: crypto.randomUUID(),
          idRancho: RANCH_ID,
          idAnimal: ANIMAL_ID,
          idArchivoMultimedia: null,
          pesoEstimadoKg: 482.5,
          unidadPeso: 'kg',
          confianzaModelo: 0.89,
          versionModelo: 'boviscale-v1.0.0',
          observaciones: 'Captura lateral adecuada',
          origenPesaje: 'boviscale_ia',
          fuenteBascula: 'BoviScale IA (boviscale-v1.0.0)',
          responsable: 'Carlos Ganadero',
          fechaPesaje: now,
          creadoEn: now,
          versionRegistro: 1,
          duplicadoIgnorado: false,
          tiempoProcesamientoMs: 950
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );

    // Muestra Pesaje registrado + peso estimado y unidad + actualiza historial del bovino sin recargar
    expect(await within(statusBox).findByText(/Pesaje registrado/i)).toBeInTheDocument();
    const resultCard = screen.getByTestId('boviscale-estimation-result');
    expect(within(resultCard).getByText(/482\.5 kg/i)).toBeInTheDocument();
    expect(within(resultCard).getByText(/89\.0%/i)).toBeInTheDocument();

    const historySection = screen.getByRole('region', {
      name: /Historial de pesajes del bovino/i
    });
    expect(await within(historySection).findByText(/482\.5 kg/i)).toBeInTheDocument();
    expect(within(historySection).getByText(/^BoviScale IA$/i)).toBeInTheDocument();
  });

  it('flujo de error en UI: si Python no responde (503) muestra Error de procesamiento, no registra pesaje y permite reintentar; si JWT expira (401) activa manejador de sesión', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-ui-error');
    const unauthorizedSpy = vi.fn();
    registerUnauthorizedHandler(unauthorizedSpy);

    let estimateAttempt = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/media/archivos') && init?.method === 'POST') {
        const fd = init.body as FormData;
        const idArchivo = String(fd.get('idArchivo'));
        const now = new Date().toISOString();
        return new Response(
          JSON.stringify({
            idArchivo,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            entidadRelacionada: 'cattle',
            idEntidadRelacionada: ANIMAL_ID,
            tipo: 'BoviScaleVision',
            nombreArchivo: 'fallo.png',
            mimeType: 'image/png',
            extension: '.png',
            tamanoBytes: 12,
            checksumSha256: null,
            proveedorAlmacenamiento: 'LocalFileSystem',
            rutaArchivo: `ranch/pesaje-ganado/${idArchivo}.png`,
            estado: 'Disponible',
            urlContenido: `/api/media/archivos/${idArchivo}/contenido`,
            urlPublica: `/api/media/archivos/${idArchivo}/contenido`,
            fechaCaptura: now,
            fechaCarga: now,
            creadoEn: now,
            versionRegistro: 1,
            eliminadoEn: null
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/boviscale/estimaciones') && init?.method === 'POST') {
        estimateAttempt++;
        if (estimateAttempt === 1) {
          return new Response(
            JSON.stringify({ detail: 'El servicio Python no está disponible.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ detail: 'Token expirado.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    renderPage();
    await screen.findByText(/Sin fotografías guardadas/i);

    await user.click(screen.getByRole('combobox', { name: /Animal Asociado/i }));
    await user.type(screen.getByPlaceholderText(/Buscar animal por arete/i), 'MX-BOV-888');
    await user.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: /MX-BOV-888/i })
    );

    const fileInput = document.getElementById('boviscale-file-input') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x03, 0x04])],
        'fallo.png',
        { type: 'image/png' }
      )
    );

    // Intento 1: Backend devuelve 503 -> Error de procesamiento, sin pesaje registrado y botón Reintentar
    await user.click(screen.getByRole('button', { name: /^Estimar Peso$/i }));
    const statusBox = screen.getByTestId('boviscale-estimation-status');
    expect(await within(statusBox).findByText(/Error de procesamiento/i)).toBeInTheDocument();
    expect(within(statusBox).getByText(/no pudo completarse/i)).toBeInTheDocument();
    expect(screen.queryByTestId('boviscale-estimation-result')).not.toBeInTheDocument();
    expect(await db.weighings.count()).toBe(0);

    // Intento 2: Reintentar -> Backend devuelve 401 JWT expirado -> dispara unauthorizedHandler
    await user.click(within(statusBox).getByRole('button', { name: /Reintentar estimación/i }));
    await waitFor(() => {
      expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
    });
    expect(within(statusBox).getByText(/sesión JWT expiró/i)).toBeInTheDocument();
    expect(await db.weighings.count()).toBe(0);
  });

  it('captura y solicitud offline conserva solicitud pendiente tras reinicio y permite procesarla al recuperar conexión actualizando el historial', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-offline-recovery');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });

    const { unmount } = renderPage();
    await screen.findByText(/Sin fotografías guardadas/i);

    await user.click(screen.getByRole('combobox', { name: /Animal Asociado/i }));
    await user.type(screen.getByPlaceholderText(/Buscar animal por arete/i), 'MX-BOV-888');
    await user.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: /MX-BOV-888/i })
    );

    const fileInput = document.getElementById('boviscale-file-input') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x05, 0x06])],
        'offline_boviscale.png',
        { type: 'image/png' }
      )
    );

    // Solicitar estimación sin conexión -> informa que requiere conexión y guarda solicitud pendiente
    await user.click(screen.getByRole('button', { name: /^Estimar Peso$/i }));
    const statusBox = screen.getByTestId('boviscale-estimation-status');
    expect(await within(statusBox).findByText(/requiere conexión con el servidor/i)).toBeInTheDocument();
    expect(await screen.findByTestId('boviscale-pending-requests')).toBeInTheDocument();
    expect(await db.weighings.count()).toBe(0);

    // Simular cierre y reapertura de la app y restablecimiento de conexión
    unmount();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });

    const pesajeId = crypto.randomUUID();
    const now = new Date().toISOString();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/media/archivos') && init?.method === 'POST') {
        const fd = init.body as FormData;
        const idArchivo = String(fd.get('idArchivo'));
        return new Response(
          JSON.stringify({
            idArchivo,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            entidadRelacionada: 'cattle',
            idEntidadRelacionada: ANIMAL_ID,
            tipo: 'BoviScaleVision',
            nombreArchivo: 'offline_boviscale.png',
            mimeType: 'image/png',
            extension: '.png',
            tamanoBytes: 12,
            checksumSha256: null,
            proveedorAlmacenamiento: 'LocalFileSystem',
            rutaArchivo: `ranch/pesaje-ganado/${idArchivo}.png`,
            estado: 'Disponible',
            urlContenido: `/api/media/archivos/${idArchivo}/contenido`,
            urlPublica: `/api/media/archivos/${idArchivo}/contenido`,
            fechaCaptura: now,
            fechaCarga: now,
            creadoEn: now,
            versionRegistro: 1,
            eliminadoEn: null
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/boviscale/estimaciones') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            idPesaje: pesajeId,
            idSolicitud: body.idSolicitud,
            idRancho: RANCH_ID,
            idAnimal: ANIMAL_ID,
            idArchivoMultimedia: body.idArchivo,
            pesoEstimadoKg: 505.5,
            unidadPeso: 'kg',
            confianzaModelo: 0.92,
            versionModelo: 'boviscale-v1.3.0',
            observaciones: 'Procesado al reconectar',
            origenPesaje: 'boviscale_ia',
            fuenteBascula: 'BoviScale IA (boviscale-v1.3.0)',
            responsable: 'Carlos',
            fechaPesaje: now,
            creadoEn: now,
            versionRegistro: 1,
            duplicadoIgnorado: false,
            tiempoProcesamientoMs: 780
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    renderPage();
    const pendingPanel = await screen.findByTestId('boviscale-pending-requests');
    await user.click(within(pendingPanel).getByRole('button', { name: /Procesar pendiente/i }));

    const resultCard = await screen.findByTestId('boviscale-estimation-result');
    expect(within(resultCard).getByText(/505\.5 kg/i)).toBeInTheDocument();

    const historySection = screen.getByRole('region', {
      name: /Historial de pesajes del bovino/i
    });
    expect(await within(historySection).findByText(/505\.5 kg/i)).toBeInTheDocument();
  });
});
