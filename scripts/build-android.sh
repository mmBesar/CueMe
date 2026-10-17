#!/usr/bin/env bash
# Builds both Android APKs (Android 6+ and modern).
# Needs: Rust + the four Android targets, cargo-ndk, the Android SDK/NDK
# (ANDROID_HOME, ANDROID_NDK_HOME), JDK 17 and Gradle 8.9.
#   rustup target add armv7-linux-androideabi aarch64-linux-android x86_64-linux-android i686-linux-android
#   cargo install cargo-ndk --locked
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) The Rust hub as a native library for each CPU type.
#    --platform 23 = Android 6, the lowest version we support.
cargo ndk \
  -t armeabi-v7a -t arm64-v8a -t x86_64 -t x86 \
  --platform 23 \
  -o android/app/src/main/jniLibs \
  build --release -p cue-android

# 2) The Java app + both flavours (legacy = Android 6+, modern = Android 8+).
cd android
gradle --no-daemon assembleLegacyRelease assembleModernRelease
echo "APKs:"
ls -la app/build/outputs/apk/*/release/*.apk
