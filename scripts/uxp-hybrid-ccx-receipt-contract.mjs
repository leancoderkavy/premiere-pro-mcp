export const UXP_HYBRID_CCX_RECEIPT_LEGACY_SCHEMA_VERSION = 1;
export const UXP_HYBRID_CCX_RECEIPT_SCHEMA_VERSION = 2;
export const UXP_HYBRID_CCX_AUTHORITY_URL = "https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/";

export const UXP_HYBRID_CCX_RECEIPT_SEMANTICS = Object.freeze({
  listed: "This receipt records the SHA-256 identity of a locally supplied CCX ZIP archive, a one-way digest of its complete safe ZIP entry-name set, and confirms that its manifest facts, root main.js entrypoint, and required UXP Hybrid addon artifacts exactly match a supplied schema-v2 addon-layout receipt. It does not copy archive, entry names, manifest, entrypoint, or binary contents into the receipt.",
  doesNotEstablish: "This receipt does not establish that UXP Developer Tool created the archive, that a manifest ID matches an Adobe Developer Distribution portal record, SDK compilation, binary architecture, code-signing or notarization validity, installation, UDT loading, MCP exposure, or licensed-host behavior.",
});

export const UXP_HYBRID_CCX_RECEIPT_LEGACY_SEMANTICS = Object.freeze({
  listed: "This receipt records the SHA-256 identity of a locally supplied CCX ZIP archive and confirms that its manifest facts, root main.js entrypoint, and required UXP Hybrid addon artifacts exactly match a supplied schema-v2 addon-layout receipt. It does not copy archive, manifest, entrypoint, or binary contents into the receipt.",
  doesNotEstablish: UXP_HYBRID_CCX_RECEIPT_SEMANTICS.doesNotEstablish,
});

export function compareUxpHybridCcxPaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
