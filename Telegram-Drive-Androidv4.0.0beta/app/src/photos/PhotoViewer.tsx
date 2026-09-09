import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Cloud, Download, Info, Share2, Trash2, X,
} from 'lucide-react';
import type { PhotoItem } from './photoTypes';
import { formatBytes, formatLongDate, pixelLabel, resolutionNote, formatShortDateTime } from './photoModel';
import type { PhotoSource } from './sources/PhotoSource';

interface PhotoViewerProps {
  items: PhotoItem[];
  initialIndex: number;
  source?: PhotoSource;
  onClose: () => void;
  onDelete?: (item: PhotoItem) => void;
}

export function PhotoViewer({ items, initialIndex, source, onClose, onDelete }: PhotoViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [chrome, setChrome] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [videoBroken, setVideoBroken] = useState(false);
  const [playSrc, setPlaySrc] = useState<{ src: string; streaming: boolean } | null>(null);

  const item = items[Math.max(0, Math.min(index, items.length - 1))];
  const isVideo = item?.kind === 'video';

  useEffect(() => {
    setChrome(true);
    setInfoOpen(false);
    setVideoBroken(false);
    setPlaySrc(null);
    if (!item) return;
    let alive = true;
    (async () => {
      if (source?.resolvePlayback) {
        const resolved = await source.resolvePlayback(item);
        if (alive) setPlaySrc(resolved ?? (item.src ? { src: item.src, streaming: item.streaming } : null));
      } else if (item.src) {
        setPlaySrc({ src: item.src, streaming: item.streaming });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.src]);

  const go = (dir: number) => {
    setIndex((i) => Math.max(0, Math.min(items.length - 1, i + dir)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (!item) return null;
  const media = playSrc?.src ?? item.src ?? item.thumb ?? '';

  const streamingNote = item.streaming || item.remote;

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: item.name, text: item.name });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(item.name);
      }
    } catch { /* cancelled */ }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black text-white" onClick={(e) => { if (e.target === e.currentTarget) setChrome((c) => !c); }}>
      {/* media */}
      {isVideo ? (
        videoBroken || !media || media.startsWith('data:image') ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="relative">
              <img src={item.thumb || ''} alt="" className="max-h-[60vh] rounded-xl opacity-80" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur">
                  <Cloud className="h-8 w-8 text-white" />
                </span>
              </div>
            </div>
            <p className="max-w-sm text-sm text-white/80">
              Video is stored in your Telegram cloud.
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-white/55">
              {streamingNote
                ? 'Tapping play streams it to you on demand — no need to download the whole file first. Connect a live Telegram session to play this clip.'
                : 'This demo clip has no playable source attached. In the Telegram build it streams here.'}
            </p>
          </div>
        ) : (
          <video
            key={item.id}
            src={media}
            controls
            autoPlay
            playsInline
            onError={() => setVideoBroken(true)}
            className="absolute inset-0 m-auto h-full w-full object-contain"
          />
        )
      ) : (
        <img src={media} alt={item.name} className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-2" />
      )}

      {/* left/right nav */}
      {items.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 backdrop-blur disabled:opacity-0"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={() => go(1)}
            disabled={index >= items.length - 1}
            aria-label="Next"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 backdrop-blur disabled:opacity-0"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* chrome */}
      {chrome && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-3 pt-5">
          <button onClick={onClose} aria-label="Close viewer" className="pointer-events-auto rounded-full bg-black/40 p-2 text-white/90 backdrop-blur">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <p className="truncate px-2 text-center text-[13px] font-medium text-white/90">{item.name}</p>
          <button
            onClick={() => setInfoOpen((o) => !o)}
            aria-label="Details"
            className={`pointer-events-auto rounded-full p-2 backdrop-blur ${infoOpen ? 'bg-white text-black' : 'bg-black/40 text-white/90'}`}
          >
            <Info className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* bottom-right quick actions */}
      {chrome && !infoOpen && (
        <div className="absolute bottom-24 right-3 z-20 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={share} aria-label="Share" title="Share" className="rounded-full bg-black/40 p-2.5 text-white/90 backdrop-blur"><Share2 className="h-5 w-5" /></button>
          <button aria-label="Download" title="Download (wired in Telegram build)" className="rounded-full bg-black/40 p-2.5 text-white/90 backdrop-blur"><Download className="h-5 w-5" /></button>
          {onDelete && (
            <button onClick={() => onDelete(item)} aria-label="Delete" title="Delete" className="rounded-full bg-red-600/80 p-2.5 text-white backdrop-blur"><Trash2 className="h-5 w-5" /></button>
          )}
        </div>
      )}

      {chrome && (
        <p className="pointer-events-none absolute inset-x-0 bottom-2 z-10 text-center text-[11px] text-white/50">
          {index + 1} / {items.length}
        </p>
      )}

      {/* info sheet */}
      {infoOpen && (
        <InfoSheet item={item} streaming={Boolean(streamingNote)} onDelete={onDelete ? () => onDelete(item) : undefined} onClose={() => setInfoOpen(false)} />
      )}
      {!chrome && (
        <button onClick={() => setInfoOpen((o) => !o)} className="pointer-events-none absolute bottom-4 right-4 z-10 text-white/60" tabIndex={-1}>
          <X className="pointer-events-auto h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function InfoSheet({ item, streaming, onDelete, onClose }: { item: PhotoItem; streaming: boolean; onDelete?: () => void; onClose: () => void }) {
  const meta = useMemo(() => {
    const rows: [string, string][] = [
      ['Type', item.kind === 'video' ? 'Video' : 'Photo'],
      ['Added', formatLongDate(item.takenAt)],
      ['File name', item.name],
      ['Folder', item.folderLabel],
      ['Resolution', pixelLabel(item)],
      ['Quality', resolutionNote(item)],
      ['Size', formatBytes(item.sizeBytes)],
      ['Modified', formatShortDateTime(item.takenAt)],
    ];
    return rows;
  }, [item]);

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 animate-[slideUp_180ms_ease] rounded-t-2xl bg-white p-5 pb-8 text-gray-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300" />
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Details</h3>
        <button onClick={onClose} aria-label="Close details" className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
      </div>
      {streaming && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-[12px] text-blue-900">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">Stored in Telegram.</span> Large files play by streaming from the cloud —
            you don’t have to download the whole thing before watching or previewing.
          </span>
        </div>
      )}
      <dl className="mt-3 space-y-2">
        {meta.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-[12px] text-gray-500">{k}</dt>
            <dd className="truncate text-[13px] font-medium text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {onDelete && (
        <button onClick={onDelete} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white">
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      )}
    </div>
  );
}
