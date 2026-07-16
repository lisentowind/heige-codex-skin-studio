#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
PORT="${HEIGE_CODEX_SKIN_PORT:-9341}"

if (( $# > 1 )); then
  print -u2 -- "用法：apply.command [theme-id]"
  exit 64
fi
if (( $# == 1 )); then
  exec "$ROOT/scripts/lib/run-cli.zsh" apply --theme "$1" --port "$PORT"
fi
exec "$ROOT/scripts/lib/run-cli.zsh" apply --prefer-stored --port "$PORT"
