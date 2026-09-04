/* Dedicated AE CEP file bridge. It deliberately uses a different directory
 * from the Premiere connector so simultaneous Adobe hosts cannot claim each
 * other's ExtendScript commands. */
(function () {
  var cs = new CSInterface();
  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var os = nodeRequire("os");
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

  function processOne(fileName) {
    var source = path.join(tempDir, fileName);
    var claim = source + "." + engineId + ".claimed";
    try { fs.renameSync(source, claim); } catch (ignored) { return; }
    var script;
    try { script = fs.readFileSync(claim, "utf8"); } catch (error) { script = null; }
    try { if (fs.existsSync(claim)) fs.unlinkSync(claim); } catch (ignored) {}
    if (!script) return;
    var id = fileName.replace("cmd_", "").replace(".jsx", "");
    var busy = path.join(tempDir, "busy_" + id + ".json");
    var started = Date.now();
    var busyTimer = setInterval(function () {
      try { fs.writeFileSync(busy, JSON.stringify({ id: id, elapsedMs: Date.now() - started }), "utf8"); } catch (ignored) {}
    }, 2000);
    cs.evalScript(script, function (result) {
      clearInterval(busyTimer);
      try { if (fs.existsSync(busy)) fs.unlinkSync(busy); } catch (ignored) {}
      writeFileAtomic(path.join(tempDir, "res_" + id + ".json"), replyFor(String(result || "")));
    });
  }

  function processCommands() {
    var files = readCommandFiles();
    for (var index = 0; index < files.length; index++) processOne(files[index]);
  }

  function start() {
    tempDir = document.getElementById("tempDir").value.trim();
    if (!tempDir) { setStatus("Set a bridge directory", false); return; }
    try { fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 }); }
    catch (error) { setStatus("Cannot create bridge directory", false); return; }
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
    heartbeat();
    if (pollTimer) clearInterval(pollTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    pollTimer = null;
    heartbeatTimer = null;
    setStatus("Stopped", false);
  }

  var field = document.getElementById("tempDir");
  try { field.value = localStorage.getItem("after_effects_mcp_temp_dir") || tempDir; } catch (ignored) { field.value = tempDir; }
  document.getElementById("toggle").onclick = function () { if (running) stop(); else start(); };
}());
