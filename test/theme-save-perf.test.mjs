import assert from "node:assert/strict";
import test from "node:test";

import { createSkinController } from "../src/controller.mjs";
import {
  createControllerPortOwnerValidator,
  createWindowsRuntimeProbe,
} from "../src/cli.mjs";

const CONTROL_TOKEN = Buffer.alloc(32, 6).toString("base64url");

function clone(value) {
  return structuredClone(value);
}

function fixture(overrides = {}) {
  const processIdentity = overrides.processIdentity ?? {
    pid: 4242,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Thu Jul 16 16:49:24 2026",
  };
  let state = {
    schemaVersion: 2,
    persistenceEnabled: true,
    selectedThemeId: "miku-488137",
    lastNonNativeThemeId: "miku-488137",
    controlToken: CONTROL_TOKEN,
    lastTransitionNonce: null,
    revision: 1,
  };
  let session = {
    schemaVersion: 1,
    mode: "active",
    process: clone(processIdentity),
    activeThemeId: "miku-488137",
    keepUntilProcessExit: false,
  };
  const calls = {
    lease: [],
    validateTheme: [],
    probe: [],
    validatePort: [],
    compareAndUpdate: [],
    writeSession: [],
    inject: [],
    observe: [],
  };
  const deps = {
    withLease: async (operation, action) => {
      calls.lease.push(operation);
      return action(Object.freeze({ operation }));
    },
    readState: async () => clone(state),
    readSession: async () => clone(session),
    readTransition: async () => null,
    writeJournal: async () => {},
    compareAndUpdate: async ({ expectedRevision, mutate }) => {
      calls.compareAndUpdate.push({ expectedRevision });
      assert.equal(state.revision, expectedRevision);
      state = {
        ...mutate(clone(state)),
        revision: state.revision + 1,
      };
      return clone(state);
    },
    writeSession: async (next) => {
      calls.writeSession.push(clone(next));
      session = clone(next);
      return clone(session);
    },
    clearJournal: async () => {},
    recoverTransition: async () => ({ recovered: false }),
    probeCurrentProcess: async () => {
      calls.probe.push(true);
      return clone(processIdentity);
    },
    validatePortOwner: async (candidate) => {
      calls.validatePort.push(clone(candidate));
      return candidate?.pid === processIdentity.pid;
    },
    validateThemeSelection: async (themeId) => {
      calls.validateTheme.push(themeId);
      return overrides.validThemes?.includes(themeId) ?? true;
    },
    injectSkin: async (input) => {
      calls.inject.push(clone(input));
      return { applied: 1, targets: ["main"], failed: [] };
    },
    removeSkin: async () => ({ removed: 1 }),
    startControlServer: async () => ({
      host: "127.0.0.1",
      port: 43123,
      close: async () => {},
    }),
    registerBackground: async () => ({ registered: true, started: true }),
    unregisterBackground: async () => ({ registered: false, loaded: false }),
    inspectBackground: async () => ({
      registered: true,
      running: true,
      loaded: true,
      processIdentity: clone(processIdentity),
    }),
    wakeBackground: async () => {},
    prepareBackgroundHandshake: async () => ({ notBefore: 1 }),
    verifyBackgroundHandshake: async () => clone(processIdentity),
    inspectSkin: async () => ({
      healthy: true,
      mode: "active",
      themeId: state.selectedThemeId,
      targets: ["main"],
      unhealthy: [],
    }),
    observe: async (event, value) => {
      calls.observe.push({ event, value: clone(value) });
    },
    logger: {
      info: async () => true,
      warn: async () => true,
      error: async () => true,
    },
    currentVersion: "5.4.0",
    checkForUpdate: async () => ({
      status: "latest",
      currentVersion: "5.4.0",
      latestVersion: "5.4.0",
      releaseUrl: "https://github.com/HeiGeAi/heige-codex-skin-studio/releases/tag/v5.4.0",
    }),
    deliverUpdateCheckResult: async () => true,
    ...overrides.deps,
  };
  return {
    deps,
    calls,
    get state() { return state; },
    set state(value) { state = value; },
    processIdentity,
  };
}

test("theme selection save stays inside deterministic operation budgets", async () => {
  const fx = fixture({ validThemes: ["genshin-night"] });
  const controller = createSkinController(fx.deps);
  await controller.start();
  fx.calls.lease.length = 0;
  fx.calls.probe.length = 0;
  fx.calls.validatePort.length = 0;
  fx.calls.validateTheme.length = 0;
  fx.calls.compareAndUpdate.length = 0;
  fx.calls.writeSession.length = 0;
  fx.calls.inject.length = 0;
  fx.calls.observe.length = 0;

  const changed = await controller.setThemeSelection({
    expectedRevision: 1,
    themeId: "genshin-night",
    requestId: "a".repeat(32),
  });

  assert.equal(changed.selectedThemeId, "genshin-night");
  assert.equal(changed.revision, 2);
  assert.deepEqual(fx.calls.lease, ["controller:set-theme-selection"]);
  assert.equal(fx.calls.probe.length, 1);
  assert.equal(fx.calls.validatePort.length, 1);
  assert.deepEqual(fx.calls.validateTheme, ["genshin-night"]);
  assert.equal(fx.calls.compareAndUpdate.length, 1);
  assert.equal(fx.calls.writeSession.length, 1);
  assert.equal(fx.calls.inject.length, 0);
  assert.ok(fx.calls.observe.some((entry) =>
    entry.event === "theme_selection_phase" && entry.value.phase === "total"));
});

test("duplicate theme requestId joins the in-flight commit without a second CAS", async () => {
  const fx = fixture({ validThemes: ["genshin-night"] });
  let releaseThemeValidation;
  const validationGate = new Promise((resolve) => {
    releaseThemeValidation = resolve;
  });
  let enteredValidation;
  const sawValidation = new Promise((resolve) => {
    enteredValidation = resolve;
  });
  fx.deps.validateThemeSelection = async (themeId) => {
    fx.calls.validateTheme.push(themeId);
    enteredValidation();
    await validationGate;
    return themeId === "genshin-night";
  };
  const controller = createSkinController(fx.deps);
  await controller.start();
  fx.calls.validateTheme.length = 0;
  fx.calls.compareAndUpdate.length = 0;
  fx.calls.probe.length = 0;

  const httpCommit = controller.setThemeSelection({
    expectedRevision: 1,
    themeId: "genshin-night",
    requestId: "b".repeat(32),
  });
  await sawValidation;
  assert.equal(fx.calls.validateTheme.length, 1);

  const rendererJoin = controller.setThemeSelection({
    expectedRevision: 1,
    themeId: "genshin-night",
    requestId: "b".repeat(32),
  });

  releaseThemeValidation();
  const [httpResult, joinedResult] = await Promise.all([httpCommit, rendererJoin]);
  assert.deepEqual(httpResult, joinedResult);
  assert.equal(fx.calls.validateTheme.length, 1);
  assert.equal(fx.calls.compareAndUpdate.length, 1);
  assert.equal(fx.calls.probe.length, 1);
});

test("Windows runtime probe reuses one snapshot for the following port proof", async () => {
  let queries = 0;
  const processIdentity = {
    pid: 4242,
    executablePath: "C:\\Program Files\\Codex\\Codex.exe",
    startedAt: "2026-07-17T08:00:00.0000000Z",
  };
  const probe = createWindowsRuntimeProbe({
    port: 9341,
    queryWindowsRuntime: async () => {
      queries += 1;
      return {
        schemaVersion: 1,
        app: {
          kind: "Win32",
          executablePath: processIdentity.executablePath,
          installPath: "C:\\Program Files\\Codex",
          productName: "Codex",
          packageFullName: null,
          aumid: null,
          launchTarget: processIdentity.executablePath,
        },
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        processes: [{
          pid: processIdentity.pid,
          parentProcessId: 4,
          executablePath: processIdentity.executablePath,
          startedAt: processIdentity.startedAt,
        }],
        listeners: [{
          pid: processIdentity.pid,
          executablePath: processIdentity.executablePath,
          processName: "Codex",
          startedAt: processIdentity.startedAt,
          localAddress: "127.0.0.1",
          localPort: 9341,
        }],
      };
    },
  });

  const observed = await probe();
  assert.deepEqual(observed, processIdentity);
  assert.equal(probe.consumePortProof(processIdentity), true);
  assert.equal(probe.consumePortProof(processIdentity), false);
  assert.equal(queries, 1);
});

test("Windows runtime probe discards unused port proof after a trailing snapshot", async () => {
  const processIdentity = {
    pid: 4242,
    executablePath: "C:\\Program Files\\Codex\\Codex.exe",
    startedAt: "2026-07-17T08:00:00.0000000Z",
  };
  const probe = createWindowsRuntimeProbe({
    port: 9341,
    queryWindowsRuntime: async () => ({
      schemaVersion: 1,
      app: {
        kind: "Win32",
        executablePath: processIdentity.executablePath,
        installPath: "C:\\Program Files\\Codex",
        productName: "Codex",
        packageFullName: null,
        aumid: null,
        launchTarget: processIdentity.executablePath,
      },
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      processes: [{
        pid: processIdentity.pid,
        parentProcessId: 4,
        executablePath: processIdentity.executablePath,
        startedAt: processIdentity.startedAt,
      }],
      listeners: [{
        pid: processIdentity.pid,
        executablePath: processIdentity.executablePath,
        processName: "Codex",
        startedAt: processIdentity.startedAt,
        localAddress: "127.0.0.1",
        localPort: 9341,
      }],
    }),
  });

  await probe();
  probe.discardPortProof();
  assert.equal(probe.consumePortProof(processIdentity), false);
});

test("healthy tick stays within the Windows two-command runtime budget", async () => {
  const processIdentity = {
    pid: 4242,
    executablePath: "C:\\Program Files\\Codex\\Codex.exe",
    startedAt: "2026-07-17T08:00:00.0000000Z",
  };
  let powershellCommands = 0;
  const probe = createWindowsRuntimeProbe({
    port: 9341,
    queryWindowsRuntime: async () => {
      powershellCommands += 1;
      return {
        schemaVersion: 1,
        app: {
          kind: "Win32",
          executablePath: processIdentity.executablePath,
          installPath: "C:\\Program Files\\Codex",
          productName: "Codex",
          packageFullName: null,
          aumid: null,
          launchTarget: processIdentity.executablePath,
        },
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        processes: [{
          pid: processIdentity.pid,
          parentProcessId: 4,
          executablePath: processIdentity.executablePath,
          startedAt: processIdentity.startedAt,
        }],
        listeners: [{
          pid: processIdentity.pid,
          executablePath: processIdentity.executablePath,
          processName: "Codex",
          startedAt: processIdentity.startedAt,
          localAddress: "127.0.0.1",
          localPort: 9341,
        }],
      };
    },
  });
  const validatePortOwner = createControllerPortOwnerValidator({
    platform: "win32",
    port: 9341,
    probe,
    windowsProbe: probe,
  });
  const fx = fixture({
    processIdentity,
    deps: {
      probeCurrentProcess: probe,
      validatePortOwner,
      discardPortProof: probe.discardPortProof,
    },
  });
  const controller = createSkinController(fx.deps);
  await controller.start();
  powershellCommands = 0;

  const current = await controller.tick();

  assert.equal(current.action, "idle");
  assert.equal(powershellCommands, 2);
  assert.equal(probe.consumePortProof(processIdentity), false);
});

test("healthy tick stays within the macOS two-ps one-lsof command budget", async () => {
  const processIdentity = {
    pid: 4242,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Thu Jul 16 16:49:24 2026",
  };
  let psCommands = 0;
  let lsofCommands = 0;
  const probe = async () => {
    psCommands += 1;
    return clone(processIdentity);
  };
  const validatePortOwner = createControllerPortOwnerValidator({
    platform: "darwin",
    port: 9341,
    probe,
    validatePortOwnerImpl: async (port, candidate, options) => {
      lsofCommands += 1;
      assert.equal(port, 9341);
      assert.deepEqual(candidate, processIdentity);
      assert.deepEqual(options, { platform: "darwin" });
      return true;
    },
  });
  const fx = fixture({
    processIdentity,
    deps: {
      probeCurrentProcess: probe,
      validatePortOwner,
    },
  });
  const controller = createSkinController(fx.deps);
  await controller.start();
  psCommands = 0;
  lsofCommands = 0;

  const current = await controller.tick();

  assert.equal(current.action, "idle");
  assert.equal(psCommands, 2);
  assert.equal(lsofCommands, 1);
});
