import { useEffect, useState, type ReactNode } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface BlobImageProps {
  blob?: Blob;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}

/**
 * Renderiza un `Blob` binario mediante `URL.createObjectURL` y libera la referencia
 * automáticamente con `URL.revokeObjectURL` al cambiar o desmontar el componente.
 * Nunca convierte fotografías a Base64.
 */
export default function BlobImage({ blob, alt, className, fallback }: BlobImageProps) {
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

  if (!objectUrl) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-secondary/50 text-brand-slate/45 text-[11px]">
        <ImageIcon size={20} />
      </div>
    );
  }

  return <img src={objectUrl} alt={alt} className={className} />;
}
