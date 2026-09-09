import { ChevronRight, Cloud, FolderOpen, Layers, Video } from 'lucide-react';
import type { PhotoAlbum, PhotoItem } from '../photoTypes';

interface LibraryTabProps {
  albums: PhotoAlbum[];
  items: PhotoItem[];
  onOpenAlbum: (album: PhotoAlbum) => void;
  onOpenBackup: () => void;
}

function countKind(items: PhotoItem[], album: PhotoAlbum): { images: number; videos: number } {
  let images = 0;
  let videos = 0;
  const set = new Set(album.itemIds);
  for (const it of items) {
    if (set.has(it.id)) {
      if (it.kind === 'video') videos += 1;
      else images += 1;
    }
  }
  return { images, videos };
}

export function LibraryTab({ albums, items, onOpenAlbum, onOpenBackup }: LibraryTabProps) {
  const byId = new Map(items.map((i) => [i.id, i]));

  return (
    <div className="px-4 pt-2">
      {/* Utilities row */}
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <button
          onClick={onOpenBackup}
          className="flex items-center gap-2.5 rounded-xl border border-app-border bg-app-surface p-3 text-left hover:bg-app-hover"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-app-accent-soft text-app-accent">
            <Cloud className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-app-text">Back up</span>
            <span className="block truncate text-[11px] text-app-text-secondary">Sync &amp; compress</span>
          </span>
        </button>
        <div className="flex items-center gap-2.5 rounded-xl border border-app-border bg-app-surface p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-app-surface-raised text-app-text-secondary">
            <Layers className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-app-text">Library</span>
            <span className="block truncate text-[11px] text-app-text-secondary">{items.length} items</span>
          </span>
        </div>
      </div>

      <h2 className="px-1 pb-2 text-sm font-medium text-app-text">Folders</h2>
      {albums.length === 0 && (
        <p className="rounded-xl border border-app-border bg-app-surface p-6 text-center text-sm text-app-text-secondary">
          No photo folders yet.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 pb-28">
        {albums.map((album) => {
          const cover = album.coverItemId ? byId.get(album.coverItemId) : undefined;
          const { images, videos } = countKind(items, album);
          return (
            <button
              key={album.id}
              onClick={() => onOpenAlbum(album)}
              className="group overflow-hidden rounded-xl border border-app-border bg-app-surface text-left hover:bg-app-hover"
            >
              <div className="relative aspect-[4/3] w-full bg-app-surface-raised">
                {cover?.thumb ? (
                  <img src={cover.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FolderOpen className="absolute inset-0 m-auto h-8 w-8 text-app-text-tertiary" />
                )}
                <span className="absolute right-1.5 top-1.5 flex h-6 items-center rounded-md bg-black/50 px-1.5 text-[11px] font-semibold text-white backdrop-blur">
                  {album.itemCount}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="truncate text-[13px] font-medium text-app-text">{album.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-app-text-tertiary group-hover:text-app-text-secondary" />
              </div>
              <p className="flex items-center gap-2 px-2.5 pb-2 text-[11px] text-app-text-secondary">
                {images > 0 && <span>{images} photo{images > 1 ? 's' : ''}</span>}
                {videos > 0 && <span className="inline-flex items-center gap-1"><Video className="h-3 w-3" />{videos}</span>}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
