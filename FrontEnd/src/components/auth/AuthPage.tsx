import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  UserPlus,
  WifiOff
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useConnectivity } from '../../hooks/useConnectivity';
import { AuthService } from '../../services/auth.service';
import { resolveSafeRedirectPath, type RedirectLocationState } from './redirect.utils';

export type AuthViewMode = 'login' | 'register';

interface AuthPageProps {
  initialMode?: AuthViewMode;
}

export default function AuthPage({ initialMode = 'login' }: AuthPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectState = (location.state as RedirectLocationState | null) ?? null;
  const postAuthTarget = resolveSafeRedirectPath(redirectState, '/dashboard');
  const { isAuthenticated, session } = useAuth();
  const { isOnline } = useConnectivity();

  const [authTab, setAuthTab] = useState<'login' | 'register'>(() =>
    initialMode === 'register' ? 'register' : 'login'
  );
  const [animDir, setAnimDir] = useState<'right' | 'left'>('right');

  // Login (`POST /api/auth/login`)
  const [loginEmail, setLoginEmail] = useState(() => redirectState?.registeredEmail ?? '');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Crear Cuenta (`POST /api/auth/register`)
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(() =>
    redirectState?.reason === 'expired'
      ? 'Tu sesión ha expirado. Inicia sesión nuevamente para continuar.'
      : null
  );
  const [infoMsg, setInfoMsg] = useState<string | null>(() => {
    if (redirectState?.infoMsg) return redirectState.infoMsg;
    if (redirectState?.reason === 'auth-required') {
      return 'Inicia sesión con tu cuenta para acceder a FarmBovi.';
    }
    return null;
  });

  const switchAuthTab = (nextTab: 'login' | 'register') => {
    setAnimDir(nextTab === 'register' ? 'right' : 'left');
    setAuthTab(nextTab);
    setErrorMsg(null);
    setInfoMsg(null);
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await AuthService.login(loginEmail, loginPassword);
      navigate(postAuthTarget, { replace: true });
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar sesión. Verifica tus credenciales y el Backend.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (regConfirmPassword && regPassword !== regConfirmPassword) {
      setErrorMsg('La confirmación de contraseña no coincide.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await AuthService.registerUser({
        nombre: regName,
        correo: regEmail,
        contrasena: regPassword
      });

      const createdEmail = result.correo || regEmail.trim().toLowerCase();
      setRegName('');
      setRegEmail('');
      setRegPassword('');
      setRegConfirmPassword('');
      setLoginEmail(createdEmail);
      setLoginPassword('');
      setAnimDir('left');
      setAuthTab('login');
      setInfoMsg(result.message);

      if (location.pathname !== '/login') {
        navigate('/login', {
          replace: true,
          state: {
            ...redirectState,
            registeredEmail: createdEmail,
            infoMsg: result.message
          } satisfies RedirectLocationState
        });
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo registrar la cuenta en el servidor.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const frameAnimClass = animDir === 'right' ? 'fb-anim-frame-right' : 'fb-anim-frame-left';

  return (
    <div className="h-screen overflow-y-auto bg-surface-app flex flex-col lg:flex-row">
      {/* Panel Izquierdo Institucional con Frame Animations */}
      <aside className="relative lg:w-[44%] bg-gradient-to-br from-brand-forest via-brand-primary to-brand-dark text-white p-8 lg:p-12 flex flex-col justify-between overflow-hidden shrink-0">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-brand-yellow/15 blur-3xl pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-white/10 blur-3xl pointer-events-none"
        />

        <div className="relative space-y-8">
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-white/85 hover:text-white text-[13px] font-semibold"
            >
              <ArrowLeft size={16} />
              <span>Volver al inicio</span>
            </Link>
            <span className="font-condensed text-2xl font-bold tracking-wide">
              FARM<span className="text-brand-yellow">BOVI</span>
            </span>
          </div>

          <div className="space-y-4 pt-2 fb-anim-fade-up">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[11px] font-bold uppercase tracking-wider text-brand-yellow">
              <ShieldCheck size={13} /> Autenticación centralizada en Backend
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-condensed font-bold leading-tight">
              Tu hato organizado en campo y sincronizado en el servidor.
            </h1>
            <p className="text-[14px] text-white/80 leading-relaxed max-w-md">
              Inicia sesión o crea tu cuenta para administrar tus ranchos, potreros, expedientes
              individuales, pesajes, sanidad y reportes con soporte offline-first.
            </p>
          </div>

          <div className="hidden lg:grid grid-cols-1 gap-3 pt-2 fb-anim-fade-up fb-anim-delay-2">
            <div className="p-3.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-xs">
              <p className="text-[12px] font-bold text-brand-yellow">Acceso rápido y seguro</p>
              <p className="text-[12px] text-white/80 mt-0.5">
                Validación directa con el Backend (`POST /api/auth/login`) y sesión protegida con
                JWT.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-xs">
              <p className="text-[12px] font-bold text-brand-yellow">Gestión multi-rancho</p>
              <p className="text-[12px] text-white/80 mt-0.5">
                Al entrar podrás registrar y administrar todos los ranchos que necesites desde la
                sección Ranchos.
              </p>
            </div>
          </div>
        </div>

        <div className="relative pt-8 mt-8 border-t border-white/15 flex items-center justify-between text-[12px] text-white/75">
          <span>PWA Offline-First · v0.1.0</span>
          <span className="font-semibold text-brand-yellow">Acceso protegido · Sesión JWT</span>
        </div>
      </aside>

      {/* Panel Derecho: Login y Crear Cuenta */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md bg-surface-white border border-border-light rounded-2xl shadow-xl p-6 sm:p-8 space-y-6 fb-anim-fade-up">
          {!isOnline && (
            <div
              role="status"
              className="p-3 rounded-xl bg-status-warning/15 border border-status-warning/35 text-brand-dark text-[12px] flex items-center gap-2"
            >
              <WifiOff size={15} className="text-status-warning shrink-0" />
              <span>
                Sin conexión a Internet. Iniciar sesión o crear una cuenta requiere conexión con el
                Backend.
              </span>
            </div>
          )}

          {isAuthenticated && session && (
            <div className="p-3 rounded-xl bg-status-success/10 border border-status-success/30 text-status-success text-[12px] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 size={15} className="shrink-0" />
                <span className="truncate">
                  Sesión activa: <strong>{session.nombre}</strong>
                </span>
              </div>
              <Link to="/dashboard" className="font-bold underline shrink-0">
                Ir al Panel
              </Link>
            </div>
          )}

          {/* Selector de 2 Pestañas con transición */}
          <div
            role="tablist"
            aria-label="Modo de acceso"
            className="grid grid-cols-2 gap-1 p-1 bg-surface-secondary rounded-xl border border-border-light"
          >
            <button
              type="button"
              role="tab"
              aria-selected={authTab === 'login'}
              onClick={() => switchAuthTab('login')}
              className={`py-2.5 px-3 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer ${
                authTab === 'login'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-brand-slate/75 hover:text-brand-slate'
              }`}
            >
              Iniciar Sesión
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authTab === 'register'}
              onClick={() => switchAuthTab('register')}
              className={`py-2.5 px-3 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer ${
                authTab === 'register'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-brand-slate/75 hover:text-brand-slate'
              }`}
            >
              Crear Cuenta
            </button>
          </div>

          {infoMsg && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-status-success/10 border border-status-success/30 text-status-success text-[13px] flex items-start gap-2"
            >
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>{infoMsg}</span>
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

          {authTab === 'login' ? (
            <form
              key="frame-login"
              onSubmit={(e) => void handleLoginSubmit(e)}
              noValidate
              className={`space-y-4 ${frameAnimClass}`}
            >
              <div>
                <h2 className="text-2xl font-condensed font-bold text-brand-forest">
                  Inicia sesión en FarmBovi
                </h2>
                <p className="text-[13px] text-brand-slate/65">
                  Ingresa tu correo y contraseña para entrar al panel ganadero.
                </p>
              </div>

              <div>
                <label
                  htmlFor="auth-login-email"
                  className="block text-[13px] font-semibold text-brand-slate mb-1"
                >
                  Correo electrónico *
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                  />
                  <input
                    id="auth-login-email"
                    type="email"
                    autoComplete="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="productor@rancho.com"
                    className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="auth-login-password"
                  className="block text-[13px] font-semibold text-brand-slate mb-1"
                >
                  Contraseña *
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                  />
                  <input
                    id="auth-login-password"
                    type={showLoginPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Tu contraseña"
                    className="w-full h-[42px] pl-10 pr-10 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-brand-slate/50 hover:text-brand-slate cursor-pointer"
                  >
                    {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-dark text-white rounded-xl font-semibold text-[14px] shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Iniciando sesión...
                  </>
                ) : (
                  <>
                    <span>Iniciar Sesión</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form
              key="frame-register"
              onSubmit={(e) => void handleRegisterSubmit(e)}
              noValidate
              className={`space-y-4 ${frameAnimClass}`}
            >
              <div>
                <h2 className="text-2xl font-condensed font-bold text-brand-forest">
                  Crea tu cuenta
                </h2>
                <p className="text-[13px] text-brand-slate/65">
                  Registra tus datos de acceso para entrar a la plataforma.
                </p>
              </div>

              <div>
                <label
                  htmlFor="auth-reg-name"
                  className="block text-[13px] font-semibold text-brand-slate mb-1"
                >
                  Nombre completo *
                </label>
                <div className="relative">
                  <User
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                  />
                  <input
                    id="auth-reg-name"
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Ej. Carlos Reyes"
                    className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="auth-reg-email"
                  className="block text-[13px] font-semibold text-brand-slate mb-1"
                >
                  Correo electrónico *
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                  />
                  <input
                    id="auth-reg-email"
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="correo@rancho.com"
                    className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="auth-reg-password"
                  className="block text-[13px] font-semibold text-brand-slate mb-1"
                >
                  Contraseña *
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                  />
                  <input
                    id="auth-reg-password"
                    type={showRegPassword ? 'text' : 'password'}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full h-[42px] pl-10 pr-10 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword((p) => !p)}
                    aria-label="Alternar visibilidad de contraseña"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-brand-slate/50 hover:text-brand-slate cursor-pointer"
                  >
                    {showRegPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="auth-reg-confirm"
                  className="block text-[13px] font-semibold text-brand-slate mb-1"
                >
                  Confirmar contraseña *
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/45"
                  />
                  <input
                    id="auth-reg-confirm"
                    type={showRegPassword ? 'text' : 'password'}
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="Repite tu contraseña"
                    className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-dark text-white rounded-xl font-semibold text-[14px] shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Creando cuenta...
                  </>
                ) : (
                  <>
                    <UserPlus size={16} />
                    <span>Crear Cuenta</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
