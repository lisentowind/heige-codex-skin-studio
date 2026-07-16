import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { validateImageMetadata } from "./image-metadata.mjs";
import { parseBoundedJson, readBoundedFile, RESOURCE_LIMITS } from "./resource-limits.mjs";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
// 单张源图上限：base64 后要内联进一条 CDP Runtime.evaluate，过大易触发 5 秒命令超时
const MAX_SOURCE_IMAGE_BYTES = RESOURCE_LIMITS.assetBytes;
const IMAGE_MIME = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "custom-skin";
}

export async function createSingleImageTheme({ imagePath, name, storeRoot, colors = {} }) {
  const extension = extname(imagePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("素材必须是 PNG、JPG、JPEG 或 WebP 图片");
  }
  let sourceBytes;
  let source;
  try {
    ({ bytes: sourceBytes, stat: source } = await readBoundedFile(imagePath, {
      maxBytes: MAX_SOURCE_IMAGE_BYTES,
      label: "素材图片",
    }));
  } catch (error) {
    if (/8388608|超过/.test(error?.message ?? "")) {
      throw new Error("素材图片过大（上限 8MB），请先压缩后再做主题，否则注入会超时");
    }
    throw error;
  }
  validateImageMetadata(sourceBytes, { expectedMime: IMAGE_MIME.get(extension) });

  const digest = createHash("sha256")
    .update(`${name}\0${basename(imagePath)}\0${source.size}\0${source.mtimeMs}`)
    .digest("hex")
    .slice(0, 8);
  const id = `${slugify(name)}-${digest}`;
  const destination = join(storeRoot, id);
  const temporary = `${destination}.tmp-${process.pid}`;
  const hero = `hero${extension}`;
  const manifest = {
    schemaVersion: 1,
    id,
    name,
    hero,
    colors: {
      accent: colors.accent ?? "#24c9d7",
      secondary: colors.secondary ?? "#ef8fd3",
      surface: colors.surface ?? "#f7fbff",
      text: colors.text ?? "#17344f",
    },
    copy: null,
  };

  await mkdir(storeRoot, { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    await writeFile(join(temporary, hero), sourceBytes);
    await writeFile(join(temporary, "theme.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { id, path: destination, manifest };
}

export async function listThemes({ roots }) {
  const themes = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const { bytes } = await readBoundedFile(join(root, entry.name, "theme.json"), {
          maxBytes: RESOURCE_LIMITS.manifestBytes,
          label: "theme.json",
        });
        const manifest = parseBoundedJson(bytes);
        // 形状守卫：合法 JSON 但缺 name/id 的坏主题不能进列表，
        // 否则后面 sort 的 a.name.localeCompare 会因 undefined 崩掉整个 list/apply
        if (typeof manifest?.id !== "string" || typeof manifest?.name !== "string") continue;
        themes.push({ ...manifest, path: join(root, entry.name) });
      } catch {
        // A half-copied folder is ignored so listing remains fast and useful.
      }
    }
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name));
}
