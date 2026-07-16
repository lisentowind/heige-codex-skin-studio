#!/bin/zsh
set -euo pipefail

# 皮肤常驻看门狗：由 enable-persist.command 装进 launchd，每 15 秒跑一次。
# 只做三件事：皮肤掉了补注入、无端口实例带端口重开一次、Codex 没运行就不动。
STUDIO="${0:A:h:h:h}"
NODE="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
PORT="${HEIGE_CODEX_SKIN_PORT:-9341}"
STATE="${HEIGE_CODEX_SKIN_STATE:-$HOME/.codex/heige-codex-skin-persist}"
THEME_FILE="$STATE/theme"
COOLDOWN_FILE="$STATE/last-restart"

# 常驻未开启（没有主题记录）就什么都不做
[[ -s "$THEME_FILE" ]] || exit 0
theme="$(<"$THEME_FILE")"

# Codex 没在运行：不代用户开应用
pgrep -f '^/Applications/ChatGPT\.app/Contents/MacOS/ChatGPT' >/dev/null 2>&1 || exit 0

if curl --silent --fail --max-time 1 "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1; then
  # 端口在：只有皮肤掉了（界面重载）才补一针
  if ! "$NODE" "$STUDIO/src/cli.mjs" status --port "$PORT" 2>/dev/null | grep -q '"installed": true'; then
    "$NODE" "$STUDIO/src/cli.mjs" apply --theme "$theme" --port "$PORT" >/dev/null
    echo "$(date '+%F %T') 界面重载，已补注入 $theme"
  fi
  exit 0
fi

# 端口不在：这是普通方式启动的 Codex，带调试端口重开一次再上皮肤。
# 冷却 10 分钟：若重启后端口仍起不来，绝不反复尝试，杜绝无限重启
now=$(date +%s)
last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
(( now - last >= 600 )) || exit 0
echo "$now" > "$COOLDOWN_FILE"
echo "$(date '+%F %T') 检测到无端口实例，带调试端口重开并应用 $theme"
source "$STUDIO/scripts/lib/launch-codex.zsh" "$PORT"
"$NODE" "$STUDIO/src/cli.mjs" apply --theme "$theme" --port "$PORT" >/dev/null
echo "$(date '+%F %T') 重开完成，皮肤已恢复"
