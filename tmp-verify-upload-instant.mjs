/**
 * Live verify: after reinject, custom upload immediately shows a formal
 * user-theme-row in 「我的主题」 (HTTP or CDP ACK), without waiting for reinject.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpSession } from "./src/cdp-client.mjs";

const PORT = 9341;
const THEMES = join(process.env.APPDATA, "HeiGeCodexSkinStudio", "themes");

// Valid 1×1 PNG — enough for header + Image decode in Electron.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function listMainTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && /app:\/\/-\/index\.html/.test(t.url))
    ?? targets.find((t) => t.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("no page CDP target");
  return page;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const page = await listMainTarget();
  const session = new CdpSession(page.webSocketDebuggerUrl, { commandTimeoutMs: 60000 });
  await session.open();
  try {
    const fingerprint = await session.evaluate(`(() => {
      const rt = window.__heigeCodexSkinRuntime;
      return {
        hasRuntime: !!rt,
        themeId: document.documentElement.dataset.heigeCodexSkin || null,
        generation: rt?.status?.()?.generation || null,
      };
    })()`);
    console.log("runtime", fingerprint);
    if (!fingerprint?.hasRuntime) throw new Error("skin runtime missing — reinject first");

    await session.evaluate(`(() => {
      try { window.__heigeCodexSkin?.setHidden?.(false); } catch {}
      const trigger = document.querySelector('[data-heige-role="menu-trigger"]');
      if (!trigger) throw new Error("no menu trigger");
      trigger.click();
      return {
        open: document.querySelector('[data-heige-role="theme-center-backdrop"]')?.hidden === false,
      };
    })()`);
    await sleep(400);

    const bytes = [...TINY_PNG];
    const started = await session.evaluate(`(() => {
      const picker = document.querySelector('input[type="file"]');
      if (!picker) throw new Error("no file picker");
      const bytes = new Uint8Array(${JSON.stringify(bytes)});
      const file = new File([bytes], "live-instant.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      picker.files = dt.files;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
      return { started: true, files: picker.files?.length || 0 };
    })()`);
    console.log("upload started", started);

    let last = null;
    for (let i = 0; i < 80; i += 1) {
      await sleep(500);
      last = await session.evaluate(`(() => {
        const rows = [...document.querySelectorAll('[data-heige-role="user-theme-row"]')].map((row) => ({
          id: row.dataset.heigeThemeId,
          hasDelete: !!row.querySelector('[data-heige-role="user-theme-delete"]'),
        }));
        const legacy = document.querySelector('[data-heige-theme-id="custom-upload"]');
        const save = document.querySelector('[data-heige-role="save-state"]');
        const alert = document.querySelector('[data-heige-role="upload-alert"]');
        const status = window.__heigeCodexSkinRuntime?.status?.() || null;
        return {
          themeId: document.documentElement.dataset.heigeCodexSkin || null,
          rows,
          hasLegacy: !!legacy,
          saveState: save?.dataset?.state || null,
          saveText: save?.textContent || null,
          alert: alert?.textContent || null,
          pending: status?.controlRequest?.action || null,
          themePending: status?.themeTransitionPending || false,
        };
      })()`);
      if (i % 4 === 0 || last.saveState === "saved" || last.saveState === "error") {
        console.log("poll", i, JSON.stringify(last));
      }
      const formal = last.rows.find((r) => r.id && r.id !== "custom-upload" && r.hasDelete);
      if (formal && last.saveState === "saved" && !last.hasLegacy) {
        console.log("PASS formal row", formal.id);
        let onDisk = await readdir(THEMES).catch(() => []);
        console.log("themes dir", onDisk);
        if (!onDisk.includes(formal.id)) {
          await sleep(2500);
          onDisk = await readdir(THEMES).catch(() => []);
          console.log("themes dir retry", onDisk);
        }
        if (!onDisk.includes(formal.id)) {
          throw new Error("formal theme card appeared but disk themes/" + formal.id + " missing");
        }
        const themeJson = await readFile(join(THEMES, formal.id, "theme.json"), "utf8").catch(() => null);
        console.log("theme.json present", !!themeJson);
        return;
      }
      if (last.saveState === "error") {
        throw new Error("upload ended in error: " + JSON.stringify(last));
      }
    }
    throw new Error("timeout waiting for formal user theme row: " + JSON.stringify(last));
  } finally {
    try { session.close(); } catch {}
  }
}

await main();
