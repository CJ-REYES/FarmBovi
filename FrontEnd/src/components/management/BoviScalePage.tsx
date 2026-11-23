import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  CloudUpload,
  Eye,
  HardDrive,
  Image as ImageIcon,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SwitchCamera,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import {
  PermissionsManagerService,
  type ManagedPermissionState
} from '../../services/permissions/permissions-manager.service';
import {
  PhotoCaptureService,
  captureHighestQualityPhoto,
  formatBytesHuman,
  validatePhotoBlob
} from '../../services/photo-capture.service';
import type { Cattle } from '../../types/cattle';
import {
  MEDIA_BACKEND_DEPENDENCY,
  PHOTO_CAPTURE_LIMITS,
  type AnimalPhotoType,
  type PhotoStorageSummary,
  type StoredAnimalPhoto
} from '../../types/media';
import AnimalSelectField from '../shared/AnimalSelectField';
import BlobImage from '../shared/BlobImage';
import EmptyState from '../ui/EmptyState';

const MAX_PHOTO_SIZE_MB = Math.round(PHOTO_CAPTURE_LIMITS.maxSizeBytes / (1024 * 1024));

interface PendingCapture {
  blob: Blob;
  nombreArchivo?: string;
  source: 'camera' | 'file';
  captureMode?: 'native-sensor' | 'video-frame';
  dimensions?: { width: number; height: number };
}

function formatDateTimeDisplay(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderUploadBadge(estado: StoredAnimalPhoto['estadoArchivo']) {
  if (estado === 'subido') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-success/15 text-status-success">
        <CheckCircle2 size={11} /> Sincronizada
      </span>
    );
  }
  if (estado === 'subiendo') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-primary/15 text-brand-primary">
        <CloudUpload size={11} /> Subiendo…
      </span>
    );
  }
  if (estado === 'error_subida') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-danger/15 text-status-danger">
        <AlertTriangle size={11} /> Error de subida
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-status-warning/20 text-brand-dark">
      <Clock size={11} /> Pendiente de subida
    </span>
  );
}

export default function BoviScalePage() {
  const [searchParams] = useSearchParams();

  // Datos cargados desde IndexedDB / API real de animales
  const [animals, setAnimals] = useState<Cattle[]>([]);
  const [photos, setPhotos] = useState<StoredAnimalPhoto[]>([]);
  const [storage, setStorage] = useState<PhotoStorageSummary>({
    totalPhotos: 0,
    pendingUploads: 0,
    totalBytes: 0,
    isPersisted: false
  });
  const [loadingGallery, setLoadingGallery] = useState<boolean>(true);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [galleryAnimalFilter, setGalleryAnimalFilter] = useState<string>('todos');

  // Estado del formulario de captura
  const [selectedCattleId, setSelectedCattleId] = useState<string>(
    () => searchParams.get('animal') || ''
  );
  const [photoType, setPhotoType] = useState<AnimalPhotoType>(() => {
    const paramTipo = searchParams.get('tipo');
    return paramTipo === 'FotoPerfil' ? 'FotoPerfil' : 'BoviScaleVision';
  });
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Estado de la cámara y permisos
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [streamResolution, setStreamResolution] = useState<{ width: number; height: number } | null>(
    null
  );
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraPermissionState, setCameraPermissionState] =
    useState<ManagedPermissionState>('unknown');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Modales de inspección y borrado
  const [inspectPhoto, setInspectPhoto] = useState<StoredAnimalPhoto | null>(null);
  const [confirmDeletePhoto, setConfirmDeletePhoto] = useState<StoredAnimalPhoto | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Referencias de hardware y control de concurrencia
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveLockRef = useRef<boolean>(false);

  const animalById = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  const animalOptions = useMemo(
    () =>
      animals.map((a) => ({
        id: a.id,
        arete: a.arete,
        raza: a.raza,
        extraLabel: `(${a.estado})`
      })),
    [animals]
  );

  // Liberación garantizada de todos los tracks de cámara y referencia del video
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignorar errores al detener tracks ya cerrados
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamResolution(null);
    setCameraActive(false);
  }, []);

  // Apagar cámara al desmontar el componente o perder visibilidad de la pestaña
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stopCamera();
    };
  }, [stopCamera]);

  // Vincular stream al elemento <video> cuando el visor esté montado
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      const playPromise = videoRef.current.play?.();
      if (playPromise && typeof playPromise.catch === 'function') {
        void playPromise.catch(() => {
          // Algunos navegadores móviles inician con autoPlay + playsInline
        });
      }
    }
  }, [cameraActive]);

  // Gestión estricta del ciclo de vida de ObjectURL para no retener Blobs en memoria
  useEffect(() => {
    if (!pendingCapture?.blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      const clearTimer = window.setTimeout(() => setPreviewObjectUrl(null), 0);
      return () => window.clearTimeout(clearTimer);
    }

    const url = URL.createObjectURL(pendingCapture.blob);
    const setTimer = window.setTimeout(() => setPreviewObjectUrl(url), 0);

    return () => {
      window.clearTimeout(setTimer);
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    };
  }, [pendingCapture]);

  const loadGallery = useCallback(async (filterCattleId: string) => {
    setLoadingGallery(true);
    setGalleryError(null);
    try {
      const result = await PhotoCaptureService.listPhotos({
        cattleId: filterCattleId !== 'todos' ? filterCattleId : undefined
      });
      setPhotos(result.photos);
      setAnimals(result.animals);
      setStorage(result.storage);
    } catch (err) {
      setGalleryError(
        err instanceof Error
          ? err.message
          : 'No se pudieron recuperar las fotografías guardadas en IndexedDB.'
      );
    } finally {
      setLoadingGallery(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await PhotoCaptureService.listPhotos({
          cattleId: galleryAnimalFilter !== 'todos' ? galleryAnimalFilter : undefined
        });
        if (!active) return;
        setPhotos(result.photos);
        setAnimals(result.animals);
        setStorage(result.storage);
        setGalleryError(null);
      } catch (err) {
        if (!active) return;
        setGalleryError(
          err instanceof Error
            ? err.message
            : 'No se pudieron recuperar las fotografías guardadas en IndexedDB.'
        );
      } finally {
        if (active) {
          setLoadingGallery(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [galleryAnimalFilter]);

  useEffect(() => {
    void PermissionsManagerService.refreshPassiveStates().then((snap) => {
      setCameraPermissionState(snap.camera);
    });
  }, []);

  const startCameraWithFacing = useCallback(
    async (targetFacing: 'environment' | 'user') => {
      stopCamera();
      setCameraError(null);
      setCaptureError(null);
      setPendingCapture(null);
      setIsStartingCamera(true);

      try {
        const res = await PermissionsManagerService.requestCameraStream(
          targetFacing === 'environment'
        );
        setCameraPermissionState(res.state);

        if (!res.stream) {
          setCameraError(
            res.userMessage ||
              'No se pudo iniciar la cámara. Utiliza la opción de seleccionar fotografía desde archivos.'
          );
          return;
        }

        streamRef.current = res.stream;
        setCameraActive(true);
        if (videoRef.current) {
          videoRef.current.srcObject = res.stream;
        }
      } finally {
        setIsStartingCamera(false);
      }
    },
    [stopCamera]
  );

  const handleStartCamera = () => {
    void startCameraWithFacing(facingMode);
  };

  const handleSwitchCamera = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    void startCameraWithFacing(nextFacing);
  };

  const handleCaptureFrame = async () => {
    if (isCapturing) return;
    setCaptureError(null);
    if (!videoRef.current || !canvasRef.current) {
      setCaptureError('El visor de cámara no está disponible para capturar la fotografía.');
      return;
    }

    setIsCapturing(true);
    try {
      const { blob, width, height, captureMode } = await captureHighestQualityPhoto(
        streamRef.current,
        videoRef.current,
        canvasRef.current
      );
      const validation = validatePhotoBlob(blob);
      if (!validation.valid) {
        setCaptureError(validation.error || 'La fotografía capturada no es válida.');
        return;
      }

      setPendingCapture({
        blob,
        source: 'camera',
        captureMode,
        dimensions: width && height ? { width, height } : undefined
      });
      // Liberar hardware de cámara inmediatamente al obtener la foto
      stopCamera();
    } catch (err) {
      setCaptureError(
        err instanceof Error ? err.message : 'No se pudo capturar la fotografía desde la cámara.'
      );
    } finally {
      setIsCapturing(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCaptureError(null);
    setCameraError(null);
    const file = e.target.files?.[0];
    // Limpiar el input para permitir volver a elegir el mismo archivo si se descarta
    e.target.value = '';

    if (!file) return;

    const validation = validatePhotoBlob(file);
    if (!validation.valid) {
      setCaptureError(validation.error || 'Archivo de imagen no válido.');
      return;
    }

    stopCamera();
    setPendingCapture({
      blob: file,
      nombreArchivo: file.name,
      source: 'file'
    });
  };

  const handleDiscardCapture = () => {
    setPendingCapture(null);
    setCaptureError(null);
  };

  const handleRetakeCapture = () => {
    const previousSource = pendingCapture?.source;
    setPendingCapture(null);
    setCaptureError(null);
    if (previousSource === 'camera') {
      void startCameraWithFacing(facingMode);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleSavePhoto = async () => {
    if (saveLockRef.current || isSaving) return;
    setCaptureError(null);
    setFeedbackMsg(null);

    if (!selectedCattleId) {
      setCaptureError('Selecciona un animal del padrón para asociar la fotografía.');
      return;
    }
    if (!pendingCapture?.blob) {
      setCaptureError('Captura una fotografía o selecciona un archivo antes de guardar.');
      return;
    }

    saveLockRef.current = true;
    setIsSaving(true);
    try {
      const result = await PhotoCaptureService.savePhoto({
        blob: pendingCapture.blob,
        cattleId: selectedCattleId,
        tipo: photoType,
        nombreArchivo: pendingCapture.nombreArchivo
      });

      setPendingCapture(null);
      setFeedbackMsg(result.syncMessage);
      await loadGallery(galleryAnimalFilter);
    } catch (err) {
      setCaptureError(
        err instanceof Error ? err.message : 'No se pudo guardar la fotografía en IndexedDB.'
      );
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeletePhoto || isDeleting) return;
    setIsDeleting(true);
    setGalleryError(null);
    try {
      const res = await PhotoCaptureService.deletePhoto(confirmDeletePhoto.id);
      if (inspectPhoto?.id === confirmDeletePhoto.id) {
        setInspectPhoto(null);
      }
      setConfirmDeletePhoto(null);
      setFeedbackMsg(res.syncMessage);
      await loadGallery(galleryAnimalFilter);
    } catch (err) {
      setGalleryError(
        err instanceof Error ? err.message : 'No se pudo eliminar la fotografía.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-8">
      {/* Encabezado */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-light pb-4">
        <div>
          <span className="text-[12px] font-bold text-brand-slate/50 uppercase tracking-widest">
            BoviScale · Evidencia Visual Offline-First
          </span>
          <h1 className="text-3xl text-brand-forest font-bold font-condensed tracking-tight mt-1">
            Captura Fotográfica de Animales
          </h1>
        </div>

        <button
          type="button"
          onClick={() => void loadGallery(galleryAnimalFilter)}
          disabled={loadingGallery}
          aria-label="Actualizar galería fotográfica"
          className="min-h-[42px] px-3.5 bg-surface-white border border-border-light hover:border-brand-primary text-brand-slate rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw size={15} className={loadingGallery ? 'animate-spin' : ''} />
          <span>Actualizar</span>
        </button>
      </header>

      {/* Aviso de alcance v1 y dependencia de Backend */}
      <div
        role="status"
        className="p-3.5 rounded-xl bg-surface-secondary/50 border border-brand-primary/20 text-brand-slate text-[12px] flex items-start gap-2.5"
      >
        <Info size={16} className="text-brand-primary shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-brand-forest">
            BoviScale v1 — Captura, Almacenamiento Local y Cola de Sincronización
          </p>
          <p>{MEDIA_BACKEND_DEPENDENCY.summaryMessage}</p>
        </div>
      </div>

      {/* Feedback de guardado / eliminación */}
      {feedbackMsg && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-status-success/10 border border-status-success/30 text-status-success text-[13px] font-medium flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{feedbackMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            aria-label="Cerrar notificación"
            className="p-1 hover:bg-status-success/10 rounded"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Resumen real de almacenamiento y cola */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Fotos Guardadas</span>
            <ImageIcon size={16} className="text-brand-primary" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-forest mt-1">
            {storage.totalPhotos}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">Persistidas en IndexedDB (Blob)</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Pendientes de Subida</span>
            <CloudUpload size={16} className="text-status-warning" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-dark mt-1">
            {storage.pendingUploads}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">En cola de sincronización</p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Espacio en Fotos</span>
            <HardDrive size={16} className="text-brand-slate/70" />
          </div>
          <p className="text-2xl font-condensed font-bold text-brand-forest mt-1">
            {formatBytesHuman(storage.totalBytes)}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">
            {typeof storage.browserUsagePercentage === 'number'
              ? `Uso total navegador: ${storage.browserUsagePercentage}%`
              : `Límite: ${MAX_PHOTO_SIZE_MB} MB por fotografía`}
          </p>
        </div>

        <div className="bg-surface-white border border-border-light rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-brand-slate/65 text-[12px] font-semibold">
            <span>Permiso de Cámara</span>
            <ShieldCheck size={16} className="text-brand-primary" />
          </div>
          <p className="text-lg font-condensed font-bold text-brand-forest mt-1.5 capitalize">
            {cameraPermissionState === 'granted'
              ? 'Permitida'
              : cameraPermissionState === 'denied'
                ? 'Rechazada'
                : cameraPermissionState === 'unavailable'
                  ? 'No disponible'
                  : 'Por solicitar'}
          </p>
          <p className="text-[11px] text-brand-slate/60 mt-0.5">
            {storage.isPersisted ? 'Almacenamiento protegido' : 'Fallback de archivos activo'}
          </p>
        </div>
      </div>

      {/* Layout principal: Visor de Captura (7 cols) + Galería Persistida (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Captura y Vista Previa */}
        <section className="lg:col-span-7 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 flex items-center justify-between gap-2">
            <h2 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
              <Camera size={17} className="text-brand-primary" /> Captura y Asociación al Animal
            </h2>
            <span className="text-[11px] text-brand-slate/60 font-medium">
              Máx. calidad · JPEG · PNG · WebP (hasta {MAX_PHOTO_SIZE_MB} MB)
            </span>
          </div>

          <div className="p-5 space-y-4 flex-1 flex flex-col">
            {/* Selector de Animal (con buscador interno por arete) + Tipo */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <AnimalSelectField
                  id="boviscale-animal"
                  name="idAnimal"
                  label="Animal Asociado"
                  required
                  value={selectedCattleId}
                  options={animalOptions}
                  placeholder="Selecciona un animal por arete"
                  searchPlaceholder="Buscar animal por arete o raza..."
                  onChange={(id) => {
                    setSelectedCattleId(id);
                    setCaptureError(null);
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="boviscale-tipo"
                  className="block text-[13px] font-semibold text-brand-slate mb-1.5"
                >
                  Tipo de Fotografía
                </label>
                <select
                  id="boviscale-tipo"
                  value={photoType}
                  onChange={(e) => setPhotoType(e.target.value as AnimalPhotoType)}
                  className="w-full h-[42px] px-3 bg-surface-white border border-border-light rounded-md text-[13px] text-brand-slate outline-none focus:border-brand-primary"
                >
                  <option value="BoviScaleVision">BoviScale (Perfil lateral)</option>
                  <option value="FotoPerfil">Foto de perfil</option>
                </select>
              </div>
            </div>

            {/* Errores de permisos de cámara o validación */}
            {cameraError && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-[13px] flex items-start gap-2"
              >
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{cameraError}</span>
              </div>
            )}

            {captureError && (
              <div
                role="alert"
                className="p-3.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-[13px] flex items-start gap-2"
              >
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{captureError}</span>
              </div>
            )}

            {/* Área Visual: Vista previa Blob, Cámara en vivo o Estado inactivo */}
            <div className="relative flex-1 bg-black/5 rounded-xl border border-border-light overflow-hidden flex items-center justify-center min-h-[320px]">
              {pendingCapture && previewObjectUrl ? (
                <div className="w-full flex flex-col items-center p-2 space-y-2">
                  <img
                    src={previewObjectUrl}
                    alt="Vista previa de fotografía capturada"
                    className="max-w-full max-h-[360px] object-contain rounded-lg"
                  />
                  <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-brand-slate/75 bg-surface-white/95 border border-border-light px-3 py-1 rounded-full">
                    <span className="font-semibold">
                      {pendingCapture.source === 'file'
                        ? 'Desde archivo'
                        : pendingCapture.captureMode === 'native-sensor'
                          ? 'Sensor nativo (máx. calidad)'
                          : 'Cámara (alta calidad)'}
                    </span>
                    <span>· {formatBytesHuman(pendingCapture.blob.size)}</span>
                    <span>· {pendingCapture.blob.type}</span>
                    {pendingCapture.dimensions && (
                      <span>
                        · {pendingCapture.dimensions.width}×{pendingCapture.dimensions.height} px
                      </span>
                    )}
                  </div>
                </div>
              ) : cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      if (v.videoWidth > 0 && v.videoHeight > 0) {
                        setStreamResolution({ width: v.videoWidth, height: v.videoHeight });
                      }
                    }}
                    aria-label="Vista en vivo de la cámara"
                    className="w-full h-full max-h-[380px] object-cover"
                  />
                  {streamResolution && (
                    <span className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-full bg-black/65 text-white text-[11px] font-medium backdrop-blur-xs">
                      Visor {streamResolution.width}×{streamResolution.height} px · Captura máxima
                    </span>
                  )}
                </>
              ) : (
                <div className="text-center p-6 space-y-2">
                  <Camera size={44} className="mx-auto text-brand-slate/25" />
                  <p className="text-[14px] font-semibold text-brand-slate">Cámara inactiva</p>
                  <p className="text-[12px] text-brand-slate/60 max-w-xs mx-auto">
                    Inicia la cámara del dispositivo para tomar una fotografía o selecciona una
                    imagen JPEG, PNG o WebP desde tu galería.
                  </p>
                </div>
              )}

              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Input de archivo oculto con capture="environment" para compatibilidad móvil */}
            <input
              ref={fileInputRef}
              id="boviscale-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Controles de captura */}
            <div className="flex flex-wrap gap-2.5 pt-1">
              {!pendingCapture && !cameraActive && (
                <>
                  <button
                    type="button"
                    onClick={handleStartCamera}
                    disabled={isStartingCamera}
                    className="flex-1 min-h-[42px] flex justify-center items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors disabled:opacity-50"
                  >
                    {isStartingCamera ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Solicitando cámara...
                      </>
                    ) : (
                      <>
                        <Camera size={16} /> Iniciar Cámara
                      </>
                    )}
                  </button>

                  <label
                    htmlFor="boviscale-file-input"
                    className="flex-1 min-h-[42px] flex justify-center items-center gap-2 bg-surface-white border border-border-light hover:border-brand-primary/50 text-brand-slate px-4 rounded-md font-semibold text-[13px] transition-colors cursor-pointer"
                  >
                    <Upload size={16} />
                    <span>Seleccionar Fotografía</span>
                  </label>
                </>
              )}

              {!pendingCapture && cameraActive && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleCaptureFrame()}
                    disabled={isCapturing}
                    className="flex-1 min-h-[42px] flex justify-center items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-4 rounded-md font-semibold text-[13px] transition-colors disabled:opacity-50"
                  >
                    {isCapturing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Capturando máxima calidad...
                      </>
                    ) : (
                      <>
                        <Camera size={16} /> Capturar Fotografía
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    aria-label="Cambiar cámara frontal o trasera"
                    title="Cambiar cámara"
                    className="min-h-[42px] px-3.5 flex items-center justify-center gap-1.5 bg-surface-secondary text-brand-slate hover:bg-border-light rounded-md text-[12px] font-semibold transition-colors"
                  >
                    <SwitchCamera size={16} />
                    <span className="hidden sm:inline">Cambiar</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    aria-label="Cerrar cámara"
                    className="min-h-[42px] px-3.5 flex items-center justify-center gap-1.5 bg-surface-white border border-border-light text-brand-slate hover:bg-surface-secondary rounded-md text-[12px] font-semibold transition-colors"
                  >
                    <X size={16} /> Cerrar
                  </button>
                </>
              )}

              {pendingCapture && (
                <>
                  <button
                    type="button"
                    onClick={handleDiscardCapture}
                    disabled={isSaving}
                    className="min-h-[42px] px-4 flex items-center justify-center gap-1.5 bg-surface-white border border-border-light hover:bg-surface-secondary text-brand-slate rounded-md font-semibold text-[13px] transition-colors disabled:opacity-50"
                  >
                    <X size={15} /> Descartar
                  </button>
                  <button
                    type="button"
                    onClick={handleRetakeCapture}
                    disabled={isSaving}
                    className="min-h-[42px] px-4 flex items-center justify-center gap-1.5 bg-surface-secondary hover:bg-border-light text-brand-slate rounded-md font-semibold text-[13px] transition-colors disabled:opacity-50"
                  >
                    <RotateCcw size={15} /> Repetir
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSavePhoto()}
                    disabled={isSaving || !selectedCattleId}
                    className="flex-1 min-h-[42px] flex justify-center items-center gap-2 bg-brand-primary hover:bg-brand-dark text-white px-5 rounded-md font-semibold text-[13px] transition-colors shadow-sm disabled:opacity-50"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Guardando en IndexedDB...
                      </>
                    ) : (
                      <>
                        <Save size={16} /> Guardar Fotografía
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Columna Derecha: Galería de Fotografías Almacenadas Localmente */}
        <section className="lg:col-span-5 bg-surface-white border border-border-light rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-border-light bg-surface-app/30 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-[15px] text-brand-forest flex items-center gap-2">
                <ImageIcon size={17} className="text-brand-primary" />
                Fotografías Guardadas ({photos.length})
              </h2>
            </div>

            <select
              aria-label="Filtrar fotografías por animal"
              value={galleryAnimalFilter}
              onChange={(e) => setGalleryAnimalFilter(e.target.value)}
              className="w-full h-[36px] px-3 bg-surface-white border border-border-light rounded-md text-[12px] text-brand-slate outline-none focus:border-brand-primary"
            >
              <option value="todos">Todos los animales ({storage.totalPhotos})</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.arete} — {a.raza}
                </option>
              ))}
            </select>
          </div>

          <div className="p-4 flex-1 overflow-y-auto max-h-[560px] space-y-3">
            {galleryError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-[12px] flex items-center gap-2"
              >
                <AlertCircle size={15} className="shrink-0" />
                <span>{galleryError}</span>
              </div>
            )}

            {loadingGallery ? (
              <div className="py-10 text-center text-[13px] text-brand-slate/60">
                Recuperando fotografías de IndexedDB...
              </div>
            ) : photos.length === 0 ? (
              <EmptyState
                title="Sin fotografías guardadas"
                message={
                  galleryAnimalFilter !== 'todos'
                    ? 'Este animal aún no tiene fotografías registradas.'
                    : 'Las fotografías capturadas o adjuntadas se guardarán localmente aquí y permanecerán tras recargar.'
                }
                icon={ImageIcon}
              />
            ) : (
              photos.map((photo) => {
                const animal = animalById.get(photo.cattleId);
                return (
                  <article
                    key={photo.id}
                    className="p-3 rounded-xl border border-border-light bg-surface-app/25 flex items-start gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => setInspectPhoto(photo)}
                      aria-label={`Ampliar fotografía ${photo.nombreArchivo}`}
                      className="w-20 h-20 rounded-lg overflow-hidden border border-border-light shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
                    >
                      <BlobImage
                        blob={photo.blobData}
                        remoteUrl={photo.urlRemota}
                        alt={`Fotografía de ${animal?.arete || photo.cattleId}`}
                        className="w-full h-full object-cover"
                      />
                    </button>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {animal ? (
                          <Link
                            to={`/cattle/${animal.id}`}
                            className="font-bold text-[13px] text-brand-forest hover:text-brand-primary hover:underline truncate"
                          >
                            {animal.arete}
                          </Link>
                        ) : (
                          <span className="font-bold text-[13px] text-brand-forest truncate">
                            {photo.cattleId.slice(0, 8)}
                          </span>
                        )}
                        {renderUploadBadge(photo.estadoArchivo)}
                      </div>

                      <p className="text-[11px] text-brand-slate/70">
                        {photo.tipo === 'FotoPerfil' ? 'Foto de perfil' : 'BoviScale'} ·{' '}
                        {formatBytesHuman(photo.tamanoBytes)} · {photo.mimeType}
                      </p>

                      <p className="text-[11px] text-brand-slate/60">
                        {formatDateTimeDisplay(photo.fechaCaptura)}
                      </p>

                      <div className="pt-1 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setInspectPhoto(photo)}
                          className="text-[11px] font-semibold text-brand-primary hover:underline inline-flex items-center gap-1"
                        >
                          <Eye size={12} /> Ver
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePhoto(photo)}
                          aria-label={`Eliminar fotografía ${photo.nombreArchivo}`}
                          className="text-[11px] font-semibold text-status-danger hover:underline inline-flex items-center gap-1"
                        >
                          <Trash2 size={12} /> Eliminar
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Modal de inspección ampliada */}
      {inspectPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-photo-title"
          onClick={() => setInspectPhoto(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-border-light flex items-center justify-between">
              <div>
                <h3 id="inspect-photo-title" className="font-bold text-[15px] text-brand-forest">
                  {animalById.get(inspectPhoto.cattleId)?.arete || inspectPhoto.cattleId} —{' '}
                  {inspectPhoto.tipo === 'FotoPerfil' ? 'Foto de perfil' : 'BoviScale'}
                </h3>
                <p className="text-[11px] text-brand-slate/65">
                  {inspectPhoto.nombreArchivo} · {formatBytesHuman(inspectPhoto.tamanoBytes)} ·{' '}
                  {formatDateTimeDisplay(inspectPhoto.fechaCaptura)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectPhoto(null)}
                aria-label="Cerrar vista ampliada"
                className="p-1.5 rounded-md text-brand-slate/70 hover:bg-surface-secondary"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 bg-black/5 flex items-center justify-center max-h-[70vh]">
              <BlobImage
                blob={inspectPhoto.blobData}
                remoteUrl={inspectPhoto.urlRemota}
                alt={inspectPhoto.nombreArchivo}
                className="max-w-full max-h-[62vh] object-contain rounded-lg"
              />
            </div>
            <div className="px-5 py-3 border-t border-border-light flex flex-wrap items-center justify-between gap-2 text-[11px] text-brand-slate/70">
              <div className="flex items-center gap-2">
                {renderUploadBadge(inspectPhoto.estadoArchivo)}
                {inspectPhoto.idOperacionSubida && (
                  <span className="font-mono">
                    Op: {inspectPhoto.idOperacionSubida.slice(0, 8)}…
                  </span>
                )}
              </div>
              {inspectPhoto.checksumSha256 && (
                <span className="font-mono">
                  SHA-256: {inspectPhoto.checksumSha256.slice(0, 12)}…
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de eliminación */}
      {confirmDeletePhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-photo-title"
          onClick={() => !isDeleting && setConfirmDeletePhoto(null)}
        >
          <div
            className="bg-surface-white border border-border-light rounded-xl shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="confirm-delete-photo-title"
              className="text-lg font-condensed font-bold text-brand-forest"
            >
              Eliminar fotografía
            </h2>
            <p className="text-[13px] text-brand-slate/80">
              ¿Deseas eliminar la fotografía <strong>{confirmDeletePhoto.nombreArchivo}</strong> del
              historial local?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeletePhoto(null)}
                disabled={isDeleting}
                className="min-h-[38px] px-4 bg-surface-white border border-border-light hover:bg-surface-secondary rounded-md text-[13px] font-semibold text-brand-slate cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                className="min-h-[38px] px-4 bg-status-danger hover:bg-red-700 text-white rounded-md text-[13px] font-semibold cursor-pointer transition-colors shadow-xs disabled:opacity-50"
              >
                {isDeleting ? 'Eliminando...' : 'Confirmar Eliminación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
