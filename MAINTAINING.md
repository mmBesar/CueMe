# Maintaining CueMe

Notes for the person who builds and releases CueMe. (Users: see [README.md](README.md).)

## How it works
```
 [ remote ] --WebSocket--> [ hub ] --WebSocket--> [ display ]
   buttons, sliders      keeps script + settings    owns the scroll position,
   show live position    relays commands            streams it ~15x per second
```
Every CueMe app contains the hub, so any app can be the display. The display scrolls using real elapsed time (same speed at any frame rate) and keeps its place in the *text*, not in pixels, when you change size or width.

| Folder | What |
|---|---|
| `crates/cue-core` | Rust: settings, Markdown, script library, PIN, protocol |
| `crates/cue-hub` | Rust: the hub (server, web UI, LAN discovery); also the `cueme-serve` program |
| `crates/cue-android` | Rust: bridge that runs the hub inside the Android app |
| `web/` | the UI (plain JavaScript and CSS, works on old WebViews; themes in `theme.js`) |
| `src-tauri/` | Linux desktop window (Tauri 2) |
| `android/` | Android app (Java WebView + Rust hub) |
| `docker/`, `scripts/` | headless image; build and packaging helpers |
| `tests-js/` | unit + end-to-end tests (real hub + real Chromium) |

## Build it yourself
```
cargo test --workspace               # Rust tests
npm ci && npm test                   # scroll engine + old-browser syntax check
cargo build -p cue-hub && npm run e2e   # real hub + real Chromium
cargo run -p cue-hub                 # run the hub, open the printed address
```
Releases: `git tag v0.1.0 && git push --tags`; `.github/workflows/release.yml` builds everything on native runners (no QEMU) and attaches it to a GitHub Release. The tag number becomes the Android version.

## Signing the Android apps (no coding needed)
Android only installs apps that are **signed**. The release build always signs the APKs, but with which key?
- **By default** (nothing to do): a built-in test key. The APK installs fine. The only catch: if you later install a build signed with a *different* key, Android refuses to update it in place; uninstall first (you lose nothing important: scripts are in the folder above).
- **With your own key** (recommended once you share the app): run `scripts/make-keystore.sh` on your computer (needs Java: `sudo apt install default-jdk-headless`). It creates `cueme-release.jks`, **keep it safe and never put it in the repo**, and prints four values. On GitHub open *Settings → Secrets and variables → Actions → New repository secret* and add `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Every release after that is signed with your key and updates install over each other.

To install an APK: open it on the phone and allow "install from this source" once.


## Releases and the version
- Push a tag: `git tag -a v0.3.0 -m "CueMe 0.3.0" && git push origin v0.3.0`. The workflow builds on **native runners** (amd64 `ubuntu-26.04`, arm64 `ubuntu-26.04-arm`, riscv64 `ubuntu-26.04-riscv`), no QEMU.
- The tag becomes the Android version (`v0.2.3` -> versionName 0.2.3, versionCode 20300).
- Desktop jobs use the newest Ubuntu runner on purpose: newest WebKitGTK/libraries, so the apps follow current distributions without repo changes. Change the runner labels in `release.yml` when a newer one appears.
- The release job downloads only `hub-*`, `desktop-*` and `android` artifacts. Docker's build-record artifacts (`*.dockerbuild`) are switched off (`DOCKER_BUILD_RECORD_UPLOAD`), because downloading them failed the release step.
- Docker image: `ghcr.io/mmbesar/cueme` (`latest` + version tag), per-CPU images joined by the `docker-manifest` job. The image is public only after you make the package public in GitHub (Packages -> package settings).

## Commits and your name on GitHub
GitHub links a commit to your profile only when the commit e-mail is **verified on your GitHub account**. The repo history uses `mmBesar <mbesar@proton.me>`: add and verify that address at *GitHub -> Settings -> Emails*. (Or use your GitHub no-reply address from that page: `git config user.email "12345678+mmBesar@users.noreply.github.com"`.)
```
git config user.email "12345678+mmBesar@users.noreply.github.com"
```
Commits made from now on will then show your avatar and name. Old commits keep the old e-mail (changing them means rewriting history).
