(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PROTOCOL_VERSION = 1;
  const MAX_COMMAND_BYTES = 64 * 1024;
  const COMMAND_NAME = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
  function envelope(type, payload, requestId) {
    const value = { protocolVersion: PROTOCOL_VERSION, type, payload: payload || {}, sentAt: new Date().toISOString() };
    if (requestId) value.requestId = requestId;
    return value;
  }
  function parseCommand(raw) {
    if (typeof raw === "string" && raw.length > MAX_COMMAND_BYTES) throw new Error("UXP bridge command exceeds 64 KiB");
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!isPlainObject(value) || value.type !== "command" || typeof value.command !== "string" || !COMMAND_NAME.test(value.command)) throw new Error("Invalid UXP bridge command");
    if (value.protocolVersion != null && value.protocolVersion !== PROTOCOL_VERSION) throw new Error("Unsupported UXP protocol version: " + value.protocolVersion);
    if (value.requestId != null && (typeof value.requestId !== "string" || value.requestId.length < 1 || value.requestId.length > 128)) throw new Error("requestId must be a non-empty string of at most 128 characters");
    if (value.args != null && !isPlainObject(value.args)) throw new Error("command args must be an object");
    return { requestId: value.requestId || null, command: value.command, args: value.args || {} };
  }
  function isPlainObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function safeFilename(value) {
    const name = String(value || "mcp-frame.png");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/i.test(name)) throw new Error("filename must be a simple .png name");
    return name;
  }
  function joinPath(dir, name) { return /[\\\/]$/.test(dir) ? dir + name : dir + "/" + name; }
  return { PROTOCOL_VERSION, MAX_COMMAND_BYTES, envelope, parseCommand, safeFilename, joinPath };
});
