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
    install -Dm644 src-tauri/icons/128x128.png $out/share/icons/hicolor/128x128/apps/cueme.png
    install -Dm644 src-tauri/icons/128x128@2x.png $out/share/icons/hicolor/256x256/apps/cueme.png
    mkdir -p $out/share/applications
    cat > $out/share/applications/cueme.desktop <<DESKTOP
    [Desktop Entry]
    Type=Application
    Version=1.0
    Name=CueMe
    GenericName=Teleprompter
    Comment=Teleprompter with Arabic/English Markdown, display or remote
    Exec=cueme
    Icon=cueme
    Terminal=false
    Categories=Utility;
    Keywords=teleprompter;prompter;autocue;cue;
    StartupWMClass=cueme
    DESKTOP
    sed -i 's/^    //' $out/share/applications/cueme.desktop
  '';

  # the program tries to add its own desktop entry in ~/.local/share; the package has one
  preFixup = ''
    gappsWrapperArgs+=(--set CUEME_NO_INTEGRATION 1)
  '';

  meta = {
    description = "Teleprompter with Arabic/English Markdown; every app is both display and remote";
    homepage = "https://github.com/mmBesar/CueMe";
    license = lib.licenses.mit;
    mainProgram = "cueme";
    platforms = [ "x86_64-linux" "aarch64-linux" "riscv64-linux" ];
  };
}
