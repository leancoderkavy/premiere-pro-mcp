"use strict";
const { entrypoints, host } = require("uxp");
const ppro = require("premierepro");
const fs = require("fs");
const Protocol = globalThis.PremiereMcpProtocol;
const Commands = globalThis.PremiereMcpCommands;
const Transcript = globalThis.PremiereMcpTranscript;
const commandRegistry = Commands.createCommandRegistry({ ppro, fs, Protocol, Transcript, host });
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

async function capabilities() { return commandRegistry.capabilities(); }
async function stateSnapshot() { return commandRegistry.stateSnapshot(); }

async function dispatch(raw) {
  let cmd;
  try {
    cmd = Protocol.parseCommand(raw);
    const result = await commandRegistry.dispatch(cmd.command, cmd.args);
    send(Protocol.envelope("result", { ok: true, result }, cmd.requestId));
  } catch (error) {
    send(Protocol.envelope("result", { ok: false, error: { code: error.code || "UXP_COMMAND_FAILED", message: error.message || String(error) } }, cmd && cmd.requestId));
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
