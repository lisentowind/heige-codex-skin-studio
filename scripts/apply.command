#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
THEME="${1:-miku-488137}"
PORT="${HEIGE_CODEX_SKIN_PORT:-9341}"
exec "$ROOT/scripts/lib/run-cli.zsh" apply --theme "$THEME" --port "$PORT"
