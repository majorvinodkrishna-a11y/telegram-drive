#[cfg(target_os = "android")]
pub fn start_foreground_service() {
    log::info!("JNI: start_foreground_service called");
    let ctx_obj = ndk_context::android_context();
    if let Ok(vm) = unsafe { jni::JavaVM::from_raw(ctx_obj.vm().cast()) } {
        if let Ok(mut env) = vm.attach_current_thread() {
            let ctx = unsafe { jni::objects::JObject::from_raw(ctx_obj.context().cast()) };
            
            // Get class loader from Context
            match env.call_method(
                &ctx,
                "getClassLoader",
                "()Ljava/lang/ClassLoader;",
                &[],
            ) {
                Ok(class_loader_val) => {
                    if let Ok(class_loader) = class_loader_val.l() {
                        let class_name = env.new_string("com.cameronamer.telegramdrive.UploadForegroundService");
                        if let Ok(class_name_obj) = class_name {
                            let class_obj_val = env.call_method(
                                &class_loader,
                                "loadClass",
                                "(Ljava/lang/String;)Ljava/lang/Class;",
                                &[jni::objects::JValue::from(&class_name_obj)],
                            );
                            match class_obj_val {
                                Ok(class_obj_res) => {
                                    if let Ok(class_obj) = class_obj_res.l() {
                                        let j_class: jni::objects::JClass = class_obj.into();
                                        let call_res = env.call_static_method(
                                            &j_class,
                                            "startService",
                                            "(Landroid/content/Context;)V",
                                            &[jni::objects::JValue::from(&ctx)],
                                        );
                                        if let Err(e) = call_res {
                                            log::error!("JNI: startService call failed: {}", e);
                                            if env.exception_check().unwrap_or(false) {
                                                let _ = env.exception_describe();
                                                let _ = env.exception_clear();
                                            }
                                        } else {
                                            log::info!("JNI: successfully called UploadForegroundService.startService");
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::error!("JNI: loadClass UploadForegroundService failed: {}", e);
                                    if env.exception_check().unwrap_or(false) {
                                        let _ = env.exception_describe();
                                        let _ = env.exception_clear();
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("JNI: getClassLoader failed: {}", e);
                    if env.exception_check().unwrap_or(false) {
                        let _ = env.exception_describe();
                        let _ = env.exception_clear();
                    }
                }
            }
        }
    }
}

#[cfg(target_os = "android")]
pub fn stop_foreground_service() {
    log::info!("JNI: stop_foreground_service called");
    let ctx_obj = ndk_context::android_context();
    if let Ok(vm) = unsafe { jni::JavaVM::from_raw(ctx_obj.vm().cast()) } {
        if let Ok(mut env) = vm.attach_current_thread() {
            let ctx = unsafe { jni::objects::JObject::from_raw(ctx_obj.context().cast()) };
            
            // Get class loader from Context
            match env.call_method(
                &ctx,
                "getClassLoader",
                "()Ljava/lang/ClassLoader;",
                &[],
            ) {
                Ok(class_loader_val) => {
                    if let Ok(class_loader) = class_loader_val.l() {
                        let class_name = env.new_string("com.cameronamer.telegramdrive.UploadForegroundService");
                        if let Ok(class_name_obj) = class_name {
                            let class_obj_val = env.call_method(
                                &class_loader,
                                "loadClass",
                                "(Ljava/lang/String;)Ljava/lang/Class;",
                                &[jni::objects::JValue::from(&class_name_obj)],
                            );
                            match class_obj_val {
                                Ok(class_obj_res) => {
                                    if let Ok(class_obj) = class_obj_res.l() {
                                        let j_class: jni::objects::JClass = class_obj.into();
                                        let call_res = env.call_static_method(
                                            &j_class,
                                            "stopService",
                                            "(Landroid/content/Context;)V",
                                            &[jni::objects::JValue::from(&ctx)],
                                        );
                                        if let Err(e) = call_res {
                                            log::error!("JNI: stopService call failed: {}", e);
                                            if env.exception_check().unwrap_or(false) {
                                                let _ = env.exception_describe();
                                                let _ = env.exception_clear();
                                            }
                                        } else {
                                            log::info!("JNI: successfully called UploadForegroundService.stopService");
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::error!("JNI: loadClass UploadForegroundService failed: {}", e);
                                    if env.exception_check().unwrap_or(false) {
                                        let _ = env.exception_describe();
                                        let _ = env.exception_clear();
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("JNI: getClassLoader failed: {}", e);
                    if env.exception_check().unwrap_or(false) {
                        let _ = env.exception_describe();
                        let _ = env.exception_clear();
                    }
                }
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
pub fn start_foreground_service() {
    // Desktop doesn't need this.
}

#[cfg(not(target_os = "android"))]
pub fn stop_foreground_service() {
    // Desktop doesn't need this.
}

#[tauri::command]
pub fn cmd_start_foreground_service() {
    #[cfg(target_os = "android")]
    start_foreground_service();
}

#[tauri::command]
pub fn cmd_stop_foreground_service() {
    #[cfg(target_os = "android")]
    stop_foreground_service();
}

// ---------------------------------------------------------------------------
// MTProto Safe-Upload Worker & Telegram Anti-Ban Engine
// ---------------------------------------------------------------------------
//
// Telegram is an immutable document store. This module implements the
// background worker that drains the local `media_sync_queue` and pushes
// untouched originals as uncompressed documents, while strictly throttling
// itself to avoid `FLOOD_WAIT` bans:
//
//   * Maximum 1 concurrent upload stream for automated background uploads.
//   * Jittered exponential backoff for transient failures.
//   * On `FLOOD_WAIT_X`, every background queue pauses for `X + 5` seconds
//     (via the shared `FloodGate`) without crashing the worker.
//   * On success, Telegram's `file_id` and `message_id` are written back to
//     the corresponding SQLite row and it is marked `SYNCED`.

use crate::commands::utils::{map_error, resolve_peer};
use crate::db::DbConnection;
use crate::media_indexer::{self, MediaItem, SYNC_FAILED, SYNC_PENDING_UPLOAD, SYNC_SYNCED, SYNC_UPLOADING};
use crate::TelegramState;
use grammers_client::types::{Media, Peer};
use grammers_client::InputMessage;
use rand::Rng;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::mpsc;

/// Shared gate that pauses every background upload queue during a flood wait.
/// A single `Arc<FloodGate>` is managed in Tauri state and shared by the worker
/// and any future background producers.
#[derive(Default)]
pub struct FloodGate {
    resume_at_unix: AtomicU64,
}

impl FloodGate {
    fn now_unix() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// Pause all queues for `seconds` from now.
    pub fn pause_for(&self, seconds: u64) {
        let resume = Self::now_unix().saturating_add(seconds);
        self.resume_at_unix.fetch_max(resume, Ordering::Relaxed);
        log::warn!("Flood gate engaged: background uploads paused for {seconds}s");
    }

    /// Seconds remaining until the gate reopens (0 when open).
    pub fn remaining(&self) -> u64 {
        self.resume_at_unix
            .load(Ordering::Relaxed)
            .saturating_sub(Self::now_unix())
    }

    pub fn is_paused(&self) -> bool {
        self.remaining() > 0
    }
}

/// Ingress channel between the Android JNI bridge (or a foreground command)
/// and the background worker. `enqueue_media_uri` is non-blocking and safe to
/// call from a JNI thread, even before the worker has registered its receiver:
/// any URIs received early are buffered and flushed once the worker starts.
struct MediaIngress {
    sender: Option<mpsc::UnboundedSender<String>>,
    pending: Vec<String>,
}

static MEDIA_INGRESS: OnceLock<Mutex<MediaIngress>> = OnceLock::new();

fn ingress() -> &'static Mutex<MediaIngress> {
    MEDIA_INGRESS.get_or_init(|| {
        Mutex::new(MediaIngress {
            sender: None,
            pending: Vec::new(),
        })
    })
}

/// Push a device media URI (e.g. `content://media/.../123`) into the worker
/// queue. Called from the JNI bridge and from foreground commands.
pub fn enqueue_media_uri(uri: String) {
    let mut guard = ingress()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match &guard.sender {
        Some(sender) => {
            let _ = sender.send(uri);
        }
        None => {
            guard.pending.push(uri);
        }
    }
}

/// Nudge the worker to drain the upload queue immediately (used by the Android
/// WorkManager worker). Sent as an empty-string sentinel through the ingress
/// channel; the worker treats empty URIs as a pure drain request.
pub fn enqueue_drain_request() {
    let guard = ingress()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(sender) = &guard.sender {
        let _ = sender.send(String::new());
    }
}

/// Spawn the long-lived background sync worker. It consumes incoming URIs
/// (indexing + thumbnail generation) and periodically drains the upload queue.
pub fn spawn_media_sync_worker(
    app: tauri::AppHandle,
    db_pool: DbConnection,
    state: TelegramState,
    flood_gate: Arc<FloodGate>,
) {
    tauri::async_runtime::spawn(async move {
        let (sender, mut receiver) = mpsc::unbounded_channel::<String>();

        // Register the receiver and flush any URIs buffered before startup.
        {
            let mut guard = ingress()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.sender = Some(sender.clone());
            for uri in guard.pending.drain(..) {
                let _ = sender.send(uri);
            }
        }

        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                Some(uri) = receiver.recv() => {
                    // An empty string is a drain nudge from the Android
                    // WorkManager worker, not a real media URI.
                    if !uri.is_empty() {
                        process_ingress_uri(app.clone(), db_pool.clone(), uri).await;
                    }
                    drain_upload_queue(app.clone(), db_pool.clone(), state.clone(), flood_gate.clone()).await;
                }
                _ = interval.tick() => {
                    drain_upload_queue(app.clone(), db_pool.clone(), state.clone(), flood_gate.clone()).await;
                }
                else => {
                    log::info!("Media sync worker channel closed; stopping.");
                    break;
                }
            }
        }
    });
}

/// Resolve a device URI to a locally readable filesystem path.
/// On Android, `content://` URIs are materialized through the existing JNI
/// `copy_to_android_cache` helper (which defers ContentResolver work to the
/// main thread). On other platforms the URI is treated as a plain path.
fn resolve_local_path(uri: &str) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        if uri.starts_with("content://") || uri.contains("msf:") || uri.contains("msf%") {
            return crate::commands::fs::copy_to_android_cache(uri);
        }
    }
    Ok(crate::commands::fs::clean_android_path(uri))
}

/// Ingest a single incoming URI: resolve → SHA-256 dedupe → EXIF → thumbnails
/// → SQLite record with status `PENDING_UPLOAD` → enqueue.
async fn process_ingress_uri(app: tauri::AppHandle, db_pool: DbConnection, uri: String) {
    // Content URIs are materialized into a temporary cache copy; plain file
    // paths are used in place. Only the former are safe to delete afterwards.
    let is_content_uri = uri.starts_with("content://") || uri.contains("msf:") || uri.contains("msf%");

    let resolved = {
        let uri_for_resolve = uri.clone();
        tokio::task::spawn_blocking(move || resolve_local_path(&uri_for_resolve)).await
    };
    let local_path = match resolved {
        Ok(Ok(path)) => path,
        Ok(Err(error)) => {
            log::warn!("Media ingress: could not resolve URI {}: {}", uri, error);
            return;
        }
        Err(error) => {
            log::warn!("Media ingress: URI resolution task failed: {error}");
            return;
        }
    };

    let db_for_index = db_pool.clone();
    let uri_for_index = uri.clone();
    let indexed = tokio::task::spawn_blocking(move || {
        media_indexer::index_media_file(&db_for_index, &local_path, &uri_for_index)
    })
    .await;

    match indexed {
        Ok(Ok(item)) => {
            let _ = app.emit("media-indexed", item);
        }
        Ok(Err(error)) => log::warn!("Media ingestion failed for {}: {}", uri, error),
        Err(error) => log::warn!("Media ingestion task panicked: {error}"),
    }

    // The materialized cache copy is temporary; the untouched original lives in
    // MediaStore and is re-materialized on upload. Only clean up content://
    // copies — never a real on-disk path the user owns.
    #[cfg(target_os = "android")]
    {
        if is_content_uri {
            let _ = tokio::fs::remove_file(&local_path).await;
        }
    }
}

/// Pick the next media item due for upload, ordered by priority then enqueue
/// time. Items that are `PENDING_UPLOAD` or previously `FAILED` are eligible.
fn next_pending_media(conn: &sqlite::Connection) -> Result<Option<MediaItem>, String> {
    let mut statement = conn
        .prepare(
            "SELECT m.id FROM media_sync_queue q
             JOIN media_items m ON m.id = q.media_id
             WHERE m.deleted = 0 AND m.sync_status IN ('PENDING_UPLOAD', 'FAILED')
             ORDER BY q.priority DESC, q.queued_at ASC
             LIMIT 1",
        )
        .map_err(|error| error.to_string())?;
    if sqlite::State::Row != statement.next().map_err(|error| error.to_string())? {
        return Ok(None);
    }
    let id = statement.read::<i64, _>(0).map_err(|error| error.to_string())?;
    Ok(Some(media_indexer::read_media_item(conn, id)?))
}

fn set_sync_status(
    conn: &sqlite::Connection,
    media_id: i64,
    status: &str,
    last_error: Option<&str>,
    increment_attempts: bool,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let sql = if increment_attempts {
        "UPDATE media_items
         SET sync_status = ?, last_error = ?, upload_attempts = upload_attempts + 1, updated_at = ?
         WHERE id = ?"
    } else {
        "UPDATE media_items
         SET sync_status = ?, last_error = ?, updated_at = ?
         WHERE id = ?"
    };
    let mut statement = conn.prepare(sql).map_err(|error| error.to_string())?;
    statement.bind((1, status)).map_err(|error| error.to_string())?;
    statement.bind((2, last_error)).map_err(|error| error.to_string())?;
    statement.bind((3, now)).map_err(|error| error.to_string())?;
    statement.bind((4, media_id)).map_err(|error| error.to_string())?;
    statement.next().map_err(|error| error.to_string())?;
    Ok(())
}

fn mark_synced(
    conn: &sqlite::Connection,
    media_id: i64,
    message_id: i32,
    file_id: Option<&str>,
    peer_id: Option<i64>,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let mut statement = conn
        .prepare(
            "UPDATE media_items
             SET sync_status = ?, telegram_message_id = ?, telegram_file_id = ?,
                 telegram_peer_id = ?, last_error = NULL, updated_at = ?
             WHERE id = ?",
        )
        .map_err(|error| error.to_string())?;
    statement.bind((1, SYNC_SYNCED)).map_err(|error| error.to_string())?;
    statement.bind((2, i64::from(message_id))).map_err(|error| error.to_string())?;
    statement.bind((3, file_id)).map_err(|error| error.to_string())?;
    statement.bind((4, peer_id)).map_err(|error| error.to_string())?;
    statement.bind((5, now)).map_err(|error| error.to_string())?;
    statement.bind((6, media_id)).map_err(|error| error.to_string())?;
    statement.next().map_err(|error| error.to_string())?;

    let mut remove = conn
        .prepare("DELETE FROM media_sync_queue WHERE media_id = ?")
        .map_err(|error| error.to_string())?;
    remove.bind((1, media_id)).map_err(|error| error.to_string())?;
    remove.next().map_err(|error| error.to_string())?;
    Ok(())
}

enum UploadOutcome {
    Synced {
        message_id: i32,
        file_id: Option<String>,
        peer_id: Option<i64>,
    },
    FloodWait(u64),
    Transient(String),
    NotConnected,
}

/// Upload exactly one media item's untouched original as an uncompressed
/// document into Saved Messages (or the item's recorded peer). Returns the
/// outcome so the drain loop can decide whether to continue, back off, or
/// pause the whole queue.
async fn upload_one_media(state: &TelegramState, item: &MediaItem) -> UploadOutcome {
    let local_path = match resolve_local_path(&item.local_uri) {
        Ok(path) => path,
        Err(error) => return UploadOutcome::Transient(error),
    };

    let size = match tokio::fs::metadata(&local_path).await {
        Ok(metadata) => metadata.len(),
        Err(error) => return UploadOutcome::Transient(format!("Failed to stat media: {error}")),
    };

    let client = {
        let client_opt = state.client.lock().await.clone();
        match client_opt {
            Some(client) => client,
            None => {
                #[cfg(debug_assertions)]
                log::info!("[MOCK] Background upload skipped: Telegram client not connected");
                return UploadOutcome::NotConnected;
            }
        }
    };

    let peer = match resolve_peer(&client, None, &state.peer_cache).await {
        Ok(peer) => peer,
        Err(error) => return UploadOutcome::Transient(error),
    };

    let file = match tokio::fs::File::open(&local_path).await {
        Ok(file) => file,
        Err(error) => return UploadOutcome::Transient(format!("Failed to open media: {error}")),
    };
    let mut reader = tokio::io::BufReader::new(file);

    // Upload the untouched original as a document.
    let uploaded = match client
        .upload_stream(&mut reader, size as usize, item.file_name.clone())
        .await
    {
        Ok(uploaded) => uploaded,
        Err(error) => {
            let mapped = map_error(error);
            if mapped.starts_with("FLOOD_WAIT_") {
                if let Ok(seconds) = mapped.trim_start_matches("FLOOD_WAIT_").parse::<u64>() {
                    return UploadOutcome::FloodWait(seconds);
                }
            }
            return UploadOutcome::Transient(mapped);
        }
    };

    let message = InputMessage::new().text("").file(uploaded);
    let sent = match client.send_message(&peer, message).await {
        Ok(message) => message,
        Err(error) => {
            let mapped = map_error(error);
            if mapped.starts_with("FLOOD_WAIT_") {
                if let Ok(seconds) = mapped.trim_start_matches("FLOOD_WAIT_").parse::<u64>() {
                    return UploadOutcome::FloodWait(seconds);
                }
            }
            return UploadOutcome::Transient(mapped);
        }
    };

    let message_id = sent.id();
    let file_id = match sent.media() {
        Some(Media::Document(document)) => Some(document.id().to_string()),
        Some(Media::Photo(photo)) => Some(photo.id().to_string()),
        _ => None,
    };
    let peer_id = match &peer {
        Peer::User(user) => Some(user.raw.id()),
        Peer::Channel(channel) => Some(channel.raw.id),
        _ => None,
    };

    log::info!(
        "Background upload complete: media {} -> message {} (file {})",
        item.id,
        message_id,
        file_id.as_deref().unwrap_or("unknown")
    );
    UploadOutcome::Synced {
        message_id,
        file_id,
        peer_id,
    }
}

/// Drain the background upload queue. Strictly serial: a maximum of one chunk
/// stream is in flight at any time. Stops as soon as the flood gate engages,
/// the client disconnects, or a transient failure occurs (the next interval
/// tick or ingress event will resume).
pub async fn drain_upload_queue(
    app: tauri::AppHandle,
    db_pool: DbConnection,
    state: TelegramState,
    flood_gate: Arc<FloodGate>,
) {
    if flood_gate.is_paused() {
        log::info!(
            "Background upload queue paused by flood gate ({}s remaining).",
            flood_gate.remaining()
        );
        return;
    }

    loop {
        let next = {
            let conn = match db_pool.lock() {
                Ok(conn) => conn,
                Err(_) => {
                    log::error!("Media upload queue: DB lock poisoned");
                    return;
                }
            };
            match next_pending_media(&conn) {
                Ok(item) => item,
                Err(error) => {
                    log::error!("Media upload queue: {error}");
                    return;
                }
            }
        };
        let Some(item) = next else {
            return; // Queue drained.
        };

        // Mark in-flight before uploading.
        {
            let conn = match db_pool.lock() {
                Ok(conn) => conn,
                Err(_) => return,
            };
            if let Err(error) = set_sync_status(&conn, item.id, SYNC_UPLOADING, None, false) {
                log::error!("Media upload queue: {error}");
                return;
            }
        }

        match upload_one_media(&state, &item).await {
            UploadOutcome::Synced {
                message_id,
                file_id,
                peer_id,
            } => {
                let conn = match db_pool.lock() {
                    Ok(conn) => conn,
                    Err(_) => return,
                };
                if let Err(error) =
                    mark_synced(&conn, item.id, message_id, file_id.as_deref(), peer_id)
                {
                    log::error!("Media upload queue: {error}");
                    return;
                }
                let _ = app.emit("media-synced", item.id);
            }
            UploadOutcome::FloodWait(seconds) => {
                // Spec: pause all background queues for X + 5 seconds.
                let wait = seconds.saturating_add(5);
                let conn = match db_pool.lock() {
                    Ok(conn) => conn,
                    Err(_) => return,
                };
                let _ = set_sync_status(&conn, item.id, SYNC_PENDING_UPLOAD, None, false);
                flood_gate.pause_for(wait);
                log::warn!(
                    "FLOOD_WAIT_{seconds} received; pausing all background queues for {wait}s."
                );
                return;
            }
            UploadOutcome::NotConnected => {
                let conn = match db_pool.lock() {
                    Ok(conn) => conn,
                    Err(_) => return,
                };
                let _ = set_sync_status(&conn, item.id, SYNC_PENDING_UPLOAD, None, false);
                return;
            }
            UploadOutcome::Transient(error) => {
                // Jittered exponential backoff; the queue resumes on the next tick.
                let jitter_ms = rand::rng().random_range(0u64..=2_000);
                let backoff = 5_000u64.saturating_add(jitter_ms);
                let conn = match db_pool.lock() {
                    Ok(conn) => conn,
                    Err(_) => return,
                };
                let _ = set_sync_status(&conn, item.id, SYNC_FAILED, Some(&error), true);
                log::warn!(
                    "Background upload of media {} failed ({error}); backing off {backoff}ms.",
                    item.id
                );
                tokio::time::sleep(Duration::from_millis(backoff)).await;
                return;
            }
        }
    }
}
