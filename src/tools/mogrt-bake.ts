import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, gunzipSync, gzipSync, inflateRawSync } from "node:zlib";

/**
 * Text for Premiere-authored Essential Graphics templates.
 *
 * Stock titles such as Basic Title are built in Premiere, not After Effects.
 * Their clips expose no MGT component, and ExtendScript's Source Text getValue()
 * returns an opaque, truncated blob, so text cannot be written through the host
 * API (verified on Premiere Pro 25.2). The text does live in the template file:
 *
 *   .mogrt (zip) -> project.prgraphic (zip) -> *.prproj (gzip XML)
 *     -> <StartKeyframeValue Encoding="base64"> of each Source Text param
 *        = u32 byteLength, u32 0, UTF-16LE JSON { mTextParam: { mStyleSheet: { mText } } }
 *
 * bakePremiereTitle writes a copy of the template with the requested text in
 * those blobs and in definition.json, under a fresh capsuleID (Premiere reuses a
 * previously imported template with the same capsuleID), then reads the copy
 * back to confirm every line landed.
 */

const MAX_TEMPLATE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const TEXT_CONTROL_TYPE = 6;
const SOURCE_TEXT_BLOB = /(<StartKeyframeValue[^>]*>)([A-Za-z0-9+/=\s]+)(<\/StartKeyframeValue>)/g;
const UTF16_MTEXT = Buffer.from("mText", "utf16le");

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export type TemplateKind = "premiere" | "after_effects" | "unknown";

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function centralDirectory(archive: Buffer): CentralEntry[] {
  const eocdMin = Math.max(0, archive.length - 65557);
  let eocd = -1;
  for (let i = archive.length - 22; i >= eocdMin; i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip archive (end of central directory not found)");
  const count = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Corrupt zip central directory");
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    entries.push({
      method: archive.readUInt16LE(offset + 10),
      compressedSize: archive.readUInt32LE(offset + 20),
      size: archive.readUInt32LE(offset + 24),
      localOffset: archive.readUInt32LE(offset + 42),
      name: archive.toString("utf8", offset + 46, offset + 46 + nameLength),
    });
    offset += 46 + nameLength + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
  }
  return entries;
}

function entryData(archive: Buffer, entry: CentralEntry, maxBytes: number): Buffer {
  if (entry.size > maxBytes) throw new Error(`${entry.name} exceeds ${maxBytes} bytes`);
  const local = entry.localOffset;
  if (local + 30 > archive.length || archive.readUInt32LE(local) !== 0x04034b50) {
    throw new Error("Corrupt zip local header");
  }
  const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
  const data = archive.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes });
  throw new Error(`Unsupported zip compression method ${entry.method}`);
}

/** Read one entry from a zip archive (stored or deflated). Returns null when absent. */
export function readZipEntry(archive: Buffer, entryName: string, maxBytes = MAX_ENTRY_BYTES): Buffer | null {
  const entry = centralDirectory(archive).find((candidate) => candidate.name === entryName);
  return entry ? entryData(archive, entry, maxBytes) : null;
}

/**
 * Read every entry of a zip archive, in archive order. Each entry is capped at
 * maxEntryBytes and all of them together at maxTotalBytes, so a small archive
 * of many highly compressed entries cannot inflate without bound.
 */
export function readZipEntries(archive: Buffer, maxEntryBytes = MAX_ENTRY_BYTES, maxTotalBytes = MAX_TOTAL_BYTES): ZipEntry[] {
  const entries = centralDirectory(archive);
  if (entries.length > MAX_ENTRIES) throw new Error(`Zip archive has ${entries.length} entries; at most ${MAX_ENTRIES} are read`);
  const declared = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (declared > maxTotalBytes) throw new Error(`Zip entries total ${declared} bytes, over the ${maxTotalBytes}-byte limit`);
  let total = 0;
  return entries.map((entry) => {
    const data = entryData(archive, entry, Math.max(1, Math.min(maxEntryBytes, maxTotalBytes - total)));
    total += data.length;
    return { name: entry.name, data };
  });
}

let crcTable: Uint32Array | undefined;
function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Write a deflated zip archive. */
export function writeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed);
    central.push(header, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Premiere-built templates carry project.prgraphic; After Effects-built ones carry project.aegraphic. */
export function templateKind(entryNames: string[]): TemplateKind {
  if (entryNames.includes("project.prgraphic")) return "premiere";
  if (entryNames.includes("project.aegraphic")) return "after_effects";
  return "unknown";
}

export function readTemplateKind(mogrtPath: string): TemplateKind {
  return templateKind(centralDirectory(readFileSync(mogrtPath)).map((entry) => entry.name));
}

interface SourceTextBlob {
  text: string;
  json: Record<string, any>;
}

function decodeSourceText(base64: string): SourceTextBlob | null {
  const raw = Buffer.from(base64.replace(/\s+/g, ""), "base64");
  if (raw.length < 8 || raw.indexOf(UTF16_MTEXT) < 0) return null;
  const length = raw.readUInt32LE(0);
  if (8 + length > raw.length) return null;
  try {
    const json = JSON.parse(raw.subarray(8, 8 + length).toString("utf16le")) as Record<string, any>;
    const text = json?.mTextParam?.mStyleSheet?.mText;
    return typeof text === "string" ? { text, json } : null;
  } catch {
    return null;
  }
}

function encodeSourceText(json: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(json), "utf16le");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]).toString("base64");
}

function prprojOf(prgraphic: Buffer): { entries: ZipEntry[]; index: number; xml: string } {
  const entries = readZipEntries(prgraphic);
  const index = entries.findIndex((entry) => /\.prproj$/i.test(entry.name));
  if (index < 0) throw new Error("project.prgraphic contains no .prproj");
  const xml = gunzipSync(entries[index].data, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
  return { entries, index, xml };
}

/** Text of every Source Text layer in a Premiere-built template, in document order. */
export function readPremiereTitleText(mogrtPath: string): string[] {
  const prgraphic = readZipEntry(readFileSync(mogrtPath), "project.prgraphic");
  if (!prgraphic) throw new Error("Template has no project.prgraphic");
  const texts: string[] = [];
  for (const match of prprojOf(prgraphic).xml.matchAll(SOURCE_TEXT_BLOB)) {
    const blob = decodeSourceText(match[2]);
    if (blob) texts.push(blob.text);
  }
  return texts;
}

export function defaultTitleDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.PREMIERE_MCP_TITLE_DIR) return env.PREMIERE_MCP_TITLE_DIR;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "premiere-pro-mcp", "titles");
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "premiere-pro-mcp", "titles");
  return join(homedir(), ".premiere-pro-mcp", "titles");
}

const TITLE_CACHE_FILE = /^[A-Za-z0-9._-]*-[0-9a-f]{16}[.]mogrt$/;
const TITLE_CACHE_LIMIT = 50;

/** Prune only regular baked-title cache files, leaving other directory entries intact. */
export function pruneTitleCache(outDir: string): void {
  try {
    if (!lstatSync(outDir).isDirectory()) return;
    const entries = readdirSync(outDir).filter((name) => TITLE_CACHE_FILE.test(name)).flatMap((name) => {
      try {
        const path = join(outDir, name), stat = lstatSync(path);
        return stat.isFile() ? [{ path, mtimeMs: stat.mtimeMs, ino: stat.ino }] : [];
      } catch { return []; }
    });
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
    for (const entry of entries.slice(TITLE_CACHE_LIMIT)) {
      try {
        const current = lstatSync(entry.path);
        if (current.isFile() && current.ino === entry.ino && current.mtimeMs === entry.mtimeMs) unlinkSync(entry.path);
      } catch { /* Cache cleanup must not prevent importing a verified title. */ }
    }
  } catch { /* An inaccessible cache does not change the title import receipt. */ }
}

export interface BakeCheck {
  index: number;
  expected: string;
  actual: string | null;
}

export interface BakeResult {
  path: string;
  reused: boolean;
  checks: BakeCheck[];
}

function localizedDefault(value: unknown): string {
  const table = (value as { strDB?: Array<{ localeString?: string; str?: string }> } | undefined)?.strDB;
  if (!Array.isArray(table) || table.length === 0) return typeof value === "string" ? value : "";
  return String((table.find((entry) => entry.localeString === "en_US") ?? table[0]).str ?? "");
}

/**
 * Write a copy of a Premiere-built template with `lines` in its text fields
 * (field order from definition.json; each field is matched to its layer by the
 * default text, falling back to layer order). The copy is content-addressed, so
 * the same template and text reuse one file and capsuleID.
 */
export function bakePremiereTitle(
  templatePath: string,
  lines: string[],
  outDir: string = defaultTitleDir(),
  newCapsuleId: () => string = randomUUID,
): BakeResult {
  if (statSync(templatePath).size > MAX_TEMPLATE_BYTES) throw new Error("Template file is too large");
  const entries = readZipEntries(readFileSync(templatePath));
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (templateKind([...byName.keys()]) !== "premiere") throw new Error("Not a Premiere-built template (no project.prgraphic)");

  const digest = createHash("sha256").update(readFileSync(templatePath)).update("\u0000").update(JSON.stringify(lines)).digest("hex").slice(0, 16);
  const slug = (templatePath.split(/[\\/]/).pop() ?? "title").replace(/\.mogrt$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-");
  const outPath = join(outDir, `${slug}-${digest}.mogrt`);

  const definitionEntry = byName.get("definition.json");
  if (!definitionEntry) throw new Error("Template has no definition.json");
  const definition = JSON.parse(definitionEntry.data.toString("utf8").replace(/^﻿/, "")) as Record<string, any>;
  const textControls = (Array.isArray(definition.clientControls) ? definition.clientControls : [])
    .filter((control: Record<string, unknown>) => Number(control?.type) === TEXT_CONTROL_TYPE);
  if (lines.length > textControls.length) {
    throw new Error(`Template has ${textControls.length} text field(s) but ${lines.length} line(s) were given`);
  }

  const { entries: graphicEntries, index: prprojIndex, xml } = prprojOf(byName.get("project.prgraphic")!.data);
  const blobs: Array<{ start: number; end: number; open: string; close: string; blob: SourceTextBlob }> = [];
  for (const match of xml.matchAll(SOURCE_TEXT_BLOB)) {
    const blob = decodeSourceText(match[2]);
    if (blob) blobs.push({ start: match.index!, end: match.index! + match[0].length, open: match[1], close: match[3], blob });
  }
  if (blobs.length < lines.length) throw new Error(`Template has ${blobs.length} text layer(s) for ${lines.length} line(s)`);

  // Assign each field to a layer: same default text first, then layer order.
  const used = new Set<number>();
  const assignment: number[] = [];
  lines.forEach((_line, field) => {
    const wanted = localizedDefault(textControls[field]?.value);
    let layer = blobs.findIndex((candidate, index) => !used.has(index) && candidate.blob.text === wanted);
    if (layer < 0) layer = blobs.findIndex((_candidate, index) => !used.has(index) && index >= field);
    if (layer < 0) layer = blobs.findIndex((_candidate, index) => !used.has(index));
    used.add(layer);
    assignment.push(layer);
  });

  // Each line must read back from the layer its own field was written to; a
  // match in some other layer does not count. Rewriting keeps layer order.
  const verify = (): BakeCheck[] => {
    const texts = readPremiereTitleText(outPath);
    return lines.map((expected, index) => ({ index, expected, actual: texts[assignment[index]] ?? null }));
  };
  if (existsSync(outPath)) {
    const checks = verify();
    if (checks.every((check) => check.actual === check.expected)) {
      try { if (lstatSync(outPath).isFile()) { const now = new Date(); utimesSync(outPath, now, now); pruneTitleCache(outDir); } } catch { /* Keep the verified copy available when its timestamp cannot be refreshed. */ }
      return { path: outPath, reused: true, checks };
    }
  }

  let rewritten = "";
  let cursor = 0;
  blobs.forEach((entry, layer) => {
    const field = assignment.indexOf(layer);
    rewritten += xml.slice(cursor, entry.start);
    if (field < 0) {
      rewritten += xml.slice(entry.start, entry.end);
    } else {
      const json = structuredClone(entry.blob.json);
      json.mTextParam.mStyleSheet.mText = lines[field];
      rewritten += entry.open + encodeSourceText(json) + entry.close;
    }
    cursor = entry.end;
  });
  rewritten += xml.slice(cursor);

  lines.forEach((line, field) => {
    const table = textControls[field]?.value?.strDB;
    if (Array.isArray(table)) for (const localizedValue of table) localizedValue.str = line;
    else if (textControls[field]) textControls[field].value = line;
  });
  definition.capsuleID = newCapsuleId();

  graphicEntries[prprojIndex] = { name: graphicEntries[prprojIndex].name, data: gzipSync(Buffer.from(rewritten, "utf8")) };
  const output: ZipEntry[] = [];
  for (const entry of entries) {
    // Localized project variants still hold the default text; drop them so
    // Premiere uses the rewritten project.prgraphic in every UI language.
    if (/^project_[A-Za-z]{2}_[A-Za-z]{2}\.prgraphic$/.test(entry.name)) continue;
    if (entry.name === "definition.json") output.push({ name: entry.name, data: Buffer.from("﻿" + JSON.stringify(definition), "utf8") });
    else if (entry.name === "project.prgraphic") output.push({ name: entry.name, data: writeZip(graphicEntries) });
    else output.push(entry);
  }

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const staging = `${outPath}.${process.pid}.tmp`;
  writeFileSync(staging, writeZip(output), { mode: 0o600 });
  renameSync(staging, outPath);
  const checks = verify();
  pruneTitleCache(outDir);
  return { path: outPath, reused: false, checks };
}
