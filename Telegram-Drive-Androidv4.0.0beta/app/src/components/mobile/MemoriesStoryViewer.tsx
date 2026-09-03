import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useMediaThumbnail } from '../../hooks/useMediaThumbnail';
import { memoryYearsAgoLabel } from './MemoriesRail';
import type { MediaItem, MemoryGroup } from '../../types';

const SLIDE_MS = 5000;

/**
 * Full-screen "story" player for an "On this day" memory. Shows each item as a
 * Ken Burns (slow zoom/pan) slide with a progress timer; taps on the left/right
 * thirds step back/forward, taps in the middle close.
 */
export function MemoriesStoryViewer({
  groups,
  activeYearsAgo,
  onClose,
}: {
  groups: MemoryGroup[];
  activeYearsAgo: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const group = groups.find((candidate) => candidate.yearsAgo === activeYearsAgo) ?? groups[0];
  const items = group?.items ?? [];
  const groupLabel = group ? memoryYearsAgoLabel(t, group.yearsAgo) : '';
  const [index, setIndex] = useState(0);

  const advance = useCallback(() => {
    if (items.length <= 1) return;
    setIndex((current) => (current + 1) % items.length);
  }, [items.length]);

  // Auto-advance timer, reset on slide change.
  useEffect(() => {
    if (items.length <= 1) return;
    const timer = window.setInterval(advance, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [advance, index, items.length]);

  if (items.length === 0) return null;
  const item = items[index];

  const onTap = (clientX: number, width: number) => {
    const third = width / 3;
    if (clientX < third) {
      setIndex((current) => (current - 1 + items.length) % items.length);
    } else if (clientX > third * 2) {
      advance();
    } else {
      onClose();
    }
  };

  return (
    <StorySlide
      key={`${group?.yearsAgo ?? 0}-${item.id}`}
      item={item}
      groupLabel={groupLabel}
      items={items}
      index={index}
      onTap={onTap}
      onClose={onClose}
    />
  );
}

function StorySlide({
  item,
  groupLabel,
  items,
  index,
  onTap,
  onClose,
}: {
  item: MediaItem;
  groupLabel: string;
  items: MediaItem[];
  index: number;
  onTap: (clientX: number, width: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const thumb = useMediaThumbnail(item.id, 'screen', item.hasScreenThumb);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const startedRef = useRef<number>(Date.now());

  useEffect(() => {
    startedRef.current = Date.now();
    setProgress(0);
    const timer = window.setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - startedRef.current) / SLIDE_MS) * 100));
    }, 50);
    return () => window.clearInterval(timer);
  }, [item.id]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={(event) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) onTap(event.clientX, rect.width);
      }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt={item.fileName}
          draggable={false}
          className="max-w-full max-h-full object-contain select-none ken-burns"
        />
      ) : (
        <div className="text-white/70 text-sm font-semibold">{item.fileName}</div>
      )}

      <div className="absolute top-3 inset-x-3 flex gap-1">
        {items.map((storyItem, storyIndex) => (
          <div key={storyItem.id} className="h-1 flex-1 rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-white/90 rounded-full transition-[width] duration-100 ease-linear"
              style={{
                width: `${storyIndex < index ? 100 : storyIndex === index ? progress : 0}%`,
              }}
            />
          </div>
        ))}
      </div>

      <div className="absolute top-6 left-3 flex items-center gap-2">
        <span className="text-xs font-bold text-white/90">{groupLabel}</span>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-3 p-2 rounded-full bg-white/10 text-white/90 hover:bg-white/20"
        aria-label={t('gallery.close_memory')}
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
