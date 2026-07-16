#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const summaryPath = join(root, "llms.txt");
const readmePath = join(root, "README.md");
const outputPath = join(root, "llms-full.txt");

export const LLMS_README_SEPARATOR = "\n---\n\n# Canonical README\n\n";

export function renderLlmsFull(summary, readme) {
  if (typeof summary !== "string" || typeof readme !== "string") {
    throw new TypeError("llms summary 与 README 必须是字符串");
  }
  return `${summary}${LLMS_README_SEPARATOR}${readme}`;
}
async function expectedOutput() {
  const [summary, readme] = await Promise.all([
    readFile(summaryPath, "utf8"),
    readFile(readmePath, "utf8"),
  ]);
  return renderLlmsFull(summary, readme);
}

async function writeAtomic(path, contents) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o644 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function syncLlms({ check = false } = {}) {
  const expected = await expectedOutput();
  if (check) {
    let actual;
    try {
      actual = await readFile(outputPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      throw new Error("llms-full.txt 不存在，请运行 node scripts/sync-llms.mjs");
    }
    if (actual !== expected) {
      throw new Error("llms-full.txt 与 llms.txt + README.md 不一致，请运行 node scripts/sync-llms.mjs");
    }
    return outputPath;
  }
  await writeAtomic(outputPath, expected);
  return outputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
    console.error("用法：node scripts/sync-llms.mjs [--check]");
    process.exitCode = 64;
  } else {
    syncLlms({ check: args[0] === "--check" })
      .then((path) => console.log(args[0] === "--check" ? `同步校验通过：${path}` : `已同步：${path}`))
      .catch((error) => {
        console.error(error?.message ?? String(error));
        process.exitCode = 1;
      });
  }
}
