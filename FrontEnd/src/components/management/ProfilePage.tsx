import { UserCircle, Mail, Shield, LogOut, Key } from 'lucide-react';

export default function ProfilePage() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8 max-w-4xl mx-auto">
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Cuenta de Usuario</span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">Mi Perfil</h1>
      </header>

      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
        {/* Banner */}
        <div className="h-32 bg-brand-primary w-full relative">
          <div className="absolute -bottom-12 left-8 w-24 h-24 bg-surface-white rounded-full border-4 border-surface-white flex items-center justify-center shadow-sm">
            <UserCircle size={64} strokeWidth={1} className="text-brand-slate/30" />
          </div>
        </div>

        <div className="pt-16 pb-8 px-8">
          <div className="flex justify-between items-start mb-8 border-b border-border-light pb-6">
            <div>
              <h2 className="text-2xl font-bold text-brand-slate">Administrador Local</h2>
              <p className="text-[14px] text-brand-slate/60 flex items-center gap-1.5 mt-1"><Shield size={14} /> Nivel de Acceso: Propietario</p>
            </div>
            <span className="bg-status-warning/10 text-status-warning border border-status-warning/20 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide">
              Sesión Local (Sin Nube)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-5">
              <h3 className="text-[14px] font-bold text-brand-slate uppercase tracking-wider mb-2 border-b border-border-light pb-2">Datos Personales</h3>
              <div>
                <label className="text-[12px] font-bold text-brand-slate/50 uppercase">Nombre Completo</label>
                <div className="flex items-center gap-2 text-[14px] font-semibold text-brand-slate mt-1"><UserCircle size={16} className="text-brand-primary"/> Usuario FarmBovi</div>
              </div>
              <div>
                <label className="text-[12px] font-bold text-brand-slate/50 uppercase">Correo de Respaldo</label>
                <div className="flex items-center gap-2 text-[14px] font-semibold text-brand-slate mt-1"><Mail size={16} className="text-brand-primary"/> admin@farmbovi.local</div>
              </div>
            </div>

            <div className="space-y-5">
              <h3 className="text-[14px] font-bold text-brand-slate uppercase tracking-wider mb-2 border-b border-border-light pb-2">Seguridad y Acceso</h3>
              <button disabled className="w-full flex items-center justify-between p-3 border border-border-light rounded-lg text-brand-slate hover:bg-surface-secondary/50 transition-colors opacity-60 cursor-not-allowed">
                <span className="flex items-center gap-2 text-[14px] font-medium"><Key size={16} className="text-brand-primary"/> Cambiar Contraseña</span>
              </button>
              <button disabled className="w-full flex items-center justify-between p-3 border border-status-error/20 bg-status-error/5 rounded-lg text-status-error hover:bg-status-error/10 transition-colors opacity-60 cursor-not-allowed">
                <span className="flex items-center gap-2 text-[14px] font-medium"><LogOut size={16} /> Cerrar Sesión Segura</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
