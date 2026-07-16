import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const installerPath = fileURLToPath(new URL("../scripts/windows/install.ps1", import.meta.url));

test("Windows payload installer binds the Skill wrapper parameters instead of ignoring them", async () => {
  const installer = await readFile(installerPath, "utf8");

  assert.match(installer, /^\uFEFF?\[CmdletBinding\(PositionalBinding\s*=\s*\$false\)\]/);
  assert.match(installer, /\[string\]\$InstallRoot/);
  assert.match(installer, /\[string\]\$StartMenuRoot/);
  assert.match(installer, /\[switch\]\$SkipApply/);
  assert.match(installer, /\$PSBoundParameters\.ContainsKey\("InstallRoot"\)/);
  assert.match(installer, /\$PSBoundParameters\.ContainsKey\("StartMenuRoot"\)/);
  assert.match(installer, /\$SkipApply\.IsPresent/);
});

test("Windows payload installer delegates shortcut publication through the transaction participant", async () => {
  const installer = await readFile(installerPath, "utf8");

  assert.match(installer, /Prepare-HeiGeStartMenuShortcut/);
  assert.match(installer, /Publish-HeiGeStartMenuShortcut/);
  assert.match(installer, /Rollback-HeiGeStartMenuShortcut/);
  assert.match(installer, /Finalize-HeiGeStartMenuShortcut/);
});

test("Windows artifact journal precedes every stage and owns the only commit decision", async () => {
  const installer = await readFile(installerPath, "utf8");
  const skeleton = installer.indexOf("Write-HeiGeInstallJournal -Path $journalPath -Document $journal -Exclusive");
  const treePrepare = installer.indexOf('"participant-prepare"');
  const menuPrepare = installer.indexOf("Prepare-HeiGeStartMenuShortcut", treePrepare);
  const apply = installer.indexOf('& (Join-Path $target "scripts\\windows\\apply.ps1")');
  const commit = installer.indexOf('-Phase "commit-decided" -Decision "commit"');

  assert.ok(skeleton >= 0 && skeleton < treePrepare);
  assert.ok(treePrepare < menuPrepare);
  assert.ok(menuPrepare < apply && apply < commit);
  assert.equal(installer.match(/-Decision\s+"commit"/g)?.length, 1);
  assert.match(installer, /FileOptions\]::WriteThrough/);
  assert.match(installer, /\.Flush\(\$true\)/);
  assert.match(installer, /\[System\.IO\.File\]::Replace/);
});

test("Windows recovery is reverse before commit and roll-forward after commit", async () => {
  const installer = await readFile(installerPath, "utf8");

  assert.match(
    installer,
    /function Undo-HeiGeWindowsInstall[\s\S]*Rollback-HeiGeStartMenuShortcut[\s\S]*-Action rollback/,
  );
  assert.match(
    installer,
    /if \(\[string\]\$journal\.Decision -eq "commit"\)[\s\S]*Complete-HeiGeWindowsInstall[\s\S]*else \{[\s\S]*Undo-HeiGeWindowsInstall/,
  );
  assert.match(installer, /if \(-not \$skipRequested\)[\s\S]*scripts\\windows\\apply\.ps1/);
  assert.doesNotMatch(installer, /::new\(|\?\?|\?\./);
});
