use crate::db_migrations;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub type DbConnection = Arc<Mutex<sqlite::Connection>>;

/// Maximum number of retry attempts for database initialization
const MAX_DB_INIT_RETRIES: u32 = 5;

fn retry_initialization_step<T, F>(step_name: &str, mut operation: F) -> Result<T, String>
where
    F: FnMut() -> Result<T, String>,
{
    let mut last_error = String::new();
    for attempt in 0..MAX_DB_INIT_RETRIES {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = error;
                if attempt < MAX_DB_INIT_RETRIES - 1 {
                    let wait_ms = 100 * 2u64.pow(attempt);
                    log::warn!(
                        "Failed to complete {} (attempt {}/{}): {}. Retrying in {}ms...",
                        step_name,
                        attempt + 1,
                        MAX_DB_INIT_RETRIES,
                        last_error,
                        wait_ms
                    );
                    std::thread::sleep(Duration::from_millis(wait_ms));
                }
            }
        }
    }
    Err(format!(
        "Failed to complete {step_name} after {MAX_DB_INIT_RETRIES} attempts: {last_error}"
    ))
}

fn recovery_note(backup_path: Option<&std::path::Path>) -> String {
    backup_path
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .map(|name| {
            format!(
                " A verified recovery backup was retained in the application data directory as '{name}'."
            )
        })
        .unwrap_or_default()
}

pub fn init_db(app: &AppHandle) -> Result<DbConnection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db_path = dir.join("shares.db");

    // Retry opening the database with exponential backoff.
    // SQLite may report "database is locked" if another process or a stale
    // wal/shm journal hasn't been cleaned up yet (e.g., after a crash).
    let conn = {
        let mut last_err = String::new();
        let mut opened = None;
        for attempt in 0..MAX_DB_INIT_RETRIES {
            match sqlite::open(&db_path) {
                Ok(c) => {
                    opened = Some(c);
                    break;
                }
                Err(e) => {
                    last_err = e.to_string();
                    if attempt < MAX_DB_INIT_RETRIES - 1 {
                        let wait_ms = 100 * 2u64.pow(attempt);
                        log::warn!(
                            "Failed to open SQLite database (attempt {}/{}): {}. Retrying in {}ms...",
                            attempt + 1, MAX_DB_INIT_RETRIES, last_err, wait_ms
                        );
                        std::thread::sleep(Duration::from_millis(wait_ms));
                    }
                }
            }
        }
        opened.ok_or_else(|| {
            format!(
                "Failed to open SQLite database after {} attempts: {}",
                MAX_DB_INIT_RETRIES, last_err
            )
        })?
    };

    let source_layout = retry_initialization_step("database preflight", || {
        db_migrations::inspect_schema(&conn)
    })?;
    log::info!(
        "Recognized SQLite database layout '{}' before initialization.",
        source_layout.label()
    );
    let recovery_backup = retry_initialization_step("database backup preparation", || {
        db_migrations::prepare_baseline_backup(&conn, &db_path, source_layout)
    })?;
    if let Some(backup_path) = recovery_backup.as_ref() {
        let backup_name = backup_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("pre-migration backup");
        log::info!("Verified SQLite recovery backup '{}'.", backup_name);
    }

    // Run migration (also with retry for locked-database scenarios)
    {
        let mut last_err = String::new();
        for attempt in 0..MAX_DB_INIT_RETRIES {
            match conn.execute(
                "CREATE TABLE IF NOT EXISTS shared_links (
                    id TEXT PRIMARY KEY,
                    folder_id INTEGER,
                    message_id INTEGER NOT NULL,
                    file_name TEXT NOT NULL,
                    file_size INTEGER NOT NULL DEFAULT 0,
                    password_hash TEXT,
                    password_salt TEXT,
                    expires_at INTEGER,
                    revoked INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    color_hex TEXT DEFAULT '#3B82F6',
                    display_order INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS folder_metadata (
                    channel_id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    username TEXT,
                    is_public INTEGER NOT NULL DEFAULT 0,
                    display_order INTEGER NOT NULL DEFAULT 0,
                    group_id INTEGER,
                    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
                );
                CREATE TABLE IF NOT EXISTS file_activity (
                    folder_key TEXT NOT NULL,
                    folder_id INTEGER,
                    message_id INTEGER NOT NULL,
                    file_name TEXT NOT NULL,
                    file_size INTEGER NOT NULL DEFAULT 0,
                    mime_type TEXT,
                    file_ext TEXT,
                    created_at TEXT NOT NULL DEFAULT '',
                    encryption_state TEXT NOT NULL DEFAULT 'plain',
                    last_opened_at INTEGER NOT NULL DEFAULT 0,
                    open_count INTEGER NOT NULL DEFAULT 0,
                    is_favorite INTEGER NOT NULL DEFAULT 0,
                    is_pinned INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(folder_key, message_id)
                );
                CREATE INDEX IF NOT EXISTS idx_file_activity_recent ON file_activity(last_opened_at DESC);
                CREATE INDEX IF NOT EXISTS idx_file_activity_favorite ON file_activity(is_favorite, last_opened_at DESC);
                CREATE INDEX IF NOT EXISTS idx_file_activity_pinned ON file_activity(is_pinned, last_opened_at DESC);"
            ) {
                Ok(_) => {
                    last_err.clear();
                    break;
                }
                Err(e) => {
                    last_err = e.to_string();
                    if attempt < MAX_DB_INIT_RETRIES - 1 {
                        let wait_ms = 100 * 2u64.pow(attempt);
                        log::warn!(
                            "Failed to run SQLite migration (attempt {}/{}): {}. Retrying in {}ms...",
                            attempt + 1, MAX_DB_INIT_RETRIES, last_err, wait_ms
                        );
                        std::thread::sleep(Duration::from_millis(wait_ms));
                    }
                }
            }
        }
        if !last_err.is_empty() {
            return Err(format!(
                "Failed to run SQLite migration after {} attempts: {}{}",
                MAX_DB_INIT_RETRIES,
                last_err,
                recovery_note(recovery_backup.as_deref())
            ));
        }
    }

    // Encryption tables migration. Run the complete migration in one explicit
    // transaction so a crash cannot leave a partially upgraded registry.
    {
        let mut last_err = String::new();
        for attempt in 0..MAX_DB_INIT_RETRIES {
            match run_encryption_migration(&conn) {
                Ok(_) => {
                    last_err.clear();
                    break;
                }
                Err(e) => {
                    last_err = e.to_string();
                    if attempt < MAX_DB_INIT_RETRIES - 1 {
                        let wait_ms = 100 * 2u64.pow(attempt);
                        log::warn!(
                            "Failed to run encryption migration (attempt {}/{}): {}. Retrying in {}ms...",
                            attempt + 1, MAX_DB_INIT_RETRIES, last_err, wait_ms
                        );
                        std::thread::sleep(Duration::from_millis(wait_ms));
                    }
                }
            }
        }
        if !last_err.is_empty() {
            return Err(format!(
                "Failed to run encryption migration after {} attempts: {}{}",
                MAX_DB_INIT_RETRIES,
                last_err,
                recovery_note(recovery_backup.as_deref())
            ));
        }
    }

    // Record an application-wide baseline only after the existing, additive
    // initialization paths have completed. This release does not rename,
    // remove, or rewrite user records.
    {
        let mut last_err = String::new();
        for attempt in 0..MAX_DB_INIT_RETRIES {
            match db_migrations::install_baseline(&conn) {
                Ok(()) => {
                    last_err.clear();
                    break;
                }
                Err(error) => {
                    last_err = error;
                    if attempt < MAX_DB_INIT_RETRIES - 1 {
                        let wait_ms = 100 * 2u64.pow(attempt);
                        log::warn!(
                            "Failed to install database migration baseline (attempt {}/{}): {}. Retrying in {}ms...",
                            attempt + 1,
                            MAX_DB_INIT_RETRIES,
                            last_err,
                            wait_ms
                        );
                        std::thread::sleep(Duration::from_millis(wait_ms));
                    }
                }
            }
        }
        if !last_err.is_empty() {
            return Err(format!(
                "Failed to install database migration baseline after {} attempts: {}{}",
                MAX_DB_INIT_RETRIES,
                last_err,
                recovery_note(recovery_backup.as_deref())
            ));
        }
    }

    // Photo-gallery media schema. Idempotent; recorded in the application
    // migration ledger with its own checksum so a future build can verify it.
    {
        let mut last_err = String::new();
        for attempt in 0..MAX_DB_INIT_RETRIES {
            match apply_media_schema(&conn) {
                Ok(()) => {
                    last_err.clear();
                    break;
                }
                Err(error) => {
                    last_err = error;
                    if attempt < MAX_DB_INIT_RETRIES - 1 {
                        let wait_ms = 100 * 2u64.pow(attempt);
                        log::warn!(
                            "Failed to apply media schema (attempt {}/{}): {}. Retrying in {}ms...",
                            attempt + 1,
                            MAX_DB_INIT_RETRIES,
                            last_err,
                            wait_ms
                        );
                        std::thread::sleep(Duration::from_millis(wait_ms));
                    }
                }
            }
        }
        if !last_err.is_empty() {
            return Err(format!(
                "Failed to apply media schema after {} attempts: {}{}",
                MAX_DB_INIT_RETRIES,
                last_err,
                recovery_note(recovery_backup.as_deref())
            ));
        }
    }

    log::info!("SQLite database initialized successfully using sqlite crate.");
    Ok(Arc::new(Mutex::new(conn)))
}

fn encryption_column_exists(conn: &sqlite::Connection, column_name: &str) -> Result<bool, String> {
    let mut statement = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('encrypted_files') WHERE name = ?")
        .map_err(|error| error.to_string())?;
    statement
        .bind((1, column_name))
        .map_err(|error| error.to_string())?;
    if let sqlite::State::Row = statement.next().map_err(|error| error.to_string())? {
        return statement
            .read::<i64, _>(0)
            .map(|count| count > 0)
            .map_err(|error| error.to_string());
    }
    Ok(false)
}

fn run_encryption_migration(conn: &sqlite::Connection) -> Result<(), String> {
    conn.execute("BEGIN IMMEDIATE TRANSACTION")
        .map_err(|error| error.to_string())?;
    let result = (|| {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS encrypted_files (
                folder_key TEXT NOT NULL,
                message_id INTEGER NOT NULL,
                file_uuid BLOB NOT NULL,
                envelope_version INTEGER NOT NULL,
                cipher_suite INTEGER NOT NULL,
                ciphertext_size INTEGER NOT NULL,
                plaintext_size INTEGER,
                remote_name TEXT NOT NULL,
                key_profile_id TEXT,
                protection_mode TEXT NOT NULL DEFAULT 'vault',
                metadata_protected INTEGER NOT NULL DEFAULT 0,
                header_blob BLOB,
                header_sha256 BLOB,
                record_state TEXT NOT NULL DEFAULT 'active',
                reconciliation_state TEXT NOT NULL DEFAULT 'ok',
                created_at INTEGER NOT NULL,
                last_verified_at INTEGER,
                PRIMARY KEY(folder_key, message_id)
            );
            CREATE TABLE IF NOT EXISTS encryption_profiles (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                kind TEXT NOT NULL,
                vault_locator TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );",
        )
        .map_err(|error| error.to_string())?;

        let additions = [
            ("plaintext_size", "INTEGER"),
            ("protection_mode", "TEXT NOT NULL DEFAULT 'vault'"),
            ("metadata_protected", "INTEGER NOT NULL DEFAULT 0"),
            ("reconciliation_state", "TEXT NOT NULL DEFAULT 'ok'"),
        ];
        for (name, declaration) in additions {
            if !encryption_column_exists(conn, name)? {
                conn.execute(format!(
                    "ALTER TABLE encrypted_files ADD COLUMN {name} {declaration}"
                ))
                .map_err(|error| error.to_string())?;
            }
        }
        conn.execute(format!(
            "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (3, {})",
            chrono::Utc::now().timestamp()
        ))
        .map_err(|error| error.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => conn.execute("COMMIT").map_err(|error| error.to_string()),
        Err(error) => {
            let _ = conn.execute("ROLLBACK");
            Err(error)
        }
    }
}

/// Photo-gallery schema: media items, EXIF tags, two-tier WebP thumbnail
/// blobs, the background sync queue, and the encrypted-manifest backup ledger.
/// All statements are `IF NOT EXISTS` so this is safe to run on every startup.
const MEDIA_SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_uri TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL UNIQUE,
    media_type TEXT NOT NULL DEFAULT 'photo',
    date_taken INTEGER NOT NULL DEFAULT 0,
    date_added INTEGER NOT NULL DEFAULT 0,
    date_modified INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    orientation INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    camera_make TEXT,
    camera_model TEXT,
    latitude REAL,
    longitude REAL,
    sync_status TEXT NOT NULL DEFAULT 'PENDING_UPLOAD',
    telegram_message_id INTEGER,
    telegram_file_id TEXT,
    telegram_peer_id INTEGER,
    upload_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_media_items_date_taken ON media_items(date_taken DESC);
CREATE INDEX IF NOT EXISTS idx_media_items_sync_status ON media_items(sync_status, deleted);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(media_type, date_taken DESC);
CREATE INDEX IF NOT EXISTS idx_media_items_deleted ON media_items(deleted);

CREATE TABLE IF NOT EXISTS media_exif (
    media_id INTEGER NOT NULL,
    tag_key TEXT NOT NULL,
    tag_value TEXT,
    PRIMARY KEY (media_id, tag_key),
    FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_thumbnails (
    media_id INTEGER PRIMARY KEY,
    micro_webp BLOB,
    micro_width INTEGER NOT NULL DEFAULT 0,
    micro_height INTEGER NOT NULL DEFAULT 0,
    screen_webp BLOB,
    screen_width INTEGER NOT NULL DEFAULT 0,
    screen_height INTEGER NOT NULL DEFAULT 0,
    generated_at INTEGER NOT NULL,
    FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_sync_queue (
    media_id INTEGER PRIMARY KEY,
    queued_at INTEGER NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_manifest_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_name TEXT NOT NULL,
    sha256 BLOB NOT NULL,
    telegram_message_id INTEGER,
    uploaded_at INTEGER,
    size_bytes INTEGER NOT NULL DEFAULT 0
);
";

/// Create (or upgrade to) the photo-gallery schema and record it in the
/// application migration ledger. Idempotent: safe to run on every startup.
fn apply_media_schema(conn: &sqlite::Connection) -> Result<(), String> {
    conn.execute(MEDIA_SCHEMA_SQL)
        .map_err(|error| format!("Failed to apply media schema migration: {error}"))?;

    let mut statement = conn
        .prepare(
            "INSERT OR IGNORE INTO app_schema_migrations
             (version, name, checksum, applied_at, app_version)
             VALUES (?, ?, ?, ?, ?)",
        )
        .map_err(|error| format!("Failed to prepare media migration ledger insert: {error}"))?;
    statement
        .bind((1, db_migrations::MEDIA_SCHEMA_VERSION))
        .map_err(|error| error.to_string())?;
    statement
        .bind((2, db_migrations::MEDIA_MIGRATION_NAME))
        .map_err(|error| error.to_string())?;
    statement
        .bind((3, db_migrations::media_schema_checksum().as_str()))
        .map_err(|error| error.to_string())?;
    statement
        .bind((4, chrono::Utc::now().timestamp()))
        .map_err(|error| error.to_string())?;
    statement
        .bind((5, env!("CARGO_PKG_VERSION")))
        .map_err(|error| error.to_string())?;
    statement.next().map_err(|error| error.to_string())?;
    Ok(())
}
