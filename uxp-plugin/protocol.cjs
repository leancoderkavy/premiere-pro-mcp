(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PROTOCOL_VERSION = 1;
  function envelope(type, payload, requestId) {
    const value = { protocolVersion: PROTOCOL_VERSION, type, payload: payload || {}, sentAt: new Date().toISOString() };
    if (requestId) value.requestId = requestId;
    return value;
  }
  function parseCommand(raw) {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || value.type !== "command" || typeof value.command !== "string") throw new Error("Invalid UXP bridge command");
    return { requestId: value.requestId || null, command: value.command, args: value.args || {} };
  }
  function safeFilename(value) {
    const name = String(value || "mcp-frame.png");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/i.test(name)) throw new Error("filename must be a simple .png name");
    return name;
  }
  function joinPath(dir, name) { return /[\\\/]$/.test(dir) ? dir + name : dir + "/" + name; }
  return { PROTOCOL_VERSION, envelope, parseCommand, safeFilename, joinPath };
});
