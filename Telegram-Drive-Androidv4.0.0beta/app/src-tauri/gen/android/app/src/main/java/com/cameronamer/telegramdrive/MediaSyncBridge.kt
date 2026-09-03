package com.cameronamer.telegramdrive

/**
 * JNI bridge between Android native code and the Rust background worker.
 *
 * The matching Rust symbols are exported from `media_sync_bridge.rs`:
 *   - `Java_com_cameronamer_telegramdrive_MediaSyncBridge_nativeEnqueueMedia`
 *   - `Java_com_cameronamer_telegramdrive_MediaSyncBridge_nativeProcessPendingUploads`
 *
 * `@JvmStatic` makes these *static* native methods on the `MediaSyncBridge`
 * class, which is the signature the Rust `extern "system"` exports expect
 * `(JNIEnv*, jclass, jstring)`.
 *
 * The shared library (`libapp_lib.so`) is loaded by Tauri's `MainActivity`; the
 * `System.loadLibrary` call in `init` is a no-op safety net so the observer and
 * WorkManager worker can run in a freshly spawned process before the WebView
 * finishes initializing.
 */
object MediaSyncBridge {

    init {
        try {
            System.loadLibrary("app_lib")
        } catch (_: UnsatisfiedLinkError) {
            // Already loaded by TauriActivity, or not yet available; the
            // native methods below are individually guarded anyway.
        }
    }

    @JvmStatic
    external fun nativeEnqueueMedia(uri: String)

    @JvmStatic
    external fun nativeProcessPendingUploads()

    /** Hand a MediaStore content URI to the Rust ingestion queue. Non-blocking. */
    fun enqueueMedia(uri: String) {
        try {
            nativeEnqueueMedia(uri)
        } catch (_: UnsatisfiedLinkError) {
            // Rust runtime not ready; the periodic worker re-scans on its next
            // run, so a missed URI is not a data-loss event.
        }
    }

    /** Ask the Rust worker to drain the pending upload queue now. */
    fun processPendingUploads() {
        try {
            nativeProcessPendingUploads()
        } catch (_: UnsatisfiedLinkError) {
            // Rust runtime not ready yet; the periodic worker retries later.
        }
    }
}
