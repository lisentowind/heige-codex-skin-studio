import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, sep } from "node:path";

function requireCanonicalAbsolute(path) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    path.includes("\0") ||
    normalize(path) !== path
  ) {
    throw new TypeError("macOS 状态目录必须是规范绝对路径");
  }
  return path;
}

function ancestorPaths(path) {
  const root = parse(path).root;
  const components = path.slice(root.length).split(sep).filter(Boolean);
  const result = [];
  let current = root;
  for (const component of components) {
    current = join(current, component);
    result.push(current);
  }
  return result;
}

async function verifyAncestors(path, inspect) {
  for (const current of ancestorPaths(path)) {
    const metadata = await inspect(current, { bigint: true });
    if (metadata.isSymbolicLink()) {
      throw new Error(`macOS 状态目录祖先不得是符号链接：${current}`);
    }
    if (!metadata.isDirectory()) {
      throw new Error(`macOS 状态目录祖先必须是真实目录：${current}`);
    }
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function ensureMacosStateRoot(stateRoot, dependencies = {}) {
  stateRoot = requireCanonicalAbsolute(stateRoot);
  const inspect = dependencies.lstat ?? lstat;
  const create = dependencies.mkdir ?? mkdir;
  const openPath = dependencies.open ?? open;
  const getuid = dependencies.getuid ?? process.getuid;
  if (![inspect, create, openPath, getuid].every((value) => typeof value === "function")) {
    throw new TypeError("macOS 状态目录依赖必须是函数");
  }

  await verifyAncestors(dirname(stateRoot), inspect);
  let created = false;
  let before;
  try {
    before = await inspect(stateRoot, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await create(stateRoot, { mode: 0o700 });
      created = true;
    } catch (createError) {
      if (createError?.code !== "EEXIST") throw createError;
    }
    before = await inspect(stateRoot, { bigint: true });
  }
  if (before.isSymbolicLink()) throw new Error("macOS 状态目录不得是符号链接");
  if (!before.isDirectory()) throw new Error("macOS 状态目录必须是真实目录");

  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await openPath(stateRoot, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || !sameFile(before, opened)) {
      throw new Error("macOS 状态目录在安全检查期间发生变化");
    }
    const uid = getuid();
    if (!Number.isSafeInteger(uid) || uid < 0 || opened.uid !== BigInt(uid)) {
      throw new Error("macOS 状态目录不属于当前用户");
    }
    const permissionsTightened = (Number(opened.mode) & 0o777) !== 0o700;
    if (permissionsTightened) await handle.chmod(0o700);
    const verified = await handle.stat({ bigint: true });
    if (
      !verified.isDirectory() ||
      !sameFile(opened, verified) ||
      verified.uid !== BigInt(uid) ||
      (Number(verified.mode) & 0o777) !== 0o700
    ) {
      throw new Error("macOS 状态目录未能确认权限为 0700");
    }
    return { created, permissionsTightened };
  } finally {
    await handle.close();
  }
}
