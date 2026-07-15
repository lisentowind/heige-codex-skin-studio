import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const themePath = new URL("../src/theme.css", import.meta.url);

test("defines the Miku palette and Codex surface tokens", async () => {
  const css = await readFile(themePath, "utf8");

  assert.match(css, /CODEX_MIKU_THEME v2 MAXIMAL/);

  for (const token of [
    "--miku-cyan",
    "--miku-pink",
    "--miku-ice",
    "--color-background-surface",
    "--color-background-surface-under",
    "--color-text-foreground",
    "--vscode-editor-background",
    "--vscode-sideBar-background",
  ]) {
    assert.match(css, new RegExp(token.replaceAll("-", "\\-")));
  }
});

test("styles stable Codex shell, composer, and interaction surfaces", async () => {
  const css = await readFile(themePath, "utf8");

  for (const selector of [
    ".app-shell-left-panel",
    ".main-surface",
    "textarea",
    "button",
    "pre",
    "::-webkit-scrollbar-thumb",
  ]) {
    assert.ok(css.includes(selector), `missing selector: ${selector}`);
  }
});

test("uses the supplied Miku artwork and maximal decorative layers", async () => {
  const css = await readFile(themePath, "utf8");

  assert.match(css, /dialog-artwork-connected-NZKCls7p\.png/);
  assert.match(css, /body::after/);
  assert.match(css, /#root::before/);
  assert.match(css, /[✦♡♪☆]/u);
  assert.match(css, /saturate\(/);
  assert.match(css, /drop-shadow\(/);
});

test("does not load remote assets or force motion", async () => {
  const css = await readFile(themePath, "utf8");
  assert.doesNotMatch(css, /https?:\/\//i);
  assert.doesNotMatch(css, /@keyframes|animation\s*:/i);
});
