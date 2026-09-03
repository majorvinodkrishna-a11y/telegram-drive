//! JNI bridge from Android native (Kotlin) into the Rust background worker.
//!
//! The Kotlin `MediaStoreObserver` and `MediaUploadWorker` classes call these
//! exported symbols to hand new MediaStore URIs straight to the Rust queue and
//! to nudge the MTProto upload worker. Symbol names are derived from the
//! `com.cameronamer.telegramdrive.MediaSyncBridge` class.

/// Called by `MediaSyncBridge.nativeEnqueueMedia(String uri)`.
///
/// Receives a MediaStore content URI, converts it to a Rust string, and pushes
/// it into the background ingestion queue. This is non-blocking and safe to
/// call from any JNI-attached thread; if the worker has not started yet the URI
/// is buffered and flushed once it does.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_cameronamer_telegramdrive_MediaSyncBridge_nativeEnqueueMedia(
    _env: jni::sys::JNIEnv,
    _class: jni::sys::jclass,
    uri: jni::sys::jstring,
) {
    let ctx = ndk_context::android_context();
    let vm = match unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) } {
        Ok(vm) => vm,
        Err(error) => {
            log::error!("MediaSyncBridge: failed to resolve JavaVM: {error}");
            return;
        }
    };
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(error) => {
            log::error!("MediaSyncBridge: failed to attach thread: {error}");
            return;
        }
    };
    // SAFETY: `uri` is a valid local reference owned by the JVM for the
    // duration of this native call; `JString::from_raw` does not take ownership.
    let jstring = unsafe { jni::objects::JString::from_raw(uri) };
    let uri_string: String = match env.get_string(&jstring) {
        Ok(value) => value.into(),
        Err(error) => {
            log::error!("MediaSyncBridge: failed to read URI string: {error}");
            return;
        }
    };
    if !uri_string.trim().is_empty() {
        crate::upload_service::enqueue_media_uri(uri_string);
    }
}

/// Called by `MediaSyncBridge.nativeProcessPendingUploads()`.
///
/// Nudges the Rust worker to drain the upload queue immediately (the worker
/// also drains on every ingress event and a 60-second tick).
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_cameronamer_telegramdrive_MediaSyncBridge_nativeProcessPendingUploads(
    _env: jni::sys::JNIEnv,
    _class: jni::sys::jclass,
) {
    log::info!("MediaSyncBridge: nativeProcessPendingUploads invoked");
    crate::upload_service::enqueue_drain_request();
}

// Non-Android builds: keep the module non-empty so `mod media_sync_bridge;`
// compiles everywhere.
#[cfg(not(target_os = "android"))]
#[allow(dead_code)]
fn media_sync_bridge_platform_stub() {}
