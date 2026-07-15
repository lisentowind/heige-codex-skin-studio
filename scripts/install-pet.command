#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
SOURCE="$ROOT/custom-pet/miku-future"
TARGET="$HOME/.codex/pets/miku-future"

test -s "$SOURCE/pet.json"
test -s "$SOURCE/spritesheet.webp"
mkdir -p "$TARGET"
cp "$SOURCE/pet.json" "$TARGET/pet.json"
cp "$SOURCE/spritesheet.webp" "$TARGET/spritesheet.webp"

echo "Miku Future 已安装到 $TARGET"
