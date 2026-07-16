#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
NODE="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
THEME="${1:-miku-488137}"
PORT="${HEIGE_CODEX_SKIN_PORT:-9341}"
STATE="${HEIGE_CODEX_SKIN_STATE:-$HOME/.codex/heige-codex-skin-persist}"
LOCK="$STATE/lock"

# 与常驻看门狗互斥：抢同一把锁，避免两边同时退出重开 Codex 打断彼此。
# 最多等 ~20 秒，看门狗单轮拿锁时间远小于此；实在拿不到就放弃锁裸跑（不阻断用户手动换肤）
mkdir -p "$STATE" 2>/dev/null || true
got_lock=0
for _ in {1..40}; do
  if mkdir "$LOCK" 2>/dev/null; then got_lock=1; break; fi
  lock_mtime=$(stat -f%m "$LOCK" 2>/dev/null || echo 0)
  now_s=$(date +%s)
  [[ "$lock_mtime" == <-> ]] && (( now_s - lock_mtime > 180 )) && { rmdir "$LOCK" 2>/dev/null || true; }
  sleep 0.5
done
[[ "$got_lock" == 1 ]] && trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

source "$ROOT/scripts/lib/launch-codex.zsh" "$PORT"
"$NODE" "$ROOT/src/cli.mjs" apply --theme "$THEME" --port "$PORT"
echo "皮肤已应用：$THEME"
