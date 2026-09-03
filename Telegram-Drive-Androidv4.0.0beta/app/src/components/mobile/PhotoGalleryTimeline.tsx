import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Camera, ImageIcon, Loader2, Play, Video, ZoomIn, ZoomOut } from 'lucide-react';
import { useMediaThumbnail } from '../../hooks/useMediaThumbnail';
import { getMediaTimeline } from '../../services/mediaGallery';
import type { GalleryZoomLevel, MediaItem } from '../../types';

/** Minimal translator signature so date helpers can render localized labels. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

const GAP = 3;
const HEADER_HEIGHT = 38;
const PAGE_SIZE = 500;
const OVERSCAN = 8;

const ZOOM_LEVELS: GalleryZoomLevel[] = ['years', 'months', 'days', 'single'];
const COLUMNS: Record<GalleryZoomLevel, number> = { years: 3, months: 4, days: 3, single: 1 };

function startOfDay(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayLabel(t: Translate, timestampMs: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(timestampMs);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff === 0) return t('gallery.today');
  if (diff === 1) return t('gallery.yesterday');
  return new Date(timestampMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function headerFor(t: Translate, zoom: GalleryZoomLevel, timestampMs: number): string {
  if (zoom === 'years') return String(new Date(timestampMs).getFullYear());
  if (zoom === 'months') {
    return new Date(timestampMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  return dayLabel(t, timestampMs);
}

interface Row {
  label: string;
  items: MediaItem[];
}

function MediaCell({
  item,
  size,
  onClick,
}: {
  item: MediaItem;
  size: number;
  onClick: () => void;
}) {
  const thumb = useMediaThumbnail(item.id, 'micro', item.hasMicroThumb);
  const isVideo = item.mediaType === 'video';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.fileName}
      className="relative overflow-hidden rounded-lg bg-telegram-hover/20 border border-telegram-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-telegram-primary"
      style={{ width: size, height: size }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt={item.fileName}
          loading="lazy"
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-telegram-subtext">
          {isVideo ? <Video className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
        </div>
      )}
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="p-1.5 rounded-full bg-black/50 text-white">
            <Play className="w-3.5 h-3.5 fill-current" />
          </span>
        </span>
      )}
      {item.syncStatus !== 'SYNCED' && (
        <span
          className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400"
          title={`Sync status: ${item.syncStatus}`}
        />
      )}
    </button>
  );
}

/**
 * Virtualized, date-grouped photo gallery timeline (Google Photos paradigm).
 *
 * - Items are sorted strictly by EXIF `date_taken` (descending) on the Rust
 *   side — never by Telegram message timestamp.
 * - Rows are rendered with `@tanstack/react-virtual`; a single sticky header
 *   shows the current "Today / Yesterday / MMMM YYYY" group.
 * - Micro-thumbnails are read from the local Rust WebP cache via Tauri IPC.
 * - Pinch-to-zoom steps through year → month → daily-3-col → daily-1-col.
 */
export function PhotoGalleryTimeline() {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState(2); // start at daily 3-column
  const [activeHeader, setActiveHeader] = useState('');
  const [viewportWidth, setViewportWidth] = useState(320);
  const touchRef = useRef<{ distance: number } | null>(null);

  const zoom = ZOOM_LEVELS[zoomIndex];
  const columns = COLUMNS[zoom];

  // Measure the viewport width for square, responsive cells.
  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const cellSize = useMemo(() => {
    const horizontalPadding = 8 * 2;
    const usable = Math.max(80, viewportWidth - horizontalPadding - GAP * (columns - 1));
    return Math.floor(usable / columns);
  }, [viewportWidth, columns]);

  const rowHeight = cellSize + GAP;

  const rows: Row[] = useMemo(() => {
    const result: Row[] = [];
    for (let i = 0; i < items.length; i += columns) {
      const rowItems = items.slice(i, i + columns);
      const first = rowItems[0];
      const timestampMs = (first.dateTaken || 0) * 1000;
      result.push({ label: headerFor(t, zoom, timestampMs), items: rowItems });
    }
    return result;
  }, [items, columns, zoom, t]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await getMediaTimeline(items.length, PAGE_SIZE);
      setItems((existing) => {
        const seen = new Set(existing.map((item) => item.id));
        const merged = page.items.filter((item) => !seen.has(item.id));
        return [...existing, ...merged];
      });
      setHasMore(page.items.length === PAGE_SIZE);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, items.length]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await getMediaTimeline(0, PAGE_SIZE);
        if (cancelled) return;
        setItems(page.items);
        setHasMore(page.items.length === PAGE_SIZE);
        if (page.items.length > 0) {
          setActiveHeader(headerFor(t, zoom, (page.items[0].dateTaken || 0) * 1000));
        } else {
          setActiveHeader(t('gallery.photos'));
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  });

  // Re-measure when the grid geometry changes.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // Infinite scroll: fetch the next page near the bottom.
  useEffect(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    if (virtualItems.length === 0) return;
    const lastIndex = virtualItems[virtualItems.length - 1].index;
    if (hasMore && lastIndex >= rows.length - OVERSCAN * 2) {
      void loadMore();
    }
  }, [rowVirtualizer, rows.length, hasMore, loadMore]);

  const handleScroll = useCallback(() => {
    const element = parentRef.current;
    if (!element) return;
    const index = Math.max(0, Math.floor(element.scrollTop / rowHeight));
    const row = rows[Math.min(index, rows.length - 1)];
    if (row && row.label !== activeHeader) setActiveHeader(row.label);
  }, [rowHeight, rows, activeHeader]);

  // Pinch-to-zoom (two-finger) — steps through the four tiers.
  const onTouchStart = useCallback((event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      touchRef.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    }
  }, []);

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    if (event.touches.length !== 2 || !touchRef.current) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const delta = distance - touchRef.current.distance;
    const threshold = 70;
    if (delta > threshold) {
      setZoomIndex((index) => {
        const next = Math.max(0, index - 1);
        touchRef.current = { distance };
        return next;
      });
    } else if (delta < -threshold) {
      setZoomIndex((index) => {
        const next = Math.min(ZOOM_LEVELS.length - 1, index + 1);
        touchRef.current = { distance };
        return next;
      });
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    touchRef.current = null;
  }, []);

  return (
    <div className="relative flex-1 min-h-0 w-full flex flex-col">
      {/* Sticky current-group header */}
      <div
        className="shrink-0 z-10 px-3 flex items-end justify-between bg-telegram-bg/95 backdrop-blur border-b border-telegram-border/20"
        style={{ height: HEADER_HEIGHT }}
      >
        <h3 className="text-sm font-bold text-telegram-text">
          {activeHeader || t('gallery.photos')}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
            disabled={zoomIndex === 0}
            className="p-1.5 rounded-lg text-telegram-subtext hover:bg-telegram-hover/30 disabled:opacity-40"
            aria-label={t('gallery.zoom_out')}
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-telegram-subtext min-w-[44px] text-center">
            {zoom === 'single' ? '1×' : zoom === 'days' ? '3×' : zoom === 'months' ? '4×' : '3×'}
          </span>
          <button
            type="button"
            onClick={() => setZoomIndex((index) => Math.min(ZOOM_LEVELS.length - 1, index + 1))}
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            className="p-1.5 rounded-lg text-telegram-subtext hover:bg-telegram-hover/30 disabled:opacity-40"
            aria-label={t('gallery.zoom_in')}
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Virtualized grid */}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2"
        onScroll={handleScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-telegram-subtext">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-xs font-semibold">{t('gallery.building_index')}</p>
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <div className="p-4 rounded-2xl bg-telegram-hover/10 text-telegram-subtext border border-telegram-border/20">
              <Camera className="w-7 h-7" />
            </div>
            <h4 className="text-sm font-bold text-telegram-text">{t('gallery.no_photos_yet')}</h4>
            <p className="text-xs text-telegram-subtext max-w-xs leading-relaxed">
              {t('gallery.no_photos_yet_desc')}
            </p>
          </div>
        )}

        {error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <p className="text-xs font-semibold text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void loadMore()}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-telegram-primary/15 text-telegram-primary"
            >
              {t('gallery.retry')}
            </button>
          </div>
        )}

        <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full flex"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                  gap: GAP,
                }}
              >
                {row.items.map((item) => (
                  <MediaCell key={item.id} item={item} size={cellSize} onClick={() => undefined} />
                ))}
              </div>
            );
          })}
        </div>

        {loading && items.length > 0 && (
          <div className="flex items-center justify-center py-4 text-telegram-subtext">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
