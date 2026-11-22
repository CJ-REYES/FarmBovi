import { Link, useNavigate } from 'react-router-dom';
import {
  UserCircle,
  Mail,
  Shield,
  LogOut,
  LogIn,
  MapPin,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getUserInitials } from '../../services/auth.service';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { session, isAuthenticated, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8 max-w-4xl mx-auto">
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
          Cuenta de Usuario
        </span>
        <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
          Mi Perfil
        </h1>
      </header>

      <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
        {/* Banner */}
        <div className="h-32 bg-gradient-to-r from-brand-forest to-brand-primary w-full relative">
          <div className="absolute -bottom-12 left-8 w-24 h-24 bg-surface-white rounded-full border-4 border-surface-white flex items-center justify-center shadow-md">
            {isAuthenticated && session ? (
              <span className="w-full h-full rounded-full bg-brand-forest text-white font-condensed text-3xl font-bold flex items-center justify-center">
                {getUserInitials(session.nombre)}
              </span>
            ) : (
              <UserCircle size={64} strokeWidth={1} className="text-brand-slate/30" />
            )}
          </div>
        </div>

        <div className="pt-16 pb-8 px-6 sm:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-8 border-b border-border-light pb-6">
            <div>
              <h2 className="text-2xl font-bold text-brand-slate">
                {isAuthenticated && session ? session.nombre : 'Modo Local Offline'}
              </h2>
              <p className="text-[14px] text-brand-slate/65 flex items-center gap-1.5 mt-1">
                <Shield size={14} className="text-brand-primary" />
                {isAuthenticated && session
                  ? `Ranchos autorizados: ${session.ranchos.length}`
                  : 'Inicia sesión para sincronizar tus datos con el servidor'}
              </p>
            </div>
            {isAuthenticated ? (
              <span className="inline-flex items-center gap-1.5 bg-status-success/15 text-status-success border border-status-success/30 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide self-start">
                <CheckCircle2 size={13} /> Sesión JWT Activa
              </span>
            ) : (
              <span className="bg-status-warning/15 text-brand-dark border border-status-warning/30 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide self-start">
                Sesión Local (Sin autenticar)
              </span>
            )}
          </div>

          {isAuthenticated && session ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-5">
                <h3 className="text-[14px] font-bold text-brand-slate uppercase tracking-wider border-b border-border-light pb-2">
                  Datos de Cuenta
                </h3>
                <div>
                  <label className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Nombre Completo
                  </label>
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-brand-slate mt-1">
                    <UserCircle size={16} className="text-brand-primary" />
                    {session.nombre}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Correo Electrónico
                  </label>
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-brand-slate mt-1">
                    <Mail size={16} className="text-brand-primary" />
                    {session.correo}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-brand-slate/50 uppercase">
                    Vigencia del Token JWT
                  </label>
                  <div className="flex items-center gap-2 text-[13px] text-brand-slate/80 mt-1">
                    <Clock size={15} className="text-brand-primary" />
                    Expira: {new Date(session.expiraEn).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <h3 className="text-[14px] font-bold text-brand-slate uppercase tracking-wider border-b border-border-light pb-2">
                  Ranchos y Sesión
                </h3>
                {session.ranchos.length === 0 ? (
                  <p className="text-[13px] text-brand-slate/70">
                    Aún no tienes ranchos asignados.{' '}
                    <Link to="/settings" className="text-brand-primary font-semibold hover:underline">
                      Registrar rancho ahora
                    </Link>
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {session.ranchos.map((r) => (
                      <li
                        key={r.idRancho}
                        className="p-3 rounded-lg bg-surface-app border border-border-light flex items-center justify-between gap-2 text-[13px]"
                      >
                        <span className="font-semibold text-brand-forest flex items-center gap-1.5">
                          <MapPin size={14} className="text-brand-primary" /> {r.nombre}
                        </span>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary">
                          {r.rol}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 p-3 border border-status-danger/30 bg-status-danger/10 rounded-lg text-status-danger hover:bg-status-danger hover:text-white font-semibold text-[14px] transition-colors cursor-pointer"
                >
                  <LogOut size={16} /> Cerrar Sesión Segura
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-xl bg-surface-app border border-border-light">
              <div className="space-y-1">
                <p className="font-bold text-[15px] text-brand-forest">
                  Conecta tu cuenta con el servidor FarmBovi
                </p>
                <p className="text-[13px] text-brand-slate/70">
                  Inicia sesión con tus credenciales para habilitar el envío Push/Pull y la gestión
                  de ranchos en la nube.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors"
                >
                  <LogIn size={15} /> Iniciar Sesión
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-border-light bg-surface-white hover:border-brand-primary text-brand-slate text-[13px] font-semibold transition-colors"
                >
                  Crear Cuenta
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
