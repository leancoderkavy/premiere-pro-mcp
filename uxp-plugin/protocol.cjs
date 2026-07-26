(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PremiereMcpProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PROTOCOL_VERSION = 2;
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
  function operationEvent(name, operation, detail) {
    return envelope("event", {
      name: "premiere.operation." + name,
      operation: Object.assign({
        requestId: operation.requestId,
        command: operation.command
      }, detail || {})
    }, operation.requestId);
  }
  function operationSemantics(options) {
    const value = options || {};
    return {
      mutatesProject: value.mutatesProject === true,
      verification: {
        status: value.verificationStatus || "not_verified",
        boundary: value.verificationBoundary || "command_return_value",
        evidence: value.verificationEvidence || []
      },
      undo: {
        supported: value.undoSupported === true,
        boundary: value.undoSupported === true ? "premiere_undo_history" : "not_undoable",
        label: value.undoLabel || null
      },
      transaction: {
        actionGroup: value.transactionActionGroup === true,
        boundary: value.transactionActionGroup === true ? "project_executeTransaction" : "single_host_call",
        atomicRollback: false
      },
      cancellation: {
        supported: value.cancellationSupported === true,
        boundary: value.cancellationBoundary || "before_non_cancellable_host_call"
      }
    };
  }
  function createOperationTracker() {
    const operations = new Map();
    return {
      begin(requestId, command) {
        const operation = {
          requestId: requestId || null,
          command,
          phase: "preflight",
          cancelRequested: false,
          complete: false
        };
        if (requestId) operations.set(requestId, operation);
        return operation;
      },
      get(requestId) { return requestId ? operations.get(requestId) || null : null; },
      requestCancel(requestId) {
        const operation = this.get(requestId);
        if (!operation || operation.complete) return { accepted: false, reason: "operation_not_active" };
        if (operation.phase !== "preflight") return { accepted: false, reason: "host_call_not_cancellable" };
        operation.cancelRequested = true;
        return { accepted: true, reason: "cancellation_requested" };
      },
      finish(operation) {
        operation.complete = true;
        if (operation.requestId) operations.delete(operation.requestId);
      }
    };
  }
  function safeFilename(value) {
    const name = String(value || "mcp-frame.png");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/i.test(name)) throw new Error("filename must be a simple .png name");
    return name;
  }
  function joinPath(dir, name) { return /[\\\/]$/.test(dir) ? dir + name : dir + "/" + name; }
  return {
    PROTOCOL_VERSION,
    MAX_COMMAND_BYTES,
    envelope,
    parseCommand,
    operationEvent,
    operationSemantics,
    createOperationTracker,
    safeFilename,
    joinPath
  };
});
