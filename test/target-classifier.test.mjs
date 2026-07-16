import assert from "node:assert/strict";
import test from "node:test";

import { classifyCodexTarget, classifyCodexTargets } from "../src/target-classifier.mjs";

function target(url, overrides = {}) {
  return {
    id: "target",
    type: "page",
    url,
    webSocketDebuggerUrl: "ws://127.0.0.1:9341/devtools/page/target",
    ...overrides,
  };
}

test("recognizes only the observed Codex main and avatar overlay URLs", () => {
  assert.equal(classifyCodexTarget(target("app://-/index.html")), "main");
  assert.equal(
    classifyCodexTarget(target("app://-/index.html?initialRoute=%2Favatar-overlay")),
    "overlay",
  );
  for (const candidate of [
    target("app://evil/index.html"),
    target("app://-/settings.html"),
    target("app://-/index.html?initialRoute=%2Fsettings"),
    target("app://-/index.html?initialRoute=%2Favatar-overlay&extra=1"),
    target("app://-/index.html#fragment"),
    target("file:///Users/example/report.html"),
    target("http://127.0.0.1:5175/"),
    target("app://-/index.html", { type: "worker" }),
    null,
  ]) {
    assert.equal(classifyCodexTarget(candidate), "unknown");
  }
});

test("classifies without mutating and preserves deterministic input order", () => {
  const inputs = [
    target("file:///tmp/report.html", { id: "unknown" }),
    target("app://-/index.html", { id: "main" }),
    target("app://-/index.html?initialRoute=%2Favatar-overlay", { id: "overlay" }),
  ];
  const before = structuredClone(inputs);
  const result = classifyCodexTargets(inputs);
  assert.deepEqual(result.map(({ id, kind }) => ({ id, kind })), [
    { id: "unknown", kind: "unknown" },
    { id: "main", kind: "main" },
    { id: "overlay", kind: "overlay" },
  ]);
  assert.deepEqual(inputs, before);
  assert.throws(() => classifyCodexTargets(null), /数组/);
});
