import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/database/db';
import { CattleRepository } from '../../lib/database/repositories/cattle.repository';
import { CheckpointRepository } from '../../lib/database/repositories/checkpoint.repository';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { RanchRepository } from '../../lib/database/repositories/ranch.repository';
import { GenealogyService, GenealogyValidationError } from '../genealogy.service';
import { ConflictResolver } from './conflict-resolver';
import { PushSyncEngine } from './push-sync.engine';
import { SyncEngine } from './sync-engine';
import { SyncPullEngine } from './sync-pull.engine';

const RANCH_A = '11111111-1111-4111-8111-111111111111';
const RANCH_B = '22222222-2222-4222-8222-222222222222';
const GRANDPA_A = '33333333-3333-4333-8333-333333333330';
const FATHER_A = '33333333-3333-4333-8333-333333333331';
const MOTHER_A = '33333333-3333-4333-8333-333333333332';
const CALF_A = '33333333-3333-4333-8333-333333333333';
const FATHER_B = '44444444-4444-4444-8444-444444444441';
const CALF_B = '44444444-4444-4444-8444-444444444442';

interface ServerGenealogyRecord {
  idGenealogia: string;
  idRancho: string;
  idAnimal: string;
  idPadre: string | null;
  idMadre: string | null;
  observaciones: string | null;
  version: number;
  eliminadoEn: string | null;
  createdAt: string;
}

interface ServerChangeEntry {
  seq: number;
  idCambio: string;
  idRancho: string;
  entidad: 'GenealogiaAnimal';
  idRegistro: string;
  operacion: 'Crear' | 'Actualizar' | 'Eliminar';
  version: number;
  datos: Record<string, unknown> | null;
  ocurrioEn: string;
}

class GenealogySyncServerSimulator {
  readonly recordsById = new Map<string, ServerGenealogyRecord>();
  readonly authorizedRanches = new Set<string>([RANCH_A]);
  readonly animalRanchById = new Map<string, string>([
    [GRANDPA_A, RANCH_A],
    [FATHER_A, RANCH_A],
    [MOTHER_A, RANCH_A],
    [CALF_A, RANCH_A],
    [FATHER_B, RANCH_B],
    [CALF_B, RANCH_B]
  ]);
  readonly processedOps = new Map<string, Record<string, unknown>>();
  readonly changeLog: ServerChangeEntry[] = [];
  readonly pushRequests: Array<Record<string, unknown>> = [];

  private seq = 0;
  failNextPushCount = 0;
  failNextPullCount = 0;
  injectInvalidPullRecordNext = false;

  private encodeCursor(seq: number): string {
    return btoa(`2026-11-22T18:00:00.000Z|${seq}`)
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

  private toPullPayload(rec: ServerGenealogyRecord): Record<string, unknown> {
    return {
      ranchId: rec.idRancho,
      idAnimal: rec.idAnimal,
      cattleId: rec.idAnimal,
      idPadre: rec.idPadre,
      padreId: rec.idPadre,
      idMadre: rec.idMadre,
      madreId: rec.idMadre,
      observaciones: rec.observaciones,
      createdAt: rec.createdAt
    };
  }

  private createsCycle(idAnimal: string, idPadre: string | null, idMadre: string | null, excludeId?: string): boolean {
    const visited = new Set<string>();
    const stack: string[] = [];
    if (idPadre) stack.push(idPadre);
    if (idMadre) stack.push(idMadre);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (curr === idAnimal) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const rec of this.recordsById.values()) {
        if (rec.eliminadoEn || rec.idGenealogia === excludeId || rec.idAnimal !== curr) continue;
        if (rec.idPadre) stack.push(rec.idPadre);
        if (rec.idMadre) stack.push(rec.idMadre);
      }
    }
    return false;
  }

  appendChange(entry: Omit<ServerChangeEntry, 'seq' | 'idCambio'>): ServerChangeEntry {
    this.seq++;
    const full: ServerChangeEntry = {
      ...entry,
      seq: this.seq,
      idCambio: crypto.randomUUID()
    };
    this.changeLog.push(full);
    return full;
  }

  applyRemoteServerUpdate(idGenealogia: string, patch: Partial<Pick<ServerGenealogyRecord, 'idPadre' | 'idMadre' | 'observaciones'>>) {
    const rec = this.recordsById.get(idGenealogia);
    if (!rec) throw new Error('Registro no encontrado en simulador.');
    if ('idPadre' in patch) rec.idPadre = patch.idPadre ?? null;
    if ('idMadre' in patch) rec.idMadre = patch.idMadre ?? null;
    if ('observaciones' in patch) rec.observaciones = patch.observaciones ?? null;
    rec.version += 1;
    const now = new Date(Date.now() + this.seq * 1000).toISOString();
    this.appendChange({
      idRancho: rec.idRancho,
      entidad: 'GenealogiaAnimal',
      idRegistro: rec.idGenealogia,
      operacion: 'Actualizar',
      version: rec.version,
      datos: this.toPullPayload(rec),
      ocurrioEn: now
    });
  }

  applyRemoteServerDelete(idGenealogia: string) {
    const rec = this.recordsById.get(idGenealogia);
    if (!rec) throw new Error('Registro no encontrado en simulador.');
    const now = new Date(Date.now() + this.seq * 1000).toISOString();
    rec.eliminadoEn = now;
    rec.version += 1;
    this.appendChange({
      idRancho: rec.idRancho,
      entidad: 'GenealogiaAnimal',
      idRegistro: rec.idGenealogia,
      operacion: 'Eliminar',
      version: rec.version,
      datos: null,
      ocurrioEn: now
    });
  }

  handleFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost:5173');
    const method = (init?.method || 'GET').toUpperCase();

    if (url.pathname.endsWith('/sync/operaciones') && method === 'POST') {
      return this.handlePush(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
    }
    if (url.pathname.endsWith('/sync/cambios') && method === 'GET') {
      return this.handlePull(url.searchParams);
    }

    return this.json(404, { mensaje: `Ruta no simulada: ${method} ${url.pathname}` });
  };

  private handlePush(body: Record<string, unknown>): Response {
    this.pushRequests.push(body);

    if (this.failNextPushCount > 0) {
      this.failNextPushCount--;
      return this.json(503, { mensaje: 'Fallo temporal del servidor en Push.' });
    }

    const idOperacion = String(body.idOperacion || '');
    const idRancho = String(body.idRancho || '');
    const idRegistro = String(body.idRegistro || '');
    const operacion = String(body.operacion || '') as 'Crear' | 'Actualizar' | 'Eliminar';
    const versionBase = body.versionBase !== null && body.versionBase !== undefined ? Number(body.versionBase) : null;
    const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;

    if (!this.authorizedRanches.has(idRancho)) {
      return this.json(403, { mensaje: 'No tienes membresía activa en el rancho solicitado.' });
    }

    const prev = this.processedOps.get(idOperacion);
    if (prev) {
      return this.json(200, { ...prev, duplicadoIgnorado: true });
    }

    const now = new Date(Date.now() + this.seq * 1000).toISOString();

    if (operacion === 'Crear') {
      const idAnimal = String(payload.idAnimal || '');
      const idPadre = typeof payload.idPadre === 'string' ? payload.idPadre : null;
      const idMadre = typeof payload.idMadre === 'string' ? payload.idMadre : null;
      const observaciones = typeof payload.observaciones === 'string' ? payload.observaciones : null;

      if (this.animalRanchById.get(idAnimal) !== idRancho) {
        return this.json(403, { mensaje: 'El animal objetivo pertenece a otro rancho.' });
      }
      if (idPadre && this.animalRanchById.get(idPadre) !== idRancho) {
        return this.json(403, { mensaje: 'El padre pertenece a otro rancho.' });
      }
      if (idMadre && this.animalRanchById.get(idMadre) !== idRancho) {
        return this.json(403, { mensaje: 'La madre pertenece a otro rancho.' });
      }
      if (!idPadre && !idMadre) {
        return this.json(400, { mensaje: 'Debe especificar padre o madre.' });
      }
      if (this.createsCycle(idAnimal, idPadre, idMadre)) {
        return this.json(400, { mensaje: 'La relación solicitada genera un ciclo genealógico.' });
      }

      const duplicateForAnimal = Array.from(this.recordsById.values()).find((r) => r.idAnimal === idAnimal);
      if (duplicateForAnimal) {
        return this.json(409, {
          tipoConflicto: 'DUPLICATE_OR_INVALID_REFERENCE',
          campo: 'idAnimal',
          mensaje: `El animal '${idAnimal}' ya cuenta con genealogía registrada.`,
          idOperacion,
          entidad: 'GenealogiaAnimal',
          idRegistro,
          idExistente: duplicateForAnimal.idGenealogia,
          versionServidor: duplicateForAnimal.version
        });
      }

      const rec: ServerGenealogyRecord = {
        idGenealogia: idRegistro,
        idRancho,
        idAnimal,
        idPadre,
        idMadre,
        observaciones,
        version: 1,
        eliminadoEn: null,
        createdAt: now
      };
      this.recordsById.set(idRegistro, rec);
      const change = this.appendChange({
        idRancho,
        entidad: 'GenealogiaAnimal',
        idRegistro,
        operacion: 'Crear',
        version: 1,
        datos: this.toPullPayload(rec),
        ocurrioEn: now
      });

      const receipt = {
        idOperacion,
        entidad: 'GenealogiaAnimal',
        idRegistro,
        operacion,
        version: 1,
        versionResultante: 1,
        idCambio: change.idCambio,
        aplicadoEn: now,
        estadoServidor: change.datos,
        duplicadoIgnorado: false
      };
      this.processedOps.set(idOperacion, receipt);
      return this.json(201, receipt);
    }

    const existing = this.recordsById.get(idRegistro);
    if (!existing) {
      return this.json(404, { mensaje: 'Genealogía no encontrada.' });
    }
    if (existing.idRancho !== idRancho) {
      return this.json(403, { mensaje: 'Registro pertenece a otro rancho.' });
    }
    if (existing.eliminadoEn) {
      return this.json(409, {
        tipoConflicto: 'DELETED_ON_SERVER',
        mensaje: 'El vínculo genealógico fue eliminado en otro dispositivo.',
        idOperacion,
        entidad: 'GenealogiaAnimal',
        idRegistro,
        versionEnviada: versionBase,
        versionServidor: existing.version,
        camposModificados: [],
        estadoServidor: { ...this.toPullPayload(existing), eliminado: true }
      });
    }
    if (versionBase !== existing.version) {
      return this.json(409, {
        tipoConflicto: 'VERSION_MISMATCH',
        mensaje: `Conflicto de versión: enviado v${String(versionBase)}, servidor v${existing.version}.`,
        idOperacion,
        entidad: 'GenealogiaAnimal',
        idRegistro,
        versionEnviada: versionBase,
        versionServidor: existing.version,
        camposModificados: [
          { campo: 'observaciones', valorServidor: existing.observaciones, valorCliente: payload.observaciones ?? null }
        ],
        estadoServidor: this.toPullPayload(existing)
      });
    }

    if (operacion === 'Actualizar') {
      const nextPadre = 'idPadre' in payload ? (payload.idPadre as string | null) : existing.idPadre;
      const nextMadre = 'idMadre' in payload ? (payload.idMadre as string | null) : existing.idMadre;
      if (this.createsCycle(existing.idAnimal, nextPadre, nextMadre, existing.idGenealogia)) {
        return this.json(400, { mensaje: 'La relación solicitada genera un ciclo genealógico.' });
      }
      existing.idPadre = nextPadre;
      existing.idMadre = nextMadre;
      if ('observaciones' in payload) {
        existing.observaciones = payload.observaciones === null ? null : String(payload.observaciones);
      }
    } else {
      existing.eliminadoEn = now;
    }

    existing.version += 1;
    const change = this.appendChange({
      idRancho,
      entidad: 'GenealogiaAnimal',
      idRegistro,
      operacion,
      version: existing.version,
      datos: operacion === 'Eliminar' ? null : this.toPullPayload(existing),
      ocurrioEn: now
    });

    const receipt = {
      idOperacion,
      entidad: 'GenealogiaAnimal',
      idRegistro,
      operacion,
      version: existing.version,
      versionResultante: existing.version,
      idCambio: change.idCambio,
      aplicadoEn: now,
      estadoServidor: change.datos,
      duplicadoIgnorado: false
    };
    this.processedOps.set(idOperacion, receipt);
    return this.json(200, receipt);
  }

  private handlePull(params: URLSearchParams): Response {
    if (this.failNextPullCount > 0) {
      this.failNextPullCount--;
      return this.json(503, { mensaje: 'Fallo temporal del servidor en Pull.' });
    }

    const entidad = params.get('entidad') || '';
    const ranchId = params.get('ranchId') || params.get('idRancho') || '';
    const cursor = params.get('cursorOpaco') || params.get('cursor') || '';
    const limite = Math.min(500, Math.max(1, Number(params.get('limite') || '100')));

    if (!this.authorizedRanches.has(ranchId)) {
      return this.json(403, { mensaje: 'Sin membresía activa en el rancho.' });
    }

    if (entidad !== 'genealogy') {
      return this.json(200, {
        entidad,
        cambios: [],
        siguienteCursorOpaco: cursor || null,
        hayMasPaginas: false,
        fechaServidor: new Date().toISOString()
      });
    }

    if (this.injectInvalidPullRecordNext) {
      this.injectInvalidPullRecordNext = false;
      return this.json(200, {
        entidad: 'genealogy',
        cambios: [
          {
            remoteId: crypto.randomUUID(),
            clientUuid: null,
            operacion: 'UPSERT',
            versionServidor: 1,
            // Inválido: auto-parentesco -> debe abortar la transacción Dexie sin avanzar cursor
            datos: { ranchId, idAnimal: CALF_A, idPadre: CALF_A, idMadre: null },
            eliminado: false,
            actualizadoEnServidor: new Date().toISOString()
          }
        ],
        siguienteCursorOpaco: this.encodeCursor(999),
        hayMasPaginas: false,
        fechaServidor: new Date().toISOString()
      });
    }

    const afterSeq = cursor ? this.decodeCursor(cursor) : 0;
    const eligible = this.changeLog.filter((c) => c.idRancho === ranchId && c.seq > afterSeq);
    const slice = eligible.slice(0, limite);
    const hasMore = eligible.length > limite;
    const last = slice[slice.length - 1];

    return this.json(200, {
      entidad: 'genealogy',
      cambios: slice.map((c) => ({
        remoteId: c.idRegistro,
        clientUuid: null,
        operacion: c.operacion === 'Eliminar' ? 'DELETE' : 'UPSERT',
        versionServidor: c.version,
        datos: c.operacion === 'Eliminar' ? null : c.datos,
        eliminado: c.operacion === 'Eliminar',
        actualizadoEnServidor: c.ocurrioEn
      })),
      siguienteCursorOpaco: last ? this.encodeCursor(last.seq) : cursor || null,
      hayMasPaginas: hasMore,
      fechaServidor: new Date().toISOString()
    });
  }
}

async function clearDb() {
  await Promise.all([
    db.ranches.clear(),
    db.lots.clear(),
    db.cattle.clear(),
    db.genealogy.clear(),
    db.weighings.clear(),
    db.healthRecords.clear(),
    db.feedingRecords.clear(),
    db.movements.clear(),
    db.alerts.clear(),
    db.outbox.clear(),
    db.syncConflicts.clear(),
    db.syncCheckpoints.clear()
  ]);
}

async function seedRanchAnimals() {
  const now = '2026-11-20T00:00:00.000Z';
  await RanchRepository.upsertFromServer([
    {
      id: RANCH_A,
      remoteId: RANCH_A,
      ranchId: RANCH_A,
      nombre: 'Rancho A',
      ubicacionGeneral: 'Norte',
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
      id: GRANDPA_A,
      remoteId: GRANDPA_A,
      ranchId: RANCH_A,
      arete: 'A-ABU',
      areteSiniiga: 'A-ABU',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2017-01-01',
      fechaIngreso: '2017-01-01',
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
      id: FATHER_A,
      remoteId: FATHER_A,
      ranchId: RANCH_A,
      arete: 'A-PAD',
      areteSiniiga: 'A-PAD',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2020-01-01',
      fechaIngreso: '2020-01-01',
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
      id: MOTHER_A,
      remoteId: MOTHER_A,
      ranchId: RANCH_A,
      arete: 'A-MAD',
      areteSiniiga: 'A-MAD',
      raza: 'Holstein',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2020-03-01',
      fechaIngreso: '2020-03-01',
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
      id: CALF_A,
      remoteId: CALF_A,
      ranchId: RANCH_A,
      arete: 'A-CRI',
      areteSiniiga: 'A-CRI',
      raza: 'Cruza',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2023-05-01',
      fechaIngreso: '2023-05-01',
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

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
}

describe('Genealogía Offline-First Sync E2E — Push, Pull, Conflictos, Reintentos, Duplicados y Aislamiento', () => {
  let server: GenealogySyncServerSimulator;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearDb();
    window.sessionStorage.clear();
    window.localStorage.clear();
    setOnline(true);

    server = new GenealogySyncServerSimulator();
    vi.spyOn(globalThis, 'fetch').mockImplementation(server.handleFetch);
    await seedRanchAnimals();
  });

  it('alta offline -> sincroniza al recuperar conexión y no reenvía operaciones ya confirmadas', async () => {
    setOnline(false);

    const createdOffline = await GenealogyService.create({
      idAnimal: CALF_A,
      idPadre: FATHER_A,
      idMadre: MOTHER_A,
      observaciones: 'Capturado offline en campo'
    });
    expect(createdOffline.synced).toBe(false);
    expect(createdOffline.record.syncStatus).toBe('pending');

    // Recupera conexión -> Push envía GenealogiaAnimal con observaciones y confirma individualmente
    setOnline(true);
    const push1 = await PushSyncEngine.pushPendingOperations();
    expect(push1.confirmedCount).toBe(1);
    expect(server.pushRequests).toHaveLength(1);
    expect(server.pushRequests[0].entidad).toBe('GenealogiaAnimal');
    expect((server.pushRequests[0].payload as Record<string, unknown>).observaciones).toBe(
      'Capturado offline en campo'
    );

    const syncedLocal = await db.genealogy.get(createdOffline.record.id);
    expect(syncedLocal?.syncStatus).toBe('synced');
    expect(syncedLocal?.serverVersion).toBe(1);

    // Un segundo ciclo Push no vuelve a enviar operaciones confirmadas
    const push2 = await PushSyncEngine.pushPendingOperations();
    expect(push2.status).toBe('nothing_to_push');
    expect(server.pushRequests).toHaveLength(1);
  });

  it('descarga modificaciones y eliminaciones de otro dispositivo con paginación y actualización de checkpoints', async () => {
    // Dispositivo A crea offline y sube
    setOnline(false);
    const created = await GenealogyService.create({
      idAnimal: CALF_A,
      idPadre: FATHER_A,
      idMadre: null,
      observaciones: 'Inicial'
    });
    setOnline(true);
    await PushSyncEngine.pushPendingOperations();

    // Otro dispositivo modifica (agrega madre, limpia observaciones) y luego elimina
    server.applyRemoteServerUpdate(created.record.id, {
      idMadre: MOTHER_A,
      observaciones: null
    });
    server.applyRemoteServerDelete(created.record.id);

    // Dispositivo B (Dexie limpio) ejecuta Pull paginado de 1 en 1
    await clearDb();
    await seedRanchAnimals();

    const pullSummary = await SyncPullEngine.pullEntity('genealogy', {
      ranchId: RANCH_A,
      pageSize: 1,
      retryDelayMs: 0
    });
    expect(pullSummary.status).toBe('completed');
    expect(pullSummary.pagesProcessed).toBe(3);
    expect(pullSummary.appliedCount).toBe(2);
    expect(pullSummary.deletedCount).toBe(1);
    expect(pullSummary.currentCursor).not.toBeNull();
    expect(await CheckpointRepository.getCursor('genealogy')).toBe(pullSummary.currentCursor);

    // Solo 1 registro en Dexie (sin duplicados), con madre agregada, observaciones limpias y tombstone v3
    expect(await db.genealogy.count()).toBe(1);
    const localOnB = await db.genealogy.get(created.record.id);
    expect(localOnB?.madreId).toBe(MOTHER_A);
    expect(localOnB?.observaciones).toBeNull();
    expect(localOnB?.deletedAt).not.toBeNull();
    expect(localOnB?.serverVersion).toBe(3);
    expect(localOnB?.syncStatus).toBe('synced');
  });

  it('detecta conflictos simultáneos (409 VERSION_MISMATCH), preserva cambio local y permite resolver con versión del servidor', async () => {
    setOnline(false);
    const created = await GenealogyService.create({
      idAnimal: CALF_A,
      idPadre: FATHER_A,
      idMadre: null,
      observaciones: 'Base v1'
    });
    setOnline(true);
    await PushSyncEngine.pushPendingOperations();

    // Dispositivo B modifica en servidor -> v2
    server.applyRemoteServerUpdate(created.record.id, {
      idMadre: MOTHER_A,
      observaciones: 'Versión ganadora B'
    });

    // Dispositivo A modifica offline sobre v1
    setOnline(false);
    await GenealogyService.update(created.record.id, {
      idAnimal: CALF_A,
      idPadre: FATHER_A,
      idMadre: null,
      observaciones: 'Edición offline A'
    });

    // Dispositivo A reconecta -> Push recibe 409 VERSION_MISMATCH y guarda conflicto sin perder cambio local
    setOnline(true);
    const pushConflict = await PushSyncEngine.pushPendingOperations();
    expect(pushConflict.conflictCount).toBe(1);

    const conflicts = await ConflictResolver.getPendingConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entidad).toBe('genealogy');
    expect(conflicts[0].tipoConflicto).toBe('VERSION_MISMATCH');

    // Resolver aceptando versión del servidor converge sin duplicados
    await ConflictResolver.resolveWithServer(conflicts[0].idConflicto, 'Aceptar versión B');
    const resolved = await db.genealogy.get(created.record.id);
    expect(resolved?.syncStatus).toBe('synced');
    expect(resolved?.madreId).toBe(MOTHER_A);
    expect(resolved?.observaciones).toBe('Versión ganadora B');
    expect(resolved?.serverVersion).toBe(2);
    expect(await db.genealogy.count()).toBe(1);
  });

  it('maneja reintentos ante fallos 503 en Push/Pull y revierte transacción Pull ante lote inválido sin avanzar cursor', async () => {
    setOnline(false);
    const created = await GenealogyService.create({
      idAnimal: CALF_A,
      idPadre: FATHER_A,
      idMadre: null,
      observaciones: 'Con reintento'
    });
    setOnline(true);

    // 1. Push falla con 503 -> mantiene mismo idOperacion y operación pendiente -> reintento confirma sin duplicar
    server.failNextPushCount = 1;
    const firstAttempt = await PushSyncEngine.pushPendingOperations();
    expect(firstAttempt.transientErrorCount).toBe(1);

    const pendingOps = await OutboxRepository.getByEntity('genealogy', created.record.id);
    expect(pendingOps).toHaveLength(1);
    const originalOpId = pendingOps[0].idOperacion;

    await OutboxRepository.resetAllFailedForRetry();
    const secondAttempt = await PushSyncEngine.pushPendingOperations();
    expect(secondAttempt.confirmedCount).toBe(1);
    expect(server.pushRequests[0].idOperacion).toBe(originalOpId);
    expect(server.pushRequests[1].idOperacion).toBe(originalOpId);
    expect(server.recordsById.size).toBe(1);

    // 2. Pull con fallo 503 -> reintenta automáticamente y persiste checkpoint
    server.failNextPullCount = 1;
    const pullOk = await SyncPullEngine.pullEntity('genealogy', {
      ranchId: RANCH_A,
      maxRetriesPerPage: 2,
      retryDelayMs: 0
    });
    expect(pullOk.status).toBe('completed');
    expect(pullOk.retriesPerformed).toBe(1);
    const checkpointBeforeError = await CheckpointRepository.getCursor('genealogy');
    expect(checkpointBeforeError).not.toBeNull();

    // 3. Lote remoto inválido -> revierte Dexie y conserva cursor anterior
    server.injectInvalidPullRecordNext = true;
    const pullFailed = await SyncPullEngine.pullEntity('genealogy', {
      ranchId: RANCH_A,
      maxRetriesPerPage: 0,
      retryDelayMs: 0
    });
    expect(pullFailed.status).toBe('transaction_failed');
    expect(await CheckpointRepository.getCursor('genealogy')).toBe(checkpointBeforeError);
  });

  it('evita duplicados por animal en Push/Pull, rechaza ciclos y respeta aislamiento por rancho', async () => {
    // Registro previo en servidor para CALF_A (creado por otro dispositivo) + registro en RANCH_B
    const existingRemoteId = crypto.randomUUID();
    server.recordsById.set(existingRemoteId, {
      idGenealogia: existingRemoteId,
      idRancho: RANCH_A,
      idAnimal: CALF_A,
      idPadre: FATHER_A,
      idMadre: MOTHER_A,
      observaciones: 'Del servidor',
      version: 1,
      eliminadoEn: null,
      createdAt: '2026-11-22T18:00:00Z'
    });
    server.appendChange({
      idRancho: RANCH_A,
      entidad: 'GenealogiaAnimal',
      idRegistro: existingRemoteId,
      operacion: 'Crear',
      version: 1,
      datos: {
        ranchId: RANCH_A,
        idAnimal: CALF_A,
        cattleId: CALF_A,
        idPadre: FATHER_A,
        padreId: FATHER_A,
        idMadre: MOTHER_A,
        madreId: MOTHER_A,
        observaciones: 'Del servidor',
        createdAt: '2026-11-22T18:00:00Z'
      },
      ocurrioEn: '2026-11-22T18:00:00Z'
    });
    server.appendChange({
      idRancho: RANCH_B,
      entidad: 'GenealogiaAnimal',
      idRegistro: crypto.randomUUID(),
      operacion: 'Crear',
      version: 1,
      datos: {
        ranchId: RANCH_B,
        idAnimal: CALF_B,
        cattleId: CALF_B,
        idPadre: FATHER_B,
        padreId: FATHER_B,
        idMadre: null,
        madreId: null,
        observaciones: 'Secreto Rancho B',
        createdAt: '2026-11-22T18:01:00Z'
      },
      ocurrioEn: '2026-11-22T18:01:00Z'
    });

    // Ciclo rechazado localmente incluso offline
    setOnline(false);
    await GenealogyService.create({ idAnimal: FATHER_A, idPadre: GRANDPA_A, idMadre: null });
    await expect(
      GenealogyService.create({ idAnimal: GRANDPA_A, idPadre: FATHER_A, idMadre: null })
    ).rejects.toBeInstanceOf(GenealogyValidationError);

    // Sincronización completa vía SyncEngine.sync() sobre RANCH_A:
    // - Sube FATHER_A -> GRANDPA_A
    // - Descarga CALF_A (RANCH_A) sin incluir jamás CALF_B (RANCH_B)
    setOnline(true);
    const cycle = await SyncEngine.sync({ ranchId: RANCH_A, retryDelayMs: 0 });
    expect(cycle?.allTasksCompleted).toBe(true);

    const stored = await db.genealogy.toArray();
    expect(stored).toHaveLength(2);
    expect(stored.every((g) => g.ranchId === RANCH_A)).toBe(true);
    expect(stored.some((g) => g.cattleId === CALF_B)).toBe(false);

    // Intentar Pull sobre RANCH_B no autorizado -> 403 y no modifica checkpoints
    const prevCursor = await CheckpointRepository.getCursor('genealogy');
    const unauthorizedPull = await SyncPullEngine.pullEntity('genealogy', {
      ranchId: RANCH_B,
      retryDelayMs: 0
    });
    expect(unauthorizedPull.status).toBe('transaction_failed');
    expect(await CheckpointRepository.getCursor('genealogy')).toBe(prevCursor);
  });
});
