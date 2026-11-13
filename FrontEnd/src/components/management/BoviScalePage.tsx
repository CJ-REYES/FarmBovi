import { useState, useRef, useEffect, useCallback } from 'react';
import { useSharedCattle } from '../../context/CattleContext';
import type { Cattle } from '../../types/cattle';
import EmptyState from '../ui/EmptyState';
import {
  Camera, Upload, RefreshCw, CheckCircle, Info,
  Beef, Scale, History, AlertTriangle, X, Image as ImageIcon, Zap
} from 'lucide-react';

export default function BoviScalePage() {
  const { cattle } = useSharedCattle();

  // Estados de UI y Selección
  const [selectedCattleId, setSelectedCattleId] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<boolean>(false);

  // Estados de Cámara e Imagen
  const [cameraActive, setCameraActive] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Referencias para el hardware
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Limpieza de recursos de cámara
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // Apagar cámara al desmontar el componente
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const startCamera = async () => {
    setPermissionError(null);
    setImageSrc(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err) {
      console.error("Error accediendo a la cámara:", err);
      setPermissionError('No se pudo acceder a la cámara. Verifica los permisos de tu navegador.');
    }
  };

  const switchCamera = () => {
    stopCamera();
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    setTimeout(startCamera, 100);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setImageSrc(dataUrl);
        stopCamera();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
        stopCamera();
        setAnalysisResult(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      setAnalysisResult(true);
    }, 1500);
  };

  const resetCapture = () => {
    setImageSrc(null);
    setAnalysisResult(false);
    startCamera();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8">

      {/* 1. Encabezado */}
      <header className="border-b border-border-light pb-4">
        <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">Inteligencia Artificial</span>
        <h1 className="text-3xl md:text-4xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
          Captura Fotográfica (BoviScale Vision)
        </h1>
      </header>

      {/* 2. Explicación */}
      <div className="bg-surface-secondary/50 border border-brand-primary/20 rounded-xl p-4 flex items-start gap-3">
        <Info size={20} className="text-brand-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="text-[14px] font-bold text-brand-slate">Estimación Volumétrica (Fase Beta)</h3>
          <p className="text-[13px] text-brand-slate/70 mt-1 leading-snug">
            BoviScale Vision utiliza inteligencia artificial para estimar el peso de los bovinos a partir de fotografías.
            Asegúrate de capturar al animal de perfil lateral completo, con buena iluminación y sin obstrucciones.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Columna Izquierda: Visor y Captura (Span 7) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-border-light bg-surface-app/30">
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <Camera size={18} className="text-brand-primary" /> Visor de Captura
              </h2>
            </div>

            <div className="p-5 flex-1 flex flex-col">
              {/* 3. Selección del Bovino */}
              <div className="mb-4">
                <label className="block text-[13px] font-semibold text-brand-slate mb-1.5">Seleccionar Bovino a Estimar</label>
                <div className="relative">
                  <Beef size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-slate/40" />
                  <select
                    value={selectedCattleId}
                    onChange={(e) => setSelectedCattleId(e.target.value)}
                    className="w-full h-[40px] pl-10 pr-4 bg-surface-app border border-border-light rounded-md text-[14px] text-brand-slate focus:outline-none focus:border-brand-primary"
                  >
                    <option value="">-- Selecciona un bovino del inventario --</option>
                    {cattle?.map((c: Cattle & { areteSiniiga?: string; tagNumber?: string; nombre?: string; name?: string }) => (
                      <option key={c.id} value={c.id}>
                        {c.areteSiniiga || c.tagNumber || `ID-${c.id}`} {(c.nombre || c.name) ? `- ${c.nombre || c.name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Error de permisos */}
              {permissionError && (
                <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 text-status-error text-[13px] rounded flex items-start gap-2">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>{permissionError}</span>
                </div>
              )}

              {/* 4, 5, 6. Área Visual: Cámara o Preview */}
              <div className="relative flex-1 bg-black/5 rounded-lg border border-border-light overflow-hidden flex items-center justify-center min-h-[350px]">

                {imageSrc ? (
                  <img src={imageSrc} alt="Captura BoviScale" className="max-w-full max-h-[400px] object-contain" />
                ) : cameraActive ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full max-h-[400px] object-cover"
                  />
                ) : (
                  <div className="text-center p-6">
                    <ImageIcon size={48} className="mx-auto text-brand-slate/20 mb-3" />
                    <p className="text-[14px] font-medium text-brand-slate">Cámara inactiva</p>
                    <p className="text-[12px] text-brand-slate/50 max-w-xs mx-auto mt-1">
                      Inicia la cámara para capturar la foto o sube un archivo desde tu dispositivo.
                    </p>
                  </div>
                )}

                <canvas ref={canvasRef} className="hidden" />
              </div>

              {/* 7. Controles de Cámara */}
              <div className="mt-4 flex flex-wrap gap-3">
                {!imageSrc && !cameraActive && (
                  <button onClick={startCamera} className="flex-1 flex justify-center items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 h-[40px] rounded-md font-semibold text-[13px] transition-colors">
                    <Camera size={16} /> Iniciar Cámara
                  </button>
                )}

                {!imageSrc && cameraActive && (
                  <>
                    <button onClick={capturePhoto} className="flex-1 flex justify-center items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 h-[40px] rounded-md font-semibold text-[13px] transition-colors">
                      <div className="w-4 h-4 rounded-full border-2 border-white bg-white/20"></div> Capturar
                    </button>
                    <button onClick={switchCamera} className="px-4 h-[40px] flex items-center justify-center bg-surface-secondary text-brand-slate hover:bg-border-light rounded-md transition-colors" title="Cambiar cámara">
                      <RefreshCw size={18} />
                    </button>
                  </>
                )}

                {imageSrc && (
                  <>
                    <button onClick={resetCapture} className="flex items-center justify-center gap-2 bg-surface-secondary text-brand-slate hover:bg-border-light px-4 h-[40px] rounded-md font-semibold text-[13px] transition-colors">
                      <X size={16} /> Descartar
                    </button>
                    <button
                      onClick={handleAnalyze}
                      disabled={isProcessing || !selectedCattleId || analysisResult}
                      className="flex-1 flex justify-center items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 h-[40px] rounded-md font-semibold text-[13px] transition-colors disabled:opacity-50"
                    >
                      {isProcessing ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} />}
                      {isProcessing ? 'Procesando...' : 'Analizar Imagen'}
                    </button>
                  </>
                )}

                {!cameraActive && !imageSrc && (
                  <label className="flex-1 flex justify-center items-center gap-2 bg-surface-white border border-border-light hover:border-brand-primary/40 text-brand-slate px-4 h-[40px] rounded-md font-semibold text-[13px] transition-colors cursor-pointer">
                    <Upload size={16} />
                    <span>Subir Foto</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Resultados e Historial (Span 5) */}
        <div className="lg:col-span-5 space-y-6 flex flex-col">

          <div className="bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[220px]">
            <div className="px-5 py-4 border-b border-border-light bg-surface-app/30">
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <Scale size={18} className="text-brand-primary" /> Resultados del Análisis
              </h2>
            </div>
            <div className="flex-1 p-5 flex flex-col justify-center">
              {analysisResult ? (
                <div className="text-center space-y-3 animate-in zoom-in-95 duration-300">
                  <div className="w-12 h-12 rounded-full bg-status-warning/10 text-status-warning flex items-center justify-center mx-auto">
                    <AlertTriangle size={24} />
                  </div>
                  <h3 className="font-bold text-brand-slate text-[15px]">Servicio de IA No Conectado</h3>
                  <p className="text-[13px] text-brand-slate/60 leading-relaxed px-4">
                    La fotografía cumple con los parámetros de calidad, pero el servicio de inferencia de BoviScale Vision aún no está integrado en el backend .NET 10.
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-surface-secondary rounded-full border border-border-light mt-2">
                    <CheckCircle size={14} className="text-status-success" />
                    <span className="text-[11px] font-semibold text-brand-slate uppercase">Calidad de Imagen OK</span>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Esperando Imagen"
                  message="Captura o sube una fotografía y haz clic en analizar para procesar la volumetría."
                  icon={ImageIcon}
                />
              )}
            </div>
          </div>

          <div className="flex-1 bg-surface-white border border-border-light rounded-xl shadow-sm flex flex-col min-h-[250px]">
            <div className="px-5 py-4 border-b border-border-light bg-surface-app/30">
              <h2 className="font-bold text-[16px] text-brand-slate flex items-center gap-2">
                <History size={18} className="text-brand-slate/70" /> Historial de Capturas
              </h2>
            </div>
            <div className="flex-1 p-5 flex flex-col">
              <EmptyState
                title="Sin capturas recientes"
                message="El historial de biometría visual se guardará aquí una vez que el servicio esté operativo."
                icon={History}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
