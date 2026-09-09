import type { PhotoItem, PhotoLibrary } from '../photoTypes';
import { foldersToAlbums } from '../photoModel';
import type { PhotoSource } from './PhotoSource';

/** Deterministic PRNG so the demo library is stable across renders. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svgUri(body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Painted placeholder "photos". Kept offline-friendly (no network) so the
 * dev preview looks like a real gallery without external requests. In the
 * Telegram-backed mode these are replaced by real file previews.
 */
function scene(hue: number, variant: number, kind: 'image' | 'video'): string {
  const h = Math.round(hue % 360);
  const h2 = (h + 42) % 360;
  const h3 = (h + 130) % 360;
  let sky = '';
  let ground = '';
  switch (variant % 8) {
    case 0: // sunset mountains
      sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h2},85%,66%)"/><stop offset="1" stop-color="hsl(${h},90%,46%)"/></linearGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        <circle cx="210" cy="150" r="44" fill="hsl(${h3},95%,82%)" opacity="0.95"/>
        <polygon points="0,300 90,150 150,300" fill="hsl(${h},40%,22%)" opacity="0.9"/>
        <polygon points="120,320 230,120 320,320" fill="hsl(${h},55%,15%)"/>`;
        break;
    case 1: // ocean
      sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},80%,72%)"/><stop offset="1" stop-color="hsl(${h2},85%,55%)"/></linearGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        <circle cx="120" cy="120" r="38" fill="#fff8e7" opacity="0.95"/>
        <ellipse cx="160" cy="240" rx="240" ry="60" fill="hsl(${h2},70%,45%)" opacity="0.8"/>
        <ellipse cx="160" cy="268" rx="260" ry="70" fill="hsl(${h2},75%,38%)" opacity="0.75"/>`;
        break;
    case 2: // forest
      sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},55%,72%)"/><stop offset="1" stop-color="hsl(${h3},60%,60%)"/></linearGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        <circle cx="240" cy="80" r="26" fill="#fff" opacity="0.9"/>
        <polygon points="60,320 110,170 160,320" fill="#1c3a24"/>
        <polygon points="110,320 170,130 230,320" fill="#244b2e"/>
        <polygon points="170,320 235,120 300,320" fill="#1b3a24"/>`;
        break;
    case 3: // city dusk
      sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1029"/><stop offset="1" stop-color="hsl(${h},70%,42%)"/></linearGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        <circle cx="70" cy="200" r="52" fill="hsl(${h2},95%,66%)" opacity="0.8"/>
        <g fill="#0c0d20">${Array.from({ length: 9 }, (_, i) => `<rect x="${12 + i * 34}" y="${150 + ((i * 37) % 90)}" width="22" height="${170 - ((i * 37) % 90)}"/>`).join('')}</g>
        <g fill="#ffd66b">${Array.from({ length: 18 }, (_, i) => `<rect x="${18 + ((i * 41) % 300)}" y="${156 + ((i * 29) % 150)}" width="3" height="3" opacity="${0.6 + (i % 3) * 0.15}"/>`).join('')}</g>`;
        break;
    case 4: // desert dunes
      sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},90%,88%)"/><stop offset="1" stop-color="hsl(${h2},90%,66%)"/></linearGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        <circle cx="250" cy="130" r="40" fill="#fff6d8" opacity="0.95"/>
        <path d="M0,260 Q90,180 180,240 T320,220 L320,320 L0,320 Z" fill="hsl(${h2},75%,60%)"/>
        <path d="M0,300 Q130,240 220,290 T320,285 L320,320 L0,320 Z" fill="hsl(${h2},70%,52%)"/>`;
        break;
    case 5: // aurora / night
      sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04061a"/><stop offset="1" stop-color="hsl(${h},60%,22%)"/></linearGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        <circle cx="70" cy="70" r="26" fill="#eef" opacity="0.9"/>
        <path d="M40,120 Q120,40 200,120 T360,130" stroke="hsl(150,90%,60%)" stroke-width="46" fill="none" opacity="0.45"/>
        <path d="M20,170 Q150,90 300,180" stroke="hsl(${h3},90%,60%)" stroke-width="34" fill="none" opacity="0.35"/>
        <polygon points="0,300 80,230 160,300 260,240 320,300 320,320 0,320" fill="#060816"/>`;
        break;
    case 6: // portrait bokeh
      sky = `<defs><radialGradient id="g"><stop offset="0" stop-color="hsl(${h2},70%,80%)"/><stop offset="1" stop-color="hsl(${h},70%,52%)"/></radialGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        ${Array.from({ length: 12 }, (_, i) => `<circle cx="${30 + (i * 47) % 300}" cy="${40 + (i * 73) % 250}" r="${6 + (i % 4) * 5}" fill="#fff" opacity="${0.15 + (i % 3) * 0.1}"/>`).join('')}`;
        break;
    default: // minimal colorfield
      sky = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},80%,60%)"/><stop offset="1" stop-color="hsl(${h3},80%,70%)"/></linearGradient></defs>
        <rect width="320" height="320" fill="url(#g)"/>
        <circle cx="160" cy="160" r="92" fill="hsl(${h2},90%,85%)" opacity="0.9"/>`;
  }
  if (kind === 'video') {
    // faint film-edge + center mark to read as motion media even before load
    ground += `<rect x="4" y="4" width="312" height="312" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="1"/>
      <rect x="150" y="132" width="20" height="56" rx="2" fill="#fff" opacity="0.85"/><path d="M174,136 L196,160 L174,184 Z" fill="#000" opacity="0.6"/>`;
  }
  return svgUri(sky + ground);
}

export interface MockOptions {
  title?: string;
  count?: number;
  now?: number;
}

const SAVED = 'Saved Messages';
const TRAVEL = 'Travel 2026';
const FAMILY = 'Family';
const SCREENSHOTS = 'Screenshots';

/** Stable per-folder ids (null => Saved Messages), mirrors Telegram channel ids. */
const FOLDER_IDS: Record<string, number | null> = {
  [SAVED]: null,
  [TRAVEL]: 221,
  [FAMILY]: 309,
  [SCREENSHOTS]: 415,
};

export class MockPhotoSource implements PhotoSource {
  readonly info = { title: 'Photos', connected: true, real: false };
  private opts: Required<MockOptions>;

  constructor(opts: MockOptions = {}) {
    this.opts = {
      title: 'Photos',
      count: opts.count ?? 76,
      now: opts.now ?? Date.now(),
    };
  }

  async loadLibrary(): Promise<PhotoLibrary> {
    const items = this.buildItems();
    return { items, albums: foldersToAlbums(items) };
  }

  async listLocalBackupCandidates(): Promise<PhotoItem[]> {
    // 4 local files that haven't been backed up yet.
    const now = this.opts.now;
    return [0, 1, 2, 3].map((i) => {
      const hue = 40 + i * 90;
      const isVid = i === 3;
      const takenAt = now - (i + 1) * 3_600_000 * (2 + i);
      const heavy = i === 3;
      return {
        id: `local-${i}`,
        name: isVid
          ? `VID_20260908_2${i}${i}${i}00.mp4`
          : `IMG_LOCAL_20260909_${i}${i}${i}000.jpg`,
        kind: isVid ? 'video' : 'image',
        takenAt,
        sizeBytes: heavy ? 1_850_000_000 : 6_200_000 + i * 900_000,
        width: isVid ? 3840 : 4032,
        height: isVid ? 2160 : 3024,
        durationSec: isVid ? 42 : undefined,
        folderId: null,
        folderLabel: SAVED,
        thumb: scene(hue, i, isVid ? 'video' : 'image'),
        src: scene(hue, i, isVid ? 'video' : 'image'),
        streaming: false,
        remote: false,
      };
    });
  }

  async resolvePlayback(item: PhotoItem) {
    return { src: item.src ?? item.thumb ?? '', streaming: item.streaming };
  }

  async performBackup(_items: PhotoItem[]): Promise<void> {
    return; // no-op for the demo; simulates success
  }

  private buildItems(): PhotoItem[] {
    const rnd = mulberry32(20260909);
    const now = this.opts.now;
    const DAY = 86_400_000;
    const items: PhotoItem[] = [];

    // plan buckets: some today, yesterday, this week, then across July/Aug/June 2026.
    const buckets: { label: string; folder: string; count: number; daysAgo: (r: () => number) => number }[] = [
      { label: 'Today', folder: SAVED, count: 3, daysAgo: () => 0 },
      { label: 'Yesterday', folder: TRAVEL, count: 5, daysAgo: () => 1 },
      { label: 'This week', folder: FAMILY, count: 7, daysAgo: () => 2 + Math.floor(rnd() * 4) },
      { label: 'August 2026', folder: SAVED, count: 16, daysAgo: () => 9 + Math.floor(rnd() * 24) },
      { label: 'Late July 2026', folder: TRAVEL, count: 15, daysAgo: () => 34 + Math.floor(rnd() * 16) },
      { label: 'July 2026', folder: SCREENSHOTS, count: 10, daysAgo: () => 51 + Math.floor(rnd() * 12) },
      { label: 'June 2026', folder: FAMILY, count: 14, daysAgo: () => 70 + Math.floor(rnd() * 20) },
    ];

    let idx = 0;
    for (const bucket of buckets) {
      for (let i = 0; i < bucket.count; i++) {
        idx += 1;
        const isVideo = idx % 11 === 0;
        const daysAgo = Math.min(200, bucket.daysAgo(rnd));
        const hour = Math.floor(rnd() * 24);
        const minute = Math.floor(rnd() * 60);
        const taken = new Date(now - daysAgo * DAY);
        taken.setHours(hour, minute, 0, 0);
        const ts = taken.getTime();
        const d = taken;
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
        const hue = Math.floor(rnd() * 360);
        const variant = Math.floor(rnd() * 8);
        const heavyVideo = isVideo && (idx % 5 === 0);
        const w = isVideo ? (idx % 2 === 0 ? 3840 : 2560) : rnd() > 0.5 ? 4032 : 3000;
        const h = isVideo ? 2160 : Math.round(w * (rnd() > 0.5 ? 1.33 : 0.75));
        const name = isVideo
          ? `VID_${stamp}_${pad(hour)}${pad(minute)}${pad(idx % 60)}.mp4`
          : bucket.folder === SCREENSHOTS
            ? `Screenshot_${stamp}-${pad(hour)}-${pad(minute)}-${pad(idx % 60)}.png`
            : `IMG_${stamp}_${pad(hour)}${pad(minute)}${pad(idx % 60)}.jpg`;

        const folderId = FOLDER_IDS[bucket.folder] ?? null;
        items.push({
          id: String(idx),
          name,
          kind: isVideo ? 'video' : 'image',
          takenAt: ts,
          sizeBytes: isVideo
            ? heavyVideo
              ? (1_400_000_000 + Math.floor(rnd() * 900_000_000)) // > threshold -> compress/stream note
              : 60_000_000 + Math.floor(rnd() * 180_000_000)
            : bucket.folder === SCREENSHOTS
              ? 900_000 + Math.floor(rnd() * 2_500_000)
              : 2_400_000 + Math.floor(rnd() * 6_000_000),
          width: w,
          height: h,
          durationSec: isVideo ? 12 + Math.floor(rnd() * 240) : undefined,
          folderId,
          folderLabel: bucket.folder,
          thumb: scene(hue, variant, isVideo ? 'video' : 'image'),
          src: scene(hue, variant, isVideo ? 'video' : 'image'),
          streaming: heavyVideo || bucket.folder === TRAVEL,
          remote: heavyVideo || bucket.folder !== SAVED || isVideo,
        });
      }
    }
    return items;
  }
}
