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
}

// ---- File I/O via Node.js (CEP has access to Node) ----
var fs = require("fs");
var path = require("path");
var os = require("os");
tempDir = path.join(os.tmpdir(), "premiere-mcp-bridge");

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
      .filter(function (f) { return f.indexOf("cmd_") === 0 && f.indexOf(".jsx") > 0; })
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

function processOneCommand(cmdFileName) {
  var cmdFilePath = path.join(tempDir, cmdFileName);
  var script = readFile(cmdFilePath);
  if (!script) {
    log("Failed to read: " + cmdFileName, "err");
    deleteFile(cmdFilePath);
    return;
  }

  // Derive response filename: cmd_12345.jsx -> res_12345.json
  var id = cmdFileName.replace("cmd_", "").replace(".jsx", "");
  var resFilePath = path.join(tempDir, "res_" + id + ".json");

  log("Executing: " + cmdFileName + " (" + script.length + " chars)", "cmd");

  // Delete the command file immediately to avoid re-processing
  deleteFile(cmdFilePath);

  executeScript(script, function (result) {
    commandCount++;
    document.getElementById("cmdCount").textContent = commandCount;

    var response;
    try {
      // ExtendScript returns a string; try to parse it as JSON
      if (result && result !== "undefined" && result !== "null") {
        // Check if it's already valid JSON
        var parsed = JSON.parse(result);
        response = JSON.stringify(parsed);
      } else {
        response = JSON.stringify({ success: true, data: result || null });
      }
      log("Result: OK", "ok");
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

  // Auto-start if temp dir exists
  if (fs.existsSync(tempDir)) {
    log("Temp directory exists, auto-starting...");
    setTimeout(startBridge, 500);
  }
})();
