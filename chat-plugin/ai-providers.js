/* AI Provider Abstraction Layer
 * Supports Claude (Anthropic) and Gemini (Google) APIs.
 * Runs inside CEP (Chromium with Node.js access). */

var https = require("https");

// ---- Provider Configurations ----
var PROVIDERS = {
  claude: {
    name: "Claude",
    icon: "◆",
    keyHint: "Get a key at console.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Best)" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (Fast)" },
      { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
    ],
    defaultModel: "claude-sonnet-4-20250514",
  },
  gemini: {
    name: "Gemini",
    icon: "✦",
    keyHint: "Get a key at aistudio.google.com",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash (Best)" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash (Fast)" },
    ],
    defaultModel: "gemini-2.5-flash-preview-05-20",
  },
};

// ---- System Prompt ----
var BASE_SYSTEM_PROMPT =
  "You are an AI assistant embedded inside Adobe Premiere Pro. " +
  "You can control Premiere Pro by generating ExtendScript code that runs directly in the application.\n\n" +
  "IMPORTANT RULES:\n" +
  "1. ExtendScript uses ES3 syntax only: use 'var' (never let/const), no arrow functions, no template literals, no destructuring.\n" +
  "2. Always wrap your scripts in a try/catch and return results via the __result() and __error() helper functions that are available globally.\n" +
  "3. Available helper functions: __ticksToSeconds(ticks), __secondsToTicks(seconds), __jsonStringify(obj), __result(data), __error(msg).\n" +
  "4. The app object is the global Premiere Pro application object.\n" +
  "5. To access the active sequence: var seq = app.project.activeSequence;\n" +
  "6. To access project items: app.project.rootItem.children\n" +
  "7. For QE DOM (advanced): call app.enableQE() first, then use qe.project, qe.source, etc.\n\n" +
  "When the user asks you to do something in Premiere Pro:\n" +
  "1. Explain what you will do briefly.\n" +
  "2. Generate the ExtendScript code in a ```extendscript code block.\n" +
  "3. The code will be automatically executed. You'll see the result and can follow up.\n\n" +
  "When the user asks a question about their project, generate ExtendScript to query the information.\n" +
  "Always be concise and helpful. If an operation fails, explain why and suggest alternatives.";

// ---- Claude (Anthropic) API ----
function callClaude(apiKey, model, messages, systemPrompt, options, callback) {
  var body = JSON.stringify({
    model: model,
    max_tokens: options.maxTokens || 4096,
    temperature: options.temperature || 0.3,
    system: systemPrompt,
    messages: messages.map(function (m) {
      return { role: m.role, content: m.content };
    }),
  });

  var reqOptions = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  };

  makeRequest(reqOptions, body, function (err, data) {
    if (err) return callback(err, null);
    try {
      var parsed = JSON.parse(data);
      if (parsed.error) {
        return callback(parsed.error.message || "API error", null);
      }
      var text = "";
      if (parsed.content && parsed.content.length > 0) {
        for (var i = 0; i < parsed.content.length; i++) {
          if (parsed.content[i].type === "text") {
            text += parsed.content[i].text;
          }
        }
      }
      callback(null, {
        text: text,
        usage: parsed.usage || {},
        model: parsed.model,
        stopReason: parsed.stop_reason,
      });
    } catch (e) {
      callback("Failed to parse response: " + e.message, null);
    }
  });
}

// ---- Gemini (Google) API ----
function callGemini(apiKey, model, messages, systemPrompt, options, callback) {
  var contents = messages.map(function (m) {
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    };
  });

  var body = JSON.stringify({
    contents: contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    generationConfig: {
      temperature: options.temperature || 0.3,
      maxOutputTokens: options.maxTokens || 4096,
    },
  });

  var reqOptions = {
    hostname: "generativelanguage.googleapis.com",
    path:
      "/v1beta/models/" + model + ":generateContent?key=" + apiKey,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  };

  makeRequest(reqOptions, body, function (err, data) {
    if (err) return callback(err, null);
    try {
      var parsed = JSON.parse(data);
      if (parsed.error) {
        return callback(parsed.error.message || "API error", null);
      }
      var text = "";
      if (
        parsed.candidates &&
        parsed.candidates[0] &&
        parsed.candidates[0].content
      ) {
        var parts = parsed.candidates[0].content.parts;
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].text) text += parts[i].text;
        }
      }
      callback(null, {
        text: text,
        usage: parsed.usageMetadata || {},
        model: model,
        stopReason:
          parsed.candidates &&
          parsed.candidates[0] &&
          parsed.candidates[0].finishReason,
      });
    } catch (e) {
      callback("Failed to parse response: " + e.message, null);
    }
  });
}

// ---- Unified Call ----
function callAI(provider, apiKey, model, messages, systemPrompt, options, callback) {
  var fullSystemPrompt = BASE_SYSTEM_PROMPT;
  if (systemPrompt) {
    fullSystemPrompt += "\n\n" + systemPrompt;
  }

  if (provider === "claude") {
    callClaude(apiKey, model, messages, fullSystemPrompt, options, callback);
  } else if (provider === "gemini") {
    callGemini(apiKey, model, messages, fullSystemPrompt, options, callback);
  } else {
    callback("Unknown provider: " + provider, null);
  }
}

// ---- Validate API Key (quick test call) ----
function validateApiKey(provider, apiKey, model, callback) {
  var testMessages = [{ role: "user", content: "Reply with just the word: connected" }];
  callAI(provider, apiKey, model, testMessages, "", { maxTokens: 32 }, function (err, result) {
    if (err) return callback(false, err);
    if (result && result.text) return callback(true, null);
    callback(false, "No response received");
  });
}

// ---- HTTPS Request Helper (Node.js) ----
function makeRequest(options, body, callback) {
  var req = https.request(options, function (res) {
    var chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      var data = Buffer.concat(chunks).toString("utf-8");
      if (res.statusCode >= 400) {
        try {
          var errData = JSON.parse(data);
          var errMsg =
            (errData.error && errData.error.message) || "HTTP " + res.statusCode;
          callback(errMsg, null);
        } catch (e) {
          callback("HTTP " + res.statusCode + ": " + data.substring(0, 200), null);
        }
        return;
      }
      callback(null, data);
    });
  });

  req.on("error", function (e) {
    callback("Network error: " + e.message, null);
  });

  req.setTimeout(60000, function () {
    req.destroy();
    callback("Request timed out (60s)", null);
  });

  req.write(body);
  req.end();
}
