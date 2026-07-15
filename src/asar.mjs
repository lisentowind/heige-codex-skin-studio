const UINT32_BYTES = 4;
const HEADER_PREFIX_BYTES = 16;

export function readArchiveIndex(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < HEADER_PREFIX_BYTES) {
    throw new Error("Invalid ASAR archive: header is missing");
  }

  const headerSize = archive.readUInt32LE(UINT32_BYTES);
  const jsonSize = archive.readUInt32LE(UINT32_BYTES * 3);
  const dataOffset = UINT32_BYTES * 2 + headerSize;

  if (
    jsonSize <= 0 ||
    HEADER_PREFIX_BYTES + jsonSize > archive.length ||
    dataOffset > archive.length
  ) {
    throw new Error("Invalid ASAR archive: header sizes are out of bounds");
  }

  let header;
  try {
    header = JSON.parse(
      archive.subarray(HEADER_PREFIX_BYTES, HEADER_PREFIX_BYTES + jsonSize).toString("utf8"),
    );
  } catch (error) {
    throw new Error(`Invalid ASAR archive: ${error.message}`);
  }

  return { dataOffset, header };
}

export function findEntry(archive, entryPath) {
  const index = readArchiveIndex(archive);
  let node = index.header;

  for (const segment of entryPath.split("/").filter(Boolean)) {
    node = node.files?.[segment];
    if (!node) {
      throw new Error(`ASAR entry not found: ${entryPath}`);
    }
  }

  if (!Number.isInteger(node.size) || node.offset === undefined) {
    throw new Error(`ASAR entry is not a regular file: ${entryPath}`);
  }

  const start = index.dataOffset + Number(node.offset);
  const end = start + node.size;
  if (!Number.isSafeInteger(start) || end > archive.length) {
    throw new Error(`ASAR entry is out of bounds: ${entryPath}`);
  }

  return { end, size: node.size, start };
}

export function readEntry(archive, entryPath) {
  const entry = findEntry(archive, entryPath);
  return Buffer.from(archive.subarray(entry.start, entry.end));
}

export function replaceEntryFixedSize(archive, entryPath, replacement) {
  const entry = findEntry(archive, entryPath);
  const bytes = Buffer.from(replacement);

  if (bytes.length !== entry.size) {
    throw new Error(
      `Replacement for ${entryPath} must be exactly ${entry.size} bytes; received ${bytes.length}`,
    );
  }

  const patched = Buffer.from(archive);
  bytes.copy(patched, entry.start);
  return patched;
}
