/* MCP for Adobe Premiere Pro - in-panel AI agent host.
 *
 * Runs inside the CEP panel's Node context, after main.js. It drives the
 * official CLIs the user is already signed in to (Claude Code, Codex, Grok)
 * headless, one turn at a time. Each CLI reaches Premiere through the
 * premiere-pro-mcp stdio server, which talks to this panel's file bridge.
 * The CLIs get only the Premiere MCP tools: no shell, file, browser or web.
 *
 * The page (chat-ui.js) talks to this host through window.MCPAgentHost with
 * the same message protocol as the InventorAgent WebView2 panel.
 */
(function () {
  "use strict";

  // The headless engine shares index.html but has no UI; it never runs agents.
  if (typeof IS_HEADLESS_ENGINE !== "undefined" && IS_HEADLESS_ENGINE) return;

  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var os = nodeRequire("os");
  var childProcess = nodeRequire("child_process");
  var crypto = nodeRequire("crypto");
  var nodeProcess = nodeRequire("process");
  var env = nodeProcess.env || {};

  var IS_WIN = os.platform() === "win32";
  var HOME = os.homedir();
  var LOCAL_DATA = IS_WIN ? env.LOCALAPPDATA || path.join(HOME, "AppData", "Local") : path.join(HOME, "Library", "Application Support");
  var ROAMING_DATA = IS_WIN ? env.APPDATA || path.join(HOME, "AppData", "Roaming") : LOCAL_DATA;
  var DATA_DIR = path.join(LOCAL_DATA, "PremiereAgent");
  var WORK_DIR = path.join(DATA_DIR, "work");
  var HISTORY_DIR = path.join(DATA_DIR, "history");
  var SETTINGS_FILE = path.join(ROAMING_DATA, "PremiereAgent", "settings.json");
  var LIVE_MODELS_FILE = path.join(DATA_DIR, "models.json");
  var NPM_GLOBAL = path.join(ROAMING_DATA, "npm");
  var CODEX_HOME = env.CODEX_HOME || path.join(HOME, ".codex");

  var ACCOUNTS = ["ClaudeAccount", "ChatGPTAccount", "GrokAccount"];
  var LABELS = { ClaudeAccount: "Claude", ChatGPTAccount: "ChatGPT", GrokAccount: "Grok" };
  var TOOL_PACKS = ["full", "essential", "inspection", "assistant-edit", "captions", "delivery", "intake"];

  var SYSTEM_PROMPT = [
    "You are a video editing assistant working inside Adobe Premiere Pro. You inspect and edit the user's open",
    "Premiere project by calling the Premiere tools you've been given (the \"premiere\" MCP server).",
    "",
    "Scope: you work only on the open Premiere project, through the Premiere tools. You have no shell, file system,",
    "browser or internet access, and you don't need any. If a request has nothing to do with editing in Premiere Pro,",
    "say briefly that you can only help with this Premiere project.",
    "",
    "How to work:",
    "- Start by inspecting the current state (for example get_project_info, get_active_sequence or",
    "  get_timeline_summary) unless you already know it. Never guess clip, track or sequence ids - list them.",
    "- Work in small steps and read back what changed. Mutating tools report committed, verified,",
    "  committed_unverified or failed. Only call something done when it is verified; tell the user plainly about",
    "  anything unverified or failed rather than retrying blindly.",
    "- Check each tool's description for its time units (seconds, ticks or timecode) before passing times.",
    "- Prefer non-destructive edits. Ask before deleting media, removing sequences or overwriting files.",
    "- If a request is ambiguous in a way that changes the edit, pick a sensible default, do it, and say what you chose.",
    "- When the user says \"this\", \"the selected clip\" or \"here\", read the selection or playhead position first.",
    "- When you finish, summarise briefly what you changed (sequence, tracks, times).",
  ].join("\n");

  // ------------------------------------------------------------------ files

  function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function writeAtomic(file, text) {
    ensureDir(path.dirname(file));
    var temp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    fs.writeFileSync(temp, text, "utf8");
    fs.renameSync(temp, file);
  }

  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      return fallback;
    }
  }

  function existing(file) {
    try {
      return file && fs.statSync(file).isFile() ? file : null;
    } catch (e) {
      return null;
    }
  }

  function findOnPath(name) {
    var names = IS_WIN && !/\.(exe|cmd)$/i.test(name) ? [name + ".exe"] : [name];
    var dirs = String(env.PATH || env.Path || "").split(path.delimiter);
    for (var i = 0; i < dirs.length; i++) {
      for (var j = 0; j < names.length; j++) {
        var candidate = dirs[i] && existing(path.join(dirs[i].trim(), names[j]));
        if (candidate) return candidate;
      }
    }
    return null;
  }

  function findFile(dir, fileName, mustContain, depth) {
    if (depth > 8) return null;
    var entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return null;
    }
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(dir, entries[i].name);
      if (entries[i].isFile() && entries[i].name.toLowerCase() === fileName && full.indexOf(mustContain) !== -1) return full;
    }
    for (var k = 0; k < entries.length; k++) {
      if (!entries[k].isDirectory()) continue;
      var found = findFile(path.join(dir, entries[k].name), fileName, mustContain, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // ------------------------------------------------------------------ settings

  function loadSettings() {
    var s = readJson(SETTINGS_FILE, {}) || {};
    return {
      backend: ACCOUNTS.indexOf(s.backend) !== -1 ? s.backend : "ClaudeAccount",
      models: s.models || {},
      thinking: s.thinking || {},
      modelList: s.modelList || {},
      disabledModels: s.disabledModels || {},
      seenModels: s.seenModels || {},
      mcpServer: typeof s.mcpServer === "string" ? s.mcpServer : "",
      toolPack: TOOL_PACKS.indexOf(s.toolPack) !== -1 ? s.toolPack : "full",
    };
  }

  var settings = loadSettings();

  function saveSettings() {
    try {
      writeAtomic(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (e) {
      toast("Couldn't save settings: " + e.message);
    }
  }

  // ------------------------------------------------------------------ CLI discovery

  var Exes = {
    ClaudeAccount: function () {
      return (
        findOnPath("claude") ||
        existing(path.join(HOME, ".local", "bin", IS_WIN ? "claude.exe" : "claude")) ||
        existing(path.join(NPM_GLOBAL, "node_modules", "@anthropic-ai", "claude-code", "bin", IS_WIN ? "claude.exe" : "claude"))
      );
    },
    // The npm package installs a cmd shim; use the native binary it wraps so arguments pass through untouched.
    ChatGPTAccount: function () {
      if (IS_WIN) {
        var pkg = path.join(NPM_GLOBAL, "node_modules", "@openai", "codex");
        var native = findFile(pkg, "codex.exe", path.sep + "bin" + path.sep, 0);
        if (native) return native;
      }
      return findOnPath("codex");
    },
    GrokAccount: function () {
      return findOnPath("grok") || existing(path.join(HOME, ".grok", "bin", IS_WIN ? "grok.exe" : "grok"));
    },
  };

  function exeFor(backend) {
    try {
      return Exes[backend]();
    } catch (e) {
      return null;
    }
  }

  function runCapture(exe, args, timeoutMs) {
    return new Promise(function (resolve) {
      childProcess.execFile(
        exe,
        args,
        { cwd: ensureDir(WORK_DIR), windowsHide: true, timeout: timeoutMs || 20000, maxBuffer: 4 * 1024 * 1024 },
        function (error, stdout, stderr) {
          resolve({ error: error, text: String(stdout || "") + String(stderr || "") });
        }
      );
    });
  }

  // ------------------------------------------------------------------ account status

  var status = {};
  ACCOUNTS.forEach(function (b) {
    status[b] = { state: "Checking", detail: null };
  });

  function getStatus(backend) {
    var exe = exeFor(backend);
    if (!exe) {
      return Promise.resolve({
        state: "NotInstalled",
        detail: {
          ClaudeAccount: "Install Claude Code to sign in with a Claude plan.",
          ChatGPTAccount: "Install Codex CLI (npm i -g @openai/codex) to sign in with ChatGPT.",
          GrokAccount: "Install the Grok CLI to sign in with a Grok account.",
        }[backend],
      });
    }
    if (backend === "ClaudeAccount") {
      return runCapture(exe, ["auth", "status"]).then(function (r) {
        try {
          var j = JSON.parse(r.text.slice(r.text.indexOf("{")));
          return j.loggedIn ? { state: "SignedIn", detail: j.email || null } : { state: "SignedOut" };
        } catch (e) {
          return { state: "SignedOut", detail: r.text.trim().slice(0, 200) || null };
        }
      });
    }
    if (backend === "ChatGPTAccount") {
      return runCapture(exe, ["login", "status"]).then(function (r) {
        var t = r.text;
        return /Logged in/i.test(t) && !/Not logged/i.test(t)
          ? { state: "SignedIn", detail: t.trim().replace("Logged in using ", "via ") }
          : { state: "SignedOut" };
      });
    }
    // "grok models" both confirms the login and lists the models this account can use right now.
    return runCapture(exe, ["models"], 60000).then(function (r) {
      if (!/logged in/i.test(r.text)) return { state: "SignedOut" };
      var models = [];
      var re = /^\s*[*-]\s+([A-Za-z0-9._-]+)/gm;
      var m;
      while ((m = re.exec(r.text))) if (models.indexOf(m[1]) === -1) models.push(m[1]);
      setLive("GrokAccount", models.map(function (id) {
        return { id: id, label: prettyGrok(id), levels: GROK_LEVELS, defaultLevel: "high" };
      }));
      var account = /logged in with ([^\s.]+(?:\.[a-z]+)?)/i.exec(r.text);
      return { state: "SignedIn", detail: account ? account[1] : "signed in" };
    });
  }

  function openConsole(title, exe, args) {
    return new Promise(function (resolve) {
      var child;
      if (IS_WIN) {
        var line = '/d /s /c "title ' + title + ' & "' + exe + '" ' + args + ' & timeout /t 4"';
        child = childProcess.spawn("cmd.exe", [line], { detached: true, windowsHide: false, windowsVerbatimArguments: true, stdio: "ignore" });
      } else {
        var script = "'" + exe.replace(/'/g, "'\\''") + "' " + args;
        child = childProcess.spawn("osascript", ["-e", 'tell application "Terminal" to do script "' + script.replace(/"/g, '\\"') + '"'], { stdio: "ignore" });
      }
      child.on("error", function () { resolve(); });
      child.on("exit", function () { resolve(); });
    });
  }

  function signIn(backend) {
    var exe = exeFor(backend);
    if (!exe) return Promise.reject(new Error(LABELS[backend] + " sign-in isn't available on this computer."));
    var args = { ClaudeAccount: "auth login", ChatGPTAccount: "login", GrokAccount: "login" }[backend];
    var wait = openConsole("Sign in to " + LABELS[backend], exe, args);
    // On macOS Terminal returns at once; give the browser login time before re-checking.
    return IS_WIN ? wait : wait.then(function () { return new Promise(function (r) { setTimeout(r, 30000); }); });
  }

  function npmInstallScript(pkg) {
    return [
      "if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {",
      "  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {",
      "    Start-Process 'https://nodejs.org/en/download'",
      "    throw 'Node.js is needed first. Install it from the page that just opened, then press Install again.'",
      "  }",
      "  Write-Host 'Installing Node.js first...' -ForegroundColor Cyan",
      "  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements",
      "  Update-Path",
      "  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js did not install.' }",
      "}",
      "npm install -g " + pkg,
      "if ($LASTEXITCODE -ne 0) { throw \"npm install exited with code $LASTEXITCODE\" }",
    ].join("\n");
  }

  function install(backend) {
    if (!IS_WIN) return Promise.reject(new Error("Install " + LABELS[backend] + "'s CLI from a terminal, then press Refresh."));
    var name = { ClaudeAccount: "Claude Code", ChatGPTAccount: "Codex CLI", GrokAccount: "Grok CLI" }[backend];
    var steps = {
      ClaudeAccount: "irm https://claude.ai/install.ps1 | iex",
      ChatGPTAccount: npmInstallScript("@openai/codex"),
      GrokAccount: npmInstallScript("@xai-official/grok"),
    }[backend];
    var script = [
      "$ErrorActionPreference = 'Stop'",
      "$Host.UI.RawUI.WindowTitle = 'Installing " + name + "'",
      "function Update-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }",
      "Update-Path",
      "try {",
      "  Write-Host 'Installing " + name + "...' -ForegroundColor Cyan",
      steps,
      "  Write-Host ''",
      "  Write-Host '" + name + " installed. Return to Premiere Pro to sign in.' -ForegroundColor Green",
      "  Start-Sleep -Seconds 3",
      "} catch {",
      "  Write-Host ''",
      "  Write-Host \"Install failed: $($_.Exception.Message)\" -ForegroundColor Red",
      "  Read-Host 'Press Enter to close'",
      "  exit 1",
      "}",
    ].join("\r\n");
    var file = path.join(ensureDir(WORK_DIR), "install-" + backend + ".ps1");
    fs.writeFileSync(file, script, "utf8");
    return new Promise(function (resolve, reject) {
      var line = '/d /s /c "start "Installing ' + name + '" /wait powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + file + '""';
      var child = childProcess.spawn("cmd.exe", [line], { detached: true, windowsHide: true, windowsVerbatimArguments: true, stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", function (code) {
        // Premiere's PATH predates the install; pick up the new one for discovery.
        try {
          var fresh = childProcess.execFileSync("powershell.exe", ["-NoProfile", "-Command",
            "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"],
            { windowsHide: true, encoding: "utf8" }).trim();
          if (fresh) env.PATH = fresh;
        } catch (e) {}
        if (code) reject(new Error(name + " didn't install - see the install window for why."));
        else resolve();
      });
    });
  }

  // ------------------------------------------------------------------ models

  var CLAUDE_LEVELS = ["low", "medium", "high", "xhigh", "max"];
  var GROK_LEVELS = ["low", "medium", "high", "xhigh"];

  function opt(id, label, levels, defaultLevel) {
    return { id: id, label: label, levels: levels || null, defaultLevel: defaultLevel || null };
  }

  var CLAUDE_CATALOG = [
    opt("claude-fable-5-1", "Fable 5.1", CLAUDE_LEVELS, "high"),
    opt("claude-opus-5-5", "Opus 5.5", CLAUDE_LEVELS, "high"),
    opt("claude-sonnet-5-5", "Sonnet 5.5", CLAUDE_LEVELS, "high"),
    opt("claude-haiku-5-5", "Haiku 5.5", CLAUDE_LEVELS, "medium"),
    opt("claude-opus-5", "Opus 5", CLAUDE_LEVELS, "high"),
    opt("claude-sonnet-5", "Sonnet 5", CLAUDE_LEVELS, "high"),
    opt("claude-opus-4-8", "Opus 4.8", CLAUDE_LEVELS, "high"),
    opt("claude-haiku-4-5", "Haiku 4.5"),
  ];
  // Claude Code resolves these aliases to the newest model of each family, so they never go stale.
  var CLAUDE_ALIASES = [
    opt("opus", "Opus (latest)", CLAUDE_LEVELS, "high"),
    opt("fable", "Fable (latest)", CLAUDE_LEVELS, "high"),
    opt("sonnet", "Sonnet (latest)", CLAUDE_LEVELS, "high"),
    opt("haiku", "Haiku (latest)", CLAUDE_LEVELS, "medium"),
  ];
  var GROK_FALLBACK = [opt("grok-4.7", "Grok 4.7", GROK_LEVELS, "high")];

  function prettyGrok(id) {
    return id.split("-").map(function (p) { return p ? p.charAt(0).toUpperCase() + p.slice(1) : p; }).join(" ");
  }

  var live = readJson(LIVE_MODELS_FILE, {}) || {};

  function setLive(backend, models) {
    if (!models.length) return;
    live[backend] = models;
    try { writeAtomic(LIVE_MODELS_FILE, JSON.stringify(live)); } catch (e) {}
  }

  // Codex caches the models the signed-in plan can use, with their reasoning levels; read it so the picker matches.
  function codexModels() {
    var j = readJson(path.join(CODEX_HOME, "models_cache.json"), null);
    if (!j || !Array.isArray(j.models)) return [opt("gpt-5", "GPT-5")];
    var models = j.models
      .filter(function (m) { return m && m.slug && m.visibility !== "hide"; })
      .sort(function (a, b) { return (typeof a.priority === "number" ? a.priority : 999) - (typeof b.priority === "number" ? b.priority : 999); })
      .map(function (m) {
        var levels = Array.isArray(m.supported_reasoning_levels)
          ? m.supported_reasoning_levels
              .map(function (x) { return typeof x === "string" ? x : x && x.effort; })
              .filter(function (x) { return x && x !== "ultra"; })
          : null;
        return opt(m.slug, m.display_name || m.slug, levels, m.default_reasoning_level || null);
      });
    return models.length ? models : [opt("gpt-5", "GPT-5")];
  }

  function catalog(backend) {
    if (backend === "ClaudeAccount") return CLAUDE_ALIASES.concat(CLAUDE_CATALOG);
    if (backend === "ChatGPTAccount") return codexModels();
    return live.GrokAccount && live.GrokAccount.length ? live.GrokAccount : GROK_FALLBACK;
  }

  function defaultList(backend) {
    return (backend === "ClaudeAccount" ? CLAUDE_ALIASES : catalog(backend)).map(function (m) { return m.id; });
  }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function allModels(backend) {
    var cat = catalog(backend);
    var disabled = settings.disabledModels[backend] || [];
    return (settings.modelList[backend] || defaultList(backend)).map(function (id) {
      return { model: find(cat, id) || opt(id, id), enabled: disabled.indexOf(id) === -1 };
    });
  }

  function availableToAdd(backend) {
    var listed = allModels(backend).map(function (x) { return x.model.id; });
    return catalog(backend).filter(function (m) { return listed.indexOf(m.id) === -1; });
  }

  function modelsFor(backend) {
    var enabled = allModels(backend).filter(function (x) { return x.enabled; }).map(function (x) { return x.model; });
    return enabled.length ? enabled : [catalog(backend)[0]];
  }

  function editableList(backend) {
    if (!settings.modelList[backend]) settings.modelList[backend] = defaultList(backend);
    return settings.modelList[backend];
  }

  function defaultModel(backend) {
    var models = modelsFor(backend);
    return find(models, settings.models[backend]) || models[0];
  }

  function thinkingLevel(backend, model) {
    var levels = model.levels;
    if (!levels || !levels.length) return null;
    var chosen = settings.thinking[backend];
    if (chosen && levels.indexOf(chosen) !== -1) return chosen;
    if (model.defaultLevel && levels.indexOf(model.defaultLevel) !== -1) return model.defaultLevel;
    return levels[Math.min(2, levels.length - 1)];
  }

  // Newly released models join the user's lists once; deleted ones stay deleted.
  function addNewModels() {
    var changed = false;
    ACCOUNTS.forEach(function (b) {
      var ids = catalog(b).map(function (m) { return m.id; });
      var seen = settings.seenModels[b];
      if (!seen) {
        settings.seenModels[b] = ids;
        changed = true;
        return;
      }
      var fresh = ids.filter(function (id) { return seen.indexOf(id) === -1; });
      if (!fresh.length) return;
      if (settings.modelList[b]) {
        var list = editableList(b);
        fresh.forEach(function (id) { if (list.indexOf(id) === -1) list.push(id); });
      }
      Array.prototype.push.apply(seen, fresh);
      changed = true;
    });
    return changed;
  }

  // ------------------------------------------------------------------ Premiere MCP server

  function nodeExe() {
    return findOnPath("node") || existing(IS_WIN ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/local/bin/node") ||
      existing("/opt/homebrew/bin/node");
  }

  /** How the CLIs start the premiere-pro-mcp stdio server. */
  function mcpLaunch() {
    var node = nodeExe();
    var override = (settings.mcpServer || "").trim();
    var launch = null;
    if (override) {
      if (!existing(override)) throw new Error("The MCP server set in Settings wasn't found: " + override);
      launch = /\.(c|m)?js$/i.test(override) ? { command: node, args: [override], source: "custom" } : { command: override, args: [], source: "custom" };
    } else {
      var globalEntry = existing(path.join(NPM_GLOBAL, "node_modules", "premiere-pro-mcp", "dist", "index.js")) ||
        existing("/usr/local/lib/node_modules/premiere-pro-mcp/dist/index.js") ||
        existing("/opt/homebrew/lib/node_modules/premiere-pro-mcp/dist/index.js");
      if (globalEntry) launch = { command: node, args: [globalEntry], source: "global" };
      else if (node) {
        var npxCli = existing(path.join(path.dirname(node), "node_modules", "npm", "bin", "npx-cli.js")) ||
          existing(path.join(path.dirname(node), "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"));
        if (npxCli) launch = { command: node, args: [npxCli, "-y", "premiere-pro-mcp"], source: "npx" };
      }
    }
    if (!launch || !launch.command) {
      throw new Error("Node.js wasn't found, so the Premiere MCP server can't start. Install Node.js 20.19+ (nodejs.org) and press Refresh.");
    }
    var serverEnv = { PREMIERE_TEMP_DIR: typeof tempDir === "string" ? tempDir : "" };
    if (settings.toolPack && settings.toolPack !== "full") serverEnv.PREMIERE_MCP_TOOL_PACKS = settings.toolPack;
    launch.env = serverEnv;
    return launch;
  }

  function mcpDescription() {
    try {
      var l = mcpLaunch();
      return { global: "Global install", npx: "npx premiere-pro-mcp (downloads on first use)", custom: "Custom: " + path.basename(settings.mcpServer) }[l.source];
    } catch (e) {
      return e.message;
    }
  }

  // ------------------------------------------------------------------ CLI sessions

  function textOf(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.filter(function (c) { return c && typeof c.text === "string"; }).map(function (c) { return c.text; }).join("\n");
    return content == null ? "" : JSON.stringify(content);
  }

  function killTree(child) {
    try {
      if (IS_WIN) childProcess.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch (e) {}
  }

  function tomlString(s) {
    return JSON.stringify(String(s)); // JSON string escapes are valid TOML basic-string escapes
  }

  function tomlArray(list) {
    return "[" + list.map(tomlString).join(", ") + "]";
  }

  function tomlTable(obj) {
    return "{ " + Object.keys(obj).map(function (k) { return k + " = " + tomlString(obj[k]); }).join(", ") + " }";
  }

  function instructionsFirst(session, text) {
    return session.resumeId ? text : "<instructions>\n" + SYSTEM_PROMPT + "\n</instructions>\n\n" + text;
  }

  function createSession(backend, model, thinking) {
    var exe = exeFor(backend);
    if (!exe) throw new Error(LABELS[backend] + " isn't installed on this computer.");
    var launch = mcpLaunch();
    var session = { backend: backend, exe: exe, model: model, thinking: thinking, resumeId: null, turn: 0, hidden: {} };

    if (backend === "ClaudeAccount") {
      session.extraEnv = { MCP_TIMEOUT: "120000" }; // npx may download the server on first use
      session.promptOnStdin = true;
      session.buildPrompt = function (t) { return t; };
      session.buildArgs = function () {
        var config = path.join(ensureDir(WORK_DIR), "claude-mcp.json");
        fs.writeFileSync(config, JSON.stringify({ mcpServers: { premiere: { type: "stdio", command: launch.command, args: launch.args, env: launch.env } } }));
        var args = [
          "-p", "--output-format", "stream-json", "--verbose",
          "--model", session.model,
          "--mcp-config", config, "--strict-mcp-config",
          "--allowedTools", "mcp__premiere", // every Premiere tool, nothing else
          "--tools", "", // no file/shell tools
          "--setting-sources", "", // ignore personal hooks/settings
          "--append-system-prompt", SYSTEM_PROMPT,
        ];
        if (session.thinking) args.push("--effort", session.thinking);
        if (session.resumeId) args.push("--resume", session.resumeId);
        return args;
      };
      session.handle = function (evt, o) {
        if (typeof evt.session_id === "string") session.resumeId = evt.session_id;
        if (evt.type === "assistant" && evt.message && Array.isArray(evt.message.content)) {
          evt.message.content.forEach(function (b) {
            if (b.type === "text" && b.text) o.assistant(b.text);
            else if (b.type === "tool_use") o.toolCall(b.id, String(b.name).replace(/^mcp__premiere__/, ""), JSON.stringify(b.input || {}));
          });
        } else if (evt.type === "user" && evt.message && Array.isArray(evt.message.content)) {
          evt.message.content.forEach(function (b) {
            if (b.type === "tool_result") o.toolResult(b.tool_use_id, textOf(b.content), b.is_error === true);
          });
        } else if (evt.type === "result" && evt.is_error === true) {
          var msg = String(evt.result || "Claude Code reported an error.");
          return /login|auth/i.test(msg) ? msg + "\n\nSign in to Claude from the model menu." : msg;
        }
        return null;
      };
    } else if (backend === "ChatGPTAccount") {
      var locked = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external", "in_app_browser",
        "computer_use", "image_generation", "multi_agent", "memories", "view_image", "goals"];
      session.promptOnStdin = true;
      session.buildPrompt = function (t) { return instructionsFirst(session, t); };
      session.buildArgs = function () {
        var args = [
          "exec", "--json", "--skip-git-repo-check", "--ignore-user-config",
          "--sandbox", "read-only",
          "-m", session.model,
          "-c", "mcp_servers.premiere.command=" + tomlString(launch.command),
          "-c", "mcp_servers.premiere.args=" + tomlArray(launch.args),
          "-c", "mcp_servers.premiere.env=" + tomlTable(launch.env),
          "-c", "mcp_servers.premiere.startup_timeout_sec=120",
          "-c", "mcp_servers.premiere.tool_timeout_sec=600",
          "-c", "mcp_servers.premiere.default_tools_approval_mode=\"approve\"",
          "-c", "web_search=\"disabled\"",
        ];
        locked.forEach(function (f) { args.push("-c", "features." + f + "=false"); });
        if (session.thinking) args.push("-c", "model_reasoning_effort=" + tomlString(session.thinking));
        if (session.resumeId) args.push("resume", session.resumeId);
        args.push("-");
        return args;
      };
      session.handle = function (evt, o) {
        if (evt.type === "thread.started") session.resumeId = evt.thread_id;
        else if ((evt.type === "item.started" || evt.type === "item.completed") && evt.item) {
          var item = evt.item;
          var id = session.turn + "-" + item.id; // item ids restart every turn
          if (item.type === "mcp_tool_call") {
            if (evt.type === "item.started") o.toolCall(id, item.tool, JSON.stringify(item.arguments || {}));
            else if (item.error && typeof item.error === "object") o.toolResult(id, item.error.message || "Tool failed.", true);
            else o.toolResult(id, item.result && item.result.content ? textOf(item.result.content) : "", !!(item.result && item.result.isError));
          } else if (item.type === "agent_message" && evt.type === "item.completed" && item.text) {
            o.assistant(item.text);
          }
        } else if (evt.type === "error") {
          var message = evt.message || "Codex reported an error.";
          if (!/^Reconnecting/i.test(message)) return message; // Codex reports its own retries as errors
        } else if (evt.type === "turn.failed") {
          return (evt.error && evt.error.message) || "The turn failed.";
        }
        return null;
      };
    } else {
      session.promptOnStdin = false;
      session.buildPrompt = function (t) { return instructionsFirst(session, t); };
      session.buildArgs = function (prompt) {
        // Grok reads MCP servers from ./.grok/config.toml in its working folder.
        var configDir = ensureDir(path.join(WORK_DIR, ".grok"));
        fs.writeFileSync(path.join(configDir, "config.toml"),
          "[mcp_servers.premiere]\ncommand = " + tomlString(launch.command) + "\nargs = " + tomlArray(launch.args) +
          "\nenv = " + tomlTable(launch.env) + "\nenabled = true\n");
        var args = [
          "-p", prompt,
          "--output-format", "streaming-messages-json",
          "-m", session.model,
          "--trust",
          "--tools", "search_tool,use_tool", // MCP access only
          "--always-approve",
          "--no-subagents", "--no-plan", "--disable-web-search",
        ];
        if (session.thinking) args.push("--reasoning-effort", session.thinking);
        if (session.resumeId) args.push("--resume", session.resumeId);
        return args;
      };
      session.handle = function (evt, o) {
        if (typeof evt.session_id === "string") session.resumeId = evt.session_id;
        if (evt.type === "assistant" && evt.message && Array.isArray(evt.message.content)) {
          evt.message.content.forEach(function (b) {
            if (b.type === "text" && b.text) o.assistant(b.text);
            else if (b.type === "tool_use") {
              var un = unwrapGrok(b.name, b.input);
              if (un.name === null) session.hidden[b.id] = true;
              else o.toolCall(b.id, un.name, un.input);
            }
          });
        } else if (evt.type === "user" && evt.message && Array.isArray(evt.message.content)) {
          evt.message.content.forEach(function (b) {
            if (b.type === "tool_result" && !session.hidden[b.tool_use_id]) {
              var r = unwrapGrokResult(textOf(b.content), b.is_error === true);
              o.toolResult(b.tool_use_id, r.text, r.isError);
            }
          });
        } else if (evt.type === "result" && evt.is_error === true) {
          return String(evt.result || "Grok reported an error.");
        }
        return null;
      };
    }
    return session;
  }

  function unwrapGrok(name, input) {
    if (name === "search_tool") return { name: null, input: "" };
    if (name !== "use_tool" || !input || typeof input !== "object") return { name: name, input: JSON.stringify(input || {}) };
    var inner = input.tool_name || input.name || input.tool;
    var args = input.arguments || input.args || input.input || input.parameters || {};
    if (typeof inner !== "string") return { name: name, input: JSON.stringify(input) };
    return { name: inner.replace(/^premiere__/, ""), input: typeof args === "string" ? args : JSON.stringify(args) };
  }

  function unwrapGrokResult(text, isError) {
    try {
      var j = JSON.parse(text);
      if (j && typeof j === "object" && "output" in j) {
        if (typeof j.output === "string") return { text: j.output, isError: isError };
        if (j.output && typeof j.output === "object") {
          var key = Object.keys(j.output)[0];
          if (key) {
            var v = j.output[key];
            return { text: typeof v === "string" ? v : JSON.stringify(v), isError: isError || /err/i.test(key) };
          }
        }
      }
    } catch (e) {}
    return { text: text, isError: isError };
  }

  /** Runs one turn: starts the CLI, streams its JSONL events to the observer. Resolves when the CLI exits. */
  function runTurn(session, userText, observer, cancel) {
    session.turn++;
    var prompt = session.buildPrompt(userText);
    var args = session.buildArgs(prompt);
    return new Promise(function (resolve, reject) {
      var child;
      try {
        child = childProcess.spawn(session.exe, args, { cwd: ensureDir(WORK_DIR), windowsHide: true, env: Object.assign({}, env, session.extraEnv || {}) });
      } catch (e) {
        reject(new Error("Couldn't start " + path.basename(session.exe) + ": " + e.message));
        return;
      }
      var cancelled = false;
      cancel.kill = function () {
        cancelled = true;
        killTree(child);
      };
      var failure = null;
      var buffer = "";
      var stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", function (chunk) {
        buffer += chunk;
        var lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        lines.forEach(handleLine);
      });
      child.stderr.on("data", function (chunk) {
        if (stderr.length < 20000) stderr += chunk;
      });
      function handleLine(line) {
        if (line.charAt(0) !== "{") return;
        var evt;
        try {
          evt = JSON.parse(line);
        } catch (e) {
          return; // partial or non-JSON diagnostics
        }
        try {
          var f = session.handle(evt, observer);
          if (f && !failure) failure = f;
        } catch (e) {}
      }
      child.on("error", function (e) {
        reject(new Error("Couldn't start " + path.basename(session.exe) + ": " + e.message));
      });
      child.on("close", function (code) {
        if (buffer) handleLine(buffer);
        if (cancelled) {
          var c = new Error("Stopped.");
          c.cancelled = true;
          reject(c);
        } else if (failure) reject(new Error(failure));
        else if (code !== 0) reject(new Error(stderr.trim() || path.basename(session.exe) + " exited with code " + code + "."));
        else resolve();
      });
      try {
        if (session.promptOnStdin) child.stdin.write(prompt, "utf8"); // no BOM
        child.stdin.end();
      } catch (e) {}
    });
  }

  // ------------------------------------------------------------------ chat history

  function newId() {
    return crypto.randomBytes(16).toString("hex");
  }

  function validId(id) {
    return typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
  }

  function historyPath(id, trashed) {
    if (!validId(id)) throw new Error("Bad conversation id.");
    return path.join(trashed ? path.join(HISTORY_DIR, "trash") : HISTORY_DIR, id + ".json");
  }

  function recap(chat, includeReferences) {
    var out = "";
    chat.events.forEach(function (e) {
      var who = e.type === "user" ? "User" : e.type === "assistant" ? "Assistant" : null;
      if (!who) return;
      out += who + ": " + e.text + "\n";
      if (includeReferences !== false && typeof e.context === "string") out += e.context + "\n";
    });
    return out;
  }

  var History = {
    save: function (chat, touch) {
      if (touch !== false) chat.updated = new Date().toISOString();
      writeAtomic(historyPath(chat.id), JSON.stringify(chat));
    },
    load: function (id) {
      try {
        var chat = JSON.parse(fs.readFileSync(historyPath(id), "utf8"));
        if (!chat || chat.id !== id || !Array.isArray(chat.events) || ACCOUNTS.indexOf(chat.backend) === -1) return null;
        chat.title = chat.title || "Untitled";
        chat.model = chat.model || "";
        return chat;
      } catch (e) {
        return null;
      }
    },
    remove: function (id) {
      var p = historyPath(id);
      if (!existing(p)) return false;
      var trash = historyPath(id, true);
      ensureDir(path.dirname(trash));
      try { fs.unlinkSync(trash); } catch (e) {}
      fs.renameSync(p, trash);
      return true;
    },
    restore: function (id) {
      var p = historyPath(id);
      var trash = historyPath(id, true);
      if (!existing(trash) || existing(p)) return false;
      fs.renameSync(trash, p);
      return true;
    },
    loadWorkspace: function () {
      var w = readJson(path.join(HISTORY_DIR, "workspace.json"), {}) || {};
      return { activeId: validId(w.activeId) ? w.activeId : null, drafts: w.drafts || {}, deletedIds: w.deletedIds || [] };
    },
    saveWorkspace: function (w) {
      writeAtomic(path.join(HISTORY_DIR, "workspace.json"), JSON.stringify(w));
    },
    list: function () {
      var files;
      try {
        files = fs.readdirSync(HISTORY_DIR);
      } catch (e) {
        return [];
      }
      var list = [];
      files.forEach(function (f) {
        var id = f.replace(/\.json$/, "");
        if (!validId(id)) return;
        var c = History.load(id);
        if (!c) return;
        var messages = c.events.filter(function (e) { return e.type === "user" || e.type === "assistant"; });
        var preview = messages.length ? String(messages[messages.length - 1].text || "").replace(/[\r\n]+/g, " ") : "";
        list.push({
          id: c.id, title: c.title, backend: c.backend, model: c.model, updated: c.updated, pinned: !!c.pinned,
          messages: messages.length, preview: preview.length > 120 ? preview.slice(0, 120) + "…" : preview,
          searchText: recap(c, false),
        });
      });
      return list.sort(function (a, b) {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return String(b.updated).localeCompare(String(a.updated));
      });
    },
    referenceContext: function (ids, currentId) {
      var blocks = ids.filter(function (id) { return id !== currentId; }).slice(0, 3).map(function (id) {
        var c = History.load(id);
        if (!c) throw new Error("A referenced chat was deleted or couldn't be opened. Remove its mention and send again.");
        var r = recap(c, false);
        if (r.length > 12000) r = "[Earlier messages omitted]\n" + r.slice(r.length - 12000);
        return "Referenced chat: " + c.title + "\n" + r;
      });
      return blocks.length
        ? "Saved chat excerpts, for context only. The project may have changed since; inspect the current Premiere state before editing.\n\n" + blocks.join("\n\n---\n\n")
        : "";
    },
  };

  // ------------------------------------------------------------------ panel state

  var listener = null;
  var pageReady = false;
  var session = null;
  var running = null; // { kill } while a turn runs
  var conversation = null;
  var workspace = History.loadWorkspace();
  var saveWarning = false;

  function post(message) {
    if (!listener) return;
    var copy = JSON.parse(JSON.stringify(message));
    setTimeout(function () { listener({ data: copy }); }, 0);
  }

  function toast(text) {
    post({ type: "toast", text: text });
  }

  function isUsable(b) {
    return status[b] && status[b].state === "SignedIn";
  }

  function bridgeSummary() {
    var running = typeof bridgeRunning !== "undefined" && bridgeRunning;
    return running ? "Premiere connection: active" : "Premiere connection: starting…";
  }

  function pushState() {
    var groups = ACCOUNTS.map(function (b) {
      return {
        backend: b, label: LABELS[b], state: status[b].state, detail: status[b].detail, canSignIn: !!exeFor(b),
        models: modelsFor(b).map(function (m) { return { id: m.id, label: m.label }; }),
      };
    });
    var modelGroups = ACCOUNTS.map(function (b) {
      return {
        backend: b, label: LABELS[b],
        items: allModels(b).map(function (x) { return { id: x.model.id, label: x.model.label, enabled: x.enabled }; }),
        available: availableToAdd(b).map(function (m) { return { id: m.id, label: m.label }; }),
      };
    });
    var accounts = ACCOUNTS.map(function (b) {
      return { backend: b, label: LABELS[b], state: status[b].state, detail: status[b].detail, canSignIn: !!exeFor(b) };
    });
    var selected = settings.backend;
    var model = defaultModel(selected);
    post({
      type: "state",
      selected: {
        backend: selected, model: model.id, label: LABELS[selected] + " · " + model.label,
        usable: isUsable(selected) || status[selected].state === "Checking",
        thinking: thinkingLevel(selected, model), levels: model.levels || [],
      },
      groups: groups, accounts: accounts, modelGroups: modelGroups, keys: [],
      premiere: bridgeSummary(),
      mcp: { server: settings.mcpServer, description: mcpDescription(), toolPack: settings.toolPack, toolPacks: TOOL_PACKS },
    });
  }

  function pushHistory() {
    var items = History.list().map(function (c) {
      var m = find(catalog(c.backend), c.model);
      return {
        id: c.id, title: c.title, label: LABELS[c.backend] + " · " + (m ? m.label : c.model), updated: c.updated,
        current: !!conversation && c.id === conversation.id, pinned: c.pinned, messages: c.messages,
        preview: c.preview, searchText: c.searchText,
      };
    });
    post({ type: "history", items: items, canUndo: workspace.deletedIds.length > 0 });
  }

  function saveWorkspace() {
    try {
      History.saveWorkspace(workspace);
    } catch (e) {
      toast("Couldn't save the current chat selection: " + e.message);
    }
  }

  function saveConversation() {
    if (!conversation) return;
    try {
      History.save(conversation);
      saveWarning = false;
    } catch (e) {
      if (!saveWarning) toast("Couldn't save this chat: " + e.message);
      saveWarning = true;
    }
  }

  function emit(message) {
    if (conversation) conversation.events.push(JSON.parse(JSON.stringify(message)));
    post(message);
    saveConversation();
    if (message.type === "user" || message.type === "assistant") pushHistory();
  }

  function showConversation(includeDraft) {
    var key = conversation ? conversation.id : "new";
    post({ type: "conversation", id: conversation ? conversation.id : null, title: conversation ? conversation.title : "New chat", pinned: conversation ? !!conversation.pinned : false });
    if (includeDraft === false) return;
    var draft = workspace.drafts[key] || { text: "", references: [] };
    post({
      type: "draft", key: key, text: draft.text || "",
      references: (draft.references || []).map(function (id) {
        var c = History.load(id);
        return { id: id, title: c ? c.title : "Deleted chat" };
      }),
    });
  }

  function replayConversation() {
    post({ type: "clear" });
    showConversation();
    if (conversation) conversation.events.forEach(function (e) { post(e); });
    post({ type: "opened" });
    if (running) post({ type: "running", value: true });
  }

  function resetSession() {
    if (running) running.kill();
    session = null;
  }

  function canLeaveChat() {
    if (!running) return true;
    toast("Stop the current reply first.");
    return false;
  }

  function titleFrom(text) {
    var line = text.trim().split("\n")[0].trim();
    return line.length <= 60 ? line : line.slice(0, 57).trim() + "…";
  }

  function refreshAccounts() {
    return Promise.all(ACCOUNTS.map(function (b) {
      return getStatus(b).then(function (s) { status[b] = s; }, function (e) { status[b] = { state: "SignedOut", detail: e.message }; });
    })).then(function () {
      if (addNewModels()) saveSettings();
      // If the saved choice isn't usable, fall back to an account that is signed in.
      if (!running && !isUsable(settings.backend)) {
        var ready = ACCOUNTS.filter(isUsable)[0];
        if (ready) {
          if (settings.backend !== ready) session = null;
          settings.backend = ready;
          saveSettings();
        }
      }
      pushState();
    });
  }

  function send(text, referenceIds) {
    if (running || !text || !text.trim()) {
      post({ type: "sendRejected" });
      return;
    }
    var currentId = conversation ? conversation.id : null;
    var ids = (referenceIds || []).filter(function (id, i, a) { return validId(id) && a.indexOf(id) === i && id !== currentId; }).slice(0, 3);
    var context;
    try {
      context = History.referenceContext(ids, currentId);
    } catch (e) {
      post({ type: "sendRejected" });
      toast(e.message);
      return;
    }
    var oldKey = currentId || "new";
    var backend = settings.backend;
    var model = defaultModel(backend);
    if (!conversation) {
      conversation = { id: newId(), title: titleFrom(text), backend: backend, model: model.id, pinned: false, resumeId: null,
        created: new Date().toISOString(), updated: new Date().toISOString(), events: [] };
    }
    var chat = conversation;
    var earlier = chat.events.length ? recap(chat) : null;
    delete workspace.drafts[oldKey];
    workspace.activeId = chat.id;
    var user = { type: "user", text: text };
    if (context) {
      user.context = context;
      user.references = ids.map(function (id) {
        var c = History.load(id);
        return { id: id, title: c ? c.title : "Saved chat" };
      });
      text += "\n\n" + context;
    }
    emit(user);
    saveWorkspace();
    post({ type: "sent" });
    showConversation(false);
    var cancel = { kill: function () { cancel.requested = true; } };
    running = { kill: function () { cancel.kill(); } };
    post({ type: "running", value: true });

    var resumed = false;
    var turn;
    try {
      // Tool calls only run while the bridge polls, so make sure it is running.
      if (typeof bridgeRunning !== "undefined" && !bridgeRunning && typeof startBridge === "function" && !startBridge()) {
        throw new Error("The Premiere connection couldn't start: " +
          (typeof lastBridgeDirectoryError === "string" && lastBridgeDirectoryError ? lastBridgeDirectoryError : "no usable bridge directory.") +
          "\n\nSet the PREMIERE_TEMP_DIR user environment variable to a folder only you can write to, then restart Premiere Pro.");
      }
      if (!session) {
        session = createSession(backend, model.id, thinkingLevel(backend, model));
        // A saved chat resumes the CLI's own session when it's the same account; anything else gets a recap.
        if (chat.resumeId && chat.backend === backend) {
          session.resumeId = chat.resumeId;
          resumed = true;
        } else if (earlier) {
          text = "<earlier_conversation>\n" + earlier + "</earlier_conversation>\n\n" + text;
        }
        if (!resumed) chat.resumeId = null;
      }
      chat.backend = backend;
      chat.model = model.id;
      var observer = {
        assistant: function (t) { if (conversation === chat) emit({ type: "assistant", text: t }); },
        toolCall: function (id, name, input) { if (conversation === chat) emit({ type: "tool_call", id: id, name: name, input: input }); },
        toolResult: function (id, t, isError) { if (conversation === chat) emit({ type: "tool_result", id: id, ok: !isError, text: t }); },
      };
      turn = cancel.requested ? Promise.reject(Object.assign(new Error("Stopped."), { cancelled: true })) : runTurn(session, text, observer, cancel);
    } catch (e) {
      turn = Promise.reject(e);
    }

    turn.then(null, function (e) {
      if (e && e.cancelled) {
        emit({ type: "notice", text: "Stopped." });
      } else {
        emit({ type: "error", text: (e && e.message) || String(e) });
        if (resumed) post({ type: "notice", text: "Couldn't resume this chat's session. Send again and the conversation so far goes along with it." });
      }
      session = null; // history may end on an unanswered tool call; start clean
      chat.resumeId = null;
    }).then(function () {
      running = null;
      post({ type: "running", value: false });
      if (session && session.resumeId) chat.resumeId = session.resumeId;
      saveConversation();
      showConversation(false);
      pushHistory();
    });
  }

  function openChat(id) {
    if (running) {
      post({ type: "navigationRejected" });
      toast("Stop the current reply before opening another chat.");
      return;
    }
    if (conversation && id === conversation.id) {
      post({ type: "opened" });
      return;
    }
    var chat = validId(id) ? History.load(id) : null;
    if (!chat) {
      post({ type: "navigationRejected" });
      toast("That chat couldn't be opened.");
      pushHistory();
      return;
    }
    resetSession();
    conversation = chat;
    workspace.activeId = chat.id;
    saveWorkspace();
    if (isUsable(chat.backend) || status[chat.backend].state === "Checking") {
      settings.backend = chat.backend;
      settings.models[chat.backend] = chat.model;
      saveSettings();
    }
    replayConversation();
    pushHistory();
    pushState();
  }

  function updateChat(id, update) {
    var chat = conversation && id === conversation.id ? conversation : History.load(id);
    if (!chat) {
      toast("That chat couldn't be opened.");
      return;
    }
    update(chat);
    try { History.save(chat, false); } catch (e) { toast("Couldn't save this chat: " + e.message); }
    showConversation(false);
    pushHistory();
  }

  function deleteChats(ids) {
    var requested = ids.filter(function (id, i, a) { return validId(id) && a.indexOf(id) === i; });
    if (conversation && requested.indexOf(conversation.id) !== -1 && !canLeaveChat()) return;
    var deleted = [];
    requested.forEach(function (id) {
      try { if (History.remove(id)) deleted.push(id); } catch (e) {}
    });
    if (!deleted.length) return;
    workspace.deletedIds = deleted;
    if (conversation && deleted.indexOf(conversation.id) !== -1) {
      resetSession();
      conversation = null;
      workspace.activeId = null;
      replayConversation();
    }
    saveWorkspace();
    pushHistory();
    post({ type: "deleted", count: deleted.length });
  }

  function copyText(text) {
    if (!text) return;
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(area);
    toast(ok ? "Copied." : "Select the text and press Ctrl+C.");
  }

  function openUrl(url) {
    if (!/^https?:\/\//i.test(String(url))) return;
    try {
      cs.openURLInDefaultBrowser(url);
    } catch (e) {
      toast("Couldn't open the link.");
    }
  }

  function saveAndRefresh(reset) {
    saveSettings();
    if (reset) resetSession();
    pushState();
  }

  function handle(msg) {
    var b = msg.backend;
    if (b !== undefined && ACCOUNTS.indexOf(b) === -1) return;
    switch (msg.type) {
      case "ready":
        if (!pageReady) {
          pageReady = true;
          var active = workspace.activeId && History.load(workspace.activeId);
          if (active) {
            conversation = active;
            replayConversation();
          } else showConversation();
        } else replayConversation();
        pushHistory();
        pushState();
        refreshAccounts();
        break;
      case "refresh":
        pushState();
        refreshAccounts();
        break;
      case "send":
        send(String(msg.text || ""), Array.isArray(msg.references) ? msg.references : []);
        break;
      case "stop":
        if (running) running.kill();
        break;
      case "new":
        if (!canLeaveChat()) { post({ type: "navigationRejected" }); break; }
        resetSession();
        conversation = null;
        workspace.activeId = null;
        saveWorkspace();
        replayConversation();
        pushHistory();
        break;
      case "history":
        pushHistory();
        break;
      case "openChat":
        openChat(msg.id);
        break;
      case "deleteChat":
        deleteChats([msg.id]);
        break;
      case "deleteChats":
        deleteChats(Array.isArray(msg.ids) ? msg.ids : []);
        break;
      case "undoDelete":
        var restored = 0;
        workspace.deletedIds.slice().forEach(function (id) {
          try { if (History.restore(id)) restored++; } catch (e) {}
        });
        workspace.deletedIds = [];
        saveWorkspace();
        pushHistory();
        toast(restored ? restored + " chat(s) restored." : "No deleted chats to restore.");
        break;
      case "renameChat":
        var title = String(msg.title || "").trim();
        if (title) updateChat(msg.id, function (c) { c.title = title.slice(0, 120); });
        break;
      case "pinChat":
        updateChat(msg.id, function (c) { c.pinned = !c.pinned; });
        break;
      case "copyChat":
        var copied = conversation && msg.id === conversation.id ? conversation : validId(msg.id) ? History.load(msg.id) : null;
        if (copied) copyText(copied.title + "\n\n" + recap(copied));
        break;
      case "copy":
        copyText(String(msg.text || ""));
        break;
      case "openUrl":
        openUrl(msg.url);
        break;
      case "draft":
        var key = msg.key;
        if (key !== "new" && !validId(key)) break;
        var draft = {
          text: String(msg.text || ""),
          references: (Array.isArray(msg.references) ? msg.references : []).filter(function (id, i, a) { return validId(id) && a.indexOf(id) === i; }).slice(0, 3),
        };
        if (!draft.text && !draft.references.length) delete workspace.drafts[key];
        else workspace.drafts[key] = draft;
        saveWorkspace();
        break;
      case "select":
        if (!canLeaveChat()) break;
        var changed = b !== settings.backend || msg.model !== defaultModel(b).id;
        settings.backend = b;
        settings.models[b] = String(msg.model);
        saveSettings();
        if (changed && session) {
          resetSession();
          post({ type: "notice", text: "Now using " + LABELS[b] + " · " + defaultModel(b).label + ". The conversation so far carries over." });
        }
        pushState();
        break;
      case "setThinking":
        settings.thinking[settings.backend] = String(msg.level);
        saveSettings();
        if (session) session.thinking = String(msg.level);
        pushState();
        break;
      case "signIn":
        status[b] = { state: "Checking", detail: "finish signing in in the window that opened…" };
        pushState();
        signIn(b).then(null, function (e) { post({ type: "error", text: e.message }); }).then(function () {
          return getStatus(b).then(function (s) { status[b] = s; pushState(); });
        });
        break;
      case "install":
        status[b] = { state: "Checking", detail: "installing - see the window that opened…" };
        pushState();
        install(b).then(null, function (e) { post({ type: "error", text: e.message }); }).then(function () {
          return getStatus(b);
        }).then(function (s) {
          status[b] = s;
          pushState();
          if (s.state === "SignedOut" && exeFor(b)) handle({ type: "signIn", backend: b });
        });
        break;
      case "toggleModel":
        if (running && b === settings.backend && !msg.enabled && msg.id === defaultModel(b).id) {
          toast("Stop the current reply before disabling its model.");
          break;
        }
        var disabled = settings.disabledModels[b] || (settings.disabledModels[b] = []);
        if (msg.enabled) settings.disabledModels[b] = disabled.filter(function (x) { return x !== msg.id; });
        else if (disabled.indexOf(msg.id) === -1) disabled.push(msg.id);
        saveAndRefresh(false);
        break;
      case "addModel":
        if (!find(catalog(b), msg.id)) break;
        var list = editableList(b);
        if (list.indexOf(msg.id) === -1) list.push(msg.id);
        if (settings.disabledModels[b]) settings.disabledModels[b] = settings.disabledModels[b].filter(function (x) { return x !== msg.id; });
        saveAndRefresh(false);
        break;
      case "deleteModel":
        if (running && b === settings.backend && msg.id === defaultModel(b).id) {
          toast("Stop the current reply before deleting its model.");
          break;
        }
        var wasActive = settings.backend === b && settings.models[b] === msg.id;
        settings.modelList[b] = editableList(b).filter(function (x) { return x !== msg.id; });
        if (settings.disabledModels[b]) settings.disabledModels[b] = settings.disabledModels[b].filter(function (x) { return x !== msg.id; });
        saveAndRefresh(wasActive && !!session);
        break;
      case "setMcpServer":
        if (!canLeaveChat()) break;
        settings.mcpServer = String(msg.value || "").trim();
        saveAndRefresh(true);
        toast(settings.mcpServer ? "MCP server saved." : "Using the automatic MCP server.");
        break;
      case "setToolPack":
        if (!canLeaveChat() || TOOL_PACKS.indexOf(msg.value) === -1) break;
        settings.toolPack = msg.value;
        saveAndRefresh(true);
        break;
    }
  }

  window.MCPAgentHost = {
    postMessage: function (msg) {
      try {
        handle(msg || {});
      } catch (e) {
        post({ type: "navigationRejected" });
        toast(e.message);
      }
    },
    addEventListener: function (type, fn) {
      if (type === "message") listener = fn;
    },
    /** main.js calls this when the bridge starts or stops so the chat header and empty state stay current. */
    bridgeChanged: function () {
      if (pageReady) pushState();
    },
  };
})();
