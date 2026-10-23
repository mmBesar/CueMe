#!/usr/bin/env bash
# Builds the plain tar.gz of the desktop app from an already-built `cueme` program:
# the program, the desktop entry and ALL icons (16 24 32 48 64 128 256 512 + SVG) laid out
# like /usr, so `make install`-style copying or just running ./cueme both work.
# usage: make-tarball.sh <arch-name> <path-to-cueme> <output.tar.gz>
set -euo pipefail
ARCH="$1"; BIN="$2"; OUT="$(realpath -m "$3")"
cd "$(dirname "$0")/.."
VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
NAME="cueme-${VERSION}-linux-${ARCH}"
STAGE="$(mktemp -d)/$NAME"
mkdir -p "$STAGE/share/applications" "$STAGE/share/icons/hicolor/scalable/apps"
install -m 0755 "$BIN" "$STAGE/cueme"
install -m 0644 packaging/cueme.desktop "$STAGE/share/applications/cueme.desktop"
for s in 16 24 32 48 64 128 256 512; do
  mkdir -p "$STAGE/share/icons/hicolor/${s}x${s}/apps"
  install -m 0644 "packaging/icons/${s}x${s}.png" "$STAGE/share/icons/hicolor/${s}x${s}/apps/cueme.png"
done
install -m 0644 packaging/icons/cueme.svg "$STAGE/share/icons/hicolor/scalable/apps/cueme.svg"
install -m 0644 LICENSE "$STAGE/LICENSE"
cat > "$STAGE/README.txt" <<TXT
CueMe $VERSION (Linux, $ARCH)

Run it:           ./cueme
Add to app menu:  ./cueme --install-launcher     (this user only; nothing is installed unless you run it)
Remove it again:  ./cueme --uninstall-launcher

Needs the system packages  WebKitGTK 4.1  and  GTK 3
  Debian / Ubuntu:  sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0
  Fedora:           sudo dnf install webkit2gtk4.1 gtk3
  Arch:             sudo pacman -S webkit2gtk-4.1 gtk3

share/ holds the same desktop entry and icons the packages install, for packagers
and for copying into /usr/local/share by hand.
TXT
mkdir -p "$(dirname "$OUT")"
tar -C "$(dirname "$STAGE")" -czf "$OUT" "$NAME"
echo "Wrote $OUT"
