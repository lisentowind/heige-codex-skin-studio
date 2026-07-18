# 阅读增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加默认开启、可关闭且不会扩大长对话重绘成本的阅读增强，并修复发布包可执行 `.zsh` 权限。

**Architecture:** 阅读增强使用根节点数据属性驱动现有 CSS，不新增消息 DOM、后台接口或状态迁移。用户偏好保存在 renderer localStorage，并复用现有 BroadcastChannel 同步。发布包权限由确定性的扩展名规则修复。

**Tech Stack:** JavaScript ESM、CSS `color-mix`、happy-dom、Node.js test runner、yazl、CDP 实机计算样式检查。

---

### Task 1：修复发布包的 `.zsh` 可执行权限

**Files:**

- Modify: `test/skill-package.test.mjs`
- Modify: `scripts/package-skill.mjs`

- [ ] **Step 1: 写失败测试**

将归档模式断言改为 `.command` 和 `.zsh` 必须是 `0755`，其他文件为 `0644`，并显式断言：

```js
const executableArchiveEntry = (name) => /\.(?:command|zsh)$/.test(name);
assert.equal(
  entry.mode,
  executableArchiveEntry(entry.name) ? 0o755 : 0o644,
  `fixed mode: ${entry.name}`,
);
assert.equal(
  entries.find(({ name }) => name.endsWith("/payload/scripts/lib/run-cli.zsh"))?.mode,
  0o755,
);
```

- [ ] **Step 2: 验证测试因现有错误规则失败**

Run: `node --test test/skill-package.test.mjs`

Expected: FAIL，`payload/scripts/lib/run-cli.zsh` 实际为 `0644`。

- [ ] **Step 3: 实现最小修复**

在 `scripts/package-skill.mjs` 增加：

```js
function archiveMode(destination) {
  return /\.(?:command|zsh)$/.test(destination) ? 0o100755 : 0o100644;
}
```

`zip.addBuffer` 使用 `mode: archiveMode(file.destination)`。

- [ ] **Step 4: 验证打包测试**

Run: `node --test test/skill-package.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/package-skill.mjs test/skill-package.test.mjs
git commit -m "fix(package): preserve executable zsh entrypoints"
```

### Task 2：增加轻量阅读增强 CSS

**Files:**

- Modify: `test/skin-css.test.mjs`
- Modify: `src/skin-css.mjs`

- [ ] **Step 1: 写失败 CSS 合同**

在 `test/skin-css.test.mjs` 断言默认透明规则保留，并增加：

```js
assert.match(
  css,
  /:root\[data-heige-readability="on"\]\s+\[data-local-conversation-final-assistant\][\s\S]*var\(--heige-surface\) 86%/,
);
assert.doesNotMatch(
  css,
  /:root\[data-heige-readability="on"\][^{]*\{[^}]*backdrop-filter:\s*blur/s,
);
```

- [ ] **Step 2: 验证测试失败**

Run: `node --test test/skin-css.test.mjs`

Expected: FAIL，因为不存在阅读增强选择器。

- [ ] **Step 3: 写最小样式**

在 `src/skin-css.mjs` 的透明 AI 回复规则后增加规格中的 `data-heige-readability="on"` 规则。保持 `backdrop-filter: none !important`，不增加 padding。

- [ ] **Step 4: 验证 CSS 测试**

Run: `node --test test/skin-css.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/skin-css.mjs test/skin-css.test.mjs
git commit -m "feat(css): add lightweight readability surface"
```

### Task 3：增加默认开启的阅读增强开关

**Files:**

- Modify: `test/helpers/menu-window.mjs`
- Modify: `test/skin-menu.dom.test.mjs`
- Modify: `test/skin-menu.test.mjs`
- Modify: `src/skin-menu.mjs`
- Modify: `src/theme-center-style.mjs`

- [ ] **Step 1: 写默认值和切换失败测试**

在菜单测试 helper 暴露 `readabilitySwitch`、`readabilityEnabled` 和 `toggleReadability()`。增加测试：

```js
assert.equal(page.readabilitySwitch.getAttribute("aria-checked"), "true");
assert.equal(page.readabilityEnabled, true);
assert.equal(page.window.localStorage.getItem("heigeCodexReadabilityEnabled"), null);

await page.toggleReadability();
assert.equal(page.readabilitySwitch.getAttribute("aria-checked"), "false");
assert.equal(page.readabilityEnabled, false);
assert.equal(page.window.localStorage.getItem("heigeCodexReadabilityEnabled"), "0");
```

另建 `initialStorage: { heigeCodexReadabilityEnabled: "0" }` 页面，断言重新注入后保持关闭。

- [ ] **Step 2: 验证测试失败**

Run: `node --test test/skin-menu.dom.test.mjs test/skin-menu.test.mjs`

Expected: FAIL，因为开关和数据属性尚不存在。

- [ ] **Step 3: 实现本地偏好和无障碍开关**

在 `src/skin-menu.mjs` 使用固定键：

```js
const readabilityKey = "heigeCodexReadabilityEnabled";
const readReadability = () => {
  try { return localStorage.getItem(readabilityKey) !== "0"; } catch { return true; }
};
```

`setReadability(value, persist, broadcast)` 只接受布尔值，设置 `document.documentElement.dataset.heigeReadability` 为 `"on"` 或 `"off"`，需要持久化时写入 `"1"` 或 `"0"`。

主题中心 footer 增加 `data-heige-role="readability-switch"` 的原生 button switch，使用 `aria-checked`、`aria-labelledby` 和 `aria-describedby`。点击、Enter 和 Space 调用同一个切换函数。

在 `src/theme-center-style.mjs` 只增加 footer 双列布局和开关区块所需的静态样式，不引入动画。

- [ ] **Step 4: 验证菜单测试**

Run: `node --test test/skin-menu.dom.test.mjs test/skin-menu.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/skin-menu.mjs src/theme-center-style.mjs test/helpers/menu-window.mjs test/skin-menu.dom.test.mjs test/skin-menu.test.mjs
git commit -m "feat(menu): add persistent readability switch"
```

### Task 4：同步多 renderer 并清理 generation

**Files:**

- Modify: `test/skin-menu.dom.test.mjs`
- Modify: `src/skin-menu.mjs`

- [ ] **Step 1: 写广播和清理失败测试**

复用 `SharedBroadcastChannel` 创建两个页面。左侧关闭阅读增强后断言右侧同步关闭，广播中只有一条 `kind: "readability"`，右侧不回声。调用 runtime `dispose()` 后断言当前 generation 设置的 `data-heige-readability` 被移除。

- [ ] **Step 2: 验证测试失败**

Run: `node --test test/skin-menu.dom.test.mjs`

Expected: FAIL，因为广播白名单和清理逻辑尚不支持 readability。

- [ ] **Step 3: 实现严格同步**

将广播允许类型扩展为：

```js
["theme", "menu-hidden", "persistence", "readability"]
```

`readability` 的值必须是布尔值。接收后调用 `setReadability(message.value, true, false)`。storage 事件仅接受 `"0"`、`"1"` 或 `null`，其中 `null` 恢复默认开启。

runtime dispose 仅在当前 generation 仍拥有属性时清理 `data-heige-readability`。

- [ ] **Step 4: 验证菜单同步测试**

Run: `node --test test/skin-menu.dom.test.mjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/skin-menu.mjs test/skin-menu.dom.test.mjs
git commit -m "feat(menu): synchronize readability preference"
```

### Task 5：文档、打包和真实运行验收

**Files:**

- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/manual.md`
- Modify: `skill/heige-codex-skin-studio/SKILL.md`
- Modify: `skill/heige-codex-skin-studio/README.md`

- [ ] **Step 1: 更新用户文档**

说明阅读增强默认开启、可在主题中心关闭、使用主题自适应底色且不启用大面积模糊。同步中英文 README、手册和安装技能。

- [ ] **Step 2: 运行针对性回归**

Run:

```bash
node --test test/skill-package.test.mjs test/skin-css.test.mjs test/skin-menu.test.mjs test/skin-menu.dom.test.mjs test/injector.test.mjs
```

Expected: PASS。

- [ ] **Step 3: 运行全量测试**

Run: `npm test`

Expected: 0 failures。平台和危险操作门禁允许保持现有 skip。

- [ ] **Step 4: 重建候选包并检查权限**

Run:

```bash
node scripts/package-skill.mjs --output "/tmp/heige-readability.skill" --source-date-epoch 1704067200
zipinfo -l "/tmp/heige-readability.skill"
```

Expected: `payload/scripts/lib/run-cli.zsh` 和所有 `.command`、`.zsh` 为 `0755`。

- [ ] **Step 5: 从候选包事务式安装**

解压到唯一临时目录，运行：

```bash
HEIGE_SKIP_APPLY=1 ./scripts/install.command
```

Expected: 安装事务提交，稳定目录版本与候选源码一致。

- [ ] **Step 6: 应用当前主题并检查计算样式**

运行稳定目录 `apply.command`，通过 CDP 检查：

1. 默认开启时根节点为 `data-heige-readability="on"`。
2. AI 回复区背景非透明。
3. AI 回复区 `backdropFilter` 为 `none`。
4. 关闭开关后背景透明。
5. 切换操作不产生控制器请求。

- [ ] **Step 7: 最终提交**

```bash
git add README.md README.en.md docs/manual.md skill/heige-codex-skin-studio/SKILL.md skill/heige-codex-skin-studio/README.md
git commit -m "docs: explain readability enhancement"
```

