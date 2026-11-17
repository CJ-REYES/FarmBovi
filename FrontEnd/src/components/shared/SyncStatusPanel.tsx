import { useState, useEffect, useCallback } from 'react';
import { SyncHttpClient } from '../../services/sync/sync-http.client';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { db } from '../../lib/database/db';
import { useSyncStatus } from '../../hooks/useSyncStatus';
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
  Database,
  WifiOff,
  FileImage
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
  const {
    state,
    stateLabel,
    statusDetail,
    isOnline,
    isSyncing,
    counts,
    lastCompletedSyncAt,
    triggerManualSync,
    refreshStatus
  } = useSyncStatus();

  const [pendingOps, setPendingOps] = useState<LocalOutboxQueue[]>([]);
  const [checkpoints, setCheckpoints] = useState<LocalSyncCheckpoint[]>([]);
  const [retryingOpId, setRetryingOpId] = useState<string | null>(null);

  const availability = SyncHttpClient.getEndpointAvailability();

  const reloadPending = useCallback(async () => {
    try {
      const [allOps, allCheckpoints] = await Promise.all([
        db.outbox.orderBy('fechaCreacion').toArray(),
        db.syncCheckpoints.toArray()
      ]);

      setPendingOps(allOps.filter((op) => op.estado !== 'confirmado'));
      setCheckpoints(allCheckpoints);
      await refreshStatus();
    } catch (err) {
      console.error('Error cargando estado de sincronización:', err);
    }
  }, [refreshStatus]);

  useEffect(() => {
    let active = true;

    const syncView = async () => {
      try {
        const [allOps, allCheckpoints] = await Promise.all([
          db.outbox.orderBy('fechaCreacion').toArray(),
          db.syncCheckpoints.toArray()
        ]);

        if (!active) return;
        setPendingOps(allOps.filter((op) => op.estado !== 'confirmado'));
        setCheckpoints(allCheckpoints);
      } catch (err) {
        console.error('Error cargando estado de sincronización:', err);
      }
    };

    void syncView();
    const interval = window.setInterval(() => {
      void syncView();
    }, 4000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleManualSync = async () => {
    await triggerManualSync();
    await reloadPending();
  };

  const handleManualRetryOp = async (idOperacion: string) => {
    setRetryingOpId(idOperacion);
    try {
      await OutboxRepository.resetForManualRetry(idOperacion);
      await triggerManualSync();
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

  const formattedLastSync = lastCompletedSyncAt
    ? new Date(lastCompletedSyncAt).toLocaleTimeString()
    : 'Aún sin ciclo completo confirmado';

  return (
    <div className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-4">
      {/* Encabezado con estado global real */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-light pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
              {isOnline ? (
                <CloudCheck size={18} className="text-brand-primary" />
              ) : (
                <WifiOff size={18} className="text-brand-slate/70" />
              )}
              Centro de Sincronización
            </h3>
            <span
              className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                state === 'synced'
                  ? 'bg-status-success/15 text-status-success'
                  : state === 'conflict'
                    ? 'bg-purple-500/15 text-purple-700'
                    : state === 'error'
                      ? 'bg-status-error/15 text-status-error'
                      : state === 'syncing'
                        ? 'bg-brand-primary/15 text-brand-primary'
                        : state === 'offline'
                          ? 'bg-brand-slate/15 text-brand-slate'
                          : 'bg-status-warning/15 text-amber-800'
              }`}
            >
              {stateLabel}
            </span>
          </div>
          <p className="text-[12px] text-brand-slate/75">{statusDetail}</p>
          <p className="text-[11px] text-brand-slate/55">
            Última sincronización completa (Push + Pull): {formattedLastSync}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleManualSync()}
          disabled={isSyncing || !isOnline}
          className="inline-flex items-center justify-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
        </button>
      </div>

      {/* Métricas de operaciones pendientes y archivos pendientes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium">Operaciones pendientes</p>
          <p className="text-[18px] font-bold text-brand-slate mt-0.5">
            {counts.pendingOperationsCount}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium flex items-center gap-1">
            <FileImage size={12} /> Archivos pendientes
          </p>
          <p className="text-[18px] font-bold text-brand-slate mt-0.5">
            {counts.pendingFilesCount}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium">Conflictos activos</p>
          <p className="text-[18px] font-bold text-purple-700 mt-0.5">
            {counts.pendingConflictsCount}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium">Con error / detenidos</p>
          <p className="text-[18px] font-bold text-status-error mt-0.5">
            {counts.failedOperationsCount + counts.failedFilesCount}
          </p>
        </div>
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
            ). Los cambios locales y archivos multimedia se conservan de forma segura en IndexedDB sin marcarse como sincronizados hasta recibir confirmación real.
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
