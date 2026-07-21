"use strict";
const { entrypoints } = require("uxp");
const ppro = require("premierepro");
const fs = require("fs");
const Protocol = globalThis.PremiereMcpProtocol;
let socket = null;
let reconnectTimer = null;
let lastState = "";

entrypoints.setup({ panels: { mcpBridgePanel: { create() {}, show() { publishState("panel.show"); } } } });
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("connect").addEventListener("click", connect);
  document.getElementById("refresh").addEventListener("click", () => publishState("manual"));
  connect();
  setInterval(() => publishState("poll"), 1000);
});

async function capabilities() {
  let project = null, sequence = null;
  try { project = await ppro.Project.getActiveProject(); sequence = project && await project.getActiveSequence(); } catch (_) {}
  return {
    backend: "uxp", protocolVersion: Protocol.PROTOCOL_VERSION,
    hostMinVersion: "25.6.0", activeProject: !!project, activeSequence: !!sequence,
    commands: {
      "capabilities.get": { supported: true, readOnly: true },
      "state.get": { supported: true, readOnly: true },
      "frame.export": { supported: !!(ppro.Exporter && ppro.Exporter.exportSequenceFrame), destructive: false }
    },
    fallback: { backend: "cep", reason: "Use CEP/QE only when a command is absent or reports unsupported; never silently retry a failed UXP mutation." }
  };
}

async function stateSnapshot() {
  const project = await ppro.Project.getActiveProject();
  const sequence = project && await project.getActiveSequence();
  const position = sequence && await sequence.getPlayerPosition();
  return { projectOpen: !!project, sequenceOpen: !!sequence, playheadSeconds: position ? position.seconds : null };
}

async function exportFrame(args) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No active project");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active sequence");
  if (!args.outputDirectory) throw new Error("outputDirectory is required");
  const filename = Protocol.safeFilename(args.filename);
  const position = args.seconds == null ? await sequence.getPlayerPosition() : await tickTime(args.seconds);
  const size = await sequence.getFrameSize();
  const width = positiveInt(args.width, size.width), height = positiveInt(args.height, size.height);
  const returned = await ppro.Exporter.exportSequenceFrame(sequence, position, filename, args.outputDirectory, width, height);
  const path = Protocol.joinPath(args.outputDirectory, filename);
  let exists = false;
  try { await fs.lstat(path); exists = true; } catch (_) {}
  if (!exists) throw new Error("Exporter returned " + JSON.stringify(returned) + " but no frame exists at " + path);
  return { path, width, height, seconds: position.seconds, exporterResult: returned };
}

async function tickTime(seconds) {
  if (ppro.TickTime && typeof ppro.TickTime.createWithSeconds === "function") return ppro.TickTime.createWithSeconds(Number(seconds));
  throw new Error("This Premiere build cannot create TickTime; omit seconds to capture the playhead");
}
function positiveInt(value, fallback) { const n = Number(value == null ? fallback : value); if (!Number.isFinite(n) || n <= 0) throw new Error("frame dimensions must be positive"); return Math.round(n); }

async function dispatch(raw) {
  let cmd;
  try {
    cmd = Protocol.parseCommand(raw);
    let result;
    if (cmd.command === "capabilities.get") result = await capabilities();
    else if (cmd.command === "state.get") result = await stateSnapshot();
    else if (cmd.command === "frame.export") result = await exportFrame(cmd.args);
    else throw new Error("Unsupported UXP command: " + cmd.command);
    send(Protocol.envelope("result", { ok: true, result }, cmd.requestId));
  } catch (error) {
    send(Protocol.envelope("result", { ok: false, error: { code: "UXP_COMMAND_FAILED", message: error.message || String(error) } }, cmd && cmd.requestId));
  }
}

function connect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (socket) try { socket.close(); } catch (_) {}
  const url = document.getElementById("bridge-url").value;
  setStatus("Connecting to " + url);
  try { socket = new WebSocket(url); } catch (e) { return scheduleReconnect(e.message); }
  socket.onopen = async () => { setStatus("Connected"); send(Protocol.envelope("hello", await capabilities())); publishState("connected"); };
  socket.onmessage = (event) => dispatch(event.data);
  socket.onerror = () => setStatus("Bridge connection error");
  socket.onclose = () => scheduleReconnect("Disconnected");
}
function scheduleReconnect(message) { setStatus(message + "; retrying in 2s"); reconnectTimer = setTimeout(connect, 2000); }
function send(value) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
async function publishState(reason) {
  try { const state = await stateSnapshot(); const encoded = JSON.stringify(state); if (reason !== "poll" || encoded !== lastState) { lastState = encoded; send(Protocol.envelope("event", { name: "premiere.state.changed", reason, state })); } } catch (e) { setStatus(e.message); }
}
function setStatus(value) { const el = document.getElementById("status"); if (el) el.textContent = value; }
