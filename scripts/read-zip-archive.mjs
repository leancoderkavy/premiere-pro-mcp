import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX_ZIP32_BYTES = 0xffff_ffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_MAXIMUM_COMPRESSION = 0x0002;
const ZIP_FLAG_FAST_COMPRESSION = 0x0004;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_FLAG_STRONG_ENCRYPTION = 0x0040;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_FLAG_CENTRAL_DIRECTORY_ENCRYPTION = 0x2000;
const ENCRYPTED_ENTRY_FLAGS = ZIP_FLAG_ENCRYPTED | ZIP_FLAG_STRONG_ENCRYPTION | ZIP_FLAG_CENTRAL_DIRECTORY_ENCRYPTION;
const SUPPORTED_GENERAL_PURPOSE_FLAGS = ZIP_FLAG_MAXIMUM_COMPRESSION | ZIP_FLAG_FAST_COMPRESSION | ZIP_FLAG_DATA_DESCRIPTOR | ZIP_FLAG_UTF8;
const ZIP_HOST_UNIX = 3;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_FILE_TYPE_DIRECTORY = 0o040000;
const UNIX_FILE_TYPE_REGULAR = 0o100000;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
  return value >>> 0;
});

function archiveError(message) {
  const error = new Error(message);
  error.code = "UXP_HYBRID_CCX_ARCHIVE_INVALID";
  return error;
}

function updateCrc32(value, buffer) {
  let crc32 = value;
  for (const byte of buffer) crc32 = (CRC32_TABLE[(crc32 ^ byte) & 0xff] ^ (crc32 >>> 8)) >>> 0;
  return crc32;
}

async function readExactly(handle, bytes, position, label) {
  const buffer = Buffer.alloc(bytes);
  const { bytesRead } = await handle.read(buffer, 0, bytes, position);
  if (bytesRead !== bytes) throw archiveError(`${label} is truncated`);
  return buffer;
}

function findEndOfCentralDirectory(tail, archiveBytes) {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentBytes = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentBytes !== tail.length) continue;
    const disk = tail.readUInt16LE(offset + 4);
    const directoryDisk = tail.readUInt16LE(offset + 6);
    const entriesOnDisk = tail.readUInt16LE(offset + 8);
    const entries = tail.readUInt16LE(offset + 10);
    const directoryBytes = tail.readUInt32LE(offset + 12);
    const directoryOffset = tail.readUInt32LE(offset + 16);
    if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entries) {
      throw archiveError("CCX archive must be a single-disk ZIP");
    }
    if (entries === 0xffff || directoryBytes === 0xffff_ffff || directoryOffset === 0xffff_ffff) {
      throw archiveError("CCX archive ZIP64 metadata is not supported by this bounded verifier");
    }
    if (entries > MAX_ENTRIES || directoryBytes > MAX_CENTRAL_DIRECTORY_BYTES) {
      throw archiveError("CCX archive central directory exceeds the verifier bounds");
    }
    const directoryEnd = directoryOffset + directoryBytes;
    const eocdPosition = archiveBytes - tail.length + offset;
    if (!Number.isSafeInteger(directoryEnd) || directoryEnd > eocdPosition) {
      throw archiveError("CCX archive central directory is outside the ZIP bounds");
    }
    return { entries, directoryBytes, directoryOffset };
  }
  throw archiveError("CCX archive must contain a conventional ZIP end record");
}

function readCentralDirectory(buffer, expectedEntries) {
  const entries = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw archiveError("CCX archive central directory entry is invalid");
    }
    const versionMadeBy = buffer.readUInt16LE(offset + 4);
    const versionNeeded = buffer.readUInt16LE(offset + 6);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc32 = buffer.readUInt32LE(offset + 16);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameBytes = buffer.readUInt16LE(offset + 28);
    const extraBytes = buffer.readUInt16LE(offset + 30);
    const commentBytes = buffer.readUInt16LE(offset + 32);
    const disk = buffer.readUInt16LE(offset + 34);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const next = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (next > buffer.length || disk !== 0) throw archiveError("CCX archive central directory entry is invalid");
    if (compressedBytes === MAX_ZIP32_BYTES || uncompressedBytes === MAX_ZIP32_BYTES || localOffset === MAX_ZIP32_BYTES) {
      throw archiveError("CCX archive ZIP64 entry metadata is not supported by this bounded verifier");
    }
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameBytes);
    if (!(flags & ZIP_FLAG_UTF8) && rawName.some((byte) => byte > 0x7f)) {
      throw archiveError("CCX archive non-ASCII ZIP entry names must declare UTF-8");
    }
    const name = rawName.toString("utf8");
    if (!name || !rawName.equals(Buffer.from(name, "utf8"))) {
      throw archiveError("CCX archive contains an invalid ZIP entry name");
    }
    entries.push(Object.freeze({ name, versionMadeBy, versionNeeded, flags, method, crc32, compressedBytes, uncompressedBytes, externalAttributes, localOffset }));
    offset = next;
  }
  if (entries.length !== expectedEntries) throw archiveError("CCX archive central directory count is inconsistent");
  return entries;
}

function validateArchiveEntries(entries) {
  const names = new Set();
  let directories = 0;
  for (const entry of entries) {
    if (entry.flags & ENCRYPTED_ENTRY_FLAGS) {
      throw archiveError("CCX archive entries must not be encrypted");
    }
    if (entry.flags & ~SUPPORTED_GENERAL_PURPOSE_FLAGS) {
      throw archiveError("CCX archive entries use unsupported ZIP flags");
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw archiveError("CCX archive entries must use stored or deflate compression");
    }
    const createdOnUnix = entry.versionMadeBy >>> 8 === ZIP_HOST_UNIX;
    const unixFileType = (entry.externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
    if (createdOnUnix && unixFileType !== 0 && unixFileType !== UNIX_FILE_TYPE_REGULAR && unixFileType !== UNIX_FILE_TYPE_DIRECTORY) {
      throw archiveError("CCX archive Unix entries must be regular files or directories");
    }
    const { name } = entry;
    if (name.length > 1024 || /[\0-\x1f\x7f]/.test(name) || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
      throw archiveError("CCX archive contains an unsafe ZIP entry name");
    }
    const isDirectory = name.endsWith("/");
    const segments = name.split("/");
    if (isDirectory) segments.pop();
    if (segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === ".." || /^[A-Za-z]:$/.test(segment))) {
      throw archiveError("CCX archive contains an unsafe ZIP entry name");
    }
    if (names.has(name)) throw archiveError("CCX archive contains duplicate ZIP entry names");
    names.add(name);
    if (isDirectory) directories += 1;
  }
  return Object.freeze({
    entries: entries.length,
    files: entries.length - directories,
    directories,
    pathSetSha256: createHash("sha256").update(JSON.stringify(Array.from(names).sort())).digest("hex"),
  });
}

function pathPrefix(name, expectedPath) {
  if (name === expectedPath) return "";
  if (!name.endsWith(`/${expectedPath}`)) return null;
  const prefix = name.slice(0, name.length - expectedPath.length);
  const segments = prefix.slice(0, -1).split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || /^[A-Za-z]:$/.test(segment))) return null;
  return prefix;
}

function selectRequiredEntries(entries, expectedPaths) {
  const selected = new Map();
  let commonPrefix;
  for (const expectedPath of expectedPaths) {
    const matches = entries.map((entry) => ({ entry, prefix: pathPrefix(entry.name, expectedPath) }))
      .filter((candidate) => candidate.prefix !== null);
    if (matches.length !== 1) throw archiveError(`CCX archive must contain exactly one ${expectedPath} entry`);
    const [{ entry, prefix }] = matches;
    if (commonPrefix === undefined) commonPrefix = prefix;
    else if (commonPrefix !== prefix) throw archiveError("CCX archive required entries must share one bundle root");
    selected.set(expectedPath, entry);
  }
  return selected;
}

async function localDataRangeFromHandle(handle, entry, maximumOffset) {
  if (entry.localOffset + 30 > maximumOffset) throw archiveError("CCX archive local entry is outside the ZIP bounds");
  const local = await readExactly(handle, 30, entry.localOffset, "CCX archive local entry");
  if (local.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) throw archiveError("CCX archive local entry is invalid");
  const versionNeeded = local.readUInt16LE(4);
  const flags = local.readUInt16LE(6);
  const method = local.readUInt16LE(8);
  if (versionNeeded !== entry.versionNeeded || flags !== entry.flags || method !== entry.method) {
    throw archiveError("CCX archive local entry metadata is inconsistent");
  }
  const localCrc32 = local.readUInt32LE(14);
  const localCompressedBytes = local.readUInt32LE(18);
  const localUncompressedBytes = local.readUInt32LE(22);
  const hasDataDescriptor = Boolean(entry.flags & ZIP_FLAG_DATA_DESCRIPTOR);
  const hasInconsistentDeclaredMetadata = hasDataDescriptor
    ? (localCrc32 !== 0 && localCrc32 !== entry.crc32) ||
      (localCompressedBytes !== 0 && localCompressedBytes !== entry.compressedBytes) ||
      (localUncompressedBytes !== 0 && localUncompressedBytes !== entry.uncompressedBytes)
    : localCrc32 !== entry.crc32 || localCompressedBytes !== entry.compressedBytes || localUncompressedBytes !== entry.uncompressedBytes;
  if (hasInconsistentDeclaredMetadata) throw archiveError("CCX archive local entry metadata is inconsistent");
  const localNameBytes = local.readUInt16LE(26);
  const localExtraBytes = local.readUInt16LE(28);
  const localName = await readExactly(handle, localNameBytes, entry.localOffset + 30, "CCX archive local entry name");
  if (!localName.equals(Buffer.from(entry.name, "utf8"))) throw archiveError("CCX archive local entry name is inconsistent");
  const dataStart = entry.localOffset + 30 + localNameBytes + localExtraBytes;
  const dataEnd = dataStart + entry.compressedBytes;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > maximumOffset) throw archiveError("CCX archive local entry is outside the ZIP bounds");
  return { dataStart, dataEnd, hasDataDescriptor };
}

function dataDescriptorMatches(buffer, offset, entry) {
  return buffer.readUInt32LE(offset) === entry.crc32 &&
    buffer.readUInt32LE(offset + 4) === entry.compressedBytes &&
    buffer.readUInt32LE(offset + 8) === entry.uncompressedBytes;
}

async function validateDataDescriptor(handle, range, nextOffset) {
  if (!range.hasDataDescriptor) return range.dataEnd;
  const availableBytes = nextOffset - range.dataEnd;
  if (availableBytes < 12) throw archiveError("CCX archive data descriptor is missing or truncated");
  const descriptor = await readExactly(handle, Math.min(availableBytes, 16), range.dataEnd, "CCX archive data descriptor");
  const unsignedMatches = dataDescriptorMatches(descriptor, 0, range.entry);
  const signedMatches = descriptor.length === 16 && descriptor.readUInt32LE(0) === DATA_DESCRIPTOR_SIGNATURE &&
    dataDescriptorMatches(descriptor, 4, range.entry);
  if (!unsignedMatches && !signedMatches) throw archiveError("CCX archive data descriptor is inconsistent");
  return range.dataEnd + (signedMatches ? 16 : 12);
}

async function validateLocalEntries(handle, entries, directoryOffset) {
  const ranges = [];
  for (const entry of entries) {
    ranges.push({ entry, ...(await localDataRangeFromHandle(handle, entry, directoryOffset)) });
  }
  ranges.sort((left, right) => left.entry.localOffset - right.entry.localOffset);
  if (ranges[0]?.entry.localOffset !== 0) {
    throw archiveError("CCX archive local records have unaccounted bytes");
  }
  for (let index = 0; index < ranges.length; index += 1) {
    const nextOffset = index + 1 < ranges.length ? ranges[index + 1].entry.localOffset : directoryOffset;
    const recordEnd = await validateDataDescriptor(handle, ranges[index], nextOffset);
    if (recordEnd > nextOffset) {
      throw archiveError("CCX archive local entries overlap");
    }
    if (recordEnd < nextOffset) {
      throw archiveError("CCX archive local records have unaccounted bytes");
    }
  }
}

async function localDataRange(archivePath, entry, archiveBytes) {
  const handle = await open(archivePath, "r");
  try {
    return await localDataRangeFromHandle(handle, entry, archiveBytes);
  } finally {
    await handle.close();
  }
}

async function consumeZipEntry(archivePath, archiveBytes, entry, maximumBytes, collect) {
  const { dataStart, dataEnd } = await localDataRange(archivePath, entry, archiveBytes);
  const input = createReadStream(archivePath, { start: dataStart, end: dataEnd - 1 });
  const inflator = entry.method === 8 ? createInflateRaw() : undefined;
  const stream = inflator ? input.pipe(inflator) : input;
  const digest = createHash("sha256");
  const chunks = [];
  let bytes = 0;
  let crc32 = 0xffff_ffff;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) throw archiveError("CCX archive required entry exceeds the verifier bounds");
      digest.update(chunk);
      crc32 = updateCrc32(crc32, chunk);
      if (collect) chunks.push(chunk);
    }
  } catch (error) {
    if (error?.code === "UXP_HYBRID_CCX_ARCHIVE_INVALID") throw error;
    throw archiveError("CCX archive required entry cannot be decompressed");
  }
  if (bytes !== entry.uncompressedBytes) throw archiveError("CCX archive required entry size is inconsistent");
  if ((crc32 ^ 0xffff_ffff) >>> 0 !== entry.crc32) throw archiveError("CCX archive required entry checksum is inconsistent");
  if (inflator && inflator.bytesWritten !== entry.compressedBytes) {
    throw archiveError("CCX archive required entry has trailing compressed data");
  }
  return { bytes, sha256: digest.digest("hex"), buffer: collect ? Buffer.concat(chunks, bytes) : undefined };
}

export async function inspectZipArchive(archivePath, expectedPaths) {
  let archive;
  try { archive = await stat(archivePath); } catch { throw archiveError("CCX archive must be a readable file"); }
  if (!archive.isFile() || !Number.isSafeInteger(archive.size) || archive.size < 22 || archive.size > MAX_ZIP32_BYTES) {
    throw archiveError("CCX archive must be a bounded ZIP file");
  }
  const tailBytes = Math.min(archive.size, 22 + 0xffff);
  const handle = await open(archivePath, "r");
  try {
    const tail = await readExactly(handle, tailBytes, archive.size - tailBytes, "CCX archive end record");
    const end = findEndOfCentralDirectory(tail, archive.size);
    const directory = await readExactly(handle, end.directoryBytes, end.directoryOffset, "CCX archive central directory");
    const entries = readCentralDirectory(directory, end.entries);
    await validateLocalEntries(handle, entries, end.directoryOffset);
    return Object.freeze({
      bytes: archive.size,
      summary: validateArchiveEntries(entries),
      selected: selectRequiredEntries(entries, expectedPaths),
    });
  } finally {
    await handle.close();
  }
}

export async function hashZipEntry(archivePath, archiveBytes, entry, maximumBytes) {
  return consumeZipEntry(archivePath, archiveBytes, entry, maximumBytes, false);
}

export async function readZipEntry(archivePath, archiveBytes, entry, maximumBytes) {
  return consumeZipEntry(archivePath, archiveBytes, entry, maximumBytes, true);
}

export async function sha256File(archivePath) {
  const digest = createHash("sha256");
  try {
    for await (const chunk of createReadStream(archivePath)) digest.update(chunk);
  } catch {
    throw archiveError("CCX archive must be readable");
  }
  return digest.digest("hex");
}
