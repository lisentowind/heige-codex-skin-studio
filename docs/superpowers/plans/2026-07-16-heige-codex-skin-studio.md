# HeiGe Codex Skin Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the macOS-only ASAR Miku patcher with a general, reversible CDP theme studio whose default installable preset is Miku 488137 and whose Skill can turn a user image or prompt into a theme package.

**Architecture:** Preserve the current ASAR v5 work on an archive branch and tag, then build a dependency-free Node.js 24 CLI around six isolated modules: theme validation and storage, macOS runtime validation, CDP transport, renderer payload generation, injector lifecycle, and atomic state. The installed engine uses Codex's signed bundled Node.js, binds CDP only to `127.0.0.1`, never edits the application bundle, and keeps AI image creation in the Skill orchestration layer.

**Tech Stack:** Node.js ESM and `node:test`, macOS shell commands, Chromium DevTools Protocol, native WebSocket in Codex bundled Node.js 24, CSS custom properties, JSON theme manifests, Bash launchers, WebP README previews.

---

## File map

New or replacement responsibilities:

```text
package.json                                  Product identity and test scripts
src/constants.mjs                            Product constants and path resolution
src/theme-schema.mjs                         Theme manifest and asset validation
src/image-prep.mjs                           Safe macOS image copy or conversion
src/theme-store.mjs                          Built-in and user theme library
src/state-store.mjs                          Atomic runtime state
src/macos-runtime.mjs                        Codex discovery, signature, PID and port checks
src/cdp-client.mjs                           Minimal CDP HTTP and WebSocket transport
src/renderer-runtime.js                      Idempotent browser-side apply and cleanup
src/renderer-payload.mjs                     Safe payload and data URL construction
src/injector.mjs                             Renderer watch, apply, verify and remove loop
src/cli.mjs                                  Command parsing and orchestration
src/theme.css                                Generic visual layer using CSS variables
presets/miku-488137/                          Default installable Miku preset
scripts/lib/common-macos.sh                   Bundled runtime and stable path helpers
scripts/install.command                      Stable engine installation
scripts/apply.command                        Apply selected or default theme
scripts/customize.command                    Finder single-image import flow
scripts/pause.command                        Remove live skin and stop injector
scripts/restore.command                      Full restore guidance and state cleanup
scripts/install-pet.command                  Optional Miku Future installation
skill/heige-codex-skin-studio/                Skill instructions and agent metadata
test/                                        Unit and integration tests
docs/images/                                 README hero and compressed inspiration gallery
```

Legacy files removed from the new mainline after archival:

```text
src/asar.mjs
src/theme-patch.mjs
skill/codex-miku-theme/
test/asar.test.mjs
test/theme-patch.test.mjs
test/theme-patch.integration.test.mjs
```

## Task 1: Preserve the complete ASAR v5 implementation

**Files:**

- Preserve all currently staged and tracked v5 files on branch `codex/archive-asar-v5`
- Tag: `v5-full-legacy`
- Keep untracked `.superpowers/` and `reports/` outside the legacy commit

- [ ] **Step 1: Record the exact starting state**

Run:

```bash
git status --short
git diff --cached --stat
git diff --stat
npm test
```

Expected: the existing ASAR suite exits `0`; all current tracked v5 changes remain visible.

- [ ] **Step 2: Create the archive branch without discarding the dirty tree**

Run:

```bash
git switch -c codex/archive-asar-v5
git add -u
git add .gitignore README.md assets custom-pet scripts skill test output/codex-miku-theme.skill docs/superpowers/plans/2026-07-16-codex-miku-final.md docs/superpowers/specs/2026-07-16-codex-miku-final-design.md
git status --short
```

Expected: only `.superpowers/` and `reports/` remain untracked; all legacy product changes are staged.

- [ ] **Step 3: Commit and tag the legacy product**

Run:

```bash
git commit -m "feat: archive Miku ASAR v5 implementation"
git tag -a v5-full-legacy -m "Miku ASAR v5 full legacy release"
```

Expected: the branch and annotated tag point to the complete v5 implementation.

- [ ] **Step 4: Return to main and create the new implementation branch**

Run:

```bash
git switch main
git switch -c codex/heige-skin-studio
git status --short
```

Expected: no tracked legacy working changes remain; untracked reports are preserved.

## Task 2: Establish the new product identity and remove ASAR behavior

**Files:**

- Create: `src/constants.mjs`
- Create: `test/product-identity.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Delete: `src/asar.mjs`
- Delete: `src/theme-patch.mjs`
- Delete: old ASAR tests listed in the file map

- [ ] **Step 1: Write the failing identity test**

Create `test/product-identity.test.mjs`:

```js
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { PRODUCT_ID, PRODUCT_NAME, resolveStudioPaths } from "../src/constants.mjs";

test("uses the general studio identity and stable macOS paths", () => {
  assert.equal(PRODUCT_ID, "heige-codex-skin-studio");
  assert.equal(PRODUCT_NAME, "HeiGe Codex Skin Studio");
  const paths = resolveStudioPaths({ home: "/Users/example" });
  assert.equal(paths.installRoot, "/Users/example/.codex/heige-codex-skin-studio");
  assert.equal(paths.stateRoot, "/Users/example/Library/Application Support/HeiGeCodexSkinStudio");
});

test("package metadata no longer advertises an ASAR patcher", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "heige-codex-skin-studio");
  assert.equal(pkg.version, "1.0.0");
  await assert.rejects(() => access(new URL("../src/theme-patch.mjs", import.meta.url)));
  await assert.rejects(() => access(new URL("../src/asar.mjs", import.meta.url)));
});
```

- [ ] **Step 2: Run the identity test and verify RED**

Run:

```bash
node --test test/product-identity.test.mjs
```

Expected: FAIL because `src/constants.mjs` is missing and package metadata is still Miku-specific.

- [ ] **Step 3: Add constants and new package metadata**

Create `src/constants.mjs`:

```js
import { homedir } from "node:os";
import { join } from "node:path";

export const PRODUCT_ID = "heige-codex-skin-studio";
export const PRODUCT_NAME = "HeiGe Codex Skin Studio";
export const STATE_SCHEMA_VERSION = 1;
export const THEME_SCHEMA_VERSION = 1;
export const DEFAULT_THEME_ID = "miku-488137";
export const DEFAULT_CDP_PORT = 9341;
export const EXPECTED_BUNDLE_ID = "com.openai.codex";
export const EXPECTED_TEAM_ID = "2DC432GLL2";

export function resolveStudioPaths({ home = homedir() } = {}) {
  const installRoot = join(home, ".codex", PRODUCT_ID);
  const stateRoot = join(home, "Library", "Application Support", "HeiGeCodexSkinStudio");
  return {
    installRoot,
    stateRoot,
    statePath: join(stateRoot, "state.json"),
    logPath: join(stateRoot, "injector.log"),
    userThemesRoot: join(stateRoot, "themes"),
  };
}
```

Replace `package.json` with:

```json
{
  "name": "heige-codex-skin-studio",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "doctor": "node src/cli.mjs doctor",
    "status": "node src/cli.mjs status"
  }
}
```

Delete the ASAR implementation and its dedicated tests. Add `.worktrees/`, temporary theme staging directories, and generated package archives to `.gitignore` without ignoring `docs/images/` or `presets/`.

- [ ] **Step 4: Run the identity test and full surviving suite**

Run:

```bash
node --test test/product-identity.test.mjs
npm test
```

Expected: identity test PASS; any remaining legacy distribution tests that name `codex-miku-theme` fail and are addressed in later package tasks, not silently deleted unless they only test ASAR behavior.

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore src test
git commit -m "refactor: replace ASAR patcher with studio foundation"
```

## Task 3: Implement the versioned theme manifest validator

**Files:**

- Create: `src/theme-schema.mjs`
- Create: `test/theme-schema.test.mjs`

- [ ] **Step 1: Write failing schema tests**

Create `test/theme-schema.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadTheme, validateThemeManifest } from "../src/theme-schema.mjs";

const valid = {
  schemaVersion: 1,
  id: "miku-488137",
  name: "Miku 488137",
  appearance: "light",
  assets: { hero: "hero.png" },
  colors: { accent: "#19C9E5", secondary: "#F397E0", surface: "#FAFAFF", text: "#122C60" },
  copy: { brand: "Miku Codex", headline: "我们今天来构建什么？", tagline: "把灵感写成代码。" }
};

test("accepts a minimal theme and supplies optional asset nulls", () => {
  const result = validateThemeManifest(valid);
  assert.equal(result.assets.hero, "hero.png");
  assert.equal(result.assets.sidebar, null);
  assert.equal(result.assets.logo, null);
  assert.equal(result.assets.polaroid, null);
});

test("rejects path traversal and malformed colors", () => {
  assert.throws(() => validateThemeManifest({ ...valid, assets: { hero: "../secret.png" } }), /inside the theme directory/);
  assert.throws(() => validateThemeManifest({ ...valid, colors: { ...valid.colors, accent: "cyan" } }), /hex color/);
});

test("loads only existing supported image assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-theme-"));
  try {
    await writeFile(join(root, "theme.json"), JSON.stringify(valid));
    await writeFile(join(root, "hero.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const theme = await loadTheme(root, { maxAssetBytes: 1024 });
    assert.equal(theme.manifest.id, "miku-488137");
    assert.equal(theme.assetPaths.hero, join(root, "hero.png"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/theme-schema.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the validator**

Create `src/theme-schema.mjs` with these exported contracts:

```js
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { THEME_SCHEMA_VERSION } from "./constants.mjs";

const ASSET_KEYS = ["hero", "sidebar", "logo", "polaroid"];
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const HEX_COLOR = /^#[0-9A-F]{6}$/i;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_COLORS = Object.freeze({
  accent: "#4BC2E0",
  secondary: "#AD7ED5",
  surface: "#FAFAFF",
  text: "#122C60",
});

function text(value, field, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${field} must be a non-empty string up to ${max} characters`);
  }
  return value.trim();
}

function safeAssetPath(value, field) {
  if (value == null) return null;
  if (typeof value !== "string" || value.startsWith("/") || value.split(/[\\/]+/).includes("..")) {
    throw new Error(`${field} must stay inside the theme directory`);
  }
  if (!IMAGE_EXTENSIONS.has(extname(value).toLowerCase())) {
    throw new Error(`${field} must be PNG, JPEG, or WebP`);
  }
  return value;
}

export function validateThemeManifest(input) {
  if (!input || typeof input !== "object") throw new Error("theme manifest must be an object");
  if (input.schemaVersion !== THEME_SCHEMA_VERSION) throw new Error(`unsupported theme schema ${input.schemaVersion}`);
  if (!ID.test(input.id ?? "")) throw new Error("theme id must use lowercase letters, numbers, and hyphens");
  if (!input.assets?.hero) throw new Error("theme assets.hero is required");
  const colors = { ...DEFAULT_COLORS, ...(input.colors ?? {}) };
  for (const [key, value] of Object.entries(colors)) {
    if (!HEX_COLOR.test(value)) throw new Error(`${key} must be a six-digit hex color`);
    colors[key] = value.toUpperCase();
  }
  const assets = Object.fromEntries(ASSET_KEYS.map((key) => [key, safeAssetPath(input.assets[key], `assets.${key}`)]));
  return Object.freeze({
    schemaVersion: THEME_SCHEMA_VERSION,
    id: input.id,
    name: text(input.name, "name", 80),
    appearance: ["light", "dark", "system"].includes(input.appearance) ? input.appearance : "system",
    assets: Object.freeze(assets),
    colors: Object.freeze(colors),
    copy: Object.freeze({
      brand: text(input.copy?.brand ?? input.name, "copy.brand", 80),
      headline: text(input.copy?.headline ?? "我们今天来构建什么？", "copy.headline", 120),
      tagline: text(input.copy?.tagline ?? "把灵感写成代码。", "copy.tagline", 180),
    }),
  });
}

export async function loadTheme(themeDir, { maxAssetBytes = 16 * 1024 * 1024 } = {}) {
  const root = resolve(themeDir);
  const raw = JSON.parse(await readFile(join(root, "theme.json"), "utf8"));
  const manifest = validateThemeManifest(raw);
  const assetPaths = {};
  for (const [key, relative] of Object.entries(manifest.assets)) {
    if (!relative) { assetPaths[key] = null; continue; }
    const absolute = resolve(root, relative);
    if (!absolute.startsWith(`${root}${sep}`)) throw new Error(`assets.${key} escapes the theme directory`);
    const info = await stat(absolute);
    if (!info.isFile() || info.size < 1 || info.size > maxAssetBytes) throw new Error(`assets.${key} has an invalid size`);
    assetPaths[key] = absolute;
  }
  return Object.freeze({ assetPaths: Object.freeze(assetPaths), manifest, root });
}
```

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/theme-schema.test.mjs
git add src/theme-schema.mjs test/theme-schema.test.mjs
git commit -m "feat: validate portable theme packages"
```

Expected: PASS.

## Task 4: Implement atomic theme import and single-image theme creation

**Files:**

- Create: `src/theme-store.mjs`
- Create: `src/image-prep.mjs`
- Create: `test/theme-store.test.mjs`

- [ ] **Step 1: Write failing store tests**

Create tests that exercise real temporary directories:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSingleImageTheme, importTheme, listThemes } from "../src/theme-store.mjs";
import { prepareThemeImage } from "../src/image-prep.mjs";

test("creates a valid single-image user theme", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-store-"));
  try {
    const image = join(root, "source.png");
    await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await createSingleImageTheme({ imagePath: image, name: "My Blue Theme", storeRoot: join(root, "themes") });
    assert.equal(result.manifest.id, "my-blue-theme");
    assert.deepEqual(await readFile(result.assetPaths.hero), await readFile(image));
    assert.equal((await listThemes({ builtinRoot: join(root, "none"), userRoot: join(root, "themes") })).length, 1);
  } finally { await rm(root, { force: true, recursive: true }); }
});

test("converts HEIC input to a bounded JPEG through macOS sips", async () => {
  const calls = [];
  const source = "/tmp/source.heic";
  const destination = "/tmp/hero.jpg";
  await prepareThemeImage(source, destination, {
    execFileImpl: async (command, args) => { calls.push([command, args]); },
    statImpl: async () => ({ isFile: () => true, size: 500_000 }),
  });
  assert.deepEqual(calls, [["/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "84", "-Z", "3200", source, "--out", destination]]]);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/theme-store.test.mjs
```

Expected: FAIL because `src/theme-store.mjs` is missing.

- [ ] **Step 3: Implement bounded image preparation**

Create `src/image-prep.mjs`:

```js
import { copyFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const direct = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function preparedExtension(sourcePath) {
  const extension = extname(sourcePath).toLowerCase();
  return direct.has(extension) ? extension : ".jpg";
}

export async function prepareThemeImage(sourcePath, destinationPath, {
  execFileImpl = promisify(execFile),
  statImpl = stat,
} = {}) {
  if (direct.has(extname(sourcePath).toLowerCase())) {
    await copyFile(sourcePath, destinationPath);
  } else {
    await execFileImpl("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "84", "-Z", "3200", sourcePath, "--out", destinationPath]);
  }
  const info = await statImpl(destinationPath);
  if (!info.isFile() || info.size < 1 || info.size > 16 * 1024 * 1024) throw new Error("prepared theme image must be between 1 byte and 16 MiB");
  return destinationPath;
}
```

- [ ] **Step 4: Implement the store**

Create `src/theme-store.mjs` with this implementation:

```js
import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareThemeImage, preparedExtension } from "./image-prep.mjs";
import { loadTheme, validateThemeManifest } from "./theme-schema.mjs";

export function slugifyThemeName(name) {
  const slug = name.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `theme-${Date.now()}`;
}

async function commitPreparedTheme({ id, prepare, storeRoot }) {
  await mkdir(storeRoot, { recursive: true, mode: 0o700 });
  const finalDir = join(storeRoot, id);
  const temporary = join(storeRoot, `.${id}.${process.pid}.${Date.now()}.tmp`);
  try {
    await prepare(temporary);
    const loaded = await loadTheme(temporary);
    if (loaded.manifest.id !== id) throw new Error("prepared theme ID changed during import");
    await rename(temporary, finalDir);
    return loadTheme(finalDir);
  } catch (error) {
    await rm(temporary, { force: true, recursive: true });
    if (error.code === "EEXIST" || error.code === "ENOTEMPTY") throw new Error(`theme ${id} already exists`);
    throw error;
  }
}

export async function importTheme({ sourceDir, storeRoot }) {
  const source = await loadTheme(sourceDir);
  return commitPreparedTheme({
    id: source.manifest.id,
    storeRoot,
    prepare: (temporary) => cp(source.root, temporary, { errorOnExist: true, recursive: true }),
  });
}

export async function createSingleImageTheme({ imagePath, name, storeRoot, colors = {}, prepareImage = prepareThemeImage }) {
  const id = slugifyThemeName(name);
  const extension = preparedExtension(imagePath);
  const heroName = `hero${extension}`;
  const manifest = validateThemeManifest({
    schemaVersion: 1,
    id,
    name,
    appearance: "system",
    assets: { hero: heroName },
    colors,
    copy: { brand: name, headline: "我们今天来构建什么？", tagline: "把喜欢的画面变成可交互的 Codex 工作台。" },
  });
  return commitPreparedTheme({
    id,
    storeRoot,
    prepare: async (temporary) => {
      await mkdir(temporary, { recursive: true, mode: 0o700 });
      await prepareImage(imagePath, join(temporary, heroName));
      await writeFile(join(temporary, "theme.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    },
  });
}

async function themesUnder(root, source) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const themes = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    themes.push({ ...(await loadTheme(join(root, entry.name))), source });
  }
  return themes;
}

export async function listThemes({ builtinRoot, userRoot }) {
  const themes = [...await themesUnder(builtinRoot, "builtin"), ...await themesUnder(userRoot, "user")];
  const ids = new Set();
  for (const theme of themes) {
    if (ids.has(theme.manifest.id)) throw new Error(`duplicate theme ID ${theme.manifest.id}`);
    ids.add(theme.manifest.id);
  }
  return themes;
}

export async function resolveThemeById(id, roots) {
  const matches = (await listThemes(roots)).filter((theme) => theme.manifest.id === id);
  if (matches.length !== 1) throw new Error(matches.length ? `duplicate theme ID ${id}` : `theme ${id} was not found`);
  return matches[0];
}
```

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/theme-store.test.mjs
git add src/image-prep.mjs src/theme-store.mjs test/theme-store.test.mjs
git commit -m "feat: add atomic user theme library"
```

## Task 5: Convert the existing Miku artwork into the built-in preset

**Files:**

- Create: `presets/miku-488137/theme.json`
- Create or move: `presets/miku-488137/hero.png`
- Create or move: `presets/miku-488137/sidebar.png`
- Create or move: `presets/miku-488137/logo.png`
- Create or move: `presets/miku-488137/polaroid.png`
- Preserve: `custom-pet/miku-future/pet.json`
- Preserve: `custom-pet/miku-future/spritesheet.webp`
- Create: `test/miku-preset.test.mjs`

- [ ] **Step 1: Write the failing preset test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadTheme } from "../src/theme-schema.mjs";

test("ships Miku 488137 as a valid complete built-in preset", async () => {
  const root = fileURLToPath(new URL("../presets/miku-488137/", import.meta.url));
  const theme = await loadTheme(root);
  assert.equal(theme.manifest.id, "miku-488137");
  assert.ok(theme.assetPaths.hero);
  assert.ok(theme.assetPaths.sidebar);
  assert.ok(theme.assetPaths.logo);
  assert.ok(theme.assetPaths.polaroid);
  assert.ok((await readFile(new URL("../custom-pet/miku-future/spritesheet.webp", import.meta.url))).length > 100_000);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/miku-preset.test.mjs
```

Expected: FAIL because the preset directory does not exist.

- [ ] **Step 3: Build the preset from current pure assets**

Use the current `assets/miku-full-canvas.png` as `hero.png`, `assets/miku-sidebar-wash.png` as `sidebar.png`, `assets/miku-character.png` as `logo.png`, and `assets/miku-polaroid.png` as `polaroid.png`. Do not use the complete UI reference image as a runtime background. Write the approved manifest values from the design spec.

- [ ] **Step 4: Verify hashes, tests, and commit**

```bash
shasum -a 256 presets/miku-488137/* custom-pet/miku-future/*
node --test test/miku-preset.test.mjs
git add presets custom-pet test/miku-preset.test.mjs
git commit -m "feat: ship Miku 488137 default preset"
```

## Task 6: Build safe renderer payloads and the generic visual layer

**Files:**

- Create: `src/renderer-runtime.js`
- Create: `src/renderer-payload.mjs`
- Replace: `src/theme.css`
- Create: `test/renderer-payload.test.mjs`

- [ ] **Step 1: Write failing payload tests**

```js
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRendererPayload } from "../src/renderer-payload.mjs";

test("encodes theme text and images without executable interpolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-payload-"));
  try {
    const hero = join(root, "hero.png");
    await writeFile(hero, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const payload = await buildRendererPayload({
      assetPaths: { hero, sidebar: null, logo: null, polaroid: null },
      manifest: {
        id: "quote-test", name: "Quote", appearance: "light",
        colors: { accent: "#112233", secondary: "#445566", surface: "#FFFFFF", text: "#000000" },
        copy: { brand: "</script><script>bad()</script>", headline: "Hello", tagline: "World" }
      }
    });
    assert.match(payload, /__HEIGE_CODEX_SKIN_STATE__/);
    assert.doesNotMatch(payload, /<script>bad\(\)<\/script>/);
    assert.match(payload, /data:image\/png;base64/);
  } finally { await rm(root, { force: true, recursive: true }); }
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/renderer-payload.test.mjs
```

Expected: FAIL because payload builder is missing.

- [ ] **Step 3: Implement renderer runtime and payload builder**

`src/renderer-payload.mjs` must read `src/renderer-runtime.js` and `src/theme.css`, convert assets to MIME-correct data URLs, serialize config with `JSON.stringify`, escape `<` as `\u003c`, and replace only fixed sentinel tokens.

`src/renderer-runtime.js` must be a single IIFE with these stable IDs:

```js
(() => {
  const config = __HEIGE_THEME_CONFIG_JSON__;
  const css = __HEIGE_THEME_CSS_JSON__;
  const assets = __HEIGE_THEME_ASSETS_JSON__;
  const STYLE_ID = "heige-codex-skin-style";
  const CHROME_ID = "heige-codex-skin-chrome";
  const GLOBAL = "__HEIGE_CODEX_SKIN_STATE__";

  window[GLOBAL]?.cleanup?.();
  document.documentElement.classList.add("heige-codex-skin");
  document.documentElement.dataset.heigeTheme = config.id;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.append(style);
  const chrome = document.createElement("div");
  chrome.id = CHROME_ID;
  chrome.setAttribute("aria-hidden", "true");
  document.body.append(chrome);

  const ensure = () => {
    const root = document.documentElement;
    root.style.setProperty("--heige-accent", config.colors.accent);
    root.style.setProperty("--heige-secondary", config.colors.secondary);
    root.style.setProperty("--heige-surface", config.colors.surface);
    root.style.setProperty("--heige-text", config.colors.text);
    root.style.setProperty("--heige-hero", assets.hero ? `url(${JSON.stringify(assets.hero)})` : "none");
    root.style.setProperty("--heige-sidebar", assets.sidebar ? `url(${JSON.stringify(assets.sidebar)})` : "none");
    root.style.setProperty("--heige-logo", assets.logo ? `url(${JSON.stringify(assets.logo)})` : "none");
    root.style.setProperty("--heige-polaroid", assets.polaroid ? `url(${JSON.stringify(assets.polaroid)})` : "none");
    root.dataset.heigeBrand = config.copy.brand;
    root.dataset.heigeHeadline = config.copy.headline;
    root.dataset.heigeTagline = config.copy.tagline;
  };
  ensure();
  const observer = new MutationObserver(ensure);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const cleanup = () => {
    observer.disconnect();
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CHROME_ID)?.remove();
    document.documentElement.classList.remove("heige-codex-skin");
    delete document.documentElement.dataset.heigeTheme;
    for (const name of ["--heige-accent", "--heige-secondary", "--heige-surface", "--heige-text", "--heige-hero", "--heige-sidebar", "--heige-logo", "--heige-polaroid"]) document.documentElement.style.removeProperty(name);
    delete window[GLOBAL];
    return true;
  };
  window[GLOBAL] = { cleanup, ensure, themeId: config.id, version: 1 };
  return { installed: true, themeId: config.id, version: 1 };
})()
```

The CSS must scope every rule under `html.heige-codex-skin`, set decorative layers to `pointer-events: none`, keep native control stacking above decorations, use the hero only on real main surfaces, and avoid transitions or animation. It must cover current stable classes such as `.app-shell-left-panel`, `.main-surface`, `.browser-main-surface`, `.app-header-tint`, `.composer-surface-chrome`, approval surfaces, dialogs, user messages, assistant messages, focus rings, and scrollbars.

- [ ] **Step 4: Run payload and CSS safety tests**

Add assertions that CSS contains no `animation`, no whole-window fake UI image, and has `pointer-events: none` for the decorative chrome. Then run:

```bash
node --test test/renderer-payload.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer-runtime.js src/renderer-payload.mjs src/theme.css test/renderer-payload.test.mjs
git commit -m "feat: add idempotent generic renderer skin"
```

## Task 7: Implement the minimal CDP transport

**Files:**

- Create: `src/cdp-client.mjs`
- Create: `test/cdp-client.test.mjs`

- [ ] **Step 1: Write failing transport tests**

Test these exported behaviors with injected fake `fetch` and `WebSocket` implementations:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { filterRendererTargets, fetchRendererTargets } from "../src/cdp-client.mjs";

test("accepts only app renderer page targets", () => {
  const targets = filterRendererTargets([
    { id: "a", type: "page", url: "app://codex/index.html" },
    { id: "b", type: "page", url: "https://example.com" },
    { id: "c", type: "worker", url: "app://codex/worker" }
  ]);
  assert.deepEqual(targets.map(({ id }) => id), ["a"]);
});

test("fetches targets only from loopback", async () => {
  let requested;
  const targets = await fetchRendererTargets(9341, {
    fetchImpl: async (url) => { requested = url; return { ok: true, json: async () => [{ id: "a", type: "page", url: "app://codex" }] }; }
  });
  assert.equal(requested, "http://127.0.0.1:9341/json/list");
  assert.equal(targets.length, 1);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/cdp-client.test.mjs
```

- [ ] **Step 3: Implement transport**

Export `filterRendererTargets`, `fetchRendererTargets`, `waitForRendererTargets`, and `CdpSession`. `CdpSession` must accept `WebSocketImpl = globalThis.WebSocket`, correlate numeric request IDs, reject all pending requests on close, expose `evaluate(expression)`, and enforce a per-command timeout. It must never accept a remote host input.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/cdp-client.test.mjs
git add src/cdp-client.mjs test/cdp-client.test.mjs
git commit -m "feat: add loopback-only CDP transport"
```

## Task 8: Implement atomic state and macOS runtime validation

**Files:**

- Create: `src/state-store.mjs`
- Create: `src/macos-runtime.mjs`
- Create: `test/state-store.test.mjs`
- Create: `test/macos-runtime.test.mjs`

- [ ] **Step 1: Write failing state and parser tests**

Create complete temporary-directory and parser fixtures with these assertions:

```js
const statePath = join(root, "state.json");
await writeStudioState(statePath, { schemaVersion: 1, themeId: "miku-488137" });
assert.equal((await readStudioState(statePath)).themeId, "miku-488137");
assert.deepEqual((await readdir(root)).filter((name) => name.includes(".tmp")), []);

await writeFile(statePath, JSON.stringify({ schemaVersion: 99 }));
await assert.rejects(() => readStudioState(statePath), /unsupported state schema 99/);

const processes = parseCodexProcesses(`
101 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT
102 /Applications/ChatGPT.app/Contents/Frameworks/ChatGPT Helper (Renderer).app/Contents/MacOS/ChatGPT Helper (Renderer)
999 /tmp/ChatGPT impostor
`, "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT");
assert.deepEqual(processes.map(({ pid }) => pid), [101, 102]);

assert.deepEqual(
  parseCodesignIdentity("Identifier=com.openai.codex\nTeamIdentifier=2DC432GLL2\n"),
  { bundleId: "com.openai.codex", teamId: "2DC432GLL2" },
);
const signedFixtureExec = async (command, args) => {
  const joined = `${command} ${args.join(" ")}`;
  if (joined.includes("plutil") && joined.includes("CFBundleIdentifier")) return { stdout: "com.openai.codex\n", stderr: "" };
  if (joined.includes("plutil") && joined.includes("CFBundleExecutable")) return { stdout: "ChatGPT\n", stderr: "" };
  if (joined.includes("codesign --verify")) return { stdout: "", stderr: "" };
  if (joined.includes("codesign -dv")) return { stdout: "", stderr: "Identifier=com.openai.codex\nTeamIdentifier=2DC432GLL2\n" };
  if (joined.endsWith("--version")) return { stdout: "v24.14.0\n", stderr: "" };
  throw new Error(`unexpected fixture command: ${joined}`);
};
await assert.rejects(
  () => verifyCodexRuntime({ bundlePath: "/Applications/ChatGPT.app", expectedTeamId: "WRONG", execFileImpl: signedFixtureExec }),
  /unexpected signing team/,
);

assert.equal(await selectLoopbackPort({ preferred: 9341, isFree: async (port) => port === 9343 }), 9343);
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/state-store.test.mjs test/macos-runtime.test.mjs
```

- [ ] **Step 3: Implement atomic state**

Create `src/state-store.mjs`:

```js
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { STATE_SCHEMA_VERSION } from "./constants.mjs";

export async function readStudioState(path) {
  let raw;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const state = JSON.parse(raw);
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) throw new Error(`unsupported state schema ${state.schemaVersion}`);
  return state;
}

export async function writeStudioState(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function clearStudioState(path) {
  await rm(path, { force: true });
}
```

- [ ] **Step 4: Implement macOS runtime**

Implement the pure core of `src/macos-runtime.mjs` exactly as follows, then wrap `/usr/bin/plutil`, `/usr/bin/codesign`, `/usr/bin/open`, `/bin/ps`, `/usr/sbin/lsof`, and the bundled Node `--version` with promisified `execFile` calls:

```js
export function parseCodesignIdentity(output) {
  return {
    bundleId: output.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? null,
    teamId: output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null,
  };
}

export function parseCodexProcesses(psOutput, appExecutable) {
  const bundleRoot = appExecutable.slice(0, appExecutable.indexOf("/Contents/MacOS/"));
  return psOutput.split("\n").map((line) => line.match(/^\s*(\d+)\s+(.+)$/)).filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), command: match[2] }))
    .filter(({ command }) => command === appExecutable || (
      command.startsWith(`${bundleRoot}/Contents/Frameworks/`) && command.includes(".app/Contents/MacOS/")
    ));
}

export async function selectLoopbackPort({ preferred = DEFAULT_CDP_PORT, isFree }) {
  for (let port = preferred; port <= Math.min(preferred + 100, 65535); port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`no free loopback port from ${preferred} through ${Math.min(preferred + 100, 65535)}`);
}

export async function launchCodexWithCdp({ bundlePath, port, execFileImpl }) {
  await execFileImpl("/usr/bin/open", ["-n", "-a", bundlePath, "--args", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`]);
}

export async function processIdentity(pid, { execFileImpl }) {
  const [{ stdout: command }, { stdout: startedAt }] = await Promise.all([
    execFileImpl("/bin/ps", ["-p", String(pid), "-o", "command="]),
    execFileImpl("/bin/ps", ["-p", String(pid), "-o", "lstart="]),
  ]);
  return { pid, command: command.trim(), startedAt: startedAt.trim() };
}
```

`discoverCodexApp` must examine `/Applications/ChatGPT.app` and `$HOME/Applications/ChatGPT.app`, read `CFBundleIdentifier` and `CFBundleExecutable` with `plutil`, and accept only `com.openai.codex`. `verifyCodexRuntime` must run `codesign --verify --deep --strict` on the bundle, parse `codesign -dv --verbose=4`, require the expected Team ID, locate `Contents/Resources/cua_node/bin/node`, require Node major version 22 or newer, and require the Node signer to match the app signer. `isFree` must use `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` and consider exit code 1 with empty output free.

Do not weaken signature checks to accommodate the currently modified ASAR. Live migration must restore the official archive before doctor is allowed to pass.

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/state-store.test.mjs test/macos-runtime.test.mjs
git add src/state-store.mjs src/macos-runtime.mjs test/state-store.test.mjs test/macos-runtime.test.mjs
git commit -m "feat: validate macOS Codex runtime and state"
```

## Task 9: Implement injector apply, verify, watch and remove modes

**Files:**

- Create: `src/injector.mjs`
- Create: `test/injector.test.mjs`

- [ ] **Step 1: Write failing injector-core tests**

Export `applyToTargets`, `verificationPassed`, `removeFromTargets`, and `reconcileTargetIds` from the injector core, then test them without a live renderer:

```js
test("applies one payload to every renderer and closes one-shot sessions", async () => {
  const events = [];
  const targets = [{ id: "a" }, { id: "b" }];
  const results = await applyToTargets({
    targets,
    payload: "PAYLOAD",
    connect: async (target) => ({
      evaluate: async (expression) => { events.push(["evaluate", target.id, expression]); return { installed: true, themeId: "miku-488137" }; },
      close: () => events.push(["close", target.id]),
    }),
  });
  assert.deepEqual(results.map(({ targetId }) => targetId), ["a", "b"]);
  assert.deepEqual(events, [
    ["evaluate", "a", "PAYLOAD"], ["close", "a"],
    ["evaluate", "b", "PAYLOAD"], ["close", "b"],
  ]);
});

test("verify fails when style, sidebar, or composer is absent", () => {
  assert.equal(verificationPassed({ installed: true, stylePresent: true, sidebarPresent: true, composerPresent: true }), true);
  assert.equal(verificationPassed({ installed: true, stylePresent: true, sidebarPresent: false, composerPresent: true }), false);
  assert.equal(verificationPassed({ installed: true, stylePresent: true, sidebarPresent: true, composerPresent: false }), false);
});

test("remove returns success only after the global skin state is gone", async () => {
  const expressions = [];
  const result = await removeFromTargets({
    targets: [{ id: "a" }],
    connect: async () => ({ evaluate: async (expression) => { expressions.push(expression); return true; }, close() {} }),
  });
  assert.equal(result[0].removed, true);
  assert.match(expressions[0], /cleanup/);
});

test("reconciles target IDs without duplicating active sessions", () => {
  const result = reconcileTargetIds(new Set(["a", "b"]), [{ id: "b" }, { id: "c" }]);
  assert.deepEqual(result, { added: ["c"], kept: ["b"], removed: ["a"] });
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/injector.test.mjs
```

- [ ] **Step 3: Implement injector modes**

`src/injector.mjs` must parse:

```text
--port <number>
--theme-dir <absolute path>
--apply-once
--watch
--verify
--remove
--timeout-ms <number>
```

It loads a validated theme, builds one payload, connects only to filtered `app://` renderer targets, and emits JSON results. `applyToTargets` always closes one-shot sessions in `finally`. The verify expression returns `{ installed, stylePresent, sidebarPresent, composerPresent, themeId }` and checks the root class, style ID, current theme ID, real `.app-shell-left-panel`, and real `.composer-surface-chrome`. `removeFromTargets` evaluates `window.__HEIGE_CODEX_SKIN_STATE__?.cleanup?.(); !window.__HEIGE_CODEX_SKIN_STATE__` and closes its sessions. `reconcileTargetIds` sorts `added`, `kept`, and `removed` arrays for deterministic tests. Watch mode polls once per second, handles `SIGINT` and `SIGTERM`, closes every session, and never writes runtime state itself.

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/injector.test.mjs
git add src/injector.mjs test/injector.test.mjs
git commit -m "feat: add resilient Codex skin injector"
```

## Task 10: Implement CLI orchestration and macOS launchers

**Files:**

- Create: `src/cli.mjs`
- Create: `scripts/lib/common-macos.sh`
- Replace: `scripts/install.command`
- Create: `scripts/apply.command`
- Create: `scripts/customize.command`
- Create: `scripts/pause.command`
- Replace: `scripts/restore.command`
- Keep and adapt: `scripts/install-pet.command`
- Create: `test/cli.test.mjs`
- Create: `test/scripts.test.mjs`

- [ ] **Step 1: Write failing CLI contract tests**

Define `runCli(argv, deps)` to return the result object before the entrypoint serializes it. Use this reusable fixture and concrete assertions:

```js
function fixture(overrides = {}) {
  const calls = [];
  let savedState = null;
  const deps = {
    calls,
    paths: { statePath: "/tmp/state.json", userThemesRoot: "/tmp/themes" },
    builtinRoot: "/repo/presets",
    discoverCodexApp: async () => ({ bundlePath: "/Applications/ChatGPT.app", executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" }),
    verifyCodexRuntime: async () => ({ appVersion: "26.707.72221", appBuild: "5307", nodePath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node", nodeVersion: "v24.14.0", teamId: "2DC432GLL2" }),
    listCodexProcesses: async () => [],
    cdpReady: async () => false,
    selectLoopbackPort: async () => 9341,
    launchCodexWithCdp: async (input) => calls.push(["launch", input.port]),
    waitForRendererTargets: async () => [{ id: "renderer" }],
    resolveThemeById: async (id) => ({ manifest: { id }, root: `/themes/${id}` }),
    spawnInjector: async () => ({ pid: 321, command: "cua_node injector.mjs", startedAt: "Thu Jul 16 10:00:00 2026" }),
    writeStudioState: async (_path, value) => { savedState = value; },
    readStudioState: async () => savedState,
    injectorIdentityMatches: async () => true,
    removeLiveTheme: async () => calls.push(["remove"]),
    signalInjector: async (pid, signal) => calls.push(["signal", pid, signal]),
    createSingleImageTheme: async ({ name }) => ({ manifest: { id: name.toLowerCase().replaceAll(" ", "-") } }),
    ...overrides,
  };
  return deps;
}

test("doctor reports bundle, signer, bundled Node and signature status", async () => {
  const result = await runCli(["doctor"], fixture());
  assert.deepEqual(result, { ok: true, appVersion: "26.707.72221", appBuild: "5307", nodeVersion: "v24.14.0", teamId: "2DC432GLL2", bundlePath: "/Applications/ChatGPT.app" });
});

test("apply refuses an already-running non-CDP Codex instead of killing it", async () => {
  const deps = fixture({ listCodexProcesses: async () => [{ pid: 100 }], cdpReady: async () => false });
  await assert.rejects(() => runCli(["apply", "--theme", "miku-488137"], deps), /quit Codex normally/);
  assert.deepEqual(deps.calls, []);
});

test("apply starts Codex and records the exact injector identity", async () => {
  const deps = fixture();
  const result = await runCli(["apply", "--theme", "miku-488137"], deps);
  assert.equal(result.themeId, "miku-488137");
  assert.deepEqual(deps.calls, [["launch", 9341]]);
  assert.deepEqual((await deps.readStudioState()).injector, { pid: 321, command: "cua_node injector.mjs", startedAt: "Thu Jul 16 10:00:00 2026" });
});

test("pause removes the skin and signals only a matching injector", async () => {
  const deps = fixture();
  await deps.writeStudioState(deps.paths.statePath, { schemaVersion: 1, port: 9341, injector: { pid: 321 } });
  const result = await runCli(["pause"], deps);
  assert.equal(result.paused, true);
  assert.deepEqual(deps.calls, [["remove"], ["signal", 321, "SIGTERM"]]);
});

test("status reports a stale injector without signaling it", async () => {
  const deps = fixture({ injectorIdentityMatches: async () => false });
  await deps.writeStudioState(deps.paths.statePath, { schemaVersion: 1, injector: { pid: 321 } });
  const result = await runCli(["status"], deps);
  assert.equal(result.stale, true);
  assert.deepEqual(deps.calls, []);
});

test("create imports one image and returns its theme ID", async () => {
  const result = await runCli(["create", "--image", "/tmp/hero.png", "--name", "My Theme"], fixture());
  assert.equal(result.themeId, "my-theme");
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/cli.test.mjs test/scripts.test.mjs
```

- [ ] **Step 3: Implement CLI commands**

`src/cli.mjs` supports:

```text
doctor
list
create --image <path> --name <name>
import --theme-dir <path>
apply [--theme <id>] [--port <port>]
pause
status
restore
```

Every command prints one JSON document to stdout and diagnostics to stderr. Export `runCli(argv, deps)` for tests and execute it only when the file is the process entrypoint. `apply` uses Codex bundled Node for the detached injector, captures PID command and start time, and atomically records `{ schemaVersion, themeId, port, injector: { pid, command, startedAt } }`.

- [ ] **Step 4: Implement shell launchers**

`scripts/lib/common-macos.sh` must discover the installed or repository root and the bundled Node at:

```text
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
```

`scripts/install.command` uses `ditto` to copy only runtime files, presets, the optional pet, package metadata, and launchers into `~/.codex/heige-codex-skin-studio`. It must not copy docs/gallery, reports, tests, source references, Git metadata, or old ASAR files.

`scripts/customize.command` uses Finder to select an image and a text dialog for the theme name, then calls `create` followed by `apply`. Cancel is a clean exit, not an error stack.

`scripts/pause.command` and `scripts/restore.command` call the corresponding CLI commands. Restore explains that the user must quit the current Codex process once to close its CDP port; it never sends `SIGKILL`.

- [ ] **Step 5: Run tests and commit**

```bash
/bin/bash -n scripts/*.command scripts/lib/*.sh
node --test test/cli.test.mjs test/scripts.test.mjs
git add src/cli.mjs scripts test/cli.test.mjs test/scripts.test.mjs
git commit -m "feat: add macOS studio lifecycle commands"
```

## Task 11: Build the installable Skill and AI-assisted theme workflow

**Files:**

- Create: `skill/heige-codex-skin-studio/SKILL.md`
- Create: `skill/heige-codex-skin-studio/agents/openai.yaml`
- Replace: `scripts/package-skill.command`
- Replace: `test/skill-package.test.mjs`
- Replace: `test/package-repro.test.mjs`
- Replace: `test/distribution-sync.test.mjs`
- Remove: `skill/codex-miku-theme/`

- [ ] **Step 1: Write failing package tests**

Tests must require:

```js
assert.ok(entries.includes("heige-codex-skin-studio/SKILL.md"));
assert.ok(entries.includes("heige-codex-skin-studio/payload/src/cli.mjs"));
assert.ok(entries.includes("heige-codex-skin-studio/payload/presets/miku-488137/theme.json"));
assert.ok(entries.includes("heige-codex-skin-studio/payload/custom-pet/miku-future/pet.json"));
assert.ok(!entries.some((name) => name.includes("theme-patch.mjs") || name.includes("asar.mjs")));
assert.ok(!entries.some((name) => name.includes("docs/images/gallery") || name.includes("reports/")));
```

The reproducibility test builds twice with normalized timestamps and requires byte-identical `.skill` archives.

- [ ] **Step 2: Verify RED**

```bash
node --test test/skill-package.test.mjs test/package-repro.test.mjs test/distribution-sync.test.mjs
```

- [ ] **Step 3: Write Skill instructions**

The Skill must route these intents: install, apply a preset, create from one image, create from a prompt, import a prepared theme, list, status, pause, restore, and optionally install `Miku Future`.

For AI-assisted creation it must state:

```text
Use the image generation or image editing capability available in the current Codex environment.
Generate clean visual assets only: hero, low-noise sidebar texture, optional transparent logo, optional transparent polaroid decoration.
Never generate a full fake Codex window, fake sidebar, fake cards, fake composer, fake buttons, or baked UI text.
If image generation is unavailable, create a single-image theme from the user's supplied file and clearly report the downgrade.
```

It must treat signature failure, unexpected target identity, occupied port, invalid theme, and missing runtime as real blockers.

- [ ] **Step 4: Implement deterministic packaging**

`scripts/package-skill.command` creates a temporary `heige-codex-skin-studio/` root, copies Skill metadata and the exact runtime allowlist, normalizes file timestamps, rejects temporary backup names, then writes `output/heige-codex-skin-studio.skill`.

- [ ] **Step 5: Run tests and commit**

```bash
open scripts/package-skill.command
node --test test/skill-package.test.mjs test/package-repro.test.mjs test/distribution-sync.test.mjs
git add skill scripts/package-skill.command test output/heige-codex-skin-studio.skill
git commit -m "feat: package AI-assisted skin studio skill"
```

## Task 12: Add the supplied README hero and compressed inspiration gallery

**Files:**

- Create: `docs/images/heige-codex-skin-studio-miku-preview.webp`
- Create: `docs/images/gallery/genshin-impact-1.webp`
- Create: `docs/images/gallery/genshin-impact-2.webp`
- Create: `docs/images/gallery/wuthering-waves-1.webp`
- Create: `docs/images/gallery/wuthering-waves-2.webp`
- Create: `docs/images/gallery/naruto-1.webp`
- Create: `docs/images/gallery/naruto-2.webp`
- Create: `docs/images/gallery/love-and-deepspace-1.webp`
- Create: `docs/images/gallery/love-and-deepspace-2.webp`
- Replace: `README.md`
- Create: `test/readme-assets.test.mjs`

- [ ] **Step 1: Write the failing README asset test**

```js
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const expected = [
  "heige-codex-skin-studio-miku-preview.webp",
  "gallery/genshin-impact-1.webp", "gallery/genshin-impact-2.webp",
  "gallery/wuthering-waves-1.webp", "gallery/wuthering-waves-2.webp",
  "gallery/naruto-1.webp", "gallery/naruto-2.webp",
  "gallery/love-and-deepspace-1.webp", "gallery/love-and-deepspace-2.webp"
];

test("README preview assets exist and stay below two MiB each", async () => {
  for (const relative of expected) {
    const info = await stat(new URL(`../docs/images/${relative}`, import.meta.url));
    assert.ok(info.size > 0 && info.size < 2 * 1024 * 1024, `${relative}: ${info.size}`);
  }
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /主题灵感预览/);
  assert.match(readme, /不代表当前 Release 已包含对应 IP 素材/);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/readme-assets.test.mjs
```

- [ ] **Step 3: Create bounded preview copies**

Check the compressor preference files, then keep every source unchanged. For each source, copy to a temporary PNG, resize the copy to a maximum width of 1600 with `sips -Z 1600`, and run:

```bash
npx -y bun /Users/blakexu/.agents/skills/baoyu-compress-image/scripts/main.ts <temporary-png> --output <repo-output.webp> --format webp --quality 78 --keep
```

Sources:

```text
/var/folders/bn/k96c656d2x56zwyld3hrs2gw0000gn/T/codex-clipboard-bf759870-7064-4d0f-85cd-cdb2a7dc8801.png
/Users/blakexu/Downloads/export (8)/*.png
```

Verify all nine outputs are non-empty, render correctly, and stay below 2 MiB each.

- [ ] **Step 4: Rewrite README around the general product**

README must lead with the supplied Miku live screenshot, explain one-image themes, AI-assisted theme creation, CDP security boundaries, macOS-only scope, install and restore commands, Miku preset and optional pet, and the eight-image inspiration gallery. It must distinguish installable presets from visual inspirations and link `v5-full-legacy` for the archived ASAR edition.

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/readme-assets.test.mjs
git add README.md docs/images test/readme-assets.test.mjs
git commit -m "docs: present skin studio and inspiration gallery"
```

## Task 13: Full automated verification and macOS live acceptance

**Files:**

- Create: `docs/acceptance/heige-codex-skin-studio-1.0.0.md`
- Modify only if failures are reproduced by a failing test first

- [ ] **Step 1: Run clean automated verification**

```bash
npm test
/bin/bash -n scripts/*.command scripts/lib/*.sh
node src/cli.mjs list
node src/cli.mjs doctor
git diff --check
```

Expected: all tests pass with no warnings. `doctor` must refuse the currently modified app signature until the legacy ASAR theme is safely restored; that refusal is correct behavior, not a reason to weaken validation.

- [ ] **Step 2: Restore the official application through the archived legacy tool**

Because Codex must be fully closed before restoring the signed ASAR, materialize the archived tag without changing the implementation branch, queue its restore flow, and ask the user to press `Command + Q` once:

```bash
LEGACY_WORKTREE="/tmp/heige-codex-asar-v5-restore-$$"
git worktree add --detach "$LEGACY_WORKTREE" v5-full-legacy
open "$LEGACY_WORKTREE/scripts/restore.command"
```

After relaunch, verify:

```bash
codesign --verify --deep --strict /Applications/ChatGPT.app
node src/cli.mjs doctor
```

Expected: signature verification and doctor both pass. If the current desktop task cannot survive the restart, record this as the one explicit user handoff and resume from the same task afterward.

- [ ] **Step 3: Install and apply the Miku preset**

```bash
open scripts/install.command
open scripts/apply.command
node src/cli.mjs status
```

Verify the home screen and a normal task. Confirm native sidebar, project selector, suggestion cards, composer, approval surfaces, links, dialogs, keyboard focus, scrolling, and pet selection remain interactive.

- [ ] **Step 4: Verify route resilience, pause, and restore**

Navigate across at least three tasks and settings, reload a renderer, then run:

```bash
open scripts/pause.command
node src/cli.mjs status
open scripts/restore.command
```

After the user quits the CDP-launched Codex once, verify the recorded port no longer listens and normal Codex launch has no remote debugging argument.

- [ ] **Step 5: Verify the official app was never modified**

Capture `app.asar` SHA-256 and modification time before and after apply, pause, and restore. Require exact equality. Run `codesign --verify --deep --strict` again.

- [ ] **Step 6: Write the acceptance record**

Document exact app version, build, bundled Node version, signer identity, tested viewport, tested routes, theme ID, port, `app.asar` before/after hashes, codesign result, test count, remaining limitations, and screenshots. Do not claim Windows support or universal future-build compatibility.

- [ ] **Step 7: Final commit**

```bash
git add docs/acceptance
git commit -m "test: verify macOS skin studio release"
```

## Task 14: Final distribution audit

**Files:**

- Verify all tracked files
- Rebuild: `output/heige-codex-skin-studio.skill`

- [ ] **Step 1: Audit for legacy and temporary content**

```bash
rg -n "app\.asar|theme-patch|CODEX_MIKU_THEME|codex-miku-theme" . --glob '!docs/superpowers/**' --glob '!docs/acceptance/**' --glob '!reports/**'
find skill output -type f \( -name '*.before-*' -o -name '*.tmp' -o -name '.DS_Store' \) -print
```

Expected: no runtime legacy patch references and no temporary files in the new Skill.

- [ ] **Step 2: Rebuild and verify package reproducibility**

```bash
open scripts/package-skill.command
npm test
shasum -a 256 output/heige-codex-skin-studio.skill
```

- [ ] **Step 3: Review repository state**

```bash
git status --short
git log --oneline --decorate -15
git diff main...HEAD --stat
```

Expected: only intentionally untracked personal reports may remain; product files are committed on `codex/heige-skin-studio`; `v5-full-legacy` protects the prior ASAR implementation.

- [ ] **Step 4: Hand off without pushing or renaming the remote automatically**

Report the local branch, archive branch, legacy tag, test results, live acceptance boundary, output Skill path, README preview path, and exact command the user can run to open the project. Renaming `HeiGeAi/codex-miku-theme` to `HeiGeAi/heige-codex-skin-studio` and publishing Release `v1.0.0` require an explicit remote publication step after local acceptance.
