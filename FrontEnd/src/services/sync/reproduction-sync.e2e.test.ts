import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { db } from '../../lib/database/db';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import {
  ReproductionService,
  ReproductionValidationError
} from '../reproduction.service';
import { ConflictResolver } from './conflict-resolver';
import { PushSyncEngine } from './push-sync.engine';
import { SyncPullEngine } from './sync-pull.engine';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const COW_A1 = '33333333-3333-4333-8333-333333333331';
const COW_A2 = '33333333-3333-4333-8333-333333333332';
const BULL_A1 = '33333333-3333-4333-8333-333333333333';
const COW_B1 = '44444444-4444-4444-8444-444444444441';
const BULL_B1 = '44444444-4444-4444-8444-444444444442';

interface ServerReproductionRecord {
  idEventoReproductivo: string;
  idRancho: string;
  idAnimal: string;
  idSemental: string | null;
  tipo: string;
  fecha: string;
  resultado: string | null;
  observaciones: string | null;
  idAutor: string;
  creadoEn: string;
  versionRegistro: number;
  eliminadoEn: string | null;
}

interface ServerChangeEntry {
  seq: number;
  idCambio: string;
  idRancho: string;
  idRegistro: string;
  operacion: 'Crear' | 'Actualizar' | 'Eliminar';
  version: number;
  datos: Record<string, unknown> | null;
  ocurrioEn: string;
}

class ReproductionSyncServerSimulator {
  readonly recordsById = new Map<string, ServerReproductionRecord>();
  readonly authorizedRanches = new Set<string>([RANCH_A]);
  readonly animalRanchById = new Map<string, string>([
    [COW_A1, RANCH_A],
    [COW_A2, RANCH_A],
    [BULL_A1, RANCH_A],
    [COW_B1, RANCH_B],
    [BULL_B1, RANCH_B]
  ]);
  readonly processedOps = new Map<string, Record<string, unknown>>();
  readonly changeLog: ServerChangeEntry[] = [];
  readonly pushRequests: Array<Record<string, unknown>> = [];

  private seq = 0;
  failNextPushCount = 0;
  rejectWithValidationOnTipo: string | null = null;
  injectInvalidPullSnapshotNext = false;

  private encodeCursor(seq: number): string {
    return btoa(`2026-11-23T18:00:00.000Z|${seq}`)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private decodeCursor(cursor: string): number {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    const decoded = atob(`${padded}${'='.repeat(padLength)}`);
    const [, seqStr] = decoded.split('|');
    return Number(seqStr || '0');
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private toPullPayload(rec: ServerReproductionRecord): Record<string, unknown> {
    return {
      ranchId: rec.idRancho,
      idAnimal: rec.idAnimal,
      cattleId: rec.idAnimal,
      idSemental: rec.idSemental,
      tipo: rec.tipo,
      evento: rec.tipo,
      fecha: rec.fecha,
      resultado: rec.resultado,
      observaciones: rec.observaciones,
      createdAt: rec.creadoEn
    };
  }

  applyDirectRemoteMutationOnDeviceB(params: {
    idEventoReproductivo: string;
    idAnimal: string;
    idSemental: string | null;
    tipo: string;
    fecha: string;
    resultado: string | null;
    observaciones: string | null;
    delete?: boolean;
  }): ServerReproductionRecord {
    const now = new Date().toISOString();
    const idRancho = this.animalRanchById.get(params.idAnimal) ?? RANCH_A;
    const existing = this.recordsById.get(params.idEventoReproductivo);

    if (params.delete && existing) {
      existing.versionRegistro += 1;
      existing.eliminadoEn = now;
      this.seq += 1;
      this.changeLog.push({
        seq: this.seq,
        idCambio: crypto.randomUUID(),
        idRancho,
        idRegistro: existing.idEventoReproductivo,
        operacion: 'Eliminar',
        version: existing.versionRegistro,
        datos: null,
        ocurrioEn: now
      });
      return existing;
    }

    if (existing) {
      existing.idSemental = params.idSemental;
      existing.tipo = params.tipo;
      existing.fecha = params.fecha;
      existing.resultado = params.resultado;
      existing.observaciones = params.observaciones;
      existing.versionRegistro += 1;
      this.seq += 1;
      this.changeLog.push({
        seq: this.seq,
        idCambio: crypto.randomUUID(),
        idRancho,
        idRegistro: existing.idEventoReproductivo,
        operacion: 'Actualizar',
        version: existing.versionRegistro,
        datos: this.toPullPayload(existing),
        ocurrioEn: now
      });
      return existing;
    }

    const created: ServerReproductionRecord = {
      idEventoReproductivo: params.idEventoReproductivo,
      idRancho,
      idAnimal: params.idAnimal,
      idSemental: params.idSemental,
      tipo: params.tipo,
      fecha: params.fecha,
      resultado: params.resultado,
      observaciones: params.observaciones,
      idAutor: '99999999-9999-4999-8999-999999999999',
      creadoEn: now,
      versionRegistro: 1,
      eliminadoEn: null
    };
    this.recordsById.set(created.idEventoReproductivo, created);
    this.seq += 1;
    this.changeLog.push({
      seq: this.seq,
      idCambio: crypto.randomUUID(),
      idRancho,
      idRegistro: created.idEventoReproductivo,
      operacion: 'Crear',
      version: 1,
      datos: this.toPullPayload(created),
      ocurrioEn: now
    });
    return created;
  }

  handleFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:5173');
    const method = (init?.method || 'GET').toUpperCase();

    if (url.pathname.endsWith('/animales') && method === 'GET') {
      return this.json(200, [
        {
          idAnimal: COW_A1,
          idRancho: RANCH_A,
          idLote: null,
          arete: 'VA-101',
          raza: 'Holstein',
          sexo: 'Hembra',
          fechaNacimiento: '2022-01-10',
          fechaIngreso: '2022-02-01',
          procedencia: 'Propio',
          estado: 'Activo',
          fechaSalida: null,
          observaciones: null,
          versionRegistro: 1,
          eliminadoEn: null
        },
        {
          idAnimal: COW_A2,
          idRancho: RANCH_A,
          idLote: null,
          arete: 'VA-102',
          raza: 'Holstein',
          sexo: 'Hembra',
          fechaNacimiento: '2022-03-15',
          fechaIngreso: '2022-04-01',
          procedencia: 'Propio',
          estado: 'Activo',
          fechaSalida: null,
          observaciones: null,
          versionRegistro: 1,
          eliminadoEn: null
        },
        {
          idAnimal: BULL_A1,
          idRancho: RANCH_A,
          idLote: null,
          arete: 'TA-201',
          raza: 'Brahman',
          sexo: 'Macho',
          fechaNacimiento: '2021-01-10',
          fechaIngreso: '2021-02-01',
          procedencia: 'Compra',
          estado: 'Activo',
          fechaSalida: null,
          observaciones: null,
          versionRegistro: 1,
          eliminadoEn: null
        }
      ]);
    }

    if (url.pathname.endsWith('/eventos-reproductivos') && method === 'GET') {
      const idRancho = url.searchParams.get('idRancho');
      if (idRancho && !this.authorizedRanches.has(idRancho)) {
        return this.json(403, {
          status: 403,
          title: 'Acceso denegado.',
          detail: 'No tienes permisos sobre el rancho solicitado.'
        });
      }
      const incluirEliminados = url.searchParams.get('incluirEliminados') === 'true';
      const idAnimal = url.searchParams.get('idAnimal');
      const items = Array.from(this.recordsById.values()).filter((r) => {
        if (!this.authorizedRanches.has(r.idRancho)) return false;
        if (idRancho && r.idRancho !== idRancho) return false;
        if (idAnimal && r.idAnimal !== idAnimal) return false;
        if (!incluirEliminados && r.eliminadoEn) return false;
        return true;
      });
      return this.json(200, items);
    }

    if (url.pathname.endsWith('/sync/operaciones') && method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return this.handlePush(body);
    }

    if (url.pathname.endsWith('/sync/cambios') && method === 'GET') {
      return this.handlePull(url.searchParams);
    }

    return this.json(404, { mensaje: `Ruta no simulada: ${method} ${url.pathname}` });
  };

  private handlePush(body: Record<string, unknown>): Response {
    this.pushRequests.push(body);

    if (this.failNextPushCount > 0) {
      this.failNextPushCount -= 1;
      return this.json(503, { mensaje: 'Fallo temporal de red en servidor' });
    }

    const idOperacion = String(body.idOperacion || '');
    const idRancho = String(body.idRancho || '');
    const idRegistro = String(body.idRegistro || '');
    const operacion = String(body.operacion || '') as 'Crear' | 'Actualizar' | 'Eliminar';
    const versionBase =
      body.versionBase !== null && body.versionBase !== undefined ? Number(body.versionBase) : null;
    const payload = (body.payload && typeof body.payload === 'object'
      ? body.payload
      : {}) as Record<string, unknown>;

    if (!this.authorizedRanches.has(idRancho)) {
      return this.json(403, { mensaje: 'No tienes permisos sobre el rancho solicitado.' });
    }

    // Idempotencia por idOperacion
    const previous = this.processedOps.get(idOperacion);
    if (previous) {
      return this.json(200, {
        ...previous,
        duplicadoIgnorado: true
      });
    }

    const tipoPayload = typeof payload.tipo === 'string' ? payload.tipo.trim() : '';
    if (this.rejectWithValidationOnTipo && tipoPayload === this.rejectWithValidationOnTipo) {
      return this.json(400, {
        status: 400,
        title: 'Error de validación.',
        detail: `Tipo rechazado por regla de negocio en servidor: ${tipoPayload}`,
        errors: {
          tipo: [`El tipo '${tipoPayload}' requiere corrección.`]
        }
      });
    }

    const now = new Date().toISOString();
    const existing = this.recordsById.get(idRegistro);

    if (operacion === 'Crear') {
      const idAnimal = String(payload.idAnimal || '');
      if (this.animalRanchById.get(idAnimal) !== idRancho) {
        return this.json(403, { mensaje: 'El animal pertenece a otro rancho.' });
      }
      const idSemental =
        typeof payload.idSemental === 'string' && payload.idSemental ? payload.idSemental : null;
      if (idSemental && this.animalRanchById.get(idSemental) !== idRancho) {
        return this.json(403, { mensaje: 'El semental pertenece a otro rancho.' });
      }

      const created: ServerReproductionRecord = {
        idEventoReproductivo: idRegistro,
        idRancho,
        idAnimal,
        idSemental,
        tipo: tipoPayload,
        fecha: String(payload.fecha || now),
        resultado: typeof payload.resultado === 'string' ? payload.resultado : null,
        observaciones: typeof payload.observaciones === 'string' ? payload.observaciones : null,
        idAutor: '99999999-9999-4999-8999-999999999999',
        creadoEn: now,
        versionRegistro: 1,
        eliminadoEn: null
      };
      this.recordsById.set(idRegistro, created);
      this.seq += 1;
      const idCambio = crypto.randomUUID();
      this.changeLog.push({
        seq: this.seq,
        idCambio,
        idRancho,
        idRegistro,
        operacion: 'Crear',
        version: 1,
        datos: this.toPullPayload(created),
        ocurrioEn: now
      });

      const receipt = {
        idOperacion,
        entidad: 'EventoReproductivo',
        idRegistro,
        operacion: 'Crear',
        version: 1,
        versionResultante: 1,
        idCambio,
        aplicadoEn: now,
        duplicadoIgnorado: false,
        datos: created
      };
      this.processedOps.set(idOperacion, receipt);
      return this.json(201, receipt);
    }

    if (!existing) {
      return this.json(404, { mensaje: 'Registro no encontrado.' });
    }

    if (existing.eliminadoEn) {
      return this.json(409, {
        tipoConflicto: 'DELETED_ON_SERVER',
        mensaje: 'El evento reproductivo fue eliminado en el servidor.',
        idOperacion,
        entidad: 'EventoReproductivo',
        idRegistro,
        versionServidor: existing.versionRegistro,
        estadoServidor: { ...existing, eliminado: true }
      });
    }

    if (versionBase !== existing.versionRegistro) {
      return this.json(409, {
        tipoConflicto: 'VERSION_MISMATCH',
        mensaje: `Conflicto de concurrencia: versión base ${String(versionBase)} frente a servidor ${existing.versionRegistro}.`,
        idOperacion,
        entidad: 'EventoReproductivo',
        idRegistro,
        versionEnviada: versionBase,
        versionServidor: existing.versionRegistro,
        estadoServidor: { ...existing }
      });
    }

    existing.versionRegistro += 1;
    if (operacion === 'Actualizar') {
      if (payload.idSemental !== undefined) {
        existing.idSemental =
          typeof payload.idSemental === 'string' && payload.idSemental ? payload.idSemental : null;
      }
      if (typeof payload.tipo === 'string') existing.tipo = payload.tipo;
      if (typeof payload.fecha === 'string') existing.fecha = payload.fecha;
      if (payload.resultado !== undefined) {
        existing.resultado = typeof payload.resultado === 'string' ? payload.resultado : null;
      }
      if (payload.observaciones !== undefined) {
        existing.observaciones =
          typeof payload.observaciones === 'string' ? payload.observaciones : null;
      }
    } else {
      existing.eliminadoEn = now;
    }

    this.seq += 1;
    const idCambio = crypto.randomUUID();
    this.changeLog.push({
      seq: this.seq,
      idCambio,
      idRancho,
      idRegistro,
      operacion,
      version: existing.versionRegistro,
      datos: operacion === 'Eliminar' ? null : this.toPullPayload(existing),
      ocurrioEn: now
    });

    const receipt = {
      idOperacion,
      entidad: 'EventoReproductivo',
      idRegistro,
      operacion,
      version: existing.versionRegistro,
      versionResultante: existing.versionRegistro,
      idCambio,
      aplicadoEn: now,
      duplicadoIgnorado: false,
      datos: operacion === 'Eliminar' ? null : { ...existing }
    };
    this.processedOps.set(idOperacion, receipt);
    return this.json(200, receipt);
  }

  private handlePull(params: URLSearchParams): Response {
    const entidad = params.get('entidad') || '';
    const ranchId = params.get('ranchId') || params.get('idRancho') || '';
    const cursor = params.get('cursorOpaco') || params.get('cursor') || '';
    const limite = Math.min(500, Math.max(1, Number(params.get('limite') || '100')));

    if (!this.authorizedRanches.has(ranchId)) {
      return this.json(403, { mensaje: 'No tienes permisos sobre el rancho solicitado.' });
    }

    if (entidad !== 'reproductionRecords') {
      return this.json(200, {
        entidad,
        cambios: [],
        siguienteCursorOpaco: cursor || null,
        hayMasPaginas: false,
        fechaServidor: new Date().toISOString()
      });
    }

    const afterSeq = cursor ? this.decodeCursor(cursor) : 0;
    const matching = this.changeLog.filter((c) => c.idRancho === ranchId && c.seq > afterSeq);
    const hasMore = matching.length > limite;
    const page = matching.slice(0, limite);
    const last = page[page.length - 1] ?? null;

    if (this.injectInvalidPullSnapshotNext && page.length > 0) {
      this.injectInvalidPullSnapshotNext = false;
      return this.json(200, {
        entidad: 'reproductionRecords',
        cambios: [
          {
            remoteId: page[0].idRegistro,
            clientUuid: null,
            operacion: 'UPSERT',
            versionServidor: page[0].version,
            datos: { ranchId, idAnimal: '', tipo: '' },
            eliminado: false,
            actualizadoEnServidor: page[0].ocurrioEn
          }
        ],
        siguienteCursorOpaco: this.encodeCursor(page[0].seq),
        hayMasPaginas: false,
        fechaServidor: new Date().toISOString()
      });
    }

    return this.json(200, {
      entidad: 'reproductionRecords',
      cambios: page.map((c) => ({
        remoteId: c.idRegistro,
        clientUuid: null,
        operacion: c.operacion === 'Eliminar' ? 'DELETE' : 'UPSERT',
        versionServidor: c.version,
        datos: c.datos,
        eliminado: c.operacion === 'Eliminar',
        actualizadoEnServidor: c.ocurrioEn
      })),
      siguienteCursorOpaco: last ? this.encodeCursor(last.seq) : cursor || null,
      hayMasPaginas: hasMore,
      fechaServidor: new Date().toISOString()
    });
  }
}

async function seedDeviceIndexedDb(ranchId: string = RANCH_A) {
  const now = '2026-11-01T00:00:00.000Z';
  await db.ranches.put({
    id: ranchId,
    remoteId: ranchId,
    ranchId,
    nombre: ranchId === RANCH_A ? 'Rancho A' : 'Rancho B',
    ubicacionGeneral: 'Norte',
    estado: 'Activo',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    deletedAt: null
  });

  if (ranchId === RANCH_A) {
    await db.cattle.bulkPut([
      {
        id: COW_A1,
        remoteId: COW_A1,
        ranchId: RANCH_A,
        arete: 'VA-101',
        areteSiniiga: 'VA-101',
        raza: 'Holstein',
        sexo: 'Hembra',
        gender: 'Hembra',
        fechaNacimiento: '2022-01-10',
        fechaIngreso: '2022-02-01',
        procedencia: 'Propio',
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
        id: COW_A2,
        remoteId: COW_A2,
        ranchId: RANCH_A,
        arete: 'VA-102',
        areteSiniiga: 'VA-102',
        raza: 'Holstein',
        sexo: 'Hembra',
        gender: 'Hembra',
        fechaNacimiento: '2022-03-15',
        fechaIngreso: '2022-04-01',
        procedencia: 'Propio',
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
        id: BULL_A1,
        remoteId: BULL_A1,
        ranchId: RANCH_A,
        arete: 'TA-201',
        areteSiniiga: 'TA-201',
        raza: 'Brahman',
        sexo: 'Macho',
        gender: 'Macho',
        fechaNacimiento: '2021-01-10',
        fechaIngreso: '2021-02-01',
        procedencia: 'Compra',
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
}

function setActiveSession(ranchIds: string[] = [RANCH_A]) {
  window.sessionStorage.setItem('farmbovi_access_token', 'jwt-repro-e2e');
  window.sessionStorage.setItem(
    'farmbovi_session_user',
    JSON.stringify({
      idUsuario: '99999999-9999-4999-8999-999999999999',
      ranchos: ranchIds.map((idRancho) => ({ idRancho, nombre: 'Rancho', rol: 'Administrador' })),
      configuracion: { ranchoPredeterminadoId: ranchIds[0] ?? null }
    })
  );
}

describe('Reproducción E2E — Captura offline -> Push -> Pull en Dispositivo B -> Conflictos -> Recuperación de errores -> Aislamiento por rancho', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    await Promise.all([
      db.ranches.clear(),
      db.cattle.clear(),
      db.reproductionRecords.clear(),
      db.outbox.clear(),
      db.syncCheckpoints.clear(),
      db.syncConflicts.clear()
    ]);
  });

  it('cubre flujo completo: captura offline ordenada, fallo 503 + reintento idempotente, Pull paginado en Dispositivo B, conflicto simultáneo + fusión y baja lógica', async () => {
    const server = new ReproductionSyncServerSimulator();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handleFetch);
    setActiveSession([RANCH_A]);
    await seedDeviceIndexedDb(RANCH_A);

    // 1. Dispositivo A sin conexión: registra 2 eventos reproductivos fuera de orden de captura y valida orden cronológico + intervalo entre partos
    const onlineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    const evLater = await ReproductionService.create({
      idAnimal: COW_A1,
      idSemental: BULL_A1,
      tipo: 'Confirmación de gestación',
      fecha: '2026-06-15T10:00',
      resultado: 'Positivo / Gestante',
      observaciones: 'Palpación 60 días'
    });
    const evEarlier = await ReproductionService.create({
      idAnimal: COW_A1,
      idSemental: BULL_A1,
      tipo: 'Servicio o monta',
      fecha: '2026-04-10T08:00',
      resultado: 'Exitoso',
      observaciones: 'Monta natural dirigida'
    });

    expect(evLater.synced).toBe(false);
    expect(evEarlier.synced).toBe(false);
    expect(evLater.event.syncStatus).toBe('pending');

    // Orden cronológico determinista descendente y ascendente
    const descList = await ReproductionService.getAll({ order: 'desc' });
    expect(descList.data.map((e) => e.id)).toEqual([evLater.event.id, evEarlier.event.id]);
    const ascList = await ReproductionService.getAll({ order: 'asc' });
    expect(ascList.data.map((e) => e.id)).toEqual([evEarlier.event.id, evLater.event.id]);

    // Validación de intervalo fisiológico mínimo entre partos (< 240 días)
    await ReproductionService.create({
      idAnimal: COW_A2,
      idSemental: BULL_A1,
      tipo: 'Parto',
      fecha: '2026-05-01T07:00',
      resultado: 'Cría Viva',
      observaciones: null
    });
    await expect(
      ReproductionService.create({
        idAnimal: COW_A2,
        idSemental: BULL_A1,
        tipo: 'Parto',
        fecha: '2026-09-01T07:00', // < 240 días después
        resultado: 'Cría Viva',
        observaciones: null
      })
    ).rejects.toBeInstanceOf(ReproductionValidationError);

    // 2. Reconexión con fallo transitorio 503 -> conserva operaciones con el mismo idOperacion hasta recibir confirmación
    onlineSpy.mockReturnValue(true);
    const pendingBeforePush = await OutboxRepository.getUnconfirmedOrdered();
    expect(pendingBeforePush).toHaveLength(3);
    const firstOpId = pendingBeforePush[0].idOperacion;

    server.failNextPushCount = 1;
    const failedCycle = await PushSyncEngine.pushPendingOperations();
    expect(failedCycle.transientErrorCount).toBeGreaterThanOrEqual(1);
    const opAfter503 = await OutboxRepository.getByOperationId(firstOpId);
    expect(opAfter503?.estado).not.toBe('confirmado');
    expect(opAfter503?.idOperacion).toBe(firstOpId);

    // Reintento exitoso -> confirma las 3 operaciones en total sin duplicar registros
    await OutboxRepository.resetAllFailedForRetry();
    const okCycle = await PushSyncEngine.pushPendingOperations();
    expect(failedCycle.confirmedCount + okCycle.confirmedCount).toBe(3);
    expect(await db.reproductionRecords.count()).toBe(3);
    expect(server.recordsById.size).toBe(3);

    // Reenvío idempotente del mismo idOperacion no duplica en servidor
    const duplicateRes = await server.handleFetch('http://localhost:5173/api/sync/operaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(server.pushRequests[server.pushRequests.length - 1])
    });
    const duplicateJson = (await duplicateRes.json()) as { duplicadoIgnorado: boolean };
    expect(duplicateJson.duplicadoIgnorado).toBe(true);
    expect(server.recordsById.size).toBe(3);

    // 3. Simular Dispositivo B limpio: Pull paginado (pageSize: 1) + protección de checkpoint ante fallo de persistencia
    await Promise.all([
      db.reproductionRecords.clear(),
      db.outbox.clear(),
      db.syncCheckpoints.clear(),
      db.syncConflicts.clear()
    ]);

    // Si una página trae datos inválidos y falla la transacción Dexie, el checkpoint NO avanza
    server.injectInvalidPullSnapshotNext = true;
    const abortedPull = await SyncPullEngine.pullEntity('reproductionRecords', {
      ranchId: RANCH_A,
      pageSize: 1
    });
    expect(abortedPull.status).toBe('transaction_failed');
    expect(await CheckpointRepository.getCursor('reproductionRecords')).toBeNull();
    expect(await db.reproductionRecords.count()).toBe(0);

    // Pull exitoso paginado de 1 en 1 descarga los 3 eventos, sin duplicados y actualiza el checkpoint
    const pullSummary = await SyncPullEngine.pullEntity('reproductionRecords', {
      ranchId: RANCH_A,
      pageSize: 1
    });
    expect(pullSummary.status).toBe('completed');
    expect(pullSummary.pagesProcessed).toBe(3);
    expect(pullSummary.appliedCount).toBe(3);
    const cursorAfter3 = await CheckpointRepository.getCursor('reproductionRecords');
    expect(cursorAfter3).toBeTruthy();
    expect(await db.reproductionRecords.count()).toBe(3);

    // 4. Conflicto simultáneo: otro dispositivo modifica evLater en el servidor (v2), mientras este dispositivo edita offline sobre v1
    server.applyDirectRemoteMutationOnDeviceB({
      idEventoReproductivo: evLater.event.id,
      idAnimal: COW_A1,
      idSemental: BULL_A1,
      tipo: 'Confirmación de gestación',
      fecha: evLater.event.fecha,
      resultado: 'Gestante gemelar (ecografía)',
      observaciones: 'Nota servidor v2'
    });

    onlineSpy.mockReturnValue(false);
    await ReproductionService.update(evLater.event.id, {
      idAnimal: COW_A1,
      idSemental: BULL_A1,
      tipo: 'Confirmación de gestación',
      fecha: '2026-06-15T10:00',
      resultado: 'Positivo / Gestante',
      observaciones: 'Nota campo local'
    });

    onlineSpy.mockReturnValue(true);
    const conflictPush = await PushSyncEngine.pushPendingOperations();
    expect(conflictPush.conflictCount).toBe(1);

    const conflicts = await ConflictResolver.getPendingConflicts();
    expect(conflicts).toHaveLength(1);
    const fields = ConflictResolver.getMergeableFields(conflicts[0]);
    expect(fields.some((f) => f.key === 'resultado' && f.differs)).toBe(true);
    expect(fields.some((f) => f.key === 'evento')).toBe(false); // unificado con `tipo`

    // Resolver combinando resultado del servidor + observaciones locales sin duplicar el evento
    await ConflictResolver.resolveWithMerge(conflicts[0].idConflicto, {
      tipo: 'Confirmación de gestación',
      idSemental: BULL_A1,
      fecha: evLater.event.fecha,
      resultado: 'Gestante gemelar (ecografía)',
      observaciones: 'Nota combinada final'
    });

    const mergedPush = await PushSyncEngine.pushPendingOperations();
    expect(mergedPush.confirmedCount).toBe(1);
    expect(await db.reproductionRecords.count()).toBe(3);
    const resolvedLocal = await ReproductionService.getById(evLater.event.id);
    expect(resolvedLocal?.syncStatus).toBe('synced');
    expect(resolvedLocal?.versionRegistro).toBe(3);
    expect(resolvedLocal?.resultado).toBe('Gestante gemelar (ecografía)');
    expect(resolvedLocal?.observaciones).toBe('Nota combinada final');

    // 5. Baja lógica en servidor propagada por Pull incremental desde cursor previo
    const preDeleteCursor = await CheckpointRepository.getCursor('reproductionRecords');
    server.applyDirectRemoteMutationOnDeviceB({
      idEventoReproductivo: evEarlier.event.id,
      idAnimal: COW_A1,
      idSemental: BULL_A1,
      tipo: 'Servicio o monta',
      fecha: evEarlier.event.fecha,
      resultado: 'Exitoso',
      observaciones: null,
      delete: true
    });

    const deletePull = await SyncPullEngine.pullEntity('reproductionRecords', {
      ranchId: RANCH_A,
      pageSize: 10
    });
    expect(deletePull.deletedCount).toBe(1);
    expect(await CheckpointRepository.getCursor('reproductionRecords')).not.toBe(preDeleteCursor);

    const finalActive = await ReproductionService.getAll({ includeDeleted: false });
    expect(finalActive.data).toHaveLength(2);
  });

  it('hace visibles y recuperables los errores de validación del servidor y garantiza aislamiento estricto por rancho', async () => {
    const server = new ReproductionSyncServerSimulator();
    server.rejectWithValidationOnTipo = 'Tipo Invalido Temporal';
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handleFetch);
    setActiveSession([RANCH_A]);
    await seedDeviceIndexedDb(RANCH_A);

    // Sembrar en IndexedDB un registro residual de otro rancho (RANCH_B) para comprobar que nunca se mezcla
    await db.reproductionRecords.put({
      id: '88888888-8888-4888-8888-888888888888',
      remoteId: '88888888-8888-4888-8888-888888888888',
      ranchId: RANCH_B,
      cattleId: COW_B1,
      evento: 'Parto',
      fecha: '2026-07-01T08:00:00.000Z',
      resultado: 'Cría Viva',
      createdAt: '2026-07-01T08:00:00.000Z',
      updatedAt: '2026-07-01T08:00:00.000Z',
      syncStatus: 'synced',
      serverVersion: 1,
      deletedAt: null
    });

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    // 1. Consulta de otro rancho no autorizado -> rechaza con ApiError 403
    await expect(ReproductionService.getAll({ idRancho: RANCH_B })).rejects.toBeInstanceOf(
      ApiError
    );

    // 2. Consulta del rancho activo nunca devuelve el registro residual de RANCH_B
    const initialLoad = await ReproductionService.getAll();
    expect(initialLoad.data).toHaveLength(0);

    // 3. Crear evento que el servidor rechaza con HTTP 400 -> queda visible en syncIssuesByEventId con estado `error`
    const rejected = await ReproductionService.create({
      idAnimal: COW_A1,
      tipo: 'Tipo Invalido Temporal',
      fecha: '2026-10-10T09:00',
      resultado: null,
      observaciones: 'Capturado con tipo rechazado'
    });
    expect(rejected.synced).toBe(false);
    expect(rejected.event.syncStatus).toBe('error');

    const withError = await ReproductionService.getAll();
    expect(withError.syncIssuesByEventId[rejected.event.id]).toBeDefined();
    expect(withError.syncIssuesByEventId[rejected.event.id].mensaje).toMatch(/requiere corrección/i);

    // 4. Editar el evento con datos válidos recupera automáticamente la operación fallida y la sincroniza en el servidor
    const recovered = await ReproductionService.update(rejected.event.id, {
      idAnimal: COW_A1,
      idSemental: BULL_A1,
      tipo: 'Detección de celo',
      fecha: '2026-10-10T09:00',
      resultado: 'Pendiente',
      observaciones: 'Corregido y sincronizado'
    });
    expect(recovered.synced).toBe(true);
    expect(recovered.event.syncStatus).toBe('synced');
    expect(recovered.event.tipo).toBe('Detección de celo');

    const afterRecovery = await ReproductionService.getAll();
    expect(afterRecovery.syncIssuesByEventId[rejected.event.id]).toBeUndefined();
    expect(afterRecovery.data).toHaveLength(1);
    expect(server.recordsById.size).toBe(1);
  });
});
