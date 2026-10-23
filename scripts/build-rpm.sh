#!/usr/bin/env bash
# Builds the RPM. Run it INSIDE a Fedora container (see the "rpm" job in
# .github/workflows/release.yml); it installs what it needs with dnf.
#
#   usage: build-rpm.sh <source-dir> <out-dir> <amd64|arm64>
#
# <source-dir> is only read (it may be mounted read-only), the build happens in a copy,
# and only the finished .rpm is written to <out-dir> as cueme-fedora-<arch>.rpm.
set -euo pipefail
SRC="$(realpath "$1")"; OUT="$(realpath -m "$2")"; ARCH="$3"

dnf -y install --setopt=install_weak_deps=False \
  rpm-build desktop-file-utils tar gzip rust cargo gcc gcc-c++ make \
  'pkgconfig(webkit2gtk-4.1)' 'pkgconfig(gtk+-3.0)' 'pkgconfig(libsoup-3.0)' \
  'pkgconfig(librsvg-2.0)' 'pkgconfig(openssl)'

VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$SRC/src-tauri/Cargo.toml" | head -1)"
TOP="$(mktemp -d)"
mkdir -p "$TOP"/{SOURCES,SPECS,BUILD,RPMS,SRPMS,BUILDROOT}

# source tarball of the tree, without build output and junk
tar -C "$SRC" \
  --exclude=./target --exclude=./src-tauri/target --exclude=./node_modules \
  --exclude=./.git --exclude=./android --exclude=./docs --exclude=./dist \
  --transform "s,^\.,cueme-$VERSION," -czf "$TOP/SOURCES/cueme-$VERSION.tar.gz" .
sed "s/@VERSION@/$VERSION/g" "$SRC/packaging/cueme.spec" > "$TOP/SPECS/cueme.spec"

rpmbuild --define "_topdir $TOP" -bb "$TOP/SPECS/cueme.spec"

mkdir -p "$OUT"
cp "$TOP"/RPMS/*/cueme-*.rpm "$OUT/cueme-fedora-$ARCH.rpm"
ls -l "$OUT"
