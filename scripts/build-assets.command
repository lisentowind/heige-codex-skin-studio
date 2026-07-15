#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/assets/miku-reference.png"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to rebuild the Miku crops." >&2
  exit 1
fi

verify_hash() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "SHA-256 mismatch for $file: $actual" >&2
    exit 1
  fi
}

verify_hash "$SOURCE" "f51a2754354a301d1fef129b6ca6d90726e99942c6130c8d55a8eafe24bd29b0"

ffmpeg -hide_banner -loglevel error -y -i "$SOURCE" \
  -vf "crop=1240:342:382:159,eq=saturation=1.35:contrast=1.05:brightness=0.01" \
  -frames:v 1 "$ROOT/assets/miku-hero.png"
ffmpeg -hide_banner -loglevel error -y -i "$SOURCE" \
  -vf "crop=608:375:840:128,eq=saturation=1.32:contrast=1.05:brightness=0.01" \
  -frames:v 1 "$ROOT/assets/miku-character.png"
ffmpeg -hide_banner -loglevel error -y -i "$SOURCE" \
  -vf "crop=98:644:236:170" -frames:v 1 "$ROOT/assets/miku-sidebar-wash.png"
ffmpeg -hide_banner -loglevel error -y -i "$SOURCE" \
  -vf "crop=228:230:1409:704" -frames:v 1 "$ROOT/assets/miku-polaroid.png"

verify_hash "$ROOT/assets/miku-hero.png" "ee1bf7a95b69441d7116df5ba308a2fa0a3b94966c1c9539add4756ed2f02405"
verify_hash "$ROOT/assets/miku-character.png" "0e549285b237c6eef148152b6fe6296a21f391eab5d2e1e51b24e19820e95114"
verify_hash "$ROOT/assets/miku-sidebar-wash.png" "f5be49bf2ac12919ee2cc8de377c4856c19f907d8e40c2fbe3ca4cc33e53833f"
verify_hash "$ROOT/assets/miku-polaroid.png" "dc90154c0f244ff4ff1cd3ec45c4190d8550d0d99bc85bc1ccf0d6f91c51d07f"

echo "Rebuilt and verified all four deterministic Miku crops."
