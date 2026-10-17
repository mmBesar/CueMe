#!/bin/sh
# Builds the static hub inside Alpine Linux (real musl compiler + C library).
# Used for riscv64, where Ubuntu's gcc is not a musl compiler.
# Runs INSIDE an alpine container:  docker run --rm -v "$PWD":/w -w /w alpine:edge sh scripts/build-hub-alpine.sh <uid> <gid>
# (edge is used because the dependencies need a recent Rust compiler).
set -eu
apk add --no-cache rust cargo musl-dev >/dev/null
HOST="$(rustc -vV | sed -n 's/^host: //p')"
# --target makes the static flag apply to the program only (build scripts / proc-macros stay normal)
RUSTFLAGS="-C target-feature=+crt-static" cargo build --release -p cue-hub --target "$HOST" --target-dir /w/target/alpine
mkdir -p /w/target/alpine-out
cp "/w/target/alpine/$HOST/release/cueme-serve" /w/target/alpine-out/cueme-serve
chown -R "${1:-0}:${2:-0}" /w/target/alpine /w/target/alpine-out
