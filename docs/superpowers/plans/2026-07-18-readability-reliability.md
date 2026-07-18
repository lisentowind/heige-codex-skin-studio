# 阅读增强可靠性与性能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让最终回复和过程回复都稳定获得轻量蒙版，同时修正边缘留白并降低滚动绘制成本。

**Architecture:** 保留现有 renderer 开关和持久化数据流，只修改生成的静态主题 CSS。把蒙版目标从最终回复外层迁移到两类回复共有的正文语义节点，不增加脚本、节点、监听器或观察器。

**Tech Stack:** Node.js 22、ES modules、`node:test`、CSS、Codex CDP 真实 renderer 验收。

---

### Task 1: 建立覆盖范围与性能回归测试

**Files:**
- Modify: `test/skin-css.test.mjs`
- Test: `test/skin-css.test.mjs`

- [ ] **Step 1: 写入失败测试**

在生成 CSS 的测试中要求：

```js
assert.match(
  css,
  /:root\[data-heige-readability="on"\]\s+\[data-response-annotation-conversation\]\s*\{[^}]*var\(--heige-surface\) 90%/s,
);
assert.doesNotMatch(
  css,
  /:root\[data-heige-readability="on"\]\s+\[data-local-conversation-final-assistant\]\s*\{/,
);
assert.match(css, /border-radius:\s*22px/);
assert.match(css, /padding:\s*14px 16px 12px/);
assert.match(css, /box-sizing:\s*border-box/);
assert.match(
  css,
  /\[data-response-annotation-conversation\][\s\S]*box-shadow:\s*none[\s\S]*backdrop-filter:\s*none/,
);
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test test/skin-css.test.mjs`

Expected: FAIL，原因是现有 CSS 仍以 `data-local-conversation-final-assistant` 为开启态目标，透明度为 86％，缺少正文节点蒙版和内边距。

### Task 2: 实现统一轻量蒙版

**Files:**
- Modify: `src/skin-css.mjs`
- Test: `test/skin-css.test.mjs`

- [ ] **Step 1: 实现最小 CSS 改动**

关闭态同时清理两个节点：

```css
[data-local-conversation-final-assistant],
[data-response-annotation-conversation] {
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}
```

开启态只绘制正文语义节点：

```css
:root[data-heige-readability="on"] [data-response-annotation-conversation] {
  box-sizing: border-box;
  color: var(--heige-text) !important;
  background: color-mix(in srgb, var(--heige-surface) 90%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--heige-accent) 18%, transparent) !important;
  border-radius: 22px;
  padding: 14px 16px 12px;
  box-shadow: none !important;
  backdrop-filter: none !important;
}
```

- [ ] **Step 2: 运行定向测试并确认通过**

Run: `node --test test/skin-css.test.mjs test/skin-menu.dom.test.mjs test/injector.test.mjs`

Expected: PASS，CSS、开关、持久化、同步和注入测试全部通过。

- [ ] **Step 3: 提交代码和测试**

```bash
git add src/skin-css.mjs test/skin-css.test.mjs
git commit -m "fix(css): cover every assistant response"
```

### Task 3: 更新文档、版本制品与确定性哈希

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/manual.md`
- Modify: `skill/heige-codex-skin-studio/SKILL.md`
- Modify: `skill/heige-codex-skin-studio/README.md`
- Modify: `llms-full.txt`
- Modify: `CHANGELOG.md`
- Modify: `output/heige-codex-skin-studio.skill`
- Modify: `docs/release/2026-07-16-audit-hardening-disposition.md`

- [ ] **Step 1: 修正文档中的选择器与性能说明**

文档明确说明阅读增强覆盖最终回复和过程回复，使用 90％主题底色、静态内边距，无高斯模糊、阴影、观察器或滚动监听器。

- [ ] **Step 2: 同步聚合文档**

Run: `node scripts/sync-llms.mjs`

Expected: `llms-full.txt` 与 README 和摘要一致。

- [ ] **Step 3: 重建确定性安装包并更新哈希**

Run:

```bash
HEIGE_ALLOW_TRACKED_PACKAGE_OUTPUT=1 node scripts/package-skill.mjs \
  --output /Users/blakexu/.codex/tmp/skin-studio-verification-20260718-1410/repo/output/heige-codex-skin-studio.skill \
  --source-date-epoch 1704067200
node scripts/update-release-hash.mjs \
  --artifact output/heige-codex-skin-studio.skill \
  --disposition docs/release/2026-07-16-audit-hardening-disposition.md
```

Expected: 安装包可复现，归档中的 `.command` 和 `.zsh` 入口均为 `0755`。

- [ ] **Step 4: 提交文档与制品**

```bash
git add README.md README.en.md docs/manual.md skill/heige-codex-skin-studio/SKILL.md \
  skill/heige-codex-skin-studio/README.md llms-full.txt CHANGELOG.md \
  output/heige-codex-skin-studio.skill \
  docs/release/2026-07-16-audit-hardening-disposition.md
git commit -m "docs: document reliable readability surfaces"
```

### Task 4: 完整验证与本机真实验收

**Files:**
- Verify: `output/heige-codex-skin-studio.skill`
- Verify: `$HOME/.codex/heige-codex-skin-studio`

- [ ] **Step 1: 运行全量测试**

Run: `npm test`

Expected: 退出码 0，失败数 0。

- [ ] **Step 2: 从新制品事务安装**

解压 `.skill` 到唯一临时目录，运行包内 `payload/scripts/install.command`。保留当前主题 `miku-488137`，安装后应用主题并恢复皮肤常驻。

- [ ] **Step 3: 用 CDP 检查真实回复节点**

统计最终回复与过程回复，要求所有 `data-response-annotation-conversation` 都具有非透明背景、22px 圆角、明确内边距、`box-shadow: none` 和 `backdrop-filter: none`。

- [ ] **Step 4: 验证关闭与重新开启**

点击阅读增强开关，要求所有回复正文变透明且保存 `"0"`；再次点击后全部恢复并保存 `"1"`。最终状态保持开启。

- [ ] **Step 5: 验证常驻与资源边界**

要求皮肤常驻开启、控制器进程健康、日志无新增错误。确认源码未新增 MutationObserver、滚动监听器、动画或定时刷新逻辑，并在真实长对话中滚动和输入检查无明显卡顿。

- [ ] **Step 6: 运行最终新鲜全量测试并检查工作树**

Run:

```bash
npm test
git diff --check
git status --short
```

Expected: 测试失败数 0，diff 检查通过，工作树只包含预期交付。
