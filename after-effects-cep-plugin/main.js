/* Dedicated AE CEP file bridge. It deliberately uses a different directory
 * from the Premiere connector so simultaneous Adobe hosts cannot claim each
 * other's ExtendScript commands. */
(function () {
  var cs = new CSInterface();
  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var os = nodeRequire("os");
  var nodeProcess = nodeRequire("process");
  var childProcess = nodeRequire("child_process");
  var bridgeDirectorySecurity = MCPBridgeDirectorySecurity.createBridgeDirectorySecurity({
    fs: fs,
    path: path,
    platform: os.platform(),
    process: nodeProcess,
    childProcess: childProcess,
    Buffer: Buffer,
  });
  var pollTimer = null;
  var heartbeatTimer = null;
  var running = false;
  var tempDir = defaultBridgeDirectory();
  var engineId = Math.random().toString(36).slice(2, 8);

  function nodeRequire(moduleName) {
    if (typeof require !== "undefined") return require(moduleName);
    var node = typeof cep_node !== "undefined" ? cep_node : window.cep_node;
    if (node && typeof node.require === "function") return node.require(moduleName);
    throw new Error("Node.js is unavailable. Confirm --enable-nodejs in the CEP manifest, then fully restart After Effects.");
  }

  function defaultBridgeDirectory() {
    try {
      var process = nodeRequire("process");
      var configured = process && process.env && process.env.AFTER_EFFECTS_MCP_TEMP_DIR;
      if (typeof configured === "string" && configured.trim()) return configured.trim();
    } catch (ignored) {}
    return path.join(os.tmpdir(), "after-effects-mcp-bridge");
  }

  function setStatus(value, active) {
    document.getElementById("status").textContent = value;
    document.getElementById("status").style.color = active ? "#86efac" : "#fca5a5";
    document.getElementById("toggle").textContent = active ? "Stop connector" : "Start connector";
  }

  function writeFileAtomic(filePath, text) {
    var staged = filePath + "." + engineId + ".staged";
    try {
      fs.writeFileSync(staged, text, "utf8");
      fs.renameSync(staged, filePath);
      return true;
    } catch (error) {
      try { if (fs.existsSync(staged)) fs.unlinkSync(staged); } catch (ignored) {}
      setStatus("Connector needs attention", false);
      return false;
    }
  }

  function heartbeat() {
    if (!tempDir) return;
    writeFileAtomic(path.join(tempDir, "bridge-heartbeat.json"), JSON.stringify({ protocolVersion: 1, state: running ? "running" : "waiting" }));
  }

  function readCommandFiles() {
    try {
      return fs.readdirSync(tempDir).filter(function (entry) {
        return entry.indexOf("cmd_") === 0 && entry.slice(-4) === ".jsx";
      }).sort();
    } catch (ignored) { return []; }
  }

  function replyFor(result) {
    if (!result || result === "undefined" || result === "null") {
      return JSON.stringify({ success: false, error: "The After Effects connector received an empty evalScript result. Reopen the panel and retry once." });
    }
    try { return JSON.stringify(JSON.parse(result)); }
    catch (ignored) {
      return result.indexOf("Error") === 0
        ? JSON.stringify({ success: false, error: result })
        : JSON.stringify({ success: true, data: result });
    }
  }

  // The visible panel and the headless auto-start instance both run this file.
  // The rename claim decides which one owns a command; each instance runs one
  // command at a time because After Effects' scripting engine is stateful.
  var commandInFlight = false;

  function processOne(fileName) {
    var source = path.join(tempDir, fileName);
    var claim = source + "." + engineId + ".claimed";
    try { fs.renameSync(source, claim); } catch (ignored) { return; }
    var script;
    try { script = fs.readFileSync(claim, "utf8"); } catch (error) { script = null; }
    try { if (fs.existsSync(claim)) fs.unlinkSync(claim); } catch (ignored) {}
    if (!script) return;
    commandInFlight = true;
    var id = fileName.replace("cmd_", "").replace(".jsx", "");
    var busy = path.join(tempDir, "busy_" + id + ".json");
    var started = Date.now();
    var busyTimer = setInterval(function () {
      try { fs.writeFileSync(busy, JSON.stringify({ id: id, elapsedMs: Date.now() - started }), "utf8"); } catch (ignored) {}
    }, 2000);
    cs.evalScript(script, function (result) {
      commandInFlight = false;
      clearInterval(busyTimer);
      try { if (fs.existsSync(busy)) fs.unlinkSync(busy); } catch (ignored) {}
      writeFileAtomic(path.join(tempDir, "res_" + id + ".json"), replyFor(String(result || "")));
    });
  }

  function processCommands() {
    if (commandInFlight) return;
    var files = readCommandFiles();
    if (files.length > 0) processOne(files[0]);
  }

  function start() {
    tempDir = document.getElementById("tempDir").value.trim();
    if (!tempDir) { setStatus("Set a bridge directory", false); return; }
    try {
      tempDir = bridgeDirectorySecurity.ensurePrivateBridgeDirectory(tempDir);
      document.getElementById("tempDir").value = tempDir;
    } catch (error) {
      setStatus("Connector needs attention: " + error.message, false);
      return;
    }
    running = true;
    heartbeat();
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    pollTimer = setInterval(processCommands, 200);
    heartbeatTimer = setInterval(heartbeat, 1000);
    try { localStorage.setItem("after_effects_mcp_temp_dir", tempDir); } catch (ignored) {}
    setStatus("Connector running", true);
  }

  function stop() {
    running = false;
    // Leave the last heartbeat alone: a headless instance may still be running,
    // and its heartbeat must not be overwritten with "waiting" by this panel.
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    pollTimer = null;
    heartbeatTimer = null;
    setStatus("Stopped", false);
  }

  // Premiere's Dynamic Link starts a windowless After Effects (aerendercore,
  // under dynamiclinkmanager) that loads CEP extensions too. A connector there
  // claims commands meant for the user's After Effects, answers for a different
  // project and hangs on anything that needs a window, so it stays idle.
  function ancestorNames() {
    var names = [];
    var pid = nodeProcess.pid;
    for (var depth = 0; depth < 6 && pid > 1; depth++) {
      var line = "";
      try {
        if (os.platform() === "win32") {
          line = String(childProcess.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
            "$p = Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid + "'; if ($p) { \"$($p.ParentProcessId) $($p.Name)\" }"], { timeout: 4000, windowsHide: true }));
        } else {
          line = String(childProcess.execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { timeout: 2000 }));
        }
      } catch (ignored) { break; }
      var match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
      if (!match) break;
      names.push(match[2]);
      pid = Number(match[1]);
    }
    return names;
  }

  function insideRenderEngine(done) {
    var names = ancestorNames();
    for (var i = 0; i < names.length; i++) if (/aerendercore|aerender(\.exe)?$/i.test(names[i])) return done(true);
    cs.evalScript("(function(){try{return String(app.isRenderEngine===true);}catch(e){return 'false';}}())", function (result) {
      done(String(result) === "true");
    });
  }

  var field = document.getElementById("tempDir");
  try { field.value = localStorage.getItem("after_effects_mcp_temp_dir") || tempDir; } catch (ignored) { field.value = tempDir; }
  document.getElementById("toggle").onclick = function () { if (running) stop(); else start(); };
  // Start automatically: the headless instance (StartOn ApplicationActivate) has
  // no one to click Start, so without this the connector never ran unattended.
  insideRenderEngine(function (renderEngine) {
    if (renderEngine) { setStatus("Idle in the Dynamic Link render engine", false); return; }
    setTimeout(start, 500);
  });
}());
