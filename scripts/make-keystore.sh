#!/usr/bin/env bash
# Makes your own Android signing key and prints the 4 values to paste into GitHub.
# Run it ONCE, keep the .jks file somewhere safe (a password manager / backup):
# if you lose it you can never update an installed CueMe without uninstalling it first.
#   usage: scripts/make-keystore.sh
set -euo pipefail
command -v keytool >/dev/null || { echo "keytool not found. Install a JDK first (Debian: sudo apt install default-jdk-headless; Fedora: sudo dnf install java-17-openjdk-headless)."; exit 1; }
FILE="${1:-cueme-release.jks}"
[ -e "$FILE" ] && { echo "$FILE already exists - not overwriting."; exit 1; }
PASS="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
keytool -genkeypair -v -keystore "$FILE" -alias cueme -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=CueMe, O=mmBesar" >/dev/null
echo
echo "Created $FILE  (BACK IT UP - and never commit it to the repo)"
echo
echo "Now on GitHub: Settings > Secrets and variables > Actions > New repository secret. Add these four:"
echo "  ANDROID_KEYSTORE_B64      = $(base64 -w0 "$FILE" | head -c 40)...   (the full text printed below)"
echo "  ANDROID_KEYSTORE_PASSWORD = $PASS"
echo "  ANDROID_KEY_ALIAS         = cueme"
echo "  ANDROID_KEY_PASSWORD      = $PASS"
echo
echo "ANDROID_KEYSTORE_B64 full value:"
base64 -w0 "$FILE"; echo
