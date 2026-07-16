# Package, Security, CI, Live Migration, and Draft PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Before completion, use superpowers:requesting-code-review, superpowers:verification-before-completion, and superpowers:finishing-a-development-branch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a clean, reproducible, security-documented distribution; prove it across automated gates and the current Mac; then publish only a Draft PR with explicit residual risks and remote cleanup recommendations.

**Architecture:** An allowlisted Node packager produces the `.skill` without touching tracked output during tests. Documentation and crawler files are generated from one source and checked in CI. Live macOS acceptance is an explicit opt-in harness that records redacted evidence while migrating the polluted legacy LaunchAgent. GitHub history, tags, releases, issues, settings, and merges remain unchanged.

**Tech Stack:** Node.js 22 and Codex bundled Node.js 24, `yazl@3.3.1`, GitHub Actions, macOS launchd, GitHub CLI, 200-agent review personas.

**Prerequisite:** Complete and verify Plans 1 through 4. Do not begin live migration or remote writes while any earlier gate is red.

---

## File map

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/.gitignore`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/.gitattributes`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/.github/workflows/ci.yml`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/SECURITY.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/ASSET_PROVENANCE.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/NOTICE.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package.json`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package-lock.json`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/package-skill.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/skill-package-manifest.json`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/package-skill.command`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/sync-llms.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/check-asset-provenance.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/update-release-hash.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/README.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/llms.txt`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/llms-full.txt`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/ai.txt`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/README.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/SKILL.md`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/custom-pet/miku-future/spritesheet.webp.before-direction-fix-20260716-023917`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/custom-pet/miku-future/spritesheet.webp.before-eye-fix-20260716-090637`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/reports/codex-dream-skin-comparison-2026-07-16.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/docs/release/2026-07-16-audit-hardening-disposition.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/docs/release/2026-07-16-macos-verification.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/docs-sync.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/release-governance.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/skill-package.test.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/live-macos-acceptance.mjs`
- Regenerate only after final verification: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/output/heige-codex-skin-studio.skill`

## Task 1: Document the security boundary and asset provenance honestly

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/SECURITY.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/ASSET_PROVENANCE.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/NOTICE.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/check-asset-provenance.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/release-governance.test.mjs`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/custom-pet/miku-future/spritesheet.webp.before-direction-fix-20260716-023917`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/custom-pet/miku-future/spritesheet.webp.before-eye-fix-20260716-090637`
- Delete: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/reports/codex-dream-skin-comparison-2026-07-16.md`

- [ ] **Step 1: Write failing security and repository-hygiene tests**

```js
test("security documentation states the real CDP and control-channel boundary", async () => {
  const text = await readFile(new URL("../SECURITY.md", import.meta.url), "utf8");
  for (const phrase of [
    "Runtime.evaluate",
    "127.0.0.1",
    "无认证的 CDP",
    "X-HeiGe-Control-Token",
    "不读取 Codex 对话",
    "restore",
  ]) assert.match(text, new RegExp(escapeRegExp(phrase), "i"));
});

test("tracked source contains no backup assets or ignored reports", async () => {
  const tracked = await gitLines("ls-files");
  assert.equal(tracked.some((path) => path.includes(".before-")), false);
  assert.equal(tracked.some((path) => path.startsWith("reports/")), false);
});

test("every tracked visual asset has a provenance row", async () => {
  await execFile(process.execPath, ["scripts/check-asset-provenance.mjs", "--check"]);
});
```

- [ ] **Step 2: Verify RED**

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
node --test test/release-governance.test.mjs
```

Expected: FAIL because `SECURITY.md` and `ASSET_PROVENANCE.md` are absent and tracked backup/report files remain.

- [ ] **Step 3: Add precise security, license, and provenance records**

`SECURITY.md` must state that the tool uses CDP `Runtime.evaluate`, that an unauthenticated loopback CDP port exists while the skin is active, that the separate token-authenticated control endpoint can only switch one boolean, what token does and does not defend against, how restore removes the controller/control endpoint/CDP launch mode, and that the project does not read conversations, API keys, Base URL, or user project files. Direct private reports to the repository Security tab's “Report a vulnerability” flow and say not to post secrets in a public Issue. Do not claim private reporting is enabled until the remote setting is verified.

`ASSET_PROVENANCE.md` enumerates every tracked PNG, JPEG, and WebP under `assets/`, `themes/`, `custom-pet/`, and `docs/images/`. Each row records repository path, purpose, known creation/source evidence, known license, redistribution status, and replacement action. Where the repository has no verifiable source record, write “来源证据缺失，授权未验证”; never upgrade “AI-generated” or “found online” into permission.

Revise `NOTICE.md` so it no longer implies that a disclaimer creates redistribution rights. State that MIT covers software only and that asset uncertainty remains a release risk. Remove the two backup spritesheets and the tracked competitor report from the current tree while preserving their Git history. Leave ignored local audit notes in `reports/` untouched.

- [ ] **Step 4: Verify GREEN**

```bash
node scripts/check-asset-provenance.mjs --check
node --test test/release-governance.test.mjs
git ls-files | rg '\.before-|^reports/' && exit 1 || true
```

Expected: documentation checks PASS, every image is accounted for, and no backup/report remains tracked. The result must still say asset authorization is unresolved where evidence is absent.

- [ ] **Step 5: Commit**

```bash
git add SECURITY.md ASSET_PROVENANCE.md NOTICE.md scripts/check-asset-provenance.mjs test/release-governance.test.mjs
git rm custom-pet/miku-future/spritesheet.webp.before-direction-fix-20260716-023917 custom-pet/miku-future/spritesheet.webp.before-eye-fix-20260716-090637 reports/codex-dream-skin-comparison-2026-07-16.md
git commit -m "docs(security): document CDP and asset provenance boundaries"
```

## Task 2: Replace the side-effecting package script with a deterministic allowlist

**Files:**

- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/.gitignore`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package.json`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/package-lock.json`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/package-skill.mjs`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/skill-package-manifest.json`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/package-skill.command`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/skill-package.test.mjs`

- [ ] **Step 1: Pin the zip library and write failing reproducibility tests**

```bash
npm install --save-dev --save-exact yazl@3.3.1
```

```js
test("two allowlisted builds are byte-identical and do not touch tracked output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "heige-package-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const beforeStatus = await gitStatus();
  const first = join(root, "first.skill");
  const second = join(root, "second.skill");
  await packageSkill(first, { sourceDateEpoch: 1704067200 });
  await packageSkill(second, { sourceDateEpoch: 1704067200 });
  assert.equal(await sha256(first), await sha256(second));
  assert.deepEqual(await gitStatus(), beforeStatus);
});

test("archive is a strict runtime allowlist", async () => {
  const names = await zipEntries(archive);
  for (const required of ["LICENSE", "NOTICE", "SECURITY.md", "ASSET_PROVENANCE.md", "payload/src/cli.mjs"]) {
    assert.ok(names.some((name) => name.endsWith(required)), required);
  }
  assert.equal(names.some((name) => /\.before-|reports\/|package-skill|\.git\//.test(name)), false);
  const runtimePackage = JSON.parse(await readZipText(archive, "payload/package.json"));
  assert.equal("devDependencies" in runtimePackage, false);
  assert.equal(JSON.stringify(runtimePackage).includes("happy-dom"), false);
  assert.equal(JSON.stringify(runtimePackage).includes("yazl"), false);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/skill-package.test.mjs
```

Expected: FAIL because the current test writes tracked `output/heige-codex-skin-studio.skill`, packages its own builder and backup assets, omits legal/security files, and does not prove stable hashes.

- [ ] **Step 3: Implement an explicit-output Node packager**

`scripts/package-skill.mjs` accepts only:

```text
--output /absolute/path/file.skill
--source-date-epoch 1704067200
```

`--output` is mandatory and must not equal the tracked output unless `HEIGE_ALLOW_TRACKED_PACKAGE_OUTPUT=1` is explicitly set for the final release-candidate refresh. `--source-date-epoch` may come from `SOURCE_DATE_EPOCH`, but one source is required. Use `yazl@3.3.1`, lexicographically sorted entries, compression level 9, fixed UTC mtime, file mode `0644`, `.command` mode `0755`, and no implicit directory metadata. Reject symlinks, non-files, duplicate destination paths, absolute destinations, backslashes, and `..` segments.

`skill-package-manifest.json` maps the outer `SKILL.md`, outer `README.md`, platform installers, `src/`, `themes/`, `custom-pet/`, runtime `scripts/`, `LICENSE`, `NOTICE.md` to archive name `NOTICE`, `SECURITY.md`, and `ASSET_PROVENANCE.md`. The packager generates `payload/package.json` from an explicit allowlist of root fields such as `name`, `version`, `type`, `engines`, `bin`, `scripts`, and production `dependencies`; it never copies root `devDependencies`, and the test reads the archived JSON to prove `happy-dom` and `yazl` are absent. It excludes `node_modules`, tests, reports, docs, previews, backup assets, Git metadata, output, and both package scripts. Development dependencies never enter the archive.

Set `package.json` `engines.node` to `>=22` and add a preflight test that rejects an injected Node 20 version before runtime work. `package-skill.command` requires an output path argument and forwards it plus an explicit epoch. Add `node_modules/` to `.gitignore`. Tests always use temporary output paths.

- [ ] **Step 4: Verify GREEN**

```bash
tmpdir=$(mktemp -d)
node scripts/package-skill.mjs --output "$tmpdir/a.skill" --source-date-epoch 1704067200
node scripts/package-skill.mjs --output "$tmpdir/b.skill" --source-date-epoch 1704067200
shasum -a 256 "$tmpdir/a.skill" "$tmpdir/b.skill"
node --test test/skill-package.test.mjs
git status --short
```

Expected: hashes match, archive and installed-copy tests PASS, and the package test leaves the worktree unchanged.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json package-lock.json scripts/package-skill.mjs scripts/skill-package-manifest.json scripts/package-skill.command test/skill-package.test.mjs
git commit -m "build(skill): make package output reproducible and allowlisted"
```

## Task 3: Synchronize README, crawler files, Skill claims, and remote disposition

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/sync-llms.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/README.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/llms.txt`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/llms-full.txt`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/ai.txt`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/README.md`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/skill/heige-codex-skin-studio/SKILL.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/docs/release/2026-07-16-audit-hardening-disposition.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/docs-sync.test.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/release-governance.test.mjs`

- [ ] **Step 1: Write failing synchronization and claim tests**

```js
test("llms-full is generated from llms summary plus README", async () => {
  await execFile(process.execPath, ["scripts/sync-llms.mjs", "--check"]);
});

test("docs describe option 1 and do not hardcode a stale test count", async () => {
  const docs = await allPublicDocs();
  assert.match(docs, /关闭后本次继续使用；下次启动恢复原生界面/);
  assert.match(docs, /HeiGe 皮肤启动器/);
  assert.match(docs, /启用 HeiGe 皮肤/);
  assert.doesNotMatch(docs, /\b(?:60|72)\s*项全通过/);
  assert.doesNotMatch(docs, /Windows 常驻暂未提供/);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/docs-sync.test.mjs test/release-governance.test.mjs
```

Expected: FAIL because README, llms-full, Skill, test-count claims, Windows persistence claims, and old watchdog descriptions disagree.

- [ ] **Step 3: Rewrite from the verified product contract**

Document the persistence switch, confirmation, option 1 next-launch behavior, macOS user launcher, Windows Start Menu path, Codex natural-language re-enable intent, distinct pause/resume/restore, current resource limits, CDP security boundary, and runtime-versus-development dependencies. Require Node 22 or newer when a system Node is used. Do not hardcode a test count, and do not claim future Codex upgrades can never require selector or startup adaptation. Mark macOS live evidence with its date and leave Windows Store activation as pending real-machine verification.

`scripts/sync-llms.mjs` writes `llms-full.txt` as the exact `llms.txt` summary, a fixed separator, and current README; `--check` fails on byte drift. Update `ai.txt` to the same platform and safety claims.

Before writing the disposition, refresh remote state read-only:

```bash
gh release list --repo HeiGeAi/heige-codex-skin-studio --limit 20
gh issue view 1 --repo HeiGeAi/heige-codex-skin-studio
gh pr view 2 --repo HeiGeAi/heige-codex-skin-studio --json state,isDraft,headRefName,baseRefName,commits
gh api repos/HeiGeAi/heige-codex-skin-studio --jq '{description,default_branch,security_and_analysis}'
gh api repos/HeiGeAi/heige-codex-skin-studio/private-vulnerability-reporting
git ls-remote --tags origin
```

The disposition records the live result and the local fact that `v4.0.0` and `v5-asar-legacy` both point to `fdf374e2123e3b47183ff86af62aded8f69c0096`. Include exactly one line beginning `<!-- heige-package-sha256 -->`; before the final artifact exists it truthfully says `Package SHA-256: pending final build`, and Task 7 must replace it with the verified digest before PR creation. Recommend, but do not perform, repository-description correction, old Latest Release supersession, a truthful legacy tag after historical verification, Issue #1 handling after Windows live evidence, Draft PR #2 handling after commit comparison, and private vulnerability reporting enablement if absent.

- [ ] **Step 4: Verify GREEN**

```bash
node scripts/sync-llms.mjs
node scripts/sync-llms.mjs --check
node --test test/docs-sync.test.mjs test/release-governance.test.mjs
```

Expected: generated files are byte-synchronized, all public claims match the product, and every unverified claim is labeled as pending.

- [ ] **Step 5: Commit**

```bash
git add README.md llms.txt llms-full.txt ai.txt skill/heige-codex-skin-studio scripts/sync-llms.mjs docs/release/2026-07-16-audit-hardening-disposition.md test/docs-sync.test.mjs test/release-governance.test.mjs
git commit -m "docs: synchronize product claims and remote disposition"
```

## Task 4: Add clean-worktree CI across Node, macOS, Windows, and package gates

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/.gitattributes`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/.github/workflows/ci.yml`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/release-governance.test.mjs`

- [ ] **Step 1: Write the failing workflow contract test**

```js
test("CI has independent Node macOS Windows and package gates", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /^on:\s*$/m);
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  for (const job of ["node:", "macos:", "windows:", "package:"]) assert.match(workflow, new RegExp(`^  ${job}`, "m"));
  assert.match(workflow, /powershell\.exe.*run-tests\.ps1/s);
  assert.match(workflow, /pwsh.*run-tests\.ps1/s);
  assert.match(workflow, /scheduled-task\.test\.ps1.*-Integration/s);
  assert.match(workflow, /git status --porcelain/s);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/release-governance.test.mjs
```

Expected: FAIL because no GitHub Actions workflow or line-ending policy exists.

- [ ] **Step 3: Implement four explicit jobs**

`.gitattributes` fixes `.bat` and `.ps1` to CRLF, `.mjs`, `.command`, `.zsh`, Markdown, JSON, and YAML to LF. Preserve the UTF-8 BOM inside every `.ps1`.

`ci.yml` is triggered by `pull_request` and `workflow_dispatch`. It contains:

1. `node` on `ubuntu-latest`, Node 22, `npm ci`, full `npm test`, docs/provenance checks, and clean-worktree check.
2. `macos` on `macos-latest`, Node 22, `npm ci`, macOS unit tests, zsh syntax checks, random-label LaunchAgent integration where the GUI domain is available, and cleanup plus clean-worktree check.
3. `windows` on `windows-latest`, Node 22, `npm ci`, Windows PowerShell 5.1 tests, PowerShell 7 tests, 32-bit resolver test, one GUID Scheduled Task integration test, unconditional cleanup, and clean-worktree check.
4. `package` on `ubuntu-latest`, Node 22, `npm ci`, two temp builds with epoch `1704067200`, SHA-256 equality, archive allowlist/legal checks, installed-copy smoke test, and clean-worktree check.

Every job uses least required permissions, `contents: read`, timeouts, and concurrency cancellation. The workflow never publishes, tags, releases, closes issues, or pushes generated files.

- [ ] **Step 4: Verify GREEN locally where possible**

```bash
node --test test/release-governance.test.mjs
npm test
for file in scripts/*.command scripts/lib/*.zsh; do /bin/zsh -n "$file"; done
git diff --check
git status --short
```

Expected: all local gates PASS. Windows execution is proved only after the branch runs on `windows-latest`; do not relabel it as locally verified.

- [ ] **Step 5: Commit**

```bash
git add .gitattributes .github/workflows/ci.yml test/release-governance.test.mjs
git commit -m "ci: add Node macOS Windows and package gates"
```

## Task 5: Run full local verification and a fresh 200-agent expert review

**Files:**

- Modify only files identified by verified review findings.

- [ ] **Step 1: Run both supported local Node runtimes and deterministic package checks**

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
npm ci
node --version
npm test
"/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" --version
"/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" --test
for file in scripts/*.command scripts/lib/*.zsh; do /bin/zsh -n "$file"; done
node scripts/sync-llms.mjs --check
node scripts/check-asset-provenance.mjs --check
tmpdir=$(mktemp -d)
node scripts/package-skill.mjs --output "$tmpdir/a.skill" --source-date-epoch 1704067200
node scripts/package-skill.mjs --output "$tmpdir/b.skill" --source-date-epoch 1704067200
test "$(shasum -a 256 "$tmpdir/a.skill" | cut -d' ' -f1)" = "$(shasum -a 256 "$tmpdir/b.skill" | cut -d' ' -f1)"
npm audit --audit-level=high
git diff --check
git status --short
```

Expected: system Node 22 and bundled Node 24 suites PASS, package hashes match, no high-severity dependency advisory remains unhandled, and the worktree is clean.

- [ ] **Step 2: Dispatch the 200-agent review panel**

Read and apply these local expert contracts from `/Users/blakexu/Documents/开源项目/repos/200-agent/agents/`:

1. `software-architect.md` for state/controller/platform boundaries.
2. `appsec-secure-code-engineer.md` for CDP, token, CORS, paths, secrets, and lifecycle threats.
3. `test-qa-automation-engineer.md` for deterministic evidence and false-positive tests.
4. `dux-accessibility-specialist.md` for the switch, keyboard, focus, confirmation, and error feedback.
5. `code-reviewer.md` to consolidate only actionable correctness, security, maintainability, and performance findings.

Give each reviewer the approved spec, the five implementation plans, the full branch diff from `main`, and fresh test output. Reviewers do not edit concurrently; they return file-and-line findings with severity and reproduction. Reject style-only opinions and any finding unsupported by code or a testable path.

- [ ] **Step 3: Fix findings with one regression test per bug**

For every confirmed P0, P1, or P2, first reproduce it with a failing test, make the minimum fix, rerun the focused test, then the full matrix. Record rejected or residual findings in the disposition with evidence. No open P0/P1 may reach the Draft PR; any P2 intentionally deferred must be explicit in the PR.

- [ ] **Step 4: Request independent specification and code-quality review**

Use `superpowers:requesting-code-review` twice: first compare implementation against every acceptance item in section 14 of the approved design, then review code quality after spec compliance passes. Repeat until both reviews return no unresolved blocking finding.

- [ ] **Step 5: Commit any review fixes**

```bash
git add -A
git commit -m "fix: resolve independent audit findings"
```

Skip the commit only if no file changed.

## Task 6: Migrate and verify the current Mac without losing the user's prior choice

**Files:**

- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/live-macos-acceptance.mjs`
- Create after the run: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/docs/release/2026-07-16-macos-verification.md`
- Modify only migration defects found by the live run.

- [ ] **Step 1: Write the opt-in live harness and verify it skips by default**

```js
test("live macOS migration and option 1 lifecycle", { skip: process.env.HEIGE_RUN_LIVE_MACOS !== "1" }, async () => {
  const result = await runLiveMacAcceptance({
    preflightOnly: process.env.HEIGE_LIVE_PREFLIGHT_ONLY === "1",
    sequence: process.env.HEIGE_LIVE_SEQUENCE ?? "rollback-then-clean",
    resultPath: process.env.HEIGE_LIVE_RESULT_JSON,
    reportPath: process.env.HEIGE_LIVE_REPORT_MD,
  });
  assert.equal(result.preflight.rendererOrigin, "app://-");
  assert.equal(result.preflight.portOwnerMatchesCodex, true);
  if (process.env.HEIGE_LIVE_PREFLIGHT_ONLY === "1") {
    assert.equal(result.preflight.mutationCount, 0);
    return;
  }
  assert.equal(result.rollback.status, "PASS");
  assert.equal(result.rollback.preMigrationBehaviorRestored, true);
  assert.equal(result.rollback.migrationCommitted, false);
  for (const check of [
    "menuSwitch", "offAck", "sameProcessReload", "nativeRestart",
    "launcherReenable", "pauseResume", "restoreNative", "finalPreference",
  ]) assert.equal(result.clean.checks[check], "PASS", check);
  assert.equal(result.clean.finalPersistenceEnabled, result.clean.initialPersistenceEnabled);
  assert.equal(result.reportWritten, true);
});
```

```bash
node --test test/live-macos-acceptance.mjs
HEIGE_RUN_LIVE_MACOS=1 HEIGE_LIVE_PREFLIGHT_ONLY=1 node --test test/live-macos-acceptance.mjs
```

Expected: the default run reports one skip and changes nothing. The opt-in preflight run is RED with `LIVE_HARNESS_NOT_IMPLEMENTED` until the real discovery and assertion helpers exist; an empty test body is not an acceptable RED or GREEN.

- [ ] **Step 2: Re-read live identity and abort on drift before mutation**

The harness must rediscover the current app, exact executable, PID, start time, CDP port owner, selected legacy theme, old plist, old loaded label, and new-label absence. It also reads the exact main renderer's `location.origin` and requires `app://-` before testing the control channel. It must not hardcode the previously observed PID 3778. If the port is not owned by that exact process, the renderer origin differs, the theme is invalid, or the old plist cannot be attributed to this tool, abort before uninstalling or restarting anything.

Attribute the legacy job only from the same fixed tuple used in Plan 2: canonical plist path, exact label, `/bin/zsh` plus the positively identified legacy `scripts/lib/skin-watchdog.zsh`, `RunAtLoad=true`, `StartInterval=15`, `AbandonProcessGroup=true`, and port `9341`. The 2026-07-16 read-only evidence showed that `ProgramArguments` still pointed to `/Users/blakexu/.codex/heige-codex-skin-studio/scripts/lib/skin-watchdog.zsh`; only state and log fields contained `/tmp/a&b<c>d`. Rediscover this instead of trusting the old snapshot. A polluted state/log path is recorded as untrusted and never traversed or deleted; polluted executable arguments abort migration.

Snapshot the validated old plist, its mode and loaded status, legacy theme record, product-owned legacy install tree needed by the old job, existing schema 2 state if any, launcher registration, user persistence choice, and functional Codex mode into a directory such as `/Users/blakexu/Library/Application Support/HeiGeCodexSkinStudio/migration-backup/20260716T213000Z/`, where the final component is generated from the current UTC time in `YYYYMMDDTHHMMSSZ` form. Use directory mode `0700` and file mode `0600`, record SHA-256 for every copied file, and refuse symlinks or paths outside positively identified product roots. The previously observed `/tmp/a&b<c>d` remains untouched.

Before the first mutation, create and `fsync` a mode-`0600` `live-migration.json` journal containing the backup path, pre-state hashes, pre-run process mode, and phase `prepared`. Advance and `fsync` it after install swap, new-state write, new-label bootstrap, old-label bootout, and old-plist removal. The `rollback-then-clean` sequence injects a failure after old-label bootout, waits for reverse recovery and verifies the complete pre-state, then and only then begins the clean migration. The helper also exposes each other boundary to isolated adapter tests, so rollback is executable rather than narrative.

- [ ] **Step 3: Install stable files and perform one-time migration**

```bash
HEIGE_SKIP_APPLY=1 "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/install.command"
```

Use the installed CLI's internal `migrate-legacy` command under the common operation lease. Because the live legacy LaunchAgent was loaded and `/Users/blakexu/.codex/heige-codex-skin-persist` held a valid theme at audit time, migrate to `schemaVersion=2` and `persistenceEnabled=true` only if those facts are still true. Bootstrap and verify `com.heige.codex-skin-controller` before unloading the validated `com.heige.codex-skin-watchdog`; confirm the old label is absent before removing only its canonical validated plist; then confirm the new label's exact stable ProgramArguments with `launchctl print`.

Implement the live mutation as `try/catch/finally`. Any thrown error or failed assertion runs reverse rollback from the durable phase journal: boot out the new job, restore its plist/state to the precise pre-state, atomically restore the legacy install tree and old plist bytes/mode, re-bootstrap and verify the old job when it was previously loaded, restore the legacy theme record and user preference, and restore functional Codex mode. If Codex was originally closed, leave it closed; if it was running, restore CDP versus native mode and skin presence with a newly verified process identity. `finally` verifies the recovered labels, state hashes, preference, port ownership, and process mode. Keep the journal and report both primary and rollback errors if recovery is incomplete. Never claim success merely because cleanup ran.

- [ ] **Step 4: Run the option 1 and recovery lifecycle through the real menu**

Run one detached harness because it will normally restart Codex. The single process must execute rollback injection, wait for and verify recovery, and then run the clean migration sequentially. It atomically writes one JSON result and the Markdown evidence report; no second mutation process may start concurrently:

```bash
umask 077
RUN_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="/Users/blakexu/Library/Application Support/HeiGeCodexSkinStudio/live-acceptance/$RUN_STAMP"
mkdir -p "$RUN_DIR"
LATEST_FILE="/Users/blakexu/Library/Application Support/HeiGeCodexSkinStudio/live-acceptance/latest-run.txt"
printf '%s\n' "$RUN_DIR" >"$LATEST_FILE"
nohup env HEIGE_RUN_LIVE_MACOS=1 HEIGE_LIVE_SEQUENCE=rollback-then-clean HEIGE_LIVE_RESULT_JSON="$RUN_DIR/result.json" HEIGE_LIVE_REPORT_MD="/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/docs/release/2026-07-16-macos-verification.md" node --test test/live-macos-acceptance.mjs >"$RUN_DIR/run.log" 2>&1 < /dev/null &
LIVE_PID=$!
printf '%s\n' "$LIVE_PID" >"$RUN_DIR/run.pid"
```

After the task resumes, read `latest-run.txt` and check the PID. If it is still alive, use the agent wait mechanism in intervals no longer than 30 seconds and do not launch another harness. Continue only after the process has exited and the result/report files are complete.

The detached harness must:

1. Verify the top menu has the switch, approved reminder, `role=switch`, and correct checked state.
2. Turn persistence off through the actual confirmation UI and loopback request; verify state revision increments only after ACK.
3. Verify the current skin and menu survive a renderer reload in the same process.
4. Normally exit Codex; verify the controller unregisters and exits.
5. Launch Codex normally; verify no CDP owner, no controller label, and no injection path.
6. Open `/Users/blakexu/Applications/HeiGe 皮肤启动器.app`; verify normal restart, controller registration, CDP, last valid theme, and menu return.
7. Verify pause stays paused across controller ticks and resume restores.
8. Verify restore restarts normally with no CDP, then use the launcher once more to re-enable.
9. Leave the final persistence value equal to the user's pre-migration legacy choice, which is expected to be `true` only if revalidated in Step 2.

The generated report redacts token, user paths beyond named product paths, environment, and raw logs. It records commands, timestamps, process identity hashes, state revisions, launchd labels, checks, and failures.

- [ ] **Step 5: Verify the live report and commit the harness/evidence**

```bash
node --test test/live-macos-acceptance.mjs
RUN_DIR="$(<"/Users/blakexu/Library/Application Support/HeiGeCodexSkinStudio/live-acceptance/latest-run.txt")"
LIVE_PID="$(<"$RUN_DIR/run.pid")"
if kill -0 "$LIVE_PID" 2>/dev/null; then exit 75; fi
node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1])); if (r.status!=="PASS" || r.rollback?.status!=="PASS" || r.clean?.status!=="PASS") process.exit(1)' "$RUN_DIR/result.json"
test -s docs/release/2026-07-16-macos-verification.md
rg -n 'PASS|FAIL|待验证|persistence|controller|CDP' docs/release/2026-07-16-macos-verification.md
git diff --check
```

Expected: default suite still skips live mutation; the single atomic JSON reports overall, rollback, and clean PASS; the rollback phase proves the exact pre-migration behavior was restored before clean migration begins; the generated dated report shows all macOS acceptance checks PASS, Windows Store remains pending, and no control token appears.

```bash
git add test/live-macos-acceptance.mjs docs/release/2026-07-16-macos-verification.md
git commit -m "test(macos): record live controller and option 1 acceptance"
```

## Task 7: Refresh the artifact, push the branch, open a Draft PR, and wait for CI

**Files:**

- Regenerate: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/output/heige-codex-skin-studio.skill`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/docs/release/2026-07-16-audit-hardening-disposition.md`
- Create: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/scripts/update-release-hash.mjs`
- Modify: `/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/test/release-governance.test.mjs`

- [ ] **Step 1: Run the final verification-before-completion gate**

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
npm test
"/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" --test
node scripts/sync-llms.mjs --check
node scripts/check-asset-provenance.mjs --check
git diff --check
git status --short
```

Use `superpowers:verification-before-completion`. Do not claim completion from old output; capture fresh command results.

- [ ] **Step 2: Build and verify the tracked candidate artifact explicitly**

```bash
HEIGE_ALLOW_TRACKED_PACKAGE_OUTPUT=1 node scripts/package-skill.mjs \
  --output "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio/output/heige-codex-skin-studio.skill" \
  --source-date-epoch 1784131200
tmpdir=$(mktemp -d)
node scripts/package-skill.mjs --output "$tmpdir/verify.skill" --source-date-epoch 1784131200
test "$(shasum -a 256 output/heige-codex-skin-studio.skill | cut -d' ' -f1)" = "$(shasum -a 256 "$tmpdir/verify.skill" | cut -d' ' -f1)"
node scripts/update-release-hash.mjs \
  --artifact output/heige-codex-skin-studio.skill \
  --disposition docs/release/2026-07-16-audit-hardening-disposition.md
node --test test/release-governance.test.mjs
```

`update-release-hash.mjs` computes SHA-256 itself and replaces exactly one `<!-- heige-package-sha256 -->` line created in Task 3. It fails if the marker is missing or duplicated. The governance test independently hashes the tracked artifact and requires the disposition line and Draft PR body source to contain that exact digest. Commit the verified artifact and its matching disposition together:

```bash
git add output/heige-codex-skin-studio.skill docs/release/2026-07-16-audit-hardening-disposition.md scripts/update-release-hash.mjs test/release-governance.test.mjs
git commit -m "build(skill): refresh audited distribution"
```

- [ ] **Step 3: Refresh remote state read-only and enforce the authority boundary**

Re-run the read-only Release, Issue #1, PR #2, repository metadata, private-vulnerability-reporting, and remote-tag queries from Task 3. Remote-disposition fields change only when the read-only evidence changed, but the package hash must always remain synchronized with the just-committed artifact. If a remote field changes, update and commit the disposition before creating the PR. Do not move or delete `v5-asar-legacy`, publish or edit a Release, close an Issue or PR, change repository description/settings, merge, or rewrite history.

- [ ] **Step 4: Push only `codex/audit-hardening` and create a Draft PR**

```bash
git push -u origin codex/audit-hardening
gh pr create \
  --repo HeiGeAi/heige-codex-skin-studio \
  --base main \
  --head codex/audit-hardening \
  --draft \
  --title "feat: harden skin lifecycle and add user-controlled persistence" \
  --body-file docs/release/2026-07-16-audit-hardening-disposition.md
```

The PR body separates verified macOS behavior, automated Windows evidence, Windows Store pending evidence, asset-authorization residual risk, security boundary, package hash, and remote disposition recommendations.

- [ ] **Step 5: Watch CI and fix the branch until required checks pass**

```bash
gh pr checks --repo HeiGeAi/heige-codex-skin-studio --watch
```

For each failure, inspect the real log, reproduce locally where possible, add a regression test, fix, rerun the affected matrix, commit, and push. Stop only when all configured Draft PR checks pass or a documented external blocker is proven. Keep the PR draft; do not merge or release.

## Plan 5 completion gate

```bash
cd "/Users/blakexu/Documents/开源项目/repos/heige-codex-skin-studio"
git status --short
git log --oneline origin/main..HEAD
gh pr view --repo HeiGeAi/heige-codex-skin-studio --json url,isDraft,headRefName,baseRefName,statusCheckRollup
```

Expected: clean worktree, Draft PR from `codex/audit-hardening` to `main`, all configured checks passing, current Mac evidence recorded, Windows Store and asset authorization still honestly labeled where unverified, and no merge, Release, tag, Issue, old PR, history, or repository-setting mutation.
