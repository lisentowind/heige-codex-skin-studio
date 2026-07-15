# Codex Miku Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本机 Codex Desktop 安装可验证、可回滚、使用 4 张参考图裁片的初音未来 PIXEL MATCH v3 主题。

**Architecture:** 使用零依赖 Node.js 工具解析 ASAR，批量定长替换 `webview/index.html` 和 4 个低频 PNG 槽。全部预检后原子替换完整 ASAR，并保存原版、主题版与各素材 SHA-256。

**Tech Stack:** Node.js 22、node:test、CSS、macOS shell。

---

### Task 1：ASAR 定长替换核心

**Files:**

- Create: `src/asar.mjs`
- Create: `test/asar.test.mjs`

- [x] 先写测试，覆盖 ASAR 头解析、文件提取、单项与批量等长替换和长度不符拒绝。
- [x] 运行测试并确认红灯。
- [x] 实现 `readArchiveIndex`、`readEntry`、`replaceEntryFixedSize` 和 `replaceEntriesFixedSize`。
- [x] 再次运行测试，全部通过。

### Task 2：主题样式与容量约束

**Files:**

- Create: `src/theme.css`
- Create: `test/theme.test.mjs`

- [x] 先写 v3 色板、稳定选择器与 4 张裁图测试。
- [x] 运行测试并确认红灯。
- [x] 编写不依赖网络的主题 CSS，保留键盘焦点和代码可读性。
- [x] 运行主题测试，全部通过。

### Task 3：安装、验证与恢复

**Files:**

- Create: `src/theme-patch.mjs`
- Create: `scripts/install.command`
- Create: `scripts/restore.command`
- Create: `test/theme-patch.test.mjs`

- [x] 先写测试，覆盖样式区替换、资源填充、升级、幂等与容量拒绝。
- [x] 运行测试并确认红灯。
- [x] 实现多资源安装、检查、原子替换和完整哈希恢复。
- [x] 补同尺寸官方更新拒绝、状态落盘失败回滚、运行进程门禁、原子 CAS 竞态防护和 v2 旧状态安全恢复。
- [x] 增加 4 个真实 CLI 子进程集成测试，覆盖完整安装恢复往返与失败注入。
- [x] 运行全部测试，全部通过。
- [x] 对官方 ASAR 检查路径、容量与版本。

### Task 4：实际安装与视觉验收

**Files:**

- Modify: `/Applications/ChatGPT.app/Contents/Resources/app.asar`
- Create: `README.md`
- Create: `output/playwright/codex-miku-theme-preview-v3-final.png`
- Create: `assets/miku-crops.json`
- Create: `scripts/build-assets.command`

- [x] 执行安装并核对备份、哈希、文件长度、CSS 标记与 4 个图片槽。
- [x] 用固定坐标和滤镜重建 4 张裁图，并核对源图与目标图 SHA-256。
- [x] 检查 `codesign --verify --deep --strict /Applications/ChatGPT.app` 并记录真实结果。
- [x] 用隔离临时 HOME 冷启动真实 Codex，核对侧栏、Hero、卡片、输入框与拍立得。
- [x] 写清安装、恢复和官方更新后重装命令。
- [ ] 发送飞书完成通知，并发送实际项目压缩包和预览图。
