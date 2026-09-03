//! Database manifest backup.
//!
//! To prevent data loss across device switches or reinstalls, this module
//! exports the embedded SQLite database as an encrypted binary blob and
//! uploads it as a pinned manifest file inside the user's private Telegram
//! storage every 24 hours.
//!
//! The manifest is encrypted at rest on the device with an XChaCha20-Poly1305
//! key (kept in the app data directory) before it ever touches Telegram, so
//! Telegram only ever stores an opaque, authenticated ciphertext.

use crate::commands::utils::{map_error, resolve_peer};
use crate::db::DbConnection;
use crate::TelegramState;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use grammers_client::types::{InputMessage, Peer};
use grammers_tl_types as tl;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

const MANIFEST_KEY_FILE: &str = "manifest.key";
const MANIFEST_MESSAGE_PREFIX: &str = "TDMANIFEST1";
const MANIFEST_SCAN_LIMIT: usize = 100;
const BACKUP_INTERVAL_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestBackupResult {
    pub manifest_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub telegram_message_id: i32,
}

/// Load the 32-byte manifest encryption key, creating it (owner-only) on first
/// run. This key never leaves the device.
fn load_or_create_key(app_data_dir: &Path) -> Result<[u8; 32], String> {
    let key_path = app_data_dir.join(MANIFEST_KEY_FILE);
    if let Ok(existing) = std::fs::read(&key_path) {
        if existing.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&existing);
            return Ok(key);
        }
        log::warn!("Manifest key has an unexpected length; regenerating.");
    }
    std::fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;

    let mut key = [0u8; 32];
    getrandom::getrandom(&mut key)
        .map_err(|error| format!("Failed to generate manifest key: {error}"))?;

    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&key_path) {
        Ok(mut file) => {
            use std::io::Write;
            file.write_all(&key)
                .map_err(|error| format!("Failed to persist manifest key: {error}"))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            // Lost a race with another startup; reuse the existing key.
            let existing = std::fs::read(&key_path)
                .map_err(|error| format!("Failed to read manifest key: {error}"))?;
            if existing.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&existing);
                return Ok(key);
            }
            return Err("Manifest key is corrupt".to_string());
        }
        Err(error) => return Err(format!("Failed to create manifest key: {error}")),
    }
    Ok(key)
}

/// Authenticated-encrypt the plaintext manifest. Layout: `nonce (24) || ciphertext`.
fn encrypt_manifest(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| "Failed to initialize manifest encryption".to_string())?;
    let mut nonce_bytes = [0u8; 24];
    getrandom::getrandom(&mut nonce_bytes)
        .map_err(|error| format!("Failed to generate manifest nonce: {error}"))?;
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "Failed to encrypt manifest".to_string())?;
    let mut output = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

/// Best-effort pin of the manifest message inside Saved Messages. Failure to
/// pin does not fail the backup: the newest manifest is still discoverable by
/// its `TDMANIFEST1` prefix.
async fn pin_manifest_message(
    client: &grammers_client::Client,
    peer: &Peer,
    message_id: i32,
) -> Result<(), String> {
    let input_peer = match peer {
        Peer::User(user) => {
            let (id, access_hash) = match &user.raw {
                tl::enums::User::User(usr) => (usr.id, usr.access_hash.unwrap_or(0)),
                tl::enums::User::Empty(usr) => (usr.id, 0),
            };
            tl::enums::InputPeer::User(tl::types::InputPeerUser {
                user_id: id,
                access_hash,
            })
        }
        Peer::Channel(channel) => {
            tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
                channel_id: channel.raw.id,
                access_hash: channel
                    .raw
                    .access_hash
                    .ok_or_else(|| "Channel has no access hash".to_string())?,
            })
        }
        _ => return Err("Unsupported peer type for pinning".to_string()),
    };

    client
        .invoke(&tl::functions::messages::UpdatePinnedMessage {
            peer: input_peer,
            id: message_id,
            unpin: false,
            pm_oneside: false,
            silent: true,
        })
        .await
        .map(|_| ())
        .map_err(map_error)
}

/// Find previously uploaded manifest messages so they can be superseded.
async fn manifest_messages(
    client: &grammers_client::Client,
    peer: &Peer,
) -> Result<Vec<(i32, String)>, String> {
    let mut messages = client.iter_messages(peer).limit(MANIFEST_SCAN_LIMIT);
    let mut found = Vec::new();
    while let Some(message) = messages.next().await.map_err(|error| error.to_string())? {
        if message.text().starts_with(MANIFEST_MESSAGE_PREFIX) {
            found.push((message.id(), message.text().to_string()));
        }
    }
    Ok(found)
}

/// Export the SQLite database as an encrypted, authenticated blob and upload it
/// as a pinned manifest document in Saved Messages.
pub async fn backup_database_now(
    app: &AppHandle,
    db_pool: &DbConnection,
    state: &TelegramState,
) -> Result<ManifestBackupResult, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let key = load_or_create_key(&app_data_dir)?;

    // 1. Create a consistent on-disk snapshot using VACUUM INTO.
    let snapshot_name = format!("td_manifest_{}.tdmf", chrono::Utc::now().timestamp());
    let snapshot_path = app_data_dir.join(&snapshot_name);
    let snapshot_path_str = snapshot_path.to_string_lossy().to_string();
    {
        let conn = db_pool
            .lock()
            .map_err(|_| "Database connection poisoned".to_string())?;
        let mut statement = conn
            .prepare("VACUUM INTO ?")
            .map_err(|error| format!("Failed to prepare database snapshot: {error}"))?;
        statement
            .bind((1, snapshot_path_str.as_str()))
            .map_err(|error| format!("Failed to bind snapshot path: {error}"))?;
        statement
            .next()
            .map_err(|error| format!("Failed to create database snapshot: {error}"))?;
    }

    // 2. Read + hash + encrypt the snapshot.
    let encrypt_result = {
        let snapshot_path = snapshot_path.clone();
        let key = key;
        tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, Vec<u8>, String), String> {
            let plaintext = std::fs::read(&snapshot_path)
                .map_err(|error| format!("Failed to read database snapshot: {error}"))?;
            let digest = Sha256::digest(&plaintext);
            let sha256_hex = digest
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let ciphertext = encrypt_manifest(&key, &plaintext)?;
            Ok((ciphertext, digest.to_vec(), sha256_hex))
        })
        .await
        .map_err(|error| format!("Manifest encryption task failed: {error}"))?
    }?;
    let (ciphertext, sha256_bytes, sha256) = encrypt_result;

    // 3. Write the encrypted blob to a temporary upload file.
    let upload_path = app_data_dir.join(format!("{snapshot_name}.enc"));
    tokio::fs::write(&upload_path, &ciphertext)
        .await
        .map_err(|error| format!("Failed to write encrypted manifest: {error}"))?;

    let result = (|| async {
        let client = state
            .client
            .lock()
            .await
            .clone()
            .ok_or_else(|| "Connect to Telegram before backing up the database".to_string())?;
        let peer = resolve_peer(&client, None, &state.peer_cache).await?;

        // Upload the encrypted blob as an uncompressed document.
        let file = tokio::fs::File::open(&upload_path)
            .await
            .map_err(|error| format!("Failed to open encrypted manifest: {error}"))?;
        let size = ciphertext.len() as u64;
        let mut reader = tokio::io::BufReader::new(file);
        let uploaded = client
            .upload_stream(&mut reader, size as usize, snapshot_name.clone())
            .await
            .map_err(map_error)?;
        let sent = client
            .send_message(
                &peer,
                InputMessage::new()
                    .text(format!("{MANIFEST_MESSAGE_PREFIX}:{sha256}"))
                    .file(uploaded),
            )
            .await
            .map_err(map_error)?;

        // Pin the newest manifest (best-effort).
        if let Err(error) = pin_manifest_message(&client, &peer, sent.id()).await {
            log::warn!("Manifest uploaded but could not be pinned: {error}");
        }

        // Supersede older manifest messages.
        let old_ids = manifest_messages(&client, &peer)
            .await?
            .into_iter()
            .filter(|(id, _)| *id != sent.id())
            .map(|(id, _)| id)
            .collect::<Vec<_>>();
        for batch in old_ids.chunks(100) {
            if let Err(error) = client.delete_messages(&peer, batch).await {
                log::warn!("Unable to remove superseded manifest messages: {error}");
            }
        }

        Ok::<ManifestBackupResult, String>(ManifestBackupResult {
            manifest_name: snapshot_name.clone(),
            size_bytes: size,
            sha256: sha256.clone(),
            telegram_message_id: sent.id(),
        })
    })()
    .await;

    // 4. Clean up the temporary snapshot/upload files, then record the backup
    //    in the local ledger. The ledger write happens only after a successful
    //    upload, so the newest manifest is always discoverable by prefix.
    let _ = tokio::fs::remove_file(&snapshot_path).await;
    let _ = tokio::fs::remove_file(&upload_path).await;

    let backup = result?;
    {
        let conn = db_pool
            .lock()
            .map_err(|_| "Database connection poisoned".to_string())?;
        let mut statement = conn
            .prepare(
                "INSERT INTO app_manifest_backups
                 (manifest_name, sha256, telegram_message_id, uploaded_at, size_bytes)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .map_err(|error| error.to_string())?;
        statement
            .bind((1, backup.manifest_name.as_str()))
            .map_err(|error| error.to_string())?;
        statement
            .bind((2, sha256_bytes.as_slice()))
            .map_err(|error| error.to_string())?;
        statement
            .bind((3, i64::from(backup.telegram_message_id)))
            .map_err(|error| error.to_string())?;
        statement
            .bind((4, chrono::Utc::now().timestamp()))
            .map_err(|error| error.to_string())?;
        statement
            .bind((5, backup.size_bytes as i64))
            .map_err(|error| error.to_string())?;
        statement.next().map_err(|error| error.to_string())?;
    }

    log::info!(
        "Database manifest backup complete: {} ({} bytes, {})",
        backup.manifest_name,
        backup.size_bytes,
        backup.sha256
    );
    Ok(backup)
}

/// Start the 24-hour manifest backup loop. Spawned once at startup.
pub fn spawn_manifest_backup_loop(app: AppHandle, db_pool: DbConnection, state: TelegramState) {
    tauri::async_runtime::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(BACKUP_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Skip the first immediate tick so startup isn't slowed down.
        interval.tick().await;
        loop {
            interval.tick().await;
            match backup_database_now(&app, &db_pool, &state).await {
                Ok(result) => log::info!(
                    "Scheduled manifest backup succeeded: {:?}",
                    result.manifest_name
                ),
                Err(error) => log::warn!("Scheduled manifest backup failed: {error}"),
            }
        }
    });
}

/// Manual manifest backup command.
#[tauri::command]
pub async fn cmd_backup_database_now(
    app: AppHandle,
    db_pool: State<'_, DbConnection>,
    state: State<'_, TelegramState>,
) -> Result<ManifestBackupResult, String> {
    backup_database_now(&app, db_pool.inner(), state.inner()).await
}
