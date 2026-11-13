import { useParams, useNavigate } from 'react-router-dom';
import { useSharedCattle } from '../../context/CattleContext';
import type { Cattle } from '../../types/cattle';
import {
  ArrowLeft, Edit, Calendar, Info, Scale,
  Syringe, HeartPulse, Dna
} from 'lucide-react';
import EmptyState from '../ui/EmptyState';

export default function CattleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { cattle, loading } = useSharedCattle();

  const animal = cattle?.find(c => c.id === Number(id)) as Cattle & { areteSiniiga?: string; nombre?: string; raza?: string; gender?: string; fechaNacimiento?: string };

  if (loading) return <div className="p-8 text-center text-brand-slate/50">Cargando expediente...</div>;
  if (!animal) return <div className="p-8 text-center text-status-error font-bold">Bovino no encontrado.</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8">

      {/* Encabezado Principal */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/cattle')} className="p-2 bg-surface-white border border-border-light rounded-md text-brand-slate/60 hover:text-brand-primary transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
              Expediente Individual
            </span>
            <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1 flex items-center gap-3">
              {animal.areteSiniiga || 'Sin Arete'}
              {animal.nombre && <span className="text-[20px] text-brand-slate/50 font-sans font-medium">— {animal.nombre}</span>}
            </h1>
          </div>
        </div>
        <button
          onClick={() => navigate(`/cattle/${animal.id}/edit`)}
          className="flex items-center gap-2 bg-surface-white border border-border-light text-brand-slate hover:border-brand-primary hover:text-brand-primary px-4 h-[38px] rounded-md font-semibold text-[13px] transition-colors shadow-sm"
        >
          <Edit size={16} /> Editar Perfil
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Columna Izquierda: Ficha de Identificación */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
            <div className="h-2 bg-brand-primary w-full"></div>
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-3 text-brand-slate border-b border-border-light pb-4">
                <Info size={18} className="text-brand-primary" />
                <h2 className="font-bold text-[16px]">Ficha de Identificación</h2>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">Arete SINIIGA</p>
                  <p className="text-[15px] font-semibold text-brand-slate">{animal.areteSiniiga || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">Sexo</p>
                  <p className="text-[15px] font-semibold text-brand-slate">{animal.gender || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">Raza</p>
                  <p className="text-[15px] font-semibold text-brand-slate">{animal.raza || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-brand-slate/50 uppercase tracking-wider">Nacimiento</p>
                  <p className="text-[14px] font-medium text-brand-slate flex items-center gap-1.5 mt-0.5">
                    <Calendar size={14} className="text-brand-slate/40"/> {animal.fechaNacimiento ? new Date(animal.fechaNacimiento).toLocaleDateString() : 'Desconocida'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Paneles de Módulos (En Desarrollo) */}
        <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6">

          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[280px]">
             <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center gap-2">
               <Scale size={16} className="text-brand-primary" />
               <h3 className="font-bold text-[14px] text-brand-slate">Historial de Pesajes</h3>
             </div>
             <div className="flex-1 p-4"><EmptyState title="Sin registros" message="Este módulo almacenará la curva de crecimiento del bovino." icon={Scale} /></div>
          </div>

          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[280px]">
             <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center gap-2">
               <Syringe size={16} className="text-status-info" />
               <h3 className="font-bold text-[14px] text-brand-slate">Salud y Tratamientos</h3>
             </div>
             <div className="flex-1 p-4"><EmptyState title="Sanidad Limpia" message="No se han registrado vacunas o enfermedades para este animal." icon={Syringe} /></div>
          </div>

          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[280px]">
             <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center gap-2">
               <HeartPulse size={16} className="text-pink-600" />
               <h3 className="font-bold text-[14px] text-brand-slate">Reproducción (Palpaciones)</h3>
             </div>
             <div className="flex-1 p-4"><EmptyState title="Módulo Pendiente" message="Las estadísticas de preñez y partos se habilitarán pronto." icon={HeartPulse} /></div>
          </div>

          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col h-[280px]">
             <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center gap-2">
               <Dna size={16} className="text-brand-yellow" />
               <h3 className="font-bold text-[14px] text-brand-slate">Genealogía</h3>
             </div>
             <div className="flex-1 p-4"><EmptyState title="Sin Parentesco" message="Asigna un padre y madre para construir el árbol genealógico." icon={Dna} /></div>
          </div>

        </div>
      </div>
    </div>
  );
}
