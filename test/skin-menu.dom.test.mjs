import assert from "node:assert/strict";
import test from "node:test";

import {
  deferredResponse,
  errorResponse,
  menuWindow,
  okResponse,
  sequenceFetch,
} from "./helpers/menu-window.mjs";

test("switch exposes accessible state and permanent re-enable guidance", async (t) => {
  const page = await menuWindow({ persistenceEnabled: true, revision: 7 });
  t.after(() => page.close());
  assert.equal(page.switch.getAttribute("role"), "switch");
  assert.equal(page.switch.getAttribute("tabindex"), "0");
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
  assert.match(page.document.body.textContent, /关闭后本次继续使用；下次启动恢复原生界面/);
  assert.match(page.document.body.textContent, /HeiGe 皮肤启动器/);
  assert.match(page.document.body.textContent, /启用 HeiGe 皮肤/);
});

test("off is painted only after the controller ACK", async (t) => {
  const pending = deferredResponse();
  const page = await menuWindow({ fetch: () => pending.promise });
  t.after(() => page.close());
  await page.clickPersistenceSwitch();
  assert.equal(page.confirmation.hidden, false);
  await page.clickConfirmOff();
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
  assert.equal(page.switch.getAttribute("aria-busy"), "true");
  pending.resolve(okResponse({ persistenceEnabled: false, revision: 8 }));
  await page.flush();
  assert.equal(page.switch.getAttribute("aria-checked"), "false");
  assert.equal(page.switch.getAttribute("aria-busy"), "false");
});

test("cancel keeps persistence on without contacting the controller", async (t) => {
  let calls = 0;
  const page = await menuWindow({ fetch: async () => { calls += 1; } });
  t.after(() => page.close());
  await page.clickPersistenceSwitch();
  await page.clickCancelOff();
  assert.equal(page.confirmation.hidden, true);
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
  assert.equal(calls, 0);
});

test("network failure rolls back and shows a safe real error", async (t) => {
  const page = await menuWindow({ fetch: async () => { throw new Error("控制器不可用"); } });
  t.after(() => page.close());
  await page.disablePersistence();
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
  assert.match(page.alert.textContent, /控制器不可用/);
  assert.equal(page.alert.getAttribute("role"), "alert");
});

test("a compensated enable failure syncs revision without painting on", async (t) => {
  const requests = [];
  const page = await menuWindow({
    persistenceEnabled: false,
    revision: 3,
    fetch: sequenceFetch([
      errorResponse(503, {
        code: "BACKGROUND_START_FAILED",
        message: "后台控制器启动失败，常驻仍为关闭",
        persistenceEnabled: false,
        revision: 5,
      }),
      okResponse({ persistenceEnabled: true, revision: 6 }),
    ], requests),
  });
  t.after(() => page.close());
  await page.enablePersistence();
  assert.equal(page.switch.getAttribute("aria-checked"), "false");
  assert.equal(page.controlRevision, 5);
  assert.match(page.alert.textContent, /后台控制器启动失败/);
  await page.enablePersistence();
  assert.equal(requests[1].revision, 5);
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
});

test("malformed and mismatched ACKs never change the painted state", async (t) => {
  for (const response of [
    okResponse({ persistenceEnabled: true, revision: 8 }),
    okResponse({ persistenceEnabled: false, revision: 7 }),
    { ok: true, status: 200, async json() { return { ok: true, persistenceEnabled: false, revision: "8" }; } },
  ]) {
    const page = await menuWindow({ fetch: async () => response });
    t.after(() => page.close());
    await page.disablePersistence();
    assert.equal(page.switch.getAttribute("aria-checked"), "true");
    assert.match(page.alert.textContent, /响应无效/);
  }
});

test("Enter and Space operate the switch while repeated pending input is ignored", async (t) => {
  const pending = deferredResponse();
  let calls = 0;
  const page = await menuWindow({
    persistenceEnabled: false,
    fetch: () => { calls += 1; return pending.promise; },
  });
  t.after(() => page.close());
  await page.keyPersistenceSwitch("Enter");
  await page.keyPersistenceSwitch(" ");
  assert.equal(calls, 1);
  assert.equal(page.switch.getAttribute("aria-checked"), "false");
  pending.resolve(okResponse({ persistenceEnabled: true, revision: 8 }));
  await page.flush();
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
});

test("persistence state and token are never written to localStorage", async (t) => {
  const page = await menuWindow({ persistenceEnabled: false, revision: 2 });
  t.after(() => page.close());
  await page.enablePersistence();
  const entries = Array.from({ length: page.window.localStorage.length }, (_, index) => {
    const key = page.window.localStorage.key(index);
    return [key, page.window.localStorage.getItem(key)];
  });
  assert.equal(entries.some(([key, value]) => /persist|token|control/i.test(`${key}:${value}`)), false);
  const controlToken = Buffer.alloc(32, 7).toString("base64url");
  assert.equal(entries.some(([, value]) => value.includes(controlToken)), false);
});

test("reinjection disposes the previous generation and invalidates its API", async (t) => {
  const page = await menuWindow();
  t.after(() => page.close());
  const firstRuntime = page.window.__heigeCodexSkinRuntime;
  const firstApi = page.window.__heigeCodexSkin;
  const secondRuntime = await page.injectAgain();
  assert.equal(firstRuntime.signal.aborted, true);
  assert.equal(firstRuntime.channel.closed, true);
  assert.notEqual(secondRuntime.generation, firstRuntime.generation);
  assert.throws(() => firstApi.setTheme("miku-488137"), /disposed/i);
  assert.equal(page.document.querySelectorAll("#heige-codex-skin-menu").length, 1);
});

test("runtime disposal is idempotent and removes only its owned globals and DOM", async (t) => {
  const page = await menuWindow();
  t.after(() => page.close());
  const runtime = page.window.__heigeCodexSkinRuntime;
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.equal(runtime.signal.aborted, true);
  assert.equal(runtime.channel.closed, true);
  assert.equal(page.document.getElementById("heige-codex-skin-menu"), null);
  assert.equal(page.document.getElementById("heige-codex-skin-style"), null);
  assert.equal(page.window.__heigeCodexSkin, undefined);
  assert.equal(page.window.__heigeCodexSkinRuntime, undefined);
});

test("a stale persistence response cannot mutate the new generation", async (t) => {
  const pending = deferredResponse();
  const page = await menuWindow({ fetch: () => pending.promise });
  t.after(() => page.close());
  await page.clickPersistenceSwitch();
  await page.clickConfirmOff();
  const firstRuntime = page.window.__heigeCodexSkinRuntime;
  await page.injectAgain();
  pending.resolve(okResponse({ persistenceEnabled: false, revision: 8 }));
  await page.flush();
  assert.equal(firstRuntime.signal.aborted, true);
  assert.deepEqual(JSON.parse(JSON.stringify(page.window.__heigeCodexSkinRuntime.status())), {
    generation: page.window.__heigeCodexSkinRuntime.generation,
    themeId: "miku-488137",
    menu: true,
    mode: "active",
    persistenceEnabled: true,
    revision: 7,
  });
  assert.equal(page.switch.getAttribute("aria-checked"), "true");
  assert.equal(page.alert.hidden, true);
});

test("a stale Image callback rejects and cannot overwrite the new generation", async (t) => {
  const page = await menuWindow();
  t.after(() => page.close());
  const images = [];
  page.window.Image = class DelayedImage {
    constructor() {
      this.width = 80;
      this.height = 40;
      this.onload = null;
      this.onerror = null;
      this.src = "";
      images.push(this);
    }
  };
  const oldApi = page.window.__heigeCodexSkin;
  const imported = oldApi.importFromDataUrl("data:image/png;base64,old", "old");
  const rejected = assert.rejects(imported, (error) => error.name === "AbortError" && /disposed/i.test(error.message));
  const staleOnload = images[0].onload;
  await page.injectAgain();
  staleOnload();
  await rejected;
  assert.equal(page.document.documentElement.dataset.heigeCodexSkin, "miku-488137");
  assert.equal(page.window.localStorage.getItem("heigeCodexCustomTheme"), null);
});

test("dispose aborts an active FileReader and its stale callback becomes inert", async (t) => {
  const page = await menuWindow();
  t.after(() => page.close());
  let reader;
  page.window.FileReader = class DelayedReader {
    constructor() {
      reader = this;
      this.result = "data:image/png;base64,old";
      this.abortCalls = 0;
    }
    readAsDataURL() {}
    abort() { this.abortCalls += 1; }
  };
  const picker = page.document.querySelector('input[type="file"]');
  Object.defineProperty(picker, "files", {
    configurable: true,
    value: [{ name: "old.png" }],
  });
  picker.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  const staleOnload = reader.onload;
  await page.injectAgain();
  assert.equal(reader.abortCalls, 1);
  staleOnload();
  await page.flush();
  assert.equal(page.document.documentElement.dataset.heigeCodexSkin, "miku-488137");
  assert.equal(page.window.localStorage.getItem("heigeCodexCustomTheme"), null);
});
