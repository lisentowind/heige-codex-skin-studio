import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  acquireOperationLock,
  withOperationLock,
} from "../src/operation-lock.mjs";

const CREATED_AT = "2026-07-17T01:00:00.000Z";
const OWNER = {
  pid: 31_001,
  startedAt: "2026-07-17T00:00:00.000Z",
};
const CONTENDER = {
  pid: 31_002,
  startedAt: "2026-07-17T00:01:00.000Z",
};

function ownerRecord({
  identity = OWNER,
  nonce = "owner-nonce",
  operation = "apply",
  heartbeat = CREATED_AT,
} = {}) {
  return {
    schemaVersion: 1,
    nonce,
    pid: identity.pid,
    operation,
    startedAt: identity.startedAt,
    createdAt: CREATED_AT,
    heartbeat,
  };
}

function heartbeatPath(lockPath, nonce) {
  return `${lockPath}.heartbeat.${nonce}`;
}

function stagingPath(lockPath, nonce) {
  return `${lockPath}.staging.${nonce}`;
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function seedLock(lockPath, record = ownerRecord()) {
  await mkdir(join(lockPath, ".."), { recursive: true, mode: 0o700 });
  await writePrivateJson(lockPath, record);
  await writePrivateJson(heartbeatPath(lockPath, record.nonce), {
    schemaVersion: 1,
    nonce: record.nonce,
    pid: record.pid,
    startedAt: record.startedAt,
    heartbeat: record.heartbeat,
  });
  return record;
}

async function exists(path) {
  return stat(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "heige-operation-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    lockPath: join(root, "runtime", "operation.lock"),
  };
}

function acquisitionOptions(lockPath, overrides = {}) {
  return {
    lockPath,
    operation: "restore",
    identity: CONTENDER,
    readProcessIdentity: async () => null,
    now: () => new Date("2026-07-17T01:02:03.000Z"),
    ...overrides,
  };
}

test("a live owner is never stolen even with a stale heartbeat", async (t) => {
  const { lockPath } = await fixture(t);
  const stale = ownerRecord({ heartbeat: "2000-01-01T00:00:00.000Z" });
  await seedLock(lockPath, stale);

  await assert.rejects(
    acquireOperationLock(
      acquisitionOptions(lockPath, {
        readProcessIdentity: async (pid) => (pid === OWNER.pid ? OWNER : null),
      }),
    ),
    (error) => error.code === "LOCK_HELD",
  );

  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), stale);
});

test("the protected action never runs when lock acquisition fails", async (t) => {
  const { lockPath } = await fixture(t);
  await seedLock(lockPath);
  let protectedActionRan = false;

  await assert.rejects(
    withOperationLock(
      acquisitionOptions(lockPath, {
        readProcessIdentity: async () => OWNER,
      }),
      async () => {
        protectedActionRan = true;
      },
    ),
    (error) => error.code === "LOCK_HELD",
  );

  assert.equal(protectedActionRan, false);
});

test("withOperationLock releases the lease when the protected action throws", async (t) => {
  const { lockPath } = await fixture(t);
  const failure = new Error("protected action failed");

  await assert.rejects(
    withOperationLock(acquisitionOptions(lockPath), async (lease) => {
      assert.equal(await exists(lockPath), true);
      assert.equal(typeof lease.nonce, "string");
      throw failure;
    }),
    (error) => error === failure,
  );

  assert.equal(await exists(lockPath), false);
});

test("a crash before atomic publication leaves no blocking empty lock", async (t) => {
  const { lockPath } = await fixture(t);

  await assert.rejects(
    acquireOperationLock(
      acquisitionOptions(lockPath, { faultAt: "before-publish" }),
    ),
    (error) => error.code === "FAULT_BEFORE_PUBLISH",
  );
  assert.equal(await exists(lockPath), false);

  const leftover = (await readdir(join(lockPath, ".."))).find((entry) =>
    entry.startsWith(`${basename(lockPath)}.staging.`),
  );
  assert.ok(leftover, "the injected crash should leave only an inert staging file");
  const leftoverPath = join(lockPath, "..", leftover);
  assert.ok(JSON.parse(await readFile(leftoverPath, "utf8")).nonce);
  assert.equal((await stat(leftoverPath)).mode & 0o777, 0o600);

  const lease = await acquireOperationLock(acquisitionOptions(lockPath));
  t.after(() => lease.release());
  const published = JSON.parse(await readFile(lockPath, "utf8"));

  assert.deepEqual(Object.keys(published).sort(), [
    "createdAt",
    "heartbeat",
    "nonce",
    "operation",
    "pid",
    "schemaVersion",
    "startedAt",
  ]);
  assert.equal(typeof published.nonce, "string");
  assert.ok(published.nonce.length >= 16);
  assert.equal((await stat(lockPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(lockPath, ".."))).mode & 0o777, 0o700);
});

test("PID reuse permits takeover only after the start time differs", async (t) => {
  const { lockPath } = await fixture(t);
  const old = await seedLock(lockPath);
  const reused = { pid: old.pid, startedAt: "2026-07-17T01:01:01.000Z" };

  const lease = await acquireOperationLock(
    acquisitionOptions(lockPath, {
      readProcessIdentity: async (pid) => (pid === old.pid ? reused : null),
    }),
  );
  t.after(() => lease.release());

  const current = JSON.parse(await readFile(lockPath, "utf8"));
  assert.notEqual(current.nonce, old.nonce);
  assert.equal(current.pid, CONTENDER.pid);
  assert.equal(await exists(heartbeatPath(lockPath, old.nonce)), false);
});

test("a proven dead owner can be taken over", async (t) => {
  const { lockPath } = await fixture(t);
  const dead = await seedLock(lockPath);

  const lease = await acquireOperationLock(acquisitionOptions(lockPath));
  t.after(() => lease.release());

  assert.notEqual(
    JSON.parse(await readFile(lockPath, "utf8")).nonce,
    dead.nonce,
  );
});

test("a malformed published owner fails closed and is never deleted", async (t) => {
  const { lockPath } = await fixture(t);
  await mkdir(join(lockPath, ".."), { recursive: true, mode: 0o700 });
  await writeFile(lockPath, "{bad", { mode: 0o600 });

  await assert.rejects(
    acquireOperationLock(acquisitionOptions(lockPath)),
    (error) => error.code === "LOCK_MALFORMED",
  );
  assert.equal(await readFile(lockPath, "utf8"), "{bad");
});

test("a well-formed owner with a blank process start identity fails closed", async (t) => {
  const { lockPath } = await fixture(t);
  const malformed = ownerRecord();
  malformed.startedAt = "   ";
  await seedLock(lockPath, malformed);

  await assert.rejects(
    acquireOperationLock(acquisitionOptions(lockPath)),
    (error) => error.code === "LOCK_MALFORMED",
  );
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), malformed);
});

test("a published owner with unsafe permissions fails closed", async (t) => {
  const { lockPath } = await fixture(t);
  await seedLock(lockPath);
  await chmod(lockPath, 0o644);

  await assert.rejects(
    acquireOperationLock(acquisitionOptions(lockPath)),
    (error) => error.code === "LOCK_PERMISSIONS",
  );
  assert.equal(await exists(lockPath), true);
});

test("heartbeats atomically update a nonce-bound sibling without rewriting owner", async (t) => {
  const { lockPath } = await fixture(t);
  const times = [
    new Date("2026-07-17T01:02:03.000Z"),
    new Date("2026-07-17T01:03:04.000Z"),
  ];
  const lease = await acquireOperationLock(
    acquisitionOptions(lockPath, { now: () => times.shift() }),
  );
  t.after(() => lease.release());
  const immutableOwner = await readFile(lockPath, "utf8");

  await lease.heartbeat();

  assert.equal(await readFile(lockPath, "utf8"), immutableOwner);
  const heartbeat = JSON.parse(await readFile(lease.heartbeatPath, "utf8"));
  assert.equal(heartbeat.nonce, lease.nonce);
  assert.equal(heartbeat.pid, CONTENDER.pid);
  assert.equal(heartbeat.startedAt, CONTENDER.startedAt);
  assert.equal(heartbeat.heartbeat, "2026-07-17T01:03:04.000Z");
  assert.equal((await stat(lease.heartbeatPath)).mode & 0o777, 0o600);
  assert.equal(
    (await readdir(join(lockPath, ".."))).some((entry) => entry.includes("heartbeat-tmp")),
    false,
  );
});

test("release is idempotent", async (t) => {
  const { lockPath } = await fixture(t);
  const lease = await acquireOperationLock(acquisitionOptions(lockPath));

  await lease.release();
  await lease.release();

  assert.equal(await exists(lockPath), false);
  assert.equal(await exists(lease.heartbeatPath), false);
});

test("release never removes a replacement owner with a different nonce", async (t) => {
  const { lockPath } = await fixture(t);
  const oldLease = await acquireOperationLock(acquisitionOptions(lockPath));
  await unlink(lockPath);
  const replacement = ownerRecord({
    identity: OWNER,
    nonce: "replacement-nonce",
    operation: "apply",
  });
  await seedLock(lockPath, replacement);

  await oldLease.release();

  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), replacement);
  assert.equal(await exists(heartbeatPath(lockPath, replacement.nonce)), true);
});

test("concurrent acquisition has exactly one winner", async (t) => {
  const { lockPath } = await fixture(t);
  const first = { pid: 41_001, startedAt: "2026-07-17T02:00:00.000Z" };
  const second = { pid: 41_002, startedAt: "2026-07-17T02:00:01.000Z" };
  const processes = new Map([
    [first.pid, first],
    [second.pid, second],
  ]);
  const readProcessIdentity = async (pid) => processes.get(pid) ?? null;

  const results = await Promise.allSettled([
    acquireOperationLock(
      acquisitionOptions(lockPath, { identity: first, readProcessIdentity }),
    ),
    acquireOperationLock(
      acquisitionOptions(lockPath, { identity: second, readProcessIdentity }),
    ),
  ]);

  const winners = results.filter(({ status }) => status === "fulfilled");
  const losers = results.filter(({ status }) => status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "LOCK_HELD");
  await winners[0].value.release();
});

test("startup cleans only staging files whose exact process identity is gone", async (t) => {
  const { lockPath } = await fixture(t);
  await mkdir(join(lockPath, ".."), { recursive: true, mode: 0o700 });
  const live = { pid: 51_001, startedAt: "2026-07-17T03:00:00.000Z" };
  const reused = { pid: 51_002, startedAt: "2026-07-17T03:00:01.000Z" };
  const dead = { pid: 51_003, startedAt: "2026-07-17T03:00:02.000Z" };
  const livePath = stagingPath(lockPath, "live");
  const reusedPath = stagingPath(lockPath, "reused");
  const deadPath = stagingPath(lockPath, "dead");
  const malformedPath = stagingPath(lockPath, "malformed");
  await writePrivateJson(livePath, ownerRecord({ identity: live, nonce: "live" }));
  await writePrivateJson(reusedPath, ownerRecord({ identity: reused, nonce: "reused" }));
  await writePrivateJson(deadPath, ownerRecord({ identity: dead, nonce: "dead" }));
  await writeFile(malformedPath, "{bad", { mode: 0o600 });

  const lease = await acquireOperationLock(
    acquisitionOptions(lockPath, {
      readProcessIdentity: async (pid) => {
        if (pid === live.pid) return live;
        if (pid === reused.pid) {
          return { ...reused, startedAt: "2026-07-17T03:09:09.000Z" };
        }
        return null;
      },
    }),
  );
  t.after(() => lease.release());

  assert.equal(await exists(livePath), true, "live staging ownership must be preserved");
  assert.equal(await exists(reusedPath), false, "PID-reused staging may be removed");
  assert.equal(await exists(deadPath), false, "dead staging may be removed");
  assert.equal(await exists(malformedPath), true, "unprovable staging must be preserved");
});

test("takeover rechecks the owner nonce before unlinking", async (t) => {
  const { lockPath } = await fixture(t);
  const old = await seedLock(lockPath);
  const replacementIdentity = {
    pid: 61_001,
    startedAt: "2026-07-17T04:00:00.000Z",
  };
  const replacement = ownerRecord({
    identity: replacementIdentity,
    nonce: "new-owner-nonce",
  });
  let replaced = false;

  await assert.rejects(
    acquireOperationLock(
      acquisitionOptions(lockPath, {
        readProcessIdentity: async (pid) => {
          if (pid === old.pid && !replaced) {
            replaced = true;
            await unlink(lockPath);
            await seedLock(lockPath, replacement);
            return null;
          }
          if (pid === replacementIdentity.pid) return replacementIdentity;
          return null;
        },
      }),
    ),
    (error) => error.code === "LOCK_HELD",
  );

  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), replacement);
});

test("relative lock paths are rejected before touching the filesystem", async () => {
  await assert.rejects(
    acquireOperationLock(acquisitionOptions("relative/operation.lock")),
    (error) => error.code === "LOCK_PATH_INVALID",
  );
});
