import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  copyFile,
  mkdir,
  open,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findEntry, readEntry } from "./asar.mjs";

const ENTRY_PATH = "webview/index.html";
const DEFAULT_ASAR = "/Applications/ChatGPT.app/Contents/Resources/app.asar";
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const THEME_PATH = join(PROJECT_ROOT, "src", "theme.css");
const STATE_DIR = join(homedir(), "Library", "Application Support", "Codex Miku Theme");
const STATE_PATH = join(STATE_DIR, "state.json");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildPatchedHtml(originalHtml, themeCss) {
  if (originalHtml.includes("CODEX_MIKU_THEME")) {
    return originalHtml;
  }

  const openTag = originalHtml.indexOf("<style>");
  const contentStart = openTag < 0 ? -1 : openTag + "<style>".length;
  const contentEnd = contentStart < 0 ? -1 : originalHtml.indexOf("</style>", contentStart);

  if (contentStart < 0 || contentEnd < 0) {
    throw new Error("Codex inline style block not found");
  }

  const originalCss = originalHtml.slice(contentStart, contentEnd);
  const nextCss = `\n${themeCss.trim()}\n`;
  const capacity = Buffer.byteLength(originalCss);
  const required = Buffer.byteLength(nextCss);

  if (required > capacity) {
    throw new Error(`Theme exceeds inline style capacity: ${required} > ${capacity} bytes`);
  }

  const paddedCss = nextCss + " ".repeat(capacity - required);
  const patched = originalHtml.slice(0, contentStart) + paddedCss + originalHtml.slice(contentEnd);

  if (Buffer.byteLength(patched) !== Buffer.byteLength(originalHtml)) {
    throw new Error("Patched HTML byte length changed unexpectedly");
  }

  return patched;
}

async function loadContext(asarPath) {
  const [archive, themeCss] = await Promise.all([
    readFile(asarPath),
    readFile(THEME_PATH, "utf8"),
  ]);
  const entry = findEntry(archive, ENTRY_PATH);
  const originalHtml = readEntry(archive, ENTRY_PATH).toString("utf8");
  const styleStart = originalHtml.indexOf("<style>") + "<style>".length;
  const styleEnd = originalHtml.indexOf("</style>", styleStart);

  if (styleStart < "<style>".length || styleEnd < 0) {
    throw new Error("Codex inline style block not found");
  }

  return {
    archive,
    entry,
    originalHtml,
    styleCapacity: Buffer.byteLength(originalHtml.slice(styleStart, styleEnd)),
    themeCss,
  };
}

async function writeEntryInPlace(asarPath, entry, content) {
  const bytes = Buffer.from(content);
  if (bytes.length !== entry.size) {
    throw new Error(`Refusing write: expected ${entry.size} bytes, received ${bytes.length}`);
  }

  const handle = await open(asarPath, "r+");
  try {
    const result = await handle.write(bytes, 0, bytes.length, entry.start);
    if (result.bytesWritten !== bytes.length) {
      throw new Error(`Short write: ${result.bytesWritten} of ${bytes.length} bytes`);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function check(asarPath) {
  const context = await loadContext(asarPath);
  const result = {
    appAsar: asarPath,
    archiveBytes: context.archive.length,
    entryBytes: context.entry.size,
    installed: context.originalHtml.includes("CODEX_MIKU_THEME"),
    styleCapacity: context.styleCapacity,
    themeBytes: Buffer.byteLength(context.themeCss.trim()) + 2,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function install(asarPath) {
  const context = await loadContext(asarPath);
  if (context.originalHtml.includes("CODEX_MIKU_THEME")) {
    console.log("Codex Miku theme is already installed.");
    return;
  }

  const patchedHtml = buildPatchedHtml(context.originalHtml, context.themeCss);
  const archiveHash = digest(context.archive);
  const backupDir = join(STATE_DIR, "backups");
  const backupPath = join(backupDir, `${archiveHash}.asar`);

  await mkdir(backupDir, { recursive: true });
  await copyFile(asarPath, backupPath, fsConstants.COPYFILE_FICLONE);
  const backupInfo = await stat(backupPath);
  if (backupInfo.size !== context.archive.length) {
    throw new Error("Backup verification failed: file size mismatch");
  }

  await writeEntryInPlace(asarPath, context.entry, patchedHtml);
  const verified = await loadContext(asarPath);
  if (!verified.originalHtml.includes("CODEX_MIKU_THEME")) {
    throw new Error("Theme verification failed after write");
  }

  const state = {
    appAsar: asarPath,
    archiveBytes: context.archive.length,
    backupPath,
    installedAt: new Date().toISOString(),
    originalArchiveSha256: archiveHash,
    originalEntrySha256: digest(Buffer.from(context.originalHtml)),
    themedEntrySha256: digest(Buffer.from(patchedHtml)),
  };
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(state, null, 2));
}

async function restore(asarPath) {
  const state = JSON.parse(await readFile(STATE_PATH, "utf8"));
  if (state.appAsar !== asarPath) {
    throw new Error(`Backup belongs to a different ASAR: ${state.appAsar}`);
  }

  const [current, backup] = await Promise.all([readFile(asarPath), readFile(state.backupPath)]);
  if (current.length !== state.archiveBytes || backup.length !== state.archiveBytes) {
    throw new Error("Refusing restore after an app update changed the archive size");
  }
  if (digest(backup) !== state.originalArchiveSha256) {
    throw new Error("Backup verification failed: SHA-256 mismatch");
  }

  const currentHtml = readEntry(current, ENTRY_PATH);
  if (!currentHtml.toString("utf8").includes("CODEX_MIKU_THEME")) {
    console.log("Codex Miku theme is not installed; nothing to restore.");
    return;
  }

  const entry = findEntry(current, ENTRY_PATH);
  const originalHtml = readEntry(backup, ENTRY_PATH);
  await writeEntryInPlace(asarPath, entry, originalHtml);
  console.log(`Restored original Codex theme from ${state.backupPath}`);
}

async function main() {
  const [command = "check", asarPath = DEFAULT_ASAR] = process.argv.slice(2);
  if (command === "check") return check(asarPath);
  if (command === "install") return install(asarPath);
  if (command === "restore") return restore(asarPath);
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Codex Miku theme: ${error.message}`);
    process.exitCode = 1;
  });
}
