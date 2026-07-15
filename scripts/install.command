#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
node src/theme-patch.mjs check
node src/theme-patch.mjs install
echo "主题已安装。完全退出 Codex 后重新打开即可生效。"
