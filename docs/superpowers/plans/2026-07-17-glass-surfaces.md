# Glass Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hard opaque assistant-message slab while preserving legible glass surfaces for interactive cards.

**Architecture:** Separate the full assistant layout container from actual card surfaces. The layout container becomes explicitly transparent with no shadow or filter; composer, user bubble and approval surfaces get a 60 percent glass fill, subtle border and blur.

**Tech Stack:** Generated CSS, `color-mix`, `backdrop-filter`, Node.js string contract tests, live CDP computed-style verification.

---

### Task 1: Split layout and glass selectors

**Files:**
- Modify: `test/skin-css.test.mjs`
- Modify: `src/skin-css.mjs`

- [ ] **Step 1: Write the failing CSS contract**

```js
assert.match(css, /\[data-local-conversation-final-assistant\]\s*\{[^}]*background:\s*transparent/);
assert.match(css, /\[data-local-conversation-final-assistant\]\s*\{[^}]*box-shadow:\s*none/);
assert.match(css, /\.composer-surface-chrome,[\s\S]*var\(--heige-surface\) 60%/);
assert.doesNotMatch(
  css,
  /\.composer-surface-chrome,[\s\S]*\[data-local-conversation-final-assistant\],[\s\S]*88%/,
);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/skin-css.test.mjs`

Expected: FAIL because the assistant container shares the 88 percent surface rule.

- [ ] **Step 3: Implement the split**

Generate:

```css
[data-local-conversation-final-assistant] {
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

.composer-surface-chrome,
[data-user-message-bubble],
[data-codex-approval-surface] {
  color: var(--heige-text) !important;
  border: 1px solid color-mix(in srgb, var(--heige-accent) 24%, transparent) !important;
  background: color-mix(in srgb, var(--heige-surface) 60%, transparent) !important;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--heige-accent) 12%, transparent) !important;
  backdrop-filter: blur(22px) saturate(1.08);
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test test/skin-css.test.mjs test/injector.test.mjs`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/skin-css.mjs test/skin-css.test.mjs
git commit -m "fix: restore transparent assistant conversation surface"
```

### Task 2: Live visual acceptance

**Files:**
- No source files

- [ ] **Step 1: Install the tested build**

Run: `HEIGE_SKIP_APPLY=1 ./scripts/install.command`

Expected: stable install succeeds.

- [ ] **Step 2: Apply the selected theme**

Run: `node "$HOME/.codex/heige-codex-skin-studio/src/cli.mjs" apply --prefer-stored --port 9341`

Expected: renderer reports the selected formal theme.

- [ ] **Step 3: Verify computed styles**

Use CDP to assert the assistant container has a transparent computed background and no shadow, while composer and user bubbles have alpha no greater than `0.64` and a nonzero blur.

- [ ] **Step 4: Capture one screenshot**

Verify the background artwork remains continuous behind assistant text and code or tool cards keep independent legible surfaces.
