import assert from "node:assert/strict";
import test from "node:test";

import {
  controllerInjectionPreference,
  runCli,
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
    detached: [],
    migrate: [],
    preflight: [],
    registerEphemeral: [],
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
    createController: () => controller,
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
