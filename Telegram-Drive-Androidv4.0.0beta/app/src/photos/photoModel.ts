import type {
  CompressionPlan,
  DayGroup,
  MonthGroup,
  PhotoAlbum,
  PhotoItem,
  SearchQuery,
  BackupSettings,
} from './photoTypes';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function dayKeyOf(ts: number): string {
  const d = new Date(startOfDay(ts));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Group newest-first into months containing day groups (Google-Photos timeline). */
export function groupIntoTimeline(items: PhotoItem[], now: number): MonthGroup[] {
  const nowDay = startOfDay(now);
  const byMonth = new Map<string, { label: string; ts: number; days: Map<string, DayGroup> }>();

  const sorted = [...items].sort((a, b) => b.takenAt - a.takenAt);
  for (const item of sorted) {
    const mk = monthKeyOf(item.takenAt);
    if (!byMonth.has(mk)) {
      const d = new Date(item.takenAt);
      const m = d.getMonth();
      const isThisMonth = monthKeyOf(now) === mk;
      byMonth.set(mk, {
        label: isThisMonth ? 'This month' : `${MONTHS[m]} ${d.getFullYear()}`,
        ts: item.takenAt,
        days: new Map<string, DayGroup>(),
      });
    }
    const bucket = byMonth.get(mk)!;
    const dk = dayKeyOf(item.takenAt);
    if (!bucket.days.has(dk)) {
      const dayStart = startOfDay(item.takenAt);
      const diff = Math.round((nowDay - dayStart) / DAY);
      const d = new Date(item.takenAt);
      let label: string;
      if (diff === 0) label = 'Today';
      else if (diff === 1) label = 'Yesterday';
      else if (diff >= 2 && diff <= 6) label = WEEKDAYS[d.getDay()];
      else label = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
      bucket.days.set(dk, { key: dk, label, ts: dayStart, items: [] });
    }
    bucket.days.get(dk)!.items.push(item);
  }

  return [...byMonth.entries()]
    .map(([key, b]) => ({
      key,
      label: b.label,
      ts: b.ts,
      days: [...b.days.values()].sort((x, y) => y.ts - x.ts),
    }))
    .sort((a, b) => b.ts - a.ts);
}

/* ------------------------------------------------------------------ */
/* Search                                                             */
/* ------------------------------------------------------------------ */

export function matchDateClause(text: string, item: PhotoItem): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return true;
  const d = new Date(item.takenAt);
  const tokens = lower.split(/\s+/);
  for (const tok of tokens) {
    const asYear = Number(tok);
    if (Number.isFinite(asYear) && asYear > 1990 && asYear < 2100) {
      if (d.getFullYear() !== asYear) return false;
      continue;
    }
    // month-name match e.g. "september", "sep", "9/2026"
    if (/^\d{1,2}\/\d{4}$/.test(tok)) {
      const [mm, yyyy] = tok.split('/').map(Number);
      if (d.getFullYear() !== yyyy) return false;
      if (d.getMonth() + 1 !== mm) return false;
      continue;
    }
    const mi = MONTHS.findIndex((m) => m.toLowerCase().startsWith(tok));
    if (mi >= 0) {
      if (d.getMonth() !== mi) return false;
      continue;
    }
    const miShort = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === tok);
    if (miShort >= 0) {
      if (d.getMonth() !== miShort) return false;
      continue;
    }
  }
  return true;
}

const KIND_TERMS = new Set([
  'photo', 'photos', 'image', 'images', 'video', 'videos', 'clip', 'clips',
  'jpg', 'jpeg', 'png', 'heic', 'raw', 'gif', 'mp4', 'mov', 'mkv', 'webm', 'm4v',
]);

const DATE_TERMS = new Set([
  'today', 'yesterday',
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

function isYearToken(token: string): boolean {
  const y = Number(token);
  return Number.isFinite(y) && y >= 1990 && y <= 2100;
}

function isSlashDateToken(token: string): boolean {
  return /^\d{1,2}\/\d{4}$/.test(token);
}

export function filterByQuery(
  items: PhotoItem[],
  query: SearchQuery,
  _now: number,
): PhotoItem[] {
  const text = query.text.trim().toLowerCase();
  const terms = text ? text.split(/\s+/).filter(Boolean) : [];

  const hasKindImage = terms.some((t) => ['photo', 'photos', 'image', 'images', 'jpg', 'jpeg', 'png', 'heic', 'raw', 'gif'].includes(t));
  const hasKindVideo = terms.some((t) => ['video', 'videos', 'clip', 'clips', 'mp4', 'mov', 'mkv', 'webm', 'm4v'].includes(t));

  const nameTerms = terms.filter((t) => !KIND_TERMS.has(t) && !DATE_TERMS.has(t) && !isYearToken(t) && !isSlashDateToken(t));

  return items
    .filter((it) => {
      if (hasKindImage && hasKindVideo) return true;
      if (hasKindImage) return it.kind === 'image';
      if (hasKindVideo) return it.kind === 'video';
      return true;
    })
    .filter((it) => matchDateClause(text, it))
    .filter((it) => !query.range || (it.takenAt >= query.range.from && it.takenAt <= query.range.to))
    .filter((it) => {
      if (nameTerms.length === 0) return true;
      const haystack = `${it.name} ${it.folderLabel}`.toLowerCase();
      return nameTerms.every((t) => haystack.includes(t));
    })
    .filter((it) => {
      if (query.kind === 'image') return it.kind === 'image';
      if (query.kind === 'video') return it.kind === 'video';
      return true;
    })
    .sort((a, b) => b.takenAt - a.takenAt);
}

/** Keyword <-> kind mapping used to fill the search quick chips. */
export function kindFromQuery(text: string): 'all' | 'image' | 'video' {
  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hasVideo = terms.some((t) => ['video', 'videos', 'clip', 'clips', 'mp4', 'mov', 'mkv', 'webm'].includes(t));
  const hasImage = terms.some((t) => ['photo', 'photos', 'image', 'images', 'jpg', 'jpeg', 'png', 'heic', 'raw'].includes(t));
  if (hasVideo && !hasImage) return 'video';
  if (hasImage && !hasVideo) return 'image';
  return 'all';
}

/** Derive "album" groupings straight from Telegram folders. */
export function foldersToAlbums(items: PhotoItem[]): PhotoAlbum[] {
  const byFolder = new Map<string, PhotoItem[]>();
  for (const it of items) {
    const key = it.folderId === null ? '__saved__' : `f${it.folderId}`;
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key)!.push(it);
  }
  const albums: PhotoAlbum[] = [];
  for (const [key, arr] of byFolder) {
    const sorted = [...arr].sort((a, b) => b.takenAt - a.takenAt);
    const label = arr[0]?.folderLabel ?? 'Saved Messages';
    albums.push({
      id: key,
      title: label,
      kind: 'folder',
      itemIds: sorted.map((s) => s.id),
      coverItemId: sorted[0]?.id,
      itemCount: sorted.length,
      latestTs: sorted[0]?.takenAt ?? 0,
    });
  }
  return albums.sort((a, b) => b.latestTs - a.latestTs);
}

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${sizes[i]}`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatLongDate(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatShortDateTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}`;
}

export function pixelLabel(item: PhotoItem): string {
  return `${item.width} × ${item.height}`;
}

export function resolutionNote(item: PhotoItem): string {
  // Heuristic note for tiles, no real bytes decoded here.
  const mp = (item.width * item.height) / 1_000_000;
  return mp >= 8 ? 'High resolution' : mp >= 2 ? 'Full resolution' : 'HD';
}

export function qualityHint(quality: BackupSettings['quality']): string {
  switch (quality) {
    case 'high': return 'Preserve original quality';
    case 'efficient': return 'Max compression, minimal visible loss';
    default: return 'Balanced size and quality';
  }
}

/** Build the compression decision shown in the Backup panel before an upload. */
export function buildCompressionPlan(item: PhotoItem, settings: BackupSettings): CompressionPlan {
  const originalSizeLabel = formatBytes(item.sizeBytes);
  const heavy = item.sizeBytes > settings.compressionThresholdBytes;

  if (!settings.compressHeavyFiles || !heavy) {
    if (item.remote || item.streaming) {
      return {
        eligible: false,
        reason: item.streaming ? 'Streamed from the cloud — no local re-encode needed' : 'Stored in the cloud as-is',
        originalSize: item.sizeBytes,
        originalSizeLabel,
        strategy: item.streaming ? 'stream_passthrough' : 'none',
      };
    }
    return { eligible: false, reason: 'Below the auto-compress threshold', originalSize: item.sizeBytes, originalSizeLabel, strategy: 'none' };
  }

  // Compression budget by quality target (mimics the "extreme but clean"
  // approach of cutter-class apps, mapped here for preview + wiring docs).
  const budgetMap: Record<BackupSettings['quality'], number> = {
    high: 0.75,
    balanced: 0.4,
    efficient: 0.22,
  };
  const factor = budgetMap[settings.quality];
  const targetSize = Math.max(8 * 1024 * 1024, Math.round(item.sizeBytes * factor));

  const strategy =
    item.kind === 'video'
      ? settings.quality === 'efficient'
        ? 'transcode_av1'
        : settings.quality === 'high'
          ? 'transcode_h265'
          : 'transcode_h265'
      : 'reencode';

  return {
    eligible: true,
    reason: `${item.kind === 'video' ? 'Video' : 'Photo'} is heavy — compress before upload`,
    originalSize: item.sizeBytes,
    originalSizeLabel,
    targetSizeLabel: `≈ ${formatBytes(targetSize)}`,
    strategy,
  };
}
