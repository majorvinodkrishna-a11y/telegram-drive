/**
 * Public entry points for the Google-Photos-style "Photos mode".
 *
 *   <PhotosHome source={mockOrTelegramSource} />
 *
 * - `MockPhotoSource`   → offline demo data (dev preview / design reviews).
 * - `TelegramPhotoSource` → real library built from Telegram folders; drop it
 *   into the mobile dashboard and wire `loadFiles` to the folder loader and
 *   `resolveSrc` to the streaming endpoint (see docs/PHOTOS_MODE_PLAN.md).
 */
export { PhotosHome } from './PhotosHome';
export { PhotoViewer } from './PhotoViewer';
export { MockPhotoSource } from './sources/MockPhotoSource';
export { TelegramPhotoSource, type TelegramFolderRef, type TelegramSourceOptions } from './sources/TelegramPhotoSource';
export type { PhotoSource, PhotoSourceInfo } from './sources/PhotoSource';
export * from './photoTypes';
