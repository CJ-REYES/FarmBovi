import {
  WifiOff,
  RefreshCw,
  CloudCheck,
  Clock,
  AlertOctagon,
  AlertTriangle
} from 'lucide-react';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import type { GlobalSyncState } from '../../services/sync/sync-scheduler';

const BADGE_STYLES: Record<GlobalSyncState, string> = {
  offline: 'bg-brand-slate/10 text-brand-slate border-brand-slate/20',
  syncing: 'bg-brand-primary/10 text-brand-primary border-brand-primary/30',
  conflict: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
  error: 'bg-status-error/10 text-status-error border-status-error/30',
  pending: 'bg-status-warning/15 text-amber-800 border-amber-500/30',
  synced: 'bg-status-success/10 text-status-success border-status-success/30'
};

export interface SyncStatusBadgeProps {
  onOpenPanel?: () => void;
}

export default function SyncStatusBadge({ onOpenPanel }: SyncStatusBadgeProps) {
  const { state, stateLabel, counts, isSyncing } = useSyncStatus();

  const renderIcon = () => {
    switch (state) {
      case 'offline':
        return <WifiOff size={14} className="shrink-0" />;
      case 'syncing':
        return <RefreshCw size={14} className="animate-spin shrink-0" />;
      case 'conflict':
        return <AlertOctagon size={14} className="shrink-0" />;
      case 'error':
        return <AlertTriangle size={14} className="shrink-0" />;
      case 'synced':
        return <CloudCheck size={14} className="shrink-0" />;
      case 'pending':
      default:
        return <Clock size={14} className="shrink-0" />;
    }
  };

  return (
    <button
      type="button"
      onClick={onOpenPanel}
      disabled={!onOpenPanel}
      aria-label={`Estado de sincronización: ${stateLabel}`}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-all hover:opacity-90 ${BADGE_STYLES[state]}`}
      title="Abrir centro de sincronización y cola offline"
    >
      {renderIcon()}
      <span>{isSyncing ? 'Sincronizando…' : stateLabel}</span>

      {(counts.pendingOperationsCount > 0 || counts.pendingFilesCount > 0) && (
        <span className="inline-flex items-center gap-1.5 pl-1.5 border-l border-current/20 text-[11px] font-bold">
          {counts.pendingOperationsCount > 0 && (
            <span title="Operaciones pendientes">{counts.pendingOperationsCount} op.</span>
          )}
          {counts.pendingFilesCount > 0 && (
            <span title="Archivos multimedia pendientes">{counts.pendingFilesCount} arch.</span>
          )}
        </span>
      )}

      {counts.pendingConflictsCount > 0 && (
        <span className="px-1.5 py-0.2 rounded-full bg-purple-600 text-white text-[10px] font-bold">
          {counts.pendingConflictsCount}
        </span>
      )}
    </button>
  );
}
