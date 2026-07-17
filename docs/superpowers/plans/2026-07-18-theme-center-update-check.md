# Theme Center Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 HeiGe 主题中心显示当前版本，按需检查 GitHub 最新正式 Release，并在发现新版时复制一段可交给 Codex 执行的更新指令。

**Architecture:** 新增独立 `update-check.mjs` 处理包版本、SemVer、GitHub 请求和 60 秒内存缓存。renderer 通过现有 `controlRequest` 排队 `check-update`，控制器调用检查器后通过 CDP 定向回调当前 generation；菜单只负责状态显示和剪贴板，不进入主题状态事务。

**Tech Stack:** Node.js 22+ ESM、内置 `fetch` 与 `AbortController`、Chrome DevTools Protocol、DOM API、`node:test`、happy-dom。

---

## 文件结构

- Create: `src/update-check.mjs`，负责版本读取、SemVer 比较、GitHub Release 校验和缓存。
- Create: `test/update-check.test.mjs`，覆盖版本与网络安全边界。
- Modify: `src/skin-menu.mjs`，增加版本栏、检查请求、结果回调和复制更新指令。
- Modify: `src/theme-center-style.mjs`，增加紧凑版本栏的响应式样式。
- Modify: `src/injector.mjs`，把当前版本注入菜单，并增加 CDP 结果投递函数。
- Modify: `src/controller.mjs`，识别并处理 `check-update` 临时请求。
- Modify: `src/cli.mjs`，把检查器和结果投递函数接入生产控制器。
- Modify: `scripts/skill-package-manifest.json`，将新模块纳入安装包。
- Modify: `test/skin-menu.dom.test.mjs`、`test/injector.test.mjs`、`test/controller.test.mjs`、`test/skill-package.test.mjs`，覆盖端到端协议。
- Modify: `test/helpers/menu-window.mjs`，暴露版本栏测试助手。
- Modify: `README.md`、`llms-full.txt`，说明版本检查不会自动联网或自行安装。

### Task 1: 版本与 GitHub Release 检查模块

**Files:**
- Create: `src/update-check.mjs`
- Create: `test/update-check.test.mjs`

- [ ] **Step 1: 写失败测试，锁定版本格式和比较规则**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  compareStableVersions,
  parseStableVersion,
  readCurrentPackageVersion,
} from "../src/update-check.mjs";

test("parses only canonical stable three-part versions", () => {
  assert.deepEqual(parseStableVersion("5.2.2"), [5, 2, 2]);
  for (const value of ["v5.2.2", "5.2", "05.2.2", "5.2.2-beta.1", "5.2.2.0"]) {
    assert.throws(() => parseStableVersion(value), /stable version/i);
  }
});

test("compares stable versions numerically", () => {
  assert.equal(compareStableVersions("5.2.2", "5.2.2"), 0);
  assert.equal(compareStableVersions("5.2.2", "5.3.0"), -1);
  assert.equal(compareStableVersions("6.0.0", "5.9.9"), 1);
});

test("reads the installed package version from strict JSON", async () => {
  assert.equal(await readCurrentPackageVersion({
    readFileImpl: async () => JSON.stringify({ name: "heige-codex-skin-studio", version: "5.2.2" }),
  }), "5.2.2");
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run:

```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test test/update-check.test.mjs
```

Expected: FAIL，提示 `src/update-check.mjs` 不存在。

- [ ] **Step 3: 实现严格版本解析与包版本读取**

```js
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PACKAGE_URL = new URL("../package.json", import.meta.url);

export function parseStableVersion(value) {
  const match = STABLE_VERSION.exec(value);
  if (!match) throw new Error("stable version must be canonical X.Y.Z");
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error("stable version component exceeds safe integer range");
  }
  return parts;
}

export function compareStableVersions(left, right) {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export async function readCurrentPackageVersion({
  readFileImpl = (await import("node:fs/promises")).readFile,
  packageUrl = PACKAGE_URL,
} = {}) {
  const text = await readFileImpl(packageUrl, "utf8");
  if (Buffer.byteLength(text) > 64 * 1024) throw new Error("package metadata is too large");
  const value = JSON.parse(text);
  if (value?.name !== "heige-codex-skin-studio") throw new Error("unexpected package identity");
  parseStableVersion(value.version);
  return value.version;
}
```

- [ ] **Step 4: 写失败测试，覆盖 GitHub 正常响应与全部失败边界**

```js
import { checkLatestRelease, createCachedUpdateChecker } from "../src/update-check.mjs";

test("accepts only the latest stable release for the exact repository", async () => {
  const result = await checkLatestRelease({
    currentVersion: "5.2.2",
    fetchImpl: async () => new Response(JSON.stringify({
      tag_name: "v5.3.0",
      html_url: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.3.0",
      draft: false,
      prerelease: false,
    }), { status: 200 }),
  });
  assert.deepEqual(result, {
    status: "update-available",
    currentVersion: "5.2.2",
    latestVersion: "5.3.0",
    releaseUrl: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.3.0",
  });
});

test("rejects prereleases redirects oversized bodies and foreign URLs", async () => {
  const cases = [
    {
      tag_name: "v5.3.0",
      html_url: "https://github.com/HeiGeAi/other/releases/tag/v5.3.0",
      draft: false,
      prerelease: false,
    },
    {
      tag_name: "v5.3.0-beta.1",
      html_url: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.3.0-beta.1",
      draft: false,
      prerelease: true,
    },
  ];
  for (const release of cases) {
    await assert.rejects(
      checkLatestRelease({
        currentVersion: "5.2.2",
        fetchImpl: async (_url, options) => {
          assert.equal(options.redirect, "error");
          return new Response(JSON.stringify(release), { status: 200 });
        },
      }),
      /update check failed/i,
    );
  }
  await assert.rejects(
    checkLatestRelease({
      currentVersion: "5.2.2",
      fetchImpl: async () => new Response("x".repeat(32 * 1024 + 1)),
    }),
    /update check failed/i,
  );
});

test("cached checker reuses one success for sixty seconds", async () => {
  let calls = 0;
  const check = createCachedUpdateChecker({
    currentVersion: "5.2.2",
    now: () => 1_000,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        tag_name: "v5.2.2",
        html_url: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.2.2",
        draft: false,
        prerelease: false,
      }));
    },
  });
  await check();
  await check();
  assert.equal(calls, 1);
});
```

- [ ] **Step 5: 实现受限 GitHub 请求和缓存**

实现要求：

```js
const RELEASE_API = "https://api.github.com/repos/HeiGeAi/heige-codex-skin-studio/releases/latest";
const RELEASE_PAGE = /^https:\/\/github\.com\/HeiGeAi\/heige-codex-skin-studio\/releases\/tag\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_RESPONSE_BYTES = 32 * 1024;

export async function checkLatestRelease({
  currentVersion,
  fetchImpl = globalThis.fetch,
  timeoutMs = 3_000,
} = {}) {
  parseStableVersion(currentVersion);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "heige-codex-skin-studio",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("update check failed");
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("update check failed");
    const release = JSON.parse(text);
    if (release.draft !== false || release.prerelease !== false) throw new Error("update check failed");
    const tag = /^v(.+)$/.exec(release.tag_name);
    if (!tag || !RELEASE_PAGE.test(release.html_url)) throw new Error("update check failed");
    const latestVersion = tag[1];
    parseStableVersion(latestVersion);
    const status = compareStableVersions(currentVersion, latestVersion) < 0
      ? "update-available"
      : "latest";
    return { status, currentVersion, latestVersion, releaseUrl: release.html_url };
  } catch (error) {
    throw new Error("update check failed", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
```

`createCachedUpdateChecker` 只缓存成功结果 60 秒，并用一个 in-flight Promise 合并同时请求；失败不缓存。

- [ ] **Step 6: 运行模块测试**

Run:

```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test test/update-check.test.mjs
```

Expected: PASS。

- [ ] **Step 7: 提交独立模块**

```bash
git add src/update-check.mjs test/update-check.test.mjs
git commit -m "feat(update): add bounded GitHub release checker"
```

### Task 2: 主题中心版本栏、检查请求和剪贴板

**Files:**
- Modify: `src/skin-menu.mjs`
- Modify: `src/theme-center-style.mjs`
- Modify: `test/helpers/menu-window.mjs`
- Modify: `test/skin-menu.dom.test.mjs`

- [ ] **Step 1: 写失败 DOM 测试**

测试必须断言：

```js
assert.equal(page.versionText.textContent, "当前版本 v5.2.2");
assert.equal(page.updateButton.textContent, "检查更新");
assert.equal(page.runtime.status().controlRequest, null);

page.updateButton.click();
assert.equal(page.runtime.status().controlRequest.action, "check-update");
assert.equal(page.runtime.status().controlRequest.generation, page.runtime.generation);
assert.equal(page.updateButton.disabled, true);

page.runtime.receiveUpdateCheckResult({
  schemaVersion: 1,
  requestId: page.runtime.status().controlRequest.requestId,
  generation: page.runtime.generation,
  status: "update-available",
  currentVersion: "5.2.2",
  latestVersion: "5.3.0",
  releaseUrl: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.3.0",
});
assert.equal(page.updateButton.textContent, "复制更新指令");
```

继续加入以下具体断言：

```js
assert.equal(page.runtime.status().controlRequest, null, "opening the panel must not auto-check");
assert.equal(page.runtime.receiveUpdateCheckResult({
  schemaVersion: 1,
  requestId: "0".repeat(32),
  generation: page.runtime.generation,
  status: "latest",
  currentVersion: "5.2.2",
  latestVersion: "5.2.2",
  releaseUrl: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.2.2",
}), false, "a foreign request id must be rejected");

// 对当前等待请求返回 latest。
assert.equal(page.updateButton.textContent, "已是最新版");
assert.equal(page.updateButton.disabled, true);

// 对当前等待请求返回 error。
assert.equal(page.updateButton.textContent, "重新检查");
assert.equal(page.updateButton.disabled, false);

// Clipboard API 成功。
assert.match(copiedText, /github\.com\/HeiGeAi\/heige-codex-skin-studio/);
assert.match(copiedText, /当前安装版本：v5\.2\.2/);
assert.match(copiedText, /检测到最新版本：v5\.3\.0/);
assert.match(copiedText, /不要修改 Codex 的 app\.asar/);

// Clipboard API 拒绝时，document.execCommand("copy") 返回 true 才能显示复制成功；
// 两条路径都失败时，alert 必须包含“复制失败”且不得包含“已复制”。
```

- [ ] **Step 2: 运行测试并确认版本栏不存在**

Run:

```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test test/skin-menu.dom.test.mjs
```

Expected: FAIL，找不到 `update-version` 与 `update-check` 元素。

- [ ] **Step 3: 注入当前版本并渲染版本栏**

扩展 `buildSkinMenuScript` 输入：

```js
export function buildSkinMenuScript({
  activeId,
  themes: entries,
  currentVersion,
  // 其余原参数
}) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(currentVersion)) {
    throw new Error("currentVersion must be canonical X.Y.Z");
  }
}
```

版本栏 DOM 使用稳定角色：

```js
updateBar.dataset.heigeRole = "update-bar";
versionText.dataset.heigeRole = "update-version";
updateButton.dataset.heigeRole = "update-check";
```

将版本栏插入 `currentHero` 与 `appearanceHelp` 之间。

- [ ] **Step 4: 实现 `check-update` 请求和严格结果回调**

请求形状固定为：

```js
{
  schemaVersion: 1,
  requestId: newRequestId(),
  action: "check-update",
  capability: data.control.token,
  generation,
}
```

`runtime.receiveUpdateCheckResult` 必须：

- 精确校验字段；
- 要求 request ID 和 generation 与当前等待请求一致；
- 接受 `latest`、`update-available`、`error` 三种状态；
- 清理请求和超时；
- 不修改主题、revision、持久化开关或 save state；
- 返回布尔值表示是否接收结果。

- [ ] **Step 5: 实现更新指令和两级复制**

```js
const updatePrompt = ({ currentVersion, latestVersion }) =>
  "请把 HeiGe Codex Skin Studio 更新到最新正式版：\\n" +
  "https://github.com/HeiGeAi/heige-codex-skin-studio\\n\\n" +
  "当前安装版本：v" + currentVersion + "\\n" +
  "检测到最新版本：v" + latestVersion + "\\n\\n" +
  "请先阅读仓库 README 和最新 Release，使用项目提供的安装方式更新。" +
  "保留现有主题与用户配置，更新后验证版本号、主题切换、原生界面恢复和皮肤常驻状态。" +
  "不要修改 Codex 的 app.asar。";
```

先调用 `navigator.clipboard.writeText`，失败时创建只读 `textarea`、选择内容、调用 `document.execCommand("copy")`，最后在 `finally` 删除临时节点。

- [ ] **Step 6: 添加响应式样式**

版本栏保持一行，窄屏允许文字和按钮换行。检查中按钮使用 `disabled`，不添加动画。

- [ ] **Step 7: 运行菜单测试**

Run:

```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test test/skin-menu.test.mjs test/skin-menu.dom.test.mjs
```

Expected: PASS。

- [ ] **Step 8: 提交菜单功能**

```bash
git add src/skin-menu.mjs src/theme-center-style.mjs test/helpers/menu-window.mjs test/skin-menu.dom.test.mjs
git commit -m "feat(menu): add manual update check interface"
```

### Task 3: CDP 协议和控制器处理

**Files:**
- Modify: `src/injector.mjs`
- Modify: `src/controller.mjs`
- Modify: `test/injector.test.mjs`
- Modify: `test/controller.test.mjs`

- [ ] **Step 1: 写失败的 injector 协议测试**

扩展 `skinStatus` 测试，要求只在 `includeControlRequest: true` 时返回精确 `check-update` 请求，并拒绝额外字段、错误 generation 和错误 capability。

为新函数写测试：

```js
const result = await deliverUpdateCheckResult({
  port: 9341,
  generation: "a".repeat(32),
  requestId: "b".repeat(32),
  result: {
    status: "latest",
    currentVersion: "5.2.2",
    latestVersion: "5.2.2",
    releaseUrl: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.2.2",
  },
  deps,
});
assert.equal(result.delivered, 1);
assert.match(FakeSession.expressions.at(-1), /receiveUpdateCheckResult/);
```

- [ ] **Step 2: 实现 `skinStatus` 提取和 CDP 投递**

`skinStatus` 增加 `check-update` 精确字段分支。新增：

```js
export async function deliverUpdateCheckResult({
  port,
  generation,
  requestId,
  result,
  deps = {},
}) {
  // 校验 generation、requestId、result 和固定 release URL。
  // 对严格识别的 main renderer 执行：
  // window.__heigeCodexSkinRuntime?.receiveUpdateCheckResult?.(payload)
  // 至少一个 renderer 返回 true 才算 delivered。
}
```

- [ ] **Step 3: 写失败的控制器测试**

断言一个 `check-update` 请求：

- 使用 constant-time capability 校验；
- 调用 `deps.checkForUpdate()` 一次；
- 调用 `deps.deliverUpdateCheckResult()` 一次；
- 不调用 `withLease`、`injectSkin`、状态写入或 revision CAS；
- 返回 `idle`；
- 检查失败也投递安全 `error` 结果；
- 非法请求和多 renderer 冲突请求不执行网络检查。

- [ ] **Step 4: 实现控制器分支**

扩展 `normalizedRendererControlRequest` 接受精确 `check-update` 请求，generation 必须与 renderer status generation 一致。

在 `processRendererRequest` 最前处理：

```js
if (request.action === "check-update") {
  const state = validateControlState(await deps.readState());
  if (!sameControlCapability(request.capability, state.controlToken)) return null;
  let updateResult;
  try {
    updateResult = await deps.checkForUpdate();
  } catch {
    updateResult = { status: "error", currentVersion: deps.currentVersion };
  }
  await deps.deliverUpdateCheckResult({
    generation: request.generation,
    requestId: request.requestId,
    result: updateResult,
  });
  lastKnownState = state;
  return result(
    "idle",
    state.selectedThemeId === NATIVE_THEME_ID ? "native" : "active",
    state,
  );
}
```

- [ ] **Step 5: 运行协议和控制器测试**

Run:

```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test test/injector.test.mjs test/controller.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交后台协议**

```bash
git add src/injector.mjs src/controller.mjs test/injector.test.mjs test/controller.test.mjs
git commit -m "feat(controller): handle manual update checks"
```

### Task 4: 生产 wiring、打包和文档

**Files:**
- Modify: `src/cli.mjs`
- Modify: `scripts/skill-package-manifest.json`
- Modify: `test/skill-package.test.mjs`
- Modify: `README.md`
- Modify: `llms-full.txt`

- [ ] **Step 1: 写失败的生产 wiring 和打包测试**

测试 `createProductionController` 的依赖注入：

- `readCurrentPackageVersion()` 只读取可信安装包；
- `createCachedUpdateChecker()` 在控制器生命周期内复用；
- `deliverUpdateCheckResult` 固定使用当前 CDP 端口；
- package manifest 含 `payload/src/update-check.mjs`。

- [ ] **Step 2: 接入生产控制器**

在 `src/cli.mjs` 导入：

```js
import {
  createCachedUpdateChecker,
  readCurrentPackageVersion,
} from "./update-check.mjs";
import {
  applySkin,
  deliverUpdateCheckResult,
  removeSkin,
  skinStatus,
} from "./injector.mjs";
```

创建控制器前读取当前版本，构造一个 60 秒缓存检查器，并注入：

```js
currentVersion,
checkForUpdate,
deliverUpdateCheckResult: (payload) => deps.deliverUpdateCheckResult({
  port,
  ...payload,
}),
```

`applySkin` 也接收 `currentVersion` 并传入 `buildSkinMenuScript`。

- [ ] **Step 3: 把新模块加入安装包 allowlist**

在 `scripts/skill-package-manifest.json` 的 `src` 条目中按字母顺序增加：

```json
{
  "source": "src/update-check.mjs",
  "destination": "payload/src/update-check.mjs",
  "recursive": false,
  "exclude": []
}
```

- [ ] **Step 4: 更新 README 并同步 llms-full**

README 说明：

- 主题中心显示当前版本；
- 只有点击「检查更新」才联网；
- 有新版时复制 Codex 更新指令；
- 工具本身不会下载、覆盖或重启。

Run:

```bash
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node scripts/sync-llms.mjs
```

- [ ] **Step 5: 重建确定性安装包**

Run:

```bash
NODE='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'
HEIGE_NODE="$NODE" HEIGE_ALLOW_TRACKED_PACKAGE_OUTPUT=1 zsh scripts/package-skill.command "$PWD/output/heige-codex-skin-studio.skill" 1704067200
"$NODE" scripts/update-release-hash.mjs --artifact output/heige-codex-skin-studio.skill --disposition docs/release/2026-07-16-audit-hardening-disposition.md
```

Expected: 生成新 SHA，并更新 release disposition 中唯一哈希标记。

- [ ] **Step 6: 运行完整验证**

Run:

```bash
NODE='/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node'
"$NODE" --test
"$NODE" scripts/check-asset-provenance.mjs --release
"$NODE" scripts/sync-llms.mjs --check
git diff --check
```

Expected: 全部非条件测试 PASS，发布素材检查和文档同步检查 PASS。

- [ ] **Step 7: 提交生产 wiring 和产物**

```bash
git add src/cli.mjs scripts/skill-package-manifest.json test/skill-package.test.mjs README.md llms-full.txt output/heige-codex-skin-studio.skill docs/release/2026-07-16-audit-hardening-disposition.md
git commit -m "feat: expose manual version checks in theme center"
```

### Task 5: 本机验收与远端交付

**Files:**
- Verify: `/Users/blakexu/.codex/heige-codex-skin-studio`

- [ ] **Step 1: 安装最终候选**

```bash
HEIGE_SKIP_APPLY=1 zsh scripts/install.command
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node src/cli.mjs apply --port 9341
```

Expected: 安装事务 commit，当前主题仍保持，不切换到其他预设。

- [ ] **Step 2: 真机验证当前版本和手动检查**

通过 CDP 读取：

- `data-heige-role="update-version"` 显示当前 `package.json` 版本；
- 打开面板前没有 `check-update`；
- 点击后出现一次 `check-update`；
- GitHub 返回当前最新版；
- 面板保持打开，主题 ID、persistence revision 不变化。

- [ ] **Step 3: 真机验证复制指令**

使用受控测试结果模拟高版本，点击「复制更新指令」，读取系统剪贴板并确认：

- 包含 `https://github.com/HeiGeAi/heige-codex-skin-studio`；
- 包含两个版本号；
- 包含保留配置和不修改 `app.asar`；
- 不包含 token、控制端点或本地路径。

- [ ] **Step 4: 推送 GitHub**

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git push origin main
```

Expected: 远端 `main` 与本地 HEAD 完全一致。

- [ ] **Step 5: 飞书交付**

发送完成通知、GitHub 提交链接和实际 `.skill` 文件；验证返回 `message_id`。
