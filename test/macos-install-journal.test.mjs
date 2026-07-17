import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createMacosInstallJournal,
  macosInstallJournalPath,
  updateMacosInstallJournal,
} from "../src/macos-install-journal.mjs";
import { withOperationLock } from "../src/operation-lock.mjs";

test("a durable rollback decision still permits rollback phase progress", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "heige-macos-journal-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, "home");
  const stateRoot = join(
    home,
    "Library",
    "Application Support",
    "HeiGeCodexSkinStudio",
  );
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  await chmod(stateRoot, 0o700);
  const identity = { pid: process.pid, startedAt: "journal-test-process" };
  const journalPath = macosInstallJournalPath(stateRoot);

  await withOperationLock({
    identity,
    lockPath: join(stateRoot, "operation.lock"),
    operation: "install:test-rollback-progress",
    readProcessIdentity: async (pid) => pid === identity.pid ? { ...identity } : null,
    stateRoot,
  }, async (lease) => {
    let journal = await createMacosInstallJournal({
      home,
      journalPath,
      lease,
      sourceRoot: base,
      stateRoot,
      targetRoot: join(home, ".codex", "heige-codex-skin-studio"),
      transactionId: "123e4567-e89b-42d3-a456-426614174000",
    });
    journal = await updateMacosInstallJournal(journalPath, journal, {
      decision: "rollback",
      phase: "rollback-decided",
    }, { lease });

    await assert.rejects(
      updateMacosInstallJournal(journalPath, journal, {
        decision: "commit",
        phase: "commit-decided",
      }, { lease }),
      /decision is already durable/,
    );

    const progressed = await updateMacosInstallJournal(journalPath, journal, {
      phase: "freeze-rollback-restored",
    }, { lease });

    assert.equal(progressed.decision, "rollback");
    assert.equal(progressed.phase, "freeze-rollback-restored");
    assert.equal(progressed.revision, journal.revision + 1);
  });
});
