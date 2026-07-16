import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function source(relativePath) {
  return readFile(join(repositoryRoot, relativePath), "utf8");
}

function functionBody(text, name, nextName) {
  const start = text.indexOf(`function ${name}`);
  const end = text.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source boundaries must exist`);
  return text.slice(start, end);
}

test("Windows Start Menu launcher is session-only apply while enable remains explicit", async () => {
  const [startMenu, installer, applyWrapper, enableWrapper, entrypoints] = await Promise.all([
    source("scripts/windows/lib/start-menu.ps1"),
    source("scripts/windows/install.ps1"),
    source("scripts/windows/apply.ps1"),
    source("scripts/windows/enable-skin.ps1"),
    source("scripts/windows/lib/entrypoints.ps1"),
  ]);
  const prepare = functionBody(
    startMenu,
    "Prepare-HeiGeStartMenuShortcut",
    "Publish-HeiGeStartMenuShortcut",
  );
  const applyFlow = functionBody(
    entrypoints,
    "Invoke-HeiGeApplyFlow",
    "Invoke-HeiGeEnableSkinFlow",
  );

  assert.match(prepare, /scripts\\windows\\apply\.bat/);
  assert.doesNotMatch(prepare, /\$target\s*=.*enable-skin\.bat/);
  assert.match(installer, /\$targetPath\s*=\s*Join-Path\s+\$InstallRoot\s+"scripts\\windows\\apply\.bat"/);
  assert.doesNotMatch(applyWrapper, /\$Theme\s*=\s*"miku-488137"/);
  assert.match(applyWrapper, /PSBoundParameters\.ContainsKey\("Theme"\)/);
  assert.match(entrypoints, /"--prefer-stored"/);
  assert.doesNotMatch(applyFlow, /set-persistence|Invoke-HeiGeEnableSkinFlow/);
  assert.match(enableWrapper, /Invoke-HeiGeEnableSkinFlow/);
});

test("Windows Start Menu migration trusts only the exact owned legacy launcher", async () => {
  const startMenu = await source("scripts/windows/lib/start-menu.ps1");
  const owned = functionBody(
    startMenu,
    "Get-HeiGeOwnedStartMenuShortcutObservation",
    "Get-HeiGeStartMenuTransactionPaths",
  );
  assert.match(owned, /apply\.bat/);
  assert.match(owned, /enable-skin\.bat/);
  assert.match(owned, /Get-HeiGeShortcutObservation/g);
  assert.doesNotMatch(owned, /wildcard|like|regex/i);
});
