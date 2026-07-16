#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
STATE="${HEIGE_CODEX_SKIN_STATE:-$HOME/.codex/heige-codex-skin-persist}"
PORT="${HEIGE_CODEX_SKIN_PORT:-9341}"
LABEL="com.heige.codex-skin-watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
THEME="${1:-miku-488137}"

# 优先用稳定安装位（~/.codex/...）承载看门狗脚本。仓库目录容易被移动/重命名，
# plist 指向仓库路径的话，目录一动看门狗就每 15 秒找不到脚本刷错。
INSTALL_ROOT="$HOME/.codex/heige-codex-skin-studio"
if [[ -f "$INSTALL_ROOT/scripts/lib/skin-watchdog.zsh" ]]; then
  STUDIO="$INSTALL_ROOT"
else
  STUDIO="$ROOT"
  echo "提示：未检测到已安装副本，看门狗将指向当前仓库目录。" >&2
  echo "      移动或重命名该目录会导致常驻失效，建议先运行 install.command。" >&2
fi
WATCHDOG="$STUDIO/scripts/lib/skin-watchdog.zsh"
test -s "$WATCHDOG"

# 校验主题存在再写记录：打错主题名会让看门狗白白重启一次 Codex 又永久失败
if [[ ! -x "$NODE" ]]; then
  echo "错误：未找到 Codex 自带 Node（$NODE），请先安装 Codex Desktop。" >&2
  exit 1
fi
if ! "$NODE" "$STUDIO/src/cli.mjs" list 2>/dev/null | grep -q "\"id\": \"$THEME\""; then
  echo "错误：主题「$THEME」不存在。可用主题：" >&2
  "$NODE" "$STUDIO/src/cli.mjs" list 2>/dev/null | grep '"id"' | sed 's/.*: /  /;s/[",]//g' >&2
  exit 1
fi

mkdir -p "$STATE" "$HOME/Library/LaunchAgents"
print -r -- "$THEME" > "$STATE/theme"
rm -f "$STATE/restart-fails" "$STATE/last-restart"   # 重新开启即清零失败计数与冷却

# XML 实体转义：路径含 & < > 时原样内插会写出非法 plist，bootstrap 报错装不上
xml_escape() { print -r -- "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' }
WATCHDOG_X="$(xml_escape "$WATCHDOG")"
STATE_X="$(xml_escape "$STATE")"
LOG_X="$(xml_escape "$STATE/watchdog.log")"

# 只用 StartInterval 轮询、不用 KeepAlive：脚本每次自然退出，KeepAlive 会把退出当故障无限重拉。
# AbandonProcessGroup：兜底通道用 nohup 直启的 Codex 在看门狗进程组里，
#   不设此键 launchd 会在 job 退出时杀掉整个进程组，把刚拉起的 Codex 一并杀掉。
# EnvironmentVariables：把当次生效的 PORT/STATE 烙进 plist，否则 launchd 里只见默认值，
#   自定义端口的用户会被误判「无端口实例」而错杀健康实例。
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>$WATCHDOG_X</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HEIGE_CODEX_SKIN_PORT</key><string>$PORT</string>
        <key>HEIGE_CODEX_SKIN_STATE</key><string>$STATE_X</string>
    </dict>
    <key>StartInterval</key><integer>15</integer>
    <key>RunAtLoad</key><true/>
    <key>AbandonProcessGroup</key><true/>
    <key>StandardOutPath</key><string>$LOG_X</string>
    <key>StandardErrorPath</key><string>$LOG_X</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
echo "皮肤常驻已开启：主题 $THEME，每 15 秒自愈。"
echo "注意：开启后以普通方式启动的 Codex 会被自动带调试端口重开一次。关闭请运行 disable-persist.command。"
