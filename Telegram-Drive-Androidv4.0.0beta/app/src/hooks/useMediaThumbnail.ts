import { useEffect, useState } from 'react';
import { getMediaThumbnail } from '../services/mediaGallery';

/**
 * Read a micro/screen thumbnail from the local Rust cache via Tauri IPC.
 * Results are memoized in a module-level cache keyed by `mediaId:tier` so a
 * virtualized grid never re-fetches the same blob while scrolling.
 */
const thumbnailCache = new Map<string, string | null>();

export function useMediaThumbnail(
  mediaId: number,
  tier: 'micro' | 'screen' = 'micro',
  hasThumb = true,
): string | null {
  const key = `${mediaId}:${tier}`;
  const [url, setUrl] = useState<string | null>(() => thumbnailCache.get(key) ?? null);

  useEffect(() => {
    if (!hasThumb) {
      setUrl(null);
      return;
    }
    if (thumbnailCache.has(key)) {
      setUrl(thumbnailCache.get(key) ?? null);
      return;
    }
    let cancelled = false;
    getMediaThumbnail(mediaId, tier)
      .then((value) => {
        thumbnailCache.set(key, value);
        if (!cancelled) setUrl(value);
      })
      .catch(() => {
        thumbnailCache.set(key, null);
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key, mediaId, tier, hasThumb]);

  return url;
}
