# Building Telegram Drive Android (with the new Photos mode)

The source is a **Tauri 2 (Rust) + React/TypeScript** app; the Android app is
the Tauri mobile build. You compile it **on your own machine** with your
Android SDK/NDK and Telegram API keys — no signed APK can be produced inside a
sandbox.

## Prerequisites
- Node 20+ and npm
- Rust (stable) + Android targets: `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`
- Android SDK/NDK + JDK 17 (Tauri needs `ANDROID_HOME`, `ANDROID_NDK_HOME`)
- Your own Telegram **api_id / api_hash** (from https://my.telegram.org)
- A signing keystore for release builds

## 1. Install web deps
```bash
cd Telegram-Drive-Androidv4.0.0beta/app
npm ci
```

## 2. Verify the code compiles (no Android toolchain needed)
```bash
npx tsc --noEmit        # type check
npm run build           # tsc && vite build (web bundle)
```

## 3. Preview the Photos UI in a browser (optional)
This shows the offline demo library — no Telegram session needed:
```bash
# app dir
npx vite --config ./vite.preview.config.ts
# open http://localhost:5173  (a plain-browser dev build lands on Photos mode)
# or http://localhost:5173/?photos
```

## 4. Run on Android (debug)
```bash
npm run tauri android dev          # live on device/emulator
```

## 5. Build a release APK/AAB
```bash
npm run tauri android build        # outputs signed release(s)
```
Publish the resulting APK/AAB (or the Android Release) as a GitHub Release
asset — the repo ignores `*.apk`/`*.aab` (GitHub’s 100 MB limit).

## 6. Making Photos mode show YOUR Telegram media
`MobileDashboard` already opens Photos via `createPhotosSource()` which returns
the real `TelegramPhotoSource` inside the Tauri app. Real tiles currently stream
from the folder list; to show real thumbnails wire `resolveThumb` to
`loadThumbnail(file.id, folderId)` from `services/imagePreviewCache.ts`. Then
implement the device auto-backup runner as described in `PHOTOS_MODE_PLAN.md`
§4.3 (camera-roll MediaStore discovery + FFmpeg H.265/AV1 compression + upload).
