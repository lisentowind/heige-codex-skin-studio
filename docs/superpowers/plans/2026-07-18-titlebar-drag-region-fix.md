# Titlebar Drag Region Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Codex's native titlebar window dragging while keeping the injected theme trigger and theme center fully interactive.

**Architecture:** Keep the full-window menu root pointer-transparent and remove its Electron `no-drag` declaration. Declare `no-drag` only on the actual interactive trigger and full-screen theme-center backdrop so Electron preserves native dragging everywhere else.

**Tech Stack:** Node.js 22, ECMAScript modules, Node test runner, CSS injected into Electron renderer

---

### Task 1: Add the drag-region style contract

**Files:**
- Modify: `test/skin-menu.test.mjs:49-56`
- Test: `test/skin-menu.test.mjs`

- [ ] **Step 1: Write the failing test**

Replace the current Aurora Gallery style test with:

```js
test("ships the responsive Aurora Gallery dialog without animation", () => {
  assert.match(THEME_CENTER_STYLE, /data-heige-role="theme-center"/);
  assert.match(THEME_CENTER_STYLE, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(THEME_CENTER_STYLE, /@media \(max-width:979px\)/);
  assert.match(THEME_CENTER_STYLE, /@media \(max-width:679px\)/);
  assert.doesNotMatch(THEME_CENTER_STYLE, /https?:\/\//);
  assert.doesNotMatch(THEME_CENTER_STYLE, /@keyframes|animation:/);
});

test("limits Electron no-drag regions to interactive theme controls", () => {
  const rootRule = /#heige-codex-skin-menu\s*\{([^}]*)\}/.exec(THEME_CENTER_STYLE)?.[1] ?? "";
  const triggerRule = /\[data-heige-role="menu-trigger"\]\s*\{([^}]*)\}/.exec(THEME_CENTER_STYLE)?.[1] ?? "";
  const backdropRule = /\[data-heige-role="theme-center-backdrop"\]\s*\{([^}]*)\}/.exec(THEME_CENTER_STYLE)?.[1] ?? "";

  assert.doesNotMatch(rootRule, /-webkit-app-region:\s*no-drag/);
  assert.match(triggerRule, /-webkit-app-region:\s*no-drag/);
  assert.match(backdropRule, /-webkit-app-region:\s*no-drag/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test test/skin-menu.test.mjs
```

Expected: FAIL because the full-window root currently declares `no-drag`, and the backdrop does not yet declare it explicitly.

- [ ] **Step 3: Commit the failing regression test**

```bash
git add test/skin-menu.test.mjs
git commit -m "test(menu): cover titlebar drag regions"
```

### Task 2: Restrict `no-drag` to interactive regions

**Files:**
- Modify: `src/theme-center-style.mjs:2-10`
- Modify: `src/theme-center-style.mjs:53-61`
- Test: `test/skin-menu.test.mjs`

- [ ] **Step 1: Implement the minimal CSS fix**

Change the root rule from:

```css
#heige-codex-skin-menu {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  color: #17344f;
  font: 500 13px/1.4 ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
  user-select: none;
  -webkit-app-region: no-drag;
}
```

to:

```css
#heige-codex-skin-menu {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  color: #17344f;
  font: 500 13px/1.4 ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
  user-select: none;
}
```

Add the explicit Electron interaction declaration to the backdrop:

```css
[data-heige-role="theme-center-backdrop"] {
  pointer-events: auto;
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 48px 16px 16px;
  background: rgba(17,35,47,.22);
  backdrop-filter: blur(7px) saturate(.94);
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 2: Run the focused test and verify it passes**

Run:

```bash
node --test test/skin-menu.test.mjs
```

Expected: all tests in `test/skin-menu.test.mjs` PASS.

- [ ] **Step 3: Run the DOM interaction tests**

Run:

```bash
node --test test/skin-menu.dom.test.mjs
```

Expected: all theme trigger, panel, selection, persistence, and update-check DOM tests PASS.

- [ ] **Step 4: Commit the fix**

```bash
git add src/theme-center-style.mjs
git commit -m "fix(menu): restore native titlebar dragging"
```

### Task 3: Complete regression verification

**Files:**
- Verify: `src/theme-center-style.mjs`
- Verify: `test/skin-menu.test.mjs`

- [ ] **Step 1: Run the complete automated test suite**

Run:

```bash
npm test
```

Expected: all supported Node tests PASS. Any known Windows-only limitation must be reported separately and must not be hidden.

- [ ] **Step 2: Check formatting and the final diff**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: no whitespace errors; only the design, plan, test, and CSS fix are tracked changes. Existing unrelated untracked files remain untouched.

- [ ] **Step 3: Perform the Electron acceptance check when the local Codex session is available**

Verify:

1. Apply any installed theme.
2. Drag the Codex window from empty space in the top bar.
3. Click the centered theme trigger and confirm the theme center opens.
4. Interact with a theme card and close the panel.
5. Hide the trigger, click the mini trigger, and confirm it restores.

Expected: top-bar empty space drags the window; all injected controls remain clickable.
