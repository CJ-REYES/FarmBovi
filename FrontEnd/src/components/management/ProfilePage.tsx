import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Save,
  Shield,
  SlidersHorizontal,
  Trash2,
  User,
  UserCircle,
  X
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useSharedCattle } from '../../hooks/useCattle';
import { resolveMediaUrl } from '../../lib/api';
import { AuthService, getUserInitials } from '../../services/auth.service';
import {
  DEFAULT_USER_CONFIG,
  type DateFormatPref,
  type UserConfig,
  type WeightUnitPref
} from '../../types/auth';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { session, isAuthenticated, logout } = useAuth();
  const { ranches } = useSharedCattle();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);

  // Formulario Datos de Perfil
  const [nombre, setNombre] = useState<string>(() => session?.nombre || '');
  const [correo, setCorreo] = useState<string>(() => session?.correo || '');
  const [savingProfile, setSavingProfile] = useState<boolean>(false);

  // Formulario Cambio de Contraseña
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>('');
  const [showPasswords, setShowPasswords] = useState<boolean>(false);
  const [savingPassword, setSavingPassword] = useState<boolean>(false);

  // Formulario Configuración del Usuario
  const [config, setConfig] = useState<UserConfig>(
    () => session?.configuracion ?? { ...DEFAULT_USER_CONFIG }
  );
  const [savingConfig, setSavingConfig] = useState<boolean>(false);

  // Estado de foto de perfil
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);

  // Mensajes de estado
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hidratar datos reales desde GET /api/usuarios/me al abrir el perfil
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let active = true;
    void (async () => {
      try {
        const me = await AuthService.refreshProfile();
        if (!active) return;
        setNombre(me.nombre);
        setCorreo(me.correo);
        if (me.configuracion) {
          setConfig(me.configuracion);
        }
      } catch {
        // En modo offline conservar los valores actuales de la sesión
      }
    })();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  const resolvedPhotoUrl = resolveMediaUrl(session?.fotoPerfilUrl);
  const showPhoto = Boolean(resolvedPhotoUrl && failedPhotoUrl !== resolvedPhotoUrl);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handlePhotoSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingPhoto(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      await AuthService.uploadProfilePhoto(file);
      setFailedPhotoUrl(null);
      setFeedback('Foto de perfil actualizada correctamente.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo subir la foto de perfil.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDeletePhoto = async () => {
    setUploadingPhoto(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      await AuthService.deleteProfilePhoto();
      setFailedPhotoUrl(null);
      setFeedback('Foto de perfil eliminada.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo eliminar la foto de perfil.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleUpdateProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const updated = await AuthService.updateProfile({ nombre, correo });
      setNombre(updated.nombre);
      setCorreo(updated.correo);
      setFeedback('Datos del usuario actualizados correctamente.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudieron actualizar tus datos.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);

    if (confirmNewPassword && newPassword !== confirmNewPassword) {
      setErrorMsg('La confirmación de la nueva contraseña no coincide.');
      return;
    }

    setSavingPassword(true);
    try {
      const msg = await AuthService.changePassword({
        contrasenaActual: currentPassword,
        nuevaContrasena: newPassword
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setFeedback(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const updated = await AuthService.updateConfig(config);
      if (updated.configuracion) {
        setConfig(updated.configuracion);
      }
      setFeedback('Configuración del usuario guardada en el servidor.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo guardar la configuración del usuario.'
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const availableRanches =
    ranches.length > 0
      ? ranches.map((r) => ({ id: r.id, nombre: r.nombre }))
      : (session?.ranchos ?? []).map((r) => ({ id: r.idRancho, nombre: r.nombre }));

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-10 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            Cuenta de Usuario
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Mi Perfil y Configuración
          </h1>
        </div>

        {isAuthenticated && session && (
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-4 h-[38px] rounded-lg border border-status-danger/35 text-status-danger hover:bg-status-danger/10 text-[13px] font-semibold transition-colors self-start sm:self-auto cursor-pointer"
          >
            <LogOut size={15} /> Cerrar sesión
          </button>
        )}
      </header>

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

      {!isAuthenticated || !session ? (
        <div className="bg-surface-white border border-border-light rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="font-bold text-[15px] text-brand-forest">
              Conecta tu cuenta con el servidor FarmBovi
            </p>
            <p className="text-[13px] text-brand-slate/70">
              Inicia sesión con tus credenciales para administrar tu perfil, contraseña y foto.
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
      ) : (
        <>
          {/* Cabecera con Foto de Perfil */}
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
            <div className="h-28 bg-gradient-to-r from-brand-forest to-brand-primary w-full relative">
              <div className="absolute -bottom-12 left-6 sm:left-8 w-24 h-24 bg-surface-white rounded-full border-4 border-surface-white flex items-center justify-center shadow-md overflow-hidden">
                {showPhoto && resolvedPhotoUrl ? (
                  <img
                    src={resolvedPhotoUrl}
                    alt={`Foto de perfil de ${session.nombre}`}
                    onError={() => setFailedPhotoUrl(resolvedPhotoUrl)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="w-full h-full rounded-full bg-brand-forest text-white font-condensed text-3xl font-bold flex items-center justify-center">
                    {getUserInitials(session.nombre)}
                  </span>
                )}
              </div>
            </div>

            <div className="pt-16 pb-6 px-6 sm:px-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-brand-slate">{session.nombre}</h2>
                <p className="text-[13px] text-brand-slate/70 flex items-center gap-1.5 mt-0.5">
                  <Mail size={14} className="text-brand-primary" />
                  <span>{session.correo}</span>
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-[12px] text-brand-slate/65">
                  <span className="inline-flex items-center gap-1">
                    <Shield size={13} className="text-brand-primary" />
                    Rol: {session.ranchos[0]?.rol || 'Productor'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={13} className="text-brand-primary" />
                    Expira: {new Date(session.expiraEn).toLocaleString('es-MX')}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Seleccionar foto de perfil"
                  onChange={(e) => void handlePhotoSelected(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 h-[38px] rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {uploadingPhoto ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Procesando...
                    </>
                  ) : (
                    <>
                      <Camera size={15} /> {showPhoto ? 'Cambiar foto' : 'Subir foto de perfil'}
                    </>
                  )}
                </button>
                {session.fotoPerfilUrl && (
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={() => void handleDeletePhoto()}
                    className="inline-flex items-center gap-1.5 px-3 h-[38px] rounded-lg border border-status-danger/30 text-status-danger hover:bg-status-danger/10 text-[13px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 size={14} /> Quitar foto
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* CRUD 1: Actualizar datos del usuario */}
            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/40">
                <h3 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                  <UserCircle size={17} className="text-brand-primary" /> Datos del Usuario
                </h3>
              </div>
              <form
                onSubmit={(e) => void handleUpdateProfile(e)}
                noValidate
                className="p-5 space-y-4"
              >
                <div>
                  <label
                    htmlFor="profile-nombre"
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
                      id="profile-nombre"
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="profile-correo"
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
                      id="profile-correo"
                      type="email"
                      value={correo}
                      onChange={(e) => setCorreo(e.target.value)}
                      className="w-full h-[42px] pl-10 pr-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingProfile}
                  className="inline-flex items-center justify-center gap-2 px-5 h-[42px] rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {savingProfile ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Guardando...
                    </>
                  ) : (
                    <>
                      <Save size={15} /> Guardar Datos
                    </>
                  )}
                </button>
              </form>
            </section>

            {/* CRUD 2: Cambiar Contraseña */}
            <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border-light bg-surface-app/40 flex items-center justify-between">
                <h3 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                  <Lock size={17} className="text-brand-primary" /> Cambiar Contraseña
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPasswords((p) => !p)}
                  className="text-[12px] font-semibold text-brand-slate/65 hover:text-brand-primary inline-flex items-center gap-1 cursor-pointer"
                >
                  {showPasswords ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span>{showPasswords ? 'Ocultar' : 'Mostrar'}</span>
                </button>
              </div>
              <form
                onSubmit={(e) => void handleChangePassword(e)}
                noValidate
                className="p-5 space-y-3.5"
              >
                <div>
                  <label
                    htmlFor="profile-pwd-current"
                    className="block text-[13px] font-semibold text-brand-slate mb-1"
                  >
                    Contraseña actual *
                  </label>
                  <input
                    id="profile-pwd-current"
                    type={showPasswords ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Tu contraseña actual"
                    className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-pwd-new"
                    className="block text-[13px] font-semibold text-brand-slate mb-1"
                  >
                    Nueva contraseña *
                  </label>
                  <input
                    id="profile-pwd-new"
                    type={showPasswords ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-pwd-confirm"
                    className="block text-[13px] font-semibold text-brand-slate mb-1"
                  >
                    Confirmar nueva contraseña *
                  </label>
                  <input
                    id="profile-pwd-confirm"
                    type={showPasswords ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Repite la nueva contraseña"
                    className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-lg text-[14px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingPassword}
                  className="inline-flex items-center justify-center gap-2 px-5 h-[42px] rounded-lg bg-brand-forest hover:bg-brand-dark text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {savingPassword ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Actualizando...
                    </>
                  ) : (
                    <>
                      <Lock size={15} /> Actualizar Contraseña
                    </>
                  )}
                </button>
              </form>
            </section>
          </div>

          {/* CRUD 3: Configuración y Preferencias del Usuario */}
          <section className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border-light bg-surface-app/40">
              <h3 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                <SlidersHorizontal size={17} className="text-brand-primary" /> Configuración y
                Preferencias de Cuenta
              </h3>
            </div>
            <form
              onSubmit={(e) => void handleSaveConfig(e)}
              noValidate
              className="p-5 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label
                    htmlFor="config-unidad-peso"
                    className="block text-[12px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
                  >
                    Unidad de peso
                  </label>
                  <select
                    id="config-unidad-peso"
                    value={config.unidadPeso}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        unidadPeso: e.target.value as WeightUnitPref
                      }))
                    }
                    className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-lg text-[13px] text-brand-slate outline-none focus:border-brand-primary"
                  >
                    <option value="kg">Kilogramos (kg)</option>
                    <option value="lb">Libras (lb)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="config-dias-alertas"
                    className="block text-[12px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
                  >
                    Anticipación de alertas (días)
                  </label>
                  <input
                    id="config-dias-alertas"
                    type="number"
                    min={1}
                    max={90}
                    value={config.diasAvisoAlertas}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        diasAvisoAlertas: Number(e.target.value) || 7
                      }))
                    }
                    className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-lg text-[13px] text-brand-slate outline-none focus:border-brand-primary"
                  />
                </div>

                <div>
                  <label
                    htmlFor="config-formato-fecha"
                    className="block text-[12px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
                  >
                    Formato de fecha
                  </label>
                  <select
                    id="config-formato-fecha"
                    value={config.formatoFecha}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        formatoFecha: e.target.value as DateFormatPref
                      }))
                    }
                    className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-lg text-[13px] text-brand-slate outline-none focus:border-brand-primary"
                  >
                    <option value="dd/MM/yyyy">DD/MM/AAAA</option>
                    <option value="yyyy-MM-dd">AAAA-MM-DD</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="config-rancho-default"
                    className="block text-[12px] font-bold uppercase tracking-wider text-brand-slate/65 mb-1"
                  >
                    Rancho predeterminado
                  </label>
                  <select
                    id="config-rancho-default"
                    value={config.ranchoPredeterminadoId || ''}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        ranchoPredeterminadoId: e.target.value || null
                      }))
                    }
                    className="w-full h-[40px] px-3 bg-surface-app border border-border-light rounded-lg text-[13px] text-brand-slate outline-none focus:border-brand-primary"
                  >
                    <option value="">Automático (primero disponible)</option>
                    {availableRanches.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-[13px] text-brand-slate cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.sincronizacionAutomatica}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      sincronizacionAutomatica: e.target.checked
                    }))
                  }
                  className="w-4 h-4 accent-brand-primary rounded"
                />
                <span>Habilitar sincronización automática en segundo plano al recuperar conexión</span>
              </label>

              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex items-center justify-center gap-2 px-5 h-[42px] rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {savingConfig ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Guardando configuración...
                  </>
                ) : (
                  <>
                    <Save size={15} /> Guardar Configuración
                  </>
                )}
              </button>
            </form>
          </section>

          {/* Ranchos asignados */}
          <section className="bg-surface-white border border-border-light rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-bold uppercase tracking-wider text-brand-slate/65 flex items-center gap-1.5">
                <MapPin size={14} className="text-brand-primary" /> Ranchos asignados (
                {session.ranchos.length})
              </h3>
              <Link
                to="/ranches"
                className="text-[12px] font-semibold text-brand-primary hover:underline"
              >
                Administrar ranchos →
              </Link>
            </div>
            {session.ranchos.length === 0 ? (
              <p className="text-[13px] text-brand-slate/65">
                Aún no tienes ranchos asignados. Registra uno desde la sección{' '}
                <Link to="/ranches" className="text-brand-primary font-semibold underline">
                  Ranchos
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {session.ranchos.map((r) => (
                  <div
                    key={r.idRancho}
                    className="p-3 rounded-lg bg-surface-app border border-border-light flex items-center justify-between gap-2"
                  >
                    <span className="font-semibold text-[13px] text-brand-slate truncate">
                      {r.nombre}
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary shrink-0">
                      {r.rol}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
