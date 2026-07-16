#!/bin/zsh
set -uo pipefail
# 注意：不用 set -e。看门狗要在单条命令失败时按逻辑分支处理（收敛/退避），
# 而不是整体崩掉，否则一次 apply 失败就中断整轮巡逻。

# 皮肤常驻看门狗：由 enable-persist.command 装进 launchd，每 15 秒跑一次。
# 端口在且皮肤掉了→补针；无端口实例→带端口重开一次（带冷却+失败收敛）；Codex 没运行→不动。
STUDIO="${0:A:h:h:h}"
NODE="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
PORT="${HEIGE_CODEX_SKIN_PORT:-9341}"
STATE="${HEIGE_CODEX_SKIN_STATE:-$HOME/.codex/heige-codex-skin-persist}"
THEME_FILE="$STATE/theme"
COOLDOWN_FILE="$STATE/last-restart"
FAILCOUNT_FILE="$STATE/restart-fails"
LOG="$STATE/watchdog.log"
LOCK="$STATE/lock"
MAX_RESTART_FAILS=3
COOLDOWN_SECS=600
LOG_MAX_BYTES=524288

log() { echo "$(date '+%F %T') $1" >> "$LOG" 2>/dev/null || true }

notify() {
  # 尽力而为的用户通知；失败不影响主流程
  osascript -e "display notification \"$1\" with title \"HeiGe Codex Skin\"" >/dev/null 2>&1 || true
}

# 日志轮转：超阈值只留尾部，故障态下也不会无限增长
if [[ -f "$LOG" ]]; then
  size=$(stat -f%z "$LOG" 2>/dev/null || echo 0)
  if [[ "$size" == <-> ]] && (( size > LOG_MAX_BYTES )); then
    tail -c 262144 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null || true
  fi
fi

# 常驻未开启（没有主题记录）就什么都不做
[[ -s "$THEME_FILE" ]] || exit 0
theme="$(<"$THEME_FILE")"

# 自带 Node 不在（Codex 未装或新版挪走了 cua_node）：静默退避，别每 15 秒炸
if [[ ! -x "$NODE" ]]; then
  log "Codex 自带 Node 不可用（$NODE），本轮跳过"
  exit 0
fi

# Codex 没在运行：不代用户开应用
pgrep -f '^/Applications/ChatGPT\.app/Contents/MacOS/ChatGPT' >/dev/null 2>&1 || exit 0

# 互斥锁：与手动 apply.command 及并发看门狗互斥，避免双方同时退出重开 Codex。
# mkdir 原子；锁超过 180 秒视为死锁并抢占（apply 最长约 70 秒，留足余量）
if ! mkdir "$LOCK" 2>/dev/null; then
  lock_age=999
  lock_mtime=$(stat -f%m "$LOCK" 2>/dev/null || echo 0)
  now_s=$(date +%s)
  [[ "$lock_mtime" == <-> ]] && lock_age=$(( now_s - lock_mtime ))
  if (( lock_age < 180 )); then
    exit 0
  fi
  rmdir "$LOCK" 2>/dev/null || true
  mkdir "$LOCK" 2>/dev/null || exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

if curl --silent --fail --max-time 1 "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1; then
  # 端口在：任一主窗口掉了皮肤（界面重载）就补针。多窗口时只要有一个 installed:false 也补。
  status_json="$("$NODE" "$STUDIO/src/cli.mjs" status --port "$PORT" 2>/dev/null)"
  if ! print -r -- "$status_json" | grep -q '"installed": true' \
     || print -r -- "$status_json" | grep -q '"installed": false'; then
    if "$NODE" "$STUDIO/src/cli.mjs" apply --theme "$theme" --port "$PORT" --prefer-stored >/dev/null 2>>"$LOG"; then
      log "界面重载，已补注入 $theme"
    else
      log "补注入失败（本轮跳过，下轮重试）"
    fi
  fi
  exit 0
fi

# 端口不在：普通方式启动的 Codex。带调试端口重开一次再上皮肤。
# 冷却限频 + 失败收敛：连续 MAX_RESTART_FAILS 次重开后端口仍不来，自动摘除常驻并通知，
# 杜绝「每 10 分钟无限次强制重启用户 Codex」。
now=$(date +%s)
last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
[[ "$last" == <-> ]] || last=0          # 非数字/损坏→按 0 处理，不永久卡死
(( last > now )) && last=0              # 时钟回拨→重置，别把未来当冷却
(( now - last >= COOLDOWN_SECS )) || exit 0
echo "$now" > "$COOLDOWN_FILE"

log "检测到无端口实例，带调试端口重开并应用 $theme"
restart_ok=0
if source "$STUDIO/scripts/lib/launch-codex.zsh" "$PORT" \
   && "$NODE" "$STUDIO/src/cli.mjs" apply --theme "$theme" --port "$PORT" --prefer-stored >/dev/null 2>>"$LOG"; then
  restart_ok=1
fi
set +e   # launch-codex.zsh 的 set -e 会污染本 shell，source 后必须复位，否则后续失败分支会被 errexit 打断

if (( restart_ok )); then
  echo 0 > "$FAILCOUNT_FILE"
  log "重开完成，皮肤已恢复"
  exit 0
fi

# 本次重开失败：累计，达阈值即自禁
fails=$(cat "$FAILCOUNT_FILE" 2>/dev/null || echo 0)
[[ "$fails" == <-> ]] || fails=0
fails=$(( fails + 1 ))
echo "$fails" > "$FAILCOUNT_FILE"
log "重开后端口仍未就绪（第 $fails/$MAX_RESTART_FAILS 次）"
if (( fails >= MAX_RESTART_FAILS )); then
  rm -f "$THEME_FILE"     # 摘除常驻：不再重启用户 Codex
  log "连续 $fails 次失败，已自动关闭皮肤常驻。诊断请跑：node $STUDIO/src/cli.mjs doctor"
  notify "皮肤常驻已自动关闭：当前 Codex 版本可能禁用了本机调试端口。跑 doctor 排查，或重新 enable-persist。"
fi
