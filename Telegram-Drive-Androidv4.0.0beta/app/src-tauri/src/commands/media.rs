//! Tauri commands for the local-first photo gallery: virtualized timeline
//! queries, thumbnail retrieval from the local Rust cache, and the
//! "Flashbacks / Memories" engine.

use crate::db::DbConnection;
use crate::media_indexer::{self, MediaItem};
use crate::upload_service::FloodGate;
use crate::TelegramState;
use base64::Engine;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

const TIMELINE_PAGE_LIMIT: i64 = 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimelinePage {
    pub items: Vec<MediaItem>,
    pub offset: i64,
    pub limit: i64,
}

/// Return a page of media items sorted strictly by `date_taken` (descending),
/// NOT by Telegram message timestamp. The frontend groups these into sticky
/// date headers ("Today", "Yesterday", "MMMM YYYY") and virtualizes rendering.
#[tauri::command]
pub async fn cmd_get_media_timeline(
    offset: i64,
    limit: Option<i64>,
    db_pool: State<'_, DbConnection>,
) -> Result<MediaTimelinePage, String> {
    let limit = limit.unwrap_or(500).clamp(1, TIMELINE_PAGE_LIMIT);
    let offset = offset.max(0);

    let conn = db_pool.lock().map_err(|_| "Database connection poisoned".to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT id FROM media_items
             WHERE deleted = 0
             ORDER BY date_taken DESC, id DESC
             LIMIT ? OFFSET ?",
        )
        .map_err(|error| error.to_string())?;
    statement.bind((1, limit)).map_err(|error| error.to_string())?;
    statement.bind((2, offset)).map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    while sqlite::State::Row == statement.next().map_err(|error| error.to_string())? {
        let id = statement.read::<i64, _>(0).map_err(|error| error.to_string())?;
        items.push(media_indexer::read_media_item(&conn, id)?);
    }

    Ok(MediaTimelinePage {
        items,
        offset,
        limit,
    })
}

/// Read a locally cached thumbnail blob and return it as a base64 data-URL
/// string. `tier` is either `"micro"` or `"screen"`.
#[tauri::command]
pub async fn cmd_get_media_thumbnail(
    media_id: i64,
    tier: String,
    db_pool: State<'_, DbConnection>,
) -> Result<Option<String>, String> {
    let conn = db_pool.lock().map_err(|_| "Database connection poisoned".to_string())?;
    let blob = media_indexer::read_thumbnail(&conn, media_id, &tier)?;
    Ok(blob.map(|bytes| {
        format!(
            "data:image/webp;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryGroup {
    /// e.g. "1 year ago", "3 years ago".
    pub label: String,
    pub years_ago: i64,
    pub items: Vec<MediaItem>,
}

/// Query SQLite for records whose month/day matches today but whose year is in
/// the past, then group them by the number of years elapsed. This runs entirely
/// on-device — no Telegram call is made.
#[tauri::command]
pub async fn cmd_get_on_this_day_memories(
    db_pool: State<'_, DbConnection>,
) -> Result<Vec<MemoryGroup>, String> {
    let conn = db_pool.lock().map_err(|_| "Database connection poisoned".to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT id,
                    CAST(strftime('%Y', 'now') AS INTEGER) - CAST(strftime('%Y', date_taken, 'unixepoch') AS INTEGER) AS years_ago
             FROM media_items
             WHERE deleted = 0
               AND sync_status = 'SYNCED'
               AND strftime('%m-%d', date_taken, 'unixepoch') = strftime('%m-%d', 'now')
               AND strftime('%Y', date_taken, 'unixepoch') < strftime('%Y', 'now')
             ORDER BY date_taken DESC",
        )
        .map_err(|error| error.to_string())?;

    let mut years_map: std::collections::BTreeMap<i64, Vec<MediaItem>> =
        std::collections::BTreeMap::new();
    while sqlite::State::Row == statement.next().map_err(|error| error.to_string())? {
        let id = statement.read::<i64, _>(0).map_err(|error| error.to_string())?;
        let years_ago = statement.read::<i64, _>(1).map_err(|error| error.to_string())?;
        if years_ago <= 0 {
            continue;
        }
        years_map
            .entry(years_ago)
            .or_default()
            .push(media_indexer::read_media_item(&conn, id)?);
    }

    let groups = years_map
        .into_iter()
        .map(|(years_ago, items)| MemoryGroup {
            label: if years_ago == 1 {
                "1 year ago".to_string()
            } else {
                format!("{years_ago} years ago")
            },
            years_ago,
            items,
        })
        .collect();

    Ok(groups)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSyncStatus {
    pub pending: i64,
    pub uploading: i64,
    pub synced: i64,
    pub failed: i64,
    pub total: i64,
    pub flood_paused_secs: u64,
}

#[tauri::command]
pub async fn cmd_get_media_sync_status(
    db_pool: State<'_, DbConnection>,
    flood_gate: State<'_, Arc<FloodGate>>,
) -> Result<MediaSyncStatus, String> {
    let conn = db_pool.lock().map_err(|_| "Database connection poisoned".to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT
                SUM(CASE WHEN sync_status = 'PENDING_UPLOAD' THEN 1 ELSE 0 END),
                SUM(CASE WHEN sync_status = 'UPLOADING' THEN 1 ELSE 0 END),
                SUM(CASE WHEN sync_status = 'SYNCED' THEN 1 ELSE 0 END),
                SUM(CASE WHEN sync_status = 'FAILED' THEN 1 ELSE 0 END),
                COUNT(*)
             FROM media_items WHERE deleted = 0",
        )
        .map_err(|error| error.to_string())?;
    if sqlite::State::Row != statement.next().map_err(|error| error.to_string())? {
        return Err("No media sync statistics available".to_string());
    }
    let read = |index: usize| -> i64 {
        statement
            .read::<Option<i64>, _>(index)
            .ok()
            .flatten()
            .unwrap_or(0)
    };
    Ok(MediaSyncStatus {
        pending: read(0),
        uploading: read(1),
        synced: read(2),
        failed: read(3),
        total: read(4),
        flood_paused_secs: flood_gate.remaining(),
    })
}

/// Manually enqueue a device URI into the background ingestion pipeline.
/// Primarily used by the Android JNI bridge; exposed here for foreground
/// invocations and diagnostics.
#[tauri::command]
pub fn cmd_enqueue_media_uri(uri: String) -> Result<(), String> {
    if uri.trim().is_empty() {
        return Err("Media URI is empty".to_string());
    }
    crate::upload_service::enqueue_media_uri(uri);
    Ok(())
}

/// Manually trigger a background upload-queue drain (e.g. after the user
/// connects to Wi-Fi).
#[tauri::command]
pub async fn cmd_drain_media_sync_queue(
    app: tauri::AppHandle,
    db_pool: State<'_, DbConnection>,
    state: State<'_, TelegramState>,
    flood_gate: State<'_, Arc<FloodGate>>,
) -> Result<(), String> {
    crate::upload_service::drain_upload_queue(
        app,
        db_pool.inner().clone(),
        state.inner().clone(),
        flood_gate.inner().clone(),
    )
    .await;
    Ok(())
}
