# CueMe for Fedora 44 and later (x86_64 and aarch64).
# Built by scripts/build-rpm.sh inside a Fedora container on a native runner.
%global debug_package %{nil}
# the release build is already stripped (Cargo profile), and cargo's output is not
# what rpm's debuginfo tooling expects

Name:           cueme
Version:        @VERSION@
Release:        1%{?dist}
Summary:        Teleprompter with Arabic/English Markdown, display or remote
License:        MIT
URL:            https://github.com/mmBesar/CueMe
Source0:        cueme-%{version}.tar.gz

BuildRequires:  rust
BuildRequires:  cargo
BuildRequires:  gcc
BuildRequires:  gcc-c++
BuildRequires:  make
BuildRequires:  pkgconfig(webkit2gtk-4.1)
BuildRequires:  pkgconfig(gtk+-3.0)
BuildRequires:  pkgconfig(libsoup-3.0)
BuildRequires:  pkgconfig(librsvg-2.0)
BuildRequires:  pkgconfig(openssl)
BuildRequires:  desktop-file-utils

# the window is a WebKitGTK view; the packages below are the runtime libraries
Requires:       webkit2gtk4.1
Requires:       gtk3
Requires:       hicolor-icon-theme

%description
CueMe is a teleprompter that is both display and remote. Run it on Linux or
Android and control any CueMe from any other. Scripts are Markdown, Arabic and
English (right-to-left and left-to-right) are both first class.

%prep
%autosetup -n cueme-%{version}

%build
# --locked: build exactly the dependency versions the project tested with.
# crates are downloaded at build time (this RPM is not meant for Fedora's own
# offline build system).
cargo build --release --locked --manifest-path src-tauri/Cargo.toml

%install
install -Dm0755 src-tauri/target/release/cueme %{buildroot}%{_bindir}/cueme
install -Dm0644 packaging/cueme.desktop %{buildroot}%{_datadir}/applications/cueme.desktop
for s in 16 24 32 48 64 128 256 512; do
  install -Dm0644 packaging/icons/${s}x${s}.png \
    %{buildroot}%{_datadir}/icons/hicolor/${s}x${s}/apps/cueme.png
done
install -Dm0644 packaging/icons/cueme.svg \
  %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/cueme.svg

%check
desktop-file-validate %{buildroot}%{_datadir}/applications/cueme.desktop

%files
%license LICENSE
%{_bindir}/cueme
%{_datadir}/applications/cueme.desktop
%{_datadir}/icons/hicolor/*/apps/cueme.png
%{_datadir}/icons/hicolor/scalable/apps/cueme.svg

%changelog
* Fri Oct 23 2026 mmBesar <mbesar@proton.me> - @VERSION@-1
- Packaged from the CueMe source tree
