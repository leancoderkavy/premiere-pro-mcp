"use strict";
const { entrypoints, host } = require("uxp");
const ppro = require("premierepro");
const fs = require("fs");
const Protocol = globalThis.PremiereMcpProtocol;
const TranscriptSupport = globalThis.PremiereMcpTranscript;
const Commands = globalThis.PremiereMcpCommands;
const commandRegistry = Commands.createCommandRegistry({ ppro, fs, Protocol });
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
  const base = await commandRegistry.capabilities();
  let project = null, sequence = null;
  try { project = await ppro.Project.getActiveProject(); sequence = project && await project.getActiveSequence(); } catch (_) {}
  const supportedHost = TranscriptSupport.versionAtLeast(host && host.version, "25.6.0");
  const transcriptApi = supportedHost && !!(ppro.Transcript && ppro.Transcript.exportToJSON && ppro.Transcript.importFromJSON);
  const transcriptImportApi = transcriptApi && typeof ppro.Transcript.createImportTextSegmentsAction === "function";
  const captionInspectionApi = supportedHost;
  base.hostVersion = host && host.version || null;
  Object.assign(base.commands, {
      "transcript.export": { supported: transcriptApi, readOnly: true, minVersion: "25.6.0" },
      "transcript.search": { supported: transcriptApi, readOnly: true, minVersion: "25.6.0" },
      "transcript.import": { supported: transcriptImportApi, destructive: true, undoable: true, minVersion: "25.6.0" },
      "transcript.has": {
        supported: transcriptApi, readOnly: true,
        minVersion: "25.6.0", nativeCheckMinVersion: "26.3.0",
        nativeCheck: typeof ppro.Transcript.hasTranscript === "function"
      },
      "captions.inspect": { supported: captionInspectionApi, readOnly: true, minVersion: "25.6.0" },
      "captions.create": { supported: false, reason: "No documented Premiere UXP caption creation API." },
      "captions.update": { supported: false, reason: "No documented Premiere UXP caption text/timing mutation API." },
      "captions.delete": { supported: false, reason: "No documented Premiere UXP caption deletion API." }
  });
  return base;
}

function castClipProjectItem(item) {
  try {
    const clip = ppro.ClipProjectItem.cast(item);
    if (clip) return clip;
  } catch (_) {}
  throw new Error("The resolved project item is not a media clip");
}

async function selectedClipProjectItem(project) {
  if (!ppro.ProjectUtils || typeof ppro.ProjectUtils.getSelection !== "function") {
    throw new Error("Project panel selection is unavailable; pass projectItemId or projectItemName");
  }
  const selection = await ppro.ProjectUtils.getSelection(project);
  const items = selection && await selection.getItems();
  if (!items || items.length !== 1) throw new Error("Select exactly one media project item, or pass projectItemId/projectItemName");
  return castClipProjectItem(items[0]);
}

async function findProjectItem(project, args) {
  const wantedId = args && args.projectItemId != null ? String(args.projectItemId) : "";
  const wantedName = args && args.projectItemName != null ? String(args.projectItemName) : "";
  if (!wantedId && !wantedName) return selectedClipProjectItem(project);
  const queue = [await project.getRootItem()];
  while (queue.length) {
    const folder = queue.shift();
    const children = await folder.getItems();
    for (let i = 0; i < children.length; i += 1) {
      const item = children[i];
      const itemId = typeof item.getId === "function" ? String(item.getId()) : "";
      const candidate = TranscriptSupport.matchingClipCandidate(
        item, itemId, wantedId, wantedName, castClipProjectItem
      );
      if (candidate.clip) return candidate.clip;
      try {
        const childFolder = ppro.FolderItem.cast(item);
        if (childFolder) queue.push(childFolder);
      } catch (_) {}
    }
  }
  throw new Error("Project item not found");
}

async function transcriptContext(args) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No active project");
  if (!ppro.Transcript || typeof ppro.Transcript.exportToJSON !== "function") throw new Error("Transcript APIs require Premiere Pro 25.6 or newer");
  const clip = await findProjectItem(project, args || {});
  const projectItem = ppro.ProjectItem.cast(clip);
  return { project, clip, projectItemId: String(projectItem.getId()), projectItemName: clip.name };
}

async function exportTranscript(args) {
  const context = await transcriptContext(args);
  const json = await ppro.Transcript.exportToJSON(context.clip);
  if (typeof json !== "string" || !json) throw new Error("The selected clip has no transcript");
  TranscriptSupport.parseTranscriptJSON(json);
  return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, json };
}

async function searchTranscript(args) {
  const exported = await exportTranscript(args);
  const result = TranscriptSupport.searchTranscriptJSON(exported.json, args.query, {
    caseSensitive: args.caseSensitive, maxResults: args.maxResults
  });
  return { projectItemId: exported.projectItemId, projectItemName: exported.projectItemName, ...result };
}

async function hasTranscript(args) {
  const context = await transcriptContext(args);
  if (typeof ppro.Transcript.hasTranscript === "function") {
    return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, hasTranscript: !!ppro.Transcript.hasTranscript(context.clip), method: "native" };
  }
  const present = await TranscriptSupport.probeTranscriptExport(function () {
    return ppro.Transcript.exportToJSON(context.clip);
  });
  return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, hasTranscript: present, method: "export-probe" };
}

async function importTranscript(args) {
  if (!args || typeof args.json !== "string") throw new Error("json is required");
  TranscriptSupport.parseTranscriptJSON(args.json);
  const context = await transcriptContext(args);
  if (typeof ppro.Transcript.createImportTextSegmentsAction !== "function") throw new Error("This Premiere build cannot create transcript import actions");
  const textSegments = ppro.Transcript.importFromJSON(args.json);
  let committed = false;
  context.project.lockedAccess(function () {
    committed = context.project.executeTransaction(function (compoundAction) {
      compoundAction.addAction(ppro.Transcript.createImportTextSegmentsAction(textSegments, context.clip));
    }, "Import transcript");
  });
  if (!committed) throw new Error("Premiere rejected the transcript import transaction");
  return { imported: true, projectItemId: context.projectItemId, projectItemName: context.projectItemName, undoable: true };
}

async function inspectCaptions() {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No active project");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active sequence");
  const count = await sequence.getCaptionTrackCount();
  const tracks = [];
  for (let i = 0; i < count; i += 1) {
    const track = await sequence.getCaptionTrack(i);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    tracks.push({ id: track.id, index: await track.getIndex(), name: track.name, muted: await track.isMuted(), itemCount: items ? items.length : 0 });
  }
  return { sequenceId: String(sequence.guid), sequenceName: sequence.name, trackCount: count, tracks };
}

async function stateSnapshot() { return commandRegistry.stateSnapshot(); }

async function dispatch(raw) {
  let cmd;
  try {
    cmd = Protocol.parseCommand(raw);
    let result;
    if (cmd.command === "transcript.export") result = await exportTranscript(cmd.args);
    else if (cmd.command === "transcript.search") result = await searchTranscript(cmd.args);
    else if (cmd.command === "transcript.has") result = await hasTranscript(cmd.args);
    else if (cmd.command === "transcript.import") result = await importTranscript(cmd.args);
    else if (cmd.command === "captions.inspect") result = await inspectCaptions();
    else result = await commandRegistry.dispatch(cmd.command, cmd.args);
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
