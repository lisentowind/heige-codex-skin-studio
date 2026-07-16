#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
NODE="${HEIGE_NODE:-/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node}"
[[ -x "$NODE" ]] || NODE="$(command -v node || true)"
[[ -n "$NODE" && -x "$NODE" ]] || { print -u2 "找不到可用的 Node.js"; exit 127; }

exec "$NODE" "$ROOT/src/cli.mjs" install-pet --source "$ROOT/custom-pet/miku-future"
