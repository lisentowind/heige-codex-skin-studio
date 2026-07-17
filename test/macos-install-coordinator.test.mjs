import assert from "node:assert/strict";
import test from "node:test";

import {
  coordinateMacosInstall,
  coordinateMacosInstallRecovery,
  observeLegacyRendererSelection,
  recoverMacosInstallTransaction,
} from "../src/macos-install-coordinator.mjs";
import { NATIVE_THEME_ID } from "../src/constants.mjs";

const INPUT = Object.freeze({
  home: "/Users/tester",
  port: 9341,
  sourceRoot: "/source",
  stateRoot: "/Users/tester/Library/Application Support/HeiGeCodexSkinStudio",
  targetRoot: "/Users/tester/.codex/heige-codex-skin-studio",
});

function hardCrash(message) {
  const error = new Error(message);
  error.simulatedHardCrash = true;
  return error;
}

function fixture({
  persistenceEnabled = false,
  services = {},
  rendererSelection = null,
  rendererSelectionError = null,
  checkpoint = null,
  ready = null,
  crashAt = null,
  actionCrashAt = null,
} = {}) {
  const events = [];
  let journal = null;
  let crashInjected = false;
  const transactionId = "123e4567-e89b-42d3-a456-426614174000";
  const tree = { transactionId, kind: "tree" };
  const launcher = { transactionId, kind: "launcher" };
  const state = {
    transactionId,
    afterState: {
      schemaVersion: 1,
      persistenceEnabled,
      revision: persistenceEnabled ? 4 : 0,
      controlToken: "token",
    },
  };
  const freeze = { transactionId, operation: "freeze-stable-services" };
  const readyProcessIdentity = {
    pid: 8201,
    startedAt: "Fri Jul 17 16:40:00 2026",
  };
  const mark = (name, value) => {
    events.push(value === undefined ? name : [name, value]);
  };
  const crashAfter = (name) => {
    if (actionCrashAt === name && !crashInjected) {
      crashInjected = true;
      throw hardCrash(`action crash at ${name}`);
    }
  };
  const deps = {
    journalPath: "/Users/tester/Library/Application Support/HeiGeCodexSkinStudio/macos-install.json",
    randomUUID: () => transactionId,
    withCoordinatorLock: async (action) => {
      mark("coordinator-lock");
      return action();
    },
    acquireTreeLock: async () => ({
      release: async () => mark("tree-unlock"),
    }),
    acquireLauncherLock: async (options) => {
      mark("launcher-lock", options);
      return {
        applicationsPriorExisted: true,
        release: async () => mark("launcher-unlock"),
      };
    },
    readJournal: async () => journal,
    createJournal: async (input) => {
      mark("journal-create");
      journal = {
        ...input,
        decision: "undecided",
        phase: "skeleton",
        activation: "pending",
        treeParticipant: null,
        launcherParticipant: null,
        stateParticipant: null,
        freezeParticipant: null,
        ack: null,
      };
      return journal;
    },
    updateJournal: async (current, changes) => {
      assert.equal(current, journal);
      mark("journal-update", changes.phase);
      journal = { ...journal, ...changes };
      return journal;
    },
    clearJournal: async () => {
      mark("journal-clear");
      if (crashAt === "journal-clear" && !crashInjected) {
        crashInjected = true;
        throw hardCrash("crash at journal-clear");
      }
      journal = null;
    },
    recoverStandaloneTree: async () => mark("tree-recover-under-lock"),
    recoverTreePreparation: async () => mark("tree-preparation-recover"),
    recoverLauncherPreparation: async () => mark("launcher-preparation-recover"),
    inspectServices: async () => ({
      controllerLoaded: false,
      controllerPresent: false,
      legacyLoaded: false,
      legacyPresent: false,
      ...services,
    }),
    inspectRendererSelection: async (input) => {
      mark("renderer-selection", input);
      if (rendererSelectionError !== null) throw rendererSelectionError;
      return rendererSelection;
    },
    prepareTree: async () => {
      mark("tree-prepare");
      crashAfter("tree-prepare");
      return tree;
    },
    publishTree: async () => {
      mark("tree-publish");
      crashAfter("tree-publish");
    },
    rollbackTree: async () => {
      mark("tree-rollback");
      crashAfter("tree-rollback");
    },
    finalizeTree: async () => mark("tree-finalize"),
    prepareLauncher: async () => {
      mark("launcher-prepare");
      crashAfter("launcher-prepare");
      return launcher;
    },
    publishLauncher: async () => {
      mark("launcher-publish");
      crashAfter("launcher-publish");
    },
    rollbackLauncher: async () => {
      mark("launcher-rollback");
      crashAfter("launcher-rollback");
    },
    finalizeLauncher: async () => mark("launcher-finalize"),
    prepareState: async (input) => {
      mark("state-prepare", input);
      crashAfter("state-prepare");
      return state;
    },
    publishState: async () => {
      mark("state-publish");
      crashAfter("state-publish");
    },
    rollbackState: async () => {
      mark("state-rollback");
      crashAfter("state-rollback");
    },
    finalizeState: async () => mark("state-finalize"),
    createFreezeDescriptor: async () => (mark("freeze-intent"), freeze),
    prepareFreeze: async () => {
      mark("freeze-prepare");
      crashAfter("freeze-prepare");
      return {
        legacyLoadedBefore: services.legacyLoaded === true,
        servicesFound: true,
        transaction: freeze,
      };
    },
    stopFreezeForRollback: async () => {
      mark("freeze-stop");
      crashAfter("freeze-stop");
    },
    rollbackFreeze: async () => {
      mark("freeze-rollback");
      crashAfter("freeze-rollback");
    },
    finalizeFreezeRollback: async () => {
      mark("freeze-rollback-finalize");
      crashAfter("freeze-rollback-finalize");
    },
    finalizeFreeze: async (_descriptor, options) => mark("freeze-finalize", options),
    verifyAckIdentity: async (identity) => {
      mark("ack-identity-verify", identity);
      return identity?.pid === readyProcessIdentity.pid &&
        identity?.startedAt === readyProcessIdentity.startedAt;
    },
    awaitExactReady: async (input) => {
      mark("ready", input.outerTransaction);
      crashAfter("ready");
      if (ready) return ready(input);
      return {
        persistenceEnabled: true,
        revision: state.afterState.revision,
        processIdentity: { ...readyProcessIdentity },
      };
    },
    checkpoint: async (phase) => {
      mark("checkpoint", phase);
      if (phase === crashAt && !crashInjected) {
        crashInjected = true;
        throw hardCrash(`crash at ${phase}`);
      }
      return checkpoint?.(phase);
    },
  };
  return { deps, events, get journal() { return journal; } };
}

function exactRendererStatus(...values) {
  return {
    statuses: structuredClone(values),
    failed: [],
    results: {
      succeeded: values.map((value, index) => ({
        id: `main-${index + 1}`,
        kind: "main",
        url: "app://-/index.html",
        value: structuredClone(value),
      })),
      failed: [],
      skipped: [],
    },
  };
}

function rendererValue({ mode = "active", themeId = "dalao-dianyan" } = {}) {
  return {
    installed: true,
    generation: "a".repeat(32),
    mode,
    themeId,
    menu: true,
    persistenceEnabled: false,
    revision: 0,
  };
}

test("ordinary non-persistent install never activates a controller and migrates only loaded legacy state", async () => {
  const fx = fixture({ services: { legacyPresent: true, legacyLoaded: false } });
  const result = await coordinateMacosInstall(INPUT, fx.deps);

  assert.equal(result.persistenceEnabled, false);
  assert.equal(fx.events.some((entry) => Array.isArray(entry) && entry[0] === "ready"), false);
  assert.deepEqual(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "state-prepare")[1],
    { transactionId: "123e4567-e89b-42d3-a456-426614174000", legacyAgentLoaded: false },
  );
  assert.deepEqual(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "freeze-finalize")[1],
    { removeFrozenServices: true },
  );
  assert.equal(fx.events.indexOf("tree-recover-under-lock") > fx.events.indexOf("coordinator-lock"), true);
});

test("a residual new controller without state fails closed instead of impersonating legacy intent", async () => {
  const fx = fixture({
    persistenceEnabled: false,
    services: { controllerLoaded: true, controllerPresent: true },
  });
  const result = await coordinateMacosInstall(INPUT, fx.deps);
  assert.equal(result.persistenceEnabled, false);
  assert.deepEqual(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "state-prepare")[1],
    { transactionId: "123e4567-e89b-42d3-a456-426614174000", legacyAgentLoaded: false },
  );
  assert.equal(fx.events.some((entry) => Array.isArray(entry) && entry[0] === "ready"), false);
  assert.deepEqual(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "freeze-finalize")[1],
    { removeFrozenServices: true },
  );
});

test("loaded legacy install prepares state from the unanimous active renderer selection", async () => {
  const fx = fixture({
    persistenceEnabled: true,
    services: { legacyLoaded: true, legacyPresent: true },
    rendererSelection: "dalao-dianyan",
  });

  await coordinateMacosInstall(INPUT, fx.deps);

  assert.deepEqual(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "state-prepare")[1],
    {
      transactionId: "123e4567-e89b-42d3-a456-426614174000",
      legacyAgentLoaded: true,
      observedLegacyThemeId: "dalao-dianyan",
    },
  );
  assert.equal(
    fx.events.findIndex((entry) => Array.isArray(entry) && entry[0] === "renderer-selection")
      < fx.events.findIndex((entry) => Array.isArray(entry) && entry[0] === "state-prepare"),
    true,
  );
});

test("loaded legacy install prepares unanimous native as the selected theme", async () => {
  const fx = fixture({
    persistenceEnabled: true,
    services: { legacyLoaded: true, legacyPresent: true },
    rendererSelection: NATIVE_THEME_ID,
  });

  await coordinateMacosInstall(INPUT, fx.deps);

  assert.equal(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "state-prepare")[1]
      .observedLegacyThemeId,
    NATIVE_THEME_ID,
  );
});

test("renderer observation requires two exact snapshots bound to one process identity", async () => {
  const processIdentity = {
    pid: 9012,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 18:00:00 2026",
  };
  const events = [];
  const status = exactRendererStatus(rendererValue(), rendererValue());

  const selected = await observeLegacyRendererSelection({
    readProcess: async () => {
      events.push("process");
      return structuredClone(processIdentity);
    },
    readStatus: async () => {
      events.push("status");
      return structuredClone(status);
    },
    validateThemeSelection: async () => true,
  });

  assert.equal(selected, "dalao-dianyan");
  assert.deepEqual(events, ["process", "status", "status", "process"]);
});

test("different windows may keep distinct stable generations", async () => {
  const processIdentity = {
    pid: 9012,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 18:00:00 2026",
  };
  const status = exactRendererStatus(
    rendererValue({ themeId: "dalao-dianyan" }),
    { ...rendererValue({ themeId: "dalao-dianyan" }), generation: "b".repeat(32) },
  );
  assert.equal(await observeLegacyRendererSelection({
    readProcess: async () => structuredClone(processIdentity),
    readStatus: async () => structuredClone(status),
    validateThemeSelection: async () => true,
  }), "dalao-dianyan");
});

test("service or renderer drift during freeze rolls the install back", async () => {
  for (const drift of ["service", "renderer"]) {
    const fx = fixture({
      services: { legacyLoaded: true, legacyPresent: true },
      rendererSelection: "dalao-dianyan",
    });
    if (drift === "service") {
      const prepareFreeze = fx.deps.prepareFreeze;
      fx.deps.prepareFreeze = async (input) => ({
        ...await prepareFreeze(input),
        legacyLoadedBefore: false,
      });
    } else {
      let reads = 0;
      fx.deps.inspectRendererSelection = async () => (
        reads++ === 0 ? "dalao-dianyan" : "miku-488137"
      );
    }
    await assert.rejects(
      coordinateMacosInstall(INPUT, fx.deps),
      /changed before service freeze|selection changed/,
    );
    assert.equal(fx.journal, null);
    assert.equal(fx.events.includes("tree-publish"), false);
  }
});

test("partial, mixed, or process-drifted renderer observation falls back safely", async () => {
  const processIdentity = {
    pid: 9012,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 18:00:00 2026",
  };
  const partial = exactRendererStatus(rendererValue());
  partial.failed.push("main-2");
  partial.results.failed.push({
    id: "main-2",
    kind: "main",
    url: "app://-/index.html",
  });
  const mixed = exactRendererStatus(
    rendererValue({ themeId: "dalao-dianyan" }),
    rendererValue({ themeId: "miku-488137" }),
  );
  for (const { first, second, after } of [
    { first: partial, second: partial, after: processIdentity },
    { first: mixed, second: mixed, after: processIdentity },
    {
      first: exactRendererStatus(rendererValue()),
      second: exactRendererStatus(rendererValue()),
      after: { ...processIdentity, pid: processIdentity.pid + 1 },
    },
  ]) {
    let statusCalls = 0;
    let processCalls = 0;
    assert.equal(await observeLegacyRendererSelection({
      readProcess: async () => (
        processCalls++ === 0 ? structuredClone(processIdentity) : structuredClone(after)
      ),
      readStatus: async () => structuredClone(statusCalls++ === 0 ? first : second),
      validateThemeSelection: async () => true,
    }), null);
  }
});

test("renderer observation rejects a malformed non-null generation", async () => {
  const processIdentity = {
    pid: 9012,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 18:00:00 2026",
  };
  const malformed = exactRendererStatus({
    ...rendererValue(),
    generation: "legacy-generation",
  });
  assert.equal(await observeLegacyRendererSelection({
    readProcess: async () => structuredClone(processIdentity),
    readStatus: async () => structuredClone(malformed),
    validateThemeSelection: async () => true,
  }), null);
});

test("renderer observation rejects an unknown or damaged formal theme", async () => {
  const processIdentity = {
    pid: 9012,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 18:00:00 2026",
  };
  const status = exactRendererStatus(rendererValue());
  assert.equal(await observeLegacyRendererSelection({
    readProcess: async () => structuredClone(processIdentity),
    readStatus: async () => structuredClone(status),
    validateThemeSelection: async () => false,
  }), null);
});

test("a renderer selection is preserved without inheriting unloaded legacy persistence", async () => {
  const fx = fixture({
    services: { legacyLoaded: false, legacyPresent: true },
    rendererSelection: "dalao-dianyan",
  });

  await coordinateMacosInstall(INPUT, fx.deps);

  assert.deepEqual(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "state-prepare")[1],
    {
      transactionId: "123e4567-e89b-42d3-a456-426614174000",
      legacyAgentLoaded: false,
      observedLegacyThemeId: "dalao-dianyan",
    },
  );
  assert.equal(fx.events.some((entry) => Array.isArray(entry) && entry[0] === "ready"), false);
});

test("unavailable CDP status falls back to the legacy theme file", async () => {
  const fx = fixture({
    persistenceEnabled: true,
    services: { legacyLoaded: true, legacyPresent: true },
    rendererSelectionError: new Error("CDP unavailable"),
  });

  await coordinateMacosInstall(INPUT, fx.deps);

  assert.equal(
    fx.events.find((entry) => Array.isArray(entry) && entry[0] === "state-prepare")[1]
      .observedLegacyThemeId,
    null,
  );
});

test("non-persistent activation-skipped crash rolls back without starting a controller", async () => {
  const fx = fixture({ crashAt: "activation-skipped" });
  await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /crash at/);
  await recoverMacosInstallTransaction(fx.deps);
  assert.equal(fx.journal, null);
  assert.equal(fx.events.some((entry) => Array.isArray(entry) && entry[0] === "ready"), false);
  assert.equal(fx.events.includes("freeze-stop"), false);
});

test("readiness failure durably decides rollback and reverses state launcher tree then freeze", async () => {
  const fx = fixture({
    persistenceEnabled: true,
    ready: async () => { throw new Error("ACK timeout"); },
  });
  await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /ACK timeout/);

  const ordered = ["freeze-stop", "state-rollback", "launcher-rollback", "tree-rollback", "freeze-rollback"];
  assert.deepEqual(fx.events.filter((entry) => ordered.includes(entry)), ordered);
  assert.equal(fx.journal, null);
});

for (const prestate of ["controller-only", "both", "none"]) {
  test(`rollback recovery preserves the exact ${prestate} freeze prestate after outer clear crashes`, async () => {
    const fx = fixture({
      persistenceEnabled: true,
      crashAt: "journal-clear",
      ready: async () => {
        current.controller = { bytes: "new", loaded: true, mode: 0o600 };
        throw new Error("ACK timeout after controller activation");
      },
    });
    const expected = {
      controller: prestate === "none"
        ? null
        : { bytes: "old-controller", loaded: true, mode: 0o640 },
      watchdog: prestate === "both"
        ? { bytes: "old-watchdog", loaded: true, mode: 0o600 }
        : null,
    };
    const current = structuredClone(expected);
    let freezeJournal = null;

    fx.deps.prepareFreeze = async () => {
      freezeJournal = prestate === "none" ? null : structuredClone(expected);
      current.controller = null;
      current.watchdog = null;
      return {
        servicesFound: prestate !== "none",
        transaction: prestate === "none"
          ? null
          : { transactionId: "123e4567-e89b-42d3-a456-426614174000", operation: "freeze-stable-services" },
      };
    };
    fx.deps.stopFreezeForRollback = async () => {
      current.controller = null;
      if (freezeJournal !== null) current.watchdog = null;
    };
    fx.deps.rollbackFreeze = async () => {
      if (freezeJournal === null) return { rolledBack: false };
      current.controller = structuredClone(freezeJournal.controller);
      current.watchdog = structuredClone(freezeJournal.watchdog);
      return { rolledBack: true };
    };
    fx.deps.finalizeFreezeRollback = async () => {
      freezeJournal = null;
      return { finalized: true };
    };

    await assert.rejects(
      coordinateMacosInstall(INPUT, fx.deps),
      /macOS install failed and recovery did not finish/,
    );
    assert.deepEqual(current, expected, "first rollback restored the exact old prestate");

    await recoverMacosInstallTransaction(fx.deps);

    assert.equal(fx.journal, null);
    assert.deepEqual(current, expected, "second recovery must not delete restored prestate");
  });
}

for (const [faultKind, boundary] of [
  ["actionCrashAt", "freeze-stop"],
  ["actionCrashAt", "state-rollback"],
  ["actionCrashAt", "launcher-rollback"],
  ["actionCrashAt", "tree-rollback"],
  ["actionCrashAt", "freeze-rollback"],
  ["crashAt", "freeze-rollback-restored"],
  ["actionCrashAt", "freeze-rollback-finalize"],
  ["crashAt", "freeze-rollback-finalized"],
  ["crashAt", "journal-clear"],
]) {
  test(`rollback recovery is idempotent after a hard crash at ${boundary}`, async () => {
    const fx = fixture({
      persistenceEnabled: true,
      [faultKind]: boundary,
      ready: async () => { throw new Error("ACK timeout"); },
    });

    await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /crash|failed/i);
    assert.notEqual(fx.journal, null);

    await recoverMacosInstallTransaction(fx.deps);

    assert.equal(fx.journal, null);
  });
}

test("hard crash after tree publication remains recoverable from the durable outer journal", async () => {
  const fx = fixture({
    checkpoint: async (phase) => {
      if (phase === "tree-published") throw hardCrash("tree publish crash");
    },
  });
  await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /tree publish crash/);
  assert.equal(fx.journal.phase, "tree-published");

  await recoverMacosInstallTransaction(fx.deps);
  assert.equal(fx.journal, null);
  assert.deepEqual(
    fx.events.filter((entry) => ["state-rollback", "launcher-rollback", "tree-rollback", "freeze-rollback"].includes(entry)).slice(-4),
    ["state-rollback", "launcher-rollback", "tree-rollback", "freeze-rollback"],
  );
});

test("a crash after the global commit decision only rolls participants forward", async () => {
  const fx = fixture({
    checkpoint: async (phase) => {
      if (phase === "after-commit-decision") throw hardCrash("commit crash");
    },
  });
  await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /commit crash/);
  assert.equal(fx.journal.decision, "commit");

  await recoverMacosInstallTransaction(fx.deps);
  assert.equal(fx.journal, null);
  assert.equal(fx.events.includes("state-rollback"), false);
  assert.deepEqual(
    fx.events.filter((entry) => ["state-finalize", "launcher-finalize", "tree-finalize"].includes(entry)).slice(-3),
    ["state-finalize", "launcher-finalize", "tree-finalize"],
  );
});

test("persistent commit durably binds the exact background PID and start time before commit", async () => {
  const fx = fixture({ persistenceEnabled: true, crashAt: "after-commit-decision" });
  await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /after-commit-decision/);
  assert.deepEqual(fx.journal.ack, {
    persistenceEnabled: true,
    revision: 4,
    processIdentity: {
      pid: 8201,
      startedAt: "Fri Jul 17 16:40:00 2026",
    },
  });
  const verifyIndex = fx.events.findIndex((entry) =>
    Array.isArray(entry) && entry[0] === "ack-identity-verify");
  const commitIndex = fx.events.findIndex((entry) =>
    Array.isArray(entry) && entry[0] === "journal-update" && entry[1] === "commit-decided");
  assert.equal(verifyIndex >= 0 && verifyIndex < commitIndex, true);
});

test("postcommit recovery tolerates launchd PID replacement without reacquiring readiness", async () => {
  const fx = fixture({ persistenceEnabled: true, crashAt: "after-commit-decision" });
  await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /after-commit-decision/);
  fx.deps.verifyAckIdentity = async () => false;
  fx.deps.awaitExactReady = async () => {
    throw new Error("postcommit recovery must not reacquire a PID-bound readiness ACK");
  };

  await recoverMacosInstallTransaction(fx.deps);

  assert.equal(fx.journal, null);
  assert.equal(fx.events.includes("state-finalize"), true);
});

test("recovery-only coordinator rolls forward under participant locks without creating a fresh install", async () => {
  const fx = fixture({ persistenceEnabled: true, crashAt: "after-commit-decision" });
  await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /after-commit-decision/);
  const createsBefore = fx.events.filter((event) => event === "journal-create").length;

  assert.deepEqual(await coordinateMacosInstallRecovery(fx.deps), {
    recovered: true,
    decision: "commit",
  });

  assert.equal(fx.journal, null);
  assert.equal(
    fx.events.filter((event) => event === "journal-create").length,
    createsBefore,
  );
  assert.equal(fx.events.at(-2), "launcher-unlock");
  assert.equal(fx.events.at(-1), "tree-unlock");
});

test("recovery-only coordinator returns false and only recovers orphan preparations when no outer exists", async () => {
  const fx = fixture();
  assert.deepEqual(await coordinateMacosInstallRecovery(fx.deps), { recovered: false });
  assert.equal(fx.events.includes("tree-recover-under-lock"), true);
  assert.deepEqual(
    fx.events.find((event) => Array.isArray(event) && event[0] === "launcher-lock")[1],
    { recover: true },
  );
  assert.equal(fx.events.includes("journal-create"), false);
});

for (const phase of [
  "skeleton",
  "tree-prepared",
  "launcher-prepared",
  "state-prepared",
  "freeze-intent",
  "services-frozen",
  "tree-published",
  "launcher-published",
  "state-published",
  "activation-planned",
  "service-prepared",
  "ready-acked",
]) {
  test(`precommit hard crash at ${phase} is recovered only by rollback`, async () => {
    const fx = fixture({ persistenceEnabled: true, crashAt: phase });
    await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /crash at/);
    await recoverMacosInstallTransaction(fx.deps);
    assert.equal(fx.journal, null);
    assert.equal(fx.events.includes("tree-finalize"), false);
    if (["activation-planned", "service-prepared", "ready-acked"].includes(phase)) {
      assert.equal(fx.events.includes("freeze-stop"), true);
    }
  });
}

for (const action of [
  "tree-prepare",
  "launcher-prepare",
  "state-prepare",
  "freeze-prepare",
  "tree-publish",
  "launcher-publish",
  "state-publish",
  "ready",
]) {
  test(`hard crash inside ${action} is recovered from the last durable outer phase`, async () => {
    const fx = fixture({ persistenceEnabled: true, actionCrashAt: action });
    await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /action crash/);
    await recoverMacosInstallTransaction(fx.deps);
    assert.equal(fx.journal, null);
    assert.equal(fx.events.includes("tree-finalize"), false);
    if (action === "tree-prepare") assert.equal(fx.events.includes("tree-preparation-recover"), true);
    if (action === "launcher-prepare") {
      assert.equal(fx.events.includes("launcher-preparation-recover"), true);
    }
    if (action === "ready") assert.equal(fx.events.includes("freeze-stop"), true);
  });
}

for (const phase of [
  "state-finalized",
  "launcher-finalized",
  "tree-finalized",
  "freeze-finalized",
  "journal-clear",
]) {
  test(`postcommit hard crash at ${phase} is recovered only by roll-forward`, async () => {
    const fx = fixture({ crashAt: phase });
    await assert.rejects(coordinateMacosInstall(INPUT, fx.deps), /crash at/);
    assert.equal(fx.journal.decision, "commit");
    await recoverMacosInstallTransaction(fx.deps);
    assert.equal(fx.journal, null);
    assert.equal(fx.events.includes("state-rollback"), false);
  });
}
