/* MCP for Adobe Premiere Pro - CEP Plugin Main Script
 * Polls a temp directory for command files (.jsx), executes them
 * in Premiere Pro's ExtendScript engine, and writes results back. */

var cs = new CSInterface();
var bridgeRunning = false;
var pollInterval = null;
var commandCount = 0;
var tempDir = "";
var POLL_MS = 200;
var HEARTBEAT_MS = 1000;
var heartbeatInterval = null;

// ---- Logging ----
function log(msg, cls) {
  var el = document.getElementById("log");
  var entry = document.createElement("div");
  entry.className = "log-entry " + (cls || "");
  var ts = new Date().toLocaleTimeString();
  entry.textContent = "[" + ts + "] " + msg;
  el.appendChild(entry);
  el.scrollTop = el.scrollHeight;
  // Keep max 100 entries
  while (el.children.length > 100) el.removeChild(el.firstChild);
}

// ---- Status ----
function setStatus(state, text) {
  var dot = document.getElementById("statusDot");
  dot.className = "status-dot " + state;
  var statusText = document.getElementById("statusText");
  statusText.textContent = text;
  statusText.setAttribute("data-state", state || "stopped");
  var detail = document.getElementById("statusDetail");
  if (detail) {
    if (state === "connected") detail.textContent = "Premiere Pro link is active";
    else if (state === "waiting") detail.textContent = "Ready for an AI assistant connection";
    else if (state === "error") detail.textContent = "Bridge needs attention";
    else detail.textContent = "Waiting for Premiere Pro";
  }
}

function setConnectionCheck(id, state, detail) {
  var el = document.getElementById(id);
  if (!el) return;
  el.setAttribute("data-state", state);
  var text = el.getElementsByTagName("small")[0];
  if (text) text.textContent = detail;
}

// This reads only boolean Premiere state. Do not put project names, paths, or
// media information in the panel: the MCP safe-check uses the same boundary.
function refreshConnectionCenter() {
  if (!bridgeRunning) {
    setConnectionCheck("checkConnector", "waiting", "Start the connector first");
    setConnectionCheck("checkProject", "waiting", "Waiting for the connector");
    setConnectionCheck("checkSequence", "waiting", "Waiting for the connector");
    return;
  }
  setConnectionCheck("checkConnector", "ready", "Running in Premiere Pro");
  setConnectionCheck("checkProject", "waiting", "Checking…");
  setConnectionCheck("checkSequence", "waiting", "Checking…");
  cs.evalScript(
    '(function(){var p=app&&app.project;return "mcpstate:"+(p&&typeof p.name!=="undefined"?"1":"0")+","+(p&&p.activeSequence?"1":"0");}())',
    function (raw) {
      var match = /^mcpstate:([01]),([01])$/.exec(String(raw || ""));
      if (!match) {
        setConnectionCheck("checkProject", "needs-attention", "Could not read Premiere state");
        setConnectionCheck("checkSequence", "needs-attention", "Could not read Premiere state");
        return;
      }
      var projectOpen = match[1] === "1";
      var sequenceOpen = match[2] === "1";
      setConnectionCheck("checkProject", projectOpen ? "ready" : "needs-attention", projectOpen ? "Project open" : "Open a project in Premiere Pro");
      setConnectionCheck("checkSequence", sequenceOpen ? "ready" : "needs-attention", sequenceOpen ? "Active sequence open" : "Open a sequence in Premiere Pro");
    }
  );
}

// ---- File I/O via Node.js (CEP has access to Node) ----
// --enable-nodejs puts `require` in the global scope on most hosts, but on some it
// lands on cep_node instead. Try both, and fail loudly rather than letting fs come
// back undefined and surface later as "Cannot read properties of undefined".
function nodeRequire(moduleName) {
  if (typeof require !== "undefined") return require(moduleName);

  var cepNode = typeof cep_node !== "undefined" ? cep_node : typeof window !== "undefined" ? window.cep_node : null;
  if (cepNode && typeof cepNode.require === "function") return cepNode.require(moduleName);

  throw new Error(
    'Node.js is not available in this CEP panel, so "' + moduleName + '" could not be loaded. ' +
      "Check that CSXS/manifest.xml has <Parameter>--enable-nodejs</Parameter>, then fully quit and reopen Premiere Pro."
  );
}

var fs = nodeRequire("fs");
var path = nodeRequire("path");
var os = nodeRequire("os");
var https = nodeRequire("https");
function defaultBridgeDirectory() {
  try {
    var nodeProcess = nodeRequire("process");
    var configured = nodeProcess && nodeProcess.env && nodeProcess.env.PREMIERE_TEMP_DIR;
    if (typeof configured === "string" && configured.trim()) return configured.trim();
  } catch (e) {
    // The panel still has a safe OS temporary-directory fallback.
  }
  return path.join(os.tmpdir(), "premiere-mcp-bridge");
}
tempDir = defaultBridgeDirectory();
var latestUpdate = null;
var UPDATE_STATUS_STORAGE_KEY = "mcp_bridge_desktop_update_status_path";
var MAX_UPDATE_RESPONSE_BYTES = 64 * 1024;

function getPerUserGlobalInstall() {
  try {
    var nodeProcess = nodeRequire("process");
    var appData = nodeProcess && nodeProcess.env && nodeProcess.env.APPDATA;
    if (typeof appData !== "string" || !appData.trim()) return null;
    var npmDirectory = path.resolve(appData, "npm");
    var commandPath = path.resolve(npmDirectory, "premiere-pro-mcp.cmd");
    var packagePath = path.resolve(npmDirectory, "node_modules", "premiere-pro-mcp", "package.json");
    var relative = path.relative(npmDirectory, commandPath);
    var packageRelative = path.relative(npmDirectory, packagePath);
    if (
      !relative ||
      !packageRelative ||
      relative.indexOf(".." + path.sep) === 0 ||
      packageRelative.indexOf(".." + path.sep) === 0 ||
      path.isAbsolute(relative) ||
      path.isAbsolute(packageRelative) ||
      !fs.existsSync(commandPath) ||
      !fs.existsSync(packagePath)
    ) return null;
    var packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
    var serverVersion = MCPBridgeUpdater.normalizeVersion(packageMetadata && packageMetadata.version);
    if (!serverVersion) return null;
    return { commandPath: commandPath, serverVersion: serverVersion };
  } catch (e) {
    return null;
  }
}

function getPerUserGlobalCommand() {
  var install = getPerUserGlobalInstall();
  return install ? install.commandPath : null;
}

function saveUpdateStatusPath(statusPath) {
  try {
    localStorage.setItem(UPDATE_STATUS_STORAGE_KEY, statusPath);
  } catch (e) {}
}

function readScheduledUpdateStatus() {
  var statusPath = "";
  try {
    statusPath = localStorage.getItem(UPDATE_STATUS_STORAGE_KEY) || "";
  } catch (e) {
    return null;
  }
  if (!statusPath || !path.isAbsolute(statusPath) || !fs.existsSync(statusPath)) return null;
  try {
    var status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    var validStates = ["waiting_for_premiere", "updating", "complete", "failed"];
    if (
      !status ||
      status.schemaVersion !== "premiere-pro-mcp.desktop-update.v1" ||
      validStates.indexOf(status.state) === -1
    ) return null;
    return status;
  } catch (e) {
    return null;
  }
}

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch (e) {
    log("Error creating dir: " + e.message, "err");
  }
}

function listCommandFiles() {
  try {
    if (!fs.existsSync(tempDir)) return [];
    var files = fs.readdirSync(tempDir);
    return files
      .filter(function (f) { return f.indexOf("cmd_") === 0 && f.slice(-4) === ".jsx"; })
      .sort(); // process in order
  } catch (e) {
    return [];
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    return null;
  }
}

function writeFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (e) {
    log("Error writing " + filePath + ": " + e.message, "err");
    return false;
  }
}

// Publish responses atomically so the MCP process never sees a partially-written
// JSON file. The staging suffix is not a response filename the server will read.
function writeResponseFile(filePath, content) {
  var stagedPath = filePath + ".staged";
  try {
    fs.writeFileSync(stagedPath, content, "utf-8");
    fs.renameSync(stagedPath, filePath);
    return true;
  } catch (e) {
    deleteFile(stagedPath);
    log("Error publishing " + filePath + ": " + e.message, "err");
    return false;
  }
}

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
}

// The heartbeat carries only protocol state. It is published by rename so a
// server never observes partial JSON, and an older server can ignore it.
function writeBridgeHeartbeat() {
  if (!tempDir) return;
  var heartbeatPath = path.join(tempDir, "bridge-heartbeat.json");
  var stagedPath = heartbeatPath + "." + ENGINE_ID + ".staged";
  try {
    fs.writeFileSync(stagedPath, JSON.stringify({
      protocolVersion: 1,
      state: bridgeRunning ? "running" : "waiting"
    }), "utf-8");
    fs.renameSync(stagedPath, heartbeatPath);
  } catch (e) {
    deleteFile(stagedPath);
  }
}

function startBridgeHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  writeBridgeHeartbeat();
  heartbeatInterval = setInterval(writeBridgeHeartbeat, HEARTBEAT_MS);
}

function stopBridgeHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
  // Keep the last heartbeat in place. Its age lets newer servers diagnose a
  // stopped connector, while concurrent visible/headless panels stay isolated.
}

// ---- Script Execution ----
function executeScript(script, callback) {
  // Script is already wrapped in an IIFE by the MCP server's buildScript(),
  // so we pass it directly to avoid double-wrapping.
  cs.evalScript(script, function (result) {
    callback(result);
  });
}

// ---- Command Processing ----
function processCommands() {
  if (commandInFlight) return;
  var cmdFiles = listCommandFiles();
  // Premiere's scripting engine is stateful. Starting every discovered command
  // at once lets overlapping edits race each other and overload the host. The
  // atomic claim below still prevents duplicate work across the visible and
  // headless panels, while this panel dispatches strictly one command at a time.
  if (cmdFiles.length > 0) processOneCommand(cmdFiles[0]);
}

// Both the visible panel and the headless auto-start instance run this file.
// A rename is atomic on the same volume, so whichever engine renames first owns
// the command; the loser's rename throws and it skips the file.
var ENGINE_ID = Math.random().toString(36).slice(2, 8);
var commandInFlight = false;

function processOneCommand(cmdFileName) {
  var cmdFilePath = path.join(tempDir, cmdFileName);
  var claimPath = cmdFilePath + "." + ENGINE_ID + ".claimed";
  try {
    fs.renameSync(cmdFilePath, claimPath);
  } catch (e) {
    return; // another engine claimed this command
  }

  var script = readFile(claimPath);
  deleteFile(claimPath);
  if (!script) {
    log("Failed to read: " + cmdFileName, "err");
    return;
  }

  commandInFlight = true;

  // Derive response filename: cmd_12345.jsx -> res_12345.json
  var id = cmdFileName.replace("cmd_", "").replace(".jsx", "");
  var resFilePath = path.join(tempDir, "res_" + id + ".json");

  log("Executing: " + cmdFileName + " (" + script.length + " chars)", "cmd");

  // While evalScript is in flight, heartbeat a busy file so the MCP server can
  // tell "script still running (modal dialog?)" apart from "plugin not running".
  // Only starts after 2s, so fast commands never touch the extra file.
  var busyFilePath = path.join(tempDir, "busy_" + id + ".json");
  var startedAt = new Date().getTime();
  var busyTimer = setInterval(function () {
    writeFile(busyFilePath, '{"id":"' + id + '","elapsedMs":' + (new Date().getTime() - startedAt) + "}");
  }, 2000);

  executeScript(script, function (result) {
    clearInterval(busyTimer);
    deleteFile(busyFilePath);
    commandCount++;
    document.getElementById("cmdCount").textContent = commandCount;

    var response;
    try {
      // ExtendScript returns a string; try to parse it as JSON
      if (result && result !== "undefined" && result !== "null") {
        // Check if it's already valid JSON
        var parsed = JSON.parse(result);
        response = JSON.stringify(parsed);
        log("Result: OK", "ok");
      } else {
        // An empty result means evalScript gave us nothing back. That is a bridge
        // failure, not a successful command with no data — reporting it as "OK" is
        // what made this so hard to diagnose. Say so.
        response = JSON.stringify({
          success: false,
          error:
            "The bridge received an empty result from evalScript (got " +
            (typeof result) +
            "). The script may not have run. If every command does this, the CEP panel is stale — " +
            "close and reopen it (a reload is not enough), or reinstall the extension.",
        });
        log("Result: EMPTY — evalScript returned nothing (see response file)", "err");
      }
    } catch (e) {
      // If result isn't JSON, wrap it
      if (result && result.indexOf("Error") === 0) {
        response = JSON.stringify({ success: false, error: result });
        log("Result: " + result, "err");
      } else {
        response = JSON.stringify({ success: true, data: result });
        log("Result: OK (raw)", "ok");
      }
    }

    writeResponseFile(resFilePath, response);
    commandInFlight = false;
    // Continue without waiting for the next poll interval, preserving FIFO
    // ordering while minimizing queue handoff latency.
    if (bridgeRunning) processCommands();
  });
}

// ---- Bridge Control ----
function startBridge() {
  tempDir = document.getElementById("tempDir").value.trim();
  if (!tempDir) {
    log("Please set a temp directory", "err");
    document.getElementById("tempDir").focus();
    return;
  }

  ensureDir(tempDir);
  bridgeRunning = true;
  startBridgeHeartbeat();
  setStatus("waiting", "Connector running");
  log("Connector started and ready for safe checks.", "ok");

  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;

  refreshConnectionCenter();

  pollInterval = setInterval(function () {
    if (bridgeRunning) processCommands();
  }, POLL_MS);
}

function stopBridge() {
  bridgeRunning = false;
  writeBridgeHeartbeat();
  stopBridgeHeartbeat();
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;

  setStatus("", "Stopped");
  refreshConnectionCenter();
  log("Bridge stopped");

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
}

function saveTempDir() {
  tempDir = document.getElementById("tempDir").value.trim();
  log("Temp directory saved: " + tempDir);
  // Persist via localStorage
  try {
    localStorage.setItem("mcp_bridge_temp_dir", tempDir);
  } catch (e) {}
}

// ---- Connector Updates ----
function setUpdateUI(title, detail, buttonText, disabled) {
  document.getElementById("updateTitle").textContent = title;
  document.getElementById("updateDetail").textContent = detail;
  var button = document.getElementById("btnUpdate");
  button.textContent = buttonText;
  button.disabled = !!disabled;
}

function updateInstructionUrl() {
  return MCPBridgeUpdater.RELEASES_URL;
}

function openTrustedUpdateInstructions() {
  var url = updateInstructionUrl();
  if (!MCPBridgeUpdater.isTrustedDownloadUrl(url)) {
    showUpdateCheckError("The update instructions link was not trusted.");
    return;
  }
  try {
    var childProcess = nodeRequire("child_process");
    var command =
      os.platform() === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", "start", "", url]]
        : ["open", [url]];
    var child = childProcess.spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (e) {
    showUpdateCheckError("Could not open the update instructions. Try again.");
  }
}

function restoreScheduledUpdateStatus() {
  var status = readScheduledUpdateStatus();
  if (!status) return false;

  if (status.state === "complete") {
    setUpdateUI(
      "Update complete",
      "Restart your MCP client, then use Verify Premiere connection before editing.",
      "Check again",
      false
    );
    return true;
  }
  if (status.state === "failed") {
    setUpdateUI(
      "Update needs attention",
      "Nothing was changed in your projects. Check the update command or retry after Premiere closes.",
      "Check again",
      false
    );
    return true;
  }

  setUpdateUI(
    "Update scheduled",
    status.state === "updating"
      ? "The global MCP server and connector are being updated. Keep Premiere closed."
      : "Quit Premiere Pro. The updater will begin after it fully closes.",
    "Scheduled",
    true
  );
  return true;
}

function checkForUpdates() {
  latestUpdate = null;
  var globalInstall = os.platform() === "win32" ? getPerUserGlobalInstall() : null;
  var responseTooLarge = false;
  setUpdateUI(
    "Version " + MCPBridgeUpdater.CURRENT_VERSION,
    "Checking for updates…",
    "Checking…",
    true
  );

  var request = https.get(
    MCPBridgeUpdater.LATEST_PACKAGE_API,
    {
      headers: {
        Accept: "application/vnd.npm.install-v1+json",
        "User-Agent": "premiere-pro-mcp-connector/" + MCPBridgeUpdater.CURRENT_VERSION,
      },
    },
    function (response) {
      var body = "";
      response.setEncoding("utf8");
      response.on("data", function (chunk) {
        if (body.length + chunk.length > MAX_UPDATE_RESPONSE_BYTES) {
          responseTooLarge = true;
          request.destroy(new Error("npm registry update record was unexpectedly large."));
          return;
        }
        body += chunk;
      });
      response.on("end", function () {
        if (responseTooLarge) return;
        if (response.statusCode !== 200) {
          showUpdateCheckError("Could not check npm (HTTP " + response.statusCode + ").");
          return;
        }
        try {
          var update = MCPBridgeUpdater.updateStateFromPackageRecord(
            MCPBridgeUpdater.CURRENT_VERSION,
            JSON.parse(body)
          );
          var serverUpdateAvailable = Boolean(
            globalInstall &&
            MCPBridgeUpdater.compareVersions(update.latestVersion, globalInstall.serverVersion) > 0
          );
          var needsUpdate = update.updateAvailable || serverUpdateAvailable;

          if (needsUpdate) {
            latestUpdate = {
              version: update.latestVersion,
            };
            if (os.platform() === "win32" && globalInstall) {
              var versionSummary =
                "Server " + globalInstall.serverVersion + ", connector " + MCPBridgeUpdater.CURRENT_VERSION + ". ";
              setUpdateUI(
                "Version " + update.latestVersion + " is available",
                versionSummary + "Update both together after you close Premiere.",
                "Update after quit",
                false
              );
            } else if (os.platform() === "win32") {
              setUpdateUI(
                "Version " + update.latestVersion + " is available",
                "A global npm install was not found. This panel will not modify a source checkout.",
                "Open instructions",
                false
              );
            } else {
              setUpdateUI(
                "Version " + update.latestVersion + " is available",
                "Open the matching release, then update your local server using the documented install path.",
                "Open instructions",
                false
              );
            }
          } else {
            var currentDetail = globalInstall
              ? "Server " + globalInstall.serverVersion + " and connector " + MCPBridgeUpdater.CURRENT_VERSION + " are current."
              : "Your connector release is current. This check does not alter your projects or MCP client configuration.";
            setUpdateUI(
              "Version " + MCPBridgeUpdater.CURRENT_VERSION,
              currentDetail,
              "Check again",
              false
            );
          }
        } catch (e) {
          showUpdateCheckError("npm returned an unreadable package record.");
        }
      });
    }
  );
  request.setTimeout(10000, function () {
    request.destroy(new Error("Update check timed out"));
  });
  request.on("error", function () {
    showUpdateCheckError(
      responseTooLarge ? "npm returned an unexpectedly large package record." : "Unable to check while offline."
    );
  });
}

function showUpdateCheckError(message) {
  setUpdateUI(
    "Version " + MCPBridgeUpdater.CURRENT_VERSION,
    message,
    "Check again",
    false
  );
}

function handleUpdateClick() {
  if (!latestUpdate) {
    checkForUpdates();
    return;
  }

  if (os.platform() !== "win32") {
    openTrustedUpdateInstructions();
    return;
  }

  var cliPath = getPerUserGlobalCommand();
  if (!cliPath) {
    openTrustedUpdateInstructions();
    return;
  }

  var confirmation =
    "Update Premiere MCP to " + latestUpdate.version + " after Premiere Pro fully closes?\n\n" +
    "This updates only the per-user global MCP server and its connector. " +
    "It does not change your projects or MCP client configuration, and it will not force Premiere to close.";
  if (typeof window.confirm === "function" && !window.confirm(confirmation)) return;

  try {
    var childProcess = nodeRequire("child_process");
    var nodeCrypto = nodeRequire("crypto");
    var scheduled = MCPBridgeUpdater.scheduleWindowsGlobalUpdate({
      cliPath: cliPath,
      runtime: {
        fs: fs,
        path: path,
        os: os,
        childProcess: childProcess,
        crypto: nodeCrypto,
      },
    });
    saveUpdateStatusPath(scheduled.statusPath);
    setUpdateUI(
      "Update scheduled",
      "Quit Premiere Pro. The updater will refresh the global server and connector after it fully closes.",
      "Scheduled",
      true
    );
  } catch (e) {
    showUpdateCheckError("Could not schedule the local update. No files were changed.");
  }
}

// ---- Init ----
(function init() {
  // Set the default temp dir in the input field
  document.getElementById("tempDir").value = tempDir;

  // Restore saved temp dir
  try {
    var saved = localStorage.getItem("mcp_bridge_temp_dir");
    if (saved) {
      tempDir = saved;
      document.getElementById("tempDir").value = tempDir;
    }
  } catch (e) {}

  log("MCP for Adobe Premiere Pro CEP connector loaded");
  setStatus("waiting", "Ready — click Start Bridge");

  // Always auto-start. The headless instance (StartOn ApplicationActivate) has no
  // one to click Start, and macOS periodically purges the temp dir — so create it
  // rather than gating auto-start on its existence.
  ensureDir(tempDir);
  startBridgeHeartbeat();
  log("Auto-starting bridge...");
  setTimeout(startBridge, 500);
  if (!restoreScheduledUpdateStatus()) setTimeout(checkForUpdates, 1200);
})();
