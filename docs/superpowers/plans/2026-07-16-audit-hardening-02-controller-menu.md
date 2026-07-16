# Controller, Persistence Switch, and Re-enable Entrypoints Implementation Plan

> **状态：历史实施计划。** 常驻开启入口已被[严格方案 1](../specs/2026-07-16-option-1-menu-only-persistence-addendum.md)覆盖。本文中任何让 `enable-skin`、`enable-persist.command`、启动器、CLI 或 Skill 把常驻从 `false` 改为 `true` 的步骤均已失效，不得当作当前产品契约或执行步骤。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy watchdog with one authenticated controller, make the top-menu persistence switch truthful, and give users reliable macOS launcher, CLI, and Skill paths to re-enable the skin after a fully native restart.

**Architecture:** A long-running Node controller owns the current session, exposes one loopback persistence endpoint, and reconciles state under the Plan 1 lease. The injected menu receives a narrow read-only control descriptor. macOS LaunchAgent and shell files are adapters around the same controller and resolver, not independent state machines.

**Tech Stack:** Node.js 22+ ESM, `node:http`, `node:test`, `happy-dom@20.10.6`, macOS launchd, zsh.

**Prerequisite:** Complete and verify Plan 1 before this plan.

---

## File map

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/control-server.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/macos-launch-agent.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/controller.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/studio-logger.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/lifecycle-helper.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/macos-launcher.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/skin-menu.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/injector.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/cli.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package.json`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package-lock.json`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/lib/run-cli.zsh`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/lib/launch-codex.zsh`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/lib/skin-watchdog.zsh`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/enable-skin.command`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/resume.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/apply.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/customize.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/install.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/pause.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/restore.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/enable-persist.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/disable-persist.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/SKILL.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/control-server.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/macos-launch-agent.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/macos-launch-agent.integration.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/controller.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/studio-logger.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/helpers/menu-window.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/skin-menu.dom.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/scripts.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/macos-launcher.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/cli.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/injector.test.mjs`

## Task 1: Build the authenticated loopback control endpoint

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/control-server.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/control-server.test.mjs`

- [ ] **Step 1: Write the failing protocol tests**

```js
test("binds only IPv4 loopback and accepts the exact persistence request", async (t) => {
  const server = await startControlServer(fixture());
  t.after(() => server.close());
  assert.equal(server.host, "127.0.0.1");

  const response = await post(server, {
    origin: "app://-",
    token: CONTROL_TOKEN,
    body: { revision: 3, persistenceEnabled: false },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    persistenceEnabled: false,
    revision: 4,
  });
});

test("rejects a hostile origin token host body and JSON shape", async (t) => {
  const server = await startControlServer(fixture());
  t.after(() => server.close());
  assert.equal((await post(server, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(server, { origin: "null" })).status, 403);
  assert.equal((await post(server, { token: "wrong" })).status, 401);
  assert.equal((await post(server, { host: "evil.example" })).status, 400);
  assert.equal((await post(server, { rawBody: "x".repeat(1025) })).status, 413);
  assert.equal((await post(server, { body: { revision: 3, persistenceEnabled: false, command: "open" } })).status, 400);
});

test("a compensated backend failure returns safe authoritative state", async (t) => {
  const server = await startControlServer(fixture({ setPersistence: compensatedFailure({
    code: "BACKGROUND_START_FAILED",
    persistenceEnabled: false,
    revision: 5,
  }) }));
  t.after(() => server.close());
  const response = await post(server, validRequest({ revision: 3, persistenceEnabled: true }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "BACKGROUND_START_FAILED",
    message: "后台控制器启动失败，常驻仍为关闭",
    persistenceEnabled: false,
    revision: 5,
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
node --test test/control-server.test.mjs
```

Expected: FAIL because `src/control-server.mjs` does not exist.

- [ ] **Step 3: Implement the exact server surface**

```js
export async function startControlServer({
  token,
  allowedOrigins,
  readState,
  setPersistence,
  host = "127.0.0.1",
  port = 0,
  maxBodyBytes = 1024,
  requestTimeoutMs = 1500,
  maxConnections = 8,
}) {
  if (host !== "127.0.0.1") throw new Error("控制通道只能绑定 127.0.0.1");
  const server = createServer(persistenceHandler({
    token, allowedOrigins, readState, setPersistence, maxBodyBytes, requestTimeoutMs,
  }));
  server.maxConnections = maxConnections;
  await listen(server, { host, port });
  return { host, port: server.address().port, close: () => closeServer(server) };
}
```

Only `OPTIONS /v1/persistence` and `POST /v1/persistence` exist. Require an exact `Host` computed as `127.0.0.1:${server.address().port}`, the exact audited renderer origin `app://-`, `application/json`, an integer `Content-Length` from 1 through 1024, `X-HeiGe-Control-Token`, and exactly the keys `revision` and `persistenceEnabled`. Reject the opaque string origin `null`. A same-value retry returns the current state idempotently; a different value with a stale revision returns `409 REVISION_CONFLICT`. If a transition wrote state and then compensated before failing, the authenticated error includes the authoritative current boolean and revision so the menu can retry without a permanent conflict. Error responses contain only `ok`, code, display-safe Chinese message, boolean, and revision, never token, path, request headers, environment, or stack.

- [ ] **Step 4: Verify GREEN**

```bash
node --test test/control-server.test.mjs
```

Expected: loopback binding, CORS preflight, exact request, same-value retry, revision conflict, timeout, connection cap, redaction, and shutdown tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/control-server.mjs test/control-server.test.mjs
git commit -m "feat(controller): add authenticated persistence control channel"
```

## Task 2: Replace the legacy LaunchAgent adapter safely

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/macos-launch-agent.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/macos-launch-agent.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/macos-launch-agent.integration.test.mjs`

- [ ] **Step 1: Write failing unit and isolation tests**

```js
test("test mode refuses both production labels", async () => {
  for (const label of ["com.heige.codex-skin-watchdog", "com.heige.codex-skin-controller"]) {
    await assert.rejects(registerControllerAgent({ ...fixture(), label, testMode: true }), /production label/);
  }
});

test("legacy migration removes only a validated old plist", async () => {
  const result = await migrateLegacyWatchdog(fixture({
    oldLabel: "com.heige.codex-skin-watchdog",
    oldPlistLabel: "com.heige.codex-skin-watchdog",
  }));
  assert.deepEqual(result, {
    legacyFound: true,
    legacyRemoved: true,
    controllerRegistered: true,
  });
});

test("a polluted legacy state path is never followed or deleted", async () => {
  const deps = fixture({
    oldPlistPath: canonicalLegacyPlist,
    oldLabel: "com.heige.codex-skin-watchdog",
    oldProgramArguments: ["/bin/zsh", `${legacyRoot}/scripts/lib/skin-watchdog.zsh`],
    oldEnvironment: { HEIGE_CODEX_SKIN_STATE: "/tmp/a&b<c>d" },
  });
  await migrateLegacyWatchdog(deps);
  assert.deepEqual(deps.deletedPaths, [canonicalLegacyPlist]);
  assert.equal(deps.touchedPaths.some((path) => path.startsWith("/tmp/a&b<c>d")), false);
});

test("failure after old bootout restores and reboots the old job", async () => {
  const deps = fixture({ faultAt: "after-old-bootout", oldLoaded: true });
  await assert.rejects(migrateLegacyWatchdog(deps), /INJECTED_MIGRATION_FAILURE/);
  assert.equal(await deps.isLoaded("com.heige.codex-skin-watchdog"), true);
  assert.equal(await deps.isLoaded("com.heige.codex-skin-controller"), false);
  assert.equal(await deps.readFile(canonicalLegacyPlist), deps.originalPlistBytes);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/macos-launch-agent.test.mjs
```

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement plist rendering and verified transitions**

Export `renderControllerPlist`, `inspectLaunchAgent`, `registerControllerAgent`, `unregisterControllerAgent`, and `migrateLegacyWatchdog`. The production label is exactly `com.heige.codex-skin-controller`. The plist uses absolute stable-install paths, `RunAtLoad=true`, a failure-only restart policy, `ProcessType=Background`, and log files under the mode-`0700` state directory. Write atomically, run `/usr/bin/plutil -lint`, use `/bin/launchctl bootstrap|bootout` against `gui/${process.getuid()}`, and confirm state with `launchctl print` before reporting success.

Migration may remove the old plist only when all fixed product evidence agrees: its canonical path is `~/Library/LaunchAgents/com.heige.codex-skin-watchdog.plist`, parsed `Label` is exact, `ProgramArguments` are `/bin/zsh` plus `scripts/lib/skin-watchdog.zsh` inside the stable or positively identified legacy root, and the legacy feature tuple matches `RunAtLoad=true`, `StartInterval=15`, `AbandonProcessGroup=true`, and port `9341`. The audited machine's `/tmp/a&b<c>d` value is in legacy state and log fields, not the executable arguments; it must neither defeat attribution nor authorize touching that referenced path. If the executable itself points into `/tmp`, attribution fails closed.

`migrateLegacyWatchdog()` is a reversible transaction. Snapshot the old plist bytes, permissions, and loaded status; stage and lint the new plist; bootstrap and verify the new label; boot out and verify the old label; then remove only the canonical old plist. Inject failures after every boundary in unit tests. On any failure, boot out the new label, restore or remove the new plist to its pre-state, restore the old plist byte-for-byte, re-bootstrap it when it was previously loaded, and verify the old label before returning nonzero. A rollback failure is reported alongside the primary error and leaves the migration journal for `doctor`; it is never reported as success.

- [ ] **Step 4: Verify unit GREEN, then isolated launchd integration**

```bash
node --test test/macos-launch-agent.test.mjs
HEIGE_RUN_LAUNCHD_INTEGRATION=1 node --test test/macos-launch-agent.integration.test.mjs
```

The integration test must create `com.heige.codex-skin-controller.test.${randomUUID()}`, register it with an isolated state directory, and always `bootout` it in `t.after()`. It may never address either production label.

- [ ] **Step 5: Commit**

```bash
git add src/macos-launch-agent.mjs test/macos-launch-agent.test.mjs test/macos-launch-agent.integration.test.mjs
git commit -m "feat(macos): add isolated controller LaunchAgent adapter"
```

## Task 3: Implement the controller state machine

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/controller.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/studio-logger.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/controller.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/studio-logger.test.mjs`

- [ ] **Step 1: Write failing session and self-unregister tests**

```js
test("turning persistence off keeps only the verified current process", async () => {
  const controller = createSkinController(fixture());
  const changed = await controller.setPersistence({ expectedRevision: 1, enabled: false });
  assert.equal(changed.persistenceEnabled, false);
  assert.equal(session.keepUntilProcessExit, true);
  assert.deepEqual(session.process, currentProcess);

  processProbe.result = replacementProcess;
  assert.equal((await controller.tick()).action, "unregister");
  assert.equal(injectCalls.length, 0);
});

test("pause survives ticks and resume restores the same verified process", async () => {
  await controller.pause();
  await controller.tick();
  assert.equal(injectCalls.length, 0);
  await controller.resume();
  assert.equal(injectCalls.length, 1);
});

test("disabled state at boot self-unregisters without launching Codex or opening a server", async () => {
  const result = await createSkinController(disabledBootFixture()).start();
  assert.equal(result.action, "unregister");
  assert.deepEqual(processActions, []);
  assert.equal(controlServerCalls, 0);
});

test("logger rotates and redacts token home and raw environment", async () => {
  const logger = createStudioLogger({ path: logPath, token: CONTROL_TOKEN, home: "/Users/example", maxBytes: 256, backups: 3 });
  await logger.error("controller_failure", new Error(`token=${CONTROL_TOKEN} path=/Users/example/private`));
  const text = await readAllLogs(logPath);
  assert.doesNotMatch(text, new RegExp(CONTROL_TOKEN));
  assert.doesNotMatch(text, /\/Users\/example/);
  assert.doesNotMatch(text, /process\.env|API_KEY/);
});

for (const faultAt of ["after-journal", "after-state-cas", "after-session-write"]) {
  test(`disable recovers after crash at ${faultAt}`, async () => {
    const deps = crashFixture({ faultAt, currentProcess });
    await assert.rejects(createSkinController(deps).setPersistence({ expectedRevision: 1, enabled: false }), /SIMULATED_CRASH/);
    const recovered = await createSkinController(deps.afterRestart()).start();
    assert.equal(recovered.persistenceEnabled, false);
    assert.equal(recovered.revision, 2);
    assert.equal(recovered.session.keepUntilProcessExit, true);
    assert.deepEqual(recovered.session.process, currentProcess);
    assert.equal(await deps.transitionExists(), false);
  });
}

test("enable returns no ACK and restores off when background start fails", async () => {
  const deps = fixture({ failBackgroundStart: true });
  await assert.rejects(
    createSkinController(deps).setPersistence({ expectedRevision: 1, enabled: true }),
    /后台控制器启动失败/,
  );
  const state = await deps.readState();
  assert.equal(state.persistenceEnabled, false);
  assert.equal(state.revision, 3, "enable CAS and compensating CAS are both durable");
  assert.equal(await deps.backgroundRegistrationExists(), false);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/controller.test.mjs
```

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement one reconcile loop**

```js
export function createSkinController(deps) {
  return {
    start: () => withControllerLease(deps, () => startController(deps)),
    tick: () => withControllerLease(deps, () => reconcileController(deps)),
    setPersistence: (input) => withControllerLease(deps, () => setPersistence(deps, input)),
    pause: () => withControllerLease(deps, () => pauseCurrentSession(deps)),
    resume: () => withControllerLease(deps, () => resumeCurrentSession(deps)),
    restore: () => withControllerLease(deps, () => beginRestore(deps)),
    stop: () => stopController(deps),
  };
}
```

`tick()` returns `{ action, mode, persistenceEnabled, revision }`, where action is one of `idle`, `inject`, `repair`, `wait-for-app`, `unregister`, `paused`, or `error`. A successful health tick resets the consecutive failure count. State corruption, token absence, ambiguous app identity, wrong port owner, and lock failure transition to `error` without starting, killing, restarting, registering, or injecting anything.

The controller passes only `new Set([CODEX_RENDERER_ORIGIN])` to the control server. It does not derive an allowlisted origin with Node's `URL.origin`, because Node reports `null` for the custom `app:` scheme while the audited Electron renderer reports `app://-`.

`createStudioLogger()` writes bounded JSON Lines with event codes, safe messages, and timestamps. It replaces the current home prefix with `~`, redacts the control token and configured sensitive values, never serializes `process.env`, rotates at 1 MiB, and retains three backups. Log-write failure cannot hide the primary controller error or make a successful operation fail after state has committed.

Turning persistence off is one journaled transaction under the operation lease: verify and capture PID plus executable path plus start time, write and `fsync` `prepared`, CAS the state to false with the same transition nonce, advance the journal, durably write `keepUntilProcessExit`, then clear the journal. Only after that may the controller ACK. Startup always runs `recoverStateTransition()` before opening the control server or reconciling injection. A matching process keeps renderer repair; identity loss clears the session, unregisters, and exits.

Turning persistence on also uses the journal. Run full preflight, create and verify the background registration in a pending-enable state, CAS to true, explicitly start or wake the platform controller, verify its handshake, clear `keepUntilProcessExit`, and only then ACK. The controller recognizes the pending journal and does not self-unregister while enable is committing. Any failure before ACK executes a journaled compensating transition to false, removes the new registration, verifies the old off behavior, and leaves the menu's boolean unchanged. Because the enable CAS and compensation each increment revision, the thrown transition error carries the final authoritative false state and new revision for a safe error response. A stale expected revision or mismatched transition nonce fails closed rather than guessing which side won. The control descriptor passed to the injector is:

```js
{
  available: true,
  persistenceEnabled: state.persistenceEnabled,
  revision: state.revision,
  endpoint: `http://127.0.0.1:${server.port}/v1/persistence`,
  token: state.controlToken,
  launcherName: "HeiGe 皮肤启动器",
}
```

- [ ] **Step 4: Verify GREEN**

```bash
node --test test/controller.test.mjs test/studio-logger.test.mjs test/control-server.test.mjs test/state-store.test.mjs test/operation-lock.test.mjs
```

Expected: new install default-off session, legacy-on migration, current-process retention, renderer repair, pause, resume, idempotent request, failure reset, disabled boot, and self-unregister tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/controller.mjs src/studio-logger.mjs test/controller.test.mjs test/studio-logger.test.mjs
git commit -m "feat(controller): add persistent session state machine"
```

## Task 4: Add executable DOM tests and the truthful menu switch

**Files:**

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package.json`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package-lock.json`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/skin-menu.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/injector.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/helpers/menu-window.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/skin-menu.dom.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/injector.test.mjs`

- [ ] **Step 1: Pin the DOM harness and write failing behavior tests**

```bash
npm install --save-dev --save-exact happy-dom@20.10.6
```

```js
test("switch exposes accessible state and permanent re-enable guidance", async () => {
  const page = await menuWindow({ persistenceEnabled: true, revision: 7 });
  const toggle = page.document.querySelector('[data-heige-role="persistence-switch"]');
  assert.equal(toggle.getAttribute("role"), "switch");
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.match(page.document.body.textContent, /关闭后本次继续使用；下次启动恢复原生界面/);
  assert.match(page.document.body.textContent, /HeiGe 皮肤启动器/);
  assert.match(page.document.body.textContent, /启用 HeiGe 皮肤/);
});

test("off is painted only after the controller ACK", async () => {
  const pending = deferredResponse();
  const page = await menuWindow({ fetch: () => pending.promise });
  await page.clickPersistenceSwitch();
  await page.clickConfirmOff();
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
  pending.resolve(okResponse({ persistenceEnabled: false, revision: 8 }));
  await page.flush();
  assert.equal(page.switch.getAttribute("aria-checked"), "false");
});

test("failure rolls back and shows the real safe error", async () => {
  const page = await menuWindow({ fetch: () => Promise.reject(new Error("控制器不可用")) });
  await page.disablePersistence();
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
  assert.match(page.alert.textContent, /控制器不可用/);
});

test("a compensated enable failure syncs revision without painting on", async () => {
  const requests = [];
  const page = await menuWindow({
    persistenceEnabled: false,
    revision: 3,
    fetch: sequenceFetch([
      errorResponse(503, { code: "BACKGROUND_START_FAILED", persistenceEnabled: false, revision: 5 }),
      okResponse({ persistenceEnabled: true, revision: 6 }),
    ], requests),
  });
  await page.enablePersistence();
  assert.equal(page.switch.getAttribute("aria-checked"), "false");
  assert.equal(page.controlRevision, 5);
  await page.enablePersistence();
  assert.equal(requests[1].revision, 5);
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/skin-menu.dom.test.mjs
```

Expected: FAIL because the current menu has no switch, confirmation card, controller request, or executable DOM harness.

- [ ] **Step 3: Implement the switch without local state fiction**

Add `control` to `buildSkinMenuScript()` and to `applySkin()`. Render `data-heige-role` selectors for the switch, helper, confirmation card, cancel, confirm, and status alert. The switch uses `role="switch"`, `tabindex="0"`, `aria-checked`, and handles click, Enter, and Space. The helper always contains:

```text
关闭后本次继续使用；下次启动恢复原生界面。
重新启用：打开「HeiGe 皮肤启动器」，或在 Codex 中说「启用 HeiGe 皮肤」。
```

Turning on posts immediately. Turning off first renders the exact confirmation copy from the approved design. Keep the old checked value while the request is pending. Because a switch action always requests the opposite value, accept success only when the returned boolean equals the requested value and the returned integer revision is strictly greater than the request revision; then update both state and revision. This also accepts a safe retry after the first ACK was lost because the controller returns the already-incremented current revision. On an authenticated non-2xx compensation response, keep the old visual boolean but advance the cached revision only when the returned boolean equals that old value and the revision is a greater integer; this prevents the next retry from looping on `409`. On abort, timeout, unauthenticated or malformed error, revision conflict, mismatched state, or mismatched ACK, keep or restore the previous state and render a visible `role="alert"` message. Never store persistence state or the token in `localStorage`.

- [ ] **Step 4: Verify GREEN and retain string safety tests**

```bash
node --test test/skin-menu.dom.test.mjs test/skin-menu.test.mjs test/injector.test.mjs
```

Expected: mouse, Enter, Space, confirmation cancel, confirmed off, re-enable, pending state, rollback, accessibility, inert JSON, and injector payload tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/skin-menu.mjs src/injector.mjs test/helpers/menu-window.mjs test/skin-menu.dom.test.mjs test/skin-menu.test.mjs test/injector.test.mjs
git commit -m "feat(menu): add confirmed persistence switch and recovery guidance"
```

## Task 5: Separate lifecycle semantics and thin the shell wrappers

**Files:**

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/cli.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/lifecycle-helper.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/lib/run-cli.zsh`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/lib/launch-codex.zsh`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/enable-skin.command`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/resume.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/apply.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/customize.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/pause.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/restore.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/enable-persist.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/disable-persist.command`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/lib/skin-watchdog.zsh`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/cli.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/scripts.test.mjs`

- [ ] **Step 1: Write failing command-contract tests**

```js
test("apply does not turn persistence on", async () => {
  const result = await runCli(["apply", "--theme", "miku-488137"], deps);
  assert.equal(result.persistenceEnabled, false);
  assert.equal(registerCalls.length, 1, "ephemeral current-session controller is registered");
});

test("pause resume restore and enable are distinct", async () => {
  assert.deepEqual(await runCli(["pause"], deps), { mode: "paused" });
  assert.deepEqual(await runCli(["resume"], deps), { mode: "active" });
  assert.deepEqual(await runCli(["restore"], deps), { mode: "restoring", persistenceEnabled: false });
  assert.deepEqual(await runCli(["enable-skin"], deps), { mode: "active", persistenceEnabled: true });
  assert.deepEqual(await runCli(["set-persistence", "false"], deps), { persistenceEnabled: false, revision: 6 });
  assert.deepEqual(await runCli(["migrate-legacy"], deps), { migratedFrom: "watchdog", persistenceEnabled: true });
});

test("restore validates every dependency before Codex can be quit", async () => {
  await assert.rejects(runCli(["restore"], fixture({ validatePortOwner: async () => false })), /端口不属于目标 Codex/);
  assert.deepEqual(processActions, []);
});

test("theme identifiers are exact strings and never regular expressions", async () => {
  await assert.rejects(runCli(["enable-skin", "--theme", ".*"], deps), /找不到主题/);
  assert.equal((await deps.readState()).lastNonNativeThemeId, "miku-488137");
  assert.deepEqual(processActions, []);
});

test("run-cli bootstraps Node from a user Applications path with spaces and Chinese", async (t) => {
  const home = await createFakeHome(t, "用户 空格");
  const app = await createFakeCodexApp(home, {
    nodeRelativePath: "Contents/Resources/cua_node/bin/node",
    nodeVersion: "v24.14.0",
  });
  const result = await runWrapper("status", { HOME: home, PATH: "/usr/bin:/bin" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.nodePath, `${app}/Contents/Resources/cua_node/bin/node`);
});

test("an invalid explicit Node fails closed without fallback", async () => {
  const result = await runWrapper("status", {
    HEIGE_NODE: "/missing/node",
    PATH: `${validSystemNodeDirectory}:/usr/bin:/bin`,
  });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /HEIGE_NODE/);
  assert.equal(result.usedSystemNode, false);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/cli.test.mjs test/scripts.test.mjs
```

Expected: FAIL because resume and enable-skin are absent, restore aliases pause, and shell wrappers still contain independent watchdog logic.

- [ ] **Step 3: Route every command through the controller**

`src/cli.mjs` must export and route `apply`, `enable-skin`, `set-persistence`, `pause`, `resume`, `restore`, `controller`, `migrate-legacy`, `status`, and `doctor`. `set-persistence` accepts exactly `true` or `false`, requires or reads the current revision, and delegates to the same journaled controller method used by the menu. `apply` validates the app, exact port owner, Node, state, and all theme inputs before registering an ephemeral current-session controller; it does not change `persistenceEnabled`. Theme existence always comes from parsed theme objects and strict string equality, never a shell or JavaScript regular expression. `enable-skin` resolves `lastNonNativeThemeId`, falls back to `miku-488137` only when missing, confirms and starts the background registration, writes enabled state through the transaction, and delegates restart to the detached helper. `migrate-legacy` is an internal, lease-protected command: it runs only when schema 2 state does not exist, requires the exact positively identified legacy product tuple plus valid theme evidence, and is idempotent after a successful migration. It delegates service replacement to the reversible `migrateLegacyWatchdog()` transaction; failure restores and re-verifies the prior loaded job before returning nonzero.

`scripts/lib/run-cli.zsh` owns the minimal bootstrap needed before JavaScript can run. In order, it validates an explicit `HEIGE_NODE` without fallback; checks both bundled Node paths under a valid explicit `HEIGE_CODEX_APP`; checks the same `/Applications/ChatGPT.app` then quoted `$HOME/Applications/ChatGPT.app` candidates as Plan 1; then checks `command -v node`. Candidate bundled paths are `Contents/Resources/cua_node/bin/node` and `Contents/Resources/cua_node/node`. Every selected executable must return a parseable Node major at least 22, and an invalid explicit app or Node fails closed. It uses arrays and quoted paths so Chinese and spaces are preserved, exports the selected app hint, then invokes `src/cli.mjs`; the unified JavaScript resolver remains authoritative and revalidates the app/process identity. Tests cover each candidate, missing runtime, Node 20 rejection, Node 22 acceptance, explicit override failure, system/user priority, and Chinese/space homes.

`lifecycle-helper.mjs` accepts only a mode-`0600` action file created after preflight. It records exact process identity, requests a normal quit, waits for that identity to disappear, and starts the resolved app with the requested CDP arguments. It never uses `SIGKILL`, never matches by process name alone, and does not inherit the calling terminal's lifetime. `restore` removes the tool from all classified targets, unregisters the controller, closes the control server, normally restarts without CDP, and verifies that the configured port is no longer owned by Codex.

All `.command` files become wrappers around `scripts/lib/run-cli.zsh`. `enable-persist.command` forwards to `enable-skin`; `disable-persist.command` performs `set-persistence false` and prints both “本次皮肤继续使用” and “下次启动完全原生”. Delete `skin-watchdog.zsh` only after all tests stop referencing it.

- [ ] **Step 4: Verify GREEN**

```bash
for file in scripts/*.command scripts/lib/*.zsh; do /bin/zsh -n "$file"; done
node --test test/cli.test.mjs test/scripts.test.mjs test/controller.test.mjs
```

Expected: parser and fake-process tests PASS, and the harness records no real `launchctl`, `open`, `osascript`, signal, or Codex process mutation.

- [ ] **Step 5: Commit**

```bash
git add src/cli.mjs src/lifecycle-helper.mjs scripts test/cli.test.mjs test/scripts.test.mjs
git commit -m "feat(cli): separate apply enable pause resume and restore flows"
```

## Task 6: Generate the macOS user launcher and wire the Skill intent

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/macos-launcher.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/install.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/SKILL.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/macos-launcher.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/scripts.test.mjs`

- [ ] **Step 1: Write failing launcher and intent tests**

```js
test("creates a local app that calls only the stable enable entrypoint", async () => {
  const result = await installMacosLauncher({ home, installRoot });
  assert.equal(result.appPath, join(home, "Applications", "HeiGe 皮肤启动器.app"));
  assert.match(await readFile(result.executablePath, "utf8"), /scripts\/enable-skin\.command/);
  assert.doesNotMatch(await readFile(result.executablePath, "utf8"), /curl|osascript|sudo/);
});

test("Skill routes re-enable intent but status remains read-only", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /启用皮肤|重新打开皮肤|恢复 HeiGe 主题|开启常驻/);
  assert.match(skill, /enable-skin\.command/);
  assert.match(skill, /status.*不得.*修改后台任务/s);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/macos-launcher.test.mjs test/scripts.test.mjs
```

Expected: FAIL because there is no generated user app or re-enable intent contract.

- [ ] **Step 3: Implement the generated local bundle**

`installMacosLauncher({ home, installRoot })` creates `/Users/blakexu/Applications/HeiGe 皮肤启动器.app` on the current audited Mac, and the equivalent `join(home, "Applications", "HeiGe 皮肤启动器.app")` for any other user. It contains `Contents/Info.plist` and one mode-`0755` executable at `Contents/MacOS/HeiGe Skin Launcher`. Its bundle ID is `com.heige.codex-skin-launcher`. The executable uses an absolute stable-install path and `exec`s only `scripts/enable-skin.command`; it contains no duplicate engine, downloaded code, admin request, or mutable environment interpolation. Validate the installed entrypoint before atomically replacing an older generated bundle.

The installer prints the Finder-visible absolute path. The Skill tells the user that Codex will normally restart before invoking the detached helper, recognizes the four approved re-enable phrasings, and keeps `status` and `doctor` read-only.

- [ ] **Step 4: Verify GREEN**

```bash
node --test test/macos-launcher.test.mjs test/scripts.test.mjs
```

Expected: Chinese and space-containing HOME paths, atomic replacement, permissions, plist escaping, stable target, intent routing, and read-only status tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/macos-launcher.mjs scripts/install.command skill/heige-codex-skin-studio/SKILL.md test/macos-launcher.test.mjs test/scripts.test.mjs
git commit -m "feat(macos): add local re-enable launcher"
```

## Plan 2 completion gate

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
npm test
for file in scripts/*.command scripts/lib/*.zsh; do /bin/zsh -n "$file"; done
HEIGE_RUN_LAUNCHD_INTEGRATION=1 node --test test/macos-launch-agent.integration.test.mjs
git status --short
```

Expected: all tests PASS and the worktree is clean. The integration label is random and has been removed. Do not migrate either production LaunchAgent in this plan; the final plan performs live migration only after injection, Windows, package, and CI gates are complete.
