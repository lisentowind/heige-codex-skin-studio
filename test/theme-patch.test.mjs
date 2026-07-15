import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchedHtml } from "../src/theme-patch.mjs";

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
  const theme = "/* CODEX_MIKU_THEME */\n:root{--miku-cyan:#18c7d4}";
  const once = buildPatchedHtml(original, theme);
  const twice = buildPatchedHtml(once, theme);
  assert.equal(twice, once);
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
