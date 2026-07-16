import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  requestNormalQuit,
  runLifecycleActionFile,
  spawnDetachedLifecycle,
  writeLifecycleActionFile,
} from "../src/lifecycle-helper.mjs";

const run = promisify(execFile);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const wrapperPath = join(repositoryRoot, "scripts", "lib", "run-cli.zsh");

async function fakeNode(path, version = "v24.14.0") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/zsh
if [[ "\${1:-}" == "--version" ]]; then
  print -r -- "${version}"
  exit 0
fi
if [[ -n "\${HEIGE_NODE_CAPTURE:-}" ]]; then print -r -- "$0" > "$HEIGE_NODE_CAPTURE"; fi
exec "$HEIGE_REAL_NODE" "$@"
`);
  await chmod(path, 0o755);
  return path;
}

async function fakeApp(home, { relativeNode = "Contents/Resources/cua_node/bin/node", version } = {}) {
  const appPath = join(home, "Applications", "ChatGPT.app");
  await mkdir(join(appPath, "Contents", "MacOS"), { recursive: true });
  await writeFile(join(appPath, "Contents", "MacOS", "ChatGPT"), "fake app\n");
  await fakeNode(join(appPath, relativeNode), version);
  return appPath;
}

test("run-cli accepts a validated explicit app whose path contains Chinese and spaces", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "用户 空格-"));
  const appPath = await fakeApp(home);
  const capture = join(home, "selected-node.txt");
  const { stdout } = await run("/bin/zsh", [wrapperPath, "help"], {
    env: {
      HOME: home,
      PATH: "/usr/bin:/bin",
      HEIGE_CODEX_APP: appPath,
      HEIGE_NODE_CAPTURE: capture,
      HEIGE_REAL_NODE: process.execPath,
    },
  });
  t.after(async () => {});
  assert.match(stdout, /commands/);
  assert.equal((await readFile(capture, "utf8")).trim(), join(appPath, "Contents/Resources/cua_node/bin/node"));
});

test("run-cli checks the second bundled Node location", async () => {
  const home = await mkdtemp(join(tmpdir(), "heige-node-second-"));
  const appPath = await fakeApp(home, { relativeNode: "Contents/Resources/cua_node/node" });
  const capture = join(home, "selected-node.txt");
  await run("/bin/zsh", [wrapperPath, "help"], {
    env: {
      HOME: home,
      PATH: "/usr/bin:/bin",
      HEIGE_CODEX_APP: appPath,
      HEIGE_NODE_CAPTURE: capture,
      HEIGE_REAL_NODE: process.execPath,
    },
  });
  assert.equal((await readFile(capture, "utf8")).trim(), join(appPath, "Contents/Resources/cua_node/node"));
});

test("an invalid first bundled candidate does not hide a valid second candidate", async () => {
  const home = await mkdtemp(join(tmpdir(), "heige-node-fallback-"));
  const appPath = await fakeApp(home, {
    relativeNode: "Contents/Resources/cua_node/bin/node",
    version: "v20.19.4",
  });
  await fakeNode(join(appPath, "Contents/Resources/cua_node/node"), "v24.14.0");
  const capture = join(home, "selected-node.txt");
  const { stdout } = await run("/bin/zsh", [wrapperPath, "help"], {
    env: {
      HOME: home,
      PATH: "/usr/bin:/bin",
      HEIGE_CODEX_APP: appPath,
      HEIGE_NODE_CAPTURE: capture,
      HEIGE_REAL_NODE: process.execPath,
    },
  });
  assert.match(stdout, /commands/);
  assert.equal((await readFile(capture, "utf8")).trim(), join(appPath, "Contents/Resources/cua_node/node"));
});

test("an invalid explicit Node fails closed without falling back", async () => {
  await assert.rejects(
    run("/bin/zsh", [wrapperPath, "help"], {
      env: {
        HOME: "/tmp",
        PATH: dirname(process.execPath),
        HEIGE_NODE: "/missing/explicit-node",
      },
    }),
    (error) => {
      assert.match(error.stderr, /HEIGE_NODE/);
      return true;
    },
  );
});

test("an invalid explicit app fails closed without probing another runtime", async () => {
  await assert.rejects(
    run("/bin/zsh", [wrapperPath, "help"], {
      env: {
        HOME: "/tmp",
        PATH: dirname(process.execPath),
        HEIGE_CODEX_APP: "/missing/ChatGPT.app",
      },
    }),
    (error) => {
      assert.match(error.stderr, /HEIGE_CODEX_APP/);
      return true;
    },
  );
});

test("a valid HEIGE_NODE cannot hide an invalid explicit app", async () => {
  await assert.rejects(
    run("/bin/zsh", [wrapperPath, "help"], {
      env: {
        HOME: "/tmp",
        PATH: "/usr/bin:/bin",
        HEIGE_NODE: process.execPath,
        HEIGE_CODEX_APP: "/missing/ChatGPT.app",
      },
    }),
    (error) => {
      assert.match(error.stderr, /HEIGE_CODEX_APP/);
      return true;
    },
  );
});

test("run-cli rejects Node 20 and accepts Node 22", async () => {
  const home = await mkdtemp(join(tmpdir(), "heige-node-version-"));
  const oldNode = await fakeNode(join(home, "node20"), "v20.19.4");
  await assert.rejects(
    run("/bin/zsh", [wrapperPath, "help"], {
      env: { HOME: home, PATH: "/usr/bin:/bin", HEIGE_NODE: oldNode },
    }),
    (error) => {
      assert.match(error.stderr, /Node\.js 22/);
      return true;
    },
  );

  const currentNode = await fakeNode(join(home, "node22"), "v22.0.0");
  const capture = join(home, "accepted.txt");
  const { stdout } = await run("/bin/zsh", [wrapperPath, "help"], {
    env: {
      HOME: home,
      PATH: "/usr/bin:/bin",
      HEIGE_NODE: currentNode,
      HEIGE_NODE_CAPTURE: capture,
      HEIGE_REAL_NODE: process.execPath,
    },
  });
  assert.match(stdout, /commands/);
  assert.equal((await readFile(capture, "utf8")).trim(), currentNode);
});

test("lifecycle action files require mode 0600 before any process action", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-lifecycle-mode-"));
  const path = join(root, "action.json");
  await writeFile(path, JSON.stringify({}), { mode: 0o644 });
  const calls = [];
  await assert.rejects(
    runLifecycleActionFile(path, { requestQuit: async () => calls.push("quit") }),
    /0600/,
  );
  assert.deepEqual(calls, []);
});

test("lifecycle helper quits and launches only the recorded exact process identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-lifecycle-exact-"));
  const path = join(root, "action.json");
  const processIdentity = {
    pid: 4242,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 12:00:00 2026",
  };
  await writeLifecycleActionFile(path, {
    process: processIdentity,
    appPath: "/Applications/ChatGPT.app",
    launchMode: "cdp",
    port: 9341,
  });
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  let probes = 0;
  const calls = [];
  const result = await runLifecycleActionFile(path, {
    readProcessIdentity: async () => (++probes === 1 ? processIdentity : null),
    requestQuit: async (input) => calls.push(["quit", input]),
    launchApp: async (input) => calls.push(["launch", input]),
    wait: async () => {},
  });
  assert.deepEqual(result, { launchMode: "cdp", port: 9341, restarted: true });
  assert.equal(calls[0][0], "quit");
  assert.deepEqual(calls[0][1].process, processIdentity);
  assert.deepEqual(calls[1], ["launch", {
    appPath: "/Applications/ChatGPT.app",
    args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9341"],
  }]);
});

test("the default normal quit request is PID-bound and never addresses a bundle ID", async () => {
  const calls = [];
  const target = {
    pid: 4242,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 12:00:00 2026",
  };
  await requestNormalQuit({ process: target }, {
    execFile: async (file, args) => calls.push([file, args]),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/usr/bin/osascript");
  assert.equal(calls[0][1].at(-1), "4242");
  assert.doesNotMatch(calls[0][1].join(" "), /com\.openai\.codex|application id/i);
});

test("a replaced PID aborts before quit or launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-lifecycle-replaced-"));
  const path = join(root, "action.json");
  const expected = {
    pid: 4242,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 12:00:00 2026",
  };
  await writeLifecycleActionFile(path, {
    process: expected,
    appPath: "/Applications/ChatGPT.app",
    launchMode: "native",
    port: null,
  });
  const calls = [];
  await assert.rejects(runLifecycleActionFile(path, {
    readProcessIdentity: async () => ({ ...expected, startedAt: "Fri Jul 17 12:01:00 2026" }),
    requestQuit: async () => calls.push("quit"),
    launchApp: async () => calls.push("launch"),
  }), /进程身份/);
  assert.deepEqual(calls, []);
});

test("a detached restart can run only the exact allowlisted CLI continuation after CDP is ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-lifecycle-after-"));
  const path = join(root, "action.json");
  const processIdentity = {
    pid: 4242,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 12:00:00 2026",
  };
  await writeLifecycleActionFile(path, {
    process: processIdentity,
    appPath: "/Applications/ChatGPT.app",
    launchMode: "cdp",
    port: 9341,
    afterLaunch: {
      command: "enable-after-restart",
      cliPath: "/trusted/src/cli.mjs",
      nodePath: "/trusted/node",
      port: 9341,
      themeId: "miku-488137",
    },
  });
  let probes = 0;
  const calls = [];
  const result = await runLifecycleActionFile(path, {
    readProcessIdentity: async () => (++probes === 1 ? processIdentity : null),
    requestQuit: async () => calls.push("quit"),
    launchApp: async () => calls.push("launch"),
    wait: async () => {},
    waitForPort: async (port) => calls.push(["port", port]),
    runAfterLaunch: async (input) => calls.push(["after", input]),
  });
  assert.deepEqual(result, {
    launchMode: "cdp",
    port: 9341,
    restarted: true,
    continuation: "enable-after-restart",
  });
  assert.deepEqual(calls.slice(-2), [
    ["port", 9341],
    ["after", {
      command: "enable-after-restart",
      cliPath: "/trusted/src/cli.mjs",
      nodePath: "/trusted/node",
      port: 9341,
      themeId: "miku-488137",
    }],
  ]);
});

test("a launch-only action starts a closed Codex without issuing a quit request", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-lifecycle-closed-"));
  const path = join(root, "action.json");
  await writeLifecycleActionFile(path, {
    process: null,
    appPath: "/Applications/ChatGPT.app",
    launchMode: "cdp",
    port: 9341,
    afterLaunch: {
      command: "apply",
      cliPath: "/trusted/src/cli.mjs",
      nodePath: "/trusted/node",
      port: 9341,
      themeId: "miku-488137",
    },
  });
  const calls = [];
  const result = await runLifecycleActionFile(path, {
    readProcessIdentity: async () => calls.push("probe"),
    requestQuit: async () => calls.push("quit"),
    launchApp: async () => calls.push("launch"),
    waitForPort: async () => calls.push("port"),
    runAfterLaunch: async () => calls.push("after"),
  });
  assert.equal(result.continuation, "apply");
  assert.deepEqual(calls, ["launch", "port", "after"]);
});

test("native restore fails when the old CDP port remains occupied", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-lifecycle-native-port-"));
  const path = join(root, "action.json");
  const processIdentity = {
    pid: 4242,
    executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
    startedAt: "Fri Jul 17 12:00:00 2026",
  };
  await writeLifecycleActionFile(path, {
    process: processIdentity,
    appPath: "/Applications/ChatGPT.app",
    launchMode: "native",
    port: null,
    verifyPort: 9341,
  });
  let probes = 0;
  await assert.rejects(runLifecycleActionFile(path, {
    readProcessIdentity: async () => (++probes === 1 ? processIdentity : null),
    requestQuit: async () => {},
    launchApp: async () => {},
    wait: async () => {},
    verifyPortReleased: async () => false,
  }), /CDP 端口 9341 仍被占用/);
});

test("detached lifecycle spawn cannot inherit the caller terminal", async () => {
  const calls = [];
  const child = new EventEmitter();
  child.pid = 73001;
  child.unref = () => calls.push("unref");
  const resultPromise = spawnDetachedLifecycle({
    nodePath: "/trusted/node",
    helperPath: "/trusted/lifecycle-helper.mjs",
    actionPath: "/trusted/action.json",
    spawnImpl: (file, args, options) => {
      calls.push({ file, args, options });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  const result = await resultPromise;
  assert.deepEqual(result, { queued: true });
  assert.deepEqual(calls[0], {
    file: "/trusted/node",
    args: ["/trusted/lifecycle-helper.mjs", "/trusted/action.json"],
    options: { detached: true, stdio: "ignore" },
  });
  assert.equal(calls[1], "unref");
});

test("detached lifecycle never reports queued when the child was not spawned", async () => {
  await assert.rejects(spawnDetachedLifecycle({
    nodePath: "/trusted/node",
    helperPath: "/trusted/lifecycle-helper.mjs",
    actionPath: "/trusted/action.json",
    spawnImpl: () => ({ pid: undefined, unref() {} }),
  }), /无法创建 detached/);
});

test("detached lifecycle propagates an asynchronous spawn error", async () => {
  const child = new EventEmitter();
  child.unref = () => assert.fail("failed child must not be detached");
  const queued = spawnDetachedLifecycle({
    nodePath: "/trusted/node",
    helperPath: "/trusted/lifecycle-helper.mjs",
    actionPath: "/trusted/action.json",
    spawnImpl: () => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    },
  });
  await assert.rejects(queued, /ENOENT/);
});

test("lifecycle shell entrypoints contain no independent process or service mutation", async () => {
  const wrappers = [
    "apply.command",
    "customize.command",
    "pause.command",
    "resume.command",
    "restore.command",
    "enable-skin.command",
    "enable-persist.command",
    "disable-persist.command",
    "lib/launch-codex.zsh",
  ];
  for (const relative of wrappers) {
    const source = await readFile(join(repositoryRoot, "scripts", relative), "utf8");
    assert.match(source, /run-cli\.zsh/, relative);
    assert.doesNotMatch(source, /\b(?:launchctl|osascript|curl|pgrep|pkill|kill|nohup|open)\b/, relative);
  }
  const customize = await readFile(join(repositoryRoot, "scripts/customize.command"), "utf8");
  assert.match(customize, /run-cli\.zsh" customize/);
  await assert.rejects(readFile(join(repositoryRoot, "scripts/lib/skin-watchdog.zsh"), "utf8"), /ENOENT/);
  const disabled = await readFile(join(repositoryRoot, "scripts/disable-persist.command"), "utf8");
  assert.match(disabled, /本次皮肤继续使用/);
  assert.match(disabled, /下次启动完全原生/);
});
