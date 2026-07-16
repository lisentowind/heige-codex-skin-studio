import { randomBytes as cryptoRandomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  DEFAULT_THEME_ID,
  NATIVE_THEME_ID,
  STATE_SCHEMA_VERSION,
} from "./constants.mjs";
import { sameProcessIdentity } from "./codex-app.mjs";

const STATE_KEYS = [
  "schemaVersion",
  "persistenceEnabled",
  "selectedThemeId",
  "lastNonNativeThemeId",
  "controlToken",
  "lastTransitionNonce",
  "revision",
];
const SESSION_KEYS = [
  "schemaVersion",
  "mode",
  "process",
  "activeThemeId",
  "keepUntilProcessExit",
];
const TRANSITION_KEYS = [
  "schemaVersion",
  "operation",
  "expectedRevision",
  "process",
  "desiredPersistenceEnabled",
  "nonce",
  "stage",
];
const SESSION_MODES = new Set(["active", "native", "paused", "restoring", "error"]);
const TRANSITION_OPERATIONS = new Map([
  ["disable-persistence", false],
  ["enable-persistence", true],
]);
const TRANSITION_STAGES = new Set(["prepared", "state-committed", "session-committed"]);
const THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TRANSITION_NONCE = /^[A-Za-z0-9_-]{1,256}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, keys, label) {
  if (!isRecord(value)) throw new Error(`${label}必须是对象`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}字段不完整或包含未知字段`);
  }
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateThemeId(value, { allowNative = false, field = "主题 ID" } = {}) {
  if (allowNative && value === NATIVE_THEME_ID) return value;
  if (typeof value !== "string" || !THEME_ID.test(value)) {
    throw new Error(`${field}格式无效`);
  }
  return value;
}

function validateControlToken(value) {
  if (
    typeof value !== "string" ||
    !CONTROL_TOKEN.test(value) ||
    Buffer.from(value, "base64url").length !== 32 ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  ) {
    throw new Error("controlToken 必须是 32 字节无填充 base64url");
  }
  return value;
}

function validateNonce(value, { allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (typeof value !== "string" || !TRANSITION_NONCE.test(value)) {
    throw new Error("transition nonce 必须是安全的非空标识符");
  }
  return value;
}

function validateProcessIdentity(value, { allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  assertExactKeys(value, ["pid", "executablePath", "startedAt"], "进程身份");
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new Error("进程 pid 必须是正整数");
  }
  if (typeof value.executablePath !== "string" || !value.executablePath) {
    throw new Error("进程 executablePath 必须是非空字符串");
  }
  if (typeof value.startedAt !== "string" || !value.startedAt) {
    throw new Error("进程 startedAt 必须是非空字符串");
  }
  return {
    pid: value.pid,
    executablePath: value.executablePath,
    startedAt: value.startedAt,
  };
}

async function ensurePrivateParent(path) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  return parent;
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWriteJson(path, value) {
  const parent = await ensurePrivateParent(path);
  const temporary = join(
    parent,
    `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`,
  );
  let handle = null;
  let renamed = false;

  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    await rename(temporary, path);
    renamed = true;
    await chmod(path, 0o600);
    await syncDirectory(parent);
    return value;
  } catch (error) {
    if (handle !== null) await handle.close().catch(() => {});
    if (!renamed) await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(path, { damagedMessage, validate }) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(damagedMessage, { cause });
  }
  return validate(parsed);
}

export function validateStudioState(value) {
  if (!isRecord(value)) throw new Error("状态文件必须是对象");
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`不支持的状态 schemaVersion：${value.schemaVersion}`);
  }
  assertExactKeys(value, STATE_KEYS, "状态文件");
  if (typeof value.persistenceEnabled !== "boolean") {
    throw new Error("persistenceEnabled 必须是布尔值");
  }
  const selectedThemeId = validateThemeId(value.selectedThemeId, {
    allowNative: true,
    field: "selectedThemeId",
  });
  const lastNonNativeThemeId = validateThemeId(value.lastNonNativeThemeId, {
    field: "lastNonNativeThemeId",
  });
  const controlToken = validateControlToken(value.controlToken);
  const lastTransitionNonce = validateNonce(value.lastTransitionNonce, { allowNull: true });
  if (!isNonNegativeInteger(value.revision)) {
    throw new Error("revision 必须是非负安全整数");
  }
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    persistenceEnabled: value.persistenceEnabled,
    selectedThemeId,
    lastNonNativeThemeId,
    controlToken,
    lastTransitionNonce,
    revision: value.revision,
  };
}

export function createDefaultStudioState({ themeId, token }) {
  return validateStudioState({
    schemaVersion: STATE_SCHEMA_VERSION,
    persistenceEnabled: false,
    selectedThemeId: themeId,
    lastNonNativeThemeId: themeId,
    controlToken: token,
    lastTransitionNonce: null,
    revision: 0,
  });
}

export async function readStudioState(path) {
  return readJson(path, {
    damagedMessage: "状态文件损坏：不是有效 JSON",
    validate: validateStudioState,
  });
}

export async function writeStudioState(path, value) {
  const state = validateStudioState(value);
  return atomicWriteJson(path, state);
}

async function readRequiredStudioState(path) {
  const state = await readStudioState(path);
  if (state === null) throw new Error("状态文件不存在");
  return state;
}

export class StateConflictError extends Error {
  constructor(state) {
    super(`状态 revision 冲突，当前为 ${state.revision}`);
    this.name = "StateConflictError";
    this.code = "REVISION_CONFLICT";
    this.state = structuredClone(state);
  }
}

export async function compareAndUpdateStudioState(path, { expectedRevision, mutate }) {
  if (!isNonNegativeInteger(expectedRevision)) {
    throw new Error("expectedRevision 必须是非负安全整数");
  }
  if (typeof mutate !== "function") throw new Error("mutate 必须是函数");

  const current = await readRequiredStudioState(path);
  if (current.revision !== expectedRevision) throw new StateConflictError(current);
  const mutated = mutate(structuredClone(current));
  const next = validateStudioState({
    ...mutated,
    revision: current.revision + 1,
  });
  return writeStudioState(path, next);
}

function generateControlToken(randomBytes) {
  const entropy = randomBytes(32);
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== 32) {
    throw new Error("controlToken 随机源必须返回 32 字节");
  }
  return Buffer.from(entropy).toString("base64url");
}

export async function migrateLegacyState({
  statePath,
  legacyThemePath,
  legacyAgentLoaded,
  themeExists,
  defaultThemeId = DEFAULT_THEME_ID,
  randomBytes = cryptoRandomBytes,
}) {
  const existing = await readStudioState(statePath);
  if (existing !== null) {
    return { state: existing, migratedFrom: null };
  }
  if (typeof legacyAgentLoaded !== "boolean") {
    throw new Error("legacyAgentLoaded 必须是布尔值");
  }
  if (typeof themeExists !== "function") throw new Error("themeExists 必须是函数");

  let themeId = defaultThemeId;
  let persistenceEnabled = false;
  let revision = 0;
  let migratedFrom = null;

  if (legacyAgentLoaded) {
    let legacyTheme;
    try {
      legacyTheme = await readFile(legacyThemePath, "utf8");
    } catch (cause) {
      throw new Error("旧版主题状态无效：无法读取主题文件", { cause });
    }
    themeId = legacyTheme.trim();
    try {
      validateThemeId(themeId, { field: "旧版主题 ID" });
    } catch (cause) {
      throw new Error("旧版主题状态无效：主题 ID 格式错误", { cause });
    }
    if (await themeExists(themeId) !== true) {
      throw new Error("旧版主题状态无效：主题不存在");
    }
    persistenceEnabled = true;
    revision = 1;
    migratedFrom = "watchdog";
  } else {
    validateThemeId(themeId, { field: "默认主题 ID" });
    if (await themeExists(themeId) !== true) {
      throw new Error("默认主题不存在，拒绝创建状态");
    }
  }

  const token = generateControlToken(randomBytes);
  const state = validateStudioState({
    ...createDefaultStudioState({ themeId, token }),
    persistenceEnabled,
    revision,
  });
  await writeStudioState(statePath, state);
  return { state, migratedFrom };
}

export function validateSessionState(value) {
  if (!isRecord(value)) throw new Error("session 状态必须是对象");
  if (value.schemaVersion !== 1) {
    throw new Error(`不支持的 session schemaVersion：${value.schemaVersion}`);
  }
  assertExactKeys(value, SESSION_KEYS, "session 状态");
  if (!SESSION_MODES.has(value.mode)) throw new Error("session mode 无效");
  const processIdentity = validateProcessIdentity(value.process, { allowNull: true });
  const activeThemeId = value.activeThemeId === null
    ? null
    : validateThemeId(value.activeThemeId, { field: "activeThemeId" });
  if (typeof value.keepUntilProcessExit !== "boolean") {
    throw new Error("keepUntilProcessExit 必须是布尔值");
  }
  if (value.keepUntilProcessExit && processIdentity === null) {
    throw new Error("keepUntilProcessExit 需要精确进程身份");
  }
  return {
    schemaVersion: 1,
    mode: value.mode,
    process: processIdentity,
    activeThemeId,
    keepUntilProcessExit: value.keepUntilProcessExit,
  };
}

export async function readSessionState(path) {
  return readJson(path, {
    damagedMessage: "session 状态文件损坏：不是有效 JSON",
    validate: validateSessionState,
  });
}

export async function writeSessionState(path, value) {
  const session = validateSessionState(value);
  return atomicWriteJson(path, session);
}

export function validateTransitionJournal(value) {
  if (!isRecord(value)) throw new Error("迁移日志必须是对象");
  if (value.schemaVersion !== 1) {
    throw new Error(`不支持的迁移日志 schemaVersion：${value.schemaVersion}`);
  }
  assertExactKeys(value, TRANSITION_KEYS, "迁移日志");
  if (!TRANSITION_OPERATIONS.has(value.operation)) {
    throw new Error("迁移日志 operation 无效");
  }
  if (!isNonNegativeInteger(value.expectedRevision)) {
    throw new Error("迁移日志 expectedRevision 必须是非负安全整数");
  }
  const processIdentity = validateProcessIdentity(value.process);
  if (typeof value.desiredPersistenceEnabled !== "boolean") {
    throw new Error("迁移日志 desiredPersistenceEnabled 必须是布尔值");
  }
  if (TRANSITION_OPERATIONS.get(value.operation) !== value.desiredPersistenceEnabled) {
    throw new Error("迁移日志 operation 与目标状态不一致");
  }
  const nonce = validateNonce(value.nonce);
  if (!TRANSITION_STAGES.has(value.stage)) throw new Error("迁移日志 stage 无效");
  return {
    schemaVersion: 1,
    operation: value.operation,
    expectedRevision: value.expectedRevision,
    process: processIdentity,
    desiredPersistenceEnabled: value.desiredPersistenceEnabled,
    nonce,
    stage: value.stage,
  };
}

export async function readTransitionJournal(path) {
  return readJson(path, {
    damagedMessage: "迁移日志损坏：不是有效 JSON",
    validate: validateTransitionJournal,
  });
}

export async function writeTransitionJournal(path, value) {
  const journal = validateTransitionJournal(value);
  return atomicWriteJson(path, journal);
}

export async function clearTransitionJournal(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await syncDirectory(dirname(path));
}

export class TransitionConflictError extends Error {
  constructor(state, journal) {
    super("状态迁移冲突：revision、目标状态或 nonce 不匹配");
    this.name = "TransitionConflictError";
    this.code = "TRANSITION_CONFLICT";
    this.state = structuredClone(state);
    this.journal = structuredClone(journal);
  }
}

function isCommittedTransition(state, journal) {
  return state.revision === journal.expectedRevision + 1 &&
    state.persistenceEnabled === journal.desiredPersistenceEnabled &&
    state.lastTransitionNonce === journal.nonce;
}

function sessionForTransition(state, journal, currentProcess) {
  const processStillRunning = currentProcess !== null &&
    sameProcessIdentity(journal.process, currentProcess);
  const selectedNative = state.selectedThemeId === NATIVE_THEME_ID;

  if (journal.operation === "disable-persistence" && processStillRunning) {
    return {
      schemaVersion: 1,
      mode: selectedNative ? "native" : "active",
      process: journal.process,
      activeThemeId: selectedNative ? null : state.selectedThemeId,
      keepUntilProcessExit: true,
    };
  }

  if (journal.operation === "enable-persistence" && processStillRunning) {
    return {
      schemaVersion: 1,
      mode: selectedNative ? "native" : "active",
      process: journal.process,
      activeThemeId: selectedNative ? null : state.selectedThemeId,
      keepUntilProcessExit: false,
    };
  }

  return {
    schemaVersion: 1,
    mode: "native",
    process: null,
    activeThemeId: null,
    keepUntilProcessExit: false,
  };
}

export async function recoverStateTransition({
  statePath,
  sessionPath,
  transitionPath,
  currentProcess,
}) {
  let journal = await readTransitionJournal(transitionPath);
  if (journal === null) {
    return {
      state: await readStudioState(statePath),
      session: await readSessionState(sessionPath),
      recovered: false,
    };
  }
  if (currentProcess !== null && currentProcess !== undefined) {
    currentProcess = validateProcessIdentity(currentProcess);
  } else {
    currentProcess = null;
  }

  let state = await readRequiredStudioState(statePath);
  if (journal.stage === "prepared" && state.revision === journal.expectedRevision) {
    state = await compareAndUpdateStudioState(statePath, {
      expectedRevision: journal.expectedRevision,
      mutate: (current) => ({
        ...current,
        persistenceEnabled: journal.desiredPersistenceEnabled,
        lastTransitionNonce: journal.nonce,
      }),
    });
    journal = await writeTransitionJournal(transitionPath, {
      ...journal,
      stage: "state-committed",
    });
  } else if (journal.stage === "prepared" && isCommittedTransition(state, journal)) {
    journal = await writeTransitionJournal(transitionPath, {
      ...journal,
      stage: "state-committed",
    });
  } else if (journal.stage === "prepared") {
    throw new TransitionConflictError(state, journal);
  }

  if (!isCommittedTransition(state, journal)) {
    throw new TransitionConflictError(state, journal);
  }

  const session = sessionForTransition(state, journal, currentProcess);
  await writeSessionState(sessionPath, session);
  if (journal.stage !== "session-committed") {
    journal = await writeTransitionJournal(transitionPath, {
      ...journal,
      stage: "session-committed",
    });
  }
  await clearTransitionJournal(transitionPath);
  return { state, session, recovered: true };
}
