import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/database/db';
import { RanchRepository } from '../lib/database/repositories/ranch.repository';
import { CattleRepository } from '../lib/database/repositories/cattle.repository';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { ConflictRepository } from '../lib/database/repositories/conflict.repository';
import { HealthService } from './health.service';
import { PushSyncEngine } from './sync/push-sync.engine';
import type {
  BackendEventoSanitarioDto,
  BackendTratamientoDto,
  HealthEventInput,
  TreatmentInput
} from '../types/health';

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
      arete: 'MX-920',
      areteSiniiga: 'MX-920',
      raza: 'Brahman',
      sexo: 'Hembra',
      gender: 'H',
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

function makeEventInput(overrides: Partial<HealthEventInput> = {}): HealthEventInput {
  return {
    idAnimal: ANIMAL_1,
    tipo: 'Enfermedad',
    fecha: '2026-03-10T09:00',
    sintomas: 'Fiebre y tos',
    diagnostico: 'Neumonía leve',
    profesionalDiagnostico: 'MVZ Laura Méndez',
    evidenciaDiagnosticoUri: null,
    responsable: 'Carlos Reyes',
    observaciones: 'Aislada en corral de enfermería',
    ...overrides
  };
}

function makeTreatmentInput(
  idEventoSanitario: string,
  overrides: Partial<TreatmentInput> = {}
): TreatmentInput {
  return {
    idEventoSanitario,
    producto: 'Oxitetraciclina LA',
    dosis: '12',
    unidadDosis: 'mL',
    viaAdministracion: 'Intramuscular',
    frecuencia: 'Cada 48 horas',
    fechaInicio: '2026-03-10T10:00',
    fechaFin: '2026-03-14T10:00',
    responsable: 'MVZ Laura Méndez',
    prescripcionUri: null,
    estado: 'Pendiente',
    ...overrides
  };
}

describe('HealthService — Eventos Sanitarios y Tratamientos offline-first + Push ordenado', () => {
  beforeEach(async () => {
    await Promise.all([
      db.ranches.clear(),
      db.cattle.clear(),
      db.healthRecords.clear(),
      db.treatments.clear(),
      db.outbox.clear(),
      db.syncConflicts.clear(),
      db.syncCheckpoints.clear()
    ]);
    window.sessionStorage.clear();
    setOnlineStatus(false);
    await seedWorld();
  });

  it('crea evento y tratamiento offline y sincroniza en orden referencial (EventoSanitario antes que Tratamiento)', async () => {
    const evRes = await HealthService.createEvent(makeEventInput());
    const trRes = await HealthService.createTreatment(makeTreatmentInput(evRes.event.id));

    expect(evRes.synced).toBe(false);
    expect(trRes.synced).toBe(false);
    expect(trRes.treatment.idEventoSanitario).toBe(evRes.event.id);
    expect(trRes.treatment.idAnimal).toBe(ANIMAL_1);

    // Recuperar conectividad y sincronizar Push
    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const sentSequence: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      sentSequence.push(parsed);
      return new Response(
        JSON.stringify({
          idOperacion: parsed.idOperacion,
          entidad: parsed.entidad,
          idRegistro: parsed.idRegistro,
          operacion: parsed.operacion,
          version: 1,
          versionResultante: 1,
          idCambio: crypto.randomUUID(),
          ocurrioEn: '2026-11-19T23:00:00Z',
          aplicadoEn: '2026-11-19T23:00:00Z',
          duplicadoIgnorado: false,
          datos: parsed.payload
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const summary = await PushSyncEngine.pushPendingOperations();
      expect(summary.status).toBe('completed');
      expect(summary.confirmedCount).toBe(2);
      expect(summary.validationErrorCount).toBe(0);

      // Verificar orden exacto: primero EventoSanitario, luego Tratamiento
      expect(sentSequence).toHaveLength(2);
      expect(sentSequence[0].entidad).toBe('EventoSanitario');
      expect(sentSequence[1].entidad).toBe('Tratamiento');

      const eventPayload = sentSequence[0].payload as Record<string, unknown>;
      expect(eventPayload.idEventoSanitario).toBe(evRes.event.id);
      expect(eventPayload.idAnimal).toBe(ANIMAL_1);
      expect(eventPayload.cattleId).toBeUndefined();

      const trPayload = sentSequence[1].payload as Record<string, unknown>;
      expect(trPayload.idTratamiento).toBe(trRes.treatment.id);
      expect(trPayload.idEventoSanitario).toBe(evRes.event.id);
      expect(trPayload.producto).toBe('Oxitetraciclina LA');
      expect(trPayload.dosis).toBe(12);
      expect(trPayload.eventoSanitarioId).toBeUndefined();

      const loaded = await HealthService.getAll();
      expect(loaded.events[0].syncStatus).toBe('synced');
      expect(loaded.treatments[0].syncStatus).toBe('synced');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bloquea desactivar evento sanitario con tratamientos activos y permite al desactivar el tratamiento', async () => {
    const evRes = await HealthService.createEvent(makeEventInput());
    const trRes = await HealthService.createTreatment(makeTreatmentInput(evRes.event.id));

    await expect(HealthService.deactivateEvent(evRes.event.id)).rejects.toThrow(
      /tratamiento\(s\) activo\(s\)/i
    );

    // Completar estado y luego desactivar el tratamiento
    const completed = await HealthService.setTreatmentEstado(trRes.treatment.id, 'Completado');
    expect(completed.treatment.estado).toBe('Completado');

    await HealthService.deactivateTreatment(trRes.treatment.id);
    await HealthService.deactivateEvent(evRes.event.id);

    const active = await HealthService.getAll({ includeDeleted: false });
    expect(active.events).toHaveLength(0);
    expect(active.treatments).toHaveLength(0);
  });

  it('registra conflicto 409 al editar evento desactualizado e hidrata desde GET /api/eventos-sanitarios y /api/tratamientos', async () => {
    const evRes = await HealthService.createEvent(makeEventInput());
    await db.healthRecords.update(evRes.event.id, {
      syncStatus: 'synced',
      serverVersion: 1,
      remoteId: evRes.event.id
    });
    await db.outbox.clear();

    setOnlineStatus(true);
    window.sessionStorage.setItem('farmbovi_access_token', 'jwt-test-token');

    const fetch409 = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tipoConflicto: 'VERSION_MISMATCH',
          mensaje: 'Versión remota más reciente en EventoSanitario.',
          idOperacion: 'op-ev-409',
          entidad: 'EventoSanitario',
          idRegistro: evRes.event.id,
          versionEnviada: 1,
          versionServidor: 3,
          camposModificados: ['diagnostico'],
          estadoServidor: { idEventoSanitario: evRes.event.id, diagnostico: 'Remoto v3' }
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetch409);

    try {
      const updated = await HealthService.updateEvent(
        evRes.event.id,
        makeEventInput({ diagnostico: 'Ajuste local' })
      );
      expect(updated.event.syncStatus).toBe('conflict');
      const conflicts = await ConflictRepository.getPendingConflicts();
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].entidad).toBe('healthRecords');
    } finally {
      vi.unstubAllGlobals();
    }

    // Hidratación desde ambos endpoints reales
    const remoteEventId = '88888888-8888-4888-8888-888888888881';
    const remoteTreatId = '88888888-8888-4888-8888-888888888882';
    const remoteEvents: BackendEventoSanitarioDto[] = [
      {
        idEventoSanitario: remoteEventId,
        idAnimal: ANIMAL_1,
        tipo: 'Vacunación',
        fecha: '2026-02-01T08:00:00Z',
        sintomas: null,
        diagnostico: 'Vacuna clostridial',
        profesionalDiagnostico: 'MVZ Ana',
        evidenciaDiagnosticoUri: null,
        responsable: 'MVZ Ana',
        observaciones: null,
        versionRegistro: 1,
        eliminadoEn: null
      }
    ];
    const remoteTreatments: BackendTratamientoDto[] = [
      {
        idTratamiento: remoteTreatId,
        idEventoSanitario: remoteEventId,
        producto: 'Bacterina 8 vías',
        dosis: 5,
        unidadDosis: 'mL',
        viaAdministracion: 'Subcutánea',
        frecuencia: 'Dosis única',
        fechaInicio: '2026-02-01T08:15:00Z',
        fechaFin: null,
        responsable: 'MVZ Ana',
        prescripcionUri: null,
        estado: 'Pendiente',
        versionRegistro: 1,
        eliminadoEn: null
      }
    ];

    const fetch200 = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/eventos-sanitarios')) {
        return new Response(JSON.stringify(remoteEvents), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(remoteTreatments), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetch200);

    try {
      const hydrated = await HealthService.getAll();
      expect(hydrated.source).toBe('server');
      expect(hydrated.events.some((e) => e.id === remoteEventId)).toBe(true);
      expect(hydrated.treatments.some((t) => t.id === remoteTreatId && t.idAnimal === ANIMAL_1)).toBe(
        true
      );
      expect(await OutboxRepository.getByEntity('healthRecords', evRes.event.id)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
