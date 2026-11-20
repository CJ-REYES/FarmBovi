import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/database/db';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { CattleService } from './cattle.service';
import {
  ReproductionService,
  ReproductionValidationError
} from './reproduction.service';

const RANCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FEMALE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MALE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function seedAnimals() {
  const now = new Date().toISOString();
  await db.cattle.bulkPut([
    {
      id: FEMALE_ID,
      remoteId: FEMALE_ID,
      ranchId: RANCH_ID,
      arete: 'MX-REP-01',
      areteSiniiga: 'MX-REP-01',
      raza: 'Suizo Pardo',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2022-01-01',
      fechaIngreso: '2022-02-01',
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
      id: MALE_ID,
      remoteId: MALE_ID,
      ranchId: RANCH_ID,
      arete: 'MX-REP-02',
      areteSiniiga: 'MX-REP-02',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2021-01-01',
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

describe('ReproductionService — Persistencia offline-first sin simular Backend', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.reproductionRecords.clear();
    await db.cattle.clear();
    await db.outbox.clear();
    await seedAnimals();
  });

  it('crea, edita y desactiva eventos en IndexedDB + outbox y nunca simula sincronización remota', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const created = await ReproductionService.create({
      idAnimal: FEMALE_ID,
      tipo: 'Inseminación Artificial',
      fecha: '2026-11-12T08:30',
      resultado: 'Pendiente',
      observaciones: 'Primer servicio del ciclo'
    });

    // Nunca debe fingir sincronización remota ni llamar endpoints inexistentes
    expect(created.synced).toBe(false);
    expect(created.event.syncStatus).toBe('pending');
    expect(created.event.tipo).toBe('Inseminación Artificial');
    expect(created.event.resultado).toBe('Pendiente');
    expect(created.event.observaciones).toBe('Primer servicio del ciclo');
    expect(fetchSpy).not.toHaveBeenCalled();

    const opsAfterCreate = await OutboxRepository.getByEntity(
      'reproductionRecords',
      created.event.id
    );
    expect(opsAfterCreate).toHaveLength(1);
    expect(opsAfterCreate[0].tipoOperacion).toBe('CREATE');
    expect(opsAfterCreate[0].estado).toBe('pendiente');

    // Edición: conserva idAnimal inmutable aunque se intente cambiar
    const updated = await ReproductionService.update(created.event.id, {
      idAnimal: MALE_ID,
      tipo: 'Gestación Confirmada',
      fecha: '2026-11-18T10:00',
      resultado: 'Positivo / Gestante',
      observaciones: 'Palpación confirmada a 60 días'
    });

    expect(updated.synced).toBe(false);
    expect(updated.event.idAnimal).toBe(FEMALE_ID);
    expect(updated.event.tipo).toBe('Gestación Confirmada');
    expect(updated.event.resultado).toBe('Positivo / Gestante');

    // Desactivación (baja lógica)
    const deactivated = await ReproductionService.deactivate(created.event.id);
    expect(deactivated.synced).toBe(false);

    const activeList = await ReproductionService.getAll({ includeDeleted: false });
    expect(activeList.data).toHaveLength(0);
    expect(activeList.backendNotice).toMatch(/EventoReproductivo/i);

    const withDeleted = await ReproductionService.getAll({ includeDeleted: true });
    expect(withDeleted.data).toHaveLength(1);
    expect(withDeleted.data[0].deletedAt).toBeTruthy();
  });

  it('lanza ReproductionValidationError cuando se intenta registrar un parto en un Macho', async () => {
    await expect(
      ReproductionService.create({
        idAnimal: MALE_ID,
        tipo: 'Parto',
        fecha: '2026-11-10T09:00',
        resultado: 'Cría Viva',
        observaciones: null
      })
    ).rejects.toBeInstanceOf(ReproductionValidationError);

    expect(await db.reproductionRecords.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('hidrata el catálogo de animales desde CattleService.getAll() al cargar la vista', async () => {
    const cattleSpy = vi.spyOn(CattleService, 'getAll');
    const result = await ReproductionService.getAll();

    expect(cattleSpy).toHaveBeenCalledTimes(1);
    expect(result.animals).toHaveLength(2);
    expect(result.source).toBe('cache');
  });
});
