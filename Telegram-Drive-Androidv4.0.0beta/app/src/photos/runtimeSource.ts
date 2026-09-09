import type { TelegramFile } from '../types';
import type { PhotoSource } from './sources/PhotoSource';
import { MockPhotoSource } from './sources/MockPhotoSource';
import { TelegramPhotoSource, type TelegramFolderRef } from './sources/TelegramPhotoSource';

/**
 * Builds the Photos data source for the running app.
 *
 * - Inside the Tauri (Android/desktop) app with a live session → a real
 *   `TelegramPhotoSource` scanning Saved Messages + the user's channels.
 * - Otherwise (web preview, disconnected) → the offline `MockPhotoSource` so
 *   the Photos UI is always viewable and never crashes.
 *
 * `loadFiles(folderId)` streams a folder through the same `cmd_get_files` +
 * `folder-load-chunk` events the file browser already uses.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface RuntimeSourceDeps {
  folders: Array<{ id: number; name: string }>;
  connected: boolean;
  includeSavedMessages?: boolean;
}

export async function createPhotosSource(deps: RuntimeSourceDeps): Promise<PhotoSource> {
  const inTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

  if (!inTauri || !deps.connected) {
    return new MockPhotoSource();
  }

  const folderRefs: TelegramFolderRef[] = deps.folders.map((f) => ({ id: f.id, name: f.name }));

  const source = new TelegramPhotoSource({
    title: 'Photos',
    folderRefs,
    includeSavedMessages: deps.includeSavedMessages ?? true,
    connected: true,
    loadFiles: async (folder) => (await loadFolderFiles(folder.id)) as unknown as TelegramFile[],
    resolveSrc: async (file) => {
      try {
        const stream = await import('@tauri-apps/api/core');
        const invoke = stream.invoke;
        const info = await invoke<{ token: string; base_url: string }>('cmd_get_stream_info');
        const folderParam = file.folder_id != null ? String(file.folder_id) : 'home';
        return `${info.base_url}/stream/${folderParam}/${file.id}?token=${info.token}`;
      } catch {
        return undefined;
      }
    },
  });
  return source;
}

function loadFolderFiles(folderId: number | null): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve) => {
    const acc: Array<Record<string, unknown>> = [];
    let unlisten: (() => void) | undefined;
    let settled = false;

    const finalize = () => {
      if (settled) return;
      settled = true;
      unlisten?.();
      resolve(acc);
    };

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ folderId?: number | null; files?: Array<Record<string, unknown>> }>(
          'folder-load-chunk',
          (event) => {
            const pid = event.payload?.folderId ?? null;
            if (pid === folderId && Array.isArray(event.payload?.files)) {
              acc.push(...event.payload!.files!);
            }
          },
        );
      } catch {
        /* no listener available — fall through to resolve below */
      }
      // Request the folder; the command resolves after streaming completes.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('cmd_get_files', { folderId });
      } catch {
        /* best-effort */
      } finally {
        finalize();
      }
      // Safety net in case a streamed folder never signals completion.
      window.setTimeout(finalize, 15000);
    })();
  });
}
