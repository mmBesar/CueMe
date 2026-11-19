#!/usr/bin/env bash
# Prints the version that goes into file names and APKs.
#   tag build   (v0.5.0)  ->  0.5.0
#   any other build      ->  0.5.0-dev.<short commit>      (0.5.0 = the version in Cargo.toml)
# So every download says which version it is, released or not.
set -euo pipefail
cd "$(dirname "$0")/.."
CARGO_V="$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)"
if [ "${GITHUB_REF_TYPE:-}" = "tag" ] && [[ "${GITHUB_REF_NAME:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  V="${GITHUB_REF_NAME#v}"
  if [ "$V" != "$CARGO_V" ]; then
    echo "::warning::tag $GITHUB_REF_NAME does not match the version in Cargo.toml ($CARGO_V): the programs will report $CARGO_V" >&2
  fi
  echo "$V"
else
  SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
  echo "${CARGO_V}-dev.${SHA:0:7}"
fi
