/** Path identity follows the host filesystem spelling, with Windows-only folding. */
export const HOST_PATH_HELPERS = `
function __hostPathKey(value) {
  var path = String(value || "");
  if (!path || path.indexOf(String.fromCharCode(0)) !== -1) return "";
  try {
    var file = new File(path);
    if (typeof file.fsName === "string" && file.fsName) path = file.fsName;
  } catch (pathError) {}
  var windows = false;
  try { windows = String($.os).toLowerCase().indexOf("windows") !== -1; } catch (osError) {}
  return windows ? path.split(String.fromCharCode(92)).join("/").toLowerCase() : path;
}
function __hostPathIsInside(root, candidate) {
  var rootKey = __hostPathKey(root), candidateKey = __hostPathKey(candidate);
  if (!rootKey || !candidateKey) return false;
  while (rootKey.length > 1 && rootKey.charAt(rootKey.length - 1) === "/") rootKey = rootKey.substring(0, rootKey.length - 1);
  return candidateKey === rootKey || candidateKey.indexOf(rootKey + (rootKey.charAt(rootKey.length - 1) === "/" ? "" : "/")) === 0;
}
`;
