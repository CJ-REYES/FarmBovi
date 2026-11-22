import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Beef,
  Camera,
  CheckCircle2,
  CloudUpload,
  Database,
  Dna,
  HeartPulse,
  Layers,
  MapPin,
  RefreshCw,
  Scale,
  Server,
  ShieldCheck,
  Smartphone,
  Syringe,
  Wheat,
  WifiOff
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const MODULES = [
  {
    id: 'expediente',
    icon: Beef,
    badge: 'RF-01 · RF-04',
    title: 'Expediente Individual y Padrón',
    summary:
      'Cada bovino concentra arete, raza, sexo, nacimiento, ingreso, procedencia, potrero actual, fotografía de perfil y línea de tiempo cronológica hasta su salida.',
    highlights: [
      'Identificación individual con historial trazable',
      'Búsqueda instantánea por arete, raza o potrero',
      'Baja lógica y registro de ventas/salidas sin perder historial'
    ]
  },
  {
    id: 'trazabilidad',
    icon: Activity,
    badge: 'RF-02 · RF-05',
    title: 'Lotes, Potreros y Trazabilidad',
    summary:
      'Registra potreros del rancho, cambios internos de lote, ingresos y salidas administrativas con motivo, fecha y respaldo completo por animal.',
    highlights: [
      'Control de ubicación y estado de cada potrero',
      'Historial ordenado de traslados por bovino',
      'Ventas y bajas documentadas como salidas administrativas'
    ]
  },
  {
    id: 'nutricion',
    icon: Wheat,
    badge: 'RF-06 · RF-07',
    title: 'Alimentación y Pesaje de Báscula',
    summary:
      'Documenta raciones y cambios de dieta por animal o por lote (restricción XOR) junto a pesajes reales de báscula en kilogramos para seguir el crecimiento.',
    highlights: [
      'Dietas por individuo o por potrero con frecuencia y fechas',
      'Pesajes reales de báscula separados de estimaciones visuales',
      'Curvas históricas de evolución ponderal'
    ]
  },
  {
    id: 'salud',
    icon: Syringe,
    badge: 'RF-12 · RF-13',
    title: 'Salud, Tratamientos y Alertas',
    summary:
      'Lleva registro de eventos sanitarios, síntomas, diagnósticos profesionales, vacunas, desparasitaciones, tratamientos activos y recordatorios operativos.',
    highlights: [
      'Seguimiento de tratamientos pendientes y en curso',
      'Alertas vencidas, próximas y avisos del sistema',
      'El sistema documenta hechos: no diagnostica ni prescribe'
    ]
  },
  {
    id: 'genealogia',
    icon: Dna,
    badge: 'RF-14',
    title: 'Reproducción y Genealogía Documentada',
    summary:
      'Administra eventos reproductivos y consulta el árbol genealógico de madre, padre y descendientes con fuente documental verificable.',
    highlights: [
      'Árbol visual interactivo de ascendencia y crías',
      'Prevención de relaciones circulares o duplicadas',
      'Distinción clara frente a pruebas genéticas'
    ]
  },
  {
    id: 'boviscale',
    icon: Camera,
    badge: 'RF-08 · RF-11 · I+D',
    title: 'BoviScale Vision (Captura Fotográfica)',
    summary:
      'Protocolo de captura fotográfica de máxima resolución para perfil e investigación de estimación visual de peso, almacenado como Blob binario offline.',
    highlights: [
      'Captura en máxima resolución de cámara y vista previa',
      'Almacenamiento binario en IndexedDB (sin Base64)',
      'Estimación de IA separada y sujeta a validación con báscula'
    ]
  }
] as const;

const ROADMAP = [
  {
    version: 'v0.1.0 · MVP PWA',
    status: 'En operación',
    active: true,
    detail:
      'Usuarios, ranchos, lotes, expediente individual, trazabilidad, alimentación, salud/tratamientos/alertas, reproducción, genealogía documentada, pesaje manual, captura fotográfica, Offline-First con IndexedDB + SW y sincronización Push/Pull.'
  },
  {
    version: 'v0.2.0 · Estimación con fotografías',
    status: 'I+D posterior',
    active: false,
    detail:
      'Protocolo multángulo con conjunto etiquetado por báscula, segmentación, rasgos morfométricos y validación independiente por animal y rancho.'
  },
  {
    version: 'v0.3.0 · Análisis de video',
    status: 'Versión futura',
    active: false,
    detail:
      'Secuencias en movimiento, seguimiento entre fotogramas, selección de vistas útiles y control de oclusiones.'
  },
  {
    version: 'v0.4.0 · Estación fija de borde',
    status: 'Versión futura',
    active: false,
    detail:
      'Cámaras en punto de paso con inferencia y almacenamiento local en equipo de borde y sincronización diferida.'
  },
  {
    version: 'v1.0.0 · Versión estable',
    status: 'Consolidación',
    active: false,
    detail:
      'Consolidación operativa de seguridad, sincronización multi-dispositivo, reportes y módulos validados en campo.'
  }
] as const;

export default function LandingPage() {
  const { isAuthenticated, hasRanch, session } = useAuth();
  const [selectedModuleId, setSelectedModuleId] = useState<string>(MODULES[0].id);
  const authenticatedEntryPath = hasRanch ? '/dashboard' : '/ranch-setup';

  const activeModule = MODULES.find((m) => m.id === selectedModuleId) ?? MODULES[0];
  const ActiveIcon = activeModule.icon;

  return (
    <div className="h-screen overflow-y-auto scroll-smooth bg-surface-app text-brand-slate">
      {/* Navbar público con efecto vidrio */}
      <header className="sticky top-0 z-30 bg-surface-white/90 backdrop-blur-md border-b border-border-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-lg bg-brand-primary text-white font-condensed font-bold text-lg flex items-center justify-center shadow-sm">
              FB
            </span>
            <div>
              <span className="font-condensed text-2xl font-bold text-brand-primary tracking-wide leading-none block">
                FARM<span className="text-brand-slate">BOVI</span>
              </span>
              <span className="text-[10px] font-semibold text-brand-slate/55 uppercase tracking-widest block -mt-0.5">
                Control Ganadero PWA
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-[13px] font-semibold text-brand-slate/75">
            <a href="#problematica" className="hover:text-brand-primary transition-colors">
              Propuesta
            </a>
            <a href="#modulos" className="hover:text-brand-primary transition-colors">
              Módulos
            </a>
            <a href="#arquitectura" className="hover:text-brand-primary transition-colors">
              Arquitectura
            </a>
            <a href="#roadmap" className="hover:text-brand-primary transition-colors">
              Evolución
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            {isAuthenticated ? (
              <Link
                to={authenticatedEntryPath}
                className="inline-flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-[13px] font-semibold shadow-sm transition-colors"
              >
                <span>Ir al Panel ({session?.nombre.split(' ')[0]})</span>
                <ArrowRight size={15} />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-3.5 py-2 rounded-lg text-[13px] font-semibold text-brand-slate hover:bg-surface-secondary transition-colors"
                >
                  Iniciar Sesión
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-[13px] font-semibold shadow-sm transition-colors"
                >
                  <span>Crear Cuenta</span>
                  <ArrowRight size={15} />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section con Frame Animations */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-forest via-brand-primary to-brand-dark text-white">
        <div
          aria-hidden="true"
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand-yellow/15 blur-3xl pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-28 -left-20 w-80 h-80 rounded-full bg-white/10 blur-3xl pointer-events-none"
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative">
          <div className="lg:col-span-7 space-y-6">
            <div className="fb-anim-fade-up inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-[12px] font-semibold text-brand-yellow">
              <WifiOff size={14} />
              <span>PWA Offline-First · Diseñada para pequeños y medianos productores</span>
            </div>

            <h1 className="fb-anim-fade-up fb-anim-delay-1 text-4xl sm:text-5xl lg:text-6xl font-condensed font-bold tracking-tight leading-[1.05]">
              Control y Seguimiento Ganadero que trabaja contigo{' '}
              <span className="text-brand-yellow">incluso sin señal en el potrero.</span>
            </h1>

            <p className="fb-anim-fade-up fb-anim-delay-2 text-[15px] sm:text-[17px] text-white/85 max-w-2xl leading-relaxed">
              FarmBovi sustituye libretas y hojas dispersas por un{' '}
              <strong className="text-white">expediente individual cronológico</strong> para cada
              bovino: trazabilidad, alimentación, pesajes reales de báscula, salud, tratamientos,
              reproducción, genealogía documentada y captura fotográfica{' '}
              <strong className="text-brand-yellow">BoviScale Vision</strong>, con persistencia
              local en IndexedDB y sincronización idempotente Push/Pull.
            </p>

            <div className="fb-anim-fade-up fb-anim-delay-3 flex flex-wrap items-center gap-3 pt-2">
              {isAuthenticated ? (
                <Link
                  to={authenticatedEntryPath}
                  className="inline-flex items-center gap-2 bg-brand-yellow hover:bg-amber-400 text-brand-dark px-6 py-3 rounded-xl font-bold text-[14px] shadow-lg transition-all"
                >
                  <span>Ir al Panel Principal</span>
                  <ArrowRight size={16} />
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 bg-brand-yellow hover:bg-amber-400 text-brand-dark px-6 py-3 rounded-xl font-bold text-[14px] shadow-lg transition-all"
                  >
                    <span>Iniciar Sesión</span>
                    <ArrowRight size={16} />
                  </Link>
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 bg-white/12 hover:bg-white/20 border border-white/25 text-white px-5 py-3 rounded-xl font-semibold text-[14px] transition-all"
                  >
                    <MapPin size={16} />
                    <span>Crear Cuenta</span>
                  </Link>
                </>
              )}
            </div>

            <div className="fb-anim-fade-up fb-anim-delay-4 grid grid-cols-3 gap-4 pt-4 border-t border-white/15 max-w-lg text-[12px]">
              <div>
                <p className="font-condensed text-2xl font-bold text-brand-yellow">100%</p>
                <p className="text-white/75">Captura offline con IndexedDB + SW</p>
              </div>
              <div>
                <p className="font-condensed text-2xl font-bold text-brand-yellow">Push/Pull</p>
                <p className="text-white/75">Sincronización idempotente con conflictos</p>
              </div>
              <div>
                <p className="font-condensed text-2xl font-bold text-brand-yellow">JWT + Rancho</p>
                <p className="text-white/75">Acceso aislado por usuario y rancho</p>
              </div>
            </div>
          </div>

          {/* Tarjeta animada de vista previa de operación en campo */}
          <div className="lg:col-span-5 fb-anim-fade-up fb-anim-delay-2">
            <div className="fb-anim-float bg-surface-white text-brand-slate rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
              <div className="px-5 py-3.5 bg-brand-forest text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="fb-anim-pulse-ring absolute inline-flex h-full w-full rounded-full bg-brand-yellow" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-yellow" />
                  </span>
                  <span className="text-[12px] font-bold tracking-wide uppercase">
                    Expediente en Campo · PWA
                  </span>
                </div>
                <span className="text-[11px] bg-white/15 px-2.5 py-0.5 rounded-full font-semibold">
                  Rancho El Encino
                </span>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-border-light">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-slate/50">
                      Bovino Activo
                    </span>
                    <h2 className="text-2xl font-condensed font-bold text-brand-forest">
                      Arete MX-024 · Hembra Angus
                    </h2>
                    <p className="text-[12px] text-brand-slate/65">
                      Potrero Norte · Procedencia: Propio
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-status-success/15 text-status-success">
                    Sincronizado
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <div className="p-3 rounded-xl bg-surface-app border border-border-light">
                    <p className="text-brand-slate/60 font-semibold flex items-center gap-1">
                      <Scale size={13} className="text-brand-primary" /> Último peso báscula
                    </p>
                    <p className="text-xl font-condensed font-bold text-brand-forest mt-1">
                      428.5 kg
                    </p>
                    <p className="text-[10px] text-brand-slate/55">Dato real confirmado</p>
                  </div>
                  <div className="p-3 rounded-xl bg-surface-app border border-border-light">
                    <p className="text-brand-slate/60 font-semibold flex items-center gap-1">
                      <Camera size={13} className="text-brand-primary" /> BoviScale Vision
                    </p>
                    <p className="text-[12px] font-bold text-brand-dark mt-1.5">
                      3 capturas Blob guardadas
                    </p>
                    <p className="text-[10px] text-brand-slate/55">
                      Estimación IA sujeta a validación
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-surface-secondary/70 border border-brand-primary/20 flex items-center justify-between gap-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <RefreshCw size={15} className="text-brand-primary shrink-0" />
                    <span className="font-semibold text-brand-forest">
                      Cola Offline-First lista para Push/Pull
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-brand-primary uppercase">
                    Idempotente
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problemática y Justificación */}
      <section id="problematica" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-10">
        <div className="max-w-3xl space-y-3">
          <span className="text-[12px] font-bold uppercase tracking-widest text-brand-primary">
            Contexto y Propuesta
          </span>
          <h2 className="text-3xl sm:text-4xl font-condensed font-bold text-brand-forest">
            Diseñado para resolver la fragmentación de datos y la conectividad intermitente en campo
          </h2>
          <p className="text-[15px] text-brand-slate/75 leading-relaxed">
            Cuando la información del hato vive en cuadernos o comunicaciones verbales, se pierde
            la relación entre alimentación, pesajes, salud y movimientos. FarmBovi consolida todo el
            ciclo de vida del animal en una PWA responsiva que sigue operando sin red y sincroniza
            de forma controlada al reconectar.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              icon: Layers,
              title: 'Expediente Cronológico',
              desc: 'Identidad, procedencia, cambios de potrero, dietas, salud, reproducción, parentesco y salidas en una sola línea de tiempo.'
            },
            {
              icon: Database,
              title: 'Persistencia Offline-First',
              desc: 'Service Worker e IndexedDB conservan la interfaz, los registros y las fotografías binarias aunque no haya cobertura celular.'
            },
            {
              icon: CloudUpload,
              title: 'Sincronización Idempotente',
              desc: 'Identificadores únicos de operación, cursores opacos paginados, reintentos automáticos y resolución guiada de conflictos.'
            },
            {
              icon: ShieldCheck,
              title: 'Seguridad por Rancho',
              desc: 'Autenticación JWT en API REST ASP.NET Core con aislamiento estricto de datos por membresía de usuario y rancho.'
            }
          ].map((item, idx) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className={`fb-anim-fade-up bg-surface-white border border-border-light rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-brand-primary/40 transition-all ${
                  idx === 1
                    ? 'fb-anim-delay-1'
                    : idx === 2
                      ? 'fb-anim-delay-2'
                      : idx === 3
                        ? 'fb-anim-delay-3'
                        : ''
                }`}
              >
                <div className="w-11 h-11 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center mb-4">
                  <Icon size={22} />
                </div>
                <h3 className="font-bold text-[16px] text-brand-forest">{item.title}</h3>
                <p className="text-[13px] text-brand-slate/75 mt-2 leading-relaxed">{item.desc}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* Módulos Interactivos del MVP */}
      <section id="modulos" className="bg-surface-white border-y border-border-light py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-[12px] font-bold uppercase tracking-widest text-brand-primary">
                Cobertura Funcional (RF-01 a RF-16)
              </span>
              <h2 className="text-3xl sm:text-4xl font-condensed font-bold text-brand-forest mt-1">
                Módulos integrados del MVP FarmBovi
              </h2>
            </div>
            <p className="text-[13px] text-brand-slate/65 max-w-md">
              Selecciona cualquier módulo para revisar su alcance real dentro del expediente ganadero.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-2">
              {MODULES.map((mod) => {
                const Icon = mod.icon;
                const isSelected = mod.id === activeModule.id;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => setSelectedModuleId(mod.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-brand-primary text-white border-brand-primary shadow-md'
                        : 'bg-surface-app/50 text-brand-slate border-border-light hover:border-brand-primary/40 hover:bg-surface-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        size={19}
                        className={isSelected ? 'text-brand-yellow shrink-0' : 'text-brand-primary shrink-0'}
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-[14px] truncate">{mod.title}</p>
                        <p
                          className={`text-[11px] ${
                            isSelected ? 'text-white/75' : 'text-brand-slate/55'
                          }`}
                        >
                          {mod.badge}
                        </p>
                      </div>
                    </div>
                    <ArrowRight
                      size={15}
                      className={`shrink-0 transition-transform ${
                        isSelected ? 'translate-x-0.5 text-brand-yellow' : 'opacity-40'
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div
              key={activeModule.id}
              className="lg:col-span-7 fb-anim-frame-right bg-surface-app/60 border border-border-light rounded-2xl p-6 sm:p-8 space-y-5"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="inline-flex items-center gap-2.5">
                  <div className="w-11 h-11 rounded-xl bg-brand-primary text-white flex items-center justify-center">
                    <ActiveIcon size={22} />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">
                      {activeModule.badge}
                    </span>
                    <h3 className="text-2xl font-condensed font-bold text-brand-forest">
                      {activeModule.title}
                    </h3>
                  </div>
                </div>
              </div>

              <p className="text-[15px] text-brand-slate/85 leading-relaxed">
                {activeModule.summary}
              </p>

              <ul className="space-y-2.5 pt-2">
                {activeModule.highlights.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2.5 text-[14px] text-brand-slate">
                    <CheckCircle2 size={17} className="text-status-success shrink-0 mt-0.5" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-4 border-t border-border-light flex flex-wrap gap-3">
                <Link
                  to={isAuthenticated ? authenticatedEntryPath : '/login'}
                  className="inline-flex items-center gap-1.5 bg-brand-primary hover:bg-brand-dark text-white px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-colors"
                >
                  {isAuthenticated ? 'Abrir panel de trabajo' : 'Acceder a la plataforma'}{' '}
                  <ArrowRight size={14} />
                </Link>
                {!isAuthenticated && (
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-1.5 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-colors"
                  >
                    Crear Cuenta
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Arquitectura Técnica */}
      <section id="arquitectura" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-8">
        <div className="max-w-3xl space-y-2">
          <span className="text-[12px] font-bold uppercase tracking-widest text-brand-primary">
            Arquitectura MVVM + Offline-First
          </span>
          <h2 className="text-3xl sm:text-4xl font-condensed font-bold text-brand-forest">
            Desacoplada, auditable y preparada para crecer
          </h2>
          <p className="text-[14px] text-brand-slate/75">
            La PWA separa vista, lógica y repositorios locales de la API REST central y mantiene
            el módulo de visión BoviScale como línea de investigación independiente del pesaje real.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-surface-white border border-border-light rounded-2xl p-6 space-y-3 shadow-sm">
            <div className="flex items-center gap-2.5 text-brand-forest font-bold text-[15px]">
              <Smartphone size={20} className="text-brand-primary" />
              <span>1. Cliente PWA (Campo)</span>
            </div>
            <p className="text-[13px] text-brand-slate/75 leading-relaxed">
              React + TypeScript + Vite bajo patrón MVVM. Service Worker para App Shell offline e
              IndexedDB (Dexie) para entidades, fotografías `Blob`, cola outbox y checkpoints.
            </p>
          </div>

          <div className="bg-surface-white border border-border-light rounded-2xl p-6 space-y-3 shadow-sm">
            <div className="flex items-center gap-2.5 text-brand-forest font-bold text-[15px]">
              <Server size={20} className="text-brand-primary" />
              <span>2. API REST Central</span>
            </div>
            <p className="text-[13px] text-brand-slate/75 leading-relaxed">
              C# + ASP.NET Core con autenticación JWT, aislamiento por rancho (`UsuarioRancho`),
              control de concurrencia optimista (`VersionRegistro`) y endpoints Push/Pull idempotentes.
            </p>
          </div>

          <div className="bg-surface-white border border-border-light rounded-2xl p-6 space-y-3 shadow-sm">
            <div className="flex items-center gap-2.5 text-brand-forest font-bold text-[15px]">
              <HeartPulse size={20} className="text-brand-primary" />
              <span>3. MySQL + I+D BoviScale</span>
            </div>
            <p className="text-[13px] text-brand-slate/75 leading-relaxed">
              Persistencia relacional con auditoría de cambios. El módulo experimental de estimación
              visual de peso permanece separado y sujeto a validación independiente con báscula.
            </p>
          </div>
        </div>
      </section>

      {/* Plan de Versionamiento */}
      <section id="roadmap" className="bg-brand-forest text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="max-w-3xl space-y-2">
            <span className="text-[12px] font-bold uppercase tracking-widest text-brand-yellow">
              Plan de Versionamiento
            </span>
            <h2 className="text-3xl sm:text-4xl font-condensed font-bold">
              Evolución transparente del MVP a estación de borde
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {ROADMAP.map((stage) => (
              <div
                key={stage.version}
                className={`rounded-2xl p-5 border flex flex-col justify-between gap-3 ${
                  stage.active
                    ? 'bg-white/15 border-brand-yellow shadow-lg'
                    : 'bg-white/5 border-white/15'
                }`}
              >
                <div className="space-y-2">
                  <span
                    className={`inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      stage.active
                        ? 'bg-brand-yellow text-brand-dark'
                        : 'bg-white/10 text-white/75'
                    }`}
                  >
                    {stage.status}
                  </span>
                  <h3 className="font-condensed text-xl font-bold text-white">{stage.version}</h3>
                  <p className="text-[12px] text-white/75 leading-relaxed">{stage.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Final y Footer */}
      <footer className="bg-surface-white border-t border-border-light py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1 text-center md:text-left">
            <p className="font-condensed text-2xl font-bold text-brand-forest">
              FARMBOVI · Sistema de Control y Seguimiento Ganadero
            </p>
            <p className="text-[13px] text-brand-slate/65">
              PWA Offline-First · React + TypeScript + ASP.NET Core + MySQL/MariaDB
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/login"
              className="px-4 py-2.5 rounded-lg border border-border-light text-[13px] font-semibold text-brand-slate hover:border-brand-primary transition-colors"
            >
              Iniciar Sesión
            </Link>
            <Link
              to="/register"
              className="px-4 py-2.5 rounded-lg bg-brand-primary hover:bg-brand-dark text-white text-[13px] font-semibold transition-colors"
            >
              Crear Cuenta
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
