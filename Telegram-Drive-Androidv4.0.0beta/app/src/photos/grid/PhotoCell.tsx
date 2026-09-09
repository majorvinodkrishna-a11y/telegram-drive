import { useEffect, useRef } from 'react';
import { Check, Cloud, Play } from 'lucide-react';
import type { PhotoItem } from '../photoTypes';
import { formatDuration } from '../photoModel';

interface PhotoCellProps {
  item: PhotoItem;
  selected: boolean;
  selecting: boolean;
  onOpen: (item: PhotoItem) => void;
  onSelect: (item: PhotoItem, select: boolean) => void;
  onBeginSelect: (item: PhotoItem) => void;
}

const LONG_PRESS_MS = 460;

export function PhotoCell({ item, selected, selecting, onOpen, onSelect, onBeginSelect }: PhotoCellProps) {
  const timer = useRef<number | null>(null);
  const longFiredRef = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const handlePointerDown = () => {
    if (selecting) return;
    longFiredRef.current = false;
    timer.current = window.setTimeout(() => {
      longFiredRef.current = true;
      onBeginSelect(item);
    }, LONG_PRESS_MS);
  };

  const handleClick = () => {
    if (longFiredRef.current) return;
    if (selecting) {
      onSelect(item, !selected);
      return;
    }
    onOpen(item);
  };

  const src = item.thumb || item.src;

  return (
    <button
      type="button"
      aria-label={item.name}
      aria-pressed={selected}
      onPointerDown={handlePointerDown}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
      className={`photos-cell focus-visible:outline-none ${selected ? 'selected' : ''}`}
    >
      <span className="dim-on-select block absolute inset-0">
        {src ? (
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-app-text-tertiary">—</span>
        )}
      </span>

      <span className="photos-check" aria-hidden>
        <Check className="w-3.5 h-3.5" strokeWidth={3} />
      </span>

      {item.kind === 'video' && (
        <>
          <span className="photos-play" aria-hidden>
            <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
          </span>
          {typeof item.durationSec === 'number' && (
            <span className="photos-duration">{formatDuration(item.durationSec)}</span>
          )}
        </>
      )}
      {item.remote && (
        <span className="photos-cloud" title="Stored in the Telegram cloud — streams on play">
          <Cloud className="w-3.5 h-3.5" />
        </span>
      )}
    </button>
  );
}
