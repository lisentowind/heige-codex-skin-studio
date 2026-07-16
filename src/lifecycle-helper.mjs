#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, realpathSync } from "node:fs";
import { lstat, mkdir, open, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

import { sameProcessIdentity } from "./codex-app.mjs";

const execFile = promisify(execFileCallback);
const ACTION_BYTES = 16 * 1024;
const ACTION_MAX_AGE_MS = 5 * 60 * 1000;
const ACTION_FUTURE_SKEW_MS = 30 * 1000;
const ACTION_KEYS = Object.freeze([
  "afterLaunch",
  "appPath",
  "createdAt",
  "launchMode",
  "nonce",
  "operation",
  "port",
  "process",
  "schemaVersion",
  "verifyPort",
]);
const PROCESS_KEYS = Object.freeze(["executablePath", "pid", "startedAt"]);
const CONTINUATION_KEYS = Object.freeze(["cliPath", "command", "nodePath", "port", "themeId"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTINUATION_COMMANDS = new Set(["apply", "enable-after-restart"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) throw new TypeError(`${label}必须是对象`);
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new TypeError(`${label}字段不完整或含未知字段`);
  }
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) {
    throw new TypeError(`${label}必须是绝对路径`);
  }
  const normalized = normalize(value);
  if (normalized !== value) throw new TypeError(`${label}必须是规范绝对路径`);
  return value;
}

function processIdentity(value) {
  exactKeys(value, PROCESS_KEYS, "进程身份");
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new TypeError("进程身份 pid 必须是正整数");
  }
  absolutePath(value.executablePath, "进程身份 executablePath");
  if (typeof value.startedAt !== "string" || value.startedAt.length === 0 || value.startedAt.length > 256) {
    throw new TypeError("进程身份 startedAt 无效");
  }
  return {
    pid: value.pid,
    executablePath: value.executablePath,
    startedAt: value.startedAt,
  };
}

function parseCreatedAt(value, now) {
  if (typeof value !== "string" || value.length > 64) throw new TypeError("action createdAt 无效");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError("action createdAt 无效");
  const current = now().getTime();
  if (timestamp < current - ACTION_MAX_AGE_MS || timestamp > current + ACTION_FUTURE_SKEW_MS) {
    throw new Error("lifecycle action 已过期或来自未来");
  }
  return value;
}

function continuation(value, { launchMode, port }) {
  if (value === null) return null;
  if (launchMode !== "cdp") throw new TypeError("native 重启不得携带 continuation");
  exactKeys(value, CONTINUATION_KEYS, "afterLaunch");
  if (!CONTINUATION_COMMANDS.has(value.command)) {
    throw new TypeError("afterLaunch command 不在允许列表中");
  }
  if (typeof value.themeId !== "string" || !THEME_ID.test(value.themeId)) {
    throw new TypeError("afterLaunch themeId 格式无效");
  }
  if (value.port !== port) throw new TypeError("afterLaunch 端口必须与重启端口一致");
  return Object.freeze({
    command: value.command,
    cliPath: absolutePath(value.cliPath, "afterLaunch cliPath"),
    nodePath: absolutePath(value.nodePath, "afterLaunch nodePath"),
    port: value.port,
    themeId: value.themeId,
  });
}

export function validateLifecycleAction(value, { now = () => new Date() } = {}) {
  exactKeys(value, ACTION_KEYS, "lifecycle action");
  if (value.schemaVersion !== 1 || value.operation !== "restart") {
    throw new TypeError("lifecycle action 版本或操作无效");
  }
  if (value.launchMode !== "cdp" && value.launchMode !== "native") {
    throw new TypeError("launchMode 只能是 cdp 或 native");
  }
  const identity = value.process === null ? null : processIdentity(value.process);
  const appPath = absolutePath(value.appPath, "appPath");
  if (!appPath.endsWith(".app")) throw new TypeError("appPath 必须指向 macOS 应用包");
  const expectedExecutable = join(appPath, "Contents", "MacOS", "ChatGPT");
  if (identity !== null && identity.executablePath !== expectedExecutable) {
    throw new TypeError("进程身份不属于已解析的 Codex 应用");
  }
  if (value.launchMode === "cdp") {
    if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) {
      throw new TypeError("CDP 端口必须是 1024 到 65535 的整数");
    }
  } else if (value.port !== null) {
    throw new TypeError("native 重启不得携带 CDP 端口");
  }
  if (value.verifyPort !== null && (
    !Number.isInteger(value.verifyPort) || value.verifyPort < 1024 || value.verifyPort > 65535
  )) {
    throw new TypeError("verifyPort 必须是 null 或 1024 到 65535 的整数");
  }
  if (value.launchMode === "cdp" && value.verifyPort !== null) {
    throw new TypeError("CDP 重启不得携带 verifyPort");
  }
  if (typeof value.nonce !== "string" || !UUID.test(value.nonce)) {
    throw new TypeError("action nonce 必须是 UUID");
  }
  const afterLaunch = continuation(value.afterLaunch, {
    launchMode: value.launchMode,
    port: value.port,
  });
  if (identity === null && (value.launchMode !== "cdp" || afterLaunch === null)) {
    throw new TypeError("无进程身份时只允许启动 CDP 并执行经过允许的 continuation");
  }
  return Object.freeze({
    schemaVersion: 1,
    operation: "restart",
    process: identity === null ? null : Object.freeze(identity),
    appPath,
    launchMode: value.launchMode,
    port: value.port,
    verifyPort: value.verifyPort,
    createdAt: parseCreatedAt(value.createdAt, now),
    nonce: value.nonce,
    afterLaunch,
  });
}

function actionDocument(input, { now = () => new Date(), nonce = randomUUID } = {}) {
  return validateLifecycleAction({
    schemaVersion: 1,
    operation: "restart",
    process: input.process,
    appPath: input.appPath,
    launchMode: input.launchMode,
    port: input.port,
    verifyPort: input.verifyPort ?? null,
    createdAt: now().toISOString(),
    nonce: nonce(),
    afterLaunch: input.afterLaunch ?? null,
  }, { now });
}

async function syncDirectory(path) {
  const handle = await open(path, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeLifecycleActionFile(actionPath, input, options = {}) {
  absolutePath(actionPath, "actionPath");
  const action = actionDocument(input, options);
  const parent = dirname(actionPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const handle = await open(
    actionPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(action)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(parent);
  return { actionPath, action };
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

async function readActionFile(actionPath, options) {
  absolutePath(actionPath, "actionPath");
  const before = await lstat(actionPath);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error("lifecycle action 必须是普通文件且不得是符号链接");
  }
  if ((before.mode & 0o777) !== 0o600) throw new Error("lifecycle action 权限必须是 0600");
  if (typeof process.getuid === "function" && before.uid !== process.getuid()) {
    throw new Error("lifecycle action 不属于当前用户");
  }
  if (before.size <= 0 || before.size > ACTION_BYTES) {
    throw new Error(`lifecycle action 必须小于 ${ACTION_BYTES} bytes`);
  }
  const handle = await open(actionPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened)) throw new Error("lifecycle action 在打开期间发生变化");
    bytes = await handle.readFile();
    const afterRead = await handle.stat();
    if (!sameFile(opened, afterRead) || bytes.byteLength !== opened.size) {
      throw new Error("lifecycle action 在读取期间发生变化");
    }
  } finally {
    await handle.close();
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new Error("lifecycle action 不是有效 JSON", { cause });
  }
  const action = validateLifecycleAction(parsed, options);
  const beforeUnlink = await lstat(actionPath);
  if (!sameFile(before, beforeUnlink)) throw new Error("lifecycle action 在执行前被替换");
  await unlink(actionPath);
  await syncDirectory(dirname(actionPath));
  return action;
}

async function defaultReadProcessIdentity(pid, expected) {
  let stdout;
  try {
    ({ stdout } = await execFile("/bin/ps", ["-p", String(pid), "-o", "pid=,lstart=,command="]));
  } catch (error) {
    if (error?.code === 1) return null;
    throw error;
  }
  const pattern = /^\s*(\d+)\s+(\S+\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([\s\S]+?)\s*$/;
  const match = pattern.exec(stdout);
  if (!match || Number(match[1]) !== pid) return null;
  const command = match[3];
  const executableMatches = command === expected.executablePath || command.startsWith(`${expected.executablePath} `);
  if (!executableMatches) {
    return { pid, executablePath: command.split(" ")[0], startedAt: match[2] };
  }
  return { pid, executablePath: expected.executablePath, startedAt: match[2] };
}

export async function requestNormalQuit({ process: identity }, { execFile: run = execFile } = {}) {
  const target = processIdentity(identity);
  const source = `ObjC.import("AppKit");
function run(argv) {
  const pid = Number(argv[0]);
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (!app) throw new Error("target process disappeared");
  if (!app.terminate) throw new Error("target process refused normal termination");
  return true;
}`;
  await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", source, "--", String(target.pid)]);
}

async function defaultLaunchApp({ appPath, args }) {
  const commandArgs = ["-na", appPath];
  if (args.length > 0) commandArgs.push("--args", ...args);
  await execFile("/usr/bin/open", commandArgs);
}

async function defaultWaitForPort(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        redirect: "error",
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return true;
    } catch {}
    await defaultWait(250);
  }
  throw new Error(`CDP 端口 ${port} 未在限定时间内就绪`);
}

async function defaultVerifyPortReleased(port) {
  try {
    const { stdout } = await execFile("/usr/sbin/lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    return !stdout.split(/\s+/).some(Boolean);
  } catch (error) {
    if (error?.code === 1) return true;
    throw error;
  }
}

async function defaultRunAfterLaunch(input) {
  const localCli = join(dirname(fileURLToPath(import.meta.url)), "cli.mjs");
  const [realNode, currentNode, realCli, currentCli] = [
    input.nodePath,
    process.execPath,
    input.cliPath,
    localCli,
  ].map((path) => realpathSync(path));
  if (realNode !== currentNode || realCli !== currentCli) {
    throw new Error("afterLaunch 运行时或 CLI 不属于当前稳定安装");
  }
  await execFile(input.nodePath, [
    input.cliPath,
    input.command,
    "--theme",
    input.themeId,
    "--port",
    String(input.port),
  ]);
  return true;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runLifecycleActionFile(actionPath, deps = {}) {
  const now = deps.now ?? (() => new Date());
  const action = await readActionFile(actionPath, { now });
  const readProcessIdentity = deps.readProcessIdentity ?? defaultReadProcessIdentity;
  const requestQuit = deps.requestQuit ?? requestNormalQuit;
  const launchApp = deps.launchApp ?? defaultLaunchApp;
  const wait = deps.wait ?? defaultWait;
  const waitForPort = deps.waitForPort ?? defaultWaitForPort;
  const runAfterLaunch = deps.runAfterLaunch ?? defaultRunAfterLaunch;
  const verifyPortReleased = deps.verifyPortReleased ?? defaultVerifyPortReleased;
  const maxWaitAttempts = deps.maxWaitAttempts ?? 120;
  const waitIntervalMs = deps.waitIntervalMs ?? 250;
  if (![readProcessIdentity, requestQuit, launchApp, wait, waitForPort, runAfterLaunch, verifyPortReleased]
    .every((value) => typeof value === "function")) {
    throw new TypeError("lifecycle helper dependencies must be functions");
  }
  if (!Number.isInteger(maxWaitAttempts) || maxWaitAttempts < 1 || maxWaitAttempts > 1200) {
    throw new TypeError("maxWaitAttempts 无效");
  }

  if (action.process !== null) {
    const observed = await readProcessIdentity(action.process.pid, action.process);
    if (!sameProcessIdentity(observed, action.process)) {
      throw new Error("记录的 Codex 进程身份已变化，拒绝退出或启动");
    }
    await requestQuit({ appPath: action.appPath, process: action.process });
    let disappeared = false;
    for (let attempt = 0; attempt < maxWaitAttempts; attempt += 1) {
      const current = await readProcessIdentity(action.process.pid, action.process);
      if (!sameProcessIdentity(current, action.process)) {
        disappeared = true;
        break;
      }
      await wait(waitIntervalMs);
    }
    if (!disappeared) {
      throw new Error("Codex 未正常退出，拒绝强制终止或启动第二个实例");
    }
  }

  const args = action.launchMode === "cdp"
    ? ["--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${action.port}`]
    : [];
  await launchApp({ appPath: action.appPath, args });
  const result = {
    launchMode: action.launchMode,
    port: action.port,
    restarted: true,
  };
  if (action.afterLaunch !== null) {
    await waitForPort(action.port);
    await runAfterLaunch(action.afterLaunch);
    result.continuation = action.afterLaunch.command;
  }
  if (action.verifyPort !== null) {
    if (!(await verifyPortReleased(action.verifyPort))) {
      throw new Error(`CDP 端口 ${action.verifyPort} 仍被占用`);
    }
    result.verifiedPortReleased = action.verifyPort;
  }
  return result;
}

export async function spawnDetachedLifecycle({
  nodePath,
  helperPath,
  actionPath,
  spawnImpl = spawn,
} = {}) {
  absolutePath(nodePath, "nodePath");
  absolutePath(helperPath, "helperPath");
  absolutePath(actionPath, "actionPath");
  if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl 必须是函数");
  const child = spawnImpl(nodePath, [helperPath, actionPath], {
    detached: true,
    stdio: "ignore",
  });
  if (!child || typeof child.once !== "function" || typeof child.unref !== "function") {
    throw new Error("无法创建 detached lifecycle helper");
  }
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error("无法创建 detached lifecycle helper");
  }
  child.unref();
  return { queued: true };
}

function isMainEntry() {
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMainEntry()) {
  if (process.argv.length !== 3) {
    process.stderr.write("用法：lifecycle-helper.mjs /absolute/path/to/action.json\n");
    process.exitCode = 64;
  } else {
    runLifecycleActionFile(process.argv[2]).catch((error) => {
      process.stderr.write(`HeiGe lifecycle helper：${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
