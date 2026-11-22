import { jsPDF } from 'jspdf';
import { resolveMediaUrl } from '../lib/api';
import { GenealogyRepository } from '../lib/database/repositories/genealogy.repository';
import { MediaRepository } from '../lib/database/repositories/media.repository';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import type { LocalGenealogy, LocalMedia } from '../lib/database/schema';
import type { Cattle } from '../types/cattle';
import type { Lot } from '../types/lot';
import {
  INITIAL_REPORT_FILTERS,
  REPORT_BACKEND_DEPENDENCIES,
  UNASSIGNED_LOT_FILTER_VALUE,
  type ComputedReports,
  type DistributionItem,
  type ReportDataset,
  type ReportFilters
} from '../types/reports';
import type { WeightEvolutionPoint } from '../types/weighing';
import { calculateAnimalAge } from './cattle.validation';
import { ReportsService } from './reports.service';

export type PdfReportType = 'individual' | 'lote' | 'general';

export interface PdfGenerationContext {
  genealogy?: LocalGenealogy[];
  media?: LocalMedia[];
  ranchName?: string;
}

export interface PdfGenerationResult {
  filename: string;
  pageCount: number;
  blob: Blob;
  doc: jsPDF;
}

interface ResolvedPhoto {
  dataUrl: string;
  format: 'JPEG' | 'PNG';
  width?: number;
  height?: number;
  tipo: LocalMedia['tipo'];
  fechaCaptura: string;
}

interface ResolvedPedigree {
  father: Cattle | null;
  mother: Cattle | null;
  paternalGrandfather: Cattle | null;
  paternalGrandmother: Cattle | null;
  maternalGrandfather: Cattle | null;
  maternalGrandmother: Cattle | null;
  descendants: Cattle[];
}

type Rgb = readonly [number, number, number];

const COLORS = {
  forest: [20, 61, 41] as Rgb,
  primary: [27, 94, 32] as Rgb,
  gold: [245, 158, 11] as Rgb,
  slate: [30, 41, 59] as Rgb,
  muted: [100, 116, 139] as Rgb,
  cardBg: [248, 250, 252] as Rgb,
  softGreen: [240, 253, 244] as Rgb,
  border: [226, 232, 240] as Rgb,
  white: [255, 255, 255] as Rgb,
  danger: [220, 38, 38] as Rgb,
  amber: [217, 119, 6] as Rgb,
  emerald: [5, 150, 105] as Rgb,
  pink: [219, 39, 119] as Rgb,
  sky: [2, 132, 199] as Rgb
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 182 mm

/**
 * Normaliza caracteres fuera de WinAnsi/Latin-1 (ej. flechas Unicode, guiones largos)
 * para garantizar tipografía impecable con la fuente Helvetica estándar de PDF.
 */
function pdfSafe(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[—–]/g, '-')
    .replace(/→/g, '->')
    .replace(/•|·/g, '|')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/Δ/g, 'Delta ')
    .replace(/…/g, '...')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function truncateText(value: string, maxChars: number): string {
  const clean = pdfSafe(value).trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 3))}...`;
}

function sanitizeFilenameSegment(raw: string): string {
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'Reporte'
  );
}

function formatDateShort(raw: string | null | undefined): string {
  if (!raw) return 'No registrada';
  const datePart = raw.slice(0, 10);
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return pdfSafe(raw).slice(0, 16);
  return `${d}/${m}/${y}`;
}

function setFill(doc: jsPDF, rgb: Rgb): void {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function setStroke(doc: jsPDF, rgb: Rgb): void {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function setText(doc: jsPDF, rgb: Rgb): void {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof FileReader !== 'undefined') {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(typeof reader.result === 'string' ? reader.result : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
        return;
      }
      resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readBlobAsBytes(blob: Blob): Promise<Uint8Array | null> {
  try {
    if (typeof blob.arrayBuffer === 'function') {
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    }
  } catch {
    // Continuar con fallback FileReader
  }

  return await new Promise((resolve) => {
    try {
      if (typeof FileReader === 'undefined') {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(blob);
    } catch {
      resolve(null);
    }
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isPngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isPngBytes(bytes)) return undefined;
  const width =
    ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
  const height =
    ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  if (width > 0 && height > 0) {
    return { width, height };
  }
  return undefined;
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7]);

/**
 * Normaliza el orden de segmentos de un JPEG para evitar el bug conocido de jsPDF
 * (`processJPEG` incluye `0xC4` / DHT en su lista de marcadores SOF): cuando una cámara
 * (p. ej. `ImageCapture.takePhoto()` MJPEG/AVI1) escribe DHT antes de SOF0, jsPDF lee
 * dimensiones falsas (1281x1 DeviceGray) y renderiza un cuadro negro/gris en el PDF.
 * Mover el segmento SOF antes de DHT es 100% lossless y conforme a ISO/IEC 10918-1.
 */
export function normalizeJpegForJsPdf(bytes: Uint8Array): {
  bytes: Uint8Array;
  width?: number;
  height?: number;
} {
  if (!isJpegBytes(bytes)) {
    return { bytes };
  }

  const segments: Array<{ marker: number; data: Uint8Array }> = [];
  let i = 2;
  let sosOffset = -1;
  let width: number | undefined;
  let height: number | undefined;

  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      return { bytes, width, height };
    }
    while (i + 1 < bytes.length && bytes[i + 1] === 0xff) {
      i += 1;
    }
    if (i + 1 >= bytes.length) {
      return { bytes, width, height };
    }

    const marker = bytes[i + 1];
    if (marker === 0xda) {
      sosOffset = i;
      break;
    }
    if (marker === 0xd9) {
      return { bytes, width, height };
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ marker, data: bytes.subarray(i, i + 2) });
      i += 2;
      continue;
    }
    if (i + 3 >= bytes.length) {
      return { bytes, width, height };
    }

    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    if (segLen < 2 || i + 2 + segLen > bytes.length) {
      return { bytes, width, height };
    }

    if (JPEG_SOF_MARKERS.has(marker) && segLen >= 7 && width === undefined) {
      const parsedHeight = (bytes[i + 5] << 8) | bytes[i + 6];
      const parsedWidth = (bytes[i + 7] << 8) | bytes[i + 8];
      if (parsedWidth > 0 && parsedHeight > 0) {
        width = parsedWidth;
        height = parsedHeight;
      }
    }

    segments.push({ marker, data: bytes.subarray(i, i + 2 + segLen) });
    i += 2 + segLen;
  }

  if (sosOffset < 0) {
    return { bytes, width, height };
  }

  const firstDht = segments.findIndex((s) => s.marker === 0xc4);
  const firstSof = segments.findIndex((s) => JPEG_SOF_MARKERS.has(s.marker));
  if (firstDht === -1 || firstSof === -1 || firstSof < firstDht) {
    return { bytes, width, height };
  }

  const sofSegments = segments.filter((s) => JPEG_SOF_MARKERS.has(s.marker));
  const otherSegments = segments.filter((s) => !JPEG_SOF_MARKERS.has(s.marker));
  const insertAt = otherSegments.findIndex((s) => s.marker === 0xc4);
  const reordered = [
    ...otherSegments.slice(0, insertAt),
    ...sofSegments,
    ...otherSegments.slice(insertAt)
  ];

  const out = new Uint8Array(bytes.length);
  out[0] = 0xff;
  out[1] = 0xd8;
  let offset = 2;
  for (const seg of reordered) {
    out.set(seg.data, offset);
    offset += seg.data.length;
  }
  out.set(bytes.subarray(sosOffset), offset);
  return { bytes: out, width, height };
}

async function decodeImageForCanvas(
  blob: Blob
): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
} | null> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        // Sin decodificación vía ImageBitmap; continuar con Image()
      }
    }
    if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
      const activeBitmap = bitmap;
      return {
        source: activeBitmap,
        width: activeBitmap.width,
        height: activeBitmap.height,
        cleanup: () => activeBitmap.close()
      };
    }
  }

  if (typeof Image === 'undefined') {
    return null;
  }

  const objectUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(blob)
      : null;
  const src = objectUrl ?? (await blobToDataUrl(blob));
  if (!src) {
    return null;
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: {
        source: CanvasImageSource;
        width: number;
        height: number;
        cleanup: () => void;
      } | null
    ) => {
      if (settled) return;
      settled = true;
      if (!result && objectUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(objectUrl);
      }
      resolve(result);
    };

    try {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w > 0 && h > 0) {
          finish({
            source: img,
            width: w,
            height: h,
            cleanup: () => {
              if (objectUrl && typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(objectUrl);
              }
            }
          });
        } else {
          finish(null);
        }
      };
      img.onerror = () => finish(null);
      img.src = src;
    } catch {
      finish(null);
    }
  });
}

/**
 * Re-codifica cualquier fotografía (MJPEG/AVI1, JPEG con orientación EXIF, PNG con transparencia
 * o WebP) a un JPEG JFIF estándar RGB con resolución óptima para impresión PDF y tamaño compacto.
 */
async function reencodePhotoViaCanvas(
  blob: Blob,
  maxSide = 960
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) {
    return null;
  }

  const decoded = await decodeImageForCanvas(blob);
  if (!decoded) {
    return null;
  }

  try {
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const outW = Math.max(1, Math.round(decoded.width * scale));
    const outH = Math.max(1, Math.round(decoded.height * scale));

    canvas.width = outW;
    canvas.height = outH;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, outW, outH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) {
      return null;
    }
    return { dataUrl, width: outW, height: outH };
  } catch {
    return null;
  } finally {
    decoded.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function resolveAnimalProfilePhoto(
  mediaList: LocalMedia[],
  animal: Cattle
): Promise<ResolvedPhoto | null> {
  const candidates = mediaList
    .filter(
      (m) =>
        !m.deletedAt &&
        Boolean(m.blobData || m.urlRemota) &&
        (m.cattleId === animal.id || m.cattleId === animal.idAnimal)
    )
    .sort((a, b) => {
      // Priorizar FotoPerfil sobre BoviScaleVision y más reciente primero
      const scoreA = a.tipo === 'FotoPerfil' ? 2 : a.tipo === 'BoviScaleVision' ? 1 : 0;
      const scoreB = b.tipo === 'FotoPerfil' ? 2 : b.tipo === 'BoviScaleVision' ? 1 : 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return b.fechaCaptura.localeCompare(a.fechaCaptura);
    });

  for (const candidate of candidates) {
    let photoBlob = candidate.blobData;
    if ((!photoBlob || photoBlob.size === 0) && candidate.urlRemota && typeof fetch === 'function') {
      const publicUrl = resolveMediaUrl(candidate.urlRemota);
      if (publicUrl) {
        try {
          const res = await fetch(publicUrl, { credentials: 'include' });
          if (res.ok) {
            photoBlob = await res.blob();
          }
        } catch {
          photoBlob = undefined;
        }
      }
    }
    if (!photoBlob || photoBlob.size === 0) continue;

    // 1. Ruta principal en navegador: re-codificar vía canvas a JPEG JFIF RGB limpio
    //    (corrige automáticamente orientación EXIF, MJPEG/AVI1, WebP y alfa de PNG).
    const canvasNormalized = await reencodePhotoViaCanvas(photoBlob);
    if (canvasNormalized) {
      return {
        dataUrl: canvasNormalized.dataUrl,
        format: 'JPEG',
        width: canvasNormalized.width,
        height: canvasNormalized.height,
        tipo: candidate.tipo,
        fechaCaptura: candidate.fechaCaptura
      };
    }

    // 2. Fallback binario directo (entornos sin canvas 2D, p. ej. pruebas headless/jsdom):
    //    normalizar orden SOF/DHT en JPEG para evitar el bug de 1281x1 DeviceGray en jsPDF.
    const rawBytes = await readBlobAsBytes(photoBlob);
    const mime = (candidate.mimeType || photoBlob.type || '').toLowerCase();

    if (rawBytes && (isJpegBytes(rawBytes) || mime.includes('jpeg') || mime.includes('jpg'))) {
      const normalized = normalizeJpegForJsPdf(rawBytes);
      return {
        dataUrl: `data:image/jpeg;base64,${bytesToBase64(normalized.bytes)}`,
        format: 'JPEG',
        width: normalized.width,
        height: normalized.height,
        tipo: candidate.tipo,
        fechaCaptura: candidate.fechaCaptura
      };
    }

    if (rawBytes && (isPngBytes(rawBytes) || mime.includes('png'))) {
      const dims = readPngDimensions(rawBytes);
      return {
        dataUrl: `data:image/png;base64,${bytesToBase64(rawBytes)}`,
        format: 'PNG',
        width: dims?.width,
        height: dims?.height,
        tipo: candidate.tipo,
        fechaCaptura: candidate.fechaCaptura
      };
    }

    const rawDataUrl = await blobToDataUrl(photoBlob);
    if (!rawDataUrl) continue;
    if (mime.includes('png')) {
      return {
        dataUrl: rawDataUrl,
        format: 'PNG',
        tipo: candidate.tipo,
        fechaCaptura: candidate.fechaCaptura
      };
    }
    if (mime.includes('jpeg') || mime.includes('jpg')) {
      return {
        dataUrl: rawDataUrl,
        format: 'JPEG',
        tipo: candidate.tipo,
        fechaCaptura: candidate.fechaCaptura
      };
    }
  }

  return null;
}

function buildPedigreeMap(
  cattle: Cattle[],
  genealogyRecords: LocalGenealogy[]
): {
  animalById: Map<string, Cattle>;
  genealogyByAnimalId: Map<string, LocalGenealogy>;
  resolveForAnimal: (animal: Cattle) => ResolvedPedigree;
} {
  const animalById = new Map<string, Cattle>();
  for (const a of cattle) {
    animalById.set(a.id, a);
    animalById.set(a.idAnimal, a);
  }

  const genealogyByAnimalId = new Map<string, LocalGenealogy>();
  for (const g of genealogyRecords) {
    if (!g.deletedAt && !genealogyByAnimalId.has(g.cattleId)) {
      genealogyByAnimalId.set(g.cattleId, g);
    }
  }

  const resolveForAnimal = (animal: Cattle): ResolvedPedigree => {
    const own =
      genealogyByAnimalId.get(animal.id) || genealogyByAnimalId.get(animal.idAnimal) || null;
    const father = own?.padreId ? animalById.get(own.padreId) || null : null;
    const mother = own?.madreId ? animalById.get(own.madreId) || null : null;

    const fatherGen = father
      ? genealogyByAnimalId.get(father.id) || genealogyByAnimalId.get(father.idAnimal) || null
      : null;
    const motherGen = mother
      ? genealogyByAnimalId.get(mother.id) || genealogyByAnimalId.get(mother.idAnimal) || null
      : null;

    const descendants: Cattle[] = [];
    const seen = new Set<string>();
    for (const g of genealogyRecords) {
      if (g.deletedAt) continue;
      if (
        g.padreId === animal.id ||
        g.padreId === animal.idAnimal ||
        g.madreId === animal.id ||
        g.madreId === animal.idAnimal
      ) {
        const child = animalById.get(g.cattleId);
        if (child && !seen.has(child.id)) {
          seen.add(child.id);
          descendants.push(child);
        }
      }
    }

    return {
      father,
      mother,
      paternalGrandfather: fatherGen?.padreId ? animalById.get(fatherGen.padreId) || null : null,
      paternalGrandmother: fatherGen?.madreId ? animalById.get(fatherGen.madreId) || null : null,
      maternalGrandfather: motherGen?.padreId ? animalById.get(motherGen.padreId) || null : null,
      maternalGrandmother: motherGen?.madreId ? animalById.get(motherGen.madreId) || null : null,
      descendants
    };
  };

  return { animalById, genealogyByAnimalId, resolveForAnimal };
}

function drawPageHeader(
  doc: jsPDF,
  opts: {
    title: string;
    subtitle: string;
    ranchName: string;
    rightBadge: string;
    dateLabel: string;
  }
): void {
  // Fondo principal
  setFill(doc, COLORS.forest);
  doc.rect(0, 0, PAGE_W, 24, 'F');
  // Franja dorada inferior
  setFill(doc, COLORS.gold);
  doc.rect(0, 24, PAGE_W, 1.4, 'F');

  // Marca FARMBOVI
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setText(doc, COLORS.gold);
  doc.text('FARMBOVI', MARGIN_X, 8.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setText(doc, [215, 232, 222]);
  doc.text(`|  ${truncateText(opts.ranchName, 44)}`, MARGIN_X + 23, 8.5);

  // Título principal
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setText(doc, COLORS.white);
  doc.text(truncateText(opts.title, 62), MARGIN_X, 15.8);

  // Subtítulo
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  setText(doc, [220, 235, 226]);
  doc.text(truncateText(opts.subtitle, 82), MARGIN_X, 21);

  // Bloque derecho (fecha + etiqueta)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setText(doc, COLORS.gold);
  doc.text(pdfSafe(opts.rightBadge), PAGE_W - MARGIN_X, 9, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setText(doc, [220, 235, 226]);
  doc.text(`Generado: ${pdfSafe(opts.dateLabel)}`, PAGE_W - MARGIN_X, 14.5, { align: 'right' });
}

function drawAllPageFooters(doc: jsPDF, ranchName: string, docTitle: string): void {
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    setStroke(doc, COLORS.border);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, PAGE_H - 11.5, PAGE_W - MARGIN_X, PAGE_H - 11.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setText(doc, COLORS.muted);
    doc.text(
      truncateText(`FarmBovi | ${ranchName} | ${docTitle} (Datos reales sin cifras ficticias)`, 92),
      MARGIN_X,
      PAGE_H - 7.2
    );
    doc.setFont('helvetica', 'bold');
    setText(doc, COLORS.forest);
    doc.text(`Pagina ${page} de ${totalPages}`, PAGE_W - MARGIN_X, PAGE_H - 7.2, {
      align: 'right'
    });
  }
}

function drawCardFrame(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  badge?: string,
  accent: Rgb = COLORS.primary
): number {
  setFill(doc, COLORS.white);
  setStroke(doc, COLORS.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');

  // Encabezado de tarjeta
  setFill(doc, COLORS.cardBg);
  doc.roundedRect(x + 0.2, y + 0.2, w - 0.4, 7.2, 1.8, 1.8, 'F');
  setStroke(doc, COLORS.border);
  doc.line(x, y + 7.4, x + w, y + 7.4);

  // Barra lateral de acento
  setFill(doc, accent);
  doc.rect(x + 2, y + 1.8, 1.3, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  setText(doc, COLORS.forest);
  doc.text(truncateText(title, 54), x + 5, y + 5.1);

  if (badge) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    setText(doc, accent);
    doc.text(truncateText(badge, 30), x + w - 2.5, y + 5.1, { align: 'right' });
  }

  return y + 9.5;
}

function drawKpiStrip(
  doc: jsPDF,
  x: number,
  y: number,
  totalW: number,
  items: Array<{ label: string; value: string; sub?: string; accent?: Rgb }>
): number {
  const gap = 3;
  const cardW = (totalW - gap * (items.length - 1)) / items.length;
  const cardH = 18;

  items.forEach((item, idx) => {
    const cx = x + idx * (cardW + gap);
    setFill(doc, COLORS.cardBg);
    setStroke(doc, COLORS.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW, cardH, 1.8, 1.8, 'FD');

    setFill(doc, item.accent || COLORS.primary);
    doc.rect(cx, y + 2, 1.2, cardH - 4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    setText(doc, COLORS.muted);
    doc.text(truncateText(item.label.toUpperCase(), 24), cx + 3.2, y + 4.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    setText(doc, item.accent || COLORS.forest);
    doc.text(truncateText(item.value, 18), cx + 3.2, y + 11.4);

    if (item.sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      setText(doc, COLORS.muted);
      doc.text(truncateText(item.sub, 28), cx + 3.2, y + 15.8);
    }
  });

  return y + cardH;
}

function drawVectorWeightLineChart(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  points: WeightEvolutionPoint[],
  opts: {
    title: string;
    gdpKgDay: number | null;
    totalWeighings: number;
  }
): void {
  const badge =
    opts.gdpKgDay !== null
      ? `${opts.totalWeighings} pesajes | GDP ${opts.gdpKgDay.toFixed(3)} kg/dia`
      : `${opts.totalWeighings} pesajes reales`;
  const innerTop = drawCardFrame(doc, x, y, w, h, opts.title, badge, COLORS.primary);

  if (points.length < 2) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.2);
    setText(doc, COLORS.muted);
    const msg =
      points.length === 1
        ? `Solo existe 1 pesaje real (${points[0].pesoKg.toFixed(1)} kg el ${formatDateShort(points[0].fecha)}). Se requieren al menos 2 fechas para trazar la curva de evolucion.`
        : 'No existen pesajes reales registrados dentro del filtro seleccionado.';
    const wrapped = doc.splitTextToSize(pdfSafe(msg), w - 16) as string[];
    doc.text(wrapped, x + w / 2, innerTop + (h - 14) / 2, { align: 'center' });
    return;
  }

  // Estadísticas rápidas arriba de la gráfica
  const first = points[0].pesoKg;
  const last = points[points.length - 1].pesoKg;
  const delta = Math.round((last - first) * 10) / 10;
  const statsY = innerTop + 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  setText(doc, COLORS.muted);
  doc.text(`Inicial: ${first.toFixed(1)} kg`, x + 4, statsY);
  doc.text(`Ultimo: ${last.toFixed(1)} kg`, x + 36, statsY);
  setText(doc, delta > 0 ? COLORS.emerald : delta < 0 ? COLORS.danger : COLORS.slate);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Variacion: ${delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)} kg`,
    x + 68,
    statsY
  );

  const plotX = x + 14;
  const plotY = statsY + 3.5;
  const plotW = w - 20;
  const plotH = y + h - plotY - 7.5;

  const weights = points.map((p) => p.pesoKg);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const spread = maxW - minW;
  const pad = spread > 0 ? Math.max(spread * 0.15, 4) : Math.max(maxW * 0.1, 10);
  const yMin = Math.max(0, Math.floor(minW - pad));
  const yMax = Math.ceil(maxW + pad);
  const yRange = Math.max(1, yMax - yMin);

  // Líneas guía horizontales + etiquetas Y
  const ticks = 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  for (let i = 0; i <= ticks; i += 1) {
    const ratio = i / ticks;
    const gy = plotY + plotH - ratio * plotH;
    const val = Math.round(yMin + ratio * yRange);
    setStroke(doc, [232, 238, 245]);
    doc.setLineWidth(0.2);
    doc.line(plotX, gy, plotX + plotW, gy);
    setText(doc, COLORS.muted);
    doc.text(`${val}`, plotX - 2, gy + 1.5, { align: 'right' });
  }

  // Coordenadas de los puntos
  const coords = points.map((pt, idx) => ({
    pt,
    px: plotX + (idx / (points.length - 1)) * plotW,
    py: plotY + plotH - ((pt.pesoKg - yMin) / yRange) * plotH
  }));

  // Línea de serie
  setStroke(doc, COLORS.primary);
  doc.setLineWidth(0.75);
  for (let i = 0; i < coords.length - 1; i += 1) {
    doc.line(coords[i].px, coords[i].py, coords[i + 1].px, coords[i + 1].py);
  }

  // Puntos y etiquetas X
  const maxLabels = 6;
  const step = Math.max(1, Math.ceil(coords.length / maxLabels));
  coords.forEach((c, idx) => {
    setFill(doc, COLORS.white);
    setStroke(doc, COLORS.forest);
    doc.setLineWidth(0.5);
    doc.circle(c.px, c.py, 1.15, 'FD');

    if (idx === 0 || idx === coords.length - 1 || idx % step === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.3);
      setText(doc, COLORS.muted);
      doc.text(truncateText(c.pt.label || formatDateShort(c.pt.fecha), 12), c.px, plotY + plotH + 4.3, {
        align: idx === 0 ? 'left' : idx === coords.length - 1 ? 'right' : 'center'
      });
    }
  });
}

function drawVectorHorizontalBarChart(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  items: DistributionItem[],
  opts: {
    title: string;
    badge?: string;
    barColor?: Rgb;
    emptyText: string;
    maxBars?: number;
    footerNote?: string;
  }
): void {
  const accent = opts.barColor || COLORS.primary;
  const innerTop = drawCardFrame(doc, x, y, w, h, opts.title, opts.badge, accent);

  if (items.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.8);
    setText(doc, COLORS.muted);
    const wrapped = doc.splitTextToSize(pdfSafe(opts.emptyText), w - 10) as string[];
    doc.text(wrapped, x + w / 2, innerTop + (h - 14) / 2, { align: 'center' });
    return;
  }

  const maxBars = opts.maxBars ?? 5;
  const visible = items.slice(0, maxBars);
  const maxCount = Math.max(...visible.map((i) => i.count), 1);
  const availH = y + h - innerTop - (opts.footerNote ? 7 : 3);
  const rowH = Math.min(8.2, availH / Math.max(visible.length, 1));
  const barWMax = w - 8;

  visible.forEach((item, idx) => {
    const ry = innerTop + idx * rowH;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    setText(doc, COLORS.slate);
    doc.text(truncateText(item.label, Math.floor(w * 0.42)), x + 4, ry + 2.4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setText(doc, COLORS.muted);
    const valStr = `${item.count} (${item.percentage.toFixed(0)}%)`;
    doc.text(valStr, x + w - 4, ry + 2.4, { align: 'right' });

    // Fondo barra
    setFill(doc, [237, 242, 247]);
    doc.roundedRect(x + 4, ry + 3.4, barWMax, 2.3, 0.8, 0.8, 'F');

    // Relleno proporcional
    const fillW = Math.max(2.5, (item.count / maxCount) * barWMax);
    setFill(doc, accent);
    doc.roundedRect(x + 4, ry + 3.4, fillW, 2.3, 0.8, 0.8, 'F');
  });

  if (opts.footerNote) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    setText(doc, COLORS.muted);
    doc.text(truncateText(opts.footerNote, Math.floor(w * 0.95)), x + 4, y + h - 2.3);
  }
}

function drawVectorGenealogyBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  animal: Cattle,
  categoryLabel: string,
  pedigree: ResolvedPedigree
): void {
  const innerTop = drawCardFrame(
    doc,
    x,
    y,
    w,
    h,
    'Genetica Base y Arbol Genealogico Documentado',
    `Raza: ${animal.raza}`,
    COLORS.forest
  );

  // Sub-barra genética
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  setText(doc, COLORS.slate);
  doc.text(
    truncateText(
      `Raza: ${animal.raza} | Procedencia: ${animal.procedencia || 'No registrada'} | Descendencia documentada: ${pedigree.descendants.length}`,
      105
    ),
    x + 4,
    innerTop + 1.5
  );

  const treeTop = innerTop + 3.8;
  const colGap = 7;
  const colW = (w - 8 - colGap * 2) / 3;
  const col1X = x + 4;
  const col2X = col1X + colW + colGap;
  const col3X = col2X + colW + colGap;

  const drawNode = (
    nx: number,
    ny: number,
    nw: number,
    nh: number,
    roleLabel: string,
    nodeAnimal: Cattle | null,
    opts: { highlight?: boolean; compact?: boolean } = {}
  ) => {
    const highlight = Boolean(opts.highlight);
    const compact = Boolean(opts.compact);

    setFill(doc, highlight ? COLORS.softGreen : COLORS.cardBg);
    setStroke(doc, highlight ? COLORS.primary : COLORS.border);
    doc.setLineWidth(highlight ? 0.5 : 0.3);
    doc.roundedRect(nx, ny, nw, nh, 1.4, 1.4, 'FD');

    const labelFontSize = compact ? 5.6 : highlight ? 6.3 : 6.1;
    const valueFontSize = compact ? 6.7 : highlight ? 7.6 : 7.2;
    const labelY = compact ? ny + 2.7 : highlight ? ny + 4.4 : ny + 3.6;
    const valueY = compact ? ny + nh - 1.4 : highlight ? ny + nh - 2.8 : ny + nh - 2.1;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(labelFontSize);
    setText(doc, highlight ? COLORS.primary : COLORS.muted);
    doc.text(pdfSafe(roleLabel.toUpperCase()), nx + 2, labelY);

    doc.setFont('helvetica', highlight ? 'bold' : 'normal');
    doc.setFontSize(valueFontSize);
    setText(doc, nodeAnimal ? COLORS.slate : COLORS.muted);
    const line = nodeAnimal
      ? `${nodeAnimal.arete} (${nodeAnimal.raza})`
      : 'No documentado';
    doc.text(truncateText(line, compact ? 30 : 28), nx + 2, valueY);
  };

  // Columna 1: Abuelos (4 nodos de 7.4 mm con separación holgada para evitar solapamiento)
  const gpH = 7.4;
  const gpGap = 1.1;
  const gpY = [
    treeTop,
    treeTop + gpH + gpGap,
    treeTop + (gpH + gpGap) * 2,
    treeTop + (gpH + gpGap) * 3
  ];
  drawNode(col1X, gpY[0], colW, gpH, 'Abuelo Paterno', pedigree.paternalGrandfather, {
    compact: true
  });
  drawNode(col1X, gpY[1], colW, gpH, 'Abuela Paterna', pedigree.paternalGrandmother, {
    compact: true
  });
  drawNode(col1X, gpY[2], colW, gpH, 'Abuelo Materno', pedigree.maternalGrandfather, {
    compact: true
  });
  drawNode(col1X, gpY[3], colW, gpH, 'Abuela Materna', pedigree.maternalGrandmother, {
    compact: true
  });

  // Columna 2: Padre y Madre (centrados respecto a sus abuelos)
  const pH = 10.5;
  const paternalMidY = (gpY[0] + gpH / 2 + gpY[1] + gpH / 2) / 2;
  const maternalMidY = (gpY[2] + gpH / 2 + gpY[3] + gpH / 2) / 2;
  const fatherY = paternalMidY - pH / 2;
  const motherY = maternalMidY - pH / 2;
  drawNode(col2X, fatherY, colW, pH, 'Padre', pedigree.father);
  drawNode(col2X, motherY, colW, pH, 'Madre', pedigree.mother);

  // Columna 3: Bovino actual (centrado respecto a Padre y Madre)
  const selfH = 13.5;
  const selfY = (paternalMidY + maternalMidY) / 2 - selfH / 2;
  drawNode(col3X, selfY, colW, selfH, `Bovino | ${categoryLabel}`, animal, { highlight: true });

  // Líneas conectoras vectoriales
  setStroke(doc, [180, 195, 208]);
  doc.setLineWidth(0.3);
  const mid12 = col1X + colW + colGap / 2;
  const mid23 = col2X + colW + colGap / 2;

  // Abuelos paternos -> Padre
  doc.line(col1X + colW, gpY[0] + gpH / 2, mid12, gpY[0] + gpH / 2);
  doc.line(col1X + colW, gpY[1] + gpH / 2, mid12, gpY[1] + gpH / 2);
  doc.line(mid12, gpY[0] + gpH / 2, mid12, gpY[1] + gpH / 2);
  doc.line(mid12, fatherY + pH / 2, col2X, fatherY + pH / 2);

  // Abuelos maternos -> Madre
  doc.line(col1X + colW, gpY[2] + gpH / 2, mid12, gpY[2] + gpH / 2);
  doc.line(col1X + colW, gpY[3] + gpH / 2, mid12, gpY[3] + gpH / 2);
  doc.line(mid12, gpY[2] + gpH / 2, mid12, gpY[3] + gpH / 2);
  doc.line(mid12, motherY + pH / 2, col2X, motherY + pH / 2);

  // Padre + Madre -> Bovino
  doc.line(col2X + colW, fatherY + pH / 2, mid23, fatherY + pH / 2);
  doc.line(col2X + colW, motherY + pH / 2, mid23, motherY + pH / 2);
  doc.line(mid23, fatherY + pH / 2, mid23, motherY + pH / 2);
  doc.line(mid23, selfY + selfH / 2, col3X, selfY + selfH / 2);

  // Línea inferior: descendencia o nota documental
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  setText(doc, COLORS.muted);
  const descText =
    pedigree.descendants.length > 0
      ? `Crias registradas (${pedigree.descendants.length}): ${pedigree.descendants
          .slice(0, 6)
          .map((d) => `${d.arete} (${d.sexo})`)
          .join(', ')}${pedigree.descendants.length > 6 ? '...' : ''}`
      : 'Sin descendencia documentada en IndexedDB. Nota: genealogia documental (no sustituye prueba genetica de laboratorio).';
  doc.text(truncateText(descText, 128), x + 4, y + h - 2.1);
}

/**
 * Renderiza la página completa de Expediente Individual para un bovino.
 * Se reutiliza tanto en el Reporte Individual como en cada página de animal del Reporte por Lote.
 */
async function renderIndividualAnimalPage(
  doc: jsPDF,
  params: {
    animal: Cattle;
    dataset: ReportDataset;
    filters: ReportFilters;
    mediaList: LocalMedia[];
    pedigree: ResolvedPedigree;
    ranchName: string;
    dateLabel: string;
    headerBadge: string;
  }
): Promise<void> {
  const { animal, dataset, filters, mediaList, pedigree, ranchName, dateLabel, headerBadge } = params;

  const animalReports = ReportsService.computeReports(dataset, {
    ...filters,
    animalId: animal.id,
    categoria: '',
    potreroId: ''
  });

  const category = animalReports.animalCategoryById[animal.id] || 'Sin clasificar';
  const lotLabel = animal.idLote
    ? animalReports.lotNameById[animal.idLote] || `Potrero (${animal.idLote.slice(0, 8)})`
    : 'Sin potrero asignado';
  const ageText = animal.fechaNacimiento ? calculateAnimalAge(animal.fechaNacimiento) : 'No registrada';

  drawPageHeader(doc, {
    title: `Expediente Individual: ${animal.arete}`,
    subtitle: `${animal.raza} | ${animal.sexo} | ${category} | Potrero: ${lotLabel}`,
    ranchName,
    rightBadge: headerBadge,
    dateLabel
  });

  // ── FILA 1: FOTO DE PERFIL + DATOS BASE (y: 28 -> 74 mm) ──
  const row1Y = 28;
  const row1H = 46;
  const photoW = 44;
  const infoX = MARGIN_X + photoW + 4;
  const infoW = CONTENT_W - photoW - 4;

  // Contenedor de Foto de Perfil
  setFill(doc, COLORS.cardBg);
  setStroke(doc, COLORS.border);
  doc.setLineWidth(0.35);
  doc.roundedRect(MARGIN_X, row1Y, photoW, row1H, 2, 2, 'FD');

  const resolvedPhoto = await resolveAnimalProfilePhoto(mediaList, animal);
  if (resolvedPhoto) {
    const frameX = MARGIN_X + 1.5;
    const frameY = row1Y + 1.5;
    const frameW = photoW - 3;
    const frameH = row1H - 8.5;

    // Fondo neutro del marco para preservar la proporción original sin recortar ni deformar
    setFill(doc, [244, 247, 244]);
    setStroke(doc, [226, 234, 228]);
    doc.setLineWidth(0.2);
    doc.roundedRect(frameX, frameY, frameW, frameH, 1.2, 1.2, 'FD');

    let drawW = frameW;
    let drawH = frameH;
    if (
      resolvedPhoto.width &&
      resolvedPhoto.height &&
      resolvedPhoto.width > 0 &&
      resolvedPhoto.height > 0
    ) {
      const imgAspect = resolvedPhoto.width / resolvedPhoto.height;
      const boxAspect = frameW / frameH;
      if (imgAspect > boxAspect) {
        drawW = frameW;
        drawH = frameW / imgAspect;
      } else {
        drawH = frameH;
        drawW = frameH * imgAspect;
      }
    }
    const drawX = frameX + (frameW - drawW) / 2;
    const drawY = frameY + (frameH - drawH) / 2;

    try {
      doc.addImage(resolvedPhoto.dataUrl, resolvedPhoto.format, drawX, drawY, drawW, drawH);
    } catch {
      // Fallback si el motor no logra decodificar bytes en un entorno headless
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      setText(doc, COLORS.muted);
      doc.text('Foto guardada en dispositivo', MARGIN_X + photoW / 2, row1Y + 20, {
        align: 'center'
      });
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    setText(doc, COLORS.forest);
    const caption =
      resolvedPhoto.tipo === 'FotoPerfil'
        ? `Foto de Perfil | ${formatDateShort(resolvedPhoto.fechaCaptura)}`
        : `BoviScale | ${formatDateShort(resolvedPhoto.fechaCaptura)}`;
    doc.text(truncateText(caption, 32), MARGIN_X + photoW / 2, row1Y + row1H - 2.3, {
      align: 'center'
    });
  } else {
    setFill(doc, [236, 243, 238]);
    doc.circle(MARGIN_X + photoW / 2, row1Y + 18, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setText(doc, COLORS.primary);
    doc.text(truncateText(animal.arete.slice(0, 6), 6), MARGIN_X + photoW / 2, row1Y + 19.3, {
      align: 'center'
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setText(doc, COLORS.muted);
    doc.text('Sin foto de perfil', MARGIN_X + photoW / 2, row1Y + 34, { align: 'center' });
    doc.text('registrada', MARGIN_X + photoW / 2, row1Y + 38, { align: 'center' });
  }

  // Tarjeta de Datos Base del Bovino
  const baseTop = drawCardFrame(
    doc,
    infoX,
    row1Y,
    infoW,
    row1H,
    'Datos Base e Identificacion del Bovino',
    `Estado: ${animal.estado}`,
    animal.estado === 'Activo' ? COLORS.emerald : COLORS.amber
  );

  const fields: Array<[string, string]> = [
    ['Arete / ID', animal.arete],
    ['Categoria', category],
    ['Raza / Genetica', animal.raza],
    ['Sexo', animal.sexo],
    ['Edad estimada', ageText],
    ['Nacimiento', formatDateShort(animal.fechaNacimiento)],
    ['Fecha de ingreso', formatDateShort(animal.fechaIngreso)],
    ['Procedencia', animal.procedencia || 'No registrada'],
    ['Potrero / Lote', lotLabel],
    [
      'Ultimo peso real',
      animalReports.kpis.pesoPromedioKg !== null
        ? `${animalReports.kpis.pesoPromedioKg.toFixed(1)} kg`
        : 'Sin pesajes'
    ]
  ];

  const colA = infoX + 4;
  const colB = infoX + infoW / 2 + 2;
  fields.forEach(([label, value], idx) => {
    const isRight = idx % 2 === 1;
    const row = Math.floor(idx / 2);
    const fx = isRight ? colB : colA;
    const fy = baseTop + 1.2 + row * 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    setText(doc, COLORS.muted);
    doc.text(`${pdfSafe(label)}:`, fx, fy);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    setText(doc, COLORS.slate);
    doc.text(truncateText(value, 27), fx + 24, fy);
  });

  if (animal.observaciones) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.7);
    setText(doc, COLORS.muted);
    doc.text(
      truncateText(`Obs.: ${animal.observaciones}`, 92),
      colA,
      row1Y + row1H - 2.2
    );
  }

  // ── FILA 2: GENÉTICA Y GENEALOGÍA DOCUMENTADA (y: 78 -> 128 mm) ──
  drawVectorGenealogyBox(doc, MARGIN_X, 78, CONTENT_W, 50, animal, category, pedigree);

  // ── FILA 3: EVOLUCIÓN DE PESO REAL (y: 132 -> 177 mm) ──
  drawVectorWeightLineChart(
    doc,
    MARGIN_X,
    132,
    CONTENT_W,
    45,
    animalReports.evolucionPeso.evolutionPoints,
    {
      title: 'Evolucion Real de Peso (Bascula)',
      gdpKgDay: animalReports.evolucionPeso.averageGdpKgDay,
      totalWeighings: animalReports.kpis.totalPesajes
    }
  );

  // ── FILA 4: ALIMENTACIÓN + SANIDAD (y: 180 -> 227 mm) ──
  const halfGap = 4;
  const halfW = (CONTENT_W - halfGap) / 2;
  const pendingCount = animalReports.kpis.tratamientosPendientes;
  const latestPending = animalReports.tratamientosPendientesLista[0];

  drawVectorHorizontalBarChart(
    doc,
    MARGIN_X,
    180,
    halfW,
    47,
    animalReports.alimentacion.porAlimento,
    {
      title: 'Alimentacion y Raciones',
      badge: `${animalReports.alimentacion.totalActividades} reg. | ${animalReports.alimentacion.totalCantidadKg.toFixed(1)} kg`,
      barColor: COLORS.emerald,
      emptyText: 'Sin actividades de alimentacion registradas para este bovino o su potrero.',
      maxBars: 4,
      footerNote:
        animalReports.alimentacion.totalActividades > 0
          ? `Por potrero: ${animalReports.alimentacion.porLote} | Individuales: ${animalReports.alimentacion.porAnimal}`
          : undefined
    }
  );

  drawVectorHorizontalBarChart(
    doc,
    MARGIN_X + halfW + halfGap,
    180,
    halfW,
    47,
    animalReports.sanidadPorTipo,
    {
      title: 'Sanidad y Tratamientos',
      badge: `${animalReports.kpis.eventosSanitarios} ev. | ${pendingCount} trat. pend.`,
      barColor: pendingCount > 0 ? COLORS.danger : COLORS.amber,
      emptyText: 'Sin eventos sanitarios registrados en el periodo.',
      maxBars: 4,
      footerNote: latestPending
        ? `Pendiente: ${latestPending.producto} (${latestPending.dosis} ${latestPending.unidadDosis}) - ${latestPending.estado}`
        : `Tratamientos pendientes/en curso: ${pendingCount}`
    }
  );

  // ── FILA 5: REPRODUCCIÓN + MOVIMIENTOS (y: 231 -> 277 mm) ──
  const latestRepro = animalReports.filteredReproduction[0];
  const latestMov = animalReports.filteredMovements[0];

  drawVectorHorizontalBarChart(
    doc,
    MARGIN_X,
    231,
    halfW,
    46,
    animalReports.reproduccionPorTipo,
    {
      title: 'Eventos Reproductivos',
      badge: `${animalReports.kpis.eventosReproductivos} eventos`,
      barColor: COLORS.pink,
      emptyText: 'Sin eventos reproductivos registrados para este bovino.',
      maxBars: 4,
      footerNote: latestRepro
        ? `Ultimo: ${latestRepro.tipo} (${formatDateShort(latestRepro.fecha)})${latestRepro.resultado ? ` - ${latestRepro.resultado}` : ''}`
        : undefined
    }
  );

  drawVectorHorizontalBarChart(
    doc,
    MARGIN_X + halfW + halfGap,
    231,
    halfW,
    46,
    animalReports.movimientosPorTipo,
    {
      title: 'Movimientos y Trazabilidad',
      badge: `${animalReports.kpis.movimientosRegistrados} mov.`,
      barColor: COLORS.sky,
      emptyText: 'Sin movimientos de trazabilidad registrados en el rango.',
      maxBars: 4,
      footerNote: latestMov
        ? `Ultimo: ${latestMov.tipo} (${formatDateShort(latestMov.fecha)}) - ${latestMov.motivo || 'Sin motivo'}`
        : undefined
    }
  );
}

/**
 * Construye distribución por raza de un subconjunto de animales.
 */
function buildBreedDistribution(animals: Cattle[]): DistributionItem[] {
  const map = new Map<string, number>();
  for (const a of animals) {
    const key = a.raza.trim() || 'Sin raza';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const total = animals.length;
  return Array.from(map.entries())
    .map(([label, count]) => ({
      key: label,
      label,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
}

async function resolveDefaultContext(
  dataset: ReportDataset,
  context?: PdfGenerationContext
): Promise<{
  genealogy: LocalGenealogy[];
  media: LocalMedia[];
  ranchName: string;
}> {
  const [genealogy, media, ranches] = await Promise.all([
    context?.genealogy
      ? Promise.resolve(context.genealogy)
      : GenealogyRepository.getAllWithOptions({ includeDeleted: false }).catch(() => []),
    context?.media
      ? Promise.resolve(context.media)
      : MediaRepository.getAllActive().catch(() => []),
    context?.ranchName
      ? Promise.resolve([])
      : RanchRepository.getActive().catch(() => [])
  ]);

  const ranchName =
    context?.ranchName ||
    ranches[0]?.nombre ||
    (dataset.cattle[0]?.idRancho ? `Rancho ${dataset.cattle[0].idRancho.slice(0, 8)}` : 'FarmBovi');

  return { genealogy, media, ranchName };
}

function buildFilterLabel(filters: ReportFilters): string {
  const parts: string[] = [];
  if (filters.fechaDesde || filters.fechaHasta) {
    parts.push(`Periodo: ${filters.fechaDesde || '...'} a ${filters.fechaHasta || '...'}`);
  }
  if (filters.categoria) parts.push(`Categoria: ${filters.categoria}`);
  return parts.length > 0 ? parts.join(' | ') : 'Todos los registros disponibles';
}

function drawLotAnimalsSummaryTable(
  doc: jsPDF,
  x: number,
  startY: number,
  w: number,
  lotReports: ComputedReports,
  opts: {
    lotName: string;
    ranchName: string;
    dateLabel: string;
  }
): void {
  const animals = lotReports.filteredAnimals;
  const latestWeightByAnimal = new Map(
    lotReports.evolucionPeso.latestByAnimal.map((item) => [item.idAnimal, item.latestWeightKg])
  );
  const healthCountByAnimal = new Map<string, number>();
  for (const h of lotReports.filteredHealthEvents) {
    healthCountByAnimal.set(h.idAnimal, (healthCountByAnimal.get(h.idAnimal) ?? 0) + 1);
  }
  const pendingTreatByAnimal = new Map<string, number>();
  for (const t of lotReports.tratamientosPendientesLista) {
    pendingTreatByAnimal.set(t.idAnimal, (pendingTreatByAnimal.get(t.idAnimal) ?? 0) + 1);
  }

  const cols = [
    { label: 'Arete', x: x + 3, w: 30 },
    { label: 'Raza', x: x + 34, w: 28 },
    { label: 'Categoria', x: x + 63, w: 32 },
    { label: 'Sexo', x: x + 96, w: 18 },
    { label: 'Ult. Peso', x: x + 115, w: 22 },
    { label: 'Sanidad', x: x + 138, w: 15 },
    { label: 'Trat. P.', x: x + 154, w: 13 },
    { label: 'Estado', x: x + 168, w: 14 }
  ];

  const drawTableHeader = (ty: number) => {
    setFill(doc, COLORS.forest);
    doc.rect(x, ty, w, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.1);
    setText(doc, COLORS.white);
    for (const c of cols) {
      doc.text(c.label, c.x, ty + 4.4);
    }
    return ty + 6.5;
  };

  // Título de tabla
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setText(doc, COLORS.forest);
  doc.text(`Padron del Lote (${animals.length} animales - ficha individual en paginas siguientes)`, x, startY);

  if (animals.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    setText(doc, COLORS.muted);
    doc.text('No hay animales asignados a este lote con los filtros actuales.', x, startY + 6);
    return;
  }

  let cursorY = drawTableHeader(startY + 2.5);
  const rowH = 5.8;

  animals.forEach((animal, idx) => {
    if (cursorY + rowH > PAGE_H - 16) {
      doc.addPage();
      drawPageHeader(doc, {
        title: `Lote / Potrero: ${opts.lotName} (Continuacion)`,
        subtitle: `Listado completo de animales del lote (${animals.length} cabezas)`,
        ranchName: opts.ranchName,
        rightBadge: 'RESUMEN DE LOTE',
        dateLabel: opts.dateLabel
      });
      cursorY = drawTableHeader(30);
    }

    if (idx % 2 === 1) {
      setFill(doc, COLORS.cardBg);
      doc.rect(x, cursorY, w, rowH, 'F');
    }
    setStroke(doc, COLORS.border);
    doc.setLineWidth(0.2);
    doc.line(x, cursorY + rowH, x + w, cursorY + rowH);

    const lastW = latestWeightByAnimal.get(animal.id) ?? latestWeightByAnimal.get(animal.idAnimal);
    const hCount = healthCountByAnimal.get(animal.id) ?? healthCountByAnimal.get(animal.idAnimal) ?? 0;
    const tCount = pendingTreatByAnimal.get(animal.id) ?? pendingTreatByAnimal.get(animal.idAnimal) ?? 0;
    const category = lotReports.animalCategoryById[animal.id] || 'Sin clasificar';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    setText(doc, COLORS.forest);
    doc.text(truncateText(animal.arete, 16), cols[0].x, cursorY + 4);

    doc.setFont('helvetica', 'normal');
    setText(doc, COLORS.slate);
    doc.text(truncateText(animal.raza, 15), cols[1].x, cursorY + 4);
    doc.text(truncateText(category, 18), cols[2].x, cursorY + 4);
    doc.text(truncateText(animal.sexo, 10), cols[3].x, cursorY + 4);
    doc.text(lastW !== undefined ? `${lastW.toFixed(1)} kg` : '-', cols[4].x, cursorY + 4);
    doc.text(String(hCount), cols[5].x + 3, cursorY + 4);
    setText(doc, tCount > 0 ? COLORS.danger : COLORS.slate);
    doc.text(String(tCount), cols[6].x + 3, cursorY + 4);
    setText(doc, COLORS.slate);
    doc.text(truncateText(animal.estado, 9), cols[7].x, cursorY + 4);

    cursorY += rowH;
  });
}

export const ReportsPdfService = {
  /**
   * 1. REPORTE INDIVIDUAL DE BOVINO (PDF):
   * Foto de perfil, datos base, genética/genealogía visual, evolución de peso,
   * alimentación, sanidad/tratamientos, reproducción y movimientos.
   */
  async generateIndividualAnimalPdf(
    dataset: ReportDataset,
    animalId: string,
    filters: ReportFilters = INITIAL_REPORT_FILTERS,
    context?: PdfGenerationContext
  ): Promise<PdfGenerationResult> {
    const animal = dataset.cattle.find((c) => c.id === animalId || c.idAnimal === animalId);
    if (!animal) {
      throw new Error('El animal seleccionado no existe en el conjunto de datos actual.');
    }

    const { genealogy, media, ranchName } = await resolveDefaultContext(dataset, context);
    const pedigreeHelper = buildPedigreeMap(dataset.cattle, genealogy);
    const dateLabel = new Date().toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await renderIndividualAnimalPage(doc, {
      animal,
      dataset,
      filters,
      mediaList: media,
      pedigree: pedigreeHelper.resolveForAnimal(animal),
      ranchName,
      dateLabel,
      headerBadge: 'REPORTE INDIVIDUAL'
    });

    drawAllPageFooters(doc, ranchName, `Expediente ${animal.arete}`);
    const dateStamp = new Date().toISOString().split('T')[0];
    const filename = `FarmBovi_Bovino_${sanitizeFilenameSegment(animal.arete)}_${dateStamp}.pdf`;

    return {
      filename,
      pageCount: doc.getNumberOfPages(),
      blob: doc.output('blob'),
      doc
    };
  },

  /**
   * 2. REPORTE COMPLETO POR LOTE / POTRERO (PDF):
   * - Página(s) de Resumen del Lote con KPIs, gráficas consolidadas (categorías, razas,
   *   evolución de peso, alimentación, sanidad, reproducción/movimientos) y tabla de animales.
   * - Una página individual completa por CADA animal del lote (con foto, datos base,
   *   genética, genealogía y gráficas individuales).
   */
  async generateLotReportPdf(
    dataset: ReportDataset,
    potreroId: string,
    filters: ReportFilters = INITIAL_REPORT_FILTERS,
    context?: PdfGenerationContext
  ): Promise<PdfGenerationResult> {
    const isUnassigned = potreroId === UNASSIGNED_LOT_FILTER_VALUE;
    const lot: Lot | undefined = isUnassigned
      ? undefined
      : dataset.lots.find((l) => l.id === potreroId || l.idLote === potreroId);

    if (!isUnassigned && !lot) {
      throw new Error('El potrero o lote seleccionado no existe en el conjunto de datos actual.');
    }

    const lotName = isUnassigned ? 'Sin potrero asignado' : lot!.nombre;
    const lotSubtitle = isUnassigned
      ? `Animales sin asignacion de potrero | ${buildFilterLabel(filters)}`
      : `${lot!.ubicacion ? `Ubicacion: ${lot!.ubicacion} | ` : ''}Estado: ${lot!.estado} | ${buildFilterLabel(filters)}`;

    const lotFilters: ReportFilters = {
      ...filters,
      animalId: '',
      potreroId
    };
    const lotReports = ReportsService.computeReports(dataset, lotFilters);
    const { genealogy, media, ranchName } = await resolveDefaultContext(dataset, context);
    const pedigreeHelper = buildPedigreeMap(dataset.cattle, genealogy);
    const dateLabel = new Date().toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // ── PÁGINA 1: RESUMEN EJECUTIVO DEL LOTE ──
    drawPageHeader(doc, {
      title: `Reporte de Lote: ${lotName}`,
      subtitle: lotSubtitle,
      ranchName,
      rightBadge: 'RESUMEN DE LOTE',
      dateLabel
    });

    drawKpiStrip(doc, MARGIN_X, 28, CONTENT_W, [
      {
        label: 'Animales en Lote',
        value: String(lotReports.kpis.totalAnimales),
        sub: `Act: ${lotReports.kpis.animalesActivos} | Ven: ${lotReports.kpis.animalesVendidos}`,
        accent: COLORS.primary
      },
      {
        label: 'Peso Promedio',
        value:
          lotReports.kpis.pesoPromedioKg !== null
            ? `${lotReports.kpis.pesoPromedioKg.toFixed(1)} kg`
            : 'Sin datos',
        sub: `${lotReports.kpis.totalPesajes} pesajes reales`,
        accent: COLORS.forest
      },
      {
        label: 'Sanidad / Trat. P.',
        value: `${lotReports.kpis.eventosSanitarios} / ${lotReports.kpis.tratamientosPendientes}`,
        sub: 'Eventos / Pendientes',
        accent: lotReports.kpis.tratamientosPendientes > 0 ? COLORS.danger : COLORS.amber
      },
      {
        label: 'Alimentacion',
        value: String(lotReports.kpis.actividadesAlimentacion),
        sub: `${lotReports.alimentacion.totalCantidadKg.toFixed(1)} kg acum.`,
        accent: COLORS.emerald
      },
      {
        label: 'Reprod. / Mov.',
        value: `${lotReports.kpis.eventosReproductivos} / ${lotReports.kpis.movimientosRegistrados}`,
        sub: 'Eventos / Traslados',
        accent: COLORS.sky
      }
    ]);

    const halfGap = 4;
    const halfW = (CONTENT_W - halfGap) / 2;

    // Fila 1 de gráficas: Categorías + Razas del lote (y: 50 -> 96 mm)
    drawVectorHorizontalBarChart(doc, MARGIN_X, 50, halfW, 46, lotReports.porCategoria, {
      title: 'Animales del Lote por Categoria',
      badge: `${lotReports.kpis.totalAnimales} total`,
      barColor: COLORS.primary,
      emptyText: 'No hay animales en este lote.',
      maxBars: 5
    });

    drawVectorHorizontalBarChart(
      doc,
      MARGIN_X + halfW + halfGap,
      50,
      halfW,
      46,
      buildBreedDistribution(lotReports.filteredAnimals),
      {
        title: 'Composicion Genetica (Razas del Lote)',
        badge: lotReports.porSexo.map((s) => `${s.label[0]}:${s.count}`).join(' '),
        barColor: COLORS.forest,
        emptyText: 'Sin datos de razas en este lote.',
        maxBars: 5
      }
    );

    // Fila 2: Evolución de peso promedio del lote (y: 100 -> 150 mm)
    drawVectorWeightLineChart(
      doc,
      MARGIN_X,
      100,
      CONTENT_W,
      50,
      lotReports.evolucionPeso.evolutionPoints,
      {
        title: 'Evolucion de Peso Promedio del Lote (Bascula)',
        gdpKgDay: lotReports.evolucionPeso.averageGdpKgDay,
        totalWeighings: lotReports.kpis.totalPesajes
      }
    );

    // Fila 3: Alimentación del lote + Sanidad del lote (y: 154 -> 198 mm)
    drawVectorHorizontalBarChart(
      doc,
      MARGIN_X,
      154,
      halfW,
      44,
      lotReports.alimentacion.porAlimento,
      {
        title: 'Alimentacion del Lote',
        badge: `${lotReports.alimentacion.totalActividades} reg.`,
        barColor: COLORS.emerald,
        emptyText: 'Sin actividades de alimentacion en este lote.',
        maxBars: 4,
        footerNote: `Directo al lote: ${lotReports.alimentacion.porLote} | Individual: ${lotReports.alimentacion.porAnimal}`
      }
    );

    drawVectorHorizontalBarChart(
      doc,
      MARGIN_X + halfW + halfGap,
      154,
      halfW,
      44,
      lotReports.sanidadPorTipo,
      {
        title: 'Sanidad y Tratamientos del Lote',
        badge: `${lotReports.kpis.tratamientosPendientes} trat. pend.`,
        barColor: COLORS.amber,
        emptyText: 'Sin eventos sanitarios registrados en este lote.',
        maxBars: 4,
        footerNote: `Reproduccion: ${lotReports.kpis.eventosReproductivos} | Movimientos: ${lotReports.kpis.movimientosRegistrados}`
      }
    );

    // Fila 4: Tabla consolidada de animales del lote (desde y: 204 mm, pagina si hay muchos)
    drawLotAnimalsSummaryTable(doc, MARGIN_X, 204, CONTENT_W, lotReports, {
      lotName,
      ranchName,
      dateLabel
    });

    // ── UNA PÁGINA INDIVIDUAL COMPLETA POR CADA ANIMAL DEL LOTE ──
    const lotAnimals = lotReports.filteredAnimals;
    for (let i = 0; i < lotAnimals.length; i += 1) {
      const animal = lotAnimals[i];
      doc.addPage();
      await renderIndividualAnimalPage(doc, {
        animal,
        dataset,
        filters,
        mediaList: media,
        pedigree: pedigreeHelper.resolveForAnimal(animal),
        ranchName,
        dateLabel,
        headerBadge: `LOTE ${truncateText(lotName, 16)} (${i + 1}/${lotAnimals.length})`
      });
    }

    drawAllPageFooters(doc, ranchName, `Reporte Lote ${lotName}`);
    const dateStamp = new Date().toISOString().split('T')[0];
    const filename = `FarmBovi_Lote_${sanitizeFilenameSegment(lotName)}_${dateStamp}.pdf`;

    return {
      filename,
      pageCount: doc.getNumberOfPages(),
      blob: doc.output('blob'),
      doc
    };
  },

  /**
   * 3. REPORTE GENERAL DEL HATO (PDF):
   * Consolidado ejecutivo de todos los indicadores y gráficas reales según filtros activos.
   */
  async generateGeneralReportPdf(
    dataset: ReportDataset,
    filters: ReportFilters = INITIAL_REPORT_FILTERS,
    context?: PdfGenerationContext
  ): Promise<PdfGenerationResult> {
    const reports = ReportsService.computeReports(dataset, filters);
    const { ranchName } = await resolveDefaultContext(dataset, context);
    const dateLabel = new Date().toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const halfGap = 4;
    const halfW = (CONTENT_W - halfGap) / 2;

    // ── PÁGINA 1: RESUMEN GENERAL + DISTRIBUCIONES + PESO ──
    drawPageHeader(doc, {
      title: 'Reporte General de Indicadores Ganaderos',
      subtitle: buildFilterLabel(filters),
      ranchName,
      rightBadge: dataset.isOffline ? 'MODO OFFLINE' : 'REPORTE GENERAL',
      dateLabel
    });

    drawKpiStrip(doc, MARGIN_X, 28, CONTENT_W, [
      {
        label: 'Total Animales',
        value: String(reports.kpis.totalAnimales),
        sub: `Act: ${reports.kpis.animalesActivos} | Ven: ${reports.kpis.animalesVendidos} | Baj: ${reports.kpis.animalesBaja}`,
        accent: COLORS.primary
      },
      {
        label: 'Pesajes Reales',
        value: String(reports.kpis.totalPesajes),
        sub:
          reports.kpis.pesoPromedioKg !== null
            ? `Prom: ${reports.kpis.pesoPromedioKg.toFixed(1)} kg`
            : 'Sin pesajes',
        accent: COLORS.forest
      },
      {
        label: 'Sanidad / Trat. P.',
        value: `${reports.kpis.eventosSanitarios} / ${reports.kpis.tratamientosPendientes}`,
        sub: 'Eventos / Pendientes',
        accent: reports.kpis.tratamientosPendientes > 0 ? COLORS.danger : COLORS.amber
      },
      {
        label: 'Alimentacion',
        value: String(reports.kpis.actividadesAlimentacion),
        sub: `${reports.alimentacion.totalCantidadKg.toFixed(1)} kg`,
        accent: COLORS.emerald
      },
      {
        label: 'Reprod. / Mov.',
        value: `${reports.kpis.eventosReproductivos} / ${reports.kpis.movimientosRegistrados}`,
        sub: 'Reprod. / Trazab.',
        accent: COLORS.sky
      }
    ]);

    drawVectorHorizontalBarChart(doc, MARGIN_X, 51, halfW, 60, reports.porCategoria, {
      title: 'Animales por Categoria',
      badge: `${reports.kpis.totalAnimales} animales`,
      barColor: COLORS.primary,
      emptyText: 'Sin animales en los filtros seleccionados.',
      maxBars: 6
    });

    drawVectorHorizontalBarChart(
      doc,
      MARGIN_X + halfW + halfGap,
      51,
      halfW,
      60,
      reports.porPotrero,
      {
        title: 'Animales por Potrero',
        badge: `${reports.porPotrero.length} grupos`,
        barColor: COLORS.forest,
        emptyText: 'Sin distribucion por potrero.',
        maxBars: 6
      }
    );

    drawVectorWeightLineChart(
      doc,
      MARGIN_X,
      116,
      CONTENT_W,
      64,
      reports.evolucionPeso.evolutionPoints,
      {
        title: 'Evolucion Real de Peso del Hato (Bascula)',
        gdpKgDay: reports.evolucionPeso.averageGdpKgDay,
        totalWeighings: reports.kpis.totalPesajes
      }
    );

    drawVectorHorizontalBarChart(doc, MARGIN_X, 185, halfW, 45, reports.alimentacion.porAlimento, {
      title: 'Actividades de Alimentacion',
      badge: `${reports.alimentacion.totalActividades} reg.`,
      barColor: COLORS.emerald,
      emptyText: 'Sin actividades de alimentacion en el filtro.',
      maxBars: 4,
      footerNote: `Lotes: ${reports.alimentacion.porLote} | Animales: ${reports.alimentacion.porAnimal} | Total: ${reports.alimentacion.totalCantidadKg.toFixed(1)} kg`
    });

    drawVectorHorizontalBarChart(
      doc,
      MARGIN_X + halfW + halfGap,
      185,
      halfW,
      45,
      reports.sanidadPorTipo,
      {
        title: 'Eventos Sanitarios por Tipo',
        badge: `${reports.kpis.eventosSanitarios} eventos`,
        barColor: COLORS.amber,
        emptyText: 'Sin eventos sanitarios en el filtro.',
        maxBars: 4
      }
    );

    drawVectorHorizontalBarChart(doc, MARGIN_X, 234, halfW, 44, reports.reproduccionPorTipo, {
      title: 'Eventos Reproductivos',
      badge: `${reports.kpis.eventosReproductivos} eventos`,
      barColor: COLORS.pink,
      emptyText: 'Sin eventos reproductivos en el filtro.',
      maxBars: 4
    });

    drawVectorHorizontalBarChart(
      doc,
      MARGIN_X + halfW + halfGap,
      234,
      halfW,
      44,
      reports.movimientosPorTipo,
      {
        title: 'Movimientos Registrados',
        badge: `${reports.kpis.movimientosRegistrados} mov.`,
        barColor: COLORS.sky,
        emptyText: 'Sin movimientos registrados en el filtro.',
        maxBars: 4
      }
    );

    // ── PÁGINA 2: TRATAMIENTOS PENDIENTES + TRANSPARENCIA DE CONTRATOS ──
    doc.addPage();
    drawPageHeader(doc, {
      title: 'Tratamientos Pendientes y Fuentes de Datos',
      subtitle: 'Seguimiento clinico activo y estado de contratos Backend / Offline',
      ranchName,
      rightBadge: 'ANEXO TECNICO',
      dateLabel
    });

    const tTop = drawCardFrame(
      doc,
      MARGIN_X,
      29,
      CONTENT_W,
      128,
      'Tratamientos Pendientes y En Curso',
      `${reports.tratamientosPendientesLista.length} activos`,
      reports.tratamientosPendientesLista.length > 0 ? COLORS.danger : COLORS.emerald
    );

    if (reports.tratamientosPendientesLista.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      setText(doc, COLORS.muted);
      doc.text(
        'No existen tratamientos en estado Pendiente o En curso dentro de los filtros seleccionados.',
        MARGIN_X + CONTENT_W / 2,
        tTop + 50,
        { align: 'center' }
      );
    } else {
      let ty = tTop + 2;
      setFill(doc, COLORS.forest);
      doc.rect(MARGIN_X + 3, ty, CONTENT_W - 6, 6.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      setText(doc, COLORS.white);
      doc.text('Arete', MARGIN_X + 5, ty + 4.2);
      doc.text('Producto / Dosis', MARGIN_X + 34, ty + 4.2);
      doc.text('Inicio', MARGIN_X + 104, ty + 4.2);
      doc.text('Estado', MARGIN_X + 128, ty + 4.2);
      doc.text('Responsable', MARGIN_X + 152, ty + 4.2);
      ty += 6.2;

      reports.tratamientosPendientesLista.slice(0, 16).forEach((t, idx) => {
        if (idx % 2 === 1) {
          setFill(doc, COLORS.cardBg);
          doc.rect(MARGIN_X + 3, ty, CONTENT_W - 6, 6.4, 'F');
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        setText(doc, COLORS.forest);
        doc.text(
          truncateText(reports.animalAreteById[t.idAnimal] || t.idAnimal.slice(0, 8), 16),
          MARGIN_X + 5,
          ty + 4.3
        );
        doc.setFont('helvetica', 'normal');
        setText(doc, COLORS.slate);
        doc.text(
          truncateText(`${t.producto} (${t.dosis} ${t.unidadDosis})`, 36),
          MARGIN_X + 34,
          ty + 4.3
        );
        doc.text(formatDateShort(t.fechaInicio), MARGIN_X + 104, ty + 4.3);
        setText(doc, COLORS.amber);
        doc.text(truncateText(t.estado, 12), MARGIN_X + 128, ty + 4.3);
        setText(doc, COLORS.slate);
        doc.text(truncateText(t.responsable, 16), MARGIN_X + 152, ty + 4.3);
        ty += 6.4;
      });
    }

    const depTop = drawCardFrame(
      doc,
      MARGIN_X,
      163,
      CONTENT_W,
      112,
      'Transparencia de Contratos y Endpoints Pendientes en Backend',
      `Fuente: ${dataset.dataSource.toUpperCase()}`,
      COLORS.forest
    );

    let dy = depTop + 2;
    for (const dep of REPORT_BACKEND_DEPENDENCIES) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      setText(doc, COLORS.forest);
      doc.text(truncateText(`- ${dep.indicador}`, 85), MARGIN_X + 4, dy);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      setText(doc, COLORS.amber);
      doc.text(truncateText(`Pendiente: ${dep.endpointFaltante}`, 96), MARGIN_X + 6, dy + 4.2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.1);
      setText(doc, COLORS.muted);
      const lines = doc.splitTextToSize(pdfSafe(dep.detalle), CONTENT_W - 12) as string[];
      doc.text(lines.slice(0, 2), MARGIN_X + 6, dy + 8.4);
      dy += 23;
    }

    drawAllPageFooters(doc, ranchName, 'Reporte General de Indicadores');
    const dateStamp = new Date().toISOString().split('T')[0];
    const filename = `FarmBovi_Reporte_General_${dateStamp}.pdf`;

    return {
      filename,
      pageCount: doc.getNumberOfPages(),
      blob: doc.output('blob'),
      doc
    };
  },

  downloadPdfResult(result: PdfGenerationResult): void {
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', result.filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};
