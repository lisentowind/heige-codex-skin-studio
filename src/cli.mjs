#!/usr/bin/env node
import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

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
  inspectLaunchAgent,
  migrateLegacyWatchdog,
  registerControllerAgent,
  unregisterControllerAgent,
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
const BOOLEAN_FLAGS = new Set(["ephemeral", "once", "prefer-stored"]);
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
  ["controller", new Set(["ephemeral", "once", "platform", "port", "task-name"])],
  ["migrate-legacy", new Set(["port"])],
  ["status", new Set(["port"])],
  ["doctor", new Set(["port"])],
  ["install-pet", new Set(["source"])],
]);

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

async function readPsIdentity(pid) {
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

async function currentLockIdentity() {
  const identity = await readPsIdentity(process.pid);
  if (identity === null) throw new Error("无法读取当前 CLI 进程身份");
  return identity;
}

async function lockOptions(paths) {
  return {
    lockPath: paths.lockPath,
    stateRoot: paths.stateRoot,
    identity: await currentLockIdentity(),
    readProcessIdentity: readPsIdentity,
  };
}

async function validatePortOwner(port, processIdentity) {
  let stdout;
  try {
    ({ stdout } = await execFile("/usr/sbin/lsof", [
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

async function productionController({ port, paths, roots, deps, ephemeral = false, preferStored }) {
  const injectionPreferStored = controllerInjectionPreference({ ephemeral, preferStored });
  const lock = await lockOptions(paths);
  const probe = async () => {
    const app = await resolveCodexApp();
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
    statePath: paths.statePath,
    sessionPath: paths.sessionPath,
    transitionPath: paths.transitionPath,
    lockOptions: lock,
    probeCurrentProcess: probe,
    validatePortOwner: async (candidate) => {
      const current = await probe();
      return sameProcessIdentity(current, candidate) && validatePortOwner(port, candidate);
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
    registerBackground: () => registerControllerAgent(),
    unregisterBackground: () => unregisterControllerAgent(),
    inspectBackground: () => inspectLaunchAgent(),
    wakeBackground: async () => true,
    verifyBackgroundHandshake: async () => (await inspectLaunchAgent()).loaded === true,
    preflightEnable: async () => true,
    logger,
  });
}

async function productionRunController(controller, { once = false } = {}) {
  let result = await controller.start();
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

function defaults(overrides) {
  const paths = resolveStudioPaths();
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
    : productionRunController);
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
  const deps = defaults(overrides);
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
    const controller = await lifecycleController(deps, {
      ephemeral: Boolean(args.ephemeral),
      platform: args.platform ?? process.platform,
      port,
      taskName: args["task-name"] ?? null,
    });
    const result = await deps.runController(controller, { once: Boolean(args.once) });
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
