import type { TelegramFile } from '../../types';
import type { PhotoItem, PhotoLibrary } from '../photoTypes';
import { foldersToAlbums } from '../photoModel';
import type { PhotoSource, PhotoSourceInfo } from './PhotoSource';

export interface TelegramFolderRef {
  id: number | null; // null === Saved Messages
  name: string;
}

export interface TelegramSourceOptions {
  title?: string;
  /** Channel folders to scan (each becomes an album/folder group). */
  folderRefs?: TelegramFolderRef[];
  /**
   * Lists one folder's files. Return [] when none / empty. Include the Saved
   * Messages home too if `includeSavedMessages` is true.
   */
  loadFiles(folder: TelegramFolderRef): Promise<TelegramFile[]>;
  /** Returns a thumbnail src for a file (blob/stream URL), if available. */
  resolveThumb?(file: TelegramFile): Promise<string | undefined>;
  /** Returns a full-res playback src (stream endpoint) for a file. */
  resolveSrc?(file: TelegramFile): Promise<string | undefined>;
  /** Whether a live Telegram session is connected. */
  connected?: boolean;
  /** Scan Saved Messages as well as the channel folders. */
  includeSavedMessages?: boolean;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|raw)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|3gp|ts)$/i;

function kindOf(file: TelegramFile): 'image' | 'video' | null {
  if (file.mime_type) {
    if (file.mime_type.startsWith('image/')) return 'image';
    if (file.mime_type.startsWith('video/')) return 'video';
  }
  const ext = file.name ?? '';
  if (IMAGE_EXT.test(ext)) return 'image';
  if (VIDEO_EXT.test(ext)) return 'video';
  return null;
}

function toItem(file: TelegramFile, folder: TelegramFolderRef): PhotoItem | null {
  const kind = kindOf(file);
  if (!kind) return null;
  let takenAt = 0;
  if (file.created_at) {
    const t = new Date(file.created_at).getTime();
    if (Number.isFinite(t) && t > 0) takenAt = t;
  }
  if (!takenAt) {
    // stable-ish fallback so ordering stays deterministic
    takenAt = Date.now() - (Number(file.id) % 1_000_000);
  }
  return {
    id: String(file.id),
    name: file.name,
    kind,
    takenAt,
    sizeBytes: file.size || 0,
    width: 0,
    height: 0,
    folderId: folder.id,
    folderLabel: folder.name,
    streaming: true,
    remote: true,
  };
}

/**
 * Real Telegram-backed source.
 *
 * Scans the listed folders (Saved Messages + channels), keeps only media, and
 * resolves playback srcs lazily through the same stream endpoint the rest of
 * Telegram Drive uses (`cmd_get_stream_info`). Items whose bytes still live in
 * the cloud are flagged `streaming` so the UI shows the "stream on play,
 * no forced full download" behaviour.
 */
export class TelegramPhotoSource implements PhotoSource {
  readonly info: PhotoSourceInfo;
  private folderRefs: TelegramFolderRef[];
  private includeSavedMessages: boolean;
  private loadFiles: (folder: TelegramFolderRef) => Promise<TelegramFile[]>;
  private resolveSrc?: (file: TelegramFile) => Promise<string | undefined>;

  constructor(opts: TelegramSourceOptions) {
    this.folderRefs = opts.folderRefs ?? [];
    this.includeSavedMessages = opts.includeSavedMessages ?? false;
    this.loadFiles = opts.loadFiles;
    this.resolveSrc = opts.resolveSrc;
    this.info = {
      title: opts.title ?? 'Photos',
      connected: opts.connected ?? true,
      real: true,
    };
  }

  async loadLibrary(): Promise<PhotoLibrary> {
    const refs = [...this.folderRefs];
    if (this.includeSavedMessages) {
      refs.unshift({ id: null, name: 'Saved Messages' });
    }

    const items: PhotoItem[] = [];
    // Sequential so the Rust backend isn't hammered with parallel loads.
    for (const folder of refs) {
      try {
        const files = await this.loadFiles(folder);
        for (const f of files) {
          if (f.type === 'folder') continue;
          const item = toItem(f, folder);
          if (item) items.push(item);
        }
      } catch (err) {
        // A folder may fail (channel removed, revoked session, etc.). Keep going.
        console.warn(`[Photos] failed to load folder "${folder.name}"`, err);
      }
    }
    return { items, albums: foldersToAlbums(items) };
  }

  async listLocalBackupCandidates(): Promise<PhotoItem[]> {
    // In the Tauri mobile build this is fed by the Rust/JNI camera-roll layer.
    return [];
  }

  async resolvePlayback(item: PhotoItem): Promise<{ src: string; streaming: boolean } | undefined> {
    if (!this.resolveSrc) return item.src ? { src: item.src, streaming: item.streaming } : undefined;
    const src = await this.resolveSrc(this.fileFor(item));
    return src ? { src, streaming: true } : undefined;
  }

  async performBackup(_items: PhotoItem[]): Promise<void> {
    // Integration point: upload local files via `cmd_upload_file` after the
    // compression decision is applied. See docs/PHOTOS_MODE_PLAN.md.
  }

  private fileFor(item: PhotoItem): TelegramFile {
    return {
      id: Number(item.id),
      name: item.name,
      size: item.sizeBytes,
      sizeStr: '',
      created_at: item.takenAt ? new Date(item.takenAt).toISOString() : undefined,
      type: 'file',
      folder_id: item.folderId,
    } as TelegramFile;
  }
}
