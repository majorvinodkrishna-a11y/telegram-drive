# Android photo auto-sync — integration notes

This folder contains the Kotlin half of the photo-gallery auto-sync feature.
The Rust half lives in `src-tauri/src/media_sync_bridge.rs`, which exports two
JNI entry points into the compiled `libapp_lib.so`:

| Kotlin call                                       | Rust symbol (exported)                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MediaSyncBridge.nativeEnqueueMedia(uri)`          | `Java_com_cameronamer_telegramdrive_MediaSyncBridge_nativeEnqueueMedia`                |
| `MediaSyncBridge.nativeProcessPendingUploads()`    | `Java_com_cameronamer_telegramdrive_MediaSyncBridge_nativeProcessPendingUploads`       |

The package name `com.cameronamer.telegramdrive` is derived from the
`identifier` field in `src-tauri/tauri.conf.json` and matches the generated
Android application ID, so the JNI symbol names line up automatically.

## Files

- `MainActivity.kt` — Tauri entry point. Registers the `MediaStoreObserver`
  and schedules the periodic WorkManager job on startup.
- `MediaSyncBridge.kt` — `object` with `@JvmStatic external` methods that match
  the Rust `extern "system"` JNI exports, plus `System.loadLibrary("app_lib")`
  as a no-op safety net.
- `MediaStoreObserver.kt` — `ContentObserver` on `MediaStore.Images` and
  `MediaStore.Video`; debounces bursts (2 s) and enqueues unique URIs, then
  triggers a one-shot upload after each flush.
- `MediaUploadWorker.kt` — `CoroutineWorker` that calls
  `processPendingUploads()` and returns `retry()` on any failure (WorkManager
  applies exponential backoff).
- `MediaSyncScheduler.kt` — schedules the 6-hour periodic job (UNMETERED +
  charging + battery-not-low, `ExistingPeriodicWorkPolicy.KEEP`) and the
  one-shot job fired after the observer flush (`ExistingWorkPolicy.KEEP`).

## Required Gradle dependency

Tauri's generated Android template does not ship `androidx.work`. Add it to
`src-tauri/gen/android/app/build.gradle.kts` **after** `tauri android init`
and before building:

```kotlin
dependencies {
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
```

(`work-runtime-ktx` is used so `MediaUploadWorker` can extend `CoroutineWorker`
without extra plumbing. If you prefer to avoid the `-ktx` artifact, change the
worker to extend `Worker` and replace `override suspend fun doWork()` with
`override fun doWork(): Result` — the rest of the wiring is unchanged.)

## Sync flow

```
MediaStore change ──► MediaStoreObserver (debounce 2s)
                          │ enqueueMedia(uri)  (JNI → Rust media_sync_queue)
                          ▼
                 Rust media_indexer: SHA-256 dedupe + EXIF + WebP thumbnails
                          │ insert media_items (status PENDING_UPLOAD)
                          ▼
MediaSyncScheduler.scheduleOneTimeUpload ──► MediaUploadWorker
                          │ processPendingUploads (JNI → Rust)
                          ▼
                 Rust upload_service MTProto worker:
                    · max 1 concurrent chunk stream
                    · jittered exponential backoff on transient failures
                    · FLOOD_WAIT_x pauses all queues for x+5 s (no crash)
                    · uploads the untouched original as an uncompressed document
                    · writes telegram_file_id / telegram_message_id, marks SYNCED
```

The 6-hour periodic job is a safety net: anything the one-shot path missed
(e.g. the process was killed mid-flush) is picked up on the next run.

## Build

```bash
cd app
npm run tauri android init      # once (generates the Gradle project)
# add androidx.work dependency (see above) if not already present
npm run tauri android build     # or: tauri build --target aarch64-linux-android
```

Requires the Android SDK/NDK and Rust Android targets, which are **not**
available in the sandbox where this feature is developed; the Kotlin here is
verified by inspection against the Tauri v2 generated template.
