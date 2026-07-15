# Codex Miku PIXEL MATCH v3 设计

## 目标

把本机 Codex Desktop 改造成参考图所示的天蓝、雾白、粉紫高密度主题，同时保留任务、登录态、插件、终端、浏览器与更新能力。

## 视觉基准

v3 不再用抽象的「初音配色」代替参考图，而是以用户图片的实测像素为真相源：全局底色 `#F5F6FC`，侧栏 `#DBF4FC`，青色 `#19C9E5`，浅蓝 `#90B3FA`，粉色 `#ED6EC1`，紫色 `#AD7ED5`，主文字 `#122C60`。

参考图被确定性裁成 4 张素材：

1. Hero：`1240 × 342`。
2. 角色：`608 × 375`。
3. 侧栏纹理：`98 × 644`。
4. 拍立得：`228 × 230`。

Hero 与角色图会预增少量饱和度和对比度，用来补偿 Codex 多层玻璃面板造成的色度损失。侧栏与卡片使用青白双层边框、22px 左右圆角和轻量青粉阴影。

`assets/miku-crops.json` 固定记录源图 SHA-256、裁剪坐标、滤镜和目标图 SHA-256，`scripts/build-assets.command` 可从参考图确定性重建并逐张验哈希。

## 选择器与 token

稳定根节点为 `:root[data-codex-window-type="electron"]`。主题完整覆盖 Codex 的背景、控制面板、按钮、文字、图标、边框、VS Code 兼容变量与关键 `--color-token-*` 变量。

精准组件选择器包括 `.app-shell-left-panel`、`.main-surface`、`.app-header-tint`、`.composer-surface-chrome`、`[data-app-action-sidebar-thread-active="true"]`、`[data-user-message-bubble]` 和 `[data-local-conversation-final-assistant]`。

## 安装方案

安装器锁定 Codex Desktop `26.707.72221（5307）`。安装与恢复的硬前提是 Codex 完全退出，应用包内任一主进程、渲染器、更新辅助进程或工具进程仍在都会被门禁拒绝。满足门禁后，安装器解析 `/Applications/ChatGPT.app/Contents/Resources/app.asar`，把压缩后的主题 CSS 等长写入 `webview/index.html`，并把 4 张裁图填充到 4 个低频 PNG 槽。所有路径、容量和替换内容先在内存中完成预检，再通过同目录临时文件原子替换正式 ASAR。

状态文件记录原版和主题版完整 SHA-256、每张素材的原始哈希与填充后哈希。正式文件通过 macOS `renamex_np（RENAME_SWAP）` 原子交换，交换后核对被换出的旧 ASAR；不匹配会撤销交换。状态文件写入失败也会自动回滚本次替换。运行进程门禁负责排除官方更新器与安装事务并发，原子交换与哈希负责检测其余意外变化。恢复时只有当前 ASAR 完整哈希等于已安装主题哈希才允许写回原版备份，避免用旧备份覆盖同长度的新版本。v2 旧状态通过目标入口、旧图片和未修改区间的逐字节验证后也可安全恢复。

## 验收标准

1. 主题 CSS 小于 `8003` 字节容量。
2. 安装前后 ASAR 文件大小和资源偏移不变。
3. 只修改 `webview/index.html` 与约定的 4 个 PNG 槽。
4. 全部自动测试通过，包含真实 CLI 子进程往返与失败注入，4 个内嵌 PNG 可被 macOS 解码。
5. 隔离临时 HOME 冷启动真实 Codex 并截图验证。
6. 如实记录资源修改导致的官方签名失效边界。

## 风险与回滚

官方更新会覆盖主题，资源修改会让 `codesign --verify` 报告 `app.asar` 已变化。原始 ASAR 保存在用户应用支持目录，恢复脚本无需重新下载 Codex。安装器拒绝未适配的 Codex 构建；若安装后检测到外部修改或官方更新，恢复器也会拒绝覆盖。
