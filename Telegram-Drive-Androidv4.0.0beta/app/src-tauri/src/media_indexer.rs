//! Media ingestion & EXIF indexing pipeline.
//!
//! This module is the "client compute" half of the local-first photo gallery:
//! every photo/video detected on-device is hashed (SHA-256), its EXIF metadata
//! is extracted, and a two-tier WebP thumbnail set is generated locally. The
//! result is recorded in the embedded SQLite database — the single source of
//! truth — with sync status `PENDING_UPLOAD` so the background worker can push
//! the untouched original to Telegram without ever re-deriving anything here.
//!
//! Telegram is never contacted from this module. All work is CPU/IO-bound and
//! runs off the async runtime via `spawn_blocking`.

use crate::db::DbConnection;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Sync state machine values stored in `media_items.sync_status`.
pub const SYNC_PENDING_UPLOAD: &str = "PENDING_UPLOAD";
pub const SYNC_UPLOADING: &str = "UPLOADING";
pub const SYNC_SYNCED: &str = "SYNCED";
pub const SYNC_FAILED: &str = "FAILED";
pub const SYNC_LOCAL_ONLY: &str = "LOCAL_ONLY";

/// Micro thumbnail: max dimension 256px, 60% quality.
pub const MICRO_MAX_DIM: u32 = 256;
pub const MICRO_QUALITY: f32 = 60.0;
/// Screen preview: max dimension 1600px, 75% quality.
pub const SCREEN_MAX_DIM: u32 = 1600;
pub const SCREEN_QUALITY: f32 = 75.0;

/// EXIF-derived metadata for a single media item.
#[derive(Debug, Clone, Default)]
pub struct ExifSummary {
    pub date_taken: i64,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub orientation: i32,
}

/// A locally generated two-tier thumbnail set (WebP bytes).
#[derive(Debug, Clone)]
pub struct ThumbnailSet {
    pub micro: Vec<u8>,
    pub micro_width: i64,
    pub micro_height: i64,
    pub screen: Vec<u8>,
    pub screen_width: i64,
    pub screen_height: i64,
}

/// The serializable representation of a row in `media_items`, returned to the
/// frontend timeline grid and the memories engine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: i64,
    pub local_uri: String,
    pub file_name: String,
    pub mime_type: Option<String>,
    pub file_size: i64,
    pub sha256: String,
    pub media_type: String,
    pub date_taken: i64,
    pub date_added: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub orientation: i32,
    pub duration_ms: Option<i64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub sync_status: String,
    pub telegram_message_id: Option<i64>,
    pub telegram_file_id: Option<String>,
    pub has_micro_thumb: bool,
    pub has_screen_thumb: bool,
}

/// Compute the SHA-256 content hash of a local file, returned as a lowercase
/// hex string. This is the strict duplicate-detection key used before any
/// upload is enqueued.
pub fn sha256_file(path: &str) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|error| format!("Failed to open file: {error}"))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|error| format!("Failed to hash file: {error}"))?;
    let digest = hasher.finalize();
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Classify a local file as `photo` or `video` by extension.
pub fn infer_media_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    for video_ext in [
        "mp4", "mov", "m4v", "mkv", "webm", "avi", "3gp", "mpeg", "mpg", "wmv", "flv",
    ] {
        if lower.ends_with(&format!(".{video_ext}")) {
            return "video";
        }
    }
    "photo"
}

/// Best-effort MIME type from the file extension.
pub fn inferred_mime_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".heic") || lower.ends_with(".heif") {
        "image/heic"
    } else if lower.ends_with(".mp4") {
        "video/mp4"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".webm") {
        "video/webm"
    } else {
        "application/octet-stream"
    }
}

/// Parse EXIF `"YYYY:MM:DD HH:MM:SS"` into epoch seconds.
fn parse_exif_datetime(bytes: &[u8]) -> Option<i64> {
    let text = std::str::from_utf8(bytes).ok()?.trim();
    if text.len() < 19 {
        return None;
    }
    let year: i32 = text[0..4].parse().ok()?;
    let month: u32 = text[5..7].parse().ok()?;
    let day: u32 = text[8..10].parse().ok()?;
    let hour: u32 = text[11..13].parse().ok()?;
    let minute: u32 = text[14..16].parse().ok()?;
    let second: u32 = text[17..19].parse().ok()?;
    chrono::NaiveDate::from_ymd_opt(year, month, day)?
        .and_hms_opt(hour, minute, second)?
        .and_utc()
        .timestamp()
        .into()
}

/// Convert EXIF GPS rationals (DMS) into a signed decimal degree.
fn gps_to_decimal(value: &exif::Value, negative: bool) -> Option<f64> {
    let rationals = match value {
        exif::Value::Rational(values) if values.len() == 3 => values,
        _ => return None,
    };
    let degrees = rationals[0].to_f64();
    let minutes = rationals[1].to_f64();
    let seconds = rationals[2].to_f64();
    let mut decimal = degrees + minutes / 60.0 + seconds / 3600.0;
    if negative {
        decimal = -decimal;
    }
    Some(decimal)
}

/// Read an EXIF ASCII value as a trimmed String.
fn ascii_value(value: &exif::Value) -> Option<String> {
    match value {
        exif::Value::Ascii(values) => values
            .first()
            .map(|bytes| String::from_utf8_lossy(bytes).trim().to_string())
            .filter(|text| !text.is_empty()),
        _ => None,
    }
}

/// True when the first ASCII byte equals `needle` (e.g. `S`/`W` GPS refs).
fn ascii_is(value: &exif::Value, needle: u8) -> bool {
    match value {
        exif::Value::Ascii(values) => values
            .first()
            .and_then(|bytes| bytes.first())
            .map(|byte| *byte == needle)
            .unwrap_or(false),
        _ => false,
    }
}

/// Extract EXIF metadata from a media file. Any missing or malformed field
/// falls back to a default, and `date_taken` falls back to the file's
/// modification time so the timeline is always populated.
pub fn extract_exif_summary(path: &str) -> ExifSummary {
    let mut summary = ExifSummary {
        orientation: 1,
        ..ExifSummary::default()
    };

    // Fallback: file modification time so the timeline is never empty.
    if let Ok(metadata) = std::fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                summary.date_taken = duration.as_secs() as i64;
            }
        }
    }

    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return summary,
    };
    let mut reader = std::io::BufReader::new(file);
    let exif = match exif::Reader::new()
        .continue_on_error(true)
        .read_from_container(&mut reader)
    {
        Ok(exif) => exif,
        Err(_) => return summary,
    };

    // Capture date from DateTimeOriginal, falling back to DateTimeDigitized
    // then DateTime (all use the same "YYYY:MM:DD HH:MM:SS" layout).
    let date = [exif::Tag::DateTimeOriginal, exif::Tag::DateTimeDigitized, exif::Tag::DateTime]
        .iter()
        .find_map(|tag| exif.get_field(*tag, exif::In::PRIMARY))
        .and_then(|field| match &field.value {
            exif::Value::Ascii(values) => values.first().and_then(|bytes| parse_exif_datetime(bytes)),
            _ => None,
        });
    if let Some(date_taken) = date {
        summary.date_taken = date_taken;
    }

    if let Some(field) = exif.get_field(exif::Tag::Make, exif::In::PRIMARY) {
        summary.camera_make = ascii_value(&field.value);
    }
    if let Some(field) = exif.get_field(exif::Tag::Model, exif::In::PRIMARY) {
        summary.camera_model = ascii_value(&field.value);
    }
    if let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
        summary.orientation = field.value.get_uint(0).unwrap_or(1) as i32;
    }
    if let Some(field) = exif.get_field(exif::Tag::PixelXDimension, exif::In::PRIMARY) {
        summary.width = field.value.get_uint(0).map(|value| value as i64);
    }
    if let Some(field) = exif.get_field(exif::Tag::PixelYDimension, exif::In::PRIMARY) {
        summary.height = field.value.get_uint(0).map(|value| value as i64);
    }

    let lat_south = exif
        .get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY)
        .map(|field| ascii_is(&field.value, b'S'))
        .unwrap_or(false);
    let lng_west = exif
        .get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY)
        .map(|field| ascii_is(&field.value, b'W'))
        .unwrap_or(false);
    summary.latitude = exif
        .get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY)
        .and_then(|field| gps_to_decimal(&field.value, lat_south));
    summary.longitude = exif
        .get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY)
        .and_then(|field| gps_to_decimal(&field.value, lng_west));

    summary
}

/// Encode a resized WebP at the requested maximum dimension and quality.
fn encode_webp(img: &image::DynamicImage, max_dim: u32, quality: f32) -> Result<(Vec<u8>, u32, u32), String> {
    let thumbnail = img.thumbnail(max_dim, max_dim);
    let (width, height) = (thumbnail.width(), thumbnail.height());
    let encoder = webp::Encoder::from_image(&thumbnail)
        .map_err(|error| format!("Failed to initialize WebP encoder: {error}"))?;
    let memory = encoder.encode(quality);
    Ok((memory.to_vec(), width, height))
}

/// Generate the two-tier local thumbnail set for a media file.
///
/// Returns `Ok(None)` when the file cannot be decoded as a still image (e.g.
/// video containers or unsupported formats). The caller then stores a row with
/// no thumbnail cache and the frontend renders a type-specific placeholder.
pub fn generate_thumbnails(path: &str) -> Result<Option<ThumbnailSet>, String> {
    let image = match image::open(path) {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };

    let (micro, micro_width, micro_height) = encode_webp(&image, MICRO_MAX_DIM, MICRO_QUALITY)?;
    let (screen, screen_width, screen_height) = encode_webp(&image, SCREEN_MAX_DIM, SCREEN_QUALITY)?;

    Ok(Some(ThumbnailSet {
        micro,
        micro_width: micro_width as i64,
        micro_height: micro_height as i64,
        screen,
        screen_width: screen_width as i64,
        screen_height: screen_height as i64,
    }))
}

/// Look up an existing media item by its SHA-256 content hash. This is the
/// strict duplicate gate: if a row already exists for this exact file, the
/// item is not re-inserted and no upload is enqueued.
pub fn find_by_sha256(conn: &sqlite::Connection, sha256: &str) -> Result<Option<MediaItem>, String> {
    let mut statement = conn
        .prepare("SELECT id FROM media_items WHERE sha256 = ?")
        .map_err(|error| error.to_string())?;
    statement.bind((1, sha256)).map_err(|error| error.to_string())?;
    match statement.next().map_err(|error| error.to_string())? {
        sqlite::State::Row => {
            let id = statement.read::<i64, _>(0).map_err(|error| error.to_string())?;
            Ok(Some(read_media_item(conn, id)?))
        }
        sqlite::State::Done => Ok(None),
    }
}

/// Insert a media item (and its EXIF tags + thumbnail set) inside a single
/// transaction, and enqueue it for background upload.
fn insert_media_item(
    conn: &sqlite::Connection,
    source_uri: &str,
    file_name: &str,
    file_size: i64,
    sha256: &str,
    media_type: &str,
    exif: &ExifSummary,
    thumbnails: Option<&ThumbnailSet>,
) -> Result<i64, String> {
    conn.execute("BEGIN IMMEDIATE TRANSACTION").map_err(|error| error.to_string())?;
    let result = (|| {
        let now = chrono::Utc::now().timestamp();
        let mut statement = conn
            .prepare(
                "INSERT INTO media_items (
                    local_uri, file_name, mime_type, file_size, sha256, media_type,
                    date_taken, date_added, date_modified, width, height, orientation,
                    duration_ms, camera_make, camera_model, latitude, longitude,
                    sync_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .map_err(|error| error.to_string())?;
        statement.bind((1, source_uri)).map_err(|error| error.to_string())?;
        statement.bind((2, file_name)).map_err(|error| error.to_string())?;
        statement
            .bind((3, inferred_mime_type(source_uri)))
            .map_err(|error| error.to_string())?;
        statement.bind((4, file_size)).map_err(|error| error.to_string())?;
        statement.bind((5, sha256)).map_err(|error| error.to_string())?;
        statement.bind((6, media_type)).map_err(|error| error.to_string())?;
        statement.bind((7, exif.date_taken)).map_err(|error| error.to_string())?;
        statement.bind((8, now)).map_err(|error| error.to_string())?;
        statement.bind((9, now)).map_err(|error| error.to_string())?;
        statement.bind((10, exif.width)).map_err(|error| error.to_string())?;
        statement.bind((11, exif.height)).map_err(|error| error.to_string())?;
        statement
            .bind((12, exif.orientation as i64))
            .map_err(|error| error.to_string())?;
        statement
            .bind((13, None::<i64>))
            .map_err(|error| error.to_string())?;
        statement.bind((14, exif.camera_make.as_deref())).map_err(|error| error.to_string())?;
        statement.bind((15, exif.camera_model.as_deref())).map_err(|error| error.to_string())?;
        statement.bind((16, exif.latitude)).map_err(|error| error.to_string())?;
        statement.bind((17, exif.longitude)).map_err(|error| error.to_string())?;
        statement.bind((18, SYNC_PENDING_UPLOAD)).map_err(|error| error.to_string())?;
        statement.bind((19, now)).map_err(|error| error.to_string())?;
        statement.bind((20, now)).map_err(|error| error.to_string())?;
        statement.next().map_err(|error| error.to_string())?;

        // `sha256` is UNIQUE, so look the freshly inserted row back up by its
        // content hash rather than relying on last_insert_rowid().
        let mut id_stmt = conn
            .prepare("SELECT id FROM media_items WHERE sha256 = ?")
            .map_err(|error| error.to_string())?;
        id_stmt.bind((1, sha256)).map_err(|error| error.to_string())?;
        let media_id = match id_stmt.next().map_err(|error| error.to_string())? {
            sqlite::State::Row => id_stmt.read::<i64, _>(0).map_err(|error| error.to_string())?,
            sqlite::State::Done => return Err("Media item insert did not produce a row".to_string()),
        };

        if let Some(thumbnails) = thumbnails {
            let mut thumb_stmt = conn
                .prepare(
                    "INSERT INTO media_thumbnails (
                        media_id, micro_webp, micro_width, micro_height,
                        screen_webp, screen_width, screen_height, generated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .map_err(|error| error.to_string())?;
            thumb_stmt.bind((1, media_id)).map_err(|error| error.to_string())?;
            thumb_stmt
                .bind((2, thumbnails.micro.as_slice()))
                .map_err(|error| error.to_string())?;
            thumb_stmt
                .bind((3, thumbnails.micro_width))
                .map_err(|error| error.to_string())?;
            thumb_stmt
                .bind((4, thumbnails.micro_height))
                .map_err(|error| error.to_string())?;
            thumb_stmt
                .bind((5, thumbnails.screen.as_slice()))
                .map_err(|error| error.to_string())?;
            thumb_stmt
                .bind((6, thumbnails.screen_width))
                .map_err(|error| error.to_string())?;
            thumb_stmt
                .bind((7, thumbnails.screen_height))
                .map_err(|error| error.to_string())?;
            thumb_stmt.bind((8, now)).map_err(|error| error.to_string())?;
            thumb_stmt.next().map_err(|error| error.to_string())?;
        }

        let mut queue_stmt = conn
            .prepare("INSERT OR IGNORE INTO media_sync_queue (media_id, queued_at, priority) VALUES (?, ?, 0)")
            .map_err(|error| error.to_string())?;
        queue_stmt.bind((1, media_id)).map_err(|error| error.to_string())?;
        queue_stmt.bind((2, now)).map_err(|error| error.to_string())?;
        queue_stmt.next().map_err(|error| error.to_string())?;

        Ok(media_id)
    })();

    match result {
        Ok(media_id) => {
            conn.execute("COMMIT").map_err(|error| error.to_string())?;
            Ok(media_id)
        }
        Err(error) => {
            let _ = conn.execute("ROLLBACK");
            Err(error)
        }
    }
}

/// Read a full `MediaItem` from the database, annotating it with whether the
/// thumbnail cache contains each tier.
pub fn read_media_item(conn: &sqlite::Connection, id: i64) -> Result<MediaItem, String> {
    let mut statement = conn
        .prepare(
            "SELECT m.id, m.local_uri, m.file_name, m.mime_type, m.file_size, m.sha256,
                    m.media_type, m.date_taken, m.date_added, m.width, m.height,
                    m.orientation, m.duration_ms, m.camera_make, m.camera_model,
                    m.latitude, m.longitude, m.sync_status, m.telegram_message_id,
                    m.telegram_file_id,
                    CASE WHEN t.micro_webp IS NOT NULL THEN 1 ELSE 0 END,
                    CASE WHEN t.screen_webp IS NOT NULL THEN 1 ELSE 0 END
             FROM media_items m
             LEFT JOIN media_thumbnails t ON t.media_id = m.id
             WHERE m.id = ?",
        )
        .map_err(|error| error.to_string())?;
    statement.bind((1, id)).map_err(|error| error.to_string())?;
    if sqlite::State::Row != statement.next().map_err(|error| error.to_string())? {
        return Err(format!("Media item {id} not found"));
    }
    let read_str = |index: usize| -> Option<String> {
        statement.read::<Option<String>, _>(index).ok().flatten()
    };
    let read_i64 = |index: usize| -> Option<i64> {
        statement.read::<Option<i64>, _>(index).ok().flatten()
    };
    Ok(MediaItem {
        id: statement.read::<i64, _>(0).map_err(|error| error.to_string())?,
        local_uri: statement.read::<String, _>(1).map_err(|error| error.to_string())?,
        file_name: statement.read::<String, _>(2).map_err(|error| error.to_string())?,
        mime_type: read_str(3),
        file_size: statement.read::<i64, _>(4).map_err(|error| error.to_string())?,
        sha256: statement.read::<String, _>(5).map_err(|error| error.to_string())?,
        media_type: statement.read::<String, _>(6).map_err(|error| error.to_string())?,
        date_taken: statement.read::<i64, _>(7).map_err(|error| error.to_string())?,
        date_added: statement.read::<i64, _>(8).map_err(|error| error.to_string())?,
        width: read_i64(9),
        height: read_i64(10),
        orientation: statement.read::<i64, _>(11).map_err(|error| error.to_string())? as i32,
        duration_ms: read_i64(12),
        camera_make: read_str(13),
        camera_model: read_str(14),
        latitude: statement.read::<Option<f64>, _>(15).ok().flatten(),
        longitude: statement.read::<Option<f64>, _>(16).ok().flatten(),
        sync_status: statement.read::<String, _>(17).map_err(|error| error.to_string())?,
        telegram_message_id: read_i64(18),
        telegram_file_id: read_str(19),
        has_micro_thumb: statement.read::<i64, _>(20).map_err(|error| error.to_string())? != 0,
        has_screen_thumb: statement.read::<i64, _>(21).map_err(|error| error.to_string())? != 0,
    })
}

/// Index a media file: stat → SHA-256 dedup → EXIF → thumbnails → insert +
/// enqueue. `local_path` is a filesystem path this process can read;
/// `source_uri` is the original device identifier (e.g. a `content://`
/// MediaStore URI) kept for provenance. Blocking IO/CPU; call from a blocking
/// context.
pub fn index_media_file(
    db_pool: &DbConnection,
    local_path: &str,
    source_uri: &str,
) -> Result<MediaItem, String> {
    let metadata = std::fs::metadata(local_path)
        .map_err(|error| format!("Failed to stat media file: {error}"))?;
    let file_size = metadata.len() as i64;

    let sha256 = sha256_file(local_path)?;
    let conn = db_pool.lock().map_err(|_| "Database connection poisoned".to_string())?;
    if let Some(existing) = find_by_sha256(&conn, &sha256)? {
        log::info!(
            "Duplicate media detected by SHA-256 ({}). Skipping re-ingest.",
            existing.file_name
        );
        return Ok(existing);
    }

    let file_name = std::path::Path::new(local_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("media.bin")
        .to_string();
    let media_type = infer_media_type(local_path).to_string();
    let exif = extract_exif_summary(local_path);
    let thumbnails = generate_thumbnails(local_path)?;

    let media_id = insert_media_item(
        &conn,
        source_uri,
        &file_name,
        file_size,
        &sha256,
        &media_type,
        &exif,
        thumbnails.as_ref(),
    )?;

    log::info!(
        "Indexed media id={} type={} sha256={} date_taken={}",
        media_id,
        media_type,
        &sha256[..sha256.len().min(12)],
        exif.date_taken
    );
    read_media_item(&conn, media_id)
}

/// Read the stored thumbnail blob for a media item. `tier` is `"micro"` or
/// `"screen"`. Returns `None` when no thumbnail was generated for that tier.
pub fn read_thumbnail(conn: &sqlite::Connection, media_id: i64, tier: &str) -> Result<Option<Vec<u8>>, String> {
    let column = if tier == "micro" { "micro_webp" } else { "screen_webp" };
    let query = format!("SELECT {column} FROM media_thumbnails WHERE media_id = ?");
    let mut statement = conn.prepare(query).map_err(|error| error.to_string())?;
    statement.bind((1, media_id)).map_err(|error| error.to_string())?;
    if sqlite::State::Row != statement.next().map_err(|error| error.to_string())? {
        return Ok(None);
    }
    statement
        .read::<Option<Vec<u8>>, _>(0)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_exif_datetime_strings() {
        let epoch = parse_exif_datetime(b"2024:06:01 12:30:00");
        assert!(epoch.is_some());
        let parsed = chrono::DateTime::from_timestamp(epoch.unwrap(), 0).unwrap();
        assert_eq!(parsed.year(), 2024);
        assert_eq!(parsed.month(), 6);
        assert_eq!(parsed.day(), 1);
        assert_eq!(parsed.hour(), 12);
        assert_eq!(parsed.minute(), 30);
        assert_eq!(parsed.second(), 0);
        assert!(parse_exif_datetime(b"garbage").is_none());
    }

    #[test]
    fn hashes_files_deterministically() {
        let path = std::env::temp_dir().join(format!("td-media-{}.bin", std::process::id()));
        std::fs::write(&path, b"telegram-drive").unwrap();
        let first = sha256_file(path.to_str().unwrap()).unwrap();
        let second = sha256_file(path.to_str().unwrap()).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn infers_media_types_from_extensions() {
        assert_eq!(infer_media_type("IMG_001.jpg"), "photo");
        assert_eq!(infer_media_type("IMG_001.png"), "photo");
        assert_eq!(infer_media_type("IMG_001.webp"), "photo");
        assert_eq!(infer_media_type("clip.mp4"), "video");
        assert_eq!(infer_media_type("clip.MOV"), "video");
        assert_eq!(infer_media_type("clip.webm"), "video");
    }

    #[test]
    fn converts_gps_dms_to_decimal() {
        let rational = |num: u32, den: u32| exif::Rational { num, denom: den };
        let value = exif::Value::Rational(vec![
            rational(1, 1), // 1°
            rational(30, 1), // 30'
            rational(0, 1),  // 0"
        ]);
        assert_eq!(gps_to_decimal(&value, false), Some(1.5));
        assert_eq!(gps_to_decimal(&value, true), Some(-1.5));
    }
}
