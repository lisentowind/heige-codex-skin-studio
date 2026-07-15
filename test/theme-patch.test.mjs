import assert from "node:assert/strict";
import test from "node:test";

import { buildPaddedAsset, buildPatchedHtml } from "../src/theme-patch.mjs";

const original = `<!doctype html><head><style>
  .startup-loader { display: flex; }
  ${"x".repeat(200)}
</style></head><body></body>`;

test("replaces the first inline style and preserves byte length", () => {
  const patched = buildPatchedHtml(original, "/* CODEX_MIKU_THEME */\n:root{--miku-cyan:#18c7d4}");
  assert.equal(Buffer.byteLength(patched), Buffer.byteLength(original));
  assert.match(patched, /CODEX_MIKU_THEME/);
  assert.doesNotMatch(patched, /startup-loader \{ display/);
});

test("is idempotent when the theme is already installed", () => {
  const theme = "/* CODEX_MIKU_THEME v2 MAXIMAL */\n:root{--miku-cyan:#18c7d4}";
  const once = buildPatchedHtml(original, theme);
  const twice = buildPatchedHtml(once, theme);
  assert.equal(twice, once);
});

test("upgrades an older installed theme in place", () => {
  const oldTheme = "/* CODEX_MIKU_THEME v1 */\n:root{--miku-cyan:#18c7d4}";
  const newTheme = "/* CODEX_MIKU_THEME v2 MAXIMAL */\n:root{--miku-pink:#f58bd8}";
  const oldInstalled = buildPatchedHtml(original, oldTheme);
  const upgraded = buildPatchedHtml(oldInstalled, newTheme);

  assert.equal(Buffer.byteLength(upgraded), Buffer.byteLength(original));
  assert.match(upgraded, /CODEX_MIKU_THEME v2 MAXIMAL/);
  assert.doesNotMatch(upgraded, /CODEX_MIKU_THEME v1/);
});

test("rejects a theme larger than the inline style capacity", () => {
  assert.throws(
    () => buildPatchedHtml(original, "y".repeat(500)),
    /exceeds inline style capacity/,
  );
});

test("rejects HTML without the expected inline style", () => {
  assert.throws(
    () => buildPatchedHtml("<html></html>", "/* CODEX_MIKU_THEME */"),
    /inline style block not found/,
  );
});

test("pads the supplied artwork to the existing ASAR slot size", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const padded = buildPaddedAsset(png, 12);

  assert.equal(padded.length, 12);
  assert.deepEqual(padded.subarray(0, png.length), png);
});

test("rejects artwork larger than the existing ASAR slot", () => {
  assert.throws(() => buildPaddedAsset(Buffer.alloc(13), 12), /exceeds asset slot/);
});
