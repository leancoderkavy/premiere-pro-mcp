/* MCP Bridge - CEP Plugin Main Script
 * Polls a temp directory for command files (.jsx), executes them
 * in Premiere Pro's ExtendScript engine, and writes results back. */

var cs = new CSInterface();
var bridgeRunning = false;
var pollInterval = null;
var commandCount = 0;
var tempDir = "";
var POLL_MS = 200;

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
  document.getElementById("statusText").textContent = text;
  var detail = document.getElementById("statusDetail");
  if (detail) {
    if (state === "connected") detail.textContent = "Premiere Pro link is active";
    else if (state === "waiting") detail.textContent = "Ready to accept commands";
    else if (state === "error") detail.textContent = "Bridge needs attention";
    else detail.textContent = "Waiting for Premiere Pro";
  }
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
tempDir = path.join(os.tmpdir(), "premiere-mcp-bridge");
var latestUpdate = null;

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

function deleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {}
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
  var cmdFiles = listCommandFiles();
  for (var i = 0; i < cmdFiles.length; i++) {
    processOneCommand(cmdFiles[i]);
  }
}

// Both the visible panel and the headless auto-start instance run this file.
// A rename is atomic on the same volume, so whichever engine renames first owns
// the command; the loser's rename throws and it skips the file.
var ENGINE_ID = Math.random().toString(36).slice(2, 8);

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

    writeFile(resFilePath, response);
  });
}

// ---- Bridge Control ----
function startBridge() {
  tempDir = document.getElementById("tempDir").value.trim();
  if (!tempDir) {
    log("Please set a temp directory", "err");
    return;
  }

  ensureDir(tempDir);
  bridgeRunning = true;
  setStatus("connected", "Running — polling " + tempDir);
  log("Bridge started. Temp dir: " + tempDir);

  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;

  // Verify Premiere Pro connection
  cs.evalScript("app.version", function (version) {
    if (version && version !== "undefined") {
      log("Premiere Pro: " + version, "ok");
    } else {
      log("Warning: Could not detect Premiere Pro version", "err");
    }
  });

  pollInterval = setInterval(function () {
    if (bridgeRunning) processCommands();
  }, POLL_MS);
}

function stopBridge() {
  bridgeRunning = false;
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;

  setStatus("", "Stopped");
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

function checkForUpdates() {
  latestUpdate = null;
  setUpdateUI(
    "Version " + MCPBridgeUpdater.CURRENT_VERSION,
    "Checking for updates…",
    "Checking…",
    true
  );

  var request = https.get(
    MCPBridgeUpdater.LATEST_RELEASE_API,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "premiere-pro-mcp-connector/" + MCPBridgeUpdater.CURRENT_VERSION,
      },
    },
    function (response) {
      var body = "";
      response.setEncoding("utf8");
      response.on("data", function (chunk) {
        if (body.length < 1024 * 1024) body += chunk;
      });
      response.on("end", function () {
        if (response.statusCode !== 200) {
          showUpdateCheckError("Could not check GitHub (HTTP " + response.statusCode + ").");
          return;
        }
        try {
          var release = JSON.parse(body);
          var latestVersion = MCPBridgeUpdater.normalizeVersion(
            release.tag_name || release.name
          );
          if (!latestVersion) throw new Error("Release has no version");

          if (
            MCPBridgeUpdater.compareVersions(
              latestVersion,
              MCPBridgeUpdater.CURRENT_VERSION
            ) > 0
          ) {
            latestUpdate = {
              version: latestVersion,
              url: MCPBridgeUpdater.chooseDownloadUrl(release),
            };
            setUpdateUI(
              "Version " + latestVersion + " is available",
              "Download it, then close Premiere and run the installer.",
              "Download update",
              false
            );
          } else {
            setUpdateUI(
              "Version " + MCPBridgeUpdater.CURRENT_VERSION,
              "You have the latest connector.",
              "Check again",
              false
            );
          }
        } catch (e) {
          showUpdateCheckError("GitHub returned an unreadable release.");
        }
      });
    }
  );
  request.setTimeout(10000, function () {
    request.destroy(new Error("Update check timed out"));
  });
  request.on("error", function () {
    showUpdateCheckError("Unable to check while offline.");
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
  if (!MCPBridgeUpdater.isTrustedDownloadUrl(latestUpdate.url)) {
    showUpdateCheckError("The update link was not trusted.");
    return;
  }
  try {
    var childProcess = nodeRequire("child_process");
    var command =
      os.platform() === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", "start", "", latestUpdate.url]]
        : ["open", [latestUpdate.url]];
    var child = childProcess.spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    document.getElementById("updateDetail").textContent =
      "Download opened. Close Premiere before installing.";
  } catch (e) {
    showUpdateCheckError("Could not open the download. Try again.");
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

  log("MCP Bridge CEP plugin loaded");
  setStatus("waiting", "Ready — click Start Bridge");

  // Always auto-start. The headless instance (StartOn ApplicationActivate) has no
  // one to click Start, and macOS periodically purges the temp dir — so create it
  // rather than gating auto-start on its existence.
  ensureDir(tempDir);
  log("Auto-starting bridge...");
  setTimeout(startBridge, 500);
  setTimeout(checkForUpdates, 1200);
})();
