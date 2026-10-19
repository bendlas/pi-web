# Nix syntax sample: line/block comments, strings, interpolation, sets, lists,
# functions, operators, numbers, paths, URLs, and indented strings.
{
  description = "pi-web Nix highlighting sample";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils, ... }:
    let
      /* Block comments
         span multiple lines. */
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      version = "1.2.3";
      mkPackage =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          inherit (pkgs) lib stdenv;
        in
        pkgs.stdenv.mkDerivation rec {
          pname = "sample";
          inherit version;
          src = ./src;
          buildPhase = ''
            echo "building ${pname} ${version}"
            printf 'kept literal: ''${NOT_INTERPOLATED}\n'
          '';
          installPhase = ''
            mkdir -p $out/bin
            cp sample $out/bin/
          '';
          meta = with lib; {
            description = "Sample for ${pname}";
            license = licenses.mit;
            platforms = platforms.unix;
            homepage = https://example.com/sample;
          };
        };
    in
    flake-utils.lib.eachDefaultSystem (
      system: {
        packages.default = mkPackage system;
        devShells.default = nixpkgs.legacyPackages.${system}.mkShell {
          packages = [ nixpkgs.legacyPackages.${system}.jq ];
          shellHook = ''echo "ready: ${system}"'';
        };
      }
    )
    // {
      checks = {
        truthy = true;
        nothing = null;
        ratio = 1.5;
        negative = -42;
        arithmetic = 1 + 2 * 3 - 4 / 2;
        concatenated = "a" + "b";
        guarded = if self ? description then "yes" else "no";
        squared = builtins.map (x: x * x) [ 1 2 3 ];
      };
    };
}
