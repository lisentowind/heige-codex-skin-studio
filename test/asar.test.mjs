import assert from "node:assert/strict";
import test from "node:test";

import {
  readArchiveIndex,
  readEntry,
  replaceEntryFixedSize,
} from "../src/asar.mjs";

function makeArchive(path, content) {
  const parts = path.split("/");
  const leaf = parts.pop();
  const header = { files: {} };
  let cursor = header;

  for (const part of parts) {
    cursor.files[part] = { files: {} };
    cursor = cursor.files[part];
  }

  const payload = Buffer.from(content);
  cursor.files[leaf] = { size: payload.length, offset: "0" };

  const json = Buffer.from(JSON.stringify(header));
  const padding = (4 - (json.length % 4)) % 4;
  const headerSize = 8 + json.length + padding;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(headerSize - 4, 8);
  prefix.writeUInt32LE(json.length, 12);

  return Buffer.concat([prefix, json, Buffer.alloc(padding), payload]);
}

test("parses the ASAR header and data offset", () => {
  const archive = makeArchive("webview/index.html", "hello");
  const index = readArchiveIndex(archive);

  assert.equal(index.dataOffset, archive.length - 5);
  assert.equal(index.header.files.webview.files["index.html"].size, 5);
});

test("reads a nested archive entry", () => {
  const archive = makeArchive("webview/index.html", "hello");
  assert.equal(readEntry(archive, "webview/index.html").toString(), "hello");
});

test("replaces an entry without changing archive length", () => {
  const archive = makeArchive("webview/index.html", "hello");
  const patched = replaceEntryFixedSize(
    archive,
    "webview/index.html",
    Buffer.from("miku!"),
  );

  assert.equal(patched.length, archive.length);
  assert.equal(readEntry(patched, "webview/index.html").toString(), "miku!");
  assert.equal(readEntry(archive, "webview/index.html").toString(), "hello");
});

test("rejects replacements with a different byte length", () => {
  const archive = makeArchive("webview/index.html", "hello");

  assert.throws(
    () =>
      replaceEntryFixedSize(
        archive,
        "webview/index.html",
        Buffer.from("too long"),
      ),
    /exactly 5 bytes/,
  );
});

test("rejects missing paths", () => {
  const archive = makeArchive("webview/index.html", "hello");
  assert.throws(() => readEntry(archive, "missing.txt"), /not found/);
});
