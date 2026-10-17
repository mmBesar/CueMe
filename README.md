# CueMe

A teleprompter where **every app is both the display and the remote**.

- Put the script on a screen (a laptop, a tablet, an old phone) and control it from any other device, or from the same one.
- Display on Android + remote on Linux, or the other way round: any pairing works. Android 6 works as display **and** as remote.
- Markdown with **Arabic + English mixed** (each paragraph lays out in its own direction), Arabic UI included.
- Smooth, live scrolling: the remote always shows where the display really is; scrubbing glides instead of jumping.
- Four **Catppuccin** themes (Latte, Frappé, Macchiato, Mocha) with 14 accent colours. Default: Macchiato + Mauve.

No cloud, no account, nothing leaves your network. Free software (MIT).

## Downloads

Grab them from the **Releases** page.

| You have | Download |
|---|---|
| Linux PC / laptop (amd64, arm64) | `CueMe-linux-<arch>.AppImage`, or the `.deb`, or the plain `cueme-desktop-linux-<arch>.tar.gz` |
| Linux riscv64 | `cueme-linux-riscv64.deb`, `cueme-desktop-linux-riscv64.tar.gz` and, when the build could make it, `CueMe-linux-riscv64.AppImage` (they use the system `libwebkit2gtk-4.1`) |
| Android 8 or newer | `CueMe-android-modern.apk` |
| **Android 6 / 7** | `CueMe-android6.apk` (Android 6.0 and up, all CPU types) |
| Server / Raspberry Pi / no screen | `cueme-serve-linux-<arch>` (one static file) or the Docker image `ghcr.io/mmbesar/cueme` |

Every download is listed with its checksum in `SHA256SUMS.txt`.

**Linux notes.** The desktop builds are made on Ubuntu 22.04, so they run on Debian 12, Ubuntu 22.04+, Fedora and newer. The plain tarball (and the `.deb`) need the system packages `libwebkit2gtk-4.1-0` and `libgtk-3-0`; the AppImage carries its own. Install the `.deb` (`sudo apt install ./cueme_*.deb`) to get the menu entry and the icon: window managers such as Hyprland find the icon through `cueme.desktop`.

## Using it

### Three ways to use it
1. **Stand-alone**: tap **Display**. The screen has everything: tap it to show the control bar (play/pause, previous/next heading, top, fullscreen, speed, text size, a position slider, the menu). Nothing else is needed.
2. **Display + remote**: one device shows, another controls. Tap **Display** on one and **Remote** on the other.
3. **Browser remote**: any phone or computer browser can open the address shown on the display and act as a remote, with nothing installed.

### Fullscreen without any buttons
Fullscreen (the ⛶ button, `Alt+F`, or from the remote) shows **only the script**. Stray taps do nothing. A tiny see-through dot sits in the corner: tap it and the control bar comes back for a few seconds. **Hide controls** in the bar does the same without fullscreen; press the same button (now "Show controls") or `C` to bring everything back.

### Connecting a remote
Open the **Connect** tab in the display's menu: it shows a QR code, the address and a **PIN (up to 3 digits)**.
- **Nearby**: every CueMe announces itself on the Wi-Fi (UDP broadcast, works on Android 6 and Android 16). On the remote, tap **Remote** and pick the display from the list, then type the PIN.
- **Scan QR**: on the remote, tap **Scan QR** and point the camera at the display's code. It connects by itself (Android needs the camera permission, asked once).
- **Type it**: address like `192.168.1.20:7878` and the PIN.

If a Wi-Fi blocks broadcast (some guest networks), use the QR code or type the address.

### Jumping around a long script
- **Outline** tab: every heading of the script. Tap one and the display glides there (works from the remote too).
- **Position slider**: drag anywhere; far jumps take about two seconds, short ones are gentle.
- **Previous / next heading** buttons (or PageUp / PageDown on the display).
- **Jog slider**: push for slow or fast scrolling, let go and it stops.

### Scripts: where they are saved and how to reload them
Write or paste text in the **Script** tab (Markdown). **Send to display** shows it, **Save** stores it. The **Library** list shows every `.md` / `.txt` file in the display's script folder; tap a name to load it. The folder path is printed under the list. To reload after copying files into the folder by hand, save any script or reopen the Script tab.

| Where | Script folder |
|---|---|
| Linux app | `~/Documents/CueMe` (or `CUEME_LIBRARY`) |
| Android | the app's own folder `Android/data/app.cueme/files/scripts` (on Android 11+ file managers hide `Android/data`; use a PC over USB, or the Library list in the app) |
| Headless hub / Docker | `--library DIR` (default `~/.local/share/cueme/scripts`) / the `/scripts` volume |

### Controls
Text size, speed (lines per minute), text width, dim, cue-line position, mirror (flip X), flip Y, bold, colours, focus band, countdown, fullscreen on play, and **Use theme colours for the script**.

| Key (on the display) | Action |
|---|---|
| Space | play / pause |
| Up / Down | scroll while held |
| Left / Right | slower / faster |
| Alt + Up / Down | text size |
| `[` / `]` | text width |
| Alt + F | fullscreen |
| Alt + E | edit script |
| M | menu |
| C | hide / show controls |
| Home, PageUp, PageDown | top, previous / next heading |

## Android: installing and signing (no coding needed)
Android only installs apps that are **signed**. The release build always signs the APKs, but with which key?
- **By default** (nothing to do): a built-in test key. The APK installs fine. The only catch: if you later install a build signed with a *different* key, Android refuses to update it in place; uninstall first (you lose nothing important: scripts are in the folder above).
- **With your own key** (recommended once you share the app): run `scripts/make-keystore.sh` on your computer (needs Java: `sudo apt install default-jdk-headless`). It creates `cueme-release.jks`, **keep it safe and never put it in the repo**, and prints four values. On GitHub open *Settings → Secrets and variables → Actions → New repository secret* and add `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Every release after that is signed with your key and updates install over each other.

To install an APK: open it on the phone and allow "install from this source" once.

## Headless hub
```
cueme-serve                       # prints the PIN and the addresses
cueme-serve --help
docker run -d --name cueme --network host \
  -e PUID=1000 -e PGID=1000 -e TZ=Africa/Cairo -e CUEME_PIN=123 \
  -v ./cueme-config:/config -v ./scripts:/scripts \
  ghcr.io/mmbesar/cueme:latest
```
`--network host` lets nearby devices find it automatically; without it, use the address and port 7878.

## Security
- Devices connect with a PIN of **up to 3 digits**: easy to type, but weak by design. Treat CueMe as a tool for a network you trust (your home or studio Wi-Fi, or Tailscale). **Never port-forward it to the internet.**
- Wrong guesses are rate-limited per address. Web pages from the internet cannot talk to a hub on your machine (requests with a non-local `Origin` are refused).
- Scripts are converted to HTML by the Rust core; raw HTML is shown as text, unsafe links and images are dropped, and a content-security-policy backs that up, so a script cannot run code. Links in a script are text only.
- Traffic on the LAN is plain HTTP/WebSocket.

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

## Known limits
- **Android 6 uses the phone's system WebView**, updated through Google Play. If the UI looks broken on an old phone, update "Android System WebView". QR scanning needs a WebView recent enough for the camera; if not, the button is hidden and the nearby list / typing still work.
- The Android app stops serving when Android closes it in the background. Keep it open while prompting (the screen is kept awake).
- In a plain browser, fullscreen from the remote needs a tap on the display first (browsers insist). The Android and Linux apps do it directly.
- riscv64: the AppImage is a thin one (needs `libwebkit2gtk-4.1` installed) and is only published if an AppImage runtime exists for riscv64.
- The Docker image finds other devices only with `--network host`.

## Third-party
[jsQR](https://github.com/cozmo/jsQR) (Apache-2.0, `web/vendor/jsQR.js`) decodes QR codes in the camera view. Catppuccin colours are from the [Catppuccin](https://catppuccin.com) palette (MIT). See `THIRD_PARTY.md`.

MIT licence, © mmBesar.
