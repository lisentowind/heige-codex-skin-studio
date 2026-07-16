import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { DEFAULT_THEME_ID } from "../src/constants.mjs";
import { acquireOperationLock } from "../src/operation-lock.mjs";
import {
  finalizeInstallStateParticipant,
  prepareInstallStateParticipant,
  publishInstallStateParticipant,
  readStudioState,
  rollbackInstallStateParticipant,
  validateInstallStateParticipant,
} from "../src/state-store.mjs";

const TRANSACTION_ID = "123e4567-e89b-42d3-a456-426614174000";

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "heige-install-state-")));
  const stateRoot = join(root, "state");
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const identity = { pid: process.pid, startedAt: "2026-07-17T08:00:00.000Z" };
  const lease = await acquireOperationLock({
    lockPath: join(stateRoot, "operation.lock"),
    stateRoot,
    operation: "install-state-test",
    identity,
    readProcessIdentity: async (pid) => (pid === identity.pid ? identity : null),
  });
  t.after(() => lease.release());
  return {
    lease,
    root,
    statePath: join(stateRoot, "state.json"),
    legacyThemePath: join(root, "legacy-theme"),
  };
}

test("install state prepare is non-mutating and publish can be rolled back exactly", async (t) => {
  const { lease, statePath, legacyThemePath } = await fixture(t);
  const participant = await prepareInstallStateParticipant({
    transactionId: TRANSACTION_ID,
    statePath,
    lease,
    legacyThemePath,
    legacyAgentLoaded: false,
    themeExists: async (themeId) => themeId === DEFAULT_THEME_ID,
    randomBytes: () => Buffer.alloc(32, 9),
  });

  assert.equal(await readStudioState(statePath), null);
  assert.equal(participant.afterState.persistenceEnabled, false);
  assert.equal(participant.afterState.revision, 0);

  await publishInstallStateParticipant(participant, { lease });
  assert.deepEqual(await readStudioState(statePath), participant.afterState);
  await finalizeInstallStateParticipant(participant, { lease });
  await rollbackInstallStateParticipant(participant, { lease });
  assert.equal(await readStudioState(statePath), null);
});

test("install state participant preserves an already authoritative state", async (t) => {
  const { lease, statePath } = await fixture(t);
  const first = await prepareInstallStateParticipant({
    transactionId: TRANSACTION_ID,
    statePath,
    lease,
    legacyAgentLoaded: false,
    themeExists: async () => true,
    randomBytes: () => Buffer.alloc(32, 4),
  });
  await publishInstallStateParticipant(first, { lease });

  const second = await prepareInstallStateParticipant({
    transactionId: "223e4567-e89b-42d3-a456-426614174000",
    statePath,
    lease,
    legacyAgentLoaded: true,
    themeExists: async () => false,
    randomBytes: () => {
      throw new Error("existing state must not generate entropy");
    },
  });
  assert.deepEqual(second.beforeState, first.afterState);
  assert.deepEqual(second.afterState, first.afterState);
  await publishInstallStateParticipant(second, { lease });
  await rollbackInstallStateParticipant(second, { lease });
  assert.deepEqual(await readStudioState(statePath), first.afterState);
});

test("loaded legacy watchdog is prepared as persistent without early publication", async (t) => {
  const { lease, statePath, legacyThemePath } = await fixture(t);
  await writeFile(legacyThemePath, "miku-488137\n", { mode: 0o600 });
  const participant = await prepareInstallStateParticipant({
    transactionId: TRANSACTION_ID,
    statePath,
    lease,
    legacyThemePath,
    legacyAgentLoaded: true,
    themeExists: async (themeId) => themeId === "miku-488137",
    randomBytes: () => Buffer.alloc(32, 7),
  });
  assert.equal(await readStudioState(statePath), null);
  assert.equal(participant.afterState.selectedThemeId, "miku-488137");
  assert.equal(participant.afterState.persistenceEnabled, true);
  assert.equal(participant.afterState.revision, 1);
});

test("install state descriptor rejects unknown fields and path rebinding", async (t) => {
  const { lease, statePath } = await fixture(t);
  const participant = await prepareInstallStateParticipant({
    transactionId: TRANSACTION_ID,
    statePath,
    lease,
    legacyAgentLoaded: false,
    themeExists: async () => true,
    randomBytes: () => Buffer.alloc(32, 8),
  });
  assert.throws(
    () => validateInstallStateParticipant({ ...participant, extra: true }),
    /schema/,
  );
  assert.throws(
    () => validateInstallStateParticipant({ ...participant, statePath: join(dirname(statePath), "other.json") }),
    /statePath/,
  );
});
