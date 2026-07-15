#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
node src/theme-patch.mjs restore
echo "原始主题已恢复。完全退出 Codex 后重新打开即可生效。"
