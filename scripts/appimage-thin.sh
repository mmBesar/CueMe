#!/usr/bin/env bash
# Makes a "thin" AppImage (it uses the system's WebKitGTK instead of carrying it).
# Used for riscv64, where the normal AppImage tooling has no build.
#   usage: appimage-thin.sh <arch> <path-to-cueme> <output.AppImage>
# An AppImage is just: [runtime program] + [squashfs of the app folder].
set -euo pipefail
ARCH="$1"; BIN="$2"; OUT="$3"
cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
APPDIR="$WORK/CueMe.AppDir"
mkdir -p "$APPDIR/usr/bin"
cp "$BIN" "$APPDIR/usr/bin/cueme"
cp assets/icon-256.png "$APPDIR/cueme.png"

cat > "$APPDIR/cueme.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=CueMe
Comment=Teleprompter: display or remote
Exec=cueme
Icon=cueme
Categories=Utility;
Terminal=false
StartupWMClass=cueme
DESK

cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/sh
# Start CueMe. Needs the system package libwebkit2gtk-4.1 (WebKitGTK).
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/cueme" "$@"
RUN
chmod +x "$APPDIR/AppRun"

# The AppImage runtime for this CPU (small program that mounts the squashfs).
RUNTIME="$WORK/runtime"
URL="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-$ARCH"
if ! curl -fsSL "$URL" -o "$RUNTIME"; then
  echo "No AppImage runtime published for $ARCH ($URL). Skipping the AppImage." >&2
  exit 0   # not an error: the .deb and the tarball are still published
fi

mksquashfs "$APPDIR" "$WORK/app.squashfs" -root-owned -noappend -comp zstd >/dev/null
cat "$RUNTIME" "$WORK/app.squashfs" > "$OUT"
chmod +x "$OUT"
echo "Wrote $OUT"
