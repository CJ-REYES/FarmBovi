import { useState, useEffect, useCallback } from 'react';
import { SyncEngine } from '../../services/sync/sync-engine';
import { db } from '../../lib/database/db';
import type { LocalOutboxQueue } from '../../lib/database/schema';
import { RefreshCw, CloudCheck, Clock, AlertTriangle } from 'lucide-react';

export default function SyncStatusPanel() {
  const [pendingOps, setPendingOps] = useState<LocalOutboxQueue[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Nunca');

  const loadPending = useCallback(async () => {
    try {
      const ops = await db.outbox.toArray();
      setPendingOps(ops);
      const meta = await db.syncMetadata.get('cattle');
      if (meta?.lastSyncedAt) {
        setLastSyncTime(new Date(meta.lastSyncedAt).toLocaleTimeString());
      }
    } catch (err) {
      console.error('Error cargando estado de sincronización:', err);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPending();
    const interval = window.setInterval(loadPending, 5000);
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

  return (
    <div className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border-light pb-3">
        <div>
          <h3 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
            <CloudCheck size={18} className="text-brand-primary" /> Centro de Sincronización
          </h3>
          <p className="text-[12px] text-brand-slate/60">Última sincronización exitosa: {lastSyncTime}</p>
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
        <h4 className="text-[12px] font-bold text-brand-slate/70 uppercase tracking-wider">Operaciones en Cola ({pendingOps.length})</h4>
        {pendingOps.length === 0 ? (
          <div className="p-4 bg-surface-secondary/40 rounded-lg text-center text-[13px] text-brand-slate/60">
            Todo al día. No hay cambios pendientes de subida.
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
            {pendingOps.map((op) => (
              <div key={op.id} className="flex items-center justify-between p-2.5 bg-surface-secondary/60 rounded-lg border border-border-light text-[13px]">
                <div className="flex items-center gap-2.5">
                  {op.status === 'failed' ? (
                    <AlertTriangle size={16} className="text-status-error shrink-0" />
                  ) : op.status === 'syncing' ? (
                    <RefreshCw size={16} className="text-brand-primary animate-spin shrink-0" />
                  ) : (
                    <Clock size={16} className="text-status-warning shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold text-brand-slate uppercase text-[11px]">{op.operation} : {op.entity}</p>
                    <p className="text-[11px] text-brand-slate/60">Intentos: {op.attempts} {op.lastError ? `(${op.lastError})` : ''}</p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                  op.status === 'failed' ? 'bg-status-error/10 text-status-error' : 'bg-status-warning/10 text-status-warning'
                }`}>
                  {op.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
