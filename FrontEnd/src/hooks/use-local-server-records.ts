import { useEffect, useState } from 'react';
import type { Table } from 'dexie';
import type { BaseLocalEntity } from '../lib/database/schema';

export function useLocalServerRecords<T extends BaseLocalEntity>(table: Table<T, string>): T[] {
  const [records, setRecords] = useState<T[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => { void table.toArray().then(rows => { if (active) setRecords(rows.filter(row => !row.deletedAt)); }); };
    load();
    window.addEventListener('farmbovi:changes-applied', load);
    return () => { active = false; window.removeEventListener('farmbovi:changes-applied', load); };
  }, [table]);
  return records;
}
