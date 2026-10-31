import { readBoundedRegularFile } from "../security/file-safety.js";
import { statSync } from "node:fs";
import { readZipEntry } from "./mogrt-bake.js";

/** Refuse malformed local templates before invoking the potentially blocking host importer. */
export function validateMogrtArchive(path: string): string | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return "MOGRT must be a regular file of at most 64 MiB.";
    const archive = readBoundedRegularFile(path, 64 * 1024 * 1024);
    const definition = readZipEntry(archive, "definition.json", 1024 * 1024)
      ?? readZipEntry(archive, "manifest.json", 1024 * 1024);
    if (!definition) return "MOGRT ZIP must contain definition.json or manifest.json; nothing was sent to Premiere.";
    const parsed = JSON.parse(definition.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "MOGRT definition must be a JSON object.";
    return null;
  } catch (error) {
    return `Invalid or unreadable MOGRT archive: ${error instanceof Error ? error.message : String(error)}. Nothing was sent to Premiere.`;
  }
}
