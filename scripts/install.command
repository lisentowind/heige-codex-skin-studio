#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
node src/theme-patch.mjs check
node src/theme-patch.mjs install
"$PWD/scripts/install-pet.command"
echo "主题与 Miku Future 原生宠物已安装。重新打开 Codex 后即可生效。"
