import { useCallback, useEffect, useState } from 'react';
import { fileImageUrl, type FileImageVariant } from '../lib/api';

export type FileImageLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export interface FileImageSource {
  src: string | null;
  status: FileImageLoadStatus;
  onLoad: () => void;
  onError: () => void;
  retry: () => void;
}

/** Load a file-backed image without forcing a bearer-authenticated fetch
 * through a cross-origin redirect. The returned status deliberately stays at
 * loading until the image element decodes the source. */
export function useFileImageSource(
  fileId: string,
  variant: FileImageVariant,
  enabled = true,
): FileImageSource {
  const [attempt, setAttempt] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<FileImageLoadStatus>(enabled ? 'loading' : 'idle');

  useEffect(() => {
    let alive = true;
    if (!enabled) {
      setSrc(null);
      setStatus('idle');
      return () => { alive = false; };
    }
    setSrc(null);
    setStatus('loading');
    void fileImageUrl(fileId, variant)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setStatus('failed');
      });
    return () => { alive = false; };
  }, [attempt, enabled, fileId, variant]);

  const onLoad = useCallback(() => setStatus('loaded'), []);
  const onError = useCallback(() => {
    setSrc(null);
    setStatus('failed');
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { src, status, onLoad, onError, retry };
}

/** Compact file image used by the composer and files list. Larger attachment
 * cards render their own loading/error UI around useFileImageSource. */
export function FileImage({
  fileId,
  variant = 'thumbnail',
  alt,
  className,
  style,
}: {
  fileId: string;
  variant?: FileImageVariant;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const image = useFileImageSource(fileId, variant);
  if (image.status === 'failed') {
    return (
      <span
        role="img"
        aria-label={`${alt || 'Image'} unavailable`}
        title={`${alt || 'Image'} unavailable`}
        className={`inline-flex items-center justify-center bg-daypill text-faint ${className ?? ''}`}
        style={style}
      >
        !
      </span>
    );
  }
  if (!image.src) {
    return (
      <span
        role="status"
        aria-label={`Loading ${alt || 'image'}`}
        className={`inline-block animate-pulse bg-daypill ${className ?? ''}`}
        style={style}
      />
    );
  }
  return (
    <img
      src={image.src}
      alt={alt}
      className={className}
      style={style}
      data-load-state={image.status}
      onLoad={image.onLoad}
      onError={image.onError}
    />
  );
}
