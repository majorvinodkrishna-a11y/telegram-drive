/**
 * Core domain types for the Google-Photos-style "Photos mode".
 *
 * These types are intentionally free of any Tauri / i18n / context dependency so
 * the whole feature module can be mounted anywhere (mobile dashboard, desktop
 * pane, or a dev-only visual preview) and unit-tested in isolation.
 */

export type MediaKind = 'image' | 'video';

/** A single media object. In real usage this maps 1:1 to a TelegramFile. */
export interface PhotoItem {
  /** Stable identity (Telegram message id in real mode, generated in mock). */
  id: string;
  /** Original file name, e.g. "IMG_20260101_103000.jpg". */
  name: string;
  kind: MediaKind;
  /** Capture / upload epoch (ms). Drives date grouping + date search. */
  takenAt: number;
  sizeBytes: number;
  width: number;
  height: number;
  /** Video length in seconds (videos only). */
  durationSec?: number;
  /** Telegram "folder" = channel. null = Saved Messages. */
  folderId: number | null;
  /** Human label for the folder ("Saved Messages" or channel name). */
  folderLabel: string;
  /** Small thumbnail src (data:, blob:, or stream URL). */
  thumb?: string;
  /** Full-resolution src for the viewer. */
  src?: string;
  /**
   * True when `src`/`thumb` point at a Telegram streaming endpoint (so the
   * browser progressively pulls bytes from the cloud instead of a finished
   * local file). The UI shows the "streaming / not yet downloaded" note.
   */
  streaming: boolean;
  /** True => the original bytes still live only in the Telegram cloud. */
  remote: boolean;
  starred?: boolean;
}

export interface PhotoAlbum {
  id: string;
  title: string;
  /** folders/source collections are surfaced as albums too. */
  kind: 'album' | 'folder';
  itemIds: string[];
  coverItemId?: string;
  itemCount: number;
  /** Most recent item date for sorting. */
  latestTs: number;
}

/** The full read model handed to the UI by a PhotoSource. */
export interface PhotoLibrary {
  items: PhotoItem[];
  albums: PhotoAlbum[];
}

/** Structural grouping helpers used by the timeline (Google-Photos layout). */
export interface DayGroup {
  key: string;
  /** Relative label: Today / Yesterday / weekday / full date. */
  label: string;
  ts: number;
  items: PhotoItem[];
}

export interface MonthGroup {
  key: string;
  /** e.g. "September 2026" or "This month". */
  label: string;
  ts: number;
  days: DayGroup[];
}

export type PhotosTab = 'photos' | 'search' | 'library';

export type KindFilter = 'all' | 'image' | 'video';

export interface SearchQuery {
  text: string;
  kind: KindFilter;
  /** Optional epoch range for "search by date". */
  range?: { from: number; to: number };
}

/* ------------------------------------------------------------------ */
/* Backup & compression                                               */
/* ------------------------------------------------------------------ */

export interface BackupSettings {
  /** Master toggle ("Back up & sync"). */
  enabled: boolean;
  /** Back up using mobile data too (not just Wi-Fi). */
  backupOverCellular: boolean;
  /** Only run backups while the charger is connected. */
  onlyOnCharger: boolean;
  /**
   * Auto-compress oversized media before upload (the philosophy of the
   * "Video Cutter & Compressor" / Naing Cutter class of apps — extreme
   * compression while keeping visual fidelity).
   */
  compressHeavyFiles: boolean;
  /** Files above this size are routed to the compressor before upload. */
  compressionThresholdBytes: number;
  /** Compression aggressiveness / quality target. */
  quality: 'high' | 'balanced' | 'efficient';
  /** "Stream on play" default for large cloud items (don't force full download). */
  streamOnPlay: boolean;
  /** Local device folders watched by the background auto-backup worker. */
  watchFolders: string[];
}

export const DEFAULT_BACKUP: BackupSettings = {
  enabled: false,
  backupOverCellular: false,
  onlyOnCharger: false,
  compressHeavyFiles: true,
  compressionThresholdBytes: 1_050_000_000, // ~1 GB default threshold
  quality: 'balanced',
  streamOnPlay: true,
  watchFolders: ['DCIM/Camera', 'DCIM/Screenshots', 'Pictures'],
};

export interface CompressionPlan {
  eligible: boolean;
  reason?: string;
  originalSize: number;
  /** humanized copy of the sizes (computed for the UI). */
  originalSizeLabel: string;
  targetSizeLabel?: string;
  /** Strategy chosen (mirrors the real codec work described in the docs). */
  strategy:
    | 'none'
    | 'stream_passthrough'
    | 'remux'
    | 'transcode_h265'
    | 'transcode_av1'
    | 'reencode'
    | 'external_cutter';
}

export interface BackupSnapshotItem {
  item: PhotoItem;
  status: 'pending' | 'compressing' | 'uploading' | 'done' | 'error';
  progress: number; // 0..1
  compression?: CompressionPlan;
}
