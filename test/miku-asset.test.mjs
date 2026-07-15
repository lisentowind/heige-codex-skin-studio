import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { PET_ASSETS, THEME_ASSETS } from "../src/theme-patch.mjs";

const expectedAssets = [
  ["hero", "miku-full-canvas.png", 1240, 889],
  ["character", "miku-character.png", 608, 375],
  ["sidebar", "miku-sidebar-wash.png", 98, 644],
  ["polaroid", "miku-polaroid.png", 228, 230],
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("maps four deterministic crops to distinct low-frequency PNG slots", () => {
  assert.equal(THEME_ASSETS.length, expectedAssets.length);
  assert.deepEqual(
    THEME_ASSETS.map(({ role, sourceName }) => [role, sourceName]),
    expectedAssets.map(([role, sourceName]) => [role, sourceName]),
  );
  assert.equal(new Set(THEME_ASSETS.map(({ entryPath }) => entryPath)).size, THEME_ASSETS.length);
});

test("keeps every crop valid, non-empty, and at its specified geometry", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../assets/miku-crops.json", import.meta.url), "utf8"),
  );
  const source = await readFile(new URL(`../assets/${manifest.source.file}`, import.meta.url));
  assert.equal(sha256(source), manifest.source.sha256);

  for (const [role, sourceName, width, height] of expectedAssets) {
    const assetPath = new URL(`../assets/${sourceName}`, import.meta.url);
    const [bytes, info] = await Promise.all([readFile(assetPath), stat(assetPath)]);
    assert.ok(info.size > 4_000, `${role} crop is unexpectedly empty`);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
    assert.equal(bytes.readUInt32BE(16), width, `${role} crop width drifted`);
    assert.equal(bytes.readUInt32BE(20), height, `${role} crop height drifted`);
    const crop = manifest.crops.find((candidate) => candidate.role === role);
    assert.equal(crop.file, sourceName);
    assert.equal(crop.width, width);
    assert.equal(crop.height, height);
    assert.equal(sha256(bytes), crop.sha256, `${role} crop hash drifted`);
  }
});

test("maps a matching animated pet spritesheet into the native Codex pet slot", async () => {
  assert.deepEqual(PET_ASSETS, [
    {
      role: "pet",
      sourceName: "miku-pet-spritesheet.webp",
      entryPath: "webview/assets/codex-spritesheet-v6-BRBFriCM.webp",
    },
  ]);

  const bytes = await readFile(new URL("../assets/miku-pet-spritesheet.webp", import.meta.url));
  assert.ok(bytes.length > 100_000, "pet spritesheet is unexpectedly empty");
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.subarray(8, 16).toString(), "WEBPVP8X");
  const readUInt24LE = (offset) =>
    bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  assert.equal(readUInt24LE(24) + 1, 1536, "pet spritesheet width drifted");
  assert.equal(readUInt24LE(27) + 1, 2288, "pet spritesheet height drifted");
});
