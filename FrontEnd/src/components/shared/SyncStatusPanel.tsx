import { useState, useEffect, useCallback } from 'react';
import { SyncEngine } from '../../services/sync/sync-engine';
import { db } from '../../lib/database/db';
import type { LocalOutboxQueue, OutboxOperationState } from '../../lib/database/schema';
import { authApi } from '../../lib/api';
import {
  RefreshCw,
  CloudCheck,
  Clock,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2
} from 'lucide-react';

const STATE_LABELS: Record<OutboxOperationState, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  confirmado: 'Confirmado',
  fallido: 'Error temporal',
  conflicto: 'Conflicto'
};

const STATE_BADGE_CLASSES: Record<OutboxOperationState, string> = {
  pendiente: 'bg-status-warning/10 text-status-warning',
  en_proceso: 'bg-brand-primary/10 text-brand-primary',
  confirmado: 'bg-status-success/10 text-status-success',
  fallido: 'bg-status-error/10 text-status-error',
  conflicto: 'bg-purple-500/10 text-purple-700'
};

export default function SyncStatusPanel() {
  const [pendingOps, setPendingOps] = useState<LocalOutboxQueue[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Sin sincronizar');

  const loadPending = useCallback(async () => {
    try {
      const allOps = await db.outbox.orderBy('fechaCreacion').toArray();
      const activeOps = allOps.filter((op) => op.estado !== 'confirmado');
      setPendingOps(activeOps);

      const checkpoint = await db.syncCheckpoints.get(`serverChanges:${authApi.userId()}`);
      if (checkpoint?.ultimaFechaServidor) {
        setLastSyncTime(new Date(checkpoint.ultimaFechaServidor).toLocaleTimeString());
      } else {
        const meta = await db.syncMetadata.get('cattle');
        if (meta?.lastSyncedAt) {
          setLastSyncTime(new Date(meta.lastSyncedAt).toLocaleTimeString());
        }
      }
    } catch (err) {
      console.error('Error cargando estado de sincronización:', err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPending();
    const interval = window.setInterval(() => {
      void loadPending();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loadPending]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await SyncEngine.sync();
      await loadPending();
    } finally {
      setIsSyncing(false);
    }
  };

  const renderOperationIcon = (estado: OutboxOperationState) => {
    switch (estado) {
      case 'fallido':
        return <AlertTriangle size={16} className="text-status-error shrink-0" />;
      case 'conflicto':
        return <AlertOctagon size={16} className="text-purple-600 shrink-0" />;
      case 'en_proceso':
        return <RefreshCw size={16} className="text-brand-primary animate-spin shrink-0" />;
      case 'confirmado':
        return <CheckCircle2 size={16} className="text-status-success shrink-0" />;
      case 'pendiente':
      default:
        return <Clock size={16} className="text-status-warning shrink-0" />;
    }
  };

  return (
    <div className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border-light pb-3">
        <div>
          <h3 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
            <CloudCheck size={18} className="text-brand-primary" /> Centro de Sincronización
          </h3>
          <p className="text-[12px] text-brand-slate/60">Última sincronización confirmada: {lastSyncTime}</p>
        </div>
        <button
          onClick={handleManualSync}
          disabled={isSyncing}
          className="flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
        </button>
      </div>

      <div className="space-y-2">
        <h4 className="text-[12px] font-bold text-brand-slate/70 uppercase tracking-wider">
          Operaciones en Cola ({pendingOps.length})
        </h4>
        {pendingOps.length === 0 ? (
          <div className="p-4 bg-surface-secondary/40 rounded-lg text-center text-[13px] text-brand-slate/60">
            Sin operaciones pendientes en la cola local.
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
            {pendingOps.map((op) => (
              <div
                key={op.idOperacion}
                className="flex items-center justify-between p-2.5 bg-surface-secondary/60 rounded-lg border border-border-light text-[13px]"
              >
                <div className="flex items-center gap-2.5">
                  {renderOperationIcon(op.estado)}
                  <div>
                    <p className="font-semibold text-brand-slate uppercase text-[11px]">
                      {op.tipoOperacion} : {op.entidad}
                    </p>
                    <p className="text-[11px] text-brand-slate/60">
                      Intentos: {op.intentos} {op.ultimoError ? `(${op.ultimoError})` : ''}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${STATE_BADGE_CLASSES[op.estado]}`}
                >
                  {STATE_LABELS[op.estado]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
