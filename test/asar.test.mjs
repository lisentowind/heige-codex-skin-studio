import assert from "node:assert/strict";
import test from "node:test";

import {
  readArchiveIndex,
  readEntry,
  replaceEntriesFixedSize,
  replaceEntryFixedSize,
} from "../src/asar.mjs";

function makeArchiveEntries(entries) {
  const header = { files: {} };
  const payloads = [];
  let offset = 0;

  for (const [path, content] of entries) {
    const parts = path.split("/");
    const leaf = parts.pop();
    let cursor = header;
    for (const part of parts) {
      cursor.files[part] ??= { files: {} };
      cursor = cursor.files[part];
    }
    const payload = Buffer.from(content);
    cursor.files[leaf] = { size: payload.length, offset: String(offset) };
    payloads.push(payload);
    offset += payload.length;
  }

  const json = Buffer.from(JSON.stringify(header));
  const padding = (4 - (json.length % 4)) % 4;
  const headerSize = 8 + json.length + padding;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(headerSize - 4, 8);
  prefix.writeUInt32LE(json.length, 12);

  return Buffer.concat([prefix, json, Buffer.alloc(padding), ...payloads]);
}

function makeArchive(path, content) {
  return makeArchiveEntries([[path, content]]);
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

test("applies a validated replacement set without mutating the source archive", () => {
  const archive = makeArchiveEntries([
    ["webview/index.html", "hello"],
    ["webview/assets/hero.png", "image"],
  ]);
  const patched = replaceEntriesFixedSize(archive, [
    { entryPath: "webview/index.html", replacement: Buffer.from("miku!") },
    { entryPath: "webview/assets/hero.png", replacement: Buffer.from("art!!") },
  ]);

  assert.equal(readEntry(patched, "webview/index.html").toString(), "miku!");
  assert.equal(readEntry(patched, "webview/assets/hero.png").toString(), "art!!");
  assert.equal(readEntry(archive, "webview/index.html").toString(), "hello");
  assert.equal(readEntry(archive, "webview/assets/hero.png").toString(), "image");
});

test("rejects the full replacement set before copying when one entry is invalid", () => {
  const archive = makeArchive("webview/index.html", "hello");
  assert.throws(
    () =>
      replaceEntriesFixedSize(archive, [
        { entryPath: "webview/index.html", replacement: Buffer.from("miku!") },
        { entryPath: "webview/missing.png", replacement: Buffer.from("nope") },
      ]),
    /not found/,
  );
  assert.equal(readEntry(archive, "webview/index.html").toString(), "hello");
});
