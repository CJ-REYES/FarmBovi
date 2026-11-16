import type { Table } from 'dexie';
import { db } from '../../lib/database/db';
import type { BaseLocalEntity, LocalServerChange } from '../../lib/database/schema';

const destinations: Record<string, Table<BaseLocalEntity, string>> = {
  Animal: db.cattle as unknown as Table<BaseLocalEntity, string>,
  Lote: db.lots as unknown as Table<BaseLocalEntity, string>,
  EventoSanitario: db.healthRecords as unknown as Table<BaseLocalEntity, string>,
  Tratamiento: db.healthRecords as unknown as Table<BaseLocalEntity, string>,
  Alimentacion: db.feedingRecords as unknown as Table<BaseLocalEntity, string>,
  MovimientoAnimal: db.movements as unknown as Table<BaseLocalEntity, string>,
  Recordatorio: db.alerts as unknown as Table<BaseLocalEntity, string>,
};

const read = (data: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const key of keys) if (data[key] !== undefined) return data[key];
  return undefined;
};
const text = (value: unknown, fallback = ''): string => value == null ? fallback : String(value);
const date = (value: unknown, fallback: string): string => value ? new Date(String(value)).toISOString() : fallback;
const remoteId = (id: string): string | number => /^\d+$/.test(id) ? Number(id) : id;

async function localId(entity: string, id: unknown, table: Table<BaseLocalEntity, string>): Promise<string | undefined> {
  if (id == null) return undefined;
  const remote = remoteId(String(id));
  const rows = await table.where('remoteId').equals(remote).toArray();
  return rows.find(row => !row.remoteEntity || row.remoteEntity === entity)?.id;
}

export const RemoteChangeProjector = {
  tables: Object.values(destinations),

  async apply(change: LocalServerChange, now: string): Promise<boolean> {
    const table = destinations[change.entidad];
    if (!table) return false;
    const rid = remoteId(change.idRegistro);
    const matches = await table.where('remoteId').equals(rid).toArray();
    const current = matches.find(row => !row.remoteEntity || row.remoteEntity === change.entidad);

    if (change.operacion === 'eliminar') {
      if (current && (current.syncStatus === 'pending' || current.syncStatus === 'conflict')) return false;
      if (current) await table.update(current.id, { deletedAt: change.ocurrioEn, updatedAt: change.ocurrioEn, syncStatus: 'synced' });
      return true;
    }
    if (change.operacion !== 'crear' && change.operacion !== 'actualizar') return false;
    if (current && (current.syncStatus === 'pending' || current.syncStatus === 'conflict')) return false;

    let data: Record<string, unknown>;
    try { data = JSON.parse(change.datosJson) as Record<string, unknown>; }
    catch { return false; }
    const base: BaseLocalEntity = {
      id: current?.id ?? `server:${change.entidad}:${change.idRegistro}`,
      remoteId: rid,
      remoteEntity: change.entidad,
      ranchId: String(change.idRancho),
      createdAt: current?.createdAt ?? date(read(data, 'FechaCreacion', 'CreadoEn', 'fechaCreacion', 'creadoEn'), now),
      updatedAt: change.ocurrioEn,
      syncStatus: 'synced',
      serverVersion: read(data, 'VersionRegistro', 'versionRegistro') as number | string | undefined,
      deletedAt: null,
    };
    let mapped: Record<string, unknown>;
    switch (change.entidad) {
      case 'Animal': {
        const lotId = await localId('Lote', read(data, 'IdLote', 'idLote'), db.lots as unknown as Table<BaseLocalEntity, string>);
        mapped = { areteSiniiga: text(read(data, 'Arete', 'arete')), nombre: text(read(data, 'Nombre', 'nombre')) || undefined,
          raza: text(read(data, 'Raza', 'raza'), 'Sin especificar'), gender: text(read(data, 'Sexo', 'sexo'), 'No especificado'),
          fechaNacimiento: read(data, 'FechaNacimiento', 'fechaNacimiento') ? date(read(data, 'FechaNacimiento', 'fechaNacimiento'), now) : undefined, loteId: lotId };
        break;
      }
      case 'Lote': mapped = { nombre: text(read(data, 'Nombre', 'nombre'), `Lote ${change.idRegistro}`), capacidad: Number(read(data, 'Capacidad', 'capacidad') ?? 0), ubicacion: text(read(data, 'Ubicacion', 'ubicacion')) || undefined }; break;
      case 'EventoSanitario': {
        const cattleId = await localId('Animal', read(data, 'IdAnimal', 'idAnimal'), db.cattle as unknown as Table<BaseLocalEntity, string>);
        if (!cattleId) return false;
        mapped = { cattleId, tipo: text(read(data, 'Tipo', 'tipo'), 'Evento sanitario'), descripcion: text(read(data, 'Diagnostico', 'diagnostico', 'Observaciones', 'observaciones', 'Sintomas', 'sintomas')),
          fecha: date(read(data, 'Fecha', 'fecha'), now) };
        break;
      }
      case 'Tratamiento': {
        const eventId = await localId('EventoSanitario', read(data, 'IdEventoSanitario', 'idEventoSanitario'), db.healthRecords as unknown as Table<BaseLocalEntity, string>);
        const event = eventId ? await db.healthRecords.get(eventId) : undefined;
        if (!event || event.syncStatus === 'pending' || event.syncStatus === 'conflict') return false;
        mapped = { cattleId: (event as { cattleId: string }).cattleId, tipo: 'Tratamiento', descripcion: `${text(read(data, 'Producto', 'producto'))} ${text(read(data, 'Dosis', 'dosis'))} ${text(read(data, 'UnidadDosis', 'unidadDosis'))}`.trim(), fecha: date(read(data, 'FechaInicio', 'fechaInicio'), now) };
        break;
      }
      case 'Alimentacion': {
        const lotId = await localId('Lote', read(data, 'IdLote', 'idLote'), db.lots as unknown as Table<BaseLocalEntity, string>);
        mapped = { lotId, tipoAlimento: text(read(data, 'Alimento', 'alimento', 'Racion', 'racion'), 'Alimento'), cantidadKg: Number(read(data, 'Cantidad', 'cantidad') ?? 0), unidad: text(read(data, 'Unidad', 'unidad'), 'kg'), fecha: date(read(data, 'Inicio', 'inicio'), now) };
        break;
      }
      case 'MovimientoAnimal': {
        const cattleId = await localId('Animal', read(data, 'IdAnimal', 'idAnimal'), db.cattle as unknown as Table<BaseLocalEntity, string>);
        if (!cattleId) return false;
        const origin = await localId('Lote', read(data, 'IdLoteOrigen', 'idLoteOrigen'), db.lots as unknown as Table<BaseLocalEntity, string>);
        const destination = await localId('Lote', read(data, 'IdLoteDestino', 'idLoteDestino'), db.lots as unknown as Table<BaseLocalEntity, string>);
        mapped = { cattleId, origenLotId: origin, destinoLotId: destination, fecha: date(read(data, 'Fecha', 'fecha'), now), motivo: text(read(data, 'Motivo', 'motivo', 'Tipo', 'tipo')) };
        break;
      }
      case 'Recordatorio': mapped = { tipo: text(read(data, 'Tipo', 'tipo'), 'Recordatorio'), prioridad: 'media', mensaje: text(read(data, 'Descripcion', 'descripcion')),
        leida: ['Completado', 'Cancelado'].includes(text(read(data, 'Estado', 'estado'))), fecha: date(read(data, 'FechaProgramada', 'fechaProgramada'), now) }; break;
      default: return false;
    }
    await table.put({ ...base, ...mapped } as BaseLocalEntity);
    return true;
  },
};
