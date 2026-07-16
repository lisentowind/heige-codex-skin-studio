#!/bin/zsh
set -euo pipefail

STATE="${HEIGE_CODEX_SKIN_STATE:-$HOME/.codex/heige-codex-skin-persist}"
LABEL="com.heige.codex-skin-watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$PLIST" "$STATE/theme"
echo "皮肤常驻已关闭：当前皮肤保留到本次 Codex 退出，之后不再自动恢复"
