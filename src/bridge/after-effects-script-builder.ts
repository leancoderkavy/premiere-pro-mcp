/**
 * The After Effects connector intentionally has a very small helper surface.
 * Loading the Premiere helper bundle into AE would unnecessarily expose DOM
 * assumptions from a different host in AE's long-lived ExtendScript engine.
 */
import { createHash } from "node:crypto";

const HELPERS = `
function __aeJsonStringify(value) {
  if (value === null) return "null";
  if (value === undefined) return "null";
  if (typeof value === "string") return '"' + value.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, "\\\\n").replace(/\\r/g, "\\\\r") + '"';
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Array) {
    var list = [];
    for (var i = 0; i < value.length; i++) list.push(__aeJsonStringify(value[i]));
    return "[" + list.join(",") + "]";
  }
  if (typeof value === "object") {
    var fields = [];
    for (var key in value) {
      if (value.hasOwnProperty(key)) fields.push(__aeJsonStringify(key) + ":" + __aeJsonStringify(value[key]));
    }
    return "{" + fields.join(",") + "}";
  }
  return __aeJsonStringify(String(value));
}

function __aeResult(data) { return __aeJsonStringify({ success: true, data: data }); }
function __aeError(message) { return __aeJsonStringify({ success: false, error: String(message) }); }
`;

export const AFTER_EFFECTS_HELPERS_VERSION = createHash("md5")
  .update(HELPERS)
  .digest("hex")
  .slice(0, 12);

export function getAfterEffectsHelpersSource(): string {
  return `${HELPERS}\nvar __AE_MCP_HELPERS_V = "${AFTER_EFFECTS_HELPERS_VERSION}";\n`;
}

export function afterEffectsHelpersFileName(): string {
  return `after-effects-helpers_${AFTER_EFFECTS_HELPERS_VERSION}.jsx`;
}

export function buildAfterEffectsBootstrap(helpersPath: string): string {
  const escaped = helpersPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `if (typeof __AE_MCP_HELPERS_V === "undefined" || __AE_MCP_HELPERS_V !== "${AFTER_EFFECTS_HELPERS_VERSION}") { $.evalFile("${escaped}"); }`;
}

export function buildAfterEffectsScript(code: string): string {
  return `(function() {\n  try {\n    ${code}\n  } catch (error) {\n    return __aeError(error.toString());\n  }\n})();`;
}

export function escapeForAfterEffects(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
