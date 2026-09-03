package com.cameronamer.telegramdrive

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Schedules the two WorkManager jobs that keep the photo gallery in sync:
 *
 *  1. `media-upload-periodic` — runs every 6 hours, only while unmetered and
 *     charging, to drain the Rust pending-upload queue.
 *  2. `media-upload-once` — a one-shot job fired after the MediaStore observer
 *     flushes newly indexed URIs, so fresh photos start uploading promptly
 *     instead of waiting for the next periodic window.
 */
object MediaSyncScheduler {

    private const val PERIODIC_WORK_NAME = "media-upload-periodic"
    private const val ONE_TIME_WORK_NAME = "media-upload-once"
    private const val PERIOD_HOURS = 6L

    fun schedulePeriodic(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.UNMETERED)
            .setRequiresCharging(true)
            .setRequiresBatteryNotLow(true)
            .build()

        val request = PeriodicWorkRequest.Builder(
            MediaUploadWorker::class.java,
            PERIOD_HOURS,
            TimeUnit.HOURS,
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    fun scheduleOneTimeUpload(context: Context) {
        val request = OneTimeWorkRequest.Builder(MediaUploadWorker::class.java)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            ONE_TIME_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }
}
