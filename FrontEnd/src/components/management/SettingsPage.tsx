import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Settings,
  X
} from 'lucide-react';
import { useSharedCattle } from '../../hooks/useCattle';
import type { LocalRanch } from '../../lib/database/schema';
import { RanchService } from '../../services/ranch.service';
import SyncStatusPanel from '../shared/SyncStatusPanel';

type SettingsTab = 'rancho' | 'sincronizacion';

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const { refresh: refreshCattleContext } = useSharedCattle();

  const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
    searchParams.get('tab') === 'sincronizacion' ? 'sincronizacion' : 'rancho'
  );

  const [ranches, setRanches] = useState<LocalRanch[]>([]);
  const [loadingRanches, setLoadingRanches] = useState<boolean>(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string>('');
  const [ubicacionGeneral, setUbicacionGeneral] = useState<string>('');
  const [estado, setEstado] = useState<string>('Activo');
  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadRanches = async () => {
    setLoadingRanches(true);
    try {
      const list = await RanchService.list(true);
      setRanches(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudieron cargar los ranchos.');
    } finally {
      setLoadingRanches(false);
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await RanchService.list(true);
        if (!active) return;
        setRanches(list);
      } catch (err) {
        if (!active) return;
        setErrorMsg(err instanceof Error ? err.message : 'No se pudieron cargar los ranchos.');
      } finally {
        if (active) {
          setLoadingRanches(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setNombre('');
    setUbicacionGeneral('');
    setEstado('Activo');
  };

  const startEdit = (ranch: LocalRanch) => {
    setEditingId(ranch.id);
    setNombre(ranch.nombre);
    setUbicacionGeneral(ranch.ubicacionGeneral || '');
    setEstado(ranch.estado || 'Activo');
    setErrorMsg(null);
    setFeedback(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);
    setSaving(true);
    try {
      const res = editingId
        ? await RanchService.update(editingId, { nombre, ubicacionGeneral, estado })
        : await RanchService.create({ nombre, ubicacionGeneral, estado });

      setFeedback(res.syncMessage);
      resetForm();
      await loadRanches();
      await refreshCattleContext();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar el rancho.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 h-full flex flex-col pb-8">
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
          Administración
        </span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
          Configuración del Sistema
        </h1>
      </header>

      <div className="flex flex-col md:flex-row gap-6 flex-1">
        {/* Menú de Configuración */}
        <aside className="w-full md:w-60 shrink-0 space-y-1">
          <button
            type="button"
            onClick={() => setActiveTab('rancho')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
              activeTab === 'rancho'
                ? 'bg-surface-secondary text-brand-primary'
                : 'text-brand-slate hover:bg-surface-secondary/50'
            }`}
          >
            <MapPin size={16} /> Ranchos y Datos Base
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sincronizacion')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer ${
              activeTab === 'sincronizacion'
                ? 'bg-surface-secondary text-brand-primary'
                : 'text-brand-slate hover:bg-surface-secondary/50'
            }`}
          >
            <RefreshCw size={16} /> Sincronización y Offline
          </button>
        </aside>

        {/* Panel Activo */}
        <div className="flex-1">
          {activeTab === 'rancho' ? (
            <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-6 lg:p-8 space-y-6">
              <div>
                <h2 className="text-[18px] font-bold text-brand-forest flex items-center gap-2">
                  <MapPin size={20} className="text-brand-primary" />
                  {editingId ? 'Editar Rancho' : 'Registrar Nuevo Rancho'}
                </h2>
                <p className="text-[13px] text-brand-slate/65 mt-1">
                  Conectado al contrato real `POST /api/ranchos` y `PUT /api/ranchos/{'{id}'}`. Al
                  crear un rancho con sesión activa se te asigna rol Admin automáticamente.
                </p>
              </div>

              {feedback && (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-status-success/10 border border-status-success/30 text-status-success text-[13px] flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="shrink-0" />
                    <span>{feedback}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFeedback(null)}
                    aria-label="Cerrar notificación"
                    className="p-1 rounded hover:bg-status-success/10 cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-[13px] flex items-center gap-2"
                >
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={(e) => void handleSubmit(e)} className="max-w-xl space-y-4">
                <div>
                  <label
                    htmlFor="settings-ranch-nombre"
                    className="block text-[13px] font-semibold text-brand-slate mb-1"
                  >
                    Nombre del Rancho *
                  </label>
                  <input
                    id="settings-ranch-nombre"
                    type="text"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej. Rancho El Porvenir"
                    className="w-full h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-ranch-ubicacion"
                    className="block text-[13px] font-semibold text-brand-slate mb-1"
                  >
                    Ubicación General *
                  </label>
                  <input
                    id="settings-ranch-ubicacion"
                    type="text"
                    required
                    value={ubicacionGeneral}
                    onChange={(e) => setUbicacionGeneral(e.target.value)}
                    placeholder="Ej. Candelaria, Campeche, México"
                    className="w-full h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-ranch-estado"
                    className="block text-[13px] font-semibold text-brand-slate mb-1"
                  >
                    Estado *
                  </label>
                  <select
                    id="settings-ranch-estado"
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    className="w-full h-[42px] px-3 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  >
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </select>
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-2.5">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-5 h-[42px] rounded-md font-semibold text-[13px] transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? (
                      <>
                        <Loader2 size={15} className="animate-spin" /> Guardando...
                      </>
                    ) : editingId ? (
                      <>
                        <Save size={15} /> Actualizar Rancho
                      </>
                    ) : (
                      <>
                        <Plus size={15} /> Registrar Rancho
                      </>
                    )}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-4 h-[42px] rounded-md border border-border-light text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary cursor-pointer"
                    >
                      Cancelar edición
                    </button>
                  )}
                </div>
              </form>

              {/* Lista de Ranchos registrados */}
              <div className="pt-6 border-t border-border-light space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-bold text-brand-forest flex items-center gap-2">
                    <Settings size={15} className="text-brand-primary" />
                    Ranchos Registrados ({ranches.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => void loadRanches()}
                    className="text-[12px] font-semibold text-brand-primary hover:underline cursor-pointer"
                  >
                    Actualizar lista
                  </button>
                </div>

                {loadingRanches ? (
                  <p className="text-[13px] text-brand-slate/60">Cargando ranchos...</p>
                ) : ranches.length === 0 ? (
                  <p className="text-[13px] text-brand-slate/65 p-4 rounded-lg bg-surface-app/60 border border-border-light">
                    Aún no hay ranchos registrados en este dispositivo. Registra el primero arriba.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {ranches.map((r) => (
                      <div
                        key={r.id}
                        className="p-4 rounded-xl border border-border-light bg-surface-app/40 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-bold text-[14px] text-brand-forest truncate">
                            {r.nombre}
                          </p>
                          <p className="text-[12px] text-brand-slate/70 truncate">
                            {r.ubicacionGeneral || 'Sin ubicación'}
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-status-success/15 text-status-success">
                              {r.estado || 'Activo'}
                            </span>
                            <span className="text-[10px] font-semibold text-brand-slate/55">
                              {r.syncStatus === 'synced' ? 'Sincronizado' : 'Pendiente sync'}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="p-2 rounded-md text-brand-slate/70 hover:text-brand-primary hover:bg-brand-primary/10 transition-colors cursor-pointer"
                          aria-label={`Editar rancho ${r.nombre}`}
                        >
                          <Edit3 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <SyncStatusPanel />
          )}
        </div>
      </div>
    </div>
  );
}
