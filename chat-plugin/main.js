/* Premiere Pro AI Chat — Main Panel Logic
 * Handles UI state, chat flow, ExtendScript execution, and settings. */

var cs = new CSInterface();

// ---- State ----
var state = {
  provider: "claude",
  apiKey: "",
  model: "",
  messages: [],       // { role: "user"|"assistant", content: string }
  isStreaming: false,
  autoExec: true,
  temperature: 0.3,
  maxTokens: 4096,
  customSystemPrompt: "",
  projectContext: null,
};

// ---- Provider Selection (Login Screen) ----
function selectProvider(provider) {
  state.provider = provider;
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle("active", tabs[i].dataset.provider === provider);
  }
  updateProviderUI();
}

function updateProviderUI() {
  var config = PROVIDERS[state.provider];
  var hint = document.getElementById("providerHint");
  var link = document.getElementById("providerLink");
  hint.innerHTML = "Get a key at <a href=\"#\" id=\"providerLink\" onclick=\"openLink('" + config.keyUrl + "')\">" + config.keyUrl.replace("https://", "") + "</a>";

  var select = document.getElementById("modelSelect");
  select.innerHTML = "";
  for (var i = 0; i < config.models.length; i++) {
    var opt = document.createElement("option");
    opt.value = config.models[i].id;
    opt.textContent = config.models[i].label;
    select.appendChild(opt);
  }
  select.value = config.defaultModel;
}

function openLink(url) {
  // CEP can open URLs via cep.util.openURLInDefaultBrowser or Node's child_process
  try {
    var cp = require("child_process");
    cp.exec('open "' + url + '"');
  } catch (e) {
    console.log("Could not open URL: " + url);
  }
}

// ---- Login ----
function login() {
  var apiKey = document.getElementById("apiKeyInput").value.trim();
  if (!apiKey) {
    showLoginError("Please enter an API key.");
    return;
  }

  var model = document.getElementById("modelSelect").value;
  var btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.textContent = "Connecting...";
  hideLoginError();

  validateApiKey(state.provider, apiKey, model, function (valid, error) {
    btn.disabled = false;
    btn.textContent = "Connect & Start Chatting";

    if (!valid) {
      showLoginError("Connection failed: " + (error || "Unknown error"));
      return;
    }

    state.apiKey = apiKey;
    state.model = model;

    // Persist credentials
    try {
      localStorage.setItem("ai_chat_provider", state.provider);
      localStorage.setItem("ai_chat_api_key", apiKey);
      localStorage.setItem("ai_chat_model", model);
    } catch (e) {}

    showChatScreen();
  });
}

function logout() {
  state.apiKey = "";
  state.messages = [];
  state.projectContext = null;
  try {
    localStorage.removeItem("ai_chat_api_key");
  } catch (e) {}
  showLoginScreen();
}

function showLoginError(msg) {
  var el = document.getElementById("loginError");
  el.textContent = msg;
  el.style.display = "block";
}

function hideLoginError() {
  document.getElementById("loginError").style.display = "none";
}

function toggleKeyVisibility() {
  var input = document.getElementById("apiKeyInput");
  var icon = document.getElementById("eyeIcon");
  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "🙈";
  } else {
    input.type = "password";
    icon.textContent = "👁";
  }
}

// ---- Screen Navigation ----
function showLoginScreen() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("chatScreen").style.display = "none";
}

function showChatScreen() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("chatScreen").style.display = "flex";

  var config = PROVIDERS[state.provider];
  document.getElementById("headerTitle").textContent = config.name;
  document.getElementById("headerModel").textContent = state.model;

  // Refresh project context
  refreshContext();
}

// ---- Chat ----
function sendMessage() {
  var input = document.getElementById("chatInput");
  var text = input.value.trim();
  if (!text || state.isStreaming) return;

  input.value = "";
  autoResizeInput();

  // Remove welcome message
  var welcome = document.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  addMessage("user", text);
  state.messages.push({ role: "user", content: text });

  sendToAI();
}

function sendSuggestion(text) {
  document.getElementById("chatInput").value = text;
  sendMessage();
}

function sendToAI() {
  state.isStreaming = true;
  updateStatus("Thinking...");
  document.getElementById("sendBtn").disabled = true;
  showTypingIndicator();

  // Build context-enriched messages
  var contextMsg = "";
  if (state.projectContext) {
    var ctx = state.projectContext;
    contextMsg = "[Current Premiere Pro context: ";
    if (ctx.hasProject) {
      contextMsg += "Project: " + ctx.name;
      if (ctx.activeSequence) {
        contextMsg += ", Active Sequence: " + ctx.activeSequence.name +
          " (" + ctx.activeSequence.frameSizeH + "x" + ctx.activeSequence.frameSizeV +
          ", " + ctx.activeSequence.videoTracks + "V/" + ctx.activeSequence.audioTracks + "A tracks)";
      }
      contextMsg += ", " + ctx.numItems + " project items, " + ctx.numSequences + " sequences";
    } else {
      contextMsg += "No project open";
    }
    contextMsg += "]";
  }

  // Prepend context to the first user message if available
  var messagesForAPI = state.messages.slice();
  if (contextMsg && messagesForAPI.length > 0) {
    var lastUserIdx = -1;
    for (var i = messagesForAPI.length - 1; i >= 0; i--) {
      if (messagesForAPI[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx >= 0) {
      messagesForAPI[lastUserIdx] = {
        role: "user",
        content: contextMsg + "\n\n" + messagesForAPI[lastUserIdx].content,
      };
    }
  }

  callAI(
    state.provider,
    state.apiKey,
    state.model,
    messagesForAPI,
    state.customSystemPrompt,
    { temperature: state.temperature, maxTokens: state.maxTokens },
    function (err, result) {
      hideTypingIndicator();
      state.isStreaming = false;
      document.getElementById("sendBtn").disabled = false;

      if (err) {
        addMessage("assistant", "**Error:** " + err);
        updateStatus("Error");
        return;
      }

      var text = result.text || "(empty response)";
      state.messages.push({ role: "assistant", content: text });
      addMessage("assistant", text);

      // Update token count
      var usage = result.usage || {};
      var tokenInfo = "";
      if (usage.input_tokens) tokenInfo = usage.input_tokens + " in / " + usage.output_tokens + " out";
      else if (usage.promptTokenCount) tokenInfo = usage.promptTokenCount + " in / " + usage.candidatesTokenCount + " out";
      document.getElementById("tokenCount").textContent = tokenInfo;

      updateStatus("Ready");

      // Check for ExtendScript code blocks and auto-execute
      extractAndExecuteScripts(text);
    }
  );
}

function handleInputKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResizeInput() {
  var ta = document.getElementById("chatInput");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
}

// ---- Message Rendering ----
function addMessage(role, content) {
  var container = document.getElementById("messages");
  var msgDiv = document.createElement("div");
  msgDiv.className = "msg " + role;

  var bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.innerHTML = renderMarkdown(content);

  var meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  msgDiv.appendChild(bubble);
  msgDiv.appendChild(meta);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function renderMarkdown(text) {
  // Simple markdown renderer for chat messages
  var html = escapeHtml(text);

  // Code blocks with language hint
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (match, lang, code) {
    var cls = lang ? ' class="lang-' + lang + '"' : "";
    return '<pre><code' + cls + ">" + code.trim() + "</code></pre>";
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Line breaks
  html = html.replace(/\n/g, "<br/>");

  return html;
}

function escapeHtml(text) {
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showTypingIndicator() {
  var container = document.getElementById("messages");
  var typing = document.createElement("div");
  typing.className = "msg assistant";
  typing.id = "typingIndicator";
  typing.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  container.appendChild(typing);
  container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
  var el = document.getElementById("typingIndicator");
  if (el) el.remove();
}

function updateStatus(text) {
  document.getElementById("statusText").textContent = text;
}

// ---- ExtendScript Execution ----
function extractAndExecuteScripts(text) {
  // Find ```extendscript ... ``` code blocks
  var regex = /```(?:extendscript|jsx|javascript)\n([\s\S]*?)```/g;
  var match;
  var scripts = [];
  while ((match = regex.exec(text)) !== null) {
    scripts.push(match[1].trim());
  }

  if (scripts.length === 0) return;

  for (var i = 0; i < scripts.length; i++) {
    if (state.autoExec) {
      executeExtendScript(scripts[i]);
    } else {
      showScriptPreview(scripts[i]);
    }
  }
}

function executeExtendScript(script) {
  // Wrap in try/catch with helpers
  var wrappedScript =
    "(function() {\n" +
    "  try {\n" +
    script + "\n" +
    "  } catch(e) {\n" +
    "    return __error(e.toString());\n" +
    "  }\n" +
    "})();";

  updateStatus("Executing script...");

  cs.evalScript(wrappedScript, function (result) {
    updateStatus("Ready");

    var resultDiv = document.createElement("div");
    resultDiv.className = "msg assistant";

    var block = document.createElement("div");
    block.className = "msg-bubble";

    var scriptBlock = document.createElement("div");
    scriptBlock.className = "script-block";

    var header = document.createElement("div");
    header.className = "script-header";
    header.innerHTML = '<span class="label">ExtendScript Result</span>';

    var resultContent = document.createElement("div");

    try {
      if (result && result !== "undefined" && result !== "null") {
        var parsed = JSON.parse(result);
        if (parsed.success) {
          resultContent.className = "script-result success";
          resultContent.textContent = JSON.stringify(parsed.data, null, 2);

          // Feed result back to AI for follow-up
          var resultMsg = "[ExtendScript executed successfully. Result: " + JSON.stringify(parsed.data) + "]";
          state.messages.push({ role: "user", content: resultMsg });
        } else {
          resultContent.className = "script-result error";
          resultContent.textContent = "Error: " + (parsed.error || "Unknown error");

          var errMsg = "[ExtendScript execution error: " + (parsed.error || "Unknown error") + "]";
          state.messages.push({ role: "user", content: errMsg });
        }
      } else {
        resultContent.className = "script-result success";
        resultContent.textContent = "(no return value)";
      }
    } catch (e) {
      resultContent.className = "script-result error";
      resultContent.textContent = "Parse error: " + result;
    }

    scriptBlock.appendChild(header);
    scriptBlock.appendChild(resultContent);
    block.appendChild(scriptBlock);
    resultDiv.appendChild(block);

    var container = document.getElementById("messages");
    container.appendChild(resultDiv);
    container.scrollTop = container.scrollHeight;

    // Refresh context after executing scripts
    refreshContext();
  });
}

function showScriptPreview(script) {
  var container = document.getElementById("messages");
  var msgDiv = document.createElement("div");
  msgDiv.className = "msg assistant";

  var block = document.createElement("div");
  block.className = "msg-bubble";

  var scriptBlock = document.createElement("div");
  scriptBlock.className = "script-block";

  var header = document.createElement("div");
  header.className = "script-header";
  header.innerHTML = '<span class="label">ExtendScript (preview)</span>';

  var execBtn = document.createElement("button");
  execBtn.className = "exec-btn";
  execBtn.textContent = "Execute";
  execBtn.onclick = function () {
    execBtn.disabled = true;
    execBtn.textContent = "Running...";
    executeExtendScript(script);
  };
  header.appendChild(execBtn);

  var code = document.createElement("pre");
  code.innerHTML = "<code>" + escapeHtml(script) + "</code>";

  scriptBlock.appendChild(header);
  scriptBlock.appendChild(code);
  block.appendChild(scriptBlock);
  msgDiv.appendChild(block);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

// ---- Project Context ----
function refreshContext() {
  cs.evalScript("getProjectContext()", function (result) {
    try {
      var parsed = JSON.parse(result);
      if (parsed.success && parsed.data) {
        state.projectContext = parsed.data;
        var banner = document.getElementById("contextBanner");
        var text = document.getElementById("contextText");
        banner.style.display = "flex";

        if (parsed.data.hasProject) {
          var info = parsed.data.name;
          if (parsed.data.activeSequence) {
            info += " → " + parsed.data.activeSequence.name;
          }
          text.textContent = info;
        } else {
          text.textContent = "No project open";
        }
      }
    } catch (e) {
      // Not in CEP environment
      var banner = document.getElementById("contextBanner");
      banner.style.display = "flex";
      document.getElementById("contextText").textContent = "Not connected to Premiere Pro";
    }
  });
}

// ---- Settings ----
function openSettings() {
  var modal = document.getElementById("settingsModal");
  modal.style.display = "flex";

  // Populate settings
  var config = PROVIDERS[state.provider];
  var select = document.getElementById("settingsModel");
  select.innerHTML = "";
  for (var i = 0; i < config.models.length; i++) {
    var opt = document.createElement("option");
    opt.value = config.models[i].id;
    opt.textContent = config.models[i].label;
    select.appendChild(opt);
  }
  select.value = state.model;

  document.getElementById("settingsTemp").value = state.temperature;
  document.getElementById("settingsTempVal").textContent = state.temperature;
  document.getElementById("settingsMaxTokens").value = state.maxTokens;
  document.getElementById("settingsSystemPrompt").value = state.customSystemPrompt;
  document.getElementById("settingsAutoExec").checked = state.autoExec;

  // Bind temp slider
  document.getElementById("settingsTemp").oninput = function () {
    document.getElementById("settingsTempVal").textContent = this.value;
  };
}

function closeSettings() {
  document.getElementById("settingsModal").style.display = "none";
}

function saveSettings() {
  state.model = document.getElementById("settingsModel").value;
  state.temperature = parseFloat(document.getElementById("settingsTemp").value);
  state.maxTokens = parseInt(document.getElementById("settingsMaxTokens").value, 10);
  state.customSystemPrompt = document.getElementById("settingsSystemPrompt").value;
  state.autoExec = document.getElementById("settingsAutoExec").checked;

  document.getElementById("headerModel").textContent = state.model;

  // Persist
  try {
    localStorage.setItem("ai_chat_model", state.model);
    localStorage.setItem("ai_chat_temperature", String(state.temperature));
    localStorage.setItem("ai_chat_max_tokens", String(state.maxTokens));
    localStorage.setItem("ai_chat_system_prompt", state.customSystemPrompt);
    localStorage.setItem("ai_chat_auto_exec", String(state.autoExec));
  } catch (e) {}

  closeSettings();
}

function changeApiKey() {
  closeSettings();
  logout();
}

// ---- Init ----
(function init() {
  updateProviderUI();

  // Restore saved settings
  try {
    var savedProvider = localStorage.getItem("ai_chat_provider");
    var savedKey = localStorage.getItem("ai_chat_api_key");
    var savedModel = localStorage.getItem("ai_chat_model");
    var savedTemp = localStorage.getItem("ai_chat_temperature");
    var savedMaxTokens = localStorage.getItem("ai_chat_max_tokens");
    var savedSystemPrompt = localStorage.getItem("ai_chat_system_prompt");
    var savedAutoExec = localStorage.getItem("ai_chat_auto_exec");

    if (savedProvider) {
      state.provider = savedProvider;
      selectProvider(savedProvider);
    }
    if (savedTemp) state.temperature = parseFloat(savedTemp);
    if (savedMaxTokens) state.maxTokens = parseInt(savedMaxTokens, 10);
    if (savedSystemPrompt) state.customSystemPrompt = savedSystemPrompt;
    if (savedAutoExec !== null) state.autoExec = savedAutoExec === "true";

    // Auto-login if key is saved
    if (savedKey && savedModel) {
      state.apiKey = savedKey;
      state.model = savedModel;
      document.getElementById("apiKeyInput").value = savedKey;
      document.getElementById("modelSelect").value = savedModel;
      showChatScreen();
      return;
    }
  } catch (e) {}

  showLoginScreen();
})();
