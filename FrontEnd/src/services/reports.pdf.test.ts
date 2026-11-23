import { describe, expect, it } from 'vitest';
import type { LocalGenealogy, LocalMedia } from '../lib/database/schema';
import { INITIAL_REPORT_FILTERS, type ReportDataset } from '../types/reports';
import { ReportsPdfService, normalizeJpegForJsPdf } from './reports.pdf';

const RANCH_ID = '11111111-1111-4111-8111-111111111111';
const LOT_NORTE = '22222222-2222-4222-8222-222222222221';
const ANIMAL_1 = '33333333-3333-4333-8333-333333333331';
const ANIMAL_2 = '33333333-3333-4333-8333-333333333332';
const ANIMAL_3 = '33333333-3333-4333-8333-333333333333';
const FATHER_ID = '33333333-3333-4333-8333-333333333391';
const MOTHER_ID = '33333333-3333-4333-8333-333333333392';

// PNG válido mínimo 1x1 (67 bytes) para probar incrustación real de foto de perfil en PDF
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function createValidPngBlob(): Blob {
  const binary = atob(TINY_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'image/png' });
}

function buildPdfFixture(): {
  dataset: ReportDataset;
  genealogy: LocalGenealogy[];
  media: LocalMedia[];
} {
  const now = '2026-11-20T10:00:00Z';

  const makeAnimal = (
    id: string,
    arete: string,
    raza: string,
    sexo: 'Hembra' | 'Macho',
    loteId: string | null,
    fechaNacimiento: string
  ) => ({
    id,
    idAnimal: id,
    idRancho: RANCH_ID,
    idLote: loteId,
    arete,
    raza,
    sexo,
    fechaNacimiento,
    fechaIngreso: '2024-01-10',
    procedencia: 'Nacimiento en rancho',
    estado: 'Activo',
    fechaSalida: null,
    observaciones: 'Animal en excelente condicion corporal',
    versionRegistro: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncStatus: 'synced' as const
  });

  const dataset: ReportDataset = {
    cattle: [
      makeAnimal(ANIMAL_1, 'FB-VACA-01', 'Brahman', 'Hembra', LOT_NORTE, '2023-03-10'),
      makeAnimal(ANIMAL_2, 'FB-NOV-02', 'Angus', 'Macho', LOT_NORTE, '2025-02-10'),
      makeAnimal(ANIMAL_3, 'FB-CRIA-03', 'Brahman', 'Hembra', LOT_NORTE, '2026-06-15'),
      makeAnimal(FATHER_ID, 'FB-TORO-PADRE', 'Brahman', 'Macho', null, '2020-01-01'),
      makeAnimal(MOTHER_ID, 'FB-VACA-MADRE', 'Gyr', 'Hembra', null, '2020-05-01')
    ],
    lots: [
      {
        id: LOT_NORTE,
        idLote: LOT_NORTE,
        idRancho: RANCH_ID,
        nombre: 'Potrero Norte',
        ubicacion: 'Sector Alto',
        estado: 'Activo',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced',
        activeAnimalsCount: 3
      }
    ],
    weighings: [
      {
        id: 'w-1',
        idPesaje: 'w-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_1,
        pesoRealKg: 430,
        fecha: '2026-09-01T08:00:00Z',
        fuenteBascula: 'Bascula Principal',
        responsable: 'Carlos',
        observaciones: null,
        origenPesaje: 'manual',
        sourceAnalysisJobId: null,
        sourceMediaId: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      },
      {
        id: 'w-2',
        idPesaje: 'w-2',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_1,
        pesoRealKg: 465,
        fecha: '2026-11-01T08:00:00Z',
        fuenteBascula: 'Bascula Principal',
        responsable: 'Carlos',
        observaciones: null,
        origenPesaje: 'manual',
        sourceAnalysisJobId: null,
        sourceMediaId: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      },
      {
        id: 'w-3',
        idPesaje: 'w-3',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_2,
        pesoRealKg: 310,
        fecha: '2026-10-01T08:00:00Z',
        fuenteBascula: 'Bascula Principal',
        responsable: 'Carlos',
        observaciones: null,
        origenPesaje: 'manual',
        sourceAnalysisJobId: null,
        sourceMediaId: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      }
    ],
    healthEvents: [
      {
        id: 'h-1',
        idEventoSanitario: 'h-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_1,
        tipo: 'Vacunacion',
        fecha: '2026-10-12T09:00:00Z',
        sintomas: null,
        diagnostico: 'Refuerzo anual',
        profesionalDiagnostico: 'MVZ Ana',
        evidenciaDiagnosticoUri: null,
        responsable: 'MVZ Ana',
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    treatments: [
      {
        id: 't-1',
        idTratamiento: 't-1',
        idRancho: RANCH_ID,
        idEventoSanitario: 'h-1',
        idAnimal: ANIMAL_1,
        producto: 'Vitamina AD3E',
        dosis: 5,
        unidadDosis: 'mL',
        viaAdministracion: 'Intramuscular',
        frecuencia: 'Cada 48h',
        fechaInicio: '2026-10-12',
        fechaFin: null,
        responsable: 'MVZ Ana',
        prescripcionUri: null,
        estado: 'Pendiente',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    feedingRecords: [
      {
        id: 'f-1',
        idAlimentacion: 'f-1',
        idRancho: RANCH_ID,
        targetType: 'lote',
        idAnimal: null,
        idLote: LOT_NORTE,
        alimento: 'Silo de Maiz',
        racion: 'Manana',
        cantidad: 90,
        unidad: 'kg',
        frecuencia: 'Diaria',
        inicio: '2026-11-01T07:00:00Z',
        fin: null,
        cambioDieta: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    reproductionEvents: [
      {
        id: 'r-1',
        idEventoReproductivo: 'r-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_1,
        tipo: 'Parto',
        fecha: '2026-06-15T06:00:00Z',
        resultado: 'Cria Viva',
        observaciones: null,
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'pending'
      }
    ],
    movements: [
      {
        id: 'm-1',
        idMovimiento: 'm-1',
        idRancho: RANCH_ID,
        idAnimal: ANIMAL_1,
        idLoteOrigen: null,
        idLoteDestino: LOT_NORTE,
        tipo: 'Alta',
        fecha: '2024-01-10T09:00:00Z',
        origenExterno: null,
        destinoExterno: null,
        motivo: 'Ingreso inicial',
        versionRegistro: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncStatus: 'synced'
      }
    ],
    dataSource: 'server',
    isOffline: false,
    warnings: [],
    loadedAt: now
  };

  const genealogy: LocalGenealogy[] = [
    {
      id: 'g-1',
      cattleId: ANIMAL_1,
      padreId: FATHER_ID,
      madreId: MOTHER_ID,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      deletedAt: null
    },
    {
      id: 'g-2',
      cattleId: ANIMAL_3,
      padreId: FATHER_ID,
      madreId: ANIMAL_1,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      deletedAt: null
    }
  ];

  const media: LocalMedia[] = [
    {
      id: 'media-profile-1',
      cattleId: ANIMAL_1,
      entidadRelacionada: 'cattle',
      idEntidadRelacionada: ANIMAL_1,
      tipo: 'FotoPerfil',
      nombreArchivo: 'perfil_fb_vaca_01.png',
      mimeType: 'image/png',
      tamanoBytes: 67,
      blobData: createValidPngBlob(),
      estadoArchivo: 'pendiente_subida',
      intentosSubida: 0,
      fechaCaptura: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      deletedAt: null
    }
  ];

  return { dataset, genealogy, media };
}

describe('ReportsPdfService — Generacion de PDF Individual, por Lote y General', () => {
  it('genera un PDF individual con foto de perfil, datos base, genealogia y graficas reales', async () => {
    const { dataset, genealogy, media } = buildPdfFixture();
    const result = await ReportsPdfService.generateIndividualAnimalPdf(
      dataset,
      ANIMAL_1,
      INITIAL_REPORT_FILTERS,
      { genealogy, media, ranchName: 'Rancho El Encino' }
    );

    expect(result.filename).toMatch(/^FarmBovi_Bovino_FB-VACA-01_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(result.pageCount).toBe(1);
    expect(result.blob.size).toBeGreaterThan(1500);

    const rawPdf = result.doc.output();
    expect(rawPdf.startsWith('%PDF-')).toBe(true);
    expect(rawPdf).toContain('FB-VACA-01');
    expect(rawPdf).toContain('FB-TORO-PADRE');
    expect(rawPdf).toContain('FB-VACA-MADRE');
    expect(rawPdf).toContain('FB-CRIA-03');
    expect(rawPdf).toContain('Foto de Perfil');
    expect(rawPdf).toContain('Evolucion Real de Peso');
    expect(rawPdf).toContain('Silo de Maiz');
    expect(rawPdf).toContain('Vitamina AD3E');
  });

  it('genera un PDF por lote con pagina de resumen del lote + 1 pagina individual por cada animal del lote', async () => {
    const { dataset, genealogy, media } = buildPdfFixture();
    const result = await ReportsPdfService.generateLotReportPdf(
      dataset,
      LOT_NORTE,
      INITIAL_REPORT_FILTERS,
      { genealogy, media, ranchName: 'Rancho El Encino' }
    );

    // 1 página de resumen del lote + 3 páginas individuales (ANIMAL_1, ANIMAL_2, ANIMAL_3) = 4 páginas
    expect(result.pageCount).toBe(4);
    expect(result.filename).toMatch(/^FarmBovi_Lote_Potrero_Norte_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(result.blob.size).toBeGreaterThan(3000);

    const rawPdf = result.doc.output();
    expect(rawPdf).toContain('Reporte de Lote: Potrero Norte');
    expect(rawPdf).toContain('Expediente Individual: FB-VACA-01');
    expect(rawPdf).toContain('Expediente Individual: FB-NOV-02');
    expect(rawPdf).toContain('Expediente Individual: FB-CRIA-03');
    expect(rawPdf).toContain('Pagina 1 de 4');
    expect(rawPdf).toContain('Pagina 4 de 4');
  });

  it('genera un PDF general multipagina con indicadores consolidados y anexo de dependencias Backend', async () => {
    const { dataset, genealogy, media } = buildPdfFixture();
    const result = await ReportsPdfService.generateGeneralReportPdf(
      dataset,
      INITIAL_REPORT_FILTERS,
      { genealogy, media, ranchName: 'Rancho El Encino' }
    );

    expect(result.pageCount).toBe(2);
    expect(result.filename).toMatch(/^FarmBovi_Reporte_General_\d{4}-\d{2}-\d{2}\.pdf$/);
    const rawPdf = result.doc.output();
    expect(rawPdf).toContain('Reporte General de Indicadores Ganaderos');
    expect(rawPdf).toContain('Tratamientos Pendientes y En Curso');
    expect(rawPdf).toContain('Transparencia de Contratos y Endpoints Pendientes');
  });

  it('normaliza fotografias JPEG con DHT antes de SOF0 (camaras MJPEG/AVI1) para incrustar dimensiones RGB reales en el PDF', async () => {
    // Estructura minima fiel a ImageCapture.takePhoto() V4L2/AVI1:
    // SOI -> APP0(AVI1) -> DHT(0xFFC4 con bytes 00 01 05 01 que confundian a jsPDF como 1281x1 Gray) -> SOF0(1280x720 RGB) -> SOS -> EOI
    const avi1JpegBytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x08, 0x41, 0x56, 0x49, 0x31, 0x00, 0x01, // APP0 AVI1
      0xff, 0xc4, 0x00, 0x0a, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, // DHT antes de SOF0
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0x01, 0x21, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0: 1280x720, 3 comp
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
      0xff, 0xd9 // EOI
    ]);

    const normalized = normalizeJpegForJsPdf(avi1JpegBytes);
    expect(normalized.width).toBe(1280);
    expect(normalized.height).toBe(720);

    const { dataset, genealogy } = buildPdfFixture();
    const avi1Media: LocalMedia[] = [
      {
        id: 'media-avi1-jpeg',
        cattleId: ANIMAL_1,
        entidadRelacionada: 'cattle',
        idEntidadRelacionada: ANIMAL_1,
        tipo: 'FotoPerfil',
        nombreArchivo: 'perfil_avi1_camara.jpg',
        mimeType: 'image/jpeg',
        tamanoBytes: avi1JpegBytes.byteLength,
        blobData: new Blob([avi1JpegBytes], { type: 'image/jpeg' }),
        estadoArchivo: 'subido',
        intentosSubida: 1,
        fechaCaptura: '2026-11-22T21:50:52Z',
        createdAt: '2026-11-22T21:50:52Z',
        updatedAt: '2026-11-22T21:50:52Z',
        syncStatus: 'synced',
        deletedAt: null
      }
    ];

    const result = await ReportsPdfService.generateIndividualAnimalPdf(
      dataset,
      ANIMAL_1,
      INITIAL_REPORT_FILTERS,
      { genealogy, media: avi1Media, ranchName: 'Rancho El Dorado' }
    );

    const rawPdf = result.doc.output();
    expect(rawPdf).toContain('/Subtype /Image');
    expect(rawPdf).toContain('/Width 1280');
    expect(rawPdf).toContain('/Height 720');
    expect(rawPdf).toContain('/ColorSpace /DeviceRGB');
    expect(rawPdf).not.toContain('/Height 1\n');
    expect(rawPdf).not.toContain('/ColorSpace /DeviceGray');
  });
});
