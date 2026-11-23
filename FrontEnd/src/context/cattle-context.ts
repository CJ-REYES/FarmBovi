import { createContext } from 'react';
import type { Cattle, CattleInput, LotOption, RanchOption } from '../types/cattle';
import type { CattleMutationResult } from '../services/cattle.service';

export interface CattleContextType {
  cattle: Cattle[];
  ranches: RanchOption[];
  lots: LotOption[];
  loading: boolean;
  source: 'cache' | 'server' | 'unavailable';
  error: string | null;
  apiWarning: string | null;
  refresh: (options?: { ranchId?: string; includeDeleted?: boolean }) => Promise<void>;
  getById: (id: string) => Promise<Cattle | undefined>;
  create: (data: CattleInput) => Promise<CattleMutationResult>;
  update: (id: string, data: CattleInput) => Promise<CattleMutationResult>;
  registerExit: (
    id: string,
    params: { estado: 'Vendido' | 'Baja'; fechaSalida: string; observaciones?: string | null }
  ) => Promise<CattleMutationResult>;
  deactivate: (id: string) => Promise<{ synced: boolean; syncMessage?: string }>;
}

export const CattleContext = createContext<CattleContextType | undefined>(undefined);
