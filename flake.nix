{
  description = "CueMe - teleprompter where every app is both display and remote";

  # Any recent nixpkgs works (the package is built with *your* nixpkgs through the
  # overlay), so nothing here has to change when NixOS 26.10 arrives.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "riscv64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in {
      overlays.default = final: prev: {
        cueme = final.callPackage ./nix/package.nix { };
        cueme-serve = final.callPackage ./nix/hub.nix { };
      };

      packages = forAll (pkgs: {
        cueme = pkgs.callPackage ./nix/package.nix { };
        cueme-serve = pkgs.callPackage ./nix/hub.nix { };
        default = pkgs.callPackage ./nix/package.nix { };
      });

      apps = forAll (pkgs: {
        default = { type = "app"; program = "${self.packages.${pkgs.system}.cueme}/bin/cueme"; };
        serve = { type = "app"; program = "${self.packages.${pkgs.system}.cueme-serve}/bin/cueme-serve"; };
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          inputsFrom = [ self.packages.${pkgs.system}.cueme ];
          packages = [ pkgs.cargo pkgs.rustc pkgs.nodejs ];
        };
      });
    };
}
