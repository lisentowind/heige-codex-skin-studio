# Windows Runtime, Persistence, and Entrypoint Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Windows files from best-effort wrappers into a tested current-user implementation of deterministic app discovery, Node runtime selection, controller persistence, re-enable, pause, resume, and full restore.

**Architecture:** PowerShell owns Windows discovery, activation, Scheduled Task registration, and Start Menu integration. It passes structured, validated values to the same Node controller and CLI used on macOS. Tests run without Pester in Windows PowerShell 5.1 and PowerShell 7, with a single isolated Scheduled Task integration case.

**Tech Stack:** Windows PowerShell 5.1, PowerShell 7, Node.js 22, Task Scheduler, WScript.Shell shortcuts, MSIX activation API, GitHub Actions Windows runner.

**Prerequisite:** Complete and verify Plans 1 and 2. This plan may run in parallel with Plan 3 only after controller and CLI contracts are frozen.

---

## File map

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/lib/common.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/lib/scheduled-task.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/lib/start-menu.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/controller.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/enable-skin.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/enable-skin.bat`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/resume.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/resume.bat`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/restore.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/restore.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/install.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/install.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/apply.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/apply.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/customize.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/customize.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/pause.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/pause.bat`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/scripts/install.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/scripts/install.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/SKILL.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/README.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/TestHelpers.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/resolver.test.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/scheduled-task.test.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/entrypoints.test.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/run-tests.ps1`

## Task 1: Make Windows app and Node resolution deterministic

**Files:**

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/lib/common.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/TestHelpers.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/resolver.test.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/run-tests.ps1`

- [ ] **Step 1: Write failing pure resolver tests**

```powershell
Test-Case "Store selection is independent of enumeration order" {
    $forward = Select-CodexStorePackage -Packages $script:Packages -InstallPath $script:CodexExe
    $reverse = Select-CodexStorePackage -Packages @($script:Packages[1], $script:Packages[0]) -InstallPath $script:CodexExe
    Assert-Equal $forward.PackageFullName $reverse.PackageFullName
    Assert-Equal "OpenAI.Codex_2.0.0.0_x64__8wekyb3d8bbwe" $forward.PackageFullName
}

Test-Case "Dual Store packages without path evidence fail" {
    Assert-Throws { Select-CodexStorePackage -Packages $script:Packages -InstallPath $null } "Windows Store 包选择不唯一"
}

Test-Case "System Node below 22 is rejected" {
    Assert-Throws {
        Get-NodeRuntime -App $script:StoreApp -VersionReader { param($Path) "v20.19.0" }
    } "Node.js 22"
}

Test-Case "32 bit host resolves native Program Files" {
    $path = Get-ProgramFiles64 -Environment @{ ProgramW6432 = "C:\Program Files"; ProgramFiles = "C:\Program Files (x86)" }
    Assert-Equal "C:\Program Files" $path
}

Test-Case "State directory grants access only to the current user" {
    $acl = New-HeiGePrivateDirectoryAcl -UserSid "S-1-5-21-1000"
    Assert-True $acl.AreAccessRulesProtected
    Assert-Equal @("S-1-5-21-1000") @($acl.Access.IdentityReference.Value)
}
```

- [ ] **Step 2: Verify RED on Windows PowerShell and PowerShell 7**

```powershell
powershell.exe -NoProfile -File test/windows/run-tests.ps1 -Suite Resolver
pwsh -NoProfile -File test/windows/run-tests.ps1 -Suite Resolver
```

Expected: FAIL because current resolution chooses the first broad Appx match, returns `aumid:` string sentinels, and accepts any system Node version.

- [ ] **Step 3: Implement structured contracts**

Export these functions from `common.ps1`:

```powershell
Get-ProgramFiles64 -Environment $Environment
Select-CodexStorePackage -Packages $Packages -InstallPath $InstallPath -ProductName $ProductName
Resolve-CodexApp -OverridePath $OverridePath -Packages $Packages -ProcessProvider $ProcessProvider
Get-NodeRuntime -App $App -MinimumSystemMajor 22 -VersionReader $VersionReader
Get-CdpOwner -Port $Port -ProcessProvider $ProcessProvider
Protect-HeiGeStateDirectory -Path $Path -CurrentUserSid $Sid
```

`Resolve-CodexApp` returns one object with `Kind`, `ExecutablePath`, `InstallPath`, `ProductName`, `PackageFullName`, and `Aumid`. `Kind` is exactly `Win32`, `StoreAlias`, or `StoreAumid`. An explicit invalid `HEIGE_CODEX_APP` fails without fallback. A Store process path must be inside one exact `InstallLocation`, which determines package and AUMID regardless of enumeration order. Two plausible packages without path evidence fail with “Windows Store 包选择不唯一”.

`Get-NodeRuntime` returns `{ Path, Source, Version }`. Check both current bundled locations for Win32. A system Node is accepted only when `node --version` parses and major is at least 22. Validate that the CDP listener PID belongs to the resolved app before apply, pause, resume, restore, or status; an HTTP-shaped response from another process is not enough. `Protect-HeiGeStateDirectory` disables inherited ACLs and grants container/object full control only to the current user SID before the Node controller can create `state.json`, so the injected control token is not readable by other local users.

- [ ] **Step 4: Verify GREEN, including 32-bit Windows PowerShell**

```powershell
& (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") -NoProfile -File test/windows/run-tests.ps1 -Suite Resolver
& (Join-Path $env:SystemRoot "SysWOW64\WindowsPowerShell\v1.0\powershell.exe") -NoProfile -File test/windows/run-tests.ps1 -Suite Resolver
pwsh -NoProfile -File test/windows/run-tests.ps1 -Suite Resolver
```

Expected: override, Win32 version order, Store alias, Store AUMID, dual-package ambiguity, 32-bit path, Node 20 rejection, Node 22 acceptance, bundled Node, private state ACL, wrong port owner, Chinese path, and space path tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/windows/lib/common.ps1 test/windows/TestHelpers.ps1 test/windows/resolver.test.ps1 test/windows/run-tests.ps1
git commit -m "fix(windows): resolve Codex deterministically and require Node 22"
```

## Task 2: Add current-user Scheduled Task persistence

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/lib/scheduled-task.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/controller.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/scheduled-task.test.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/run-tests.ps1`

- [ ] **Step 1: Write failing task-definition and isolation tests**

```powershell
Test-Case "Production task is current user limited and points to stable controller" {
    $definition = New-HeiGeTaskDefinition -TaskName $script:ProductionTask -NodePath $script:Node -ControllerPath $script:Controller -StateDirectory $script:State
    Assert-Equal "InteractiveToken" $definition.Principal.LogonType
    Assert-Equal "Limited" $definition.Principal.RunLevel
    Assert-Match ([regex]::Escape($script:Controller)) $definition.Action.Arguments
    Assert-False $definition.RequiresElevation
}

Test-Case "Test mode refuses the production task name" {
    Assert-Throws {
        Register-HeiGeScheduledTask -TaskName "HeiGe Codex Skin Studio Controller" -TestMode
    } "production task"
}

Test-Case "Starting the task waits for this controller handshake" {
    $started = Start-HeiGeScheduledTask -TaskName $script:TestTask -ExpectedRevision 7 -TimeoutSeconds 10
    Assert-True $started.StartInvoked
    Assert-Equal 7 $started.ControllerRevision
    Assert-True $started.ControllerReady
}
```

- [ ] **Step 2: Verify RED**

```powershell
pwsh -NoProfile -File test/windows/run-tests.ps1 -Suite ScheduledTask
```

Expected: FAIL because registration, inspection, isolation, and controller entrypoints do not exist.

- [ ] **Step 3: Implement task registration and controller actions**

Export `New-HeiGeTaskDefinition`, `Register-HeiGeScheduledTask`, `Start-HeiGeScheduledTask`, `Get-HeiGeScheduledTaskStatus`, and `Unregister-HeiGeScheduledTask`. The production task is exactly `HeiGe Codex Skin Studio Controller`. It runs as the current user with `InteractiveToken`, `RunLevel Limited`, an at-logon trigger, `MultipleInstances IgnoreNew`, `StartWhenAvailable`, no execution time limit, and a stable `controller.ps1 -Action run` target. Registration confirms the stored action, principal, and task name before success. Registration alone is never treated as running: `Start-HeiGeScheduledTask` calls `Start-ScheduledTask`, then waits for a token-free controller handshake carrying the expected state revision and exact task name before reporting readiness.

`controller.ps1` accepts `-Action run|register|unregister|status`, `-TaskName`, and `-Port`. `run` resolves the validated Node and invokes `src/cli.mjs controller --platform windows --task-name $TaskName --port $Port`. When the Node controller decides a disabled session has ended, it invokes `controller.ps1 -Action unregister` and exits zero; it never launches Codex in that state.

- [ ] **Step 4: Verify unit tests, then one isolated real task**

```powershell
powershell.exe -NoProfile -File test/windows/run-tests.ps1 -Suite ScheduledTask
pwsh -NoProfile -File test/windows/run-tests.ps1 -Suite ScheduledTask
$name = "HeiGe Codex Skin Studio Test $([guid]::NewGuid())"
pwsh -NoProfile -File test/windows/scheduled-task.test.ps1 -Integration -TaskName $name
```

The integration case must use a GUID test name, an inert command, and `finally { Unregister-ScheduledTask ... }`. It must never inspect, update, run, or unregister the production task.

- [ ] **Step 5: Commit**

```bash
git add scripts/windows/lib/scheduled-task.ps1 scripts/windows/controller.ps1 test/windows/scheduled-task.test.ps1 test/windows/run-tests.ps1
git commit -m "feat(windows): add user scoped controller task"
```

## Task 3: Implement Windows install, re-enable, pause, resume, and restore

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/lib/start-menu.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/enable-skin.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/enable-skin.bat`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/resume.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/resume.bat`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/restore.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/restore.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/install.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/install.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/apply.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/apply.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/customize.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/customize.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/pause.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/windows/pause.bat`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/entrypoints.test.ps1`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/run-tests.ps1`

- [ ] **Step 1: Write failing entrypoint and formatting tests**

```powershell
Test-Case "Install creates the current-user Start Menu re-enable shortcut" {
    & $script:Install -InstallRoot $script:InstallRoot -StartMenuRoot $script:StartMenuRoot -SkipApply
    $link = Join-Path $script:StartMenuRoot "HeiGe Codex Skin Studio\启用皮肤.lnk"
    Assert-True (Test-Path -LiteralPath $link)
    Assert-Equal (Join-Path $script:InstallRoot "scripts\windows\enable-skin.bat") (Read-ShortcutTarget $link)
}

Test-Case "BAT wrappers preserve failure exit codes" {
    $code = Invoke-BatWithFakePowerShell -Path $script:RestoreBat -PowerShellExitCode 23
    Assert-Equal 23 $code
}

Test-Case "PowerShell and batch encodings remain compatible" {
    Assert-Utf8BomFiles (Get-ChildItem scripts/windows -Recurse -Filter *.ps1)
    Assert-CrlfFiles (Get-ChildItem scripts/windows -Recurse -Filter *.bat)
}

Test-Case "Enable starts the task now and rolls the transaction back on handshake failure" {
    $result = Invoke-EnableWithFakes -TaskHandshakeFailure
    Assert-True $result.RegisterCalled
    Assert-True $result.StartScheduledTaskCalled
    Assert-False $result.FinalState.persistenceEnabled
    Assert-False $result.TaskStillRegistered
    Assert-False $result.CodexWasRestarted
}
```

- [ ] **Step 2: Verify RED**

```powershell
powershell.exe -NoProfile -File test/windows/run-tests.ps1 -Suite Entrypoints
pwsh -NoProfile -File test/windows/run-tests.ps1 -Suite Entrypoints
```

Expected: FAIL because enable, resume, restore, Start Menu integration, and truthful batch exit propagation are missing.

- [ ] **Step 3: Implement current-user flows**

`install.ps1` accepts `-InstallRoot`, `-StartMenuRoot`, and `-SkipApply`, stages and atomically replaces the stable current-user install, then creates `HeiGe Codex Skin Studio\启用皮肤.lnk` targeting the stable `enable-skin.bat`. It writes neither Program Files nor machine-wide Start Menu and never requests elevation.

The entrypoint parameters are exact:

```powershell
install.ps1 -InstallRoot $Path -StartMenuRoot $Path -SkipApply
apply.ps1 -Theme $Id -Port 9341
enable-skin.ps1 -Theme $Id -Port 9341
pause.ps1 -Port 9341
resume.ps1 -Port 9341
restore.ps1 -Port 9341
controller.ps1 -Action run -TaskName $Name -Port 9341
```

`apply` starts the current-session controller without enabling next-launch persistence. `enable-skin` validates first, writes the Plan 1 transition journal, registers and verifies the task definition, commits enabled state with the transition nonce, explicitly calls `Start-ScheduledTask`, and waits for the exact controller handshake before ACK or restart. If task start or handshake fails, it performs the journaled compensating CAS to false, unregisters and confirms task absence, leaves the current Codex process untouched, and returns nonzero. The at-logon trigger is future recovery, not proof of current-login execution. `pause` affects only the exact current process. `resume` restores it. `restore` disables state, removes owned injection, unregisters and confirms the task, normally exits Codex, restarts it without CDP, and verifies the port is no longer owned by Codex. Store AUMID activation stays implemented but remains explicitly pending real Windows Store validation.

Every `.ps1` is UTF-8 with BOM. Every `.bat` is CRLF and captures `%ERRORLEVEL%` before any `pause`, then `exit /b` with that code. All path operations use `Join-Path`, `-LiteralPath`, and argument arrays; tests run from a temporary path containing both Chinese and spaces.

- [ ] **Step 4: Verify GREEN**

```powershell
powershell.exe -NoProfile -File test/windows/run-tests.ps1 -Suite Entrypoints
pwsh -NoProfile -File test/windows/run-tests.ps1 -Suite Entrypoints
```

Expected: install, atomic update, no-admin path, Start Menu target, apply-off default, enable, pause, resume, restore, preflight-before-quit, exact port owner, exit code, BOM, CRLF, Chinese path, and space path tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/windows test/windows/entrypoints.test.ps1 test/windows/run-tests.ps1
git commit -m "feat(windows): add install re-enable pause resume and restore"
```

## Task 4: Make the packaged Skill route Windows users correctly

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/scripts/install.ps1`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/scripts/install.bat`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/SKILL.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/README.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/windows/entrypoints.test.ps1`

- [ ] **Step 1: Write failing package-surface tests**

```powershell
Test-Case "Windows Skill install never emits macOS commands" {
    $output = & $script:SkillInstall -InstallRoot $script:InstallRoot -StartMenuRoot $script:StartMenuRoot -SkipApply 2>&1 | Out-String
    Assert-NotMatch "/Applications|open " $output
    Assert-Match "启用皮肤" $output
}

Test-Case "Skill documents automatic evidence separately from Store validation" {
    $text = Get-Content -LiteralPath $script:Skill -Raw
    Assert-Match "Windows PowerShell 5.1" $text
    Assert-Match "PowerShell 7" $text
    Assert-Match "Microsoft Store 真机待验证" $text
}
```

- [ ] **Step 2: Verify RED**

```powershell
pwsh -NoProfile -File test/windows/run-tests.ps1 -Suite Entrypoints
```

Expected: FAIL because the package currently has a macOS-only install entry and gives Windows users macOS instructions.

- [ ] **Step 3: Implement platform-specific Skill entrypoints**

The Windows Skill installer forwards to `scripts/windows/install.ps1` in the unpacked package. `SKILL.md` routes Windows to `.bat` or `.ps1`, macOS to `.command`, announces a normal restart before enable/restore, and keeps status read-only. State exactly what PS5.1 and PS7 automation proves, and keep `Microsoft Store 真机待验证` visible until real hardware evidence exists.

- [ ] **Step 4: Verify GREEN on both PowerShell editions**

```powershell
powershell.exe -NoProfile -File test/windows/run-tests.ps1
pwsh -NoProfile -File test/windows/run-tests.ps1
```

Expected: all Windows unit tests PASS. The integration Scheduled Task test is still opt-in and uses a GUID task name.

- [ ] **Step 5: Commit**

```bash
git add skill/heige-codex-skin-studio scripts/windows test/windows
git commit -m "docs(skill): route Windows users to supported entrypoints"
```

## Plan 4 completion gate

Run on `windows-latest` or a Windows worktree:

```powershell
powershell.exe -NoProfile -File test/windows/run-tests.ps1
pwsh -NoProfile -File test/windows/run-tests.ps1
$name = "HeiGe Codex Skin Studio Test $([guid]::NewGuid())"
pwsh -NoProfile -File test/windows/scheduled-task.test.ps1 -Integration -TaskName $name
git status --short
```

Expected: PS5.1, PS7, 32-bit resolver, isolated Scheduled Task, entrypoint, encoding, and path tests PASS; the worktree is clean; no production task is touched. This gate does not claim that Microsoft Store activation forwards CDP arguments on a real user machine.
