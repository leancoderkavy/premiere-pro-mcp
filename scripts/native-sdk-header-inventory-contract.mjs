export const NATIVE_SDK_HEADER_INVENTORY_SCHEMA_VERSION = 1;

export const NATIVE_SDK_HEADER_INVENTORY_SEMANTICS = Object.freeze({
  listed: "Each listed item is a header file observed in a locally supplied Adobe SDK extraction. Paths are relative to that extraction and contents are not copied into this inventory.",
  doesNotEstablish: "This receipt does not establish Adobe entitlement, complete C/C++ declaration coverage, a compiled addon, a loaded plugin, MCP exposure, or licensed-host behavior.",
});

export const NATIVE_SDK_FAMILIES = Object.freeze({
  "uxp-hybrid": Object.freeze({
    authorityUrl: "https://developer.adobe.com/premiere-pro/uxp/plugins/hybrid-plugins/",
    includeDirectories: Object.freeze(["src/api", "src/utilities"]),
    requiredHeaders: Object.freeze([
      "src/api/UxpAddonShared.h",
      "src/api/UxpAddonTypes.h",
      "src/utilities/UxpAddon.h",
    ]),
  }),
  "premiere-prsdk": Object.freeze({
    authorityUrl: "https://developer.adobe.com/premiere-pro/",
    includeDirectories: null,
    requiredHeaders: Object.freeze([]),
  }),
});

export function compareNativeSdkPaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hasNativeSdkFamily(value) {
  return Object.prototype.hasOwnProperty.call(NATIVE_SDK_FAMILIES, value);
}
