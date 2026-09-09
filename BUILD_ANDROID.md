# Building & testing Telegram Drive Android (with the new Photos mode) — on YOUR machine

> This is the **only** way to test the *real* features (actual photo/video backup
> to your Telegram, streaming your real cloud files, on-device compression). A
> browser preview cannot do these — they need the Rust/Telegram backend that only
> runs inside the packaged app. Expo Go cannot run this project (it is **Tauri,
> not React Native**), so do not try to load it there.

---

## ⚠️ Credentials: enter them IN the app, never in a shared QR/URL
- You need a Telegram **api_id** and **api_hash** from https://my.telegram.org/apps.
- On first launch the app shows a login wizard (`AuthWizard`) where you type the
  `api_id`, `api_hash`, and your phone number, then confirm the code Telegram
  sends you. That login is **encrypted and stays on your device**.
- **Do not** put `api_hash`/session tokens into a QR code or a URL you share —
  anyone who scans it could take over your account. No legitimate build step
  needs that; only the on-device login does.

---

## 1. Prerequisites (all required)
- **Node 20+** and npm.
- **Rust (stable)** plus Android compile targets:
  ```
  rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
  ```
- **Android SDK + NDK + JDK 17** and a device/emulator with USB debugging.
  Export env vars Tauri needs:
  ```
  export ANDROID_HOME="$HOME/Android/Sdk"
  export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/<your-ndk-version>"   # e.g. 27.x
  export JAVA_HOME="<path to JDK 17>"
  ```
- `adb` in PATH. Have the phone connected & unlocked, or an emulator running.

## 2. Install JS deps & verify web compiles
```bash
cd Telegram-Drive-Androidv4.0.0beta/app
npm ci
npx tsc --noEmit          # type-check (must pass — it does in this repo)
npm run build             # vite build
```

## 3. Generate the Android project (first time only)
The native `gen/android` folder is intentionally not committed, so scaffold it:
```bash
npm run tauri android init
```
(`npm run tauri` is a wrapper around the Tauri 2 CLI defined in
`app/scripts/tauri-cli.cjs`; equivalent to `npx @tauri-apps/cli android init`.)

## 4. Run on your phone (debug) — first build is slow
```bash
npm run tauri android dev
```
- First compile downloads the Rust crate graph + the Telegram backend and
  compiles for your CPU — expect **10–40+ minutes** and several GB. Be patient.
- It builds the APK, installs it on the connected device, and launches it.

## 5. Release APK/AAB (optional, if `dev` works)
```bash
npm run tauri android build -- --apk          # or omit --apk for an AAB
# signed release; APK will be under src-tauri/gen/android/.../app-release.apk
```
Publish that APK as a GitHub Release asset (the repo ignores `*.apk`).

## 6. First-launch + how to reach Photos mode
1. In the app, complete the **login wizard** with your `api_id`, `api_hash`,
   phone number, and the login code. Saved Messages is your home.
2. Tap the **Photos** icon in the top header (looks like a photo stack) →
   the Google-Photos-style timeline opens, fed by **your real Telegram media**.
3. Test:
   - tap a photo → streaming viewer + details sheet;
   - Search tab → type a file name / a date / “video”;
   - Library → folder albums;
   - cloud icon (top-right) → **Back up & sync + compression**, with a
     “Back up now” queue for device items you granted access to.

## 7. To finish the *device-side* auto-backup/compression
The UI, settings and data model are done. The last two native pieces are defined
in `PHOTOS_MODE_PLAN.md` §4.3 and live on the Rust/Android side, since they need
real device access: (a) a camera-roll MediaStore scan to feed
`listLocalBackupCandidates()`, and (b) a background runner that applies the
FFmpeg H.265/AV1 compress-then-upload step. Wire those and re-run step 4.

## Common build failures
- **`requires a higher Android compile SDK`** → raise `compileSdk`/install the
  SDK level Tauri expects (usually 34/35) via SDK Manager.
- **NDK toolchain errors** → set `ANDROID_NDK_HOME` to a supported NDK (25/26/27)
  and ensure `rustup target add …` was run.
- **Rust linking/`cargo` network** → run the build on a stable connection once
  to warm the cache; retry on transient timeouts.
- **`devUrl` port conflicts** → Tauri uses port 1420 for dev; free it if busy.
- **Java version** → Tauri/AGP want **JDK 17**, not 21 or 8.
