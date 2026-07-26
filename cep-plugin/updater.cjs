/* MCP Bridge update helpers. Kept dependency-free for the older Chromium
 * runtime embedded in CEP. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MCPBridgeUpdater = api;
})(this, function () {
  "use strict";

  var CURRENT_VERSION = "1.3.1";
  var LATEST_RELEASE_API =
    "https://api.github.com/repos/leancoderkavy/premiere-pro-mcp/releases/latest";
  var RELEASES_URL =
    "https://github.com/leancoderkavy/premiere-pro-mcp/releases/latest";

  function normalizeVersion(value) {
    return String(value || "")
      .trim()
      .replace(/^v/i, "")
      .split("-")[0];
  }

  function compareVersions(left, right) {
    var a = normalizeVersion(left).split(".");
    var b = normalizeVersion(right).split(".");
    var length = Math.max(a.length, b.length);
    for (var i = 0; i < length; i++) {
      var aPart = parseInt(a[i] || "0", 10);
      var bPart = parseInt(b[i] || "0", 10);
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    return 0;
  }

  function chooseDownloadUrl(release) {
    var assets = release && release.assets ? release.assets : [];
    var preferredNames = [
      /^MCPBridgeCEP(?:-[\w.-]+)?\.zxp$/i,
      /premiere.*(?:connector|bridge).*\.zxp$/i,
      /\.zxp$/i,
      /premiere.*(?:connector|bridge).*\.(?:zip|dmg|exe)$/i,
    ];
    for (var p = 0; p < preferredNames.length; p++) {
      for (var i = 0; i < assets.length; i++) {
        if (
          preferredNames[p].test(assets[i].name || "") &&
          isTrustedDownloadUrl(assets[i].browser_download_url)
        ) {
          return assets[i].browser_download_url;
        }
      }
    }
    return isTrustedDownloadUrl(release && release.html_url)
      ? release.html_url
      : RELEASES_URL;
  }

  function isTrustedDownloadUrl(value) {
    return /^https:\/\/(?:github\.com|api\.github\.com|objects\.githubusercontent\.com)\//i.test(
      String(value || "")
    );
  }

  return {
    CURRENT_VERSION: CURRENT_VERSION,
    LATEST_RELEASE_API: LATEST_RELEASE_API,
    RELEASES_URL: RELEASES_URL,
    normalizeVersion: normalizeVersion,
    compareVersions: compareVersions,
    chooseDownloadUrl: chooseDownloadUrl,
    isTrustedDownloadUrl: isTrustedDownloadUrl,
  };
});
