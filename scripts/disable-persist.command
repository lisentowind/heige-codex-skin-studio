#!/bin/zsh
set -euo pipefail

STATE="${HEIGE_CODEX_SKIN_STATE:-$HOME/.codex/heige-codex-skin-persist}"
LABEL="com.heige.codex-skin-watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# 先删主题记录：即便有看门狗实例正跑到一半，它读不到主题也会立即收手，不再重启 Codex
rm -f "$STATE/theme"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true

# 等正在运行的看门狗实例退出，避免「已杀未拉」窗口期把 Codex 关了没人重开
for _ in {1..20}; do
  pgrep -f "skin-watchdog.zsh" >/dev/null 2>&1 || break
  sleep 0.5
done

rm -f "$PLIST" "$STATE/restart-fails" "$STATE/last-restart"
rmdir "$STATE/lock" 2>/dev/null || true
echo "皮肤常驻已关闭：当前皮肤保留到本次 Codex 退出，之后不再自动恢复。"
