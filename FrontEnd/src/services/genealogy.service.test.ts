import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/database/db';
import { OutboxRepository } from '../lib/database/repositories/outbox.repository';
import { CattleService } from './cattle.service';
import { GenealogyService, GenealogyValidationError } from './genealogy.service';

const RANCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FATHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MOTHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CALF_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function seedAnimals() {
  const now = new Date().toISOString();
  await db.cattle.bulkPut([
    {
      id: FATHER_ID,
      remoteId: FATHER_ID,
      ranchId: RANCH_ID,
      arete: 'MX-PAD-01',
      areteSiniiga: 'MX-PAD-01',
      raza: 'Brahman',
      sexo: 'Macho',
      gender: 'Macho',
      fechaNacimiento: '2020-01-01',
      fechaIngreso: '2020-02-01',
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
      id: MOTHER_ID,
      remoteId: MOTHER_ID,
      ranchId: RANCH_ID,
      arete: 'MX-MAD-02',
      areteSiniiga: 'MX-MAD-02',
      raza: 'Holstein',
      sexo: 'Hembra',
      gender: 'Hembra',
      fechaNacimiento: '2020-03-01',
      fechaIngreso: '2020-04-01',
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
      id: CALF_ID,
      remoteId: CALF_ID,
      ranchId: RANCH_ID,
      arete: 'MX-CRI-03',
      areteSiniiga: 'MX-CRI-03',
      raza: 'Cruza',
      sexo: 'Hembra',
      gender: 'Hembra',
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

describe('GenealogyService — Persistencia local, anti-duplicados y sin simulación de Backend', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.genealogy.clear();
    await db.cattle.clear();
    await db.outbox.clear();
    await seedAnimals();
  });

  it('crea vínculo único, bloquea duplicados, edita y desactiva en IndexedDB + outbox sin simular fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const created = await GenealogyService.create({
      idAnimal: CALF_ID,
      idPadre: FATHER_ID,
      idMadre: null
    });

    expect(created.synced).toBe(false);
    expect(created.record.idPadre).toBe(FATHER_ID);
    expect(created.record.idMadre).toBeNull();
    expect(created.record.syncStatus).toBe('pending');
    expect(fetchSpy).not.toHaveBeenCalled();

    const outboxOps = await OutboxRepository.getByEntity('genealogy', created.record.id);
    expect(outboxOps).toHaveLength(1);
    expect(outboxOps[0].tipoOperacion).toBe('CREATE');

    // Bloquea relación duplicada para el mismo animal
    await expect(
      GenealogyService.create({
        idAnimal: CALF_ID,
        idPadre: FATHER_ID,
        idMadre: MOTHER_ID
      })
    ).rejects.toBeInstanceOf(GenealogyValidationError);

    // Edición agrega la madre y conserva idAnimal inmutable
    const updated = await GenealogyService.update(created.record.id, {
      idAnimal: FATHER_ID,
      idPadre: FATHER_ID,
      idMadre: MOTHER_ID
    });
    expect(updated.synced).toBe(false);
    expect(updated.record.idAnimal).toBe(CALF_ID);
    expect(updated.record.idMadre).toBe(MOTHER_ID);

    // Desactivación lógica
    const deactivated = await GenealogyService.deactivate(created.record.id);
    expect(deactivated.synced).toBe(false);

    const active = await GenealogyService.getAll({ includeDeleted: false });
    expect(active.records).toHaveLength(0);
    expect(active.backendNotice).toMatch(/Genealogia/i);
  });

  it('hidrata animales reales desde CattleService.getAll() al consultar', async () => {
    const cattleSpy = vi.spyOn(CattleService, 'getAll');
    const result = await GenealogyService.getAll();
    expect(cattleSpy).toHaveBeenCalledTimes(1);
    expect(result.animals).toHaveLength(3);
  });
});
