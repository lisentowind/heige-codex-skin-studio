# Runtime, State, and Lock Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one trustworthy Codex runtime resolver, versioned state, and fail-closed locking before any controller or lifecycle command is allowed to mutate the running app.

**Architecture:** Pure Node modules own runtime identity, persistent/session state, and lock leases. Later plans consume these modules; this plan deliberately leaves process and background-task mutation unchanged until the replacement controller is ready.

**Tech Stack:** Node.js 22+ ESM, `node:test`, atomic JSON files, macOS `ps`, zsh wrappers.

**Prerequisite:** Approved design spec at `docs/superpowers/specs/2026-07-16-audit-hardening-and-persistence-design.md`. This is the first implementation plan.

---

## File map

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/constants.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/codex-app.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/state-store.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/operation-lock.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/package-skill.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/codex-app.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/product-identity.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/state-store.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/operation-lock.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/skill-package.test.mjs`

## Task 0: Stop the baseline test from rewriting the tracked package

**Files:**

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/package-skill.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/skill-package.test.mjs`

- [ ] **Step 1: Write the failing no-side-effect assertion**

```js
test("package smoke test writes only its temporary output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "heige-skill-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tracked = join(repoRoot, "output/heige-codex-skin-studio.skill");
  const beforeBytes = await readFile(tracked);
  const beforeMode = (await stat(tracked)).mode;
  t.after(async () => {
    await writeFile(tracked, beforeBytes);
    await chmod(tracked, beforeMode);
  });
  const before = await sha256File(tracked);
  const archive = join(root, "smoke.skill");

  await execFileAsync(join(repoRoot, "scripts/package-skill.command"), [], {
    env: { ...process.env, HEIGE_SKILL_OUTPUT: archive },
  });

  assert.equal(await sha256File(tracked), before);
  await access(archive);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/skill-package.test.mjs
git status --short
```

Expected: FAIL because the old script ignores `HEIGE_SKILL_OUTPUT`, rewrites the tracked package, and does not create the requested temporary archive. The test cleanup restores the exact tracked bytes and mode even on failure, so `git status --short` is clean before implementation continues.

- [ ] **Step 3: Add a temporary explicit output seam**

Make the existing zsh packager use `HEIGE_SKILL_OUTPUT` when set and retain its current tracked default only for manual compatibility. Create the selected output's parent directory, reject an empty value, and print the actual path. Update every package test to pass a temporary absolute output and unpack that path. This is a narrow hermetic-test fix; Plan 5 replaces the packager with the deterministic mandatory-output Node implementation.

- [ ] **Step 4: Verify GREEN and a clean baseline**

```bash
node --test test/skill-package.test.mjs
npm test
git status --short
```

Expected: 72 baseline tests PASS and no tracked file changes. Record the baseline count only as execution evidence; do not add it to public documentation.

- [ ] **Step 5: Commit**

```bash
git add scripts/package-skill.command test/skill-package.test.mjs
git commit -m "test(package): isolate smoke-test output"
```

## Task 1: Unify app resolution and process identity

**Files:**

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/codex-app.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/codex-app.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test("an invalid explicit app fails instead of silently falling back", async () => {
  await assert.rejects(
    resolveCodexApp({
      platform: "darwin",
      env: { HEIGE_CODEX_APP: "/bad/ChatGPT.app" },
      exists: async () => false,
    }),
    /HEIGE_CODEX_APP/,
  );
});

test("the real ps command shape yields a stable process identity", () => {
  const app = codexInstallation("/Applications/ChatGPT.app", { platform: "darwin" });
  const rows = parseCodexProcessTable(
    "   42 Thu Jul 16 16:49:24 2026 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --remote-debugging-port=9341",
    app,
  );
  assert.deepEqual(rows[0], {
    pid: 42,
    executablePath: app.executablePath,
    startedAt: "Thu Jul 16 16:49:24 2026",
    commandLine: rows[0].commandLine,
    hasCdp: true,
    cdpPort: 9341,
  });
});

test("parser accepts an actual ps row for the current process", async () => {
  const output = await execFileText("/bin/ps", ["-axo", "pid=,lstart=,command="]);
  const rows = parseMacPsTable(output);
  assert.ok(rows.some((row) => row.pid === process.pid && row.commandLine.includes("node")));
});
```

- [ ] **Step 2: Verify RED**

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
node --test test/codex-app.test.mjs
```

Expected: FAIL because `resolveCodexApp`, `codexInstallation`, and `parseCodexProcessTable` are missing.

- [ ] **Step 3: Implement the contracts**

`resolveCodexApp()` returns exactly:

```js
{
  platform: "darwin",
  appPath: "/Applications/ChatGPT.app",
  executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
  bundledNodePath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
  bundledNodeCandidates: [
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/node",
  ],
  source: "system",
}
```

`source` is `env`, `system`, or `user`. `listCodexProcesses({ app, exec })` returns records containing `pid`, `executablePath`, `startedAt`, `commandLine`, `hasCdp`, and `cdpPort`.

```js
export function codexInstallation(appPath, { platform = process.platform } = {}) {
  if (platform === "win32") {
    const candidates = bundledNodeCandidates(appPath, { platform });
    return {
      appPath,
      executablePath: appPath,
      bundledNodePath: candidates[0],
      bundledNodeCandidates: candidates,
    };
  }
  return {
    appPath,
    executablePath: posix.join(appPath, "Contents", "MacOS", "ChatGPT"),
    bundledNodePath: posix.join(appPath, "Contents", "Resources", "cua_node", "bin", "node"),
    bundledNodeCandidates: [
      posix.join(appPath, "Contents", "Resources", "cua_node", "bin", "node"),
      posix.join(appPath, "Contents", "Resources", "cua_node", "node"),
    ],
  };
}

export function sameProcessIdentity(left, right) {
  return left?.pid === right?.pid &&
    left?.executablePath === right?.executablePath &&
    left?.startedAt === right?.startedAt;
}
```

`resolveCodexApp()` must honor a valid `HEIGE_CODEX_APP`, reject an invalid explicit value, then probe `/Applications/ChatGPT.app` and the current user's `Applications/ChatGPT.app`. `listCodexProcesses()` must use `/bin/ps -axo pid=,lstart=,command=` and return PID, executable path, start time, command line, CDP flag, and parsed port. Parse the real whitespace shape: numeric PID, the fixed `lstart` fields, then the untouched remainder as command line. Do not invent a delimiter that `/bin/ps` does not emit.

- [ ] **Step 4: Verify GREEN**

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
node --test test/codex-app.test.mjs
```

Expected: all resolver and diagnostics tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex-app.mjs test/codex-app.test.mjs
git commit -m "feat(runtime): unify Codex app and process resolution"
```

## Task 2: Add schema 2 state and one-time migration

**Files:**

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/constants.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/state-store.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/state-store.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/product-identity.test.mjs`

- [ ] **Step 1: Write failing state tests**

```js
test("corrupt state fails closed", async () => {
  await writeFile(statePath, "{bad");
  await assert.rejects(() => readStudioState(statePath), /状态文件损坏/);
});

test("a loaded legacy watchdog and valid theme migrate enabled once", async () => {
  const result = await migrateLegacyState({
    statePath,
    legacyThemePath,
    legacyAgentLoaded: true,
    themeExists: async (id) => id === "miku-488137",
    randomBytes: () => Buffer.alloc(32, 7),
  });
  assert.equal(result.state.schemaVersion, 2);
  assert.equal(result.state.persistenceEnabled, true);
  assert.equal(result.state.revision, 1);
  assert.equal((await stat(statePath)).mode & 0o777, 0o600);
});

test("compare and update rejects a stale revision", async () => {
  await assert.rejects(
    compareAndUpdateStudioState(statePath, { expectedRevision: 1, mutate: (state) => state }),
    (error) => error.code === "REVISION_CONFLICT",
  );
});

test("native selection uses a dedicated constant and never overwrites the last skin", async () => {
  const state = validateStudioState({
    ...createDefaultStudioState({ themeId: "miku-488137", token: CONTROL_TOKEN }),
    selectedThemeId: NATIVE_THEME_ID,
  });
  assert.equal(state.selectedThemeId, "__heige_native__");
  assert.equal(state.lastNonNativeThemeId, "miku-488137");
});

test("transition journal survives a crash between persistence and session writes", async () => {
  await writeTransitionJournal(transitionPath, {
    schemaVersion: 1,
    operation: "disable-persistence",
    expectedRevision: 3,
    process: currentProcess,
    desiredPersistenceEnabled: false,
    nonce: "transition-1",
    stage: "prepared",
  });
  await compareAndUpdateStudioState(statePath, {
    expectedRevision: 3,
    mutate: (state) => ({ ...state, persistenceEnabled: false, lastTransitionNonce: "transition-1" }),
  });
  const recovered = await recoverStateTransition({ statePath, sessionPath, transitionPath, currentProcess });
  assert.equal(recovered.session.keepUntilProcessExit, true);
  assert.deepEqual(recovered.session.process, currentProcess);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/state-store.test.mjs
```

Expected: FAIL because `src/state-store.mjs` does not exist.

- [ ] **Step 3: Implement the state API**

Use these exact public shapes:

```js
export function createDefaultStudioState({ themeId, token }) {
  return {
    schemaVersion: 2,
    persistenceEnabled: false,
    selectedThemeId: themeId,
    lastNonNativeThemeId: themeId,
    controlToken: token,
    lastTransitionNonce: null,
    revision: 0,
  };
}

export async function compareAndUpdateStudioState(path, { expectedRevision, mutate }) {
  const current = await readRequiredState(path);
  if (current.revision !== expectedRevision) throw new StateConflictError(current);
  const next = validateStudioState({
    ...mutate(structuredClone(current)),
    revision: current.revision + 1,
  });
  return writeStudioState(path, next);
}
```

Set `STATE_SCHEMA_VERSION` to `2`, add `NATIVE_THEME_ID = "__heige_native__"`, and add `CODEX_RENDERER_ORIGIN = "app://-"` in `src/constants.mjs`. The origin value is backed by a read-only live probe on 2026-07-16 and is coupled to the exact main-target URL classifier. `controlToken` is exactly 32 random bytes encoded as unpadded base64url and is generated only when a new schema 2 state is created. Validation accepts the native constant only for `selectedThemeId`; `lastNonNativeThemeId` must always be a real validated theme ID. Extend `resolveStudioPaths()` with `sessionPath`, `transitionPath`, and `lockPath` under the platform state root, and update the product identity test accordingly.

Export `writeTransitionJournal`, `readTransitionJournal`, `recoverStateTransition`, and `clearTransitionJournal`. A mode-`0600` write-ahead journal stores only the intended boolean transition, expected revision, exact current process identity, nonce, and one of `prepared`, `state-committed`, or `session-committed`. The state CAS stores the same nonce in `lastTransitionNonce`, so a restart can distinguish a committed CAS from an unrelated revision. Recovery is idempotent: at `prepared`, finish the requested CAS if the state is still at the expected revision; when the state is at `expectedRevision + 1`, continue only if both the desired boolean and nonce match; any other state is a fail-closed conflict. After a successful disable CAS but before the session write, reconstruct `keepUntilProcessExit` only for the still-matching process; if the process has gone, finish the disable with no injection. Clear the journal only after the session side is durable. Never infer completion from a missing second file.

Store session state separately with this exact shape:

```js
{
  schemaVersion: 1,
  mode: "active",
  process: { pid: 42, executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", startedAt: "Thu Jul 16 16:49:24 2026" },
  activeThemeId: "miku-488137",
  keepUntilProcessExit: false
}
```

Writes must use a sibling temporary file, file `fsync`, atomic rename, directory mode `0700`, file mode `0600`, and cleanup after failure. Unknown schemas, malformed JSON, and permission errors must throw without silently rebuilding state.

- [ ] **Step 4: Verify GREEN**

```bash
node --test test/state-store.test.mjs
```

Expected: migration, permissions, atomicity, and revision tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/constants.mjs src/state-store.mjs test/state-store.test.mjs test/product-identity.test.mjs
git commit -m "feat(state): add versioned fail-closed persistence"
```

## Task 3: Add fail-closed operation leases

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/src/operation-lock.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/operation-lock.test.mjs`

- [ ] **Step 1: Write failing lock tests**

```js
test("a live owner is never stolen even with a stale heartbeat", async () => {
  await seedLock(lockPath, owner);
  await assert.rejects(
    acquireOperationLock({ lockPath, operation: "restore", identity: contender, readProcessIdentity: async () => owner }),
    (error) => error.code === "LOCK_HELD",
  );
});

test("the protected action never runs when lock acquisition fails", async () => {
  let destructiveCall = false;
  await assert.rejects(
    withOperationLock(fixtureHeldLock(), async () => { destructiveCall = true; }),
    /LOCK_HELD/,
  );
  assert.equal(destructiveCall, false);
});

test("a crash before atomic lock publication cannot leave a blocking empty lock", async () => {
  await assert.rejects(
    acquireOperationLock(fixture({ faultAt: "before-publish" })),
    /FAULT_BEFORE_PUBLISH/,
  );
  await assert.doesNotReject(acquireOperationLock(fixture()));
  assert.equal(await pathExists(lockPath), true);
  assert.equal((await readFile(lockPath, "utf8")).includes('"nonce"'), true);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/operation-lock.test.mjs
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the lease**

```js
export async function withOperationLock(options, action) {
  const lock = await acquireOperationLock(options);
  try {
    return await action(lock);
  } finally {
    await lock.release();
  }
}
```

`acquireOperationLock()` publishes one complete mode-`0600` owner file without an empty-directory window. Write and `fsync` a unique sibling staging file containing schema, nonce, PID, operation, process start time, creation time, and heartbeat; atomically publish it with a same-filesystem hard link to `lockPath`, where `EEXIST` means another owner won. Then unlink the staging name and `fsync` the parent directory. A crash before the link may leave an inert staging file but never a blocking lock; startup may remove only staging files whose encoded PID plus start time are proven dead. Heartbeats use a separate nonce-bound sibling file and atomic replacement, so the immutable owner record is never partially rewritten. A stale heartbeat alone never permits takeover. Recovery requires proving the PID is gone or its start time differs. Malformed published owner data remains fail-closed and is surfaced by `doctor`; product code never guesses ownership or silently deletes it.

- [ ] **Step 4: Verify GREEN**

```bash
node --test test/operation-lock.test.mjs
```

Expected: live-owner, PID-reuse, malformed-owner, heartbeat, idempotent-release, and protected-action tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/operation-lock.mjs test/operation-lock.test.mjs
git commit -m "feat(runtime): add fail-closed operation locking"
```

## Plan 1 completion gate

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
npm test
git status --short
```

Expected: all tests PASS and the worktree is clean. Do not change scripts, Codex processes, or the production LaunchAgent yet. Plan 2 supplies the controller, lifecycle commands, platform registration, and controlled migration.
