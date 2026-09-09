import { useMemo } from 'react';
import type { PhotoItem } from '../photoTypes';
import { groupIntoTimeline } from '../photoModel';
import { PhotoCell } from './PhotoCell';

export interface TimelineHandlers {
  onOpen: (item: PhotoItem) => void;
  onToggleSelect: (item: PhotoItem, select: boolean) => void;
  onBeginSelect: (item: PhotoItem) => void;
}

interface PhotoTimelineProps extends TimelineHandlers {
  items: PhotoItem[];
  selecting: boolean;
  selected: Set<string>;
  now?: number;
}

export function PhotoTimeline({ items, selecting, selected, onOpen, onToggleSelect, onBeginSelect, now = Date.now() }: PhotoTimelineProps) {
  const months = useMemo(() => groupIntoTimeline(items, now), [items, now]);

  return (
    <div className="px-[3px]">
      {months.length === 0 && (
        <div className="py-24 text-center text-sm text-app-text-secondary">
          No photos or videos here yet.
        </div>
      )}
      {months.map((month) => (
        <section key={month.key}>
          <h2 className="photos-monthhead px-3 pt-5 pb-2 text-lg font-medium tracking-tight text-app-text">
            {month.label}
          </h2>
          {month.days.map((day) => (
            <div key={day.key}>
              <h3 className="px-3 pb-1.5 pt-2 text-[13px] font-semibold text-app-text-secondary">
                {day.label}
              </h3>
              <div className="photos-grid">
                {day.items.map((item) => (
                  <PhotoCell
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    selecting={selecting}
                    onOpen={onOpen}
                    onSelect={onToggleSelect}
                    onBeginSelect={onBeginSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
