import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureMacosStateRoot } from "../src/macos-state-root.mjs";

async function fixture(t) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "heige-state-root-")));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return {
    parent: temporary,
    stateRoot: join(temporary, "HeiGeCodexSkinStudio"),
  };
}

test("first macOS install creates one private trusted state root", async (t) => {
  const { stateRoot } = await fixture(t);

  const result = await ensureMacosStateRoot(stateRoot);

  assert.deepEqual(result, { created: true, permissionsTightened: false });
  assert.equal((await lstat(stateRoot)).mode & 0o777, 0o700);
});

test("an owned real state root has broad permissions safely tightened", async (t) => {
  const { stateRoot } = await fixture(t);
  await mkdir(stateRoot, { mode: 0o755 });
  await chmod(stateRoot, 0o755);

  const result = await ensureMacosStateRoot(stateRoot);

  assert.deepEqual(result, { created: false, permissionsTightened: true });
  assert.equal((await lstat(stateRoot)).mode & 0o777, 0o700);
});

test("a symlink state root is rejected without changing its target", async (t) => {
  const { parent, stateRoot } = await fixture(t);
  const target = join(parent, "target");
  await mkdir(target, { mode: 0o755 });
  await symlink(target, stateRoot);

  await assert.rejects(ensureMacosStateRoot(stateRoot), /符号链接/);
  assert.equal((await lstat(target)).mode & 0o777, 0o755);
});

test("a state root not owned by the effective user is never chmodded", async (t) => {
  const { stateRoot } = await fixture(t);
  await mkdir(stateRoot, { mode: 0o755 });
  await chmod(stateRoot, 0o755);

  await assert.rejects(
    ensureMacosStateRoot(stateRoot, { getuid: () => process.getuid() + 1 }),
    /不属于当前用户/,
  );
  assert.equal((await lstat(stateRoot)).mode & 0o777, 0o755);
});
