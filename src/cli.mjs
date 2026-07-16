#!/usr/bin/env node
import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  claimBackgroundStartRequest,
  publishBackgroundHandshake,
  publishBackgroundStartRequest,
  readBackgroundHandshake,
  removeBackgroundHandshake,
  removeBackgroundStartRequest,
  waitForBackgroundHandshake,
} from "./background-handshake.mjs";
import {
  classifyInjection,
  discoverCodex,
  listCodexProcesses,
  resolveCodexApp,
  runtimeDiagnostics,
  sameProcessIdentity,
} from "./codex-app.mjs";
import {
  DEFAULT_CDP_PORT,
  DEFAULT_THEME_ID,
  NATIVE_THEME_ID,
  resolveStudioPaths,
} from "./constants.mjs";
import { createSkinController } from "./controller.mjs";
import { applySkin, removeSkin, skinStatus } from "./injector.mjs";
import {
  spawnDetachedLifecycle,
  writeLifecycleActionFile,
} from "./lifecycle-helper.mjs";
import {
  CONTROLLER_LAUNCH_AGENT_LABEL,
  inspectLaunchAgent,
  migrateLegacyWatchdog,
  registerControllerAgent,
  unregisterControllerAgent,
  wakeControllerAgent,
} from "./macos-launch-agent.mjs";
import { withOperationLock } from "./operation-lock.mjs";
import { installPet } from "./pet-installer.mjs";
import {
  compareAndUpdateStudioState,
  createDefaultStudioState,
  migrateLegacyState,
  readStudioState,
  writeSessionState,
  writeStudioState,
} from "./state-store.mjs";
import { createStudioLogger } from "./studio-logger.mjs";
import { loadTheme } from "./theme-schema.mjs";
import { createSingleImageTheme, listThemes } from "./theme-store.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOOLEAN_FLAGS = new Set(["background", "ephemeral", "once", "prefer-stored"]);
const COMMAND_OPTIONS = new Map([
  ["help", new Set()],
  ["list", new Set()],
  ["create", new Set(["image", "name"])],
  ["customize", new Set(["image", "name", "port"])],
  ["apply", new Set(["port", "prefer-stored", "theme"])],
  ["enable-skin", new Set(["port", "theme"])],
  ["enable-after-restart", new Set(["port", "theme"])],
  ["set-persistence", new Set(["port", "revision"])],
  ["pause", new Set(["port"])],
  ["resume", new Set(["port"])],
  ["restore", new Set(["port"])],
  ["controller", new Set([
    "background",
    "ephemeral",
    "once",
    "platform",
    "port",
    "state-directory",
    "task-name",
  ])],
  ["migrate-legacy", new Set(["port"])],
  ["status", new Set(["port"])],
  ["doctor", new Set(["port"])],
  ["install-pet", new Set(["source"])],
]);
const WINDOWS_PRODUCTION_TASK = "HeiGe Codex Skin Studio Controller";
const WINDOWS_TEST_TASK = /^HeiGe Codex Skin Studio Test [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseInvocation(argv) {
  const command = argv[0] ?? "help";
  const args = {};
  const positionals = [];
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      positionals.push(key);
      continue;
    }
    const name = key.slice(2);
    if (Object.hasOwn(args, name)) throw new Error(`重复参数：--${name}`);
    if (BOOLEAN_FLAGS.has(name)) {
      args[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} 缺少值`);
    args[name] = value;
    index += 1;
  }
  const allowed = COMMAND_OPTIONS.get(command);
  if (allowed !== undefined) {
    for (const name of Object.keys(args)) {
      if (!allowed.has(name)) throw new Error(`无法识别的参数：--${name}`);
    }
    if (command === "set-persistence") {
      if (positionals.length !== 1) throw new Error("set-persistence 需要且只能提供 true 或 false");
    } else if (positionals.length !== 0) {
      throw new Error(`无法识别的参数：${positionals[0]}`);
    }
  }
  return { args, command, positionals };
}

function assertNodeVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value));
  if (!match || Number(match[1]) < 22) {
    throw new Error(`运行命令需要 Node.js 22 或更高版本，实际为 ${String(value)}`);
  }
}

function controllerPlatform(value) {
  const selected = value ?? process.platform;
  if (selected === "windows") return "win32";
  if (selected === "win32" || selected === "darwin") return selected;
  throw new Error("controller --platform 只支持 darwin 或 windows");
}

function controllerBackgroundIdentity(platform, taskName) {
  if (platform === "darwin") {
    if (taskName !== undefined && taskName !== CONTROLLER_LAUNCH_AGENT_LABEL) {
      throw new Error("macOS controller 不接受 Windows TaskName");
    }
    return CONTROLLER_LAUNCH_AGENT_LABEL;
  }
  if (taskName === undefined) return WINDOWS_PRODUCTION_TASK;
  if (
    taskName !== WINDOWS_PRODUCTION_TASK &&
    (typeof taskName !== "string" || !WINDOWS_TEST_TASK.test(taskName))
  ) {
    throw new Error("Windows controller TaskName 不在允许范围内");
  }
  return taskName;
}

function pathsAtStateRoot(base, stateRoot) {
  return {
    ...base,
    stateRoot,
    statePath: join(stateRoot, "state.json"),
    sessionPath: join(stateRoot, "session.json"),
    transitionPath: join(stateRoot, "transition.json"),
    lockPath: join(stateRoot, "operation.lock"),
    logPath: join(stateRoot, "injector.log"),
    userThemesRoot: join(stateRoot, "themes"),
  };
}

function controllerPaths({ platform, stateDirectory, taskName }) {
  const base = resolveStudioPaths({ platform });
  if (stateDirectory === undefined) {
    if (platform === "win32" && typeof taskName === "string" && WINDOWS_TEST_TASK.test(taskName)) {
      throw new Error("Windows 隔离测试任务必须提供 --state-directory");
    }
    return base;
  }
  if (platform !== "win32") throw new Error("--state-directory 仅支持 Windows controller");
  if (
    typeof stateDirectory !== "string" ||
    !isAbsolute(stateDirectory) ||
    normalize(stateDirectory) !== stateDirectory ||
    stateDirectory.includes("\0")
  ) {
    throw new Error("--state-directory 必须是规范绝对路径");
  }
  const selected = resolve(stateDirectory);
  const production = resolve(base.stateRoot);
  if (taskName === WINDOWS_PRODUCTION_TASK && selected.toLowerCase() !== production.toLowerCase()) {
    throw new Error("Windows 生产任务只能使用默认 APPDATA 状态目录");
  }
  if (typeof taskName === "string" && WINDOWS_TEST_TASK.test(taskName) &&
      selected.toLowerCase() === production.toLowerCase()) {
    throw new Error("Windows 隔离测试任务不得使用生产状态目录");
  }
  return pathsAtStateRoot(base, selected);
}

function portFrom(value) {
  const port = value === undefined ? DEFAULT_CDP_PORT : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port 必须是 1024 到 65535 的整数");
  }
  return port;
}

function revisionFrom(value, current) {
  if (value === undefined) return current;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("--revision 必须是非负安全整数");
  }
  return revision;
}

function exactBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("set-persistence 只接受精确的 true 或 false");
}

function publicProcess(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.executablePath !== "string" ||
    value.executablePath.length === 0 ||
    typeof value.startedAt !== "string" ||
    value.startedAt.length === 0
  ) {
    throw new Error("Codex 进程身份无效");
  }
  return {
    pid: value.pid,
    executablePath: value.executablePath,
    startedAt: value.startedAt,
  };
}

async function readProcessIdentity(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("进程 PID 无效");
  if (platform === "win32") {
    const systemRoot = process.env.SystemRoot;
    if (typeof systemRoot !== "string" || systemRoot.length === 0) {
      throw new Error("Windows SystemRoot 不可用");
    }
    const powershell = join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    try {
      const { stdout } = await execFile(powershell, [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
          `[Console]::Out.Write(($p.Id.ToString() + '|' + ` +
          `$p.StartTime.ToUniversalTime().ToString('o')))`,
      ]);
      const [observedPid, startedAt, ...extra] = stdout.trim().split("|");
      if (extra.length > 0 || Number(observedPid) !== pid || !startedAt) return null;
      return { pid, startedAt };
    } catch (error) {
      if (/Cannot find a process|No process was found/i.test(String(error?.stderr ?? error?.message))) {
        return null;
      }
      throw error;
    }
  }
  let stdout;
  try {
    ({ stdout } = await execFile("/bin/ps", ["-p", String(pid), "-o", "pid=,lstart="]));
  } catch (error) {
    if (error?.code === 1) return null;
    throw error;
  }
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(stdout);
  if (!match || Number(match[1]) !== pid || match[2].length === 0) return null;
  return { pid, startedAt: match[2] };
}

async function currentLockIdentity(platform = process.platform) {
  const identity = await readProcessIdentity(process.pid, platform);
  if (identity === null) throw new Error("无法读取当前 CLI 进程身份");
  return identity;
}

async function lockOptions(paths, platform = process.platform) {
  return {
    lockPath: paths.lockPath,
    stateRoot: paths.stateRoot,
    identity: await currentLockIdentity(platform),
    readProcessIdentity: (pid) => readProcessIdentity(pid, platform),
  };
}

const WINDOWS_PROCESS_STARTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,7}Z$/;
const WINDOWS_CODEX_PROCESS_NAMES = new Set(["chatgpt", "codex"]);

export async function probeWindowsCdpProcess(port, {
  execFileImpl = execFile,
  powershellPath = windowsPowerShellPath(),
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Windows CDP port is invalid");
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$connections = @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop)`,
    "$records = @($connections | ForEach-Object {",
    "  $owner = Get-Process -Id $_.OwningProcess -ErrorAction Stop",
    "  [pscustomobject][ordered]@{",
    "    pid = [int]$owner.Id",
    "    executablePath = [string]$owner.Path",
    "    startedAt = $owner.StartTime.ToUniversalTime().ToString('o')",
    "    processName = [string]$owner.ProcessName",
    "    localAddress = [string]$_.LocalAddress",
    "    localPort = [int]$_.LocalPort",
    "  }",
    "})",
    "[Console]::Out.Write((ConvertTo-Json -InputObject @($records) -Compress))",
  ].join("\n");
  const { stdout } = await execFileImpl(powershellPath, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);
  let records;
  try {
    records = JSON.parse(String(stdout).trim());
  } catch (cause) {
    throw new Error("Windows CDP owner query returned invalid JSON", { cause });
  }
  if (!Array.isArray(records)) {
    throw new Error("Windows CDP owner query did not return an array");
  }
  if (records.length === 0) return null;
  if (records.length !== 1) {
    throw new Error("Windows CDP loopback owner is not unique");
  }
  const record = records[0];
  const exactKeys = [
    "executablePath",
    "localAddress",
    "localPort",
    "pid",
    "processName",
    "startedAt",
  ];
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).sort().join("\0") !== exactKeys.sort().join("\0")
  ) {
    throw new Error("Windows CDP owner record schema is invalid");
  }
  if (record.localAddress !== "127.0.0.1" || record.localPort !== port) {
    throw new Error("Windows CDP owner is not an exact IPv4 loopback listener");
  }
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) {
    throw new Error("Windows CDP owner PID is invalid");
  }
  if (
    typeof record.processName !== "string" ||
    !WINDOWS_CODEX_PROCESS_NAMES.has(record.processName.toLowerCase())
  ) {
    throw new Error("Windows CDP owner is not a Codex process");
  }
  if (
    typeof record.executablePath !== "string" ||
    !win32.isAbsolute(record.executablePath) ||
    record.executablePath.includes("\0") ||
    /[\r\n]/.test(record.executablePath)
  ) {
    throw new Error("Windows CDP owner executable path is invalid");
  }
  if (typeof record.startedAt !== "string" || !WINDOWS_PROCESS_STARTED_AT.test(record.startedAt)) {
    throw new Error("Windows CDP owner process start time is invalid");
  }
  return {
    pid: record.pid,
    executablePath: record.executablePath,
    startedAt: record.startedAt,
  };
}

export async function validatePortOwner(port, processIdentity, {
  platform = process.platform,
  execFileImpl = execFile,
  powershellPath,
} = {}) {
  if (platform === "win32") {
    try {
      const observed = await probeWindowsCdpProcess(port, {
        execFileImpl,
        ...(powershellPath === undefined ? {} : { powershellPath }),
      });
      return sameProcessIdentity(observed, processIdentity);
    } catch {
      return false;
    }
  }
  let stdout;
  try {
    ({ stdout } = await execFileImpl("/usr/sbin/lsof", [
      "-nP",
      "-a",
      "-p",
      String(processIdentity.pid),
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]));
  } catch {
    return false;
  }
  const pids = stdout.split(/\s+/).filter(Boolean);
  return pids.length === 1 && Number(pids[0]) === processIdentity.pid;
}

async function assertPortIsFree(port) {
  try {
    const { stdout } = await execFile("/usr/sbin/lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    if (stdout.split(/\s+/).some(Boolean)) {
      const error = new Error(`CDP 端口 ${port} 已被其他进程占用`);
      error.code = "CDP_PORT_OCCUPIED";
      throw error;
    }
  } catch (error) {
    if (error?.code === 1) return true;
    throw error;
  }
  return true;
}

async function productionPreflight({ port, requirePort = true } = {}) {
  const app = await resolveCodexApp();
  const processes = await listCodexProcesses({ app });
  const candidates = requirePort
    ? processes.filter((entry) => entry.cdpPort === port)
    : processes;
  if ((requirePort && candidates.length !== 1) || (!requirePort && candidates.length > 1)) {
    const error = new Error(requirePort
      ? `端口不属于目标 Codex：${port}`
      : "无法唯一识别当前 Codex 进程");
    error.code = requirePort ? "CDP_NOT_OWNED" : "CODEX_PROCESS_AMBIGUOUS";
    throw error;
  }
  const processIdentity = candidates.length === 0 ? null : publicProcess(candidates[0]);
  if (requirePort && !(await validatePortOwner(port, processIdentity))) {
    const error = new Error(`端口不属于目标 Codex：${port}`);
    error.code = "CDP_NOT_OWNED";
    throw error;
  }
  if (!requirePort) await assertPortIsFree(port);
  return {
    appPath: app.appPath,
    nodePath: process.execPath,
    process: processIdentity,
  };
}

async function ensureProductionState({ paths, themeId, process: processIdentity, keepUntilProcessExit }) {
  const options = await lockOptions(paths);
  return withOperationLock({ ...options, operation: "cli:prepare-state" }, async (lease) => {
    let state = await readStudioState(paths.statePath);
    if (state === null) {
      state = createDefaultStudioState({
        themeId,
        token: randomBytes(32).toString("base64url"),
      });
      state = await writeStudioState(paths.statePath, state, { lease });
    } else if (state.selectedThemeId !== themeId || state.lastNonNativeThemeId !== themeId) {
      state = await compareAndUpdateStudioState(paths.statePath, {
        lease,
        expectedRevision: state.revision,
        mutate: (current) => ({
          ...current,
          selectedThemeId: themeId,
          lastNonNativeThemeId: themeId,
        }),
      });
    }
    if (processIdentity !== undefined) {
      await writeSessionState(paths.sessionPath, {
        schemaVersion: 1,
        mode: "active",
        process: processIdentity,
        activeThemeId: themeId,
        keepUntilProcessExit,
      }, { lease });
    }
    return state;
  });
}

async function themeBundle({ deps, roots, themeId }) {
  const themes = await deps.listThemes({ roots });
  const selected = themes.find((theme) => theme.id === themeId);
  if (!selected) throw new Error(`找不到主题：${themeId}`);
  const loadedTheme = await deps.loadTheme(selected.path);
  const menuThemes = [];
  for (const theme of themes) {
    if (theme.id === themeId) {
      menuThemes.push(loadedTheme);
      continue;
    }
    try {
      menuThemes.push(await deps.loadTheme(theme.path));
    } catch {
      // 坏主题不进入菜单，也不阻断一个已经完整验证的目标主题。
    }
  }
  return { loadedTheme, menuThemes, selected, themes };
}

export function controllerInjectionPreference({ ephemeral = false, preferStored } = {}) {
  if (preferStored !== undefined && typeof preferStored !== "boolean") {
    throw new TypeError("preferStored 必须是布尔值");
  }
  return preferStored ?? !ephemeral;
}

function windowsPowerShellPath() {
  const systemRoot = process.env.SystemRoot;
  if (typeof systemRoot !== "string" || systemRoot.length === 0) {
    throw new Error("Windows SystemRoot 不可用");
  }
  return join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

async function runWindowsControllerAction({
  action,
  taskName,
  port,
  stateRoot,
  revision,
  transitionNonce,
}) {
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(repositoryRoot, "scripts", "windows", "controller.ps1"),
    "-Action",
    action,
    "-TaskName",
    taskName,
    "-Port",
    String(port),
    "-StateDirectory",
    stateRoot,
  ];
  if (action === "start") {
    args.push(
      "-ExpectedRevision",
      String(revision),
      "-ExpectedTransitionNonce",
      transitionNonce,
    );
  }
  const { stdout } = await execFile(windowsPowerShellPath(), args);
  const text = stdout.trim();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`Windows controller ${action} 返回了无效 JSON`, { cause });
  }
}

export function normalizeWindowsBackgroundStatus(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { registered: false, running: false };
  }
  const registered = value.Exists === true;
  return {
    registered,
    running: registered && value.TaskRunning === true && value.State === "Running",
  };
}

async function exactReadyHandshake({
  stateRoot,
  expected,
  platform,
  backgroundIdentity,
}) {
  if (
    !Number.isSafeInteger(expected?.revision) ||
    typeof expected?.transitionNonce !== "string"
  ) {
    return false;
  }
  try {
    const document = await readBackgroundHandshake({ stateRoot });
    if (
      document === null ||
      document.revision !== expected.revision ||
      document.transitionNonce !== expected.transitionNonce ||
      document.platform !== platform ||
      document.backgroundIdentity !== backgroundIdentity ||
      document.outcome !== "ready"
    ) {
      return false;
    }
    const identity = await readProcessIdentity(document.pid, platform);
    return identity !== null &&
      identity.pid === document.pid &&
      identity.startedAt === document.startedAt;
  } catch {
    return false;
  }
}

async function productionController({
  port,
  paths,
  roots,
  deps,
  ephemeral = false,
  preferStored,
  platform = process.platform,
  taskName,
  startupHandshake = null,
  background = false,
}) {
  const injectionPreferStored = controllerInjectionPreference({ ephemeral, preferStored });
  const backgroundIdentity = controllerBackgroundIdentity(
    platform,
    platform === "win32" ? (taskName ?? WINDOWS_PRODUCTION_TASK) : taskName,
  );
  const lock = await lockOptions(paths, platform);
  let deferredWindowsUnregister = false;
  const probe = async () => {
    if (platform === "win32") return probeWindowsCdpProcess(port);
    const app = await resolveCodexApp({ platform });
    const candidates = (await listCodexProcesses({ app })).filter((entry) => entry.cdpPort === port);
    if (candidates.length === 0) return null;
    if (candidates.length !== 1) throw new Error("Codex 进程身份不唯一");
    return publicProcess(candidates[0]);
  };
  const initial = await readStudioState(paths.statePath);
  const logger = createStudioLogger({
    path: paths.logPath,
    token: initial?.controlToken ?? "",
  });
  return createSkinController({
    backgroundProcess: background,
    statePath: paths.statePath,
    sessionPath: paths.sessionPath,
    transitionPath: paths.transitionPath,
    lockOptions: lock,
    probeCurrentProcess: probe,
    validatePortOwner: async (candidate) => {
      const current = await probe();
      return sameProcessIdentity(current, candidate) && validatePortOwner(port, candidate, { platform });
    },
    inspectSkin: () => deps.skinStatus({ port }),
    injectSkin: async ({ themeId, control, targetIds }) => {
      const state = await readStudioState(paths.statePath);
      const effectiveThemeId = themeId === NATIVE_THEME_ID
        ? state?.lastNonNativeThemeId ?? DEFAULT_THEME_ID
        : themeId;
      const bundle = await themeBundle({ deps, roots, themeId: effectiveThemeId });
      return deps.applySkin({
        loadedTheme: bundle.loadedTheme,
        themes: bundle.menuThemes,
        port,
        preferStored: injectionPreferStored,
        control,
        targetIds,
      });
    },
    removeSkin: () => deps.removeSkin({ port }),
    prepareBackgroundHandshake: async ({ revision, transitionNonce }) => {
      await removeBackgroundHandshake({ stateRoot: paths.stateRoot });
      const request = await publishBackgroundStartRequest({
        stateRoot: paths.stateRoot,
        revision,
        transitionNonce,
        platform,
        backgroundIdentity,
      });
      return { notBefore: Date.parse(request.createdAt) };
    },
    registerBackground: () => platform === "darwin"
      ? registerControllerAgent().then((value) => ({
        ...value,
        registered: value.loaded === true,
      }))
      : runWindowsControllerAction({
        action: "register",
        taskName: backgroundIdentity,
        port,
        stateRoot: paths.stateRoot,
      }).then((value) => ({
        ...value,
        registered: value.Registered === true || value.Exists === true,
      })),
    unregisterBackground: async () => {
      if (platform === "darwin") {
        const value = await unregisterControllerAgent();
        await removeBackgroundStartRequest({ stateRoot: paths.stateRoot }).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        await removeBackgroundHandshake({ stateRoot: paths.stateRoot }).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        return { ...value, registered: false, loaded: false };
      }
      if (startupHandshake !== null) {
        deferredWindowsUnregister = true;
        return { registered: false, loaded: false, deferred: true };
      }
      const value = await runWindowsControllerAction({
        action: "unregister",
        taskName: backgroundIdentity,
        port,
        stateRoot: paths.stateRoot,
      });
      await removeBackgroundStartRequest({ stateRoot: paths.stateRoot }).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await removeBackgroundHandshake({ stateRoot: paths.stateRoot }).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      return { ...value, registered: false, loaded: false };
    },
    inspectBackground: async (expected) => {
      let status;
      if (platform === "darwin") {
        const value = await inspectLaunchAgent();
        status = {
          ...value,
          registered: value.plistExists === true && value.loaded === true,
          running: value.loaded === true,
        };
      } else {
        if (deferredWindowsUnregister) {
          return { registered: false, running: false, loaded: false, deferred: true };
        }
        const value = await runWindowsControllerAction({
          action: "status",
          taskName: backgroundIdentity,
          port,
          stateRoot: paths.stateRoot,
        });
        status = { ...value, ...normalizeWindowsBackgroundStatus(value) };
      }
      const loaded = status.registered === true &&
        status.running === true &&
        await exactReadyHandshake({
          stateRoot: paths.stateRoot,
          expected,
          platform,
          backgroundIdentity,
        });
      return { ...status, loaded };
    },
    wakeBackground: (request) => platform === "darwin"
      ? wakeControllerAgent()
      : runWindowsControllerAction({
        action: "start",
        taskName: backgroundIdentity,
        port,
        stateRoot: paths.stateRoot,
        revision: request.revision,
        transitionNonce: request.transitionNonce,
      }),
    verifyBackgroundHandshake: async ({ revision, transitionNonce, handshakeRequest }) => {
      const observed = await waitForBackgroundHandshake({
        stateRoot: paths.stateRoot,
        expected: {
          revision,
          transitionNonce,
          platform,
          backgroundIdentity,
          outcome: "ready",
        },
        forbiddenPid: process.pid,
        notBefore: handshakeRequest?.notBefore,
        readProcessIdentity: (pid) => readProcessIdentity(pid, platform),
      });
      await removeBackgroundHandshake({ stateRoot: paths.stateRoot });
      return observed.outcome === "ready";
    },
    preflightEnable: async () => true,
    logger,
  });
}

export async function runControllerProcess(controller, {
  once = false,
  startupHandshake = null,
  backgroundRuntime = null,
  paths,
  claimStartRequest = claimBackgroundStartRequest,
  publishHandshake = publishBackgroundHandshake,
  readCurrentIdentity,
} = {}) {
  if (startupHandshake !== null && backgroundRuntime !== null) {
    throw new Error("background controller cannot combine inline and one-shot handshake requests");
  }
  let activeHandshake = startupHandshake;
  if (backgroundRuntime !== null) {
    if (
      backgroundRuntime === null ||
      typeof backgroundRuntime !== "object" ||
      !["darwin", "win32"].includes(backgroundRuntime.platform) ||
      typeof backgroundRuntime.backgroundIdentity !== "string" ||
      backgroundRuntime.backgroundIdentity.length === 0
    ) {
      throw new Error("background runtime identity is invalid");
    }
    activeHandshake = await claimStartRequest({
      stateRoot: paths.stateRoot,
      platform: backgroundRuntime.platform,
      backgroundIdentity: backgroundRuntime.backgroundIdentity,
    });
  }
  let result = await controller.start();
  if (activeHandshake !== null) {
    try {
      if (result?.action === "error" || result?.mode === "error") {
        throw new Error("controller start failed before background handshake");
      }
      if (result?.revision !== activeHandshake.revision) {
        throw new Error("controller start revision does not match the handshake request");
      }
      const outcome = result.action === "unregister" ? "unregister" : "ready";
      if (
        (outcome === "ready" && result.persistenceEnabled !== true) ||
        (outcome === "unregister" && result.persistenceEnabled !== false)
      ) {
        throw new Error("controller start outcome does not match authoritative persistence state");
      }
      const identity = await (readCurrentIdentity ?? (() =>
        readProcessIdentity(process.pid, activeHandshake.platform)))();
      if (
        identity === null ||
        identity?.pid !== process.pid ||
        typeof identity?.startedAt !== "string" ||
        identity.startedAt.length === 0
      ) {
        throw new Error("controller process identity is unavailable for background handshake");
      }
      await publishHandshake({
        stateRoot: paths.stateRoot,
        revision: activeHandshake.revision,
        transitionNonce: activeHandshake.transitionNonce,
        platform: activeHandshake.platform,
        backgroundIdentity: activeHandshake.backgroundIdentity,
        pid: identity.pid,
        startedAt: identity.startedAt,
        outcome,
      });
    } catch (error) {
      await controller.stop();
      throw error;
    }
  }
  if (once || result.action === "unregister" || result.action === "error") {
    await controller.stop();
    return result;
  }
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await controller.tick();
    if (result.action === "unregister") {
      await controller.stop();
      return result;
    }
  }
}

export async function waitForAppliedSkin({
  deps,
  port,
  themeId,
  attempts = 80,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const status = await deps.skinStatus({ port });
      const statuses = status?.statuses;
      const failed = status?.failed;
      const succeededResults = status?.results?.succeeded;
      const failedResults = status?.results?.failed;
      if (
        Array.isArray(statuses) && statuses.length > 0 &&
        Array.isArray(failed) && failed.length === 0 &&
        Array.isArray(succeededResults) && succeededResults.length === statuses.length &&
        Array.isArray(failedResults) && failedResults.length === 0 &&
        statuses.every((entry) => (
          entry?.installed === true && entry?.mode === "active" && entry?.themeId === themeId
        ))
      ) {
        return true;
      }
    } catch {}
    await wait(250);
  }
  throw new Error("ephemeral controller 未确认皮肤已应用");
}

async function productionRegisterEphemeral({ deps, paths, port, preflight, themeId }) {
  await ensureProductionState({
    paths,
    themeId,
    process: preflight.process,
    keepUntilProcessExit: true,
  });
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.url),
    "controller",
    "--ephemeral",
    "--port",
    String(port),
  ], { detached: true, stdio: "ignore" });
  child.unref();
  await waitForAppliedSkin({ deps, port, themeId });
  return { mode: "active" };
}

async function productionRestartDetached({ paths, preflight, launchMode, port, afterLaunch = null }) {
  const actionPath = join(paths.stateRoot, `lifecycle-${randomUUID()}.json`);
  await writeLifecycleActionFile(actionPath, {
    process: preflight.process,
    appPath: preflight.appPath,
    launchMode,
    port: launchMode === "cdp" ? port : null,
    verifyPort: launchMode === "native" ? port : null,
    afterLaunch: afterLaunch === null
      ? null
      : {
        command: afterLaunch.command,
        cliPath: fileURLToPath(import.meta.url),
        nodePath: preflight.nodePath,
        port,
        themeId: afterLaunch.themeId,
      },
  });
  return spawnDetachedLifecycle({
    nodePath: preflight.nodePath,
    helperPath: join(repositoryRoot, "src", "lifecycle-helper.mjs"),
    actionPath,
  });
}

async function legacyLoaded() {
  if (typeof process.getuid !== "function") throw new Error("migrate-legacy 只支持 macOS 当前用户");
  try {
    await execFile("/bin/launchctl", [
      "print",
      `gui/${process.getuid()}/com.heige.codex-skin-watchdog`,
    ]);
    return true;
  } catch (error) {
    if (error?.code === 3 || error?.code === 113) return false;
    throw error;
  }
}

async function productionMigrateLegacy({ deps, paths, roots }) {
  const existing = await readStudioState(paths.statePath);
  if (existing !== null) {
    return {
      migratedFrom: null,
      persistenceEnabled: existing.persistenceEnabled,
    };
  }
  const loaded = await legacyLoaded();
  const options = await lockOptions(paths);
  return withOperationLock({ ...options, operation: "cli:migrate-legacy" }, async (lease) => {
    const current = await readStudioState(paths.statePath);
    if (current !== null) {
      return { migratedFrom: null, persistenceEnabled: current.persistenceEnabled };
    }
    if (loaded) await migrateLegacyWatchdog();
    const migrated = await migrateLegacyState({
      statePath: paths.statePath,
      lease,
      legacyThemePath: join(process.env.HOME, ".codex", "heige-codex-skin-persist", "theme"),
      legacyAgentLoaded: loaded,
      themeExists: async (themeId) => {
        const themes = await deps.listThemes({ roots });
        return themes.some((theme) => theme.id === themeId);
      },
    });
    return {
      migratedFrom: migrated.migratedFrom,
      persistenceEnabled: migrated.state.persistenceEnabled,
    };
  });
}

async function productionChooseThemeInputs() {
  try {
    const image = await execFile("/usr/bin/osascript", [
      "-e",
      'POSIX path of (choose file with prompt "选择一张皮肤主图" of type {"public.image"})',
    ]);
    const name = await execFile("/usr/bin/osascript", [
      "-e",
      'text returned of (display dialog "给皮肤起个名字" default answer "我的 Codex 皮肤")',
    ]);
    return {
      imagePath: image.stdout.trim(),
      name: name.stdout.trim(),
    };
  } catch (error) {
    if (/\(-128\)|User canceled/i.test(String(error?.stderr ?? error?.message ?? ""))) return null;
    throw error;
  }
}

function defaults(overrides, { paths: selectedPaths, platform = process.platform } = {}) {
  const paths = overrides.paths ?? selectedPaths ?? resolveStudioPaths({ platform });
  const bundledThemesRoot = join(repositoryRoot, "themes");
  const roots = [bundledThemesRoot, paths.userThemesRoot];
  const base = {
    bundledThemesRoot,
    userThemesRoot: paths.userThemesRoot,
    paths,
    roots,
    home: process.env.HOME,
    nodeVersion: process.versions.node,
    loadTheme,
    listThemes,
    createSingleImageTheme,
    installPet,
    applySkin,
    removeSkin,
    skinStatus,
    readState: () => readStudioState(paths.statePath),
    preflightLifecycle: productionPreflight,
    chooseThemeInputs: productionChooseThemeInputs,
  };
  const merged = { ...base, ...overrides };
  merged.roots = [merged.bundledThemesRoot, merged.userThemesRoot];
  merged.ensureState = overrides.ensureState ?? (overrides.readState
    ? async () => overrides.readState()
    : ({ themeId, preflight, keepUntilProcessExit = true }) => ensureProductionState({
      paths: merged.paths,
      themeId,
      process: preflight?.process,
      keepUntilProcessExit,
    }));
  merged.registerEphemeralController = overrides.registerEphemeralController ?? ((input) =>
    productionRegisterEphemeral({ ...input, deps: merged, paths: merged.paths }));
  merged.createController = overrides.createController ?? ((input) =>
    productionController({ ...input, deps: merged, paths: merged.paths, roots: merged.roots }));
  merged.runController = overrides.runController ?? (overrides.createController
    ? (controller) => controller.start()
    : ((controller, options) => runControllerProcess(controller, {
      ...options,
      paths: merged.paths,
    })));
  merged.restartDetached = overrides.restartDetached ?? ((input) =>
    productionRestartDetached({ ...input, paths: merged.paths }));
  merged.migrateLegacy = overrides.migrateLegacy ?? ((input) =>
    productionMigrateLegacy({ ...input, deps: merged, paths: merged.paths, roots: merged.roots }));
  return merged;
}

async function lifecycleController(deps, input) {
  const controller = await deps.createController(input);
  if (!controller || typeof controller !== "object") throw new Error("controller 创建失败");
  return controller;
}

async function preflightWithNativeFallback(deps, input) {
  try {
    return {
      preflight: await deps.preflightLifecycle({ ...input, requirePort: true }),
      restartRequired: false,
    };
  } catch (error) {
    if (error?.code !== "CDP_NOT_OWNED") throw error;
    return {
      preflight: await deps.preflightLifecycle({ ...input, requirePort: false }),
      restartRequired: true,
    };
  }
}

async function applySelectedTheme({ deps, roots, command, port, preferStored, themeId }) {
  const bundle = await themeBundle({ deps, roots, themeId });
  const { preflight, restartRequired } = await preflightWithNativeFallback(deps, {
    command,
    port,
    themeId,
  });
  const before = await deps.readState();
  if (restartRequired) {
    const queued = await deps.restartDetached({
      launchMode: "cdp",
      port,
      preflight,
      themeId,
      afterLaunch: { command: "apply", themeId },
    });
    return {
      mode: "restarting",
      persistenceEnabled: before?.persistenceEnabled === true,
      queued: queued?.queued === true,
    };
  }
  const applied = await deps.registerEphemeralController({
    loadedTheme: bundle.loadedTheme,
    themes: bundle.menuThemes,
    port,
    preferStored,
    preflight,
    themeId,
  });
  return {
    ...applied,
    persistenceEnabled: before?.persistenceEnabled === true,
  };
}

async function withStoppedController(controller, action) {
  try {
    return await action();
  } finally {
    await controller.stop?.();
  }
}

export async function runCli(argv, overrides = {}) {
  const { args, command, positionals } = parseInvocation(argv);
  const selectedControllerPlatform = command === "controller"
    ? controllerPlatform(args.platform)
    : process.platform;
  const selectedTaskName = command === "controller" ? args["task-name"] : undefined;
  const selectedBackgroundIdentity = command === "controller"
    ? controllerBackgroundIdentity(selectedControllerPlatform, selectedTaskName)
    : undefined;
  const selectedPaths = command === "controller"
    ? controllerPaths({
      platform: selectedControllerPlatform,
      stateDirectory: args["state-directory"],
      taskName: selectedTaskName,
    })
    : undefined;
  const deps = defaults(overrides, {
    paths: selectedPaths,
    platform: selectedControllerPlatform,
  });
  if (command === "help") {
    return {
      commands: [
        "list",
        "create --image PATH --name NAME",
        "customize [--image PATH --name NAME]",
        "apply [--theme ID] [--port 9341]",
        "enable-skin [--theme ID] [--port 9341]",
        "set-persistence true|false [--revision N]",
        "pause",
        "resume",
        "restore",
        "controller",
        "migrate-legacy",
        "status",
        "doctor",
        "install-pet [--source PATH]",
      ],
    };
  }
  assertNodeVersion(deps.nodeVersion);
  const roots = deps.roots;

  if (command === "list") return deps.listThemes({ roots });
  if (command === "create") {
    if (!args.image) throw new Error("create 需要 --image");
    if (!args.name) throw new Error("create 需要 --name");
    return deps.createSingleImageTheme({
      imagePath: args.image,
      name: args.name,
      storeRoot: deps.userThemesRoot,
    });
  }
  if (command === "customize") {
    if (Boolean(args.image) !== Boolean(args.name)) {
      throw new Error("customize 的 --image 和 --name 必须同时提供");
    }
    const input = args.image
      ? { imagePath: args.image, name: args.name }
      : await deps.chooseThemeInputs();
    if (input === null) return { cancelled: true };
    const created = await deps.createSingleImageTheme({
      imagePath: input.imagePath,
      name: input.name,
      storeRoot: deps.userThemesRoot,
    });
    if (typeof created?.id !== "string") throw new Error("新主题未返回有效 ID");
    const applied = await applySelectedTheme({
      deps,
      roots,
      command: "customize",
      port: portFrom(args.port),
      preferStored: false,
      themeId: created.id,
    });
    return { created, applied };
  }
  if (command === "apply") {
    const themeId = args.theme ?? DEFAULT_THEME_ID;
    const port = portFrom(args.port);
    return applySelectedTheme({
      deps,
      roots,
      command,
      port,
      preferStored: Boolean(args["prefer-stored"]),
      themeId,
    });
  }
  if (command === "enable-skin" || command === "enable-after-restart") {
    const before = await deps.readState();
    const themeId = args.theme ?? before?.lastNonNativeThemeId ?? DEFAULT_THEME_ID;
    await themeBundle({ deps, roots, themeId });
    const port = portFrom(args.port);
    const allowRestart = command === "enable-skin";
    const preflightResult = allowRestart
      ? await preflightWithNativeFallback(deps, { command, port, themeId })
      : {
        preflight: await deps.preflightLifecycle({ command, port, requirePort: true, themeId }),
        restartRequired: false,
      };
    const { preflight, restartRequired } = preflightResult;
    if (restartRequired) {
      const queued = await deps.restartDetached({
        launchMode: "cdp",
        port,
        preflight,
        themeId,
        afterLaunch: { command: "enable-after-restart", themeId },
      });
      return {
        mode: "restarting",
        persistenceEnabled: before?.persistenceEnabled === true,
        queued: queued?.queued === true,
      };
    }
    const state = await deps.ensureState({ themeId, preflight, keepUntilProcessExit: true });
    const controller = await lifecycleController(deps, { port, preflight, preferStored: false });
    await withStoppedController(controller, () => controller.setPersistence({
      expectedRevision: state.revision,
      enabled: true,
    }));
    if (command === "enable-skin") {
      await deps.restartDetached({ launchMode: "cdp", port, preflight, themeId });
    }
    return { mode: "active", persistenceEnabled: true };
  }
  if (command === "set-persistence") {
    const enabled = exactBoolean(positionals[0]);
    const port = portFrom(args.port);
    const state = await deps.readState();
    if (state === null) throw new Error("状态文件不存在，请先运行 apply");
    const preflight = await deps.preflightLifecycle({ command, port, requirePort: true });
    const controller = await lifecycleController(deps, { port, preflight });
    return withStoppedController(controller, () => controller.setPersistence({
      expectedRevision: revisionFrom(args.revision, state.revision),
      enabled,
    }));
  }
  if (command === "pause" || command === "resume" || command === "restore") {
    const port = portFrom(args.port);
    const preflight = await deps.preflightLifecycle({ command, port, requirePort: true });
    const controller = await lifecycleController(deps, { port, preflight });
    const result = await withStoppedController(controller, () => controller[command]());
    if (command === "restore") {
      await deps.restartDetached({ launchMode: "native", port, preflight });
    }
    return result;
  }
  if (command === "controller") {
    const port = portFrom(args.port);
    const startupHandshake = null;
    const controller = await lifecycleController(deps, {
      background: Boolean(args.background),
      ephemeral: Boolean(args.ephemeral),
      platform: selectedControllerPlatform,
      port,
      taskName: selectedTaskName,
      startupHandshake,
    });
    const result = await deps.runController(controller, {
      backgroundRuntime: args.background
        ? {
          platform: selectedControllerPlatform,
          backgroundIdentity: selectedBackgroundIdentity,
        }
        : null,
      once: Boolean(args.once),
      startupHandshake,
    });
    if (result?.action === "error" || result?.mode === "error") {
      throw new Error("控制器启动或巡检失败");
    }
    return result;
  }
  if (command === "migrate-legacy") {
    return deps.migrateLegacy({ port: portFrom(args.port) });
  }
  if (command === "status") return deps.skinStatus({ port: portFrom(args.port) });
  if (command === "install-pet") {
    return deps.installPet({
      sourceRoot: args.source ?? join(repositoryRoot, "custom-pet/miku-future"),
      home: deps.home,
    });
  }
  if (command === "doctor") {
    const discovery = await (deps.discoverCodex ?? discoverCodex)();
    const runtime = await (deps.runtimeDiagnostics ?? runtimeDiagnostics)({
      appPath: discovery.app,
      port: portFrom(args.port),
    });
    return {
      ...discovery,
      cdpPort: portFrom(args.port),
      ...runtime,
      diagnosis: classifyInjection(runtime),
    };
  }
  throw new Error(`未知命令：${command}`);
}

// argv[1] 保留符号链接原路径，import.meta.url 是 realpath。先解真实路径再比较。
function isMainEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  let real = entry;
  try {
    real = realpathSync(entry);
  } catch {}
  return pathToFileURL(real).href === import.meta.url;
}

if (isMainEntry()) {
  runCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`HeiGe Codex Skin Studio：${error.message}\n`);
      process.exitCode = 1;
    });
}
