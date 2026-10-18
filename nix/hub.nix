# Just the headless hub (browser UI, no window): `cueme-serve`. Handy for a server.
{ lib, rustPlatform }:

rustPlatform.buildRustPackage {
  pname = "cueme-serve";
  version = (lib.importTOML ../Cargo.toml).workspace.package.version;

  src = lib.cleanSourceWith {
    src = lib.cleanSource ../.;
    filter = path: type: let b = baseNameOf path; in
      !(builtins.elem b [ "target" "node_modules" "android" "docs" ".github" "tests-js" "src-tauri" ]);
  };

  cargoLock.lockFile = ../Cargo.lock;
  cargoBuildFlags = [ "-p" "cue-hub" ];
  doCheck = false;

  meta = {
    description = "CueMe hub: serves the teleprompter UI over HTTP/WebSocket";
    homepage = "https://github.com/mmBesar/CueMe";
    license = lib.licenses.mit;
    mainProgram = "cueme-serve";
  };
}
