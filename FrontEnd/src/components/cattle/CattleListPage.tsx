import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSharedCattle } from '../../context/CattleContext';
import type { Cattle } from '../../types/cattle';
import { Search, Plus, Eye, Edit, Trash2, Beef, AlertCircle } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

const CURRENT_DATE = new Date();

export default function CattleListPage() {
  const navigate = useNavigate();
  const { cattle, loading, error, remove } = useSharedCattle();
  const [searchTerm, setSearchTerm] = useState('');
  const [isDeleting, setIsDeleting] = useState<number | null>(null);

  // Filtrado de bovinos en el frontend
  const filteredCattle = cattle?.filter((c: Cattle & { areteSiniiga?: string; nombre?: string; raza?: string }) => {
    const search = searchTerm.toLowerCase();
    return (
      (c.areteSiniiga && c.areteSiniiga.toLowerCase().includes(search)) ||
      (c.nombre && c.nombre.toLowerCase().includes(search)) ||
      (c.raza && c.raza.toLowerCase().includes(search))
    );
  }) || [];

  const calcularEdad = (fechaNacimiento?: string) => {
    if (!fechaNacimiento) return 'Desconocida';

    const fecha = new Date(fechaNacimiento);
    if (Number.isNaN(fecha.getTime())) return 'Desconocida';

    const diff = CURRENT_DATE.getTime() - fecha.getTime();
    const ageDate = new Date(diff);
    const years = Math.abs(ageDate.getUTCFullYear() - 1970);
    const months = ageDate.getUTCMonth();

    if (years === 0) return `${months} meses`;
    return `${years} años, ${months} meses`;
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este bovino? Esta acción no se puede deshacer.')) return;
    try {
      setIsDeleting(id);
      await remove(id);
    } catch (err) {
      console.error("Error eliminando bovino:", err);
      alert('Error al eliminar el bovino. Verifica tu conexión a la API.');
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">

      {/* Encabezado */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Padrón Ganadero</span>
          <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Inventario de Bovinos
          </h1>
        </div>
        <button
          onClick={() => navigate('/cattle/new')}
          className="flex items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 h-[38px] rounded-md font-semibold text-[13px] transition-colors shadow-sm"
        >
          <Plus size={16} /> Registrar Bovino
        </button>
      </header>

      {/* Controles de Búsqueda */}
      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" />
          <input
            type="text"
            placeholder="Buscar por arete SINIIGA, nombre o raza..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-[38px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate placeholder:text-brand-slate/40 focus:outline-none focus:border-brand-primary"
          />
        </div>
        <div className="text-[13px] font-medium text-brand-slate/60">
          Total: <strong className="text-brand-slate">{filteredCattle.length}</strong> registros
        </div>
      </div>

      {/* Tabla / Estados */}
      {error ? (
        <div className="bg-status-error/10 border border-status-error/20 rounded-xl p-6 text-center text-status-error">
          <AlertCircle className="mx-auto mb-2" size={24} />
          <p className="font-semibold text-[14px]">No se pudo cargar el inventario</p>
          <p className="text-[13px] opacity-80 mt-1">Verifica que el servidor .NET 10 esté en ejecución.</p>
        </div>
      ) : loading && cattle.length === 0 ? (
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm p-12 text-center text-brand-slate/50 font-medium">
          Cargando padrón ganadero...
        </div>
      ) : filteredCattle.length === 0 ? (
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm h-[400px] flex items-center justify-center">
           <EmptyState
             title="No hay bovinos"
             message={searchTerm ? "No se encontraron resultados para tu búsqueda." : "El inventario está vacío. Comienza registrando tu primer bovino."}
             icon={Beef}
             actionLabel={searchTerm ? undefined : "Registrar Bovino"}
           />
        </div>
      ) : (
        <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-secondary/50 border-b border-border-light text-[12px] uppercase tracking-wider text-brand-slate/60 font-semibold">
                <th className="p-4">Arete (SINIIGA)</th>
                <th className="p-4">Nombre / Alias</th>
                <th className="p-4">Raza</th>
                <th className="p-4">Sexo</th>
                <th className="p-4">Edad</th>
                <th className="p-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light/50">
              {filteredCattle.map((c: Cattle & { areteSiniiga?: string; nombre?: string; raza?: string; gender?: string; fechaNacimiento?: string }) => (
                <tr key={c.id} className="hover:bg-surface-secondary/30 transition-colors">
                  <td className="p-4">
                    <span className="font-semibold text-brand-slate bg-brand-yellow/20 text-brand-dark px-2 py-1 rounded border border-brand-yellow/30 text-[13px]">
                      {c.areteSiniiga || 'Sin Arete'}
                    </span>
                  </td>
                  <td className="p-4 font-medium text-[14px] text-brand-slate">{c.nombre || '--'}</td>
                  <td className="p-4 text-[14px] text-brand-slate">{c.raza || '--'}</td>
                  <td className="p-4 text-[14px] text-brand-slate">
                    {c.gender === 'Hembra' ? (
                       <span className="text-pink-600 font-medium bg-pink-50 px-2 py-0.5 rounded-full text-[12px]">Hembra</span>
                    ) : c.gender === 'Macho' ? (
                       <span className="text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full text-[12px]">Macho</span>
                    ) : (
                       <span className="text-brand-slate/60 text-[12px]">{c.gender}</span>
                    )}
                  </td>
                  <td className="p-4 text-[13px] text-brand-slate/80">{calcularEdad(c.fechaNacimiento)}</td>
                  <td className="p-4 text-right flex justify-end gap-2">
                    <Link to={`/cattle/${c.id}`} className="p-1.5 text-brand-slate/50 hover:text-brand-primary hover:bg-brand-primary/10 rounded transition-colors" title="Ver Expediente">
                      <Eye size={18} />
                    </Link>
                    <Link to={`/cattle/${c.id}/edit`} className="p-1.5 text-brand-slate/50 hover:text-status-info hover:bg-status-info/10 rounded transition-colors" title="Editar">
                      <Edit size={18} />
                    </Link>
                    <button
                      onClick={() => handleDelete(c.id)}
                      disabled={isDeleting === c.id}
                      className="p-1.5 text-brand-slate/50 hover:text-status-error hover:bg-status-error/10 rounded transition-colors disabled:opacity-50"
                      title="Eliminar"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
