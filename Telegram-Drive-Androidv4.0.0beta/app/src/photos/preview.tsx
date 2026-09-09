import { PhotosHome } from './PhotosHome';
import { MockPhotoSource } from './sources/MockPhotoSource';

/**
 * Dev-only visual preview (reachable via `?photos`). Uses the offline mock
 * library so the Google-Photos-style UI can be reviewed in a browser without
 * a Telegram session. The real dashboard uses the same <PhotosHome> mounted
 * with a TelegramPhotoSource.
 */
export default function PhotosPreview() {
  return <PhotosHome source={new MockPhotoSource()} />;
}
