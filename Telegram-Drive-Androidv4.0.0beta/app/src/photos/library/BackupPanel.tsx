import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, Check, Cloud, CloudOff, Shrink as Compress, Film, Image as ImageIcon,
  ShieldCheck, Wifi, BatteryCharging, ChevronDown, X,
} from 'lucide-react';
import type { BackupSettings, CompressionPlan, PhotoItem } from '../photoTypes';
import { buildCompressionPlan, formatBytes, qualityHint } from '../photoModel';

interface BackupPanelProps {
  settings: BackupSettings;
  onChange: (patch: Partial<BackupSettings>) => void;
  candidates: PhotoItem[];
  refreshCandidates: () => void;
  onClose: () => void;
}

const QUALITY_OPTIONS: { id: BackupSettings['quality']; label: string; hint: string }[] = [
  { id: 'high', label: 'High', hint: 'Preserve original quality' },
  { id: 'balanced', label: 'Balanced', hint: 'Size vs quality' },
  { id: 'efficient', label: 'Efficient', hint: 'Max compression, minimal visible loss' },
];

function strategyLabel(p: CompressionPlan): string {
  switch (p.strategy) {
    case 'transcode_h265': return 'Re-encode to H.265 (HEVC)';
    case 'transcode_av1': return 'Re-encode to AV1 (smallest)';
    case 'reencode': return 'Smart photo re-encode';
    case 'remux': return 'Remux stream (no quality loss)';
    case 'stream_passthrough': return 'Streamed — no local copy';
    default: return 'Upload as-is';
  }
}

export function BackupPanel({ settings, onChange, candidates, refreshCandidates, onClose }: BackupPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [backingUp, setBackingUp] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const heavy = candidates.filter((c) => c.sizeBytes > settings.compressionThresholdBytes);

  const startBackup = () => {
    if (backingUp || candidates.length === 0) return;
    setBackingUp(true);
    const step = (id: string) => {
      setProgress((p) => ({ ...p, [id]: Math.min(1, (p[id] ?? 0) + 0.08) }));
    };
    // Drive each item upward on slightly staggered intervals.
    candidates.forEach((c, i) => {
      const timer = window.setInterval(() => step(c.id), 180 + i * 40);
      timers.current.push(timer);
    });
    // Stop everything once the slowest item is done (approx) then settle.
    const stopTimer = window.setInterval(() => {
      const allDone = candidates.every((c) => (progressRef.current[c.id] ?? 0) >= 1);
      if (allDone) {
        timers.current.forEach((t) => window.clearInterval(t));
        window.clearInterval(stopTimer);
        setBackingUp(false);
      }
    }, 320);
    timers.current.push(stopTimer);
  };

  // Keep a ref mirror so the completion poll sees fresh progress.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const rowFor = (item: PhotoItem) => {
    const plan = buildCompressionPlan(item, settings);
    const p = progress[item.id] ?? 0;
    const done = p >= 1;
    return (
      <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-app-surface-raised">
          {item.thumb && <img src={item.thumb} alt="" className="h-full w-full object-cover" />}
          {item.kind === 'video' && (
            <span className="absolute bottom-0.5 left-0.5 text-[9px] leading-none bg-black/60 text-white rounded px-1 py-0.5">
              {formatBytes(item.sizeBytes)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-app-text">{item.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-app-text-secondary">
            <span>{formatBytes(item.sizeBytes)}</span>
            {plan.eligible && (
              <span className="inline-flex items-center gap-0.5 rounded bg-app-accent-soft px-1.5 py-0.5 text-app-accent">
                <Compress className="h-3 w-3" /> {strategyLabel(plan)}
                {plan.targetSizeLabel && <span>→ {plan.targetSizeLabel}</span>}
              </span>
            )}
            {done && <span className="inline-flex items-center gap-0.5 text-app-success"><Check className="h-3 w-3" /> Backed up</span>}
          </div>
          {backingUp && p > 0 && p < 1 && (
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-app-surface-raised">
              <div className="h-full bg-app-accent transition-[width] duration-200" style={{ width: `${Math.round(p * 100)}%` }} />
            </div>
          )}
        </div>
        {item.kind === 'video' && <Film className="h-4 w-4 text-app-text-tertiary" />}
        {item.kind === 'image' && <ImageIcon className="h-4 w-4 text-app-text-tertiary" />}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-app-canvas">
      <header className="flex items-center justify-between px-4 pt-5 pb-2">
        <h2 className="text-lg font-semibold text-app-text">Back up &amp; sync</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-app-text-secondary hover:bg-app-hover">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-40 no-scrollbar">
        {/* Master card */}
        <button
          onClick={() => onChange({ enabled: !settings.enabled })}
          className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-colors ${settings.enabled ? 'border-app-accent/40 bg-app-accent-soft' : 'border-app-border bg-app-surface'}`}
        >
          <span className={`flex h-11 w-11 items-center justify-center rounded-full ${settings.enabled ? 'bg-app-accent text-app-accent-contrast' : 'bg-app-surface-raised text-app-text-tertiary'}`}>
            {settings.enabled ? <Cloud className="h-6 w-6" /> : <CloudOff className="h-6 w-6" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-app-text">Back up &amp; sync</span>
            <span className="block text-xs text-app-text-secondary">
              {settings.enabled ? 'On — new photos and videos are uploaded automatically' : 'Off — nothing is backed up automatically'}
            </span>
          </span>
          <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${settings.enabled ? 'bg-app-accent' : 'bg-app-surface-raised'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${settings.enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </span>
        </button>

        {!settings.enabled && (
          <p className="mt-3 rounded-xl border border-app-border bg-app-surface p-3 text-xs leading-relaxed text-app-text-secondary">
            Turn on <span className="font-medium text-app-text">Back up &amp; sync</span> to automatically upload
            photos and videos from this device to your Telegram cloud. Heavy files are compressed first so they
            upload faster while staying sharp — and everything stays playable from the cloud without forcing a full
            download.
          </p>
        )}

        {/* Options */}
        <section className="mt-6">
          <button
            className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-sm font-medium text-app-text"
            onClick={() => setExpanded((e) => !e)}
          >
            Account &amp; options
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          {expanded && (
            <div className="mt-1 space-y-1 overflow-hidden rounded-xl border border-app-border bg-app-surface">
              <ToggleRow
                icon={<BatteryCharging className="h-4 w-4" />}
                label="Only while charging"
                desc="Back up when the device is charging to save battery"
                checked={settings.onlyOnCharger}
                onChange={(v) => onChange({ onlyOnCharger: v })}
              />
              <ToggleRow
                icon={<Wifi className="h-4 w-4" />}
                label="Use mobile data"
                desc="Allow backups over cellular networks too"
                checked={settings.backupOverCellular}
                onChange={(v) => onChange({ backupOverCellular: v })}
              />
              <ToggleRow
                icon={<ArrowDownToLine className="h-4 w-4" />}
                label="Stream large items on play"
                desc="Play & preview from the cloud instead of downloading the full file"
                checked={settings.streamOnPlay}
                onChange={(v) => onChange({ streamOnPlay: v })}
              />
            </div>
          )}
        </section>

        {/* Compression settings */}
        <section className="mt-5">
          <div className="flex items-center gap-2 px-1 py-1">
            <Compress className="h-4 w-4 text-app-text-secondary" />
            <h3 className="text-sm font-medium text-app-text">Compression before upload</h3>
          </div>
          <div className="mt-1 rounded-xl border border-app-border bg-app-surface p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-app-text">Auto-compress heavy files</p>
                <p className="text-[11px] text-app-text-secondary">
                  Files larger than {formatBytes(settings.compressionThresholdBytes)} get compressed first
                </p>
              </div>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${settings.compressHeavyFiles ? 'bg-app-accent' : 'bg-app-surface-raised'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${settings.compressHeavyFiles ? 'left-[22px]' : 'left-0.5'}`} />
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => onChange({ quality: q.id })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${settings.quality === q.id ? 'bg-app-accent text-app-accent-contrast' : 'bg-app-surface-raised text-app-text-secondary hover:text-app-text'}`}
                  title={q.hint}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-app-text-secondary">
              {qualityHint(settings.quality)} — for videos we re-encode to modern codecs (H.265 / AV1) with constant
              quality, mirroring how top compressor apps shrink clips hard without the blocky artifacts.
            </p>
          </div>
        </section>

        {/* Manual backup list */}
        <section className="mt-6">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-medium text-app-text">Not backed up yet</h3>
            <button onClick={refreshCandidates} className="text-xs font-medium text-app-accent">Refresh</button>
          </div>
          {candidates.length === 0 ? (
            <div className="mt-2 rounded-xl border border-app-border bg-app-surface p-5 text-center text-sm text-app-text-secondary">
              <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-app-success" />
              You’re all caught up — everything is backed up.
            </div>
          ) : (
            <>
              <div className="mt-2 overflow-hidden rounded-xl border border-app-border bg-app-surface">
                {candidates.map(rowFor)}
              </div>
              {heavy.length > 0 && (
                <p className="mt-2 px-1 text-[11px] text-app-text-tertiary">
                  {heavy.length} item{heavy.length > 1 ? 's are' : ' is'} over the threshold and will be auto-compressed before upload.
                </p>
              )}
              <button
                onClick={startBackup}
                disabled={backingUp}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-app-accent py-3 text-sm font-semibold text-app-accent-contrast disabled:opacity-60"
              >
                <Cloud className="h-4 w-4" />
                {backingUp ? 'Backing up…' : `Back up now (${candidates.length})`}
              </button>
            </>
          )}
        </section>
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 h-40 bg-gradient-to-t from-app-canvas to-transparent" />
    </div>
  );
}

function ToggleRow({ icon, label, desc, checked, onChange }: { icon: ReactNode; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-app-hover">
      <span className="text-app-text-secondary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-app-text">{label}</span>
        <span className="block text-[11px] text-app-text-secondary">{desc}</span>
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-app-accent' : 'bg-app-surface-raised'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
