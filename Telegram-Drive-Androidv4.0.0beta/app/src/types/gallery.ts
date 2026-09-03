export type MediaType = 'photo' | 'video';

export type MediaSyncState = 'PENDING_UPLOAD' | 'UPLOADING' | 'SYNCED' | 'FAILED' | 'LOCAL_ONLY';

export interface MediaItem {
  id: number;
  localUri: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number;
  sha256: string;
  mediaType: MediaType | string;
  /** Epoch seconds from EXIF DateTimeOriginal (falls back to file mtime). */
  dateTaken: number;
  dateAdded: number;
  width: number | null;
  height: number | null;
  orientation: number;
  durationMs: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  latitude: number | null;
  longitude: number | null;
  syncStatus: MediaSyncState | string;
  telegramMessageId: number | null;
  telegramFileId: string | null;
  hasMicroThumb: boolean;
  hasScreenThumb: boolean;
}

export interface MediaTimelinePage {
  items: MediaItem[];
  offset: number;
  limit: number;
}

export interface MemoryGroup {
  label: string;
  yearsAgo: number;
  items: MediaItem[];
}

export interface MediaSyncStatus {
  pending: number;
  uploading: number;
  synced: number;
  failed: number;
  total: number;
  floodPausedSecs: number;
}

/** Pinch-to-zoom tiers: year → month → daily 3-col → daily 1-col. */
export type GalleryZoomLevel = 'years' | 'months' | 'days' | 'single';
