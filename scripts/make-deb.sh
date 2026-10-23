#!/usr/bin/env bash
# Builds a .deb from an already-built `cueme` program. Used for riscv64, where the
# Tauri tool has no build of its own.   usage: make-deb.sh <deb-arch> <path-to-cueme> <output.deb>
set -euo pipefail
ARCH="$1"; BIN="$2"; OUT="$3"
cd "$(dirname "$0")/.."
VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
ROOT="$(mktemp -d)/cueme_${VERSION}_${ARCH}"
mkdir -p "$ROOT/DEBIAN" "$ROOT/usr/bin" "$ROOT/usr/share/applications"
install -m 0755 "$BIN" "$ROOT/usr/bin/cueme"
for s in 16 24 32 48 64 128 256 512; do
  mkdir -p "$ROOT/usr/share/icons/hicolor/${s}x${s}/apps"
  install -m 0644 "packaging/icons/${s}x${s}.png" "$ROOT/usr/share/icons/hicolor/${s}x${s}/apps/cueme.png"
done
mkdir -p "$ROOT/usr/share/icons/hicolor/scalable/apps"
install -m 0644 packaging/icons/cueme.svg "$ROOT/usr/share/icons/hicolor/scalable/apps/cueme.svg"
# same name as the program (cueme.desktop + StartupWMClass=cueme) so Wayland shells find the icon
install -m 0644 packaging/cueme.desktop "$ROOT/usr/share/applications/cueme.desktop"
cat > "$ROOT/DEBIAN/control" <<CTRL
Package: cueme
Version: $VERSION
Architecture: $ARCH
Maintainer: mmBesar
Priority: optional
Depends: libwebkit2gtk-4.1-0, libgtk-3-0
Description: Teleprompter with Arabic/English Markdown, display or remote
 CueMe is a teleprompter that is both display and remote. Run it on Linux or Android; control any CueMe from any other.
CTRL
dpkg-deb --build --root-owner-group "$ROOT" "$OUT" >/dev/null
echo "Wrote $OUT"
