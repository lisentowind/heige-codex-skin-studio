# Codex Miku Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本机 Codex Desktop 安装可验证、可回滚的冰蓝青绿粉紫主题。

**Architecture:** 使用零依赖 Node.js 工具解析 ASAR 头并提取或定长替换 `webview/index.html`。安装器仅替换既有内联样式区，保持 ASAR 总长度和所有后续资源偏移不变，并在修改前保存备份与校验信息。

**Tech Stack:** Node.js 22、node:test、CSS、macOS shell。

---

### Task 1：ASAR 定长替换核心

**Files:**

- Create: `src/asar.mjs`
- Create: `test/asar.test.mjs`

- [ ] 先写测试，覆盖 ASAR 头解析、文件提取、等长替换和长度不符拒绝。
- [ ] 运行 `node --test test/asar.test.mjs`，确认因模块缺失而失败。
- [ ] 实现 `readArchiveIndex`、`readEntry` 和 `replaceEntryFixedSize`。
- [ ] 再次运行测试，预期全部通过。

### Task 2：主题样式与容量约束

**Files:**

- Create: `src/theme.css`
- Create: `test/theme.test.mjs`

- [ ] 先写测试，要求主题包含青色、粉色、冰蓝色、关键 Codex 令牌、主面板和侧栏选择器，并禁止外部 URL。
- [ ] 运行 `node --test test/theme.test.mjs`，确认因主题文件缺失而失败。
- [ ] 编写不依赖网络和图片的主题 CSS，保留键盘焦点和代码可读性。
- [ ] 运行主题测试，预期全部通过。

### Task 3：安装、验证与恢复

**Files:**

- Create: `src/theme-patch.mjs`
- Create: `scripts/install.command`
- Create: `scripts/restore.command`
- Create: `test/theme-patch.test.mjs`

- [ ] 先写测试，覆盖样式区替换、空格填充、二次安装和容量不足拒绝。
- [ ] 运行 `node --test test/theme-patch.test.mjs`，确认失败原因是实现缺失。
- [ ] 实现 `buildPatchedHtml`、安装模式、检查模式和恢复模式。
- [ ] 运行全部测试，预期全部通过。
- [ ] 对官方 ASAR 运行只读检查，确认路径、容量和版本满足要求。

### Task 4：实际安装与视觉验收

**Files:**

- Modify: `/Applications/ChatGPT.app/Contents/Resources/app.asar`
- Create: `README.md`
- Create: `artifacts/codex-miku-theme-preview.png`

- [ ] 执行安装脚本并核对原始备份、哈希、文件长度和目标 CSS 标记。
- [ ] 检查 `codesign --verify --deep --strict /Applications/ChatGPT.app` 并记录真实结果。
- [ ] 在可用的独立实例或重启后截图，核对侧栏、主面板、输入框、按钮和代码区。
- [ ] 写清安装、恢复和官方更新后重装命令。
- [ ] 发送飞书完成通知，并发送实际项目压缩包和预览图。
