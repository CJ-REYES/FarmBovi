import { useState, useEffect, useCallback } from 'react';
import { SyncEngine } from '../../services/sync/sync-engine';
import { SyncHttpClient } from '../../services/sync/sync-http.client';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { db } from '../../lib/database/db';
import type {
  LocalOutboxQueue,
  LocalSyncCheckpoint,
  OutboxOperationState
} from '../../lib/database/schema';
import {
  RefreshCw,
  CloudCheck,
  Clock,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  RotateCcw,
  Info,
  Database
} from 'lucide-react';
import SyncConflictsPanel from './SyncConflictsPanel';

const STATE_LABELS: Record<OutboxOperationState, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  confirmado: 'Confirmado',
  fallido: 'Error / Detenido',
  conflicto: 'Conflicto versión'
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
  const [checkpoints, setCheckpoints] = useState<LocalSyncCheckpoint[]>([]);
  const [pendingConflictsCount, setPendingConflictsCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Sin sincronizar');
  const [retryingOpId, setRetryingOpId] = useState<string | null>(null);

  const availability = SyncHttpClient.getEndpointAvailability();

  const reloadPending = useCallback(async () => {
    try {
      const [allOps, allCheckpoints, conflictsCount] = await Promise.all([
        db.outbox.orderBy('fechaCreacion').toArray(),
        db.syncCheckpoints.toArray(),
        db.syncConflicts.where('estadoResolucion').equals('pendiente').count()
      ]);

      setPendingOps(allOps.filter((op) => op.estado !== 'confirmado'));
      setCheckpoints(allCheckpoints);
      setPendingConflictsCount(conflictsCount);

      const cattleCp = allCheckpoints.find((cp) => cp.entidad === 'cattle');
      if (cattleCp?.ultimaFechaServidor) {
        setLastSyncTime(new Date(cattleCp.ultimaFechaServidor).toLocaleTimeString());
      } else if (cattleCp?.actualizadoEn) {
        setLastSyncTime(new Date(cattleCp.actualizadoEn).toLocaleTimeString());
      }
    } catch (err) {
      console.error('Error cargando estado de sincronización:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const syncView = async () => {
      try {
        const [allOps, allCheckpoints, conflictsCount] = await Promise.all([
          db.outbox.orderBy('fechaCreacion').toArray(),
          db.syncCheckpoints.toArray(),
          db.syncConflicts.where('estadoResolucion').equals('pendiente').count()
        ]);

        if (!active) return;
        setPendingOps(allOps.filter((op) => op.estado !== 'confirmado'));
        setCheckpoints(allCheckpoints);
        setPendingConflictsCount(conflictsCount);

        const cattleCp = allCheckpoints.find((cp) => cp.entidad === 'cattle');
        if (cattleCp?.ultimaFechaServidor) {
          setLastSyncTime(new Date(cattleCp.ultimaFechaServidor).toLocaleTimeString());
        } else if (cattleCp?.actualizadoEn) {
          setLastSyncTime(new Date(cattleCp.actualizadoEn).toLocaleTimeString());
        }
      } catch (err) {
        console.error('Error cargando estado de sincronización:', err);
      }
    };

    void syncView();
    const interval = window.setInterval(() => {
      void syncView();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await SyncEngine.sync();
      await reloadPending();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleManualRetryOp = async (idOperacion: string) => {
    setRetryingOpId(idOperacion);
    try {
      await OutboxRepository.resetForManualRetry(idOperacion);
      await SyncEngine.sync();
      await reloadPending();
    } finally {
      setRetryingOpId(null);
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
          <p className="text-[12px] text-brand-slate/60">
            Última actualización confirmada: {lastSyncTime}
            {pendingConflictsCount > 0 ? ` • Conflictos pendientes: ${pendingConflictsCount}` : ''}
          </p>
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

      {(!availability.pushDisponible || !availability.pullDisponible) && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[12px] text-brand-slate">
          <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <span>
            Endpoints incrementales pendientes en el backend (
            {!availability.pushDisponible && !availability.pullDisponible
              ? 'Push y Pull'
              : !availability.pushDisponible
                ? 'Push'
                : 'Pull'}
            ). Los cambios locales y cursores opacos se conservan de forma segura en IndexedDB.
          </span>
        </div>
      )}

      {checkpoints.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[12px] font-bold text-brand-slate/70 uppercase tracking-wider flex items-center gap-1.5">
            <Database size={13} /> Checkpoints de Descarga ({checkpoints.length})
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {checkpoints.map((cp) => (
              <div
                key={cp.entidad}
                className="px-3 py-2 rounded-lg bg-surface-secondary/40 border border-border-light text-[11px] flex items-center justify-between gap-2"
              >
                <span className="font-semibold text-brand-slate uppercase">{cp.entidad}</span>
                <span className="font-mono text-brand-slate/65 truncate max-w-[160px]">
                  {cp.cursorOpaco ? `cursor:${cp.cursorOpaco.slice(0, 14)}…` : 'cursor: inicial'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-[12px] font-bold text-brand-slate/70 uppercase tracking-wider">
          Operaciones en Cola ({pendingOps.length})
        </h4>
        {pendingOps.length === 0 ? (
          <div className="p-4 bg-surface-secondary/40 rounded-lg text-center text-[13px] text-brand-slate/60">
            Sin operaciones pendientes en la cola local.
          </div>
        ) : (
          <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
            {pendingOps.map((op) => {
              const isValidationOrStopped = op.estado === 'fallido' && op.proximoIntento === null;
              return (
                <div
                  key={op.idOperacion}
                  className="flex items-center justify-between gap-3 p-2.5 bg-surface-secondary/60 rounded-lg border border-border-light text-[13px]"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5">{renderOperationIcon(op.estado)}</div>
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-slate uppercase text-[11px]">
                        {op.tipoOperacion} : {op.entidad}
                      </p>
                      <p className="text-[11px] text-brand-slate/65 break-words">
                        Intentos: {op.intentos}
                        {op.ultimoError ? ` — ${op.ultimoError}` : ''}
                      </p>
                      {op.proximoIntento && op.estado === 'fallido' && (
                        <p className="text-[10px] text-brand-slate/50">
                          Próximo reintento: {new Date(op.proximoIntento).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isValidationOrStopped && (
                      <button
                        type="button"
                        onClick={() => void handleManualRetryOp(op.idOperacion)}
                        disabled={retryingOpId === op.idOperacion}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-light bg-surface-white hover:bg-surface-secondary text-[11px] font-semibold text-brand-slate disabled:opacity-50"
                        title="Reintentar operación con el mismo idOperacion"
                      >
                        <RotateCcw
                          size={12}
                          className={retryingOpId === op.idOperacion ? 'animate-spin' : ''}
                        />
                        Reintentar
                      </button>
                    )}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${STATE_BADGE_CLASSES[op.estado]}`}
                    >
                      {STATE_LABELS[op.estado]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <SyncConflictsPanel onConflictResolved={reloadPending} />
    </div>
  );
}
