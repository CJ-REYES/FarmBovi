import { useEffect, useState, type ReactNode } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { buildSafeHeaders, readSessionAuthToken, resolveMediaUrl } from '../../lib/api';

interface BlobImageProps {
  blob?: Blob;
  remoteUrl?: string | null;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}

function isProtectedMediaContentUrl(url: string): boolean {
  return /\/api\/media\/archivos\/[^/]+\/contenido(?:$|\?)/i.test(url);
}

/**
 * Renderiza un `Blob` binario local mediante `URL.createObjectURL` (sin tráfico de red y liberando
 * la referencia con `URL.revokeObjectURL`) o, si el archivo proviene de otro dispositivo sin copia
 * Blob local, carga bajo demanda la URL privada (`/api/media/archivos/{id}/contenido`) adjuntando
 * credenciales/Bearer cuando aplica y aplicando carga diferida (`loading="lazy"`).
 */
export default function BlobImage({
  blob,
  remoteUrl,
  alt,
  className,
  fallback
}: BlobImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [remoteBlobUrl, setRemoteBlobUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      const clearTimer = window.setTimeout(() => setObjectUrl(null), 0);
      return () => window.clearTimeout(clearTimer);
    }

    const url = URL.createObjectURL(blob);
    const setTimer = window.setTimeout(() => {
      setLoadFailed(false);
      setObjectUrl(url);
    }, 0);

    return () => {
      window.clearTimeout(setTimer);
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    };
  }, [blob]);

  const resolvedRemoteUrl = !blob ? resolveMediaUrl(remoteUrl) : null;
  const needsAuthorizedFetch = Boolean(
    resolvedRemoteUrl &&
      isProtectedMediaContentUrl(resolvedRemoteUrl) &&
      readSessionAuthToken()
  );

  useEffect(() => {
    if (!needsAuthorizedFetch || !resolvedRemoteUrl) {
      const clearTimer = window.setTimeout(() => setRemoteBlobUrl(null), 0);
      return () => window.clearTimeout(clearTimer);
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const failTimer = window.setTimeout(() => {
        setRemoteBlobUrl(null);
        setLoadFailed(true);
      }, 0);
      return () => window.clearTimeout(failTimer);
    }

    const controller = new AbortController();
    let createdUrl: string | null = null;
    let active = true;

    (async () => {
      try {
        const res = await fetch(resolvedRemoteUrl, {
          method: 'GET',
          headers: buildSafeHeaders({ Accept: 'image/*' }),
          credentials: 'include',
          signal: controller.signal
        });
        if (!active) return;
        if (!res.ok) {
          setLoadFailed(true);
          setRemoteBlobUrl(null);
          return;
        }
        const fetchedBlob = await res.blob();
        if (!active || fetchedBlob.size === 0) return;
        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          createdUrl = URL.createObjectURL(fetchedBlob);
          setLoadFailed(false);
          setRemoteBlobUrl(createdUrl);
        }
      } catch {
        if (active && !controller.signal.aborted) {
          setLoadFailed(true);
          setRemoteBlobUrl(null);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
      if (createdUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [needsAuthorizedFetch, resolvedRemoteUrl]);

  const resolvedSrc =
    objectUrl || (needsAuthorizedFetch ? remoteBlobUrl : resolvedRemoteUrl);

  if (!resolvedSrc || loadFailed) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return (
      <div className="w-full h-full flex items-center justify-center bg-surface-secondary/50 text-brand-slate/45 text-[11px]">
        <ImageIcon size={20} />
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setLoadFailed(true)}
    />
  );
}
