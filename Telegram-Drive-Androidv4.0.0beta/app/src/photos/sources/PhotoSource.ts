import type { PhotoItem, PhotoLibrary } from '../photoTypes';

/**
 * Data-source contract for Photos mode.
 *
 * The UI is written purely against this interface so the SAME components drive
 * (a) the dev visual preview backed by `MockPhotoSource`, and (b) the real
 * Telegram-backed experience via `TelegramPhotoSource` inside the dashboard.
 */
export interface PhotoSourceInfo {
  /** Short label shown in the top chrome (e.g. the connected channel). */
  title: string;
  /** True when a live Telegram session is connected. */
  connected: boolean;
  /** False for the demo/mock adapter. */
  real: boolean;
}

export interface PhotoSource {
  readonly info: PhotoSourceInfo;

  /** Load the full media library (items + derived albums). */
  loadLibrary(): Promise<PhotoLibrary>;

  /** Local device media waiting to be (auto)backed up to the cloud. */
  listLocalBackupCandidates(): Promise<PhotoItem[]>;

  /**
   * Resolve a full-resolution, playable src for an item lazily (used by the
   * viewer). Mock returns `item.src`. Telegram returns a streaming endpoint.
   */
  resolvePlayback?(item: PhotoItem): Promise<{ src: string; streaming: boolean } | undefined>;

  /**
   * Simulate/trigger the real backup pipeline (sizes + compression decisions
   * are computed by the UI; this performs the transfer).
   */
  performBackup?(items: PhotoItem[]): Promise<void>;
}
