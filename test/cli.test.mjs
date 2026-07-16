import assert from "node:assert/strict";
import test from "node:test";

import {
  controllerInjectionPreference,
  normalizeWindowsBackgroundStatus,
  probeWindowsCdpProcess,
  runCli,
  runControllerProcess,
  validatePortOwner,
  waitForAppliedSkin,
} from "../src/cli.mjs";

function deps(overrides = {}) {
  return {
    bundledThemesRoot: "/bundle/themes",
    userThemesRoot: "/user/themes",
    listThemes: async () => [{ id: "miku-488137", name: "Miku", path: "/bundle/themes/miku-488137" }],
    loadTheme: async (path) => ({ manifest: { id: path.split("/").at(-1) }, heroPath: "/tmp/hero.png" }),
    applySkin: async ({ loadedTheme, port }) => ({ applied: 1, themeId: loadedTheme.manifest.id, port }),
    removeSkin: async () => ({ removed: 1 }),
    skinStatus: async () => [{ installed: true, themeId: "miku-488137" }],
    createSingleImageTheme: async ({ imagePath, name }) => ({ id: "new-skin", imagePath, name }),
    ...overrides,
  };
}

function lifecycleDeps(overrides = {}) {
  let state = {
    schemaVersion: 2,
    persistenceEnabled: false,
    selectedThemeId: "miku-488137",
    lastNonNativeThemeId: "miku-488137",
    controlToken: Buffer.alloc(32, 7).toString("base64url"),
    lastTransitionNonce: null,
    revision: 5,
  };
  const calls = {
    controller: [],
    createController: [],
    detached: [],
    migrate: [],
    preflight: [],
    registerEphemeral: [],
    runController: [],
  };
  const controller = {
    pause: async () => ({ mode: "paused" }),
    resume: async () => ({ mode: "active" }),
    restore: async () => ({ mode: "restoring", persistenceEnabled: false }),
    setPersistence: async ({ expectedRevision, enabled }) => {
      calls.controller.push({ expectedRevision, enabled });
      state = { ...state, persistenceEnabled: enabled, revision: state.revision + 1 };
      return { persistenceEnabled: state.persistenceEnabled, revision: state.revision };
    },
    start: async () => ({ action: "idle", mode: "active" }),
    stop: async () => ({ stopped: true }),
  };
  const fixture = deps({
    nodeVersion: "v22.14.0",
    readState: async () => structuredClone(state),
    preflightLifecycle: async (input) => {
      calls.preflight.push(structuredClone(input));
      if (overrides.validatePortOwner === false) throw new Error("端口不属于目标 Codex");
      return {
        appPath: "/Applications/ChatGPT.app",
        nodePath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node",
        process: {
          pid: 4242,
          executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
          startedAt: "Fri Jul 17 11:00:00 2026",
        },
      };
    },
    registerEphemeralController: async (input) => {
      calls.registerEphemeral.push(structuredClone(input));
      return { mode: "active" };
    },
    createController: (input) => {
      calls.createController.push(structuredClone(input));
      return controller;
    },
    runController: async (instance, input) => {
      calls.runController.push(structuredClone(input));
      return instance.start();
    },
    restartDetached: async (input) => {
      calls.detached.push(structuredClone(input));
      return { queued: true };
    },
    migrateLegacy: async (input) => {
      calls.migrate.push(structuredClone(input));
      return { migratedFrom: "watchdog", persistenceEnabled: true };
    },
    ...overrides,
  });
  return {
    deps: fixture,
    calls,
    controller,
    get state() { return structuredClone(state); },
  };
}

test("lists the bundled Miku preset by default", async () => {
  assert.deepEqual(await runCli(["list"], deps()), [{ id: "miku-488137", name: "Miku", path: "/bundle/themes/miku-488137" }]);
});

test("creates a skin directly from one image", async () => {
  assert.deepEqual(
    await runCli(["create", "--image", "/tmp/art.webp", "--name", "Fast Skin"], deps()),
    { id: "new-skin", imagePath: "/tmp/art.webp", name: "Fast Skin" },
  );
});

test("customize keeps the Finder workflow in JavaScript and applies the created theme", async () => {
  const fx = lifecycleDeps({
    chooseThemeInputs: async () => ({ imagePath: "/tmp/art.webp", name: "Fast Skin" }),
    createSingleImageTheme: async ({ imagePath, name }) => ({ id: "new-skin", imagePath, name }),
    listThemes: async () => [
      { id: "miku-488137", name: "Miku", path: "/bundle/themes/miku-488137" },
      { id: "new-skin", name: "Fast Skin", path: "/user/themes/new-skin" },
    ],
  });
  const result = await runCli(["customize"], fx.deps);
  assert.deepEqual(result, {
    created: { id: "new-skin", imagePath: "/tmp/art.webp", name: "Fast Skin" },
    applied: { mode: "active", persistenceEnabled: false },
  });
  assert.equal(fx.calls.registerEphemeral.length, 1);
  assert.equal(fx.calls.registerEphemeral[0].themeId, "new-skin");
});

test("cancelling customize is a clean no-op", async () => {
  let created = false;
  const fx = lifecycleDeps({
    chooseThemeInputs: async () => null,
    createSingleImageTheme: async () => {
      created = true;
    },
  });
  assert.deepEqual(await runCli(["customize"], fx.deps), { cancelled: true });
  assert.equal(created, false);
  assert.deepEqual(fx.calls.registerEphemeral, []);
});

test("rejects unknown commands and missing options", async () => {
  await assert.rejects(() => runCli(["create", "--image", "/tmp/a.png"], deps()), /--name/);
  await assert.rejects(() => runCli(["launch"], deps()), /未知命令/);
});

test("running through a bin symlink still executes instead of silently no-op", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, symlink } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const run = promisify(execFile);

  const cliPath = resolve(fileURLToPath(new URL("../src/cli.mjs", import.meta.url)));
  const dir = await mkdtemp(join(tmpdir(), "heige-binlink-"));
  const link = join(dir, "heige-codex-skin");
  await symlink(cliPath, link);

  const { stdout } = await run(process.execPath, [link, "help"]);
  assert.match(stdout, /commands/, "通过符号链接调用必须真正执行并输出");
});

test("runtime commands reject Node below 22 before invoking any dependency", async () => {
  let invoked = false;
  const fx = lifecycleDeps({
    nodeVersion: "v20.19.4",
    listThemes: async () => {
      invoked = true;
      return [];
    },
  });
  await assert.rejects(runCli(["list"], fx.deps), /Node\.js 22/);
  assert.equal(invoked, false);
  assert.deepEqual((await runCli(["help"], fx.deps)).commands.includes("apply [--theme ID] [--port 9341]"), true);
});

test("Node 22 is accepted for runtime commands", async () => {
  const fx = lifecycleDeps({ nodeVersion: "22.0.0" });
  assert.equal((await runCli(["list"], fx.deps))[0].id, "miku-488137");
});

test("apply validates everything and registers only an ephemeral current-session controller", async () => {
  const fx = lifecycleDeps();
  const result = await runCli(["apply", "--theme", "miku-488137"], fx.deps);
  assert.deepEqual(result, { mode: "active", persistenceEnabled: false });
  assert.equal(fx.calls.registerEphemeral.length, 1);
  assert.equal(fx.calls.controller.length, 0, "apply must not enable persistence");
  assert.equal(fx.state.persistenceEnabled, false);
});

test("explicit apply ignores an older renderer theme while background repair may reuse it", () => {
  assert.equal(controllerInjectionPreference({ ephemeral: true }), false);
  assert.equal(controllerInjectionPreference({ ephemeral: false }), true);
  assert.equal(controllerInjectionPreference({ ephemeral: false, preferStored: false }), false);
});

test("apply confirmation rejects a partial multi-window status result", async () => {
  const partial = {
    statuses: [{ installed: true, themeId: "miku-488137" }],
    failed: ["second-main"],
    results: {
      succeeded: [{ id: "first-main" }],
      failed: [{ id: "second-main" }],
      skipped: [],
    },
  };
  await assert.rejects(waitForAppliedSkin({
    deps: { skinStatus: async () => partial },
    port: 9341,
    themeId: "miku-488137",
    attempts: 1,
    wait: async () => {},
  }), /未确认皮肤已应用/);
});

test("apply on a native Codex queues one detached CDP restart and applies only after restart", async () => {
  const fx = lifecycleDeps({
    preflightLifecycle: async (input) => {
      fx.calls.preflight.push(structuredClone(input));
      if (input.requirePort) {
        const error = new Error("当前 Codex 尚未启用 CDP");
        error.code = "CDP_NOT_OWNED";
        throw error;
      }
      return {
        appPath: "/Applications/ChatGPT.app",
        nodePath: "/trusted/node",
        process: {
          pid: 4242,
          executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
          startedAt: "Fri Jul 17 11:00:00 2026",
        },
      };
    },
  });
  const result = await runCli(["apply", "--theme", "miku-488137"], fx.deps);
  assert.deepEqual(result, { mode: "restarting", persistenceEnabled: false, queued: true });
  assert.equal(fx.calls.registerEphemeral.length, 0);
  assert.equal(fx.calls.detached.length, 1);
  assert.deepEqual(fx.calls.detached[0].afterLaunch, {
    command: "apply",
    themeId: "miku-488137",
  });
});

test("apply starts a fully closed Codex through a launch-only detached action", async () => {
  const fx = lifecycleDeps({
    preflightLifecycle: async (input) => {
      if (input.requirePort) {
        const error = new Error("当前没有 CDP owner");
        error.code = "CDP_NOT_OWNED";
        throw error;
      }
      return {
        appPath: "/Applications/ChatGPT.app",
        nodePath: "/trusted/node",
        process: null,
      };
    },
  });
  assert.deepEqual(await runCli(["apply"], fx.deps), {
    mode: "restarting",
    persistenceEnabled: false,
    queued: true,
  });
  assert.equal(fx.calls.detached[0].preflight.process, null);
  assert.equal(fx.calls.detached[0].afterLaunch.command, "apply");
});

test("pause resume restore and enable-skin remain distinct lifecycle operations", async () => {
  const fx = lifecycleDeps();
  assert.deepEqual(await runCli(["pause"], fx.deps), { mode: "paused" });
  assert.deepEqual(await runCli(["resume"], fx.deps), { mode: "active" });
  assert.deepEqual(await runCli(["restore"], fx.deps), { mode: "restoring", persistenceEnabled: false });
  assert.deepEqual(await runCli(["enable-skin"], fx.deps), { mode: "active", persistenceEnabled: true });
  assert.deepEqual(await runCli(["set-persistence", "false"], fx.deps), { persistenceEnabled: false, revision: 7 });
  assert.deepEqual(await runCli(["migrate-legacy"], fx.deps), { migratedFrom: "watchdog", persistenceEnabled: true });
  assert.equal(fx.calls.detached.length, 2, "restore and enable-skin each queue one detached restart");
  assert.equal(fx.calls.detached[0].port, 9341, "restore helper must verify the old CDP port was released");
});

test("enable-skin from a native process defers the state transition until the verified CDP restart", async () => {
  const fx = lifecycleDeps({
    preflightLifecycle: async (input) => {
      if (input.requirePort) {
        const error = new Error("当前 Codex 尚未启用 CDP");
        error.code = "CDP_NOT_OWNED";
        throw error;
      }
      return {
        appPath: "/Applications/ChatGPT.app",
        nodePath: "/trusted/node",
        process: {
          pid: 4242,
          executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
          startedAt: "Fri Jul 17 11:00:00 2026",
        },
      };
    },
  });
  const result = await runCli(["enable-skin"], fx.deps);
  assert.deepEqual(result, { mode: "restarting", persistenceEnabled: false, queued: true });
  assert.deepEqual(fx.calls.controller, []);
  assert.deepEqual(fx.calls.detached[0].afterLaunch, {
    command: "enable-after-restart",
    themeId: "miku-488137",
  });
});

test("enable-skin starts a fully closed Codex and completes enable only after launch", async () => {
  const fx = lifecycleDeps({
    preflightLifecycle: async (input) => {
      if (input.requirePort) {
        const error = new Error("当前没有 CDP owner");
        error.code = "CDP_NOT_OWNED";
        throw error;
      }
      return {
        appPath: "/Applications/ChatGPT.app",
        nodePath: "/trusted/node",
        process: null,
      };
    },
  });
  assert.deepEqual(await runCli(["enable-skin"], fx.deps), {
    mode: "restarting",
    persistenceEnabled: false,
    queued: true,
  });
  assert.equal(fx.calls.detached[0].preflight.process, null);
  assert.equal(fx.calls.detached[0].afterLaunch.command, "enable-after-restart");
});

test("restore validates every dependency before Codex can be quit", async () => {
  const fx = lifecycleDeps({ validatePortOwner: false });
  await assert.rejects(runCli(["restore"], fx.deps), /端口不属于目标 Codex/);
  assert.deepEqual(fx.calls.detached, []);
  assert.deepEqual(fx.calls.controller, []);
});

test("theme identifiers use strict equality and are never interpreted as regular expressions", async () => {
  const fx = lifecycleDeps();
  await assert.rejects(runCli(["enable-skin", "--theme", ".*"], fx.deps), /找不到主题/);
  assert.equal(fx.state.lastNonNativeThemeId, "miku-488137");
  assert.deepEqual(fx.calls.detached, []);
  assert.deepEqual(fx.calls.preflight, []);
});

test("set-persistence accepts only the exact boolean words", async () => {
  const fx = lifecycleDeps();
  for (const value of ["TRUE", "0", "yes", "false "]) {
    await assert.rejects(runCli(["set-persistence", value], fx.deps), /true 或 false/);
  }
  assert.deepEqual(fx.calls.controller, []);
});

test("controller command never reports exit-zero success for an error state", async () => {
  const fx = lifecycleDeps({
    createController: () => ({
      start: async () => ({ action: "error", mode: "error" }),
      stop: async () => ({ stopped: true }),
    }),
  });
  await assert.rejects(runCli(["controller", "--once"], fx.deps), /控制器启动或巡检失败/);
});

test("controller CLI rejects dynamic handshake credentials outside the one-shot request file", async () => {
  const taskName = "HeiGe Codex Skin Studio Test 123e4567-e89b-42d3-a456-426614174000";
  await assert.rejects(runCli([
    "controller",
    "--platform",
    "windows",
    "--task-name",
    taskName,
    "--state-directory",
    "/tmp/heige-controller-isolated",
    "--handshake-revision",
    "5",
    "--handshake-nonce",
    "controller-start-5",
  ], lifecycleDeps().deps), /无法识别|handshake/i);
});

test("long-lived Windows controller forwards a fixed background identity without dynamic credentials", async () => {
  const taskName = "HeiGe Codex Skin Studio Test 123e4567-e89b-42d3-a456-426614174000";
  const fx = lifecycleDeps();
  await runCli([
    "controller",
    "--background",
    "--once",
    "--platform",
    "windows",
    "--task-name",
    taskName,
    "--state-directory",
    "/tmp/heige-controller-isolated",
  ], fx.deps);
  assert.equal(fx.calls.createController[0].background, true);
  assert.equal(fx.calls.runController[0].startupHandshake, null);
  assert.deepEqual(fx.calls.runController[0].backgroundRuntime, {
    platform: "win32",
    backgroundIdentity: taskName,
  });
});

test("background controller claims one start request before start and publishes its exact terminal ACK", async () => {
  const events = [];
  const request = {
    schemaVersion: 1,
    revision: 8,
    transitionNonce: "controller-transition-8",
    platform: "win32",
    backgroundIdentity: "HeiGe Codex Skin Studio Controller",
    createdAt: "2026-07-17T08:00:00.000Z",
  };
  const result = await runControllerProcess({
    start: async () => {
      events.push("start");
      return {
        action: "idle",
        mode: "active",
        persistenceEnabled: true,
        revision: 8,
      };
    },
    stop: async () => events.push("stop"),
  }, {
    once: true,
    backgroundRuntime: {
      platform: "win32",
      backgroundIdentity: "HeiGe Codex Skin Studio Controller",
    },
    paths: { stateRoot: "C:\\PrivateState" },
    claimStartRequest: async (input) => {
      events.push(["claim", input]);
      return request;
    },
    readCurrentIdentity: async () => ({ pid: process.pid, startedAt: "exact-start" }),
    publishHandshake: async (input) => events.push(["publish", input]),
  });
  assert.equal(result.revision, 8);
  assert.deepEqual(events.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "claim",
    "start",
    "publish",
    "stop",
  ]);
  assert.deepEqual(events[2][1], {
    stateRoot: "C:\\PrivateState",
    revision: 8,
    transitionNonce: "controller-transition-8",
    platform: "win32",
    backgroundIdentity: "HeiGe Codex Skin Studio Controller",
    pid: process.pid,
    startedAt: "exact-start",
    outcome: "ready",
  });
});

test("background login with no one-shot request follows the latest revision without forging an ACK", async () => {
  const events = [];
  const result = await runControllerProcess({
    start: async () => {
      events.push("start");
      return {
        action: "idle",
        mode: "active",
        persistenceEnabled: true,
        revision: 19,
      };
    },
    stop: async () => events.push("stop"),
  }, {
    once: true,
    backgroundRuntime: {
      platform: "darwin",
      backgroundIdentity: "com.heige.codex-skin-controller",
    },
    paths: { stateRoot: "/private/state" },
    claimStartRequest: async () => {
      events.push("claim");
      return null;
    },
    publishHandshake: async () => events.push("publish"),
  });
  assert.equal(result.revision, 19, "a later theme CAS revision must not break login startup");
  assert.deepEqual(events, ["claim", "start", "stop"]);
});

test("Windows CDP probe and validation use one exact Get-NetTCPConnection owner, never lsof", async () => {
  const calls = [];
  const identity = {
    pid: 4242,
    executablePath: "C:\\Program Files\\Codex\\Codex.exe",
    startedAt: "2026-07-17T08:00:00.0000000Z",
  };
  const execFileImpl = async (file, args) => {
    calls.push([file, ...args]);
    return {
      stdout: JSON.stringify([{
        ...identity,
        processName: "Codex",
        localAddress: "127.0.0.1",
        localPort: 9341,
      }]),
    };
  };
  assert.deepEqual(await probeWindowsCdpProcess(9341, {
    execFileImpl,
    powershellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  }), identity);
  assert.equal(await validatePortOwner(9341, identity, {
    platform: "win32",
    execFileImpl,
    powershellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  }), true);
  assert.equal(calls.every((entry) => !entry.includes("/usr/sbin/lsof")), true);
  assert.equal(calls.every((entry) => entry.join(" ").includes("Get-NetTCPConnection")), true);
});

test("Windows CDP validation rejects non-loopback, multiple, and exact identity mismatches", async (t) => {
  const exact = {
    pid: 4242,
    executablePath: "C:\\Program Files\\Codex\\Codex.exe",
    startedAt: "2026-07-17T08:00:00.0000000Z",
    processName: "Codex",
    localAddress: "127.0.0.1",
    localPort: 9341,
  };
  for (const [name, records] of [
    ["non-loopback", [{ ...exact, localAddress: "0.0.0.0" }]],
    ["multiple", [exact, { ...exact, pid: 5252 }]],
    ["non-Codex", [{ ...exact, processName: "node" }]],
  ]) {
    await t.test(name, async () => {
      const execFileImpl = async () => ({ stdout: JSON.stringify(records) });
      await assert.rejects(probeWindowsCdpProcess(9341, {
        execFileImpl,
        powershellPath: "powershell.exe",
      }), /owner|loopback|unique|Codex|process/i);
      assert.equal(await validatePortOwner(9341, exact, {
        platform: "win32",
        execFileImpl,
        powershellPath: "powershell.exe",
      }), false);
    });
  }
  const mismatchExec = async () => ({ stdout: JSON.stringify([exact]) });
  assert.equal(await validatePortOwner(9341, {
    ...exact,
    startedAt: "2026-07-17T08:01:00.0000000Z",
  }, {
    platform: "win32",
    execFileImpl: mismatchExec,
    powershellPath: "powershell.exe",
  }), false);
  assert.equal(await probeWindowsCdpProcess(9341, {
    execFileImpl: async () => ({ stdout: "[]" }),
    powershellPath: "powershell.exe",
  }), null, "a closed CDP port is a normal wait-for-app state");
});

test("Windows task registration is distinct from exact running readiness", () => {
  assert.deepEqual(normalizeWindowsBackgroundStatus({
    Exists: true,
    State: "Ready",
    TaskRunning: false,
  }), {
    registered: true,
    running: false,
  });
  assert.deepEqual(normalizeWindowsBackgroundStatus({
    Exists: true,
    State: "Running",
    TaskRunning: true,
  }), {
    registered: true,
    running: true,
  });
  assert.deepEqual(normalizeWindowsBackgroundStatus({
    Exists: false,
    State: "Absent",
    TaskRunning: false,
  }), {
    registered: false,
    running: false,
  });
});

test("controller CLI rejects case-drifted task names duplicate flags and unsafe Windows state roots", async () => {
  const taskName = "HeiGe Codex Skin Studio Test 123e4567-e89b-42d3-a456-426614174000";
  await assert.rejects(runCli([
    "controller",
    "--platform",
    "windows",
    "--task-name",
    taskName,
    "--state-directory",
    "/tmp/heige-controller-isolated",
    "--handshake-revision",
    "5",
  ], lifecycleDeps().deps), /无法识别|handshake/i);
  await assert.rejects(runCli([
    "controller",
    "--platform",
    "windows",
    "--task-name",
    "heige Codex Skin Studio Test 123e4567-e89b-42d3-a456-426614174000",
    "--state-directory",
    "/tmp/heige-controller-isolated",
  ], lifecycleDeps().deps), /TaskName|允许范围/i);
  await assert.rejects(runCli([
    "controller",
    "--platform",
    "windows",
    "--task-name",
    taskName,
    "--state-directory",
    "relative-state",
  ], lifecycleDeps().deps), /绝对|absolute/i);
  await assert.rejects(runCli([
    "controller",
    "--platform",
    "windows",
    "--platform",
    "windows",
    "--task-name",
    taskName,
  ], lifecycleDeps().deps), /重复/);
});

test("background controller publishes ready only after exact successful start", async () => {
  const calls = [];
  const controller = {
    start: async () => ({
      action: "idle",
      mode: "active",
      persistenceEnabled: true,
      revision: 8,
    }),
    stop: async () => calls.push("stop"),
  };
  const startupHandshake = {
    revision: 8,
    transitionNonce: "controller-transition-8",
    platform: "darwin",
    backgroundIdentity: "com.heige.codex-skin-controller",
  };
  const result = await runControllerProcess(controller, {
    once: true,
    startupHandshake,
    paths: { stateRoot: "/private/state" },
    readCurrentIdentity: async () => ({ pid: process.pid, startedAt: "exact-start" }),
    publishHandshake: async (input) => calls.push(input),
  });
  assert.equal(result.action, "idle");
  assert.deepEqual(calls, [{
    stateRoot: "/private/state",
    ...startupHandshake,
    pid: process.pid,
    startedAt: "exact-start",
    outcome: "ready",
  }, "stop"]);
});

test("disabled background publishes unregister promptly and a wrong revision publishes nothing", async () => {
  const published = [];
  let stoppedAfterMismatch = false;
  const startupHandshake = {
    revision: 4,
    transitionNonce: "controller-start-4",
    platform: "win32",
    backgroundIdentity: "HeiGe Codex Skin Studio Controller",
  };
  const unregister = await runControllerProcess({
    start: async () => ({
      action: "unregister",
      mode: "native",
      persistenceEnabled: false,
      revision: 4,
    }),
    stop: async () => { stoppedAfterMismatch = true; },
  }, {
    startupHandshake,
    paths: { stateRoot: "C:\\State" },
    readCurrentIdentity: async () => ({ pid: process.pid, startedAt: "exact-start" }),
    publishHandshake: async (input) => published.push(input),
  });
  assert.equal(unregister.action, "unregister");
  assert.equal(published[0].outcome, "unregister");
  stoppedAfterMismatch = false;

  await assert.rejects(runControllerProcess({
    start: async () => ({
      action: "idle",
      mode: "active",
      persistenceEnabled: true,
      revision: 5,
    }),
    stop: async () => { stoppedAfterMismatch = true; },
  }, {
    once: true,
    startupHandshake,
    paths: { stateRoot: "C:\\State" },
    readCurrentIdentity: async () => ({ pid: process.pid, startedAt: "exact-start" }),
    publishHandshake: async (input) => published.push(input),
  }), /revision/i);
  assert.equal(published.length, 1);
  assert.equal(stoppedAfterMismatch, true);
});

test("install-pet CLI routing remains intact", async () => {
  const calls = [];
  const result = await runCli(["install-pet", "--source", "/tmp/pet-source"], deps({
    nodeVersion: "v22.14.0",
    home: "/Users/tester",
    installPet: async (input) => {
      calls.push(input);
      return { installed: true };
    },
  }));
  assert.deepEqual(result, { installed: true });
  assert.deepEqual(calls, [{ sourceRoot: "/tmp/pet-source", home: "/Users/tester" }]);
});
