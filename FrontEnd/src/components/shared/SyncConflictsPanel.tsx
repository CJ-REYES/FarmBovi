import { useState, useEffect, useCallback } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  GitMerge,
  Server,
  Smartphone,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  History
} from 'lucide-react';
import {
  ConflictResolver,
  type MergeableFieldDescriptor
} from '../../services/sync/conflict-resolver';
import type {
  ConflictResolutionState,
  LocalSyncConflict
} from '../../lib/database/schema';

const ENTITY_NAMES: Record<string, string> = {
  cattle: 'Bovino',
  weighings: 'Pesaje',
  healthRecords: 'Evento de Salud',
  feedingRecords: 'Alimentación',
  reproductionRecords: 'Reproducción',
  lots: 'Lote',
  movements: 'Movimiento',
  genealogy: 'Genealogía',
  alerts: 'Alerta',
  media: 'Evidencia Multimedia'
};

const RESOLUTION_LABELS: Record<ConflictResolutionState, string> = {
  pendiente: 'Pendiente de resolución',
  resuelto_servidor: 'Resuelto con servidor',
  resuelto_local: 'Resuelto conservando local',
  fusionado: 'Resuelto combinando campos',
  descartado: 'Descartado'
};

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '— (vacío)';
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export interface SyncConflictsPanelProps {
  onConflictResolved?: () => void | Promise<void>;
}

export default function SyncConflictsPanel({ onConflictResolved }: SyncConflictsPanelProps) {
  const [conflicts, setConflicts] = useState<LocalSyncConflict[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showResolvedHistory, setShowResolvedHistory] = useState<boolean>(false);

  // Estado de confirmación explícita para descartar cambio local (Opción 1)
  const [confirmServerDiscardId, setConfirmServerDiscardId] = useState<string | null>(null);

  // Estado para modo de combinación campo por campo (Opción 3)
  const [mergingConflictId, setMergingConflictId] = useState<string | null>(null);
  const [fieldChoices, setFieldChoices] = useState<Record<string, 'local' | 'server'>>({});
  const [resolutionNote, setResolutionNote] = useState<string>('');

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reloadConflicts = useCallback(async () => {
    try {
      const all = await ConflictResolver.getAllConflicts();
      setConflicts(all);
    } catch (err) {
      console.error('Error al cargar conflictos de sincronización:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const loadInitial = async () => {
      try {
        const all = await ConflictResolver.getAllConflicts();
        if (active) {
          setConflicts(all);
          const firstPending = all.find((c) => c.estadoResolucion === 'pendiente');
          if (firstPending) {
            setExpandedId((prev) => prev ?? firstPending.idConflicto);
          }
        }
      } catch (err) {
        console.error('Error al cargar conflictos:', err);
      }
    };

    void loadInitial();
    const interval = window.setInterval(() => {
      void loadInitial();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const pendingConflicts = conflicts.filter((c) => c.estadoResolucion === 'pendiente');
  const resolvedConflicts = conflicts.filter((c) => c.estadoResolucion !== 'pendiente');

  const startMergeMode = (conflict: LocalSyncConflict) => {
    const descriptors = ConflictResolver.getMergeableFields(conflict);
    const initialChoices: Record<string, 'local' | 'server'> = {};
    for (const field of descriptors) {
      // Por defecto conserva el valor local si existe, o el del servidor si el local está vacío
      initialChoices[field.key] =
        field.localValue !== undefined && field.localValue !== null && field.localValue !== ''
          ? 'local'
          : 'server';
    }
    setFieldChoices(initialChoices);
    setMergingConflictId(conflict.idConflicto);
    setConfirmServerDiscardId(null);
    setResolutionNote('');
    setErrorMsg(null);
  };

  const handleAcceptServer = async (conflict: LocalSyncConflict) => {
    setProcessingId(conflict.idConflicto);
    setErrorMsg(null);
    setFeedback(null);
    try {
      await ConflictResolver.resolveWithServer(conflict.idConflicto, resolutionNote);
      setConfirmServerDiscardId(null);
      setMergingConflictId(null);
      setResolutionNote('');
      await reloadConflicts();
      await onConflictResolved?.();
      setFeedback('Conflicto resuelto aplicando la versión del servidor sin duplicar registros.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al resolver con versión del servidor.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleKeepLocal = async (conflict: LocalSyncConflict) => {
    setProcessingId(conflict.idConflicto);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const newOp = await ConflictResolver.resolveWithLocal(
        conflict.idConflicto,
        resolutionNote
      );
      setConfirmServerDiscardId(null);
      setMergingConflictId(null);
      setResolutionNote('');
      await reloadConflicts();
      await onConflictResolved?.();
      setFeedback(
        `Cambio local conservado. Se generó nueva operación en cola (base v${String(
          newOp.versionBase ?? 'inicial'
        )}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al conservar el cambio local.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmMerge = async (
    conflict: LocalSyncConflict,
    descriptors: MergeableFieldDescriptor[]
  ) => {
    setProcessingId(conflict.idConflicto);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const selectedValues: Record<string, unknown> = {};
      for (const field of descriptors) {
        const source = fieldChoices[field.key] || 'local';
        selectedValues[field.key] =
          source === 'local' ? field.localValue : field.serverValue;
      }

      const newOp = await ConflictResolver.resolveWithMerge(
        conflict.idConflicto,
        selectedValues,
        resolutionNote
      );
      setMergingConflictId(null);
      setConfirmServerDiscardId(null);
      setResolutionNote('');
      await reloadConflicts();
      await onConflictResolved?.();
      setFeedback(
        `Datos combinados correctamente. Se generó nueva operación UPDATE sobre versión servidor v${String(
          newOp.versionBase
        )}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al combinar los campos.');
    } finally {
      setProcessingId(null);
    }
  };

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="bg-surface-white border border-purple-500/30 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-light pb-3">
        <div>
          <h3 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
            <AlertOctagon size={18} className="text-purple-600" />
            Conflictos de Sincronización ({pendingConflicts.length} pendientes)
          </h3>
          <p className="text-[12px] text-brand-slate/65">
            Ediciones concurrentes detectadas entre este dispositivo y el servidor. Ningún cambio local se descarta sin tu confirmación.
          </p>
        </div>

        {resolvedConflicts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolvedHistory((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-slate/75 hover:text-brand-slate px-3 py-1.5 rounded-lg border border-border-light bg-surface-secondary/50"
          >
            <History size={14} />
            {showResolvedHistory
              ? 'Ocultar historial'
              : `Historial resueltos (${resolvedConflicts.length})`}
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-[12px]">
          {errorMsg}
        </div>
      )}

      {feedback && (
        <div className="p-3 rounded-lg bg-status-success/10 border border-status-success/30 text-status-success text-[12px] flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {pendingConflicts.length === 0 ? (
        <div className="p-4 rounded-lg bg-surface-secondary/40 text-center text-[13px] text-brand-slate/65">
          No hay conflictos pendientes de resolución.
        </div>
      ) : (
        <div className="space-y-3">
          {pendingConflicts.map((conflict) => {
            const isExpanded = expandedId === conflict.idConflicto;
            const isMerging = mergingConflictId === conflict.idConflicto;
            const isConfirmingServer = confirmServerDiscardId === conflict.idConflicto;
            const mergeCheck = ConflictResolver.canMergeConflict(conflict);
            const descriptors = ConflictResolver.getMergeableFields(conflict);
            const entityLabel = ENTITY_NAMES[conflict.entidad] || conflict.entidad;

            return (
              <div
                key={conflict.idConflicto}
                className="border border-purple-500/30 rounded-xl bg-purple-500/[0.03] overflow-hidden"
              >
                {/* Cabecera del conflicto */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : conflict.idConflicto)
                  }
                  className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-purple-500/[0.05] transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-purple-500/15 text-purple-700">
                        {conflict.tipoConflicto === 'DELETED_ON_SERVER'
                          ? 'Eliminado en servidor'
                          : 'Conflicto de versión'}
                      </span>
                      <span className="font-bold text-[13px] text-brand-slate">
                        {entityLabel} • ID: {String(conflict.remoteId ?? conflict.idEntidad)}
                      </span>
                    </div>
                    <p className="text-[11px] text-brand-slate/65">
                      Detectado: {new Date(conflict.fechaDeteccion).toLocaleString()} • Base local: v
                      {String(conflict.versionBase ?? 'N/A')} vs Servidor actual: v
                      {String(conflict.versionServidor ?? 'N/A')}
                    </p>
                  </div>

                  {isExpanded ? (
                    <ChevronUp size={18} className="text-brand-slate/60 shrink-0" />
                  ) : (
                    <ChevronDown size={18} className="text-brand-slate/60 shrink-0" />
                  )}
                </button>

                {/* Detalle comparativo y opciones de resolución */}
                {isExpanded && (
                  <div className="p-4 border-t border-purple-500/20 bg-surface-white space-y-4">
                    {conflict.operacionLocal.ultimoError && (
                      <p className="text-[12px] text-purple-800 bg-purple-500/10 px-3 py-2 rounded-lg">
                        {conflict.operacionLocal.ultimoError}
                      </p>
                    )}

                    {/* Tabla comparativa de campos */}
                    {conflict.tipoConflicto === 'DELETED_ON_SERVER' ? (
                      <div className="p-3 rounded-lg bg-status-warning/10 border border-status-warning/30 text-[12px] text-brand-slate flex items-start gap-2">
                        <ShieldAlert size={16} className="text-status-warning shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">
                            Este registro fue eliminado en el servidor por otro dispositivo.
                          </p>
                          <p className="text-brand-slate/70 mt-0.5">
                            Puedes aceptar la eliminación definitiva o conservar tus datos locales para volver a crearlo en el servidor.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-border-light rounded-lg">
                        <table className="w-full text-left border-collapse text-[12px]">
                          <thead>
                            <tr className="bg-surface-secondary/70 border-b border-border-light text-brand-slate/80">
                              <th className="py-2 px-3 font-semibold">Campo</th>
                              <th className="py-2 px-3 font-semibold">
                                Tu cambio local (base v{String(conflict.versionBase ?? '?')})
                              </th>
                              <th className="py-2 px-3 font-semibold">
                                Servidor actual (v{String(conflict.versionServidor ?? '?')})
                              </th>
                              {isMerging && (
                                <th className="py-2 px-3 font-semibold text-center">
                                  Valor elegido
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border-light">
                            {descriptors.map((field) => (
                              <tr
                                key={field.key}
                                className={field.differs ? 'bg-amber-500/[0.06]' : ''}
                              >
                                <td className="py-2 px-3 font-medium text-brand-slate">
                                  {field.label}
                                  {field.differs && (
                                    <span className="ml-1.5 text-[10px] font-bold text-amber-700 bg-amber-500/15 px-1.5 py-0.5 rounded">
                                      Difiere
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-brand-slate/90">
                                  {formatFieldValue(field.localValue)}
                                </td>
                                <td className="py-2 px-3 text-brand-slate/90">
                                  {formatFieldValue(field.serverValue)}
                                </td>
                                {isMerging && (
                                  <td className="py-2 px-3">
                                    <div className="flex items-center justify-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setFieldChoices((prev) => ({
                                            ...prev,
                                            [field.key]: 'local'
                                          }))
                                        }
                                        className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                          (fieldChoices[field.key] || 'local') === 'local'
                                            ? 'bg-brand-primary text-white border-brand-primary'
                                            : 'bg-surface-white text-brand-slate border-border-light'
                                        }`}
                                      >
                                        Local
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setFieldChoices((prev) => ({
                                            ...prev,
                                            [field.key]: 'server'
                                          }))
                                        }
                                        className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                          fieldChoices[field.key] === 'server'
                                            ? 'bg-brand-dark text-white border-brand-dark'
                                            : 'bg-surface-white text-brand-slate border-border-light'
                                        }`}
                                      >
                                        Servidor
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Nota opcional de auditoría */}
                    <div>
                      <label className="block text-[11px] font-semibold text-brand-slate/75 mb-1">
                        Nota de resolución (opcional)
                      </label>
                      <input
                        type="text"
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        placeholder="Ej. Se conserva peso tomado en báscula y lote asignado en oficina"
                        className="w-full border border-border-light rounded-lg px-3 py-1.5 text-[12px] text-brand-slate"
                      />
                    </div>

                    {/* Confirmación explícita antes de descartar cambio local (Opción 1) */}
                    {isConfirmingServer && (
                      <div className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 space-y-2">
                        <p className="text-[12px] font-semibold text-status-error">
                          Confirmación requerida: se descartarán tus cambios locales pendientes y se conservará únicamente la versión del servidor (v
                          {String(conflict.versionServidor ?? '?')}).
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={processingId === conflict.idConflicto}
                            onClick={() => void handleAcceptServer(conflict)}
                            className="px-3 py-1.5 rounded-lg bg-status-error text-white text-[12px] font-semibold disabled:opacity-50"
                          >
                            {processingId === conflict.idConflicto
                              ? 'Aplicando...'
                              : 'Confirmar y descartar cambio local'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmServerDiscardId(null)}
                            className="px-3 py-1.5 rounded-lg border border-border-light bg-surface-white text-[12px] font-semibold text-brand-slate"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Barra de acciones de resolución */}
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-border-light">
                      {!isConfirmingServer && (
                        <button
                          type="button"
                          disabled={processingId === conflict.idConflicto}
                          onClick={() => {
                            setConfirmServerDiscardId(conflict.idConflicto);
                            setMergingConflictId(null);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-light bg-surface-white hover:bg-surface-secondary text-brand-slate text-[12px] font-semibold"
                        >
                          <Server size={14} />
                          Usar versión del servidor
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={processingId === conflict.idConflicto}
                        onClick={() => void handleKeepLocal(conflict)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[12px] font-semibold disabled:opacity-50"
                      >
                        <Smartphone size={14} />
                        {processingId === conflict.idConflicto
                          ? 'Procesando...'
                          : `Conservar cambio local (rebasar a v${String(
                              conflict.versionServidor ?? 'nueva'
                            )})`}
                      </button>

                      {mergeCheck.supported && !isMerging && (
                        <button
                          type="button"
                          disabled={processingId === conflict.idConflicto}
                          onClick={() => startMergeMode(conflict)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[12px] font-semibold"
                        >
                          <GitMerge size={14} />
                          Combinar campos
                        </button>
                      )}

                      {isMerging && (
                        <button
                          type="button"
                          disabled={processingId === conflict.idConflicto}
                          onClick={() => void handleConfirmMerge(conflict, descriptors)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[12px] font-semibold disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} />
                          Guardar combinación
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Historial auditado de conflictos resueltos */}
      {showResolvedHistory && resolvedConflicts.length > 0 && (
        <div className="pt-3 border-t border-border-light space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-slate/65">
            Conflictos Resueltos ({resolvedConflicts.length})
          </h4>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {resolvedConflicts.map((item) => (
              <div
                key={item.idConflicto}
                className="p-2.5 rounded-lg bg-surface-secondary/50 border border-border-light text-[12px] flex flex-col sm:flex-row sm:items-center justify-between gap-1"
              >
                <div>
                  <span className="font-semibold text-brand-slate">
                    {ENTITY_NAMES[item.entidad] || item.entidad} ({String(item.remoteId ?? item.idEntidad)})
                  </span>
                  {item.notasResolucion && (
                    <p className="text-[11px] text-brand-slate/70">{item.notasResolucion}</p>
                  )}
                </div>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-status-success/15 text-status-success self-start sm:self-center">
                  {RESOLUTION_LABELS[item.estadoResolucion]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
