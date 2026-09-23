import { escapeForExtendScript } from "../bridge/script-builder.js";

/**
 * Shared MOGRT text helpers (issues #616 / #617).
 *
 * Premiere reports MOGRT text controls (for example "Headline") as a JSON string
 * whose `textEditValue` field holds the visible text. ExtendScript has no
 * JSON.parse, so host scripts return the raw value and the comparison happens
 * here in Node.
 */

export const MAX_MOGRT_TEXT_FIELDS = 32;
export const MAX_MOGRT_TEXT_LENGTH = 2000;

export type MogrtTextStatus = "verified" | "mismatch" | "missing_property" | "committed_unverified";

export interface MogrtTextCheck {
  displayName: string;
  expected: string;
  actual: string | null;
  status: MogrtTextStatus;
}

/** Extract the visible text from a MOGRT parameter value (JSON string, object, or plain string). */
export function extractMogrtText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const text = (value as Record<string, unknown>).textEditValue;
    return typeof text === "string" ? text : null;
  }
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    try {
      return extractMogrtText(JSON.parse(trimmed));
    } catch {
      return value;
    }
  }
  return value;
}

/** Validate a `{ displayName: text }` map supplied by the client. */
export function validateMogrtTextMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object mapping MOGRT parameter display names to text`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  if (entries.length > MAX_MOGRT_TEXT_FIELDS) throw new Error(`${field} accepts at most ${MAX_MOGRT_TEXT_FIELDS} parameters`);
  const result: Record<string, string> = {};
  for (const [name, text] of entries) {
    if (!name.trim()) throw new Error(`${field} parameter names must be non-empty`);
    if (typeof text !== "string") throw new Error(`${field}.${name} must be a string`);
    if (text.length > MAX_MOGRT_TEXT_LENGTH) throw new Error(`${field}.${name} exceeds ${MAX_MOGRT_TEXT_LENGTH} characters`);
    result[name] = text;
  }
  return result;
}

/** Compare expected text against host parameter readback. */
export function compareMogrtText(
  expected: Record<string, string>,
  parameters: Array<{ displayName?: unknown; value?: unknown; readbackError?: unknown; missing?: unknown }>,
): MogrtTextCheck[] {
  return Object.entries(expected).map(([displayName, text]) => {
    const param = parameters.find((p) => p.displayName === displayName);
    if (!param || param.missing === true) return { displayName, expected: text, actual: null, status: "missing_property" as const };
    if (param.readbackError !== undefined && param.readbackError !== null) {
      return { displayName, expected: text, actual: null, status: "committed_unverified" as const };
    }
    const actual = extractMogrtText(param.value);
    return { displayName, expected: text, actual, status: actual === text ? "verified" as const : "mismatch" as const };
  });
}

/** Overall status: any mismatch/missing wins, then unverified, else verified. */
export function summarizeMogrtText(checks: MogrtTextCheck[]): MogrtTextStatus {
  if (checks.some((c) => c.status === "mismatch")) return "mismatch";
  if (checks.some((c) => c.status === "missing_property")) return "missing_property";
  if (checks.some((c) => c.status === "committed_unverified")) return "committed_unverified";
  return "verified";
}

/**
 * ES3 snippet that writes each text value explicitly into `mgtVar` and pushes
 * raw readback into `outVar`. Values are JSON-encoded in Node and escaped; the
 * host replaces only the `textEditValue` field so styling in the JSON survives.
 */
export function buildMogrtTextWriteScript(mgtVar: string, outVar: string, values: Record<string, string>): string {
  return Object.entries(values).map(([name, text]) => `
    __mogrtWriteText(${mgtVar}, ${outVar}, "${escapeForExtendScript(name)}", "${escapeForExtendScript(text)}", "${escapeForExtendScript(JSON.stringify(text))}");`).join("");
}

/** Top-level ES3 helper declaration; emit once at script scope (not inside a block). */
export const MOGRT_TEXT_WRITE_HELPER = `
    function __mogrtWriteText(comp, out, name, plain, encoded) {
      var prop = null;
      for (var i = 0; i < comp.properties.numItems; i++) {
        if (comp.properties[i].displayName === name) { prop = comp.properties[i]; break; }
      }
      if (!prop) { out.push({ displayName: name, missing: true }); return; }
      var before = prop.getValue();
      var next = plain;
      if (typeof before === "string" && /"textEditValue"\\s*:\\s*"/.test(before)) {
        next = before.replace(/"textEditValue"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"/, function () { return '"textEditValue":' + encoded; });
      }
      try { prop.setValue(next, true); } catch (setError) { out.push({ displayName: name, setError: String(setError) }); return; }
      try { out.push({ displayName: name, value: prop.getValue() }); }
      catch (readError) { out.push({ displayName: name, readbackError: String(readError) }); }
    }
`;
