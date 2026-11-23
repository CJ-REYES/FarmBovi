import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Cloud,
  CloudUpload,
  Edit3,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Search,
  WifiOff,
  X
} from 'lucide-react';
import { useConnectivity } from '../../hooks/useConnectivity';
import { useSharedCattle } from '../../hooks/useCattle';
import type { LocalRanch } from '../../lib/database/schema';
import { RanchService } from '../../services/ranch.service';
import EmptyState from '../ui/EmptyState';

export default function RanchesPage() {
  const { isOnline } = useConnectivity();
  const { refresh: refreshCattleContext } = useSharedCattle();

  const [ranches, setRanches] = useState<LocalRanch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  // Formulario para registrar o editar ranchos
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string>('');
  const [ubicacionGeneral, setUbicacionGeneral] = useState<string>('');
  const [estado, setEstado] = useState<string>('Activo');
  const [saving, setSaving] = useState<boolean>(false);

  // Búsqueda y filtro
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'Todos' | 'Activo' | 'Inactivo'>('Todos');

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await RanchService.list(true);
        if (active) {
          setRanches(list);
          setErrorMsg(null);
        }
      } catch (err) {
        if (active) {
          setErrorMsg(
            err instanceof Error ? err.message : 'No se pudieron cargar los ranchos registrados.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setErrorMsg(null);
    setRefreshTick((prev) => prev + 1);
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
      const result = editingId
        ? await RanchService.update(editingId, { nombre, ubicacionGeneral, estado })
        : await RanchService.create({ nombre, ubicacionGeneral, estado });

      setFeedback(result.syncMessage);
      resetForm();
      const updated = await RanchService.list(false);
      setRanches(updated);
      await refreshCattleContext();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar el rancho.');
    } finally {
      setSaving(false);
    }
  };

  const filteredRanches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return ranches.filter((r) => {
      if (statusFilter !== 'Todos' && (r.estado || 'Activo') !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        r.nombre.toLowerCase().includes(q) ||
        (r.ubicacionGeneral || '').toLowerCase().includes(q)
      );
    });
  }, [ranches, searchTerm, statusFilter]);

  const activeCount = ranches.filter((r) => (r.estado || 'Activo') === 'Activo').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Administración Territorial
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Ranchos
          </h1>
          <p className="text-[13px] text-brand-slate/70 mt-1">
            Registra y administra todos los ranchos de tu operación ganadera.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 h-[38px] rounded-lg bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate text-[13px] font-semibold transition-colors disabled:opacity-50 self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          <span>Actualizar</span>
        </button>
      </header>

      {!isOnline && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-status-warning/15 border border-status-warning/35 text-amber-950 text-[13px] flex items-center gap-2.5"
        >
          <WifiOff size={16} className="text-status-warning shrink-0" />
          <span>
            Modo sin conexión: los ranchos que registres se guardan en IndexedDB y se sincronizarán
            con el servidor al recuperar red.
          </span>
        </div>
      )}

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
            aria-label="Cerrar aviso"
            className="p-1 hover:bg-status-success/10 rounded cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-[13px] flex items-start gap-2"
        >
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Resumen rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/60 uppercase tracking-wider">
            Total de Ranchos
          </p>
          <p
            data-testid="ranches-total-count"
            className="text-3xl font-condensed font-bold text-brand-forest mt-1"
          >
            {ranches.length}
          </p>
        </div>
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/60 uppercase tracking-wider">
            Activos
          </p>
          <p className="text-3xl font-condensed font-bold text-status-success mt-1">
            {activeCount}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-brand-slate/60 uppercase tracking-wider">
            Pendientes de Sincronizar
          </p>
          <p className="text-3xl font-condensed font-bold text-amber-700 mt-1">
            {ranches.filter((r) => r.syncStatus !== 'synced').length}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Formulario: Registrar nuevo rancho o editar existente */}
        <section className="lg:col-span-5 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/40 flex items-center justify-between gap-2">
            <h2 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
              {editingId ? (
                <>
                  <Edit3 size={17} className="text-brand-primary" /> Editar Rancho
                </>
              ) : (
                <>
                  <Plus size={17} className="text-brand-primary" /> Registrar Nuevo Rancho
                </>
              )}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-[12px] font-semibold text-brand-slate/70 hover:text-brand-primary cursor-pointer"
              >
                Cancelar edición
              </button>
            )}
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="p-5 space-y-4">
            <div>
              <label
                htmlFor="ranch-page-name"
                className="block text-[13px] font-semibold text-brand-slate mb-1"
              >
                Nombre del rancho *
              </label>
              <div className="relative">
                <Building2
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                />
                <input
                  id="ranch-page-name"
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. Rancho El Encino"
                  className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="ranch-page-location"
                className="block text-[13px] font-semibold text-brand-slate mb-1"
              >
                Ubicación general *
              </label>
              <div className="relative">
                <MapPin
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                />
                <input
                  id="ranch-page-location"
                  type="text"
                  value={ubicacionGeneral}
                  onChange={(e) => setUbicacionGeneral(e.target.value)}
                  placeholder="Ej. Candelaria, Campeche, México"
                  className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="ranch-page-state"
                className="block text-[13px] font-semibold text-brand-slate mb-1"
              >
                Estado *
              </label>
              <select
                id="ranch-page-state"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
                className="w-full h-[42px] px-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
              >
                <option value="Activo">Activo</option>
                <option value="Inactivo">Inactivo</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-dark text-white rounded-lg font-semibold text-[14px] shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Guardando...
                </>
              ) : editingId ? (
                <>
                  <Save size={16} /> Guardar Cambios
                </>
              ) : (
                <>
                  <Plus size={16} /> Registrar Rancho
                </>
              )}
            </button>
          </form>
        </section>

        {/* Listado de todos los ranchos registrados */}
        <section className="lg:col-span-7 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
              <Building2 size={17} className="text-brand-primary" /> Ranchos Registrados (
              {filteredRanches.length})
            </h2>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-48">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-slate/45"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar rancho..."
                  aria-label="Buscar rancho"
                  className="w-full h-[34px] pl-8 pr-2.5 bg-surface-white border border-border-light rounded-lg text-[12px] text-brand-slate outline-none focus:border-brand-primary"
                />
              </div>
              <select
                aria-label="Filtrar ranchos por estado"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'Todos' | 'Activo' | 'Inactivo')
                }
                className="h-[34px] px-2.5 bg-surface-white border border-border-light rounded-lg text-[12px] text-brand-slate outline-none focus:border-brand-primary"
              >
                <option value="Todos">Todos</option>
                <option value="Activo">Activos</option>
                <option value="Inactivo">Inactivos</option>
              </select>
            </div>
          </div>

          <div className="p-5">
            {loading ? (
              <div className="py-10 text-center text-brand-slate/65 flex flex-col items-center gap-2">
                <Loader2 size={24} className="animate-spin text-brand-primary" />
                <span className="text-[13px]">Cargando ranchos...</span>
              </div>
            ) : filteredRanches.length === 0 ? (
              <EmptyState
                title={
                  ranches.length === 0
                    ? 'Aún no tienes ranchos registrados'
                    : 'Sin coincidencias en tu búsqueda'
                }
                message={
                  ranches.length === 0
                    ? 'Usa el formulario de la izquierda para registrar tu primer rancho o agrega tantos ranchos como necesites.'
                    : 'Prueba con otro nombre, ubicación o filtro de estado.'
                }
                icon={Building2}
              />
            ) : (
              <div className="space-y-3">
                {filteredRanches.map((ranch) => (
                  <article
                    key={ranch.id}
                    className={`p-4 rounded-xl border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      editingId === ranch.id
                        ? 'border-brand-primary bg-brand-primary/5'
                        : 'border-border-light bg-surface-app/40 hover:border-brand-primary/40'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-[15px] text-brand-forest truncate">
                          {ranch.nombre}
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            (ranch.estado || 'Activo') === 'Activo'
                              ? 'bg-status-success/10 text-status-success'
                              : 'bg-surface-secondary text-brand-slate/70'
                          }`}
                        >
                          {ranch.estado || 'Activo'}
                        </span>
                        {ranch.syncStatus === 'synced' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-success/10 text-status-success">
                            <Cloud size={11} /> Sincronizado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-warning/20 text-amber-900">
                            <CloudUpload size={11} /> Pendiente sync
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-brand-slate/75 flex items-center gap-1.5">
                        <MapPin size={13} className="text-brand-primary shrink-0" />
                        <span className="truncate">
                          {ranch.ubicacionGeneral || 'Sin ubicación registrada'}
                        </span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => startEdit(ranch)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-surface-white border border-border-light hover:border-brand-primary hover:text-brand-primary text-brand-slate text-[12px] font-semibold transition-colors shrink-0 cursor-pointer"
                    >
                      <Edit3 size={14} /> Editar
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
