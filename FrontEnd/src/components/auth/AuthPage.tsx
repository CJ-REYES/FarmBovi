import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MapPin,
  ShieldCheck,
  User,
  UserPlus,
  WifiOff
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useConnectivity } from '../../hooks/useConnectivity';
import { AuthService } from '../../services/auth.service';
import { RanchService } from '../../services/ranch.service';
import { resolveSafeRedirectPath, type RedirectLocationState } from './redirect.utils';

export type AuthViewMode = 'login' | 'register' | 'ranch';

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

  const [step, setStep] = useState<'auth' | 'ranch-onboarding'>(() =>
    initialMode === 'ranch' ? 'ranch-onboarding' : 'auth'
  );
  const [authTab, setAuthTab] = useState<'login' | 'register'>(() =>
    initialMode === 'register' ? 'register' : 'login'
  );
  const [animDir, setAnimDir] = useState<'right' | 'left'>('right');
  const [checkingRanchFromBackend, setCheckingRanchFromBackend] = useState<boolean>(
    () => initialMode === 'ranch'
  );

  // Login (`POST /api/auth/login`)
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Crear Cuenta (`POST /api/usuarios`)
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Paso 2 — Registrar Rancho (`POST /api/ranchos`), solo si el Backend confirma 0 ranchos
  const [ranchName, setRanchName] = useState('');
  const [ranchLocation, setRanchLocation] = useState('');
  const [ranchState, setRanchState] = useState('Activo');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(() =>
    redirectState?.reason === 'expired'
      ? 'Tu sesión ha expirado. Inicia sesión nuevamente para continuar.'
      : null
  );
  const [adminAuthNotice, setAdminAuthNotice] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(() => {
    if (redirectState?.reason === 'auth-required') {
      return 'Inicia sesión con tu cuenta para acceder a esta sección de FarmBovi.';
    }
    if (redirectState?.reason === 'ranch-required') {
      return 'Completa el registro de tu rancho para habilitar el panel de trabajo.';
    }
    return null;
  });

  // Si alguien entra directo a `/ranch-setup`, consultar al Backend:
  // - Sin sesión -> volver a `/login`
  // - Si el Backend confirma que ya tiene rancho -> ir directo al destino (`/dashboard` o ruta original) sin mostrar formulario
  useEffect(() => {
    if (initialMode !== 'ranch') return undefined;

    let active = true;
    void (async () => {
      if (!AuthService.getSnapshot()?.token) {
        if (active) {
          setCheckingRanchFromBackend(false);
          setStep('auth');
          setAuthTab('login');
        }
        return;
      }

      const hasRanch = await AuthService.verifyHasRanchFromBackend();
      if (!active) return;

      if (hasRanch) {
        navigate(postAuthTarget, { replace: true });
      } else {
        setStep('ranch-onboarding');
        setCheckingRanchFromBackend(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [initialMode, navigate, postAuthTarget]);

  const switchAuthTab = (nextTab: 'login' | 'register') => {
    setAnimDir(nextTab === 'register' ? 'right' : 'left');
    setAuthTab(nextTab);
    setStep('auth');
    setErrorMsg(null);
    setAdminAuthNotice(null);
    setInfoMsg(null);
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAdminAuthNotice(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const { session: nextSession, hasRanch } = await AuthService.login(
        loginEmail,
        loginPassword
      );
      if (hasRanch) {
        // El Backend confirmó que ya tiene al menos un rancho -> entrar directo sin mostrar formulario
        navigate(postAuthTarget, { replace: true });
      } else {
        // El Backend confirmó que no tiene rancho -> mostrar paso de registro de rancho
        setAnimDir('right');
        setStep('ranch-onboarding');
        setInfoMsg(
          `Hola, ${nextSession.nombre}. El servidor indica que aún no tienes un rancho registrado; complétalo para continuar.`
        );
      }
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
    setAdminAuthNotice(null);
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
        contrasena: regPassword,
        estado: 'Activo'
      });

      if (!result.ok) {
        if (result.requiresAdminAuth) {
          setAdminAuthNotice(result.message);
        } else {
          setErrorMsg(result.message);
        }
        return;
      }

      if (result.session && !result.hasRanch) {
        // Paso 1 completo -> avanzar con animación al Paso 2: Registrar Rancho
        setAnimDir('right');
        setStep('ranch-onboarding');
        setInfoMsg(result.message);
      } else if (result.session && result.hasRanch) {
        navigate(postAuthTarget, { replace: true });
      } else {
        // Cuenta creada pero requiere login manual
        setLoginEmail(regEmail.trim().toLowerCase());
        switchAuthTab('login');
        setInfoMsg(result.message);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo registrar la cuenta en el servidor.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRanchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAdminAuthNotice(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await RanchService.registerOnBackend({
        nombre: ranchName,
        ubicacionGeneral: ranchLocation,
        estado: ranchState
      });
      navigate(postAuthTarget, { replace: true });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo registrar el rancho en el servidor.'
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
              <ShieldCheck size={13} /> Validación centralizada en Backend
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-condensed font-bold leading-tight">
              {step === 'ranch-onboarding'
                ? 'Último paso: registra tu rancho para comenzar.'
                : 'Tu hato organizado en campo y sincronizado en el servidor.'}
            </h1>
            <p className="text-[14px] text-white/80 leading-relaxed max-w-md">
              {step === 'ranch-onboarding'
                ? 'El servidor verificó que tu cuenta aún no tiene un rancho activo. Regístralo ahora y el Backend te asignará automáticamente como administrador.'
                : 'Inicia sesión o crea tu cuenta. El servidor valida tus credenciales y comprueba si ya tienes un rancho asignado antes de llevarte al panel.'}
            </p>
          </div>

          <div className="hidden lg:grid grid-cols-1 gap-3 pt-2 fb-anim-fade-up fb-anim-delay-2">
            <div className="p-3.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-xs">
              <p className="text-[12px] font-bold text-brand-yellow">Paso 1 · Cuenta y Sesión JWT</p>
              <p className="text-[12px] text-white/80 mt-0.5">
                Autenticación en `POST /api/auth/login` y registro de usuario en `POST /api/usuarios`.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-xs">
              <p className="text-[12px] font-bold text-brand-yellow">Paso 2 · Rancho automático</p>
              <p className="text-[12px] text-white/80 mt-0.5">
                Solo aparece si el Backend confirma que tu cuenta aún no cuenta con un rancho
                registrado (`GET /api/ranchos` → `POST /api/ranchos`).
              </p>
            </div>
          </div>
        </div>

        <div className="relative pt-8 mt-8 border-t border-white/15 flex items-center justify-between text-[12px] text-white/75">
          <span>PWA Offline-First · v0.1.0</span>
          <span className="font-semibold text-brand-yellow">Acceso protegido · Sesión JWT</span>
        </div>
      </aside>

      {/* Panel Derecho: Formularios Animados */}
      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md bg-surface-white border border-border-light rounded-2xl shadow-xl p-6 sm:p-8 space-y-6 fb-anim-fade-up">
          {!isOnline && (
            <div
              role="status"
              className="p-3 rounded-xl bg-status-warning/15 border border-status-warning/35 text-brand-dark text-[12px] flex items-center gap-2"
            >
              <WifiOff size={15} className="text-status-warning shrink-0" />
              <span>
                Sin conexión a Internet. Las comprobaciones de acceso requieren conexión con el
                Backend; puedes trabajar en modo local offline.
              </span>
            </div>
          )}

          {checkingRanchFromBackend ? (
            <div className="py-12 text-center space-y-3 text-brand-slate/70">
              <Loader2 size={26} className="animate-spin mx-auto text-brand-primary" />
              <p className="text-[13px] font-medium">
                Verificando estado de tus ranchos en el servidor…
              </p>
            </div>
          ) : step === 'ranch-onboarding' ? (
            /* PASO 2 AUTOMÁTICO: REGISTRAR RANCHO (SOLO SI EL BACKEND CONFIRMA 0 RANCHOS) */
            <div key="frame-ranch-onboarding" className={`space-y-5 ${frameAnimClass}`}>
              {/* Indicador de pasos */}
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-status-success/15 text-status-success">
                  <CheckCircle2 size={12} /> 1. Cuenta
                </span>
                <span className="h-px flex-1 bg-border-light" />
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-primary text-white">
                  2. Registrar Rancho
                </span>
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

              <form onSubmit={(e) => void handleRanchSubmit(e)} noValidate className="space-y-4">
                <div>
                  <h2 className="text-2xl font-condensed font-bold text-brand-forest">
                    Registra tu Rancho
                  </h2>
                  <p className="text-[13px] text-brand-slate/65">
                    Completa los datos requeridos por el servidor para activar tu espacio de trabajo
                    {session?.nombre ? ` (${session.nombre})` : ''}.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="onboarding-ranch-name"
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
                      id="onboarding-ranch-name"
                      type="text"
                      value={ranchName}
                      onChange={(e) => setRanchName(e.target.value)}
                      placeholder="Ej. Rancho El Encino"
                      className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="onboarding-ranch-location"
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
                      id="onboarding-ranch-location"
                      type="text"
                      value={ranchLocation}
                      onChange={(e) => setRanchLocation(e.target.value)}
                      placeholder="Ej. Candelaria, Campeche, México"
                      className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="onboarding-ranch-state"
                    className="block text-[13px] font-semibold text-brand-slate mb-1"
                  >
                    Estado *
                  </label>
                  <select
                    id="onboarding-ranch-state"
                    value={ranchState}
                    onChange={(e) => setRanchState(e.target.value)}
                    className="w-full h-[42px] px-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  >
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-dark text-white rounded-xl font-semibold text-[14px] shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Registrando rancho...
                    </>
                  ) : (
                    <>
                      <span>Guardar Rancho y Entrar</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* PASO 1: LOGIN O CREAR CUENTA (SOLO 2 PESTAÑAS) */
            <>
              {isAuthenticated && session && session.ranchos.length > 0 && (
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

              {adminAuthNotice && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/35 text-brand-dark text-[12px] space-y-2.5"
                >
                  <p className="font-semibold">{adminAuthNotice}</p>
                  <p className="text-brand-slate/75">
                    Nota del Backend: `POST /api/usuarios` actualmente requiere sesión JWT de un
                    administrador de rancho.
                  </p>
                  <button
                    type="button"
                    onClick={() => switchAuthTab('login')}
                    className="px-3 py-1.5 rounded-lg bg-brand-primary text-white font-semibold text-[12px] cursor-pointer"
                  >
                    Ir a Iniciar Sesión
                  </button>
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
                      Si aún no tienes un rancho registrado, te pediremos registrarlo al entrar.
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
                        <Loader2 size={16} className="animate-spin" /> Verificando en el servidor...
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
                      Paso 1 de 2 · Después de crear tu cuenta te pediremos registrar tu rancho.
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
                        <span>Crear Cuenta y Continuar</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
