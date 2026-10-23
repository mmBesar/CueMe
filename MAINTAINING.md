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
- Push a tag: `git tag -a v0.4.0 -m "CueMe 0.4.0" && git push origin v0.3.0`. The workflow builds on **native runners** (no QEMU). The desktop AppImage/.deb and riscv64 use **Ubuntu 24.04** runners (`ubuntu-24.04`, `-arm`, `-riscv`) on purpose: an AppImage bundles GTK/WebKit that need at least the glibc of the system that built them, so building on the newest LTS breaks it on older distros (NixOS 26.05 failed). Everything glibc-independent (hub, Android, Docker, tests) uses `ubuntu-26.04`. Revisit when the oldest distro you care about has glibc 2.43. NixOS users build from `flake.nix` (`nix/package.nix`); after changing Rust dependencies in `src-tauri/` the lock file is used as is, so a failed Nix build usually means a missing system library in `nix/package.nix`.
- The tag becomes the Android version (`v0.2.3` -> versionName 0.2.3, versionCode 20300).
- Desktop jobs use the newest Ubuntu runner on purpose: newest WebKitGTK/libraries, so the apps follow current distributions without repo changes. Change the runner labels in `release.yml` when a newer one appears.
- The release job downloads only `hub-*`, `desktop-*` and `android` artifacts. Docker's build-record artifacts (`*.dockerbuild`) are switched off (`DOCKER_BUILD_RECORD_UPLOAD`), because downloading them failed the release step.
- Docker image: `ghcr.io/mmbesar/cueme` (`latest` + version tag), per-CPU images joined by the `docker-manifest` job. The image is public only after you make the package public in GitHub (Packages -> package settings).

## Linux packaging: what is built, and every workaround

One set of files describes the desktop entry and icons for every package:
`packaging/cueme.desktop`, `packaging/icons/` (16, 24, 32, 48, 64, 128, 256, 512 PNG and `cueme.svg`, the SVG is the master and the PNGs are rendered from it) and `packaging/cueme.spec` (RPM).

| Output | Made by | Contains |
|---|---|---|
| `CueMe-linux-<arch>.AppImage` | `tauri build` on Ubuntu 24.04 | program + its own GTK/WebKit, all icons, SVG |
| `cueme-linux-<arch>.deb` | `tauri build` (riscv64: `scripts/make-deb.sh`) | `/usr/bin/cueme`, desktop entry, all icons, SVG |
| `cueme-fedora-<arch>.rpm` | `scripts/build-rpm.sh` in a Fedora 44 container | same files; needs `webkit2gtk4.1`, `gtk3` |
| `cueme-desktop-linux-<arch>.tar.gz` | `scripts/make-tarball.sh` | `cueme`, `share/` with desktop entry + icons, README.txt |
| riscv64 | cargo + `make-deb.sh` + `make-tarball.sh` | deb and tar.gz only |

Workarounds, and why each one exists (remove them when the reason is gone):

1. **Nothing is installed by the program on its own.** The old start-up code that wrote `~/.local/share/applications/cueme.desktop` and icons is gone. The user asks for it (`--install-launcher`, or **Controls, Add to app menu**). The code is the `cue-launcher` crate, which has unit tests for the ownership rules.
2. **Icons are compiled into the program** (`include_bytes!`), so `--install-launcher` works from an AppImage, a tarball or a lone binary with no files next to it.
3. **Ownership rules.** The entry we write contains `X-CueMe-Launcher=1`; a `cueme.desktop` without it, or any symlink (home-manager, dotfiles), is never overwritten or removed. Icons we write are listed in `~/.local/share/cueme/launcher.manifest`; an existing icon is replaced only if it is listed or byte-identical, and removed only under the same rule.
4. **`Exec=` quoting.** The path is quoted and escaped as the Desktop Entry spec requires (spaces, `"`, `` ` ``, `$`, `\`, `%`), because AppImages often sit in folders with spaces. Control characters are refused. `TryExec=` points at the same file so the menu hides the entry when the AppImage was moved or deleted.
5. **The AppImage path comes from `$APPIMAGE`.** Inside an AppImage `current_exe()` is a temporary `/tmp/.mount_...` that disappears on exit; the entry must point at the AppImage file.
6. **Wayland app id.** GTK takes the app id from the program name, which would depend on how the program was started (`AppRun`, a renamed file). `main.rs` calls `glib::set_prgname("cueme")` before GTK starts, so the id is always `cueme`, which matches `cueme.desktop` and `StartupWMClass=cueme`. (`gdk::set_program_class` is not used: the bindings panic if it runs before GTK is initialised.) Checked on X11 with Xvfb: class `cueme` even when started as `AppRun`.
7. **The "Add to app menu" endpoint is stricter than fullscreen.** It writes files in the home folder, so it needs the PIN, a loopback peer, no `X-Forwarded-For`/`X-Real-IP`/`Forwarded` header and a loopback `Host`. A remote on the LAN, a reverse proxy or a DNS-rebinding page cannot trigger it. It is only offered by the desktop app (`Native::launcher`).
8. **Icons in the AppImage and deb.** `bundle.icon` lists every PNG (Tauri puts each at its real size), and `bundle.linux.*.files` adds the SVG, which Tauri does not do by itself.
9. **Icon cache.** After a change we run `update-desktop-database`, and `gtk-update-icon-cache` only if a cache file already exists (otherwise GTK reads the folders directly and we would leave a file behind that we do not own). Both are best effort.
10. **`NO_STRIP=true` and `APPIMAGE_EXTRACT_AND_RUN=1`** when building the AppImage: newer toolchains confuse linuxdeploy's strip step, and runners have no FUSE.
11. **RPM in a container via `docker run`, not `container:`.** `container:` would run the GitHub actions (checkout, upload) inside Fedora too, which needs extra packages. With `docker run` only the build runs in Fedora 44, on a native runner of each architecture (no QEMU). The source is mounted read-only and the .rpm goes to a separate folder, so no root-owned files are left in the runner's workspace (`chown` afterwards).
12. **RPM details.** Built from the Fedora 44 container so it is linked against Fedora's own WebKitGTK and glibc and installs on 44 and later. `debug_package` is off (Cargo already strips). The crates are downloaded while building and `--locked` pins them to `src-tauri/Cargo.lock`, so it is not meant for Fedora's own offline build system.
13. **riscv64 has no AppImage.** There is no riscv64 AppImage runtime and no linuxdeploy for it, so the old "thin AppImage" step was dropped instead of failing. It gets the binary (tar.gz) and the deb.
14. **`desktop-template.desktop`** is Tauri's own template (placeholders for exec/icon); keep it in step with `packaging/cueme.desktop`.

## Commits and your name on GitHub
GitHub links a commit to your profile only when the commit e-mail is **verified on your GitHub account**. The repo history uses `mmBesar <mbesar@proton.me>`: add and verify that address at *GitHub -> Settings -> Emails*. (Or use your GitHub no-reply address from that page: `git config user.email "12345678+mmBesar@users.noreply.github.com"`.)
```
git config user.email "12345678+mmBesar@users.noreply.github.com"
```
Commits made from now on will then show your avatar and name. Old commits keep the old e-mail (changing them means rewriting history).
