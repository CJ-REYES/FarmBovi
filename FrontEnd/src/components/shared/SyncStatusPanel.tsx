import { useState, useEffect, useCallback } from 'react';
import { SyncHttpClient } from '../../services/sync/sync-http.client';
import { OutboxRepository } from '../../lib/database/repositories/outbox.repository';
import { SyncMetadataRepository } from '../../lib/database/repositories/sync-metadata.repository';
import { db } from '../../lib/database/db';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { usePwaUpdate } from '../../hooks/usePwaUpdate';
import {
  OfflineInventoryService,
  type OfflineInventorySnapshot
} from '../../services/offline-inventory.service';
import type {
  LocalOutboxQueue,
  LocalSyncCheckpoint,
  LocalSyncMetadata,
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
  FileImage,
  HardDrive,
  ShieldCheck,
  Trash2
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
    lastCycleResult,
    triggerManualSync,
    retryFailedOperations,
    refreshStatus
  } = useSyncStatus();

  const { updateAvailable, offlineReady, swVersion, applyUpdate } = usePwaUpdate();

  const [pendingOps, setPendingOps] = useState<LocalOutboxQueue[]>([]);
  const [checkpoints, setCheckpoints] = useState<LocalSyncCheckpoint[]>([]);
  const [entityErrors, setEntityErrors] = useState<LocalSyncMetadata[]>([]);
  const [inventory, setInventory] = useState<OfflineInventorySnapshot | null>(null);
  const [retryingOpId, setRetryingOpId] = useState<string | null>(null);
  const [discardingOpId, setDiscardingOpId] = useState<string | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState<boolean>(false);
  const [isDiscardingAll, setIsDiscardingAll] = useState<boolean>(false);

  const availability = SyncHttpClient.getEndpointAvailability();

  const reloadPending = useCallback(async () => {
    try {
      const [allOps, allCheckpoints, inv, errors] = await Promise.all([
        db.outbox.orderBy('fechaCreacion').toArray(),
        db.syncCheckpoints.toArray(),
        OfflineInventoryService.getSnapshot(),
        SyncMetadataRepository.getEntitiesWithErrors()
      ]);

      setPendingOps(allOps.filter((op) => op.estado !== 'confirmado'));
      setCheckpoints(allCheckpoints);
      setInventory(inv);
      setEntityErrors(errors);
      await refreshStatus();
    } catch (err) {
      console.error('Error cargando estado de sincronización:', err);
    }
  }, [refreshStatus]);

  useEffect(() => {
    let active = true;

    const syncView = async () => {
      try {
        const [allOps, allCheckpoints, inv, errors] = await Promise.all([
          db.outbox.orderBy('fechaCreacion').toArray(),
          db.syncCheckpoints.toArray(),
          OfflineInventoryService.getSnapshot(),
          SyncMetadataRepository.getEntitiesWithErrors()
        ]);

        if (!active) return;
        setPendingOps(allOps.filter((op) => op.estado !== 'confirmado'));
        setCheckpoints(allCheckpoints);
        setInventory(inv);
        setEntityErrors(errors);
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

  const handleRetryAllFailed = async () => {
    setIsRetryingAll(true);
    try {
      await retryFailedOperations();
      await reloadPending();
    } finally {
      setIsRetryingAll(false);
    }
  };

  const handleDiscardAllFailed = async () => {
    setIsDiscardingAll(true);
    try {
      await OutboxRepository.discardAllFailedOperations();
      await reloadPending();
    } finally {
      setIsDiscardingAll(false);
    }
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

  const handleDiscardOp = async (idOperacion: string) => {
    setDiscardingOpId(idOperacion);
    try {
      await OutboxRepository.discardOperation(idOperacion);
      await reloadPending();
    } finally {
      setDiscardingOpId(null);
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
    ? new Date(lastCompletedSyncAt).toLocaleString()
    : 'Aún sin ciclo completo confirmado';

  const pullAppliedTotal = lastCycleResult
    ? lastCycleResult.pull.reduce((acc, item) => acc + item.appliedCount, 0)
    : 0;
  const pullDeletedTotal = lastCycleResult
    ? lastCycleResult.pull.reduce((acc, item) => acc + item.deletedCount, 0)
    : 0;

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
          {lastCycleResult && (
            <p className="text-[11px] text-brand-slate/65">
              Último ciclo · Push: {lastCycleResult.push.confirmedCount} confirmada(s)
              {lastCycleResult.push.alreadyProcessedCount > 0
                ? ` (${lastCycleResult.push.alreadyProcessedCount} duplicada(s))`
                : ''}{' '}
              · Pull: {pullAppliedTotal} actualizada(s), {pullDeletedTotal} eliminada(s)
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {counts.failedOperationsCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => void handleRetryAllFailed()}
                disabled={isSyncing || isRetryingAll || isDiscardingAll || !isOnline}
                className="inline-flex items-center justify-center gap-1.5 bg-surface-white border border-status-error/40 text-status-error hover:bg-status-error/10 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw size={14} className={isRetryingAll ? 'animate-spin' : ''} />
                Reintentar fallidas ({counts.failedOperationsCount})
              </button>
              <button
                type="button"
                onClick={() => void handleDiscardAllFailed()}
                disabled={isSyncing || isDiscardingAll || isRetryingAll}
                className="inline-flex items-center justify-center gap-1.5 bg-status-error/10 border border-status-error/30 text-status-error hover:bg-status-error/20 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                title="Descartar todas las operaciones fallidas y sus operaciones huérfanas dependientes"
              >
                <Trash2 size={14} />
                Descartar fallidas ({counts.failedOperationsCount})
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void handleManualSync()}
            disabled={isSyncing || !isOnline}
            className="inline-flex items-center justify-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
          </button>
        </div>
      </div>

      {/* Indicador explícito de sincronización activa */}
      {isSyncing && (
        <div
          role="status"
          aria-live="polite"
          className="p-3 rounded-lg bg-brand-primary/10 border border-brand-primary/30 text-brand-forest text-[12px] font-semibold flex items-center gap-2"
        >
          <RefreshCw size={15} className="animate-spin text-brand-primary shrink-0" />
          <span>
            Sincronización activa en curso: enviando operaciones Push y descargando cambios Pull…
          </span>
        </div>
      )}

      {/* Métricas completas de sincronización (FE-05) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium">Operaciones pendientes</p>
          <p className="text-[18px] font-bold text-brand-slate mt-0.5">
            {counts.pendingOperationsCount}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium flex items-center gap-1">
            <CheckCircle2 size={12} className="text-status-success" /> Operaciones exitosas
          </p>
          <p className="text-[18px] font-bold text-status-success mt-0.5">
            {counts.confirmedOperationsCount}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium">Operaciones fallidas</p>
          <p className="text-[18px] font-bold text-status-error mt-0.5">
            {counts.failedOperationsCount + counts.failedFilesCount}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-secondary/50 border border-border-light">
          <p className="text-[11px] text-brand-slate/65 font-medium">Conflictos activos</p>
          <p className="text-[18px] font-bold text-purple-700 mt-0.5">
            {counts.pendingConflictsCount}
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
      </div>

      {/* Indicador de datos disponibles localmente en IndexedDB y estado PWA */}
      {inventory && (
        <div className="p-3.5 rounded-lg bg-surface-app/45 border border-border-light space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[12px] font-bold text-brand-forest uppercase tracking-wider flex items-center gap-1.5">
              <HardDrive size={14} className="text-brand-primary" />
              Datos Disponibles Localmente ({inventory.totalLocalRecords})
            </h4>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  inventory.isStoragePersisted
                    ? 'bg-status-success/15 text-status-success'
                    : 'bg-brand-slate/10 text-brand-slate/75'
                }`}
              >
                <ShieldCheck size={11} />
                {inventory.isStoragePersisted ? 'Persistencia protegida' : 'IndexedDB activo'}
              </span>
              {offlineReady && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-primary/10 text-brand-primary">
                  App lista offline{swVersion ? ` · ${swVersion}` : ''}
                </span>
              )}
              {updateAvailable && (
                <button
                  type="button"
                  onClick={() => applyUpdate(false)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-primary text-white hover:bg-brand-dark"
                >
                  Aplicar actualización PWA
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px] text-brand-slate/80">
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Bovinos: <strong>{inventory.counts.cattle}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Potreros: <strong>{inventory.counts.lots}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Pesajes: <strong>{inventory.counts.weighings}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Movimientos: <strong>{inventory.counts.movements}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Alimentación: <strong>{inventory.counts.feedingRecords}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Salud / Trat.:{' '}
              <strong>
                {inventory.counts.healthRecords + inventory.counts.treatments}
              </strong>
            </span>
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Reproducción: <strong>{inventory.counts.reproductionRecords}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-surface-white border border-border-light">
              Alertas: <strong>{inventory.counts.alerts}</strong>
            </span>
          </div>

          {inventory.storageWarning && (
            <p className="text-[11px] font-semibold text-status-danger">
              Advertencia: el almacenamiento local supera el {inventory.storageUsagePercentage}% de
              la cuota del navegador.
            </p>
          )}
        </div>
      )}

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
            {checkpoints.map((cp) => {
              const ranchCount = cp.cursorsByRanch ? Object.keys(cp.cursorsByRanch).length : 0;
              return (
                <div
                  key={cp.entidad}
                  className="px-3 py-2 rounded-lg bg-surface-secondary/40 border border-border-light text-[11px] flex items-center justify-between gap-2"
                >
                  <span className="font-semibold text-brand-slate uppercase">
                    {cp.entidad}
                    {ranchCount > 1 ? ` (${ranchCount} ranchos)` : ''}
                  </span>
                  <span className="font-mono text-brand-slate/65 truncate max-w-[160px]">
                    {cp.cursorOpaco ? `cursor:${cp.cursorOpaco.slice(0, 14)}…` : 'cursor: inicial'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {entityErrors.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[12px] font-bold text-status-error uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle size={13} /> Errores Registrados por Entidad ({entityErrors.length})
          </h4>
          <div className="space-y-1.5">
            {entityErrors.map((meta) => (
              <div
                key={meta.entityName}
                className="px-3 py-2 rounded-lg bg-status-error/5 border border-status-error/25 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-1"
              >
                <div className="min-w-0">
                  <span className="font-bold text-status-error uppercase">
                    {meta.entityName}
                    {meta.lastErrorPhase ? ` · ${meta.lastErrorPhase}` : ''}
                    {meta.lastErrorCode !== null && meta.lastErrorCode !== undefined
                      ? ` (HTTP ${meta.lastErrorCode})`
                      : ''}
                  </span>
                  <p className="text-brand-slate/80 break-words">{meta.lastError}</p>
                </div>
                <div className="text-[10px] text-brand-slate/60 shrink-0">
                  {meta.consecutiveFailures ? `${meta.consecutiveFailures} fallo(s)` : ''}
                  {meta.lastErrorAt
                    ? ` · ${new Date(meta.lastErrorAt).toLocaleTimeString()}`
                    : ''}
                </div>
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
              const isRetryableFailed = op.estado === 'fallido';
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
                      <p
                        className="text-[10px] font-mono text-brand-slate/55"
                        title={`ID Operación: ${op.idOperacion}`}
                      >
                        Op: {op.idOperacion.slice(0, 8)}… · {new Date(op.fechaCreacion).toLocaleString()}
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
                    {isRetryableFailed && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleManualRetryOp(op.idOperacion)}
                          disabled={retryingOpId === op.idOperacion || discardingOpId === op.idOperacion || !isOnline}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-light bg-surface-white hover:bg-surface-secondary text-[11px] font-semibold text-brand-slate disabled:opacity-50 cursor-pointer"
                          title="Reintentar operación con el mismo idOperacion"
                        >
                          <RotateCcw
                            size={12}
                            className={retryingOpId === op.idOperacion ? 'animate-spin' : ''}
                          />
                          Reintentar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDiscardOp(op.idOperacion)}
                          disabled={discardingOpId === op.idOperacion || retryingOpId === op.idOperacion}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-status-error/30 bg-status-error/5 hover:bg-status-error/15 text-[11px] font-semibold text-status-error disabled:opacity-50 cursor-pointer"
                          title="Descartar operación fallida de la cola local"
                        >
                          <Trash2 size={12} />
                          Descartar
                        </button>
                      </>
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
