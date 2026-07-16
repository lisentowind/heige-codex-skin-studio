import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSingleImageTheme, listThemes } from "../src/theme-store.mjs";

function png(width, height, bytes = 24) {
  const result = Buffer.alloc(Math.max(bytes, 24));
  Buffer.from("89504e470d0a1a0a", "hex").copy(result, 0);
  result.writeUInt32BE(13, 8);
  result.write("IHDR", 12, "ascii");
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

test("creates a theme from one local image without a build pipeline", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-theme-"));
  const image = join(root, "source.png");
  await writeFile(image, png(640, 360));

  const created = await createSingleImageTheme({
    imagePath: image,
    name: "My Fast Skin",
    storeRoot: join(root, "themes"),
  });

  assert.match(created.id, /^my-fast-skin-/);
  assert.equal(created.manifest.hero, "hero.png");
  assert.deepEqual(JSON.parse(await readFile(join(created.path, "theme.json"), "utf8")), created.manifest);
  assert.deepEqual((await listThemes({ roots: [join(root, "themes")] })).map((item) => item.id), [created.id]);
});

test("rejects unsupported source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-theme-"));
  const image = join(root, "source.gif");
  await writeFile(image, "gif");

  await assert.rejects(
    () => createSingleImageTheme({ imagePath: image, name: "No", storeRoot: join(root, "themes") }),
    /PNG、JPG、JPEG 或 WebP/,
  );
});

test("listThemes skips well-formed JSON with a bad shape instead of crashing", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-badshape-"));
  await mkdir(join(root, "good"));
  await writeFile(join(root, "good", "theme.json"), JSON.stringify({ id: "good", name: "Good" }));
  await mkdir(join(root, "noname"));
  await writeFile(join(root, "noname", "theme.json"), JSON.stringify({ id: "noname" }));
  await mkdir(join(root, "nullname"));
  await writeFile(join(root, "nullname", "theme.json"), JSON.stringify({ id: "x", name: null }));

  const themes = await listThemes({ roots: [root] });
  assert.deepEqual(themes.map((t) => t.name), ["Good"]);
});

test("createSingleImageTheme rejects oversized source images", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-bigimg-"));
  const big = join(root, "big.png");
  await writeFile(big, png(640, 360, 9 * 1024 * 1024));
  await assert.rejects(
    createSingleImageTheme({ imagePath: big, name: "Big", storeRoot: join(root, "store") }),
    /过大/,
  );
});

test("createSingleImageTheme validates magic MIME and dimensions before publishing", async () => {
  const root = await mkdtemp(join(tmpdir(), "heige-invalid-source-"));
  const storeRoot = join(root, "store");
  const mismatch = join(root, "mismatch.png");
  await writeFile(mismatch, Buffer.from("not-a-png"));
  await assert.rejects(
    createSingleImageTheme({ imagePath: mismatch, name: "Mismatch", storeRoot }),
    /PNG|图片|header/i,
  );

  const bomb = join(root, "bomb.png");
  await writeFile(bomb, png(8000, 8000));
  await assert.rejects(
    createSingleImageTheme({ imagePath: bomb, name: "Bomb", storeRoot }),
    /像素|pixel/i,
  );
});
