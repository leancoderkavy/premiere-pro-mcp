/* Panel-side commands: the few things only the CEP panel itself can do, because
 * they need the panel's CEP runtime (window.__adobe_cep__) rather than Premiere's
 * ExtendScript engine. Listing installed extensions and opening one are the first.
 *
 * The server publishes these as cmd_<id>.jsx files like any other command, but the
 * file holds ONLY the marker line and a JSON payload: no helper bootstrap. Every
 * ExtendScript command starts with that bootstrap, so a file that begins with the
 * marker cannot be an ExtendScript command, and an ExtendScript command can never
 * be mistaken for one. Loaded as a plain <script> in the panel and with require()
 * in tests; the CEP runtime is always passed in. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MCPPanelCommands = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MARKER = "/* @panel-command */";

  function isPanelCommand(script) {
    return typeof script === "string" && script.indexOf(MARKER) === 0;
  }

  function installedExtensions(cep) {
    if (!cep || typeof cep.getExtensions !== "function") return null;
    var raw = cep.getExtensions(JSON.stringify([]));
    var list = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list : [];
  }

  function summary(ext) {
    return {
      id: ext.id,
      name: ext.name,
      windowType: ext.windowType,
      isActive: ext.isActive === true,
    };
  }

  function listExtensions(cep) {
    var list = installedExtensions(cep);
    if (!list) return { success: false, error: "This CEP runtime cannot list extensions." };
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) out.push(summary(list[i]));
    return { success: true, data: { extensions: out, count: out.length } };
  }

  function openExtension(cep, extensionId, params) {
    if (typeof extensionId !== "string" || !extensionId.trim()) {
      return { success: false, error: "extension_id must be a non-empty extension ID." };
    }
    extensionId = extensionId.trim();
    var list = installedExtensions(cep);
    if (!list || typeof cep.requestOpenExtension !== "function") {
      return { success: false, error: "This CEP runtime cannot open extensions." };
    }
    var found = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === extensionId) found = list[i];
    if (!found) {
      return { success: false, error: "Extension is not installed: " + extensionId + ". Use list_extensions to see installed IDs." };
    }
    cep.requestOpenExtension(extensionId, typeof params === "string" ? params : "");
    return {
      success: true,
      data: {
        extensionId: extensionId,
        wasActive: found.isActive === true,
        requested: true,
        verified: false,
        outcome: "committed_unverified",
        verification: "api-call",
        limitation: "CEP has no panel-visibility getter; check the visible panel in Premiere Pro.",
      },
    };
  }

  /** Runs one panel command file's contents. Never throws: a failure is a result. */
  function run(script, cep) {
    var payload;
    try {
      payload = JSON.parse(script.slice(MARKER.length));
    } catch (e) {
      return { success: false, error: "Panel command payload is not valid JSON." };
    }
    try {
      if (payload && payload.action === "list_extensions") return listExtensions(cep);
      if (payload && payload.action === "open_extension") return openExtension(cep, payload.extensionId, payload.params);
      return { success: false, error: "Unknown panel command: " + (payload && payload.action) };
    } catch (e) {
      return { success: false, error: "Panel command failed: " + (e && e.message ? e.message : String(e)) };
    }
  }

  return { MARKER: MARKER, isPanelCommand: isPanelCommand, run: run };
}));
