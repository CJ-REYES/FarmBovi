import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CattleProvider } from '../../context/CattleContext';
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
    await db.media.clear();
    await db.cattle.clear();
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
});
