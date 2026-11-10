import { useSharedCattle } from '../../context/CattleContext';
import type { Cattle } from '../../types/cattle';
import { FileText, Download, BarChart2, PieChart, Activity } from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function ReportsPage() {
  const { cattle, loading } = useSharedCattle();

  const totalBovinos = cattle?.length || 0;
  const machos = cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Macho' || c.sex === 'Macho').length || 0;
  const hembras = cattle?.filter((c: Cattle & { gender?: string; sex?: string }) => c.gender === 'Hembra' || c.sex === 'Hembra').length || 0;

  // EXPORTACIÓN REAL A CSV
  const handleExportCSV = () => {
    if (!cattle || cattle.length === 0) return;

    const headers = "ID,Arete SINIIGA,Nombre,Raza,Sexo,Fecha Nacimiento\n";
    const rows = cattle.map((c: Cattle & { areteSiniiga?: string; nombre?: string; raza?: string; gender?: string; sex?: string; fechaNacimiento?: string }) => {
      return `${c.id},"${c.areteSiniiga || ''}","${c.nombre || ''}","${c.raza || ''}","${c.gender || c.sex || ''}","${c.fechaNacimiento ? new Date(c.fechaNacimiento).toLocaleDateString() : ''}"`;
    }).join("\n");

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Inventario_FarmBovi_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Inteligencia de Negocio</span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Reportes y Estadísticas</h1>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Reporte Activo (Con datos reales) */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex justify-between items-center">
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <FileText size={18} className="text-brand-primary" /> Reporte de Padrón Ganadero
              </h2>
              <button
                onClick={handleExportCSV}
                disabled={loading || totalBovinos === 0}
                className="flex items-center gap-2 bg-surface-white border border-border-light hover:border-brand-primary hover:text-brand-primary text-brand-slate px-3 py-1.5 rounded-md font-semibold text-[12px] transition-colors disabled:opacity-50"
              >
                <Download size={14} /> Exportar CSV
              </button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-surface-secondary/50 p-4 rounded-lg border border-border-light/50">
                  <p className="text-[12px] font-bold text-brand-slate/60 uppercase tracking-wider">Total Hato</p>
                  <p className="text-3xl font-condensed font-bold text-brand-forest mt-1">{totalBovinos}</p>
                </div>
                <div className="bg-surface-secondary/50 p-4 rounded-lg border border-border-light/50">
                  <p className="text-[12px] font-bold text-brand-slate/60 uppercase tracking-wider">Hembras</p>
                  <p className="text-3xl font-condensed font-bold text-pink-600 mt-1">{hembras}</p>
                </div>
                <div className="bg-surface-secondary/50 p-4 rounded-lg border border-border-light/50">
                  <p className="text-[12px] font-bold text-brand-slate/60 uppercase tracking-wider">Machos</p>
                  <p className="text-3xl font-condensed font-bold text-blue-600 mt-1">{machos}</p>
                </div>
              </div>
              <p className="text-[13px] text-brand-slate/70">
                El reporte detallado incluye identificadores SINIIGA, razas, fechas de nacimiento y clasificación por sexo extraída directamente de la base de datos central.
              </p>
            </div>
          </div>

          {/* Reporte Pendiente */}
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[250px]">
            <div className="px-5 py-4 border-b border-border-light bg-surface-app/30">
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <BarChart2 size={18} className="text-brand-slate/70" /> Rendimiento de Pesajes
              </h2>
            </div>
            <div className="flex-1 p-6 flex items-center justify-center">
               <EmptyState title="Gráficas no disponibles" message="Faltan registros de biometría para generar analíticas avanzadas." icon={BarChart2} />
            </div>
          </div>
        </div>

        {/* Panel lateral de módulos pendientes */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[280px]">
            <div className="px-5 py-4 border-b border-border-light">
              <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
                <PieChart size={18} className="text-brand-yellow" /> Reporte de Sanidad
              </h2>
            </div>
            <div className="flex-1 p-5"><EmptyState title="Sin Datos" message="Módulo sanitario en desarrollo." icon={PieChart} /></div>
          </div>

          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[280px]">
            <div className="px-5 py-4 border-b border-border-light">
              <h2 className="font-bold text-[15px] text-brand-slate flex items-center gap-2">
                <Activity size={18} className="text-pink-600" /> Reporte Reproductivo
              </h2>
            </div>
            <div className="flex-1 p-5"><EmptyState title="Sin Datos" message="Módulo reproductivo en desarrollo." icon={Activity} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
