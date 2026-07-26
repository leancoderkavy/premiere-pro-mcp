"use strict";
const { entrypoints } = require("uxp");
const ppro = require("premierepro");
const fs = require("fs");
const Protocol = globalThis.PremiereMcpProtocol;
let socket = null;
let reconnectTimer = null;
let lastState = "";
let stateRevision = 0;
let fallbackPollTimer = null;
const operationTracker = Protocol.createOperationTracker();
const eventSubscriptions = [];

entrypoints.setup({
  panels: {
    mcpBridgePanel: {
      create() { subscribeHostEvents(); },
      show() { publishState("panel.show"); },
      destroy() { unsubscribeHostEvents(); stopFallbackPolling(); disconnect(); }
    }
  }
});
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("connect").addEventListener("click", connect);
  document.getElementById("refresh").addEventListener("click", () => publishState("manual"));
  subscribeHostEvents();
  connect();
  startFallbackPolling();
});

async function capabilities() {
  let project = null, sequence = null;
  try { project = await ppro.Project.getActiveProject(); sequence = project && await project.getActiveSequence(); } catch (_) {}
  return {
    backend: "uxp", protocolVersion: Protocol.PROTOCOL_VERSION,
    hostMinVersion: "25.6.0", activeProject: !!project, activeSequence: !!sequence,
    commands: {
      "capabilities.get": { supported: true, readOnly: true, cancellable: false },
      "state.get": { supported: true, readOnly: true, cancellable: false },
      "operation.cancel": { supported: true, readOnly: false, scope: "preflight only" },
      "frame.export": {
        supported: !!(ppro.Exporter && ppro.Exporter.exportSequenceFrame),
        destructive: false,
        cancellable: "preflight only",
        verification: "output file existence",
        undoable: false,
        atomic: false
      }
    },
    events: {
      host: supportedHostEvents(),
      stateNotifications: true,
      fallbackPolling: { enabled: true, intervalMs: 5000 },
      operationLifecycle: ["started", "progress", "completed", "failed", "cancelled"]
    },
    operationSemantics: {
      mutations: "Only action-based commands executed by Project.executeTransaction may claim an undo boundary.",
      rollback: "No atomic rollback is claimed. Callers must inspect result verification metadata.",
      cancellation: "Cooperative before a non-cancellable Premiere host call; no interruption is claimed after that boundary."
    },
    fallback: { backend: "cep", reason: "Use CEP/QE only when a command is absent or reports unsupported; never silently retry a failed UXP mutation." }
  };
}

async function stateSnapshot() {
  const project = await ppro.Project.getActiveProject();
  const sequence = project && await project.getActiveSequence();
  const position = sequence && await sequence.getPlayerPosition();
  return {
    revision: stateRevision,
    projectOpen: !!project,
    project: project ? { id: project.guid || null, name: project.name || null, path: project.path || null } : null,
    sequenceOpen: !!sequence,
    sequence: sequence ? { id: sequence.guid || null, name: sequence.name || null } : null,
    playheadSeconds: position ? position.seconds : null
  };
}

async function exportFrame(args, operation) {
  assertNotCancelled(operation);
  publishOperation("progress", operation, { phase: "preflight", progress: 0.1 });
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No active project");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active sequence");
  if (!args.outputDirectory) throw new Error("outputDirectory is required");
  const filename = Protocol.safeFilename(args.filename);
  const position = args.seconds == null ? await sequence.getPlayerPosition() : await tickTime(args.seconds);
  const size = await sequence.getFrameSize();
  const width = positiveInt(args.width, size.width), height = positiveInt(args.height, size.height);
  assertNotCancelled(operation);
  operation.phase = "host_call";
  publishOperation("progress", operation, { phase: "host_call", progress: 0.4, cancellable: false });
  const returned = await ppro.Exporter.exportSequenceFrame(sequence, position, filename, args.outputDirectory, width, height);
  const path = Protocol.joinPath(args.outputDirectory, filename);
  operation.phase = "verification";
  publishOperation("progress", operation, { phase: "verification", progress: 0.8, cancellable: false });
  let exists = false;
  try { await fs.lstat(path); exists = true; } catch (_) {}
  if (!exists) throw new Error("Exporter returned " + JSON.stringify(returned) + " but no frame exists at " + path);
  return {
    path, width, height, seconds: position.seconds, exporterResult: returned,
    operation: Protocol.operationSemantics({
      mutatesProject: false,
      verificationStatus: "verified",
      verificationBoundary: "output_file_exists",
      verificationEvidence: [{ type: "filesystem", path }],
      cancellationSupported: true
    })
  };
}

async function tickTime(seconds) {
  if (ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function") return ppro.TickTime.createWithSeconds(Number(seconds));
  throw new Error("This Premiere build cannot create TickTime; omit seconds to capture the playhead");
}
function positiveInt(value, fallback) { const n = Number(value == null ? fallback : value); if (!Number.isFinite(n) || n <= 0) throw new Error("frame dimensions must be positive"); return Math.round(n); }

async function dispatch(raw) {
  let cmd;
  let operation;
  try {
    cmd = Protocol.parseCommand(raw);
    if (cmd.command === "operation.cancel") {
      const result = operationTracker.requestCancel(cmd.args.requestId);
      send(Protocol.envelope("result", { ok: true, result }, cmd.requestId));
      return;
    }
    operation = operationTracker.begin(cmd.requestId, cmd.command);
    publishOperation("started", operation, { phase: "preflight", progress: 0 });
    let result;
    if (cmd.command === "capabilities.get") result = await capabilities();
    else if (cmd.command === "state.get") result = await stateSnapshot();
    else if (cmd.command === "frame.export") result = await exportFrame(cmd.args, operation);
    else throw new Error("Unsupported UXP command: " + cmd.command);
    publishOperation("completed", operation, { phase: "complete", progress: 1 });
    send(Protocol.envelope("result", {
      ok: true,
      result,
      operation: result && result.operation
        ? result.operation
        : Protocol.operationSemantics({
          mutatesProject: false,
          verificationStatus: "verified",
          verificationBoundary: "host_snapshot"
        })
    }, cmd.requestId));
  } catch (error) {
    const cancelled = error && error.code === "UXP_OPERATION_CANCELLED";
    if (operation) publishOperation(cancelled ? "cancelled" : "failed", operation, {
      phase: operation.phase, progress: null, error: error.message || String(error)
    });
    send(Protocol.envelope("result", {
      ok: false,
      error: {
        code: cancelled ? "UXP_OPERATION_CANCELLED" : "UXP_COMMAND_FAILED",
        message: error.message || String(error),
        operation: Protocol.operationSemantics({ cancellationSupported: true })
      }
    }, cmd && cmd.requestId));
  } finally {
    if (operation) operationTracker.finish(operation);
  }
}

function connect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (socket) try { socket.onclose = null; socket.close(); } catch (_) {}
  const configuredUrl = document.getElementById("bridge-url").value;
  const token = document.getElementById("bridge-token").value;
  let url;
  try {
    url = new URL(configuredUrl);
    if (token) url.searchParams.set("token", token);
    url = url.toString();
  } catch (_) {
    return scheduleReconnect("Invalid bridge URL");
  }
  setStatus("Connecting to " + url);
  try { socket = new WebSocket(url); } catch (e) { return scheduleReconnect(e.message); }
  socket.onopen = async () => { setStatus("Connected"); send(Protocol.envelope("hello", await capabilities())); publishState("connected"); };
  socket.onmessage = (event) => dispatch(event.data);
  socket.onerror = () => setStatus("Bridge connection error");
  socket.onclose = () => scheduleReconnect("Disconnected");
}
function scheduleReconnect(message) { setStatus(message + "; retrying in 2s"); reconnectTimer = setTimeout(connect, 2000); }
function send(value) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) try { socket.onclose = null; socket.close(); } catch (_) {}
  socket = null;
}
function publishOperation(name, operation, detail) {
  send(Protocol.operationEvent(name, operation, detail));
}
function assertNotCancelled(operation) {
  if (!operation || !operation.cancelRequested) return;
  const error = new Error("Operation cancelled before the Premiere host call");
  error.code = "UXP_OPERATION_CANCELLED";
  throw error;
}
function supportedHostEvents() {
  const constants = ppro.Constants || {};
  const project = constants.ProjectEvent || {};
  const sequence = constants.SequenceEvent || {};
  return [
    project.OPENED, project.CLOSED, project.DIRTY, project.ACTIVATED,
    project.PROJECT_ITEM_SELECTION_CHANGED,
    sequence.ACTIVATED, sequence.CLOSED, sequence.SELECTION_CHANGED
  ].filter((eventName) => eventName !== undefined && eventName !== null);
}
function subscribeHostEvents() {
  if (!ppro.EventManager || eventSubscriptions.length) return;
  supportedHostEvents().forEach((eventName) => {
    const handler = () => publishState("host-event", eventName);
    ppro.EventManager.addGlobalEventListener(eventName, handler, false);
    eventSubscriptions.push({ eventName, handler });
  });
}
function unsubscribeHostEvents() {
  if (!ppro.EventManager) return;
  eventSubscriptions.splice(0).forEach(({ eventName, handler }) => {
    try { ppro.EventManager.removeGlobalEventListener(eventName, handler, false); } catch (_) {}
  });
}
function startFallbackPolling() {
  if (!fallbackPollTimer) fallbackPollTimer = setInterval(() => publishState("fallback-poll"), 5000);
}
function stopFallbackPolling() {
  if (fallbackPollTimer) clearInterval(fallbackPollTimer);
  fallbackPollTimer = null;
}
async function publishState(reason, hostEvent) {
  try {
    stateRevision += 1;
    const state = await stateSnapshot();
    const comparable = Object.assign({}, state, { revision: 0 });
    const encoded = JSON.stringify(comparable);
    if (reason !== "fallback-poll" || encoded !== lastState) {
      lastState = encoded;
      send(Protocol.envelope("event", {
        name: "premiere.state.changed",
        reason,
        hostEvent: hostEvent || null,
        state
      }));
    }
  } catch (e) { setStatus(e.message); }
}
function setStatus(value) { const el = document.getElementById("status"); if (el) el.textContent = value; }
