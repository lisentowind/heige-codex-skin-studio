import { randomBytes } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse } from "node:path";

const LOCK_SCHEMA_VERSION = 1;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const MAX_ACQUIRE_ATTEMPTS = 32;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

class OperationLockError extends Error {
  constructor(code, message, options = undefined) {
    super(`${code}: ${message}`, options);
    this.name = "OperationLockError";
    this.code = code;
  }
}

function lockError(code, message, cause) {
  return new OperationLockError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function validateLockPath(lockPath) {
  if (
    typeof lockPath !== "string" ||
    !isAbsolute(lockPath) ||
    lockPath.includes("\0") ||
    basename(lockPath) === "" ||
    dirname(lockPath) === parse(lockPath).root
  ) {
    throw lockError(
      "LOCK_PATH_INVALID",
      "lockPath must be an absolute file path below a private parent directory",
    );
  }
  return lockPath;
}

function validateOperation(operation) {
  if (typeof operation !== "string" || !OPERATION_PATTERN.test(operation)) {
    throw lockError(
      "LOCK_OPERATION_INVALID",
      "operation must be a non-empty stable identifier",
    );
  }
  return operation;
}

function validateIdentity(identity, code = "LOCK_IDENTITY_INVALID") {
  if (
    identity === null ||
    typeof identity !== "object" ||
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0 ||
    typeof identity.startedAt !== "string" ||
    identity.startedAt.trim().length === 0 ||
    identity.startedAt.length > 512 ||
    identity.startedAt.includes("\0")
  ) {
    throw lockError(
      code,
      "process identity must contain a positive pid and non-empty startedAt",
    );
  }
  return { pid: identity.pid, startedAt: identity.startedAt };
}

function validateTimestamp(value, field, code) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw lockError(code, `${field} must be an ISO-compatible timestamp`);
  }
  return value;
}

function validateOwnerRecord(value, code = "LOCK_MALFORMED") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw lockError(code, "owner must be a JSON object");
  }
  if (value.schemaVersion !== LOCK_SCHEMA_VERSION) {
    throw lockError(code, "owner has an unsupported schemaVersion");
  }
  if (typeof value.nonce !== "string" || !NONCE_PATTERN.test(value.nonce)) {
    throw lockError(code, "owner nonce is invalid");
  }
  validateIdentity(value, code);
  validateOperationForRecord(value.operation, code);
  validateTimestamp(value.createdAt, "createdAt", code);
  validateTimestamp(value.heartbeat, "heartbeat", code);
  return value;
}

function validateOperationForRecord(operation, code) {
  if (typeof operation !== "string" || !OPERATION_PATTERN.test(operation)) {
    throw lockError(code, "owner operation is invalid");
  }
}

function fileMode(metadata) {
  return metadata.mode & 0o777;
}

function requirePrivateMode(metadata, code, description) {
  if (process.platform !== "win32" && fileMode(metadata) !== PRIVATE_FILE_MODE) {
    throw lockError(
      code,
      `${description} must have mode 0600, found ${fileMode(metadata).toString(8)}`,
    );
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function createNonce() {
  return randomBytes(24).toString("base64url");
}

function timestampFrom(now) {
  let value;
  try {
    value = now();
  } catch (cause) {
    throw lockError("LOCK_CLOCK_FAILED", "clock dependency failed", cause);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw lockError("LOCK_CLOCK_FAILED", "clock dependency returned an invalid date");
  }
  return date.toISOString();
}

async function ensurePrivateParent(parentPath) {
  try {
    await mkdir(parentPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const before = await lstat(parentPath);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw lockError(
        "LOCK_PATH_INVALID",
        "lock parent must be a real directory, not a symlink or another file type",
      );
    }
    await chmod(parentPath, PRIVATE_DIRECTORY_MODE);
    const after = await lstat(parentPath);
    if (
      process.platform !== "win32" &&
      fileMode(after) !== PRIVATE_DIRECTORY_MODE
    ) {
      throw lockError(
        "LOCK_PERMISSIONS",
        `lock parent must have mode 0700, found ${fileMode(after).toString(8)}`,
      );
    }
  } catch (error) {
    if (error instanceof OperationLockError) throw error;
    throw lockError(
      "LOCK_PARENT_FAILED",
      `could not prepare private lock parent ${parentPath}`,
      error,
    );
  }
}

async function syncDirectory(parentPath) {
  let handle;
  try {
    handle = await open(parentPath, "r");
    await handle.sync();
  } catch (error) {
    throw lockError(
      "LOCK_DIRECTORY_SYNC_FAILED",
      `could not fsync lock parent ${parentPath}`,
      error,
    );
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readOwnerFile(
  path,
  {
    allowMissing = false,
    malformedCode = "LOCK_MALFORMED",
    permissionsCode = "LOCK_PERMISSIONS",
  } = {},
) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    if (error.code === "ENOENT") {
      throw lockError("LOCK_DISAPPEARED", `lock owner disappeared at ${path}`, error);
    }
    throw lockError("LOCK_READ_FAILED", `could not inspect lock owner ${path}`, error);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw lockError(
      "LOCK_PATH_INVALID",
      `lock owner ${path} must be a regular file`,
    );
  }
  requirePrivateMode(metadata, permissionsCode, "lock owner file");

  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw lockError("LOCK_READ_FAILED", `could not read lock owner ${path}`, error);
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw lockError(malformedCode, `lock owner ${path} is not valid JSON`, error);
  }
  validateOwnerRecord(value, malformedCode);
  return {
    metadata: { dev: metadata.dev, ino: metadata.ino },
    owner: value,
    raw,
  };
}

function sameOwnerSnapshot(left, right) {
  return (
    left.raw === right.raw &&
    left.owner.nonce === right.owner.nonce &&
    left.owner.pid === right.owner.pid &&
    left.owner.startedAt === right.owner.startedAt &&
    left.metadata.dev === right.metadata.dev &&
    left.metadata.ino === right.metadata.ino
  );
}

async function writeSyncedExclusiveFile(path, contents) {
  let handle;
  try {
    handle = await open(path, "wx", PRIVATE_FILE_MODE);
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlinkIfPresent(path).catch(() => {});
    throw lockError(
      "LOCK_STAGING_WRITE_FAILED",
      `could not write private staging file ${path}`,
      error,
    );
  }
}

async function probeOwner(owner, readProcessIdentity) {
  if (typeof readProcessIdentity !== "function") {
    throw lockError(
      "LOCK_PROCESS_PROBE_REQUIRED",
      "readProcessIdentity is required to recover an existing owner",
    );
  }

  let current;
  try {
    current = await readProcessIdentity(owner.pid);
  } catch (error) {
    throw lockError(
      "LOCK_PROCESS_PROBE_FAILED",
      `could not probe lock owner pid ${owner.pid}`,
      error,
    );
  }
  if (current === null || current === undefined) return null;
  const identity = validateIdentity(current, "LOCK_PROCESS_PROBE_INVALID");
  if (identity.pid !== owner.pid) {
    throw lockError(
      "LOCK_PROCESS_PROBE_INVALID",
      `process probe returned pid ${identity.pid} for requested pid ${owner.pid}`,
    );
  }
  return identity;
}

function processStillOwnsRecord(owner, current) {
  return current !== null && current.startedAt === owner.startedAt;
}

async function readStagingCandidate(path) {
  try {
    return await readOwnerFile(path, {
      allowMissing: true,
      malformedCode: "LOCK_STAGING_MALFORMED",
      permissionsCode: "LOCK_STAGING_PERMISSIONS",
    });
  } catch {
    return null;
  }
}

async function cleanupProvenDeadStaging({
  lockPath,
  parentPath,
  readProcessIdentity,
}) {
  const prefix = `${basename(lockPath)}.staging.`;
  let entries;
  try {
    entries = await readdir(parentPath, { withFileTypes: true });
  } catch (error) {
    throw lockError(
      "LOCK_STAGING_SCAN_FAILED",
      `could not scan lock staging files in ${parentPath}`,
      error,
    );
  }

  let changed = false;
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix) || !entry.isFile()) continue;
    const path = join(parentPath, entry.name);
    const initial = await readStagingCandidate(path);
    if (initial === null) continue;

    let current;
    try {
      current = await probeOwner(initial.owner, readProcessIdentity);
    } catch {
      continue;
    }
    if (processStillOwnsRecord(initial.owner, current)) continue;

    const confirmed = await readStagingCandidate(path);
    if (confirmed === null || !sameOwnerSnapshot(initial, confirmed)) continue;
    try {
      changed = (await unlinkIfPresent(path)) || changed;
    } catch (error) {
      throw lockError(
        "LOCK_STAGING_CLEANUP_FAILED",
        `could not remove proven-dead staging file ${path}`,
        error,
      );
    }
  }
  if (changed) await syncDirectory(parentPath);
}

function heartbeatFilePath(lockPath, nonce) {
  return `${lockPath}.heartbeat.${nonce}`;
}

function heartbeatRecord(owner, heartbeat) {
  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    nonce: owner.nonce,
    pid: owner.pid,
    startedAt: owner.startedAt,
    heartbeat,
  };
}

async function confirmLeaseOwner(lockPath, expected) {
  const current = await readOwnerFile(lockPath, { allowMissing: true });
  if (
    current === null ||
    current.owner.nonce !== expected.nonce ||
    current.owner.pid !== expected.pid ||
    current.owner.startedAt !== expected.startedAt
  ) {
    throw lockError(
      "LOCK_NOT_OWNED",
      "published owner no longer matches this lease nonce and process identity",
    );
  }
  return current;
}

async function writeHeartbeat({ lockPath, owner, heartbeat, parentPath }) {
  const heartbeatPath = heartbeatFilePath(lockPath, owner.nonce);
  const temporaryPath = `${lockPath}.heartbeat-tmp.${owner.nonce}.${createNonce()}`;
  let published = false;
  try {
    await writeSyncedExclusiveFile(
      temporaryPath,
      serializeJson(heartbeatRecord(owner, heartbeat)),
    );
    await confirmLeaseOwner(lockPath, owner);
    await rename(temporaryPath, heartbeatPath);
    published = true;
    await syncDirectory(parentPath);
  } catch (error) {
    if (error instanceof OperationLockError) throw error;
    throw lockError(
      "LOCK_HEARTBEAT_FAILED",
      `could not publish heartbeat for ${lockPath}`,
      error,
    );
  } finally {
    if (!published) await unlinkIfPresent(temporaryPath).catch(() => {});
  }
  return heartbeatPath;
}

async function removeOwnedLock({ lockPath, owner, parentPath }) {
  const initial = await readOwnerFile(lockPath, { allowMissing: true });
  if (initial === null) {
    const removedHeartbeat = await unlinkIfPresent(
      heartbeatFilePath(lockPath, owner.nonce),
    ).catch((error) => {
      throw lockError(
        "LOCK_RELEASE_FAILED",
        "could not remove orphaned lease heartbeat",
        error,
      );
    });
    if (removedHeartbeat) await syncDirectory(parentPath);
    return false;
  }
  if (
    initial.owner.nonce !== owner.nonce ||
    initial.owner.pid !== owner.pid ||
    initial.owner.startedAt !== owner.startedAt
  ) {
    const removedHeartbeat = await unlinkIfPresent(
      heartbeatFilePath(lockPath, owner.nonce),
    ).catch((error) => {
      throw lockError(
        "LOCK_RELEASE_FAILED",
        "could not remove superseded lease heartbeat",
        error,
      );
    });
    if (removedHeartbeat) await syncDirectory(parentPath);
    return false;
  }

  const confirmed = await readOwnerFile(lockPath, { allowMissing: true });
  if (confirmed === null || !sameOwnerSnapshot(initial, confirmed)) return false;

  let ownerRemoved = false;
  try {
    ownerRemoved = await unlinkIfPresent(lockPath);
    await unlinkIfPresent(heartbeatFilePath(lockPath, owner.nonce));
    if (ownerRemoved) await syncDirectory(parentPath);
  } catch (error) {
    throw lockError(
      "LOCK_RELEASE_FAILED",
      `could not release operation lock ${lockPath}`,
      error,
    );
  }
  return ownerRemoved;
}

async function inspectExistingOwner({
  lockPath,
  parentPath,
  readProcessIdentity,
}) {
  const initial = await readOwnerFile(lockPath, { allowMissing: true });
  if (initial === null) return "retry";
  const current = await probeOwner(initial.owner, readProcessIdentity);
  if (processStillOwnsRecord(initial.owner, current)) {
    throw lockError(
      "LOCK_HELD",
      `operation ${initial.owner.operation} is held by live pid ${initial.owner.pid}`,
    );
  }

  const confirmed = await readOwnerFile(lockPath, { allowMissing: true });
  if (confirmed === null || !sameOwnerSnapshot(initial, confirmed)) return "retry";

  try {
    const removed = await unlinkIfPresent(lockPath);
    if (!removed) return "retry";
    await unlinkIfPresent(heartbeatFilePath(lockPath, initial.owner.nonce));
    await syncDirectory(parentPath);
  } catch (error) {
    if (error instanceof OperationLockError) throw error;
    throw lockError(
      "LOCK_TAKEOVER_FAILED",
      `could not reclaim dead lock owner at ${lockPath}`,
      error,
    );
  }
  return "retry";
}

function createLease({ lockPath, parentPath, owner, now }) {
  const heartbeatPath = heartbeatFilePath(lockPath, owner.nonce);
  return Object.freeze({
    heartbeatPath,
    lockPath,
    nonce: owner.nonce,
    owner: Object.freeze({ ...owner }),
    async heartbeat() {
      const heartbeat = timestampFrom(now);
      await writeHeartbeat({ lockPath, owner, heartbeat, parentPath });
      return heartbeat;
    },
    async release() {
      return removeOwnedLock({ lockPath, owner, parentPath });
    },
  });
}

export async function acquireOperationLock(options) {
  if (options === null || typeof options !== "object") {
    throw lockError("LOCK_OPTIONS_INVALID", "lock options must be an object");
  }
  const lockPath = validateLockPath(options.lockPath);
  const operation = validateOperation(options.operation);
  const identity = validateIdentity(options.identity);
  const readProcessIdentity = options.readProcessIdentity;
  const now = options.now ?? (() => new Date());
  if (typeof now !== "function") {
    throw lockError("LOCK_CLOCK_FAILED", "now must be a function");
  }
  if (
    options.faultAt !== undefined &&
    options.faultAt !== "before-publish"
  ) {
    throw lockError("LOCK_FAULT_INVALID", "unknown fault injection point");
  }

  const parentPath = dirname(lockPath);
  await ensurePrivateParent(parentPath);
  await cleanupProvenDeadStaging({
    lockPath,
    parentPath,
    readProcessIdentity,
  });

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    const timestamp = timestampFrom(now);
    const owner = {
      schemaVersion: LOCK_SCHEMA_VERSION,
      nonce: createNonce(),
      pid: identity.pid,
      operation,
      startedAt: identity.startedAt,
      createdAt: timestamp,
      heartbeat: timestamp,
    };
    const stagingPath = `${lockPath}.staging.${identity.pid}.${owner.nonce}`;
    let keepStaging = false;

    await writeSyncedExclusiveFile(stagingPath, serializeJson(owner));
    try {
      if (options.faultAt === "before-publish") {
        keepStaging = true;
        throw lockError(
          "FAULT_BEFORE_PUBLISH",
          "injected crash before atomic hard-link publication",
        );
      }

      try {
        await link(stagingPath, lockPath);
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw lockError(
            "LOCK_PUBLISH_FAILED",
            `could not atomically publish ${lockPath} with a same-filesystem hard link`,
            error,
          );
        }
        await unlinkIfPresent(stagingPath);
        await syncDirectory(parentPath);
        await inspectExistingOwner({
          lockPath,
          parentPath,
          readProcessIdentity,
        });
        continue;
      }

      await unlinkIfPresent(stagingPath);
      await syncDirectory(parentPath);
      const lease = createLease({ lockPath, parentPath, owner, now });
      try {
        await writeHeartbeat({
          lockPath,
          owner,
          heartbeat: owner.heartbeat,
          parentPath,
        });
      } catch (error) {
        await lease.release().catch(() => {});
        throw error;
      }
      return lease;
    } finally {
      if (!keepStaging) await unlinkIfPresent(stagingPath).catch(() => {});
    }
  }

  throw lockError(
    "LOCK_CONTENTION_LIMIT",
    `operation lock owner changed more than ${MAX_ACQUIRE_ATTEMPTS} times`,
  );
}

export async function withOperationLock(options, action) {
  if (typeof action !== "function") {
    throw lockError("LOCK_ACTION_INVALID", "protected action must be a function");
  }
  const lock = await acquireOperationLock(options);
  try {
    return await action(lock);
  } finally {
    await lock.release();
  }
}
