package com.cameronamer.telegramdrive

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * WorkManager worker that nudges the Rust MTProto worker to drain its pending
 * upload queue.
 *
 * All throttling (max 1 concurrent chunk stream, jittered backoff, FLOOD_WAIT
 * pause) lives in the Rust `upload_service` worker; this class is a thin,
 * restart-safe trigger.
 */
class MediaUploadWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            MediaSyncBridge.processPendingUploads()
            Result.success()
        } catch (_: Throwable) {
            // Retry with WorkManager's exponential backoff policy.
            Result.retry()
        }
    }
}
