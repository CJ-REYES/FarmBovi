import { useEffect, useState, type ReactNode } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { resolveMediaUrl } from '../../lib/api';

interface BlobImageProps {
  blob?: Blob;
  remoteUrl?: string | null;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}

/**
 * Renderiza un `Blob` binario mediante `URL.createObjectURL` (liberando la referencia
 * automáticamente con `URL.revokeObjectURL`) o, si el archivo ya fue sincronizado desde
 * el servidor sin copia Blob local, muestra la URL pública resuelta (`/api/media/...`).
 */
export default function BlobImage({
  blob,
  remoteUrl,
  alt,
  className,
  fallback
}: BlobImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      const clearTimer = window.setTimeout(() => setObjectUrl(null), 0);
      return () => window.clearTimeout(clearTimer);
    }

    const url = URL.createObjectURL(blob);
    const setTimer = window.setTimeout(() => setObjectUrl(url), 0);

    return () => {
      window.clearTimeout(setTimer);
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    };
  }, [blob]);

  const resolvedSrc = objectUrl || resolveMediaUrl(remoteUrl);

  if (!resolvedSrc) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-secondary/50 text-brand-slate/45 text-[11px]">
        <ImageIcon size={20} />
      </div>
    );
  }

  return <img src={resolvedSrc} alt={alt} className={className} />;
}
