import { invoke } from '@tauri-apps/api/core';
import type { MediaItem, MediaSyncStatus, MediaTimelinePage, MemoryGroup } from '../types';

/** Fetch a page of the date-sorted timeline (date_taken DESC, not Telegram time). */
export function getMediaTimeline(offset: number, limit?: number): Promise<MediaTimelinePage> {
  return invoke<MediaTimelinePage>('cmd_get_media_timeline', { offset, limit });
}

/** Read a locally cached WebP thumbnail as a base64 data-URL string. */
export function getMediaThumbnail(
  mediaId: number,
  tier: 'micro' | 'screen',
): Promise<string | null> {
  return invoke<string | null>('cmd_get_media_thumbnail', { mediaId, tier });
}

/** "On this day" memories grouped by years-ago. */
export function getOnThisDayMemories(): Promise<MemoryGroup[]> {
  return invoke<MemoryGroup[]>('cmd_get_on_this_day_memories');
}

export function getMediaSyncStatus(): Promise<MediaSyncStatus> {
  return invoke<MediaSyncStatus>('cmd_get_media_sync_status');
}

/** Manually enqueue a device media URI (diagnostics / foreground ingestion). */
export function enqueueMediaUri(uri: string): Promise<void> {
  return invoke('cmd_enqueue_media_uri', { uri });
}

export function drainMediaSyncQueue(): Promise<void> {
  return invoke('cmd_drain_media_sync_queue');
}

/** Milliseconds since the epoch for a media item's `dateTaken` (seconds). */
export function mediaTimestampMs(item: MediaItem): number {
  return (item.dateTaken || 0) * 1000;
}
