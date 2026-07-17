# macOS Install Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first install, Codex relaunch, lifecycle diagnosis and custom-pet activation truthful and self-explanatory.

**Architecture:** Bootstrap only the trusted state root before nested locks, launch the verified app executable directly with argv, verify the resulting CDP process before continuation, return bounded lifecycle stage diagnostics, and make pet restart requirements part of the CLI result.

**Tech Stack:** Node.js 22, macOS process APIs, POSIX permissions, atomic JSON result files, `node:test`.

---

### Task 1: Trusted first-install state root

**Files:**
- Create: `src/macos-state-root.mjs`
- Create: `test/macos-state-root.test.mjs`
- Modify: `src/macos-install-coordinator.mjs`
- Modify: `scripts/skill-package-manifest.json`

- [ ] **Step 1: Write failing filesystem tests**

Cover an absent root, an owned `0755` real directory, a symlink root and an unowned metadata adapter. The successful result must be:

```js
assert.deepEqual(result, { created: true, permissionsTightened: false });
assert.equal((await lstat(stateRoot)).mode & 0o777, 0o700);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/macos-state-root.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement secure bootstrap**

Export `ensureMacosStateRoot(stateRoot, dependencies)` that validates an absolute canonical path, verifies existing ancestors are real directories, creates the leaf with `0700`, and only calls `chmod(0700)` for a real directory owned by `process.getuid()`.

- [ ] **Step 4: Call bootstrap before dependency construction**

Invoke it in both `runProductionMacosInstall` and recovery before `productionMacosInstallDependencies`, so `macos-install-operation` never becomes the first creator.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test test/macos-state-root.test.mjs test/macos-install-coordinator.test.mjs`

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/macos-state-root.mjs test/macos-state-root.test.mjs src/macos-install-coordinator.mjs scripts/skill-package-manifest.json
git commit -m "fix: bootstrap trusted macOS state root"
```

### Task 2: Direct verified app launch

**Files:**
- Modify: `test/scripts.test.mjs`
- Modify: `src/lifecycle-helper.mjs`

- [ ] **Step 1: Write failing launch tests**

Inject `spawnImpl` and assert the exact executable is launched without a shell:

```js
assert.equal(command, "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT");
assert.deepEqual(args, [
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9341",
]);
assert.equal(options.detached, true);
assert.equal(options.shell, false);
```

Also assert continuation does not run until `readCdpProcess` verifies the new exact owner.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="direct verified|continuation.*verified" test/scripts.test.mjs`

Expected: FAIL because the default launcher still calls `/usr/bin/open`.

- [ ] **Step 3: Implement direct launch**

Replace `defaultLaunchApp` with a detached spawn of `join(appPath, "Contents", "MacOS", "ChatGPT")`, using fixed stdio and no shell. Wait for its `spawn` event, reject asynchronous errors and unref only after a valid PID.

- [ ] **Step 4: Verify CDP ownership before continuation**

After `waitForPort(action.port)`, call `readCdpProcess({ appPath, port })` and require the exact executable before `runAfterLaunch`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test test/scripts.test.mjs`

Expected: all lifecycle script tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lifecycle-helper.mjs test/scripts.test.mjs
git commit -m "fix: launch and verify the exact Codex executable"
```

### Task 3: Pet restart contract

**Files:**
- Modify: `test/pet-installer.test.mjs`
- Modify: `test/custom-pet.test.mjs`
- Modify: `src/pet-installer.mjs`

- [ ] **Step 1: Write failing result tests**

Assert a changed config returns:

```js
assert.equal(result.restartRequired, true);
assert.equal(result.effectivePetId, "custom:miku-future");
assert.match(result.nextAction, /重启 Codex/);
```

An idempotent reinstall must return `restartRequired: false` and `nextAction: null`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/pet-installer.test.mjs test/custom-pet.test.mjs`

Expected: FAIL because the fields are absent.

- [ ] **Step 3: Implement the result contract**

Add the three fields to the frozen result. `restartRequired` is exactly `Boolean(configTransaction?.changed)`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test test/pet-installer.test.mjs test/custom-pet.test.mjs`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pet-installer.mjs test/pet-installer.test.mjs test/custom-pet.test.mjs
git commit -m "fix: report when a custom pet needs restart"
```

### Task 4: Bounded lifecycle diagnostics

**Files:**
- Modify: `test/scripts.test.mjs`
- Modify: `src/lifecycle-helper.mjs`

- [ ] **Step 1: Write failing sidecar tests**

Assert failed results contain only exact keys for `code`, `message`, `stage`, `compensated` and bounded `diagnostics`, with no environment, token or stack.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="lifecycle.*stage|safe failure sidecar" test/scripts.test.mjs`

Expected: FAIL because current sidecars omit stage diagnostics.

- [ ] **Step 3: Implement stage tracking**

Track the last completed finite stage inside `executeLifecycleAction`, attach it through the private failure symbol, and serialize only allowlisted booleans and fixed launch mode values.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test test/scripts.test.mjs`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle-helper.mjs test/scripts.test.mjs
git commit -m "fix: report bounded lifecycle failure stages"
```

### Task 5: Release and full verification

**Files:**
- Modify: `output/heige-codex-skin-studio.skill`
- Modify: `docs/release/2026-07-16-audit-hardening-disposition.md`

- [ ] **Step 1: Run the full suite**

Run: `npm test`

Expected: all non-live tests pass.

- [ ] **Step 2: Rebuild the deterministic artifact**

Run:

```bash
node scripts/package-skill.mjs \
  --output "/Users/blakexu/Documents/Codex 皮肤/output/heige-codex-skin-studio.skill" \
  --source-date-epoch 1784160000
```

Use the repository’s exported `TRACKED_PACKAGE_SOURCE_DATE_EPOCH` value if it differs.

- [ ] **Step 3: Update the release hash**

Run the existing `scripts/update-release-hash.mjs` CLI against the tracked package and disposition file.

- [ ] **Step 4: Run the full suite again**

Run: `npm test`

Expected: 0 failures, with only explicit live-platform skips.

- [ ] **Step 5: Commit**

```bash
git add output/heige-codex-skin-studio.skill docs/release/2026-07-16-audit-hardening-disposition.md
git commit -m "build: refresh deterministic skill package"
```
