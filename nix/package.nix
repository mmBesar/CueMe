# CueMe for Nix / NixOS. Built from this source tree against YOUR system's libraries,
# so it works on any NixOS release (26.05, 26.10, unstable...) with no AppImage tricks.
#
# `callPackage` friendly: it only needs a nixpkgs. See flake.nix and the README.
{
  lib,
  rustPlatform,
  pkg-config,
  wrapGAppsHook3,
  glib-networking,
  gtk3,
  libsoup_3,
  webkitgtk_4_1,
  librsvg,
  openssl,
}:

rustPlatform.buildRustPackage {
  pname = "cueme";
  version = (lib.importTOML ../src-tauri/Cargo.toml).package.version;

  # the whole tree: the desktop crate uses ../crates and the hub embeds ../web
  src = lib.cleanSourceWith {
    src = lib.cleanSource ../.;
    filter = path: type: let b = baseNameOf path; in
      !(builtins.elem b [ "target" "node_modules" "android" "docs" ".github" "tests-js" ]);
  };

  cargoRoot = "src-tauri";
  buildAndTestSubdir = "src-tauri";
  cargoLock.lockFile = ../src-tauri/Cargo.lock;

  nativeBuildInputs = [ pkg-config wrapGAppsHook3 ];
  buildInputs = [ gtk3 libsoup_3 webkitgtk_4_1 librsvg openssl glib-networking ];

  # the window is a Tauri webview that loads the hub inside this process
  buildFeatures = [ "tauri/custom-protocol" ];

  doCheck = false;

  postInstall = ''
    for s in 16 24 32 48 64 128 256 512; do
      install -Dm644 packaging/icons/''${s}x''${s}.png $out/share/icons/hicolor/''${s}x''${s}/apps/cueme.png
    done
    install -Dm644 packaging/icons/cueme.svg $out/share/icons/hicolor/scalable/apps/cueme.svg
    install -Dm644 packaging/cueme.desktop $out/share/applications/cueme.desktop
  '';

  meta = {
    description = "Teleprompter with Arabic/English Markdown; every app is both display and remote";
    homepage = "https://github.com/mmBesar/CueMe";
    license = lib.licenses.mit;
    mainProgram = "cueme";
    platforms = [ "x86_64-linux" "aarch64-linux" "riscv64-linux" ];
  };
}
