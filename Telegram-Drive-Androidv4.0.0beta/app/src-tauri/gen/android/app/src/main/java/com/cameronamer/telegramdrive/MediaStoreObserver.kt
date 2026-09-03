package com.cameronamer.telegramdrive

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.provider.MediaStore

/**
 * Observes MediaStore for new/modified images and videos and hands each changed
 * URI straight to the Rust ingestion queue via [MediaSyncBridge].
 *
 * Registration is intentionally idempotent and debounced: a burst of changes
 * (e.g. a batch of photos being moved onto the device) collapses into a single
 * flush of unique URIs.
 */
class MediaStoreObserver(
    private val context: Context,
    private val handler: Handler,
) : ContentObserver(handler) {

    private val resolver = context.applicationContext.contentResolver
    private val pending = LinkedHashSet<String>()

    private val flushRunnable = object : Runnable {
        override fun run() {
            val snapshot = synchronized(pending) {
                pending.toList().also { pending.clear() }
            }
            snapshot.forEach { uri ->
                MediaSyncBridge.enqueueMedia(uri)
            }
            if (snapshot.isNotEmpty()) {
                MediaSyncScheduler.scheduleOneTimeUpload(context)
            }
        }
    }

    fun register() {
        resolver.registerContentObserver(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, this,
        )
        resolver.registerContentObserver(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI, true, this,
        )
    }

    fun unregister() {
        try {
            resolver.unregisterContentObserver(this)
        } catch (_: IllegalArgumentException) {
            // Never registered, or already unregistered.
        }
    }

    override fun onChange(selfChange: Boolean, uri: Uri?) {
        super.onChange(selfChange, uri)
        val stringUri = uri?.toString() ?: return
        synchronized(pending) {
            pending.add(stringUri)
        }
        // Debounce: collapse a burst of callbacks into one flush.
        handler.removeCallbacks(flushRunnable)
        handler.postDelayed(flushRunnable, FLUSH_DELAY_MS)
    }

    private companion object {
        const val FLUSH_DELAY_MS = 2_000L
    }
}
