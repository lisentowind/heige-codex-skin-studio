#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
THEME="${1:-}"
if [[ -n "$THEME" ]]; then
  exec "$ROOT/scripts/apply.command" "$THEME"
fi
exec "$ROOT/scripts/apply.command"
