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
