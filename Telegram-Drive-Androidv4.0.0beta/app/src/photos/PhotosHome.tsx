import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Cloud, CloudOff, Download, Images, Library as LibraryIcon,
  Search as SearchIcon, Share2, Trash2, X,
} from 'lucide-react';
import type { BackupSettings, PhotoAlbum, PhotoItem, PhotosTab } from './photoTypes';
import { DEFAULT_BACKUP } from './photoTypes';
import { foldersToAlbums } from './photoModel';
import type { PhotoSource } from './sources/PhotoSource';
import { PhotoTimeline } from './grid/PhotoTimeline';
import { PhotoViewer } from './PhotoViewer';
import { BackupPanel } from './library/BackupPanel';
import { LibraryTab } from './library/LibraryTab';
import { SearchTab } from './SearchTab';
import './photos.css';

interface PhotosHomeProps {
  source: PhotoSource;
  /** When true a back chevron is shown and onExit() closes Photos mode. */
  embedded?: boolean;
  onExit?: () => void;
}

interface ViewerState {
  list: PhotoItem[];
  index: number;
}

type KindFilter = 'all' | 'image' | 'video';

export function PhotosHome({ source, embedded, onExit }: PhotosHomeProps) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<PhotosTab>('photos');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [openAlbum, setOpenAlbum] = useState<PhotoAlbum | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [settings, setSettings] = useState<BackupSettings>(DEFAULT_BACKUP);
  const [candidates, setCandidates] = useState<PhotoItem[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    source.loadLibrary().then((lib) => {
      if (!alive) return;
      setItems(lib.items);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [source]);

  const refreshCandidates = useCallback(async () => {
    const list = await source.listLocalBackupCandidates();
    setCandidates(list);
  }, [source]);

  useEffect(() => {
    void refreshCandidates();
  }, [refreshCandidates]);

  const albums = useMemo(() => foldersToAlbums(items), [items]);

  const itemsPhotos = useMemo(() => {
    const filtered = items.filter((i) => (kindFilter === 'all' ? true : i.kind === kindFilter));
    return [...filtered].sort((a, b) => b.takenAt - a.takenAt);
  }, [items, kindFilter]);

  const albumItems = useMemo(() => {
    if (!openAlbum) return [];
    const set = new Set(openAlbum.itemIds);
    return items.filter((i) => set.has(i.id)).sort((a, b) => b.takenAt - a.takenAt);
  }, [items, openAlbum]);

  /* ---------- selection helpers ---------- */
  const beginSelect = useCallback((item: PhotoItem) => {
    setSelecting(true);
    setSelected((s) => new Set(s).add(item.id));
  }, []);

  const toggleSelect = useCallback((item: PhotoItem, sel: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (sel) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const deleteSelected = useCallback(() => {
    setItems((prev) => prev.filter((i) => !selected.has(i.id)));
    setOpenAlbum(null);
    exitSelection();
  }, [selected, exitSelection]);

  const shareSelected = useCallback(async () => {
    const names = items.filter((i) => selected.has(i.id)).map((i) => i.name);
    try {
      if (navigator.share) await navigator.share({ text: names.join('\n') });
      else if (navigator.clipboard) await navigator.clipboard.writeText(names.join('\n'));
    } catch { /* cancelled */ }
  }, [items, selected]);

  const openViewer = useCallback((list: PhotoItem[], target: PhotoItem) => {
    const index = list.findIndex((i) => i.id === target.id);
    setViewer({ list, index: index >= 0 ? index : 0 });
  }, []);

  const patchSettings = useCallback((patch: Partial<BackupSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const openAlbumDrill = (album: PhotoAlbum) => {
    setOpenAlbum(album);
    setTab('library');
  };

  const timelineHandlers = {
    onOpen: (t: PhotoItem) => openViewer(currentTimelineList(), t),
    onToggleSelect: toggleSelect,
    onBeginSelect: beginSelect,
  };

  // current "big list" for the tab being shown (for consistent prev/next).
  function currentTimelineList(): PhotoItem[] {
    if (tab === 'photos') return itemsPhotos;
    if (tab === 'search') return itemsPhotos; // search has its own list passed to its own viewer
    if (tab === 'library' && openAlbum) return albumItems;
    return items;
  }

  const filterChips: { id: KindFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'image', label: 'Photos' },
    { id: 'video', label: 'Videos' },
  ];

  /* ---------- UI ---------- */
  if (backupOpen) {
    return (
      <BackupPanel
        settings={settings}
        onChange={patchSettings}
        candidates={candidates}
        refreshCandidates={() => void refreshCandidates()}
        onClose={() => setBackupOpen(false)}
      />
    );
  }

  if (viewer) {
    return (
      <div className="fixed inset-0">
        <PhotoViewer
          items={viewer.list}
          initialIndex={viewer.index}
          source={source}
          onClose={() => setViewer(null)}
          onDelete={(item) => {
            setItems((prev) => prev.filter((i) => i.id !== item.id));
            setViewer(null);
          }}
        />
      </div>
    );
  }

  const showCloudOffNotice = !settings.enabled && (tab === 'photos' || tab === 'library');

  return (
    <div className="photos-root fixed inset-0 flex flex-col overflow-hidden">
      {/* ---------- top header / selection bar ---------- */}
      {selecting ? (
        <div className="flex items-center gap-2 border-b border-app-border px-3 py-3">
          <button onClick={exitSelection} aria-label="Cancel selection" className="rounded-full p-1.5 text-app-text-secondary hover:bg-app-hover">
            <X className="h-5 w-5" />
          </button>
          <span className="flex-1 text-[15px] font-semibold text-app-text">
            {selected.size} selected
          </span>
          <button onClick={shareSelected} aria-label="Share" className="rounded-full p-2 text-app-text hover:bg-app-hover" disabled={selected.size === 0}>
            <Share2 className="h-5 w-5" />
          </button>
          <button aria-label="Download" className="rounded-full p-2 text-app-text hover:bg-app-hover" disabled={selected.size === 0}>
            <Download className="h-5 w-5" />
          </button>
          <button onClick={deleteSelected} aria-label="Delete" className="rounded-full p-2 text-app-danger hover:bg-app-hover" disabled={selected.size === 0}>
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <header className="flex items-center gap-2 px-4 pt-4 pb-2">
          {embedded && (
            <button onClick={onExit} aria-label="Back" className="rounded-full p-1.5 text-app-text hover:bg-app-hover">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-accent">{source.info.title}</p>
            <h1 className="text-[22px] font-semibold leading-tight text-app-text">
              {openAlbum ? openAlbum.title : tab === 'photos' ? 'Photos' : tab === 'search' ? 'Search' : 'Library'}
            </h1>
          </div>
          <button
            onClick={() => setBackupOpen(true)}
            aria-label="Back up & sync"
            className={`relative rounded-full p-2 ${settings.enabled ? 'text-app-accent' : 'text-app-text-secondary'} hover:bg-app-hover`}
          >
            {settings.enabled ? <Cloud className="h-6 w-6" /> : <CloudOff className="h-6 w-6" />}
            {!settings.enabled && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-app-warning" />}
          </button>
        </header>
      )}

      {/* ---------- body ---------- */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {loading ? (
          <div className="px-4 pt-10 text-sm text-app-text-secondary">Loading your library…</div>
        ) : (
          <>
            {!selecting && tab === 'photos' && (
              <div className="px-4 pb-1">
                <div className="flex items-center gap-1.5">
                  {filterChips.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setKindFilter(c.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${kindFilter === c.id ? 'bg-app-accent text-app-accent-contrast' : 'bg-app-surface text-app-text-secondary'}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showCloudOffNotice && !selecting && tab === 'photos' && (
              <div className="px-4 pt-2">
                <button onClick={() => setBackupOpen(true)} className="flex w-full items-center gap-2 rounded-xl border border-app-warning/30 bg-app-warning/10 px-3 py-2 text-left text-xs text-app-text">
                  <CloudOff className="h-4 w-4 shrink-0 text-app-warning" />
                  Back up &amp; sync is off — new photos and videos aren’t uploaded automatically.
                </button>
              </div>
            )}

            {tab === 'photos' && (
              <PhotoTimeline
                items={itemsPhotos}
                selecting={selecting}
                selected={selected}
                {...timelineHandlers}
              />
            )}

            {tab === 'search' && (
              <SearchTab
                items={items}
                selecting={selecting}
                selected={selected}
                onToggleSelect={toggleSelect}
                onBeginSelect={beginSelect}
                onOpenFrom={openViewer}
              />
            )}

            {tab === 'library' && openAlbum ? (
              <div>
                {!selecting && (
                  <button onClick={() => setOpenAlbum(null)} className="flex items-center gap-1 px-4 py-1 text-sm text-app-accent">
                    <ArrowLeft className="h-4 w-4" /> Back to folders
                  </button>
                )}
                <PhotoTimeline
                  items={albumItems}
                  selecting={selecting}
                  selected={selected}
                  {...timelineHandlers}
                />
              </div>
            ) : tab === 'library' ? (
              <LibraryTab
                albums={albums}
                items={items}
                onOpenAlbum={openAlbumDrill}
                onOpenBackup={() => setBackupOpen(true)}
              />
            ) : null}
          </>
        )}
      </div>

      {/* ---------- bottom nav ---------- */}
      {!selecting && <BottomNav active={tab} onChange={setTab} />}
    </div>
  );
}

function BottomNav({ active, onChange }: { active: PhotosTab; onChange: (t: PhotosTab) => void }) {
  const tabs: { id: PhotosTab; label: string; icon: ReactNode }[] = [
    { id: 'photos', label: 'Photos', icon: <Images className="h-5 w-5" /> },
    { id: 'search', label: 'Search', icon: <SearchIcon className="h-5 w-5" /> },
    { id: 'library', label: 'Library', icon: <LibraryIcon className="h-5 w-5" /> },
  ];
  return (
    <nav className="absolute inset-x-0 bottom-0 z-30 border-t border-app-border bg-app-canvas/95 backdrop-blur-xl">
      <div className="flex justify-around py-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))]">
        {tabs.map((t) => {
          const on = active === t.id;
          return (
            <button key={t.id} onClick={() => onChange(t.id)} className={`flex flex-1 flex-col items-center gap-0.5 py-1 ${on ? 'text-app-accent' : 'text-app-text-tertiary'}`}>
              {t.icon}
              <span className="text-[10px] font-medium">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
