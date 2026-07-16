import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applySkin, removeSkin, skinStatus } from "../src/injector.mjs";

class FakeSession {
  static expressions = [];
  constructor() { this.closed = false; }
  async open() { return this; }
  async evaluate(expression) {
    FakeSession.expressions.push(expression);
    if (expression.includes("installed:")) return { installed: true, themeId: "demo" };
    return true;
  }
  close() { this.closed = true; }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "heige-injector-"));
  await writeFile(join(root, "hero.png"), Buffer.from([137, 80, 78, 71]));
  return {
    loaded: {
      root,
      heroPath: join(root, "hero.png"),
      manifest: {
        id: "demo",
        name: "Demo",
        colors: { accent: "#19C9E5", secondary: "#ED6EC1", surface: "#F5F6FC", text: "#122C60" },
        copy: null,
      },
    },
    deps: {
      waitForRendererTargets: async () => [{ id: "one", webSocketDebuggerUrl: "ws://127.0.0.1:9341/devtools/page/one" }],
      fetchRendererTargets: async () => [{ id: "one", webSocketDebuggerUrl: "ws://127.0.0.1:9341/devtools/page/one" }],
      Session: FakeSession,
    },
  };
}

test("applies a single style to every Codex renderer and closes sessions", async () => {
  FakeSession.expressions = [];
  const { loaded, deps } = await fixture();
  const result = await applySkin({ loadedTheme: loaded, port: 9341, deps });
  assert.equal(result.applied, 1);
  assert.match(FakeSession.expressions[0], /heige-codex-skin-style/);
  assert.match(FakeSession.expressions[0], /data:image\/png;base64/);
});

test("removes and checks the live style without persistent machinery", async () => {
  FakeSession.expressions = [];
  const { deps } = await fixture();
  assert.equal((await removeSkin({ port: 9341, deps })).removed, 1);
  assert.deepEqual(await skinStatus({ port: 9341, deps }), [{ installed: true, themeId: "demo" }]);
  assert.match(FakeSession.expressions[0], /remove\(\)/);
});
