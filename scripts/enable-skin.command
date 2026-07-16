#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
THEME="${1:-}"
PORT="${HEIGE_CODEX_SKIN_PORT:-9341}"
if [[ -n "$THEME" ]]; then
  exec "$ROOT/scripts/lib/run-cli.zsh" enable-skin --theme "$THEME" --port "$PORT"
fi
exec "$ROOT/scripts/lib/run-cli.zsh" enable-skin --port "$PORT"
