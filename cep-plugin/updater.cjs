/* MCP Bridge update helpers. Kept dependency-free for the older Chromium
 * runtime embedded in CEP. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MCPBridgeUpdater = api;
})(this, function () {
  "use strict";

  var CURRENT_VERSION = "1.14.9";
  var PACKAGE_NAME = "premiere-pro-mcp";
  var LATEST_PACKAGE_API = "https://registry.npmjs.org/" + PACKAGE_NAME;
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

  function latestPackageVersion(record) {
    if (!record || typeof record !== "object") {
      throw new Error("The npm registry returned an invalid package record.");
    }
    var tags = record["dist-tags"];
    var latest = tags && tags.latest;
    var version = normalizeVersion(latest);
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error("The npm registry did not provide a valid latest version.");
    }
    return version;
  }

  function updateStateFromPackageRecord(currentVersion, record) {
    var current = normalizeVersion(currentVersion);
    if (!current || !/^\d+\.\d+\.\d+$/.test(current)) {
      throw new Error("The installed connector version is invalid.");
    }
    var latest = latestPackageVersion(record);
    return {
      currentVersion: current,
      latestVersion: latest,
      updateAvailable: compareVersions(latest, current) > 0,
    };
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

  function powerShellLiteral(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  function randomSuffix(runtime) {
    if (runtime.crypto && typeof runtime.crypto.randomBytes === "function") {
      return runtime.crypto.randomBytes(12).toString("hex");
    }
    return String(new Date().getTime()) + "-" + String(Math.random()).slice(2);
  }

  /**
   * The CEP panel cannot replace its own files safely while Premiere is running.
   * This small, detached helper waits for Premiere to close, then invokes the
   * already-installed per-user npm command. It does not receive project data,
   * MCP configuration, or credentials, and it never force-quits Premiere.
   */
  function buildWindowsGlobalUpdateScript(cliPath, statusPath, scriptPath) {
    return [
      "$ErrorActionPreference = 'Stop'",
      "$cliPath = " + powerShellLiteral(cliPath),
      "$statusPath = " + powerShellLiteral(statusPath),
      "$scriptPath = " + powerShellLiteral(scriptPath),
      "function Write-UpdateStatus([string]$state) {",
      "  $payload = @{ schemaVersion = 'premiere-pro-mcp.desktop-update.v1'; state = $state; updatedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress",
      "  [System.IO.File]::WriteAllText($statusPath, $payload, [System.Text.UTF8Encoding]::new($false))",
      "}",
      "try {",
      "  Write-UpdateStatus 'waiting_for_premiere'",
      "  $premiereProcesses = @('Adobe Premiere Pro', 'Adobe Premiere Pro Beta')",
      "  while (Get-Process -Name $premiereProcesses -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }",
      "  Write-UpdateStatus 'updating'",
      "  $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source",
      "  & $npmCommand install --global 'premiere-pro-mcp@latest'",
      "  if ($LASTEXITCODE -ne 0) { throw 'npm could not install the latest Premiere MCP package.' }",
      "  & $cliPath --install-cep",
      "  if ($LASTEXITCODE -ne 0) { throw 'The refreshed Premiere MCP package could not install its connector.' }",
      "  Write-UpdateStatus 'complete'",
      "} catch {",
      "  Write-UpdateStatus 'failed'",
      "  exit 1",
      "} finally {",
      "  Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue",
      "}",
      "",
    ].join("\r\n");
  }

  function scheduleWindowsGlobalUpdate(options) {
    if (!options || !options.runtime) throw new Error("A local updater runtime is required.");
    var runtime = options.runtime;
    var fs = runtime.fs;
    var path = runtime.path;
    var os = runtime.os;
    var childProcess = runtime.childProcess;
    if (!fs || !path || !os || !childProcess) {
      throw new Error("The local updater runtime is unavailable.");
    }

    var cliPath = String(options.cliPath || "");
    if (!cliPath || typeof path.isAbsolute !== "function" || !path.isAbsolute(cliPath)) {
      throw new Error("The per-user Premiere MCP command could not be resolved.");
    }
    if (typeof fs.existsSync === "function" && !fs.existsSync(cliPath)) {
      throw new Error("The per-user Premiere MCP command is not installed.");
    }

    var updateDirectory = String(options.updateDirectory || os.tmpdir());
    if (!updateDirectory || typeof path.isAbsolute !== "function" || !path.isAbsolute(updateDirectory)) {
      throw new Error("The local update directory is unavailable.");
    }
    if (typeof fs.mkdirSync === "function") fs.mkdirSync(updateDirectory, { recursive: true, mode: 0o700 });

    var suffix = randomSuffix(runtime);
    var statusPath = path.join(updateDirectory, "premiere-pro-mcp-update-" + suffix + ".json");
    var scriptPath = path.join(updateDirectory, "premiere-pro-mcp-update-" + suffix + ".ps1");
    var script = buildWindowsGlobalUpdateScript(cliPath, statusPath, scriptPath);
    fs.writeFileSync(scriptPath, script, { encoding: "utf8", mode: 0o600, flag: "wx" });

    try {
      var child = childProcess.spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
        { detached: true, windowsHide: true, stdio: "ignore" }
      );
      if (!child || typeof child.unref !== "function") {
        throw new Error("The local updater could not be started.");
      }
      child.unref();
      return { statusPath: statusPath };
    } catch (error) {
      try { fs.unlinkSync(scriptPath); } catch (cleanupError) {}
      throw error;
    }
  }

  return {
    CURRENT_VERSION: CURRENT_VERSION,
    PACKAGE_NAME: PACKAGE_NAME,
    LATEST_PACKAGE_API: LATEST_PACKAGE_API,
    LATEST_RELEASE_API: LATEST_RELEASE_API,
    RELEASES_URL: RELEASES_URL,
    normalizeVersion: normalizeVersion,
    compareVersions: compareVersions,
    latestPackageVersion: latestPackageVersion,
    updateStateFromPackageRecord: updateStateFromPackageRecord,
    chooseDownloadUrl: chooseDownloadUrl,
    isTrustedDownloadUrl: isTrustedDownloadUrl,
    buildWindowsGlobalUpdateScript: buildWindowsGlobalUpdateScript,
    scheduleWindowsGlobalUpdate: scheduleWindowsGlobalUpdate,
  };
});
