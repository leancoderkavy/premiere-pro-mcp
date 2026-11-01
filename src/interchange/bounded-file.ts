import { readBoundedRegularFile } from "../security/file-safety.js";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const MAX_INTERCHANGE_BYTES = 10 * 1024 * 1024;
export const MAX_INTERCHANGE_ENTRIES = 2_000;
export const MAX_INTERCHANGE_FIELDS = 256;

export function boundedText(value: unknown, name: string, maximum = 512, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > maximum || /\0/.test(value)) {
    throw new Error(`${name} must be ${allowEmpty ? "a" : "a non-empty"} string of at most ${maximum} characters without NUL`);
  }
  return value;
}

export function readBoundedInterchange(path: unknown) {
  const target = boundedText(path, "path", 4096, false);
  if (!isAbsolute(target)) throw new Error("path must be absolute");
  {
    const buffer = readBoundedRegularFile(target, MAX_INTERCHANGE_BYTES);
    if (buffer.length > MAX_INTERCHANGE_BYTES) throw new Error("Interchange file grew beyond the byte limit during read");
    const text = buffer.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buffer)) throw new Error("Interchange file must contain valid UTF-8");
    return { path: target, contents: text, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
  }
}

/** Create-only output: a prior export, including a symlink, is never overwritten. */
export function writeNewInterchange(path: unknown, contents: string) {
  const target = boundedText(path, "output_path", 4096, false);
  if (!isAbsolute(target)) throw new Error("output_path must be absolute");
  if (Buffer.byteLength(contents) > MAX_INTERCHANGE_BYTES) throw new Error("Interchange output exceeds the byte limit");
  writeFileSync(target, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const readback = readBoundedInterchange(target);
  if (readback.contents !== contents) throw new Error("Interchange output readback differs from requested bytes");
  return { path: target, bytes: readback.bytes, sha256: readback.sha256, outcome: "verified" as const, verificationBoundary: "local_file_exact_bytes", hostVerified: false };
}

export function boundJsonTree(value: unknown) {
  let count = 0;
  function visit(node: unknown, depth: number): void {
    if (++count > 20_000 || depth > 32) throw new Error("JSON exceeds the 20,000-node or 32-level nesting limit");
    if (typeof node === "string" && node.length > 16_384) throw new Error("JSON string exceeds the 16,384-character limit");
    if (typeof node === "number" && !Number.isFinite(node)) throw new Error("JSON contains a non-finite number");
    if (Array.isArray(node)) {
      if (node.length > MAX_INTERCHANGE_ENTRIES) throw new Error(`JSON array exceeds the ${MAX_INTERCHANGE_ENTRIES}-entry limit`);
      for (const child of node) visit(child, depth + 1);
    } else if (node !== null && typeof node === "object") {
      const entries = Object.entries(node);
      if (entries.length > MAX_INTERCHANGE_FIELDS) throw new Error("JSON object exceeds the 256-field limit");
      for (const [key, child] of entries) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("JSON contains an unsafe property name");
        visit(child, depth + 1);
      }
    }
  }
  visit(value, 0);
}

export function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function onlyKeys(value: Record<string, unknown>, keys: readonly string[], name: string) {
  const unknown = Object.keys(value).filter(key => !keys.includes(key));
  if (unknown.length) throw new Error(`${name} contains unknown fields: ${unknown.join(", ")}`);
}
