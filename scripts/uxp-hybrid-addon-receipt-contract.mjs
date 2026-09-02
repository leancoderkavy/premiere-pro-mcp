export const UXP_HYBRID_ADDON_RECEIPT_SCHEMA_VERSION = 2;
export const UXP_HYBRID_ADDON_RECEIPT_LEGACY_SCHEMA_VERSION = 1;
export const UXP_HYBRID_ADDON_AUTHORITY_URL = "https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/build";
export const UXP_HYBRID_ADDON_ENTRYPOINT_PATH = "main.js";
export const UXP_HYBRID_ADDON_TARGETS = Object.freeze([
  Object.freeze({ target: "mac-x64", pathPrefix: "mac/x64" }),
  Object.freeze({ target: "mac-arm64", pathPrefix: "mac/arm64" }),
  Object.freeze({ target: "win-x64", pathPrefix: "win/x64" }),
]);

export const UXP_HYBRID_ADDON_RECEIPT_LEGACY_SEMANTICS = Object.freeze({
  listed: "Each listed item is a required UXP Hybrid addon artifact observed in a locally supplied development plugin bundle. Paths are relative to that bundle and binary or manifest contents are not copied into this receipt.",
  doesNotEstablish: "This receipt does not establish Adobe entitlement, SDK compilation, binary architecture, code-signing or notarization validity, UDT loading, MCP exposure, or licensed-host behavior.",
});

export const UXP_HYBRID_ADDON_RECEIPT_SEMANTICS = Object.freeze({
  listed: "Each listed addon artifact and root main.js entrypoint is observed in a locally supplied development plugin bundle. Paths are relative to that bundle and binary, manifest, or entrypoint contents are not copied or parsed by this receipt.",
  doesNotEstablish: UXP_HYBRID_ADDON_RECEIPT_LEGACY_SEMANTICS.doesNotEstablish,
});

export function compareUxpHybridPaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
