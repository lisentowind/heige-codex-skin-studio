import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const assetPath = new URL("../assets/miku-reference.png", import.meta.url);

test("keeps the supplied Miku artwork within the target ASAR slot", async () => {
  const info = await stat(assetPath);
  assert.ok(info.size > 300_000, "artwork was compressed too aggressively");
  assert.ok(info.size <= 902_530, `artwork is too large: ${info.size}`);
});

test("keeps a valid PNG signature", async () => {
  const bytes = await readFile(assetPath);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
});
