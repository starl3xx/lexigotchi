#!/usr/bin/env bash
# Populate contracts/lib with the (gitignored) Solidity dependencies so `forge build` works.
# forge-std is cloned at a pinned tag; OpenZeppelin is copied from the repo's node_modules
# (installed via `npm install` at the repo root — see the root package.json devDependency).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
FORGE_STD_TAG="v1.9.7"

mkdir -p "$HERE/lib"

# --- forge-std (test framework) ---
if [ ! -f "$HERE/lib/forge-std/src/Test.sol" ]; then
  echo "→ cloning forge-std $FORGE_STD_TAG"
  rm -rf "$HERE/lib/forge-std"
  git clone --quiet --depth 1 --branch "$FORGE_STD_TAG" https://github.com/foundry-rs/forge-std "$HERE/lib/forge-std"
  rm -rf "$HERE/lib/forge-std/.git" "$HERE/lib/forge-std/.github"
fi

# --- OpenZeppelin Contracts (from node_modules) ---
OZ_SRC="$ROOT/node_modules/@openzeppelin/contracts"
if [ ! -d "$OZ_SRC" ]; then
  echo "✗ $OZ_SRC not found — run 'npm install' at the repo root first." >&2
  exit 1
fi
echo "→ vendoring OpenZeppelin Contracts $(node -p "require('$OZ_SRC/package.json').version")"
rm -rf "$HERE/lib/openzeppelin-contracts"
mkdir -p "$HERE/lib/openzeppelin-contracts"
cp -R "$OZ_SRC/." "$HERE/lib/openzeppelin-contracts/"

echo "✓ contracts/lib ready — run 'forge build' from contracts/"
