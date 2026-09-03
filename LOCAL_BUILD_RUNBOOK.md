# Local Build Runbook — Telegram Drive (photo-gallery release)

This runbook documents how to build **Telegram Drive Android v4.0.0-beta** from
source, including the new on-device **photo gallery** feature (SQLite media
schema, EXIF extraction, WebP thumbnails, virtualized timeline, and Android
auto-sync via WorkManager + JNI).

---

## 1. What changed in this build

| Area | Change |
| --- | --- |
| SQLite | New media tables (`media_items`, `media_exif`, `media_thumbnails`, `media_sync_queue`, `app_manifest_backups`) added via `apply_media_schema` (media schema version **2**). |
| Indexing | `media_indexer.rs` dedupes by SHA-256, reads EXIF (`kamadak-exif`), and writes two WebP thumbnail tiers on-device. |
| Uploads | Originals upload **untouched as documents**; max **1 concurrent chunk stream**; jittered exponential backoff; `FLOOD_WAIT_x` pauses all queues `x+5` s without crashing. |
| Frontend | Virtualized `PhotoGalleryTimeline`, `MemoriesRail`, `MemoriesStoryViewer`; new `photos` tab in the mobile bottom nav. |
| Android | `MediaSyncBridge` (JNI), `MediaStoreObserver`, `MediaUploadWorker`, `MediaSyncScheduler` under `src-tauri/gen/android/`. |
| i18n | 13 new `gallery.*` keys, translated in all locales. |

---

## 2. Prerequisites

### Common

- **Node.js** `20.19.0+` (Node 20) or `22.12.0+` — required by the Vite 7 toolchain.
- **Rust** latest stable via [rustup](https://rustup.rs/).
- **A C compiler** (`build-essential` on Debian/Ubuntu, Xcode CLT on macOS, MSVC on
  Windows). The `webp` crate builds `libwebp` through `libwebp-sys`, which requires
  a C toolchain in addition to the normal Rust setup.
- **Telegram API credentials** (`api_id` / `api_hash`) from
  [my.telegram.org](https://my.telegram.org) → API development tools.

### Desktop (Linux)

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libfuse2
```

### Android

- **JDK 17**.
- **Android Studio** (or standalone SDK) with **SDK Platform 34** and
  **NDK** installed.
- Rust Android targets:

  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```

- Environment variables (set before building):

  ```bash
  export ANDROID_HOME="$HOME/Android/Sdk"
  export NDK_HOME="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
  export JAVA_HOME=/path/to/jdk-17
  ```

---

## 3. Full build — desktop (fastest smoke test)

```bash
cd Telegram-Drive-Androidv4.0.0beta/app
npm install

# Frontend + types + i18n validation (no Rust needed)
npm run build              # tsc && vite build
npm run i18n:check         # types + validate + scan

# Rust unit tests
cd src-tauri && cargo test --lib

# Release bundle
cd .. && npm run tauri build
```

---

## 4. Full build — Android

```bash
cd Telegram-Drive-Androidv4.0.0beta/app

# 1. Generate the Gradle project (once)
npm run tauri android init

# 2. Add the WorkManager dependency used by the auto-sync worker
#    Edit src-tauri/gen/android/app/build.gradle.kts and add:
#        implementation("androidx.work:work-runtime-ktx:2.9.1")
#    (See src-tauri/gen/android/INTEGRATION.md for full details.)

# 3. Build the APK (debug or release)
npm run tauri android build
# or release: npm run tauri android build -- --apk --target aarch64-linux-android
```

The Kotlin sources in `src-tauri/gen/android/app/src/main/java/com/cameronamer/telegramdrive/`
are kept in the repository; `tauri android init` merges them into the generated
project. The JNI symbol names match the `identifier` (`com.cameronamer.telegramdrive`)
in `src-tauri/tauri.conf.json`, so the Rust exports in `src-tauri/src/media_sync_bridge.rs`
and the Kotlin `object MediaSyncBridge` resolve automatically.

---

## 5. Verification checklist

Run from `app/`:

| Command | Expect |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | exit 0, `dist/` produced |
| `npm run i18n:types` | `[PASS] Generated … typed translation keys` (includes `gallery.*`) |
| `npm run i18n:validate` | `[PASS] All locale files passed structure, variables, and type validation.` |
| `npm run i18n:scan` | completes; only pre-existing "unextracted literals" notes remain |
| `cd src-tauri && cargo test --lib` | pass (backend; requires C toolchain) |
| `npm run test` | Vitest suite passes |

---

## 6. Notes and gotchas

- **Photo sorting** is always `ORDER BY date_taken DESC, id DESC` — never the
  Telegram message timestamp.
- **Thumbnails are generated only on-device**; Telegram receives the untouched
  original as an uncompressed document, and the returned `file_id` /
  `message_id` are written back to `media_items` before the row is marked
  `SYNCED`.
- **Flood handling** never crashes the worker: a `FLOOD_WAIT_x` response pauses
  all background queues for `x + 5` seconds through the shared `FloodGate`.
- The `webp` crate (via `libwebp-sys`) is the reason a C compiler is now a hard
  prerequisite for both desktop and Android builds.
- Android `tauri android init` regenerates `MainActivity.kt` only if it is
  absent; the repository copy already registers `MediaStoreObserver` and
  `MediaSyncScheduler`, so do not regenerate over it.
