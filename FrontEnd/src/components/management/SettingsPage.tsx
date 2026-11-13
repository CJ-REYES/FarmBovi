import { useState } from 'react';
import { Settings, MapPin, Sliders, Bell as BellIcon, Save } from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('rancho');

  return (
    <div className="space-y-6 animate-in fade-in duration-300 h-full flex flex-col pb-8">
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Administración</span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Configuración del Sistema</h1>
      </header>

      <div className="flex flex-col md:flex-row gap-8 flex-1">
        {/* Menú de Configuración */}
        <aside className="w-full md:w-56 shrink-0 space-y-1">
          <button onClick={() => setActiveTab('rancho')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${activeTab === 'rancho' ? 'bg-surface-secondary text-brand-primary' : 'text-brand-slate hover:bg-surface-secondary/50'}`}>
            <MapPin size={16} /> Datos del Rancho
          </button>
          <button onClick={() => setActiveTab('visuales')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${activeTab === 'visuales' ? 'bg-surface-secondary text-brand-primary' : 'text-brand-slate hover:bg-surface-secondary/50'}`}>
            <Sliders size={16} /> Preferencias Visuales
          </button>
          <button onClick={() => setActiveTab('notificaciones')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${activeTab === 'notificaciones' ? 'bg-surface-secondary text-brand-primary' : 'text-brand-slate hover:bg-surface-secondary/50'}`}>
            <BellIcon size={16} /> Notificaciones
          </button>
        </aside>

        {/* Panel Activo */}
        <div className="flex-1 bg-surface-white border border-border-light rounded-xl shadow-sm p-6 lg:p-8">

          {activeTab === 'rancho' && (
            <div className="max-w-xl space-y-6 animate-in fade-in">
              <div className="mb-6">
                <h2 className="text-[18px] font-bold text-brand-slate flex items-center gap-2"><MapPin size={20} className="text-brand-primary"/> Información Institucional</h2>
                <p className="text-[13px] text-brand-slate/60 mt-1">Configura los datos base de la explotación ganadera. (Solo lectura en frontend).</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-semibold text-brand-slate mb-1">Nombre del Rancho</label>
                  <input type="text" disabled value="El Porvenir (Principal)" className="w-full h-[40px] px-3 bg-surface-secondary/50 border border-border-light rounded-md text-[14px] text-brand-slate/60 outline-none" />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-brand-slate mb-1">Ubicación Geográfica</label>
                  <input type="text" disabled value="Candelaria, Campeche, México" className="w-full h-[40px] px-3 bg-surface-secondary/50 border border-border-light rounded-md text-[14px] text-brand-slate/60 outline-none" />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-brand-slate mb-1">Tipo de Explotación</label>
                  <input type="text" disabled value="Doble Propósito (Cría y Engorda)" className="w-full h-[40px] px-3 bg-surface-secondary/50 border border-border-light rounded-md text-[14px] text-brand-slate/60 outline-none" />
                </div>
              </div>
              <div className="pt-4 border-t border-border-light">
                <button disabled className="flex items-center gap-2 bg-brand-primary/50 text-white px-6 h-[40px] rounded-md font-semibold text-[13px] cursor-not-allowed"><Save size={16} /> Actualizar Información</button>
              </div>
            </div>
          )}

          {activeTab !== 'rancho' && (
             <div className="max-w-xl space-y-6 animate-in fade-in">
               <h2 className="text-[18px] font-bold text-brand-slate flex items-center gap-2">
                 <Settings size={20} className="text-brand-primary"/> Configuración Local
               </h2>
               <p className="text-[13px] text-brand-slate/60 mt-1">Las preferencias de caché local, offline y notificaciones push se activarán con el módulo PWA Service Worker.</p>
             </div>
          )}

        </div>
      </div>
    </div>
  );
}
