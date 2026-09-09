import { useMemo, useState, type ReactNode } from 'react';
import { Search as SearchIcon, X, CalendarDays, Video, Camera, FolderOpen } from 'lucide-react';
import type { PhotoItem, SearchQuery } from './photoTypes';
import { filterByQuery } from './photoModel';
import { PhotoCell } from './grid/PhotoCell';

interface SearchTabProps {
  items: PhotoItem[];
  selecting: boolean;
  selected: Set<string>;
  onToggleSelect: (item: PhotoItem, select: boolean) => void;
  onBeginSelect: (item: PhotoItem) => void;
  onOpenFrom: (list: PhotoItem[], target: PhotoItem) => void;
}

type Kind = SearchQuery['kind'];

const SUGGESTIONS: { label: string; text: string; icon: ReactNode }[] = [
  { label: 'Videos', text: 'video', icon: <Video className="h-4 w-4" /> },
  { label: 'This year', text: '2026', icon: <CalendarDays className="h-4 w-4" /> },
  { label: 'Screenshots', text: 'Screenshot', icon: <Camera className="h-4 w-4" /> },
  { label: 'Travel', text: 'Travel', icon: <FolderOpen className="h-4 w-4" /> },
];

export function SearchTab({ items, selecting, selected, onToggleSelect, onBeginSelect, onOpenFrom }: SearchTabProps) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('all');

  const query: SearchQuery = useMemo(() => ({ text, kind }), [text, kind]);
  const results = useMemo(() => filterByQuery(items, query, Date.now()), [items, query]);

  return (
    <div className="pb-28">
      <div className="sticky top-0 z-20 bg-app-canvas/95 px-4 pt-2 pb-2 backdrop-blur">
        <div className="flex items-center gap-2 rounded-2xl border border-app-border bg-app-surface px-3 py-2 focus-within:border-app-accent">
          <SearchIcon className="h-4 w-4 shrink-0 text-app-text-tertiary" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search photos, videos, dates…"
            className="w-full bg-transparent text-[14px] text-app-text placeholder:text-app-text-tertiary focus:outline-none"
            aria-label="Search"
          />
          {text && (
            <button onClick={() => setText('')} aria-label="Clear search" className="text-app-text-tertiary hover:text-app-text">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {(['all', 'image', 'video'] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${kind === k ? 'bg-app-accent text-app-accent-contrast' : 'bg-app-surface text-app-text-secondary'}`}
            >
              {k === 'all' ? 'All' : k === 'image' ? 'Photos' : 'Videos'}
            </button>
          ))}
        </div>
      </div>

      {!text && kind === 'all' && (
        <div className="px-4 pt-4">
          <h3 className="pb-2 text-xs font-semibold uppercase tracking-wide text-app-text-tertiary">Quick searches</h3>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.label}
                onClick={() => setText(s.text)}
                className="flex items-center gap-2 rounded-full border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text hover:bg-app-hover"
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {text || kind !== 'all' ? (
        results.length === 0 ? (
          <div className="px-4 pt-16 text-center">
            <p className="text-3xl">🕵️</p>
            <p className="mt-3 text-sm font-medium text-app-text">No results for “{text || 'this filter'}”</p>
            <p className="mt-1 text-xs text-app-text-secondary">Try a file name, month, or “video”.</p>
          </div>
        ) : (
          <div className="px-4 pt-3">
            <p className="pb-2 text-xs text-app-text-secondary">
              {results.length} result{results.length > 1 ? 's' : ''}
            </p>
            <div className="photos-grid" style={{ ['--p-cols' as string]: Math.min(4, results.length || 1) }}>
              {results.map((item) => (
                <PhotoCell
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  selecting={selecting}
                  onOpen={(t) => onOpenFrom(results, t)}
                  onSelect={onToggleSelect}
                  onBeginSelect={onBeginSelect}
                />
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="px-4 pt-16 text-center text-sm text-app-text-secondary">
          Search everything you backed up — by file name, date, or whether it’s a photo or video.
        </div>
      )}
    </div>
  );
}
