#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
STATE="${HEIGE_CODEX_SKIN_STATE:-$HOME/.codex/heige-codex-skin-persist}"
LABEL="com.heige.codex-skin-watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
WATCHDOG="$ROOT/scripts/lib/skin-watchdog.zsh"
THEME="${1:-miku-488137}"

test -s "$WATCHDOG"
mkdir -p "$STATE" "$HOME/Library/LaunchAgents"
print -r -- "$THEME" > "$STATE/theme"

# 只用 StartInterval 轮询、不用 KeepAlive：脚本每次自然退出，
# KeepAlive 会把退出当故障无限重拉，正是要避免的无限重启陷阱
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>$WATCHDOG</string>
    </array>
    <key>StartInterval</key><integer>15</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$STATE/watchdog.log</string>
    <key>StandardErrorPath</key><string>$STATE/watchdog.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "皮肤常驻已开启：主题 $THEME，每 15 秒自愈。关闭请运行 disable-persist.command"
