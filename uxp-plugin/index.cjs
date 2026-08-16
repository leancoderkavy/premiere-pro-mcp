"use strict";
const { entrypoints, host, storage } = require("uxp");
const ppro = require("premierepro");
const Protocol = globalThis.PremiereMcpProtocol;
const TranscriptSupport = globalThis.PremiereMcpTranscript;
const WorkspaceSupport = globalThis.PremiereMcpWorkspace;
const EventSupport = globalThis.PremiereMcpEvents;
const Commands = globalThis.PremiereMcpCommands;
const workspaceBroker = WorkspaceSupport.createWorkspaceBroker({ fs: storage && storage.localFileSystem });
const eventJournal = EventSupport.createEventJournal({ capacity: 512 });
const commandRegistry = Commands.createCommandRegistry({
  ppro,
  Protocol,
  workspace: workspaceBroker,
  events: eventJournal,
  transcriptImportHandler: importTranscript,
  transcriptImportProbe: canImportTranscript
});
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
      destroy() { unsubscribeHostEvents(); stopFallbackPolling(); eventJournal.close(); disconnect(); }
    }
  }
});
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("connect").addEventListener("click", connect);
  document.getElementById("refresh").addEventListener("click", () => publishState("manual"));
  document.getElementById("choose-workspace").addEventListener("click", chooseWorkspace);
  document.getElementById("revoke-workspace").addEventListener("click", revokeWorkspace);
  try { await workspaceBroker.initialize(); } catch (error) { setStatus(error.message || String(error)); }
  renderWorkspaceStatus();
  subscribeHostEvents();
  connect();
  startFallbackPolling();
});

async function capabilities() {
  const value = await commandRegistry.capabilities();
  value.commands["capabilities.get"].cancellable = false;
  value.commands["state.get"].cancellable = false;
  value.commands["operation.cancel"] = { supported: true, readOnly: false, scope: "preflight only" };
  if (value.commands["frame.export"]) Object.assign(value.commands["frame.export"], {
    cancellable: "preflight only", verification: "exporter return value", undoable: false, atomic: false
  });
  const supportedHost = TranscriptSupport.versionAtLeast(host && host.version, "25.6.0");
  const transcriptExportApi = supportedHost && !!(ppro.Transcript && ppro.Transcript.exportToJSON && ppro.Transcript.importFromJSON);
  const transcriptNativeHasApi = supportedHost && !!(ppro.Transcript && typeof ppro.Transcript.hasTranscript === "function");
  const transcriptHasApi = transcriptNativeHasApi || !!(supportedHost && ppro.Transcript && typeof ppro.Transcript.exportToJSON === "function");
  Object.assign(value.commands, {
    "transcript.export": { supported: transcriptExportApi, readOnly: true, minVersion: "25.6.0" },
    "transcript.search": { supported: transcriptExportApi, readOnly: true, minVersion: "25.6.0" },
    "transcript.has": {
      supported: transcriptHasApi, readOnly: true, minVersion: transcriptNativeHasApi ? "26.3.0" : "25.6.0",
      nativeCheckMinVersion: "26.3.0", nativeCheck: transcriptNativeHasApi,
      fallback: transcriptNativeHasApi ? null : transcriptHasApi ? "export-probe" : null,
      fallbackMinVersion: transcriptHasApi ? "25.6.0" : null
    },
    "captions.inspect": { supported: supportedHost, readOnly: true, minVersion: "25.6.0" },
    "captions.create": { supported: false, reason: "No documented Premiere UXP caption creation API." },
    "captions.update": { supported: false, reason: "No documented Premiere UXP caption text/timing mutation API." },
    "captions.delete": { supported: false, reason: "No documented Premiere UXP caption deletion API." }
  });
  value.hostVersion = host && host.version || null;
  Object.assign(value, {
    events: {
      host: supportedHostEvents().map((event) => event.name),
      stateNotifications: true,
      journal: eventJournal.status(),
      fallbackPolling: { enabled: true, intervalMs: 5000 },
      operationLifecycle: ["started", "progress", "completed", "failed", "cancelled"]
    },
    operationSemantics: {
      mutations: "Only action-based commands executed by Project.executeTransaction may claim an undo boundary.",
      rollback: "No atomic rollback is claimed. Callers must inspect result verification metadata.",
      cancellation: "Cooperative before a non-cancellable Premiere host call; no interruption is claimed after that boundary."
    },
    fallback: { backend: "cep", reason: "Use CEP/QE only when a command is absent or reports unsupported; never silently retry a failed UXP mutation." }
  });
  return value;
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
  return Object.assign({ projectItemId: exported.projectItemId, projectItemName: exported.projectItemName }, result);
}

async function hasTranscript(args) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("No active project");
  if (!ppro.Transcript) throw new Error("Transcript APIs require Premiere Pro 25.6 or newer");
  const clip = await findProjectItem(project, args || {});
  const projectItem = ppro.ProjectItem.cast(clip);
  const context = { projectItemId: String(projectItem.getId()), projectItemName: clip.name, clip };
  if (typeof ppro.Transcript.hasTranscript === "function") {
    return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, hasTranscript: !!ppro.Transcript.hasTranscript(context.clip), method: "native" };
  }
  if (typeof ppro.Transcript.exportToJSON !== "function") throw new Error("This Premiere build cannot check transcripts");
  const present = await TranscriptSupport.probeTranscriptExport(function () {
    return ppro.Transcript.exportToJSON(context.clip);
  });
  return { projectItemId: context.projectItemId, projectItemName: context.projectItemName, hasTranscript: present, method: "export-probe" };
}

function canImportTranscript() {
  return TranscriptSupport.versionAtLeast(host && host.version, "25.6.0")
    && !!(ppro.Transcript && typeof ppro.Transcript.exportToJSON === "function")
    && typeof ppro.Transcript.importFromJSON === "function"
    && typeof ppro.Transcript.createImportTextSegmentsAction === "function";
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
  const outputDirectory = await workspaceBroker.assertPathAllowed(args.outputDirectory, { label: "outputDirectory", kind: "directory" });
  const filename = Protocol.safeFilename(args.filename);
  const position = args.seconds == null ? await sequence.getPlayerPosition() : await tickTime(args.seconds);
  const size = await sequence.getFrameSize();
  const width = positiveInt(args.width, size.width), height = positiveInt(args.height, size.height);
  assertNotCancelled(operation);
  operation.phase = "host_call";
  publishOperation("progress", operation, { phase: "host_call", progress: 0.4, cancellable: false });
  const returned = await ppro.Exporter.exportSequenceFrame(sequence, position, filename, outputDirectory, width, height);
  const path = Protocol.joinPath(outputDirectory, filename);
  return {
    path, width, height, seconds: position.seconds, exporterResult: returned,
    operation: Protocol.operationSemantics({
      mutatesProject: false,
      verificationStatus: "not_verified",
      verificationBoundary: "exporter_return_value",
      verificationEvidence: [{ type: "host_return", value: returned }],
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
    else if (cmd.command === "transcript.export") result = await exportTranscript(cmd.args);
    else if (cmd.command === "transcript.search") result = await searchTranscript(cmd.args);
    else if (cmd.command === "transcript.has") result = await hasTranscript(cmd.args);
    else if (cmd.command === "captions.inspect") result = await inspectCaptions();
    else {
      assertNotCancelled(operation);
      operation.phase = "host_call";
      result = await commandRegistry.dispatch(cmd.command, cmd.args);
    }
    const response = Protocol.envelope("result", {
      ok: true,
      result,
      operation: result && result.operation
        ? result.operation
        : Protocol.operationSemantics(
          (cmd.command.indexOf("transition.video.") === 0 && cmd.command !== "transition.video.list") || cmd.command === "transcript.import"
            ? {
                mutatesProject: true,
                verificationStatus: "verified",
                verificationBoundary: "project_executeTransaction_return",
                verificationEvidence: [{ type: "transaction", accepted: true }],
                undoSupported: true,
                undoLabel: cmd.command === "transcript.import"
                  ? "Import transcript"
                  : cmd.command === "transition.video.add"
                    ? "Add video transition"
                    : "Remove video transition",
                transactionActionGroup: true,
                cancellationSupported: true
              }
            : {
                mutatesProject: false,
                verificationStatus: "verified",
                verificationBoundary: "host_snapshot"
              }
        )
    }, cmd.requestId);
    // Validate the exact response before emitting a terminal success event. If
    // serialization rejects an oversized result, the catch path emits only
    // `failed`, never both `completed` and `failed` for one operation.
    Protocol.serializeEnvelope(response);
    publishOperation("completed", operation, { phase: "complete", progress: 1 });
    send(response);
  } catch (error) {
    const cancelled = error && error.code === "UXP_OPERATION_CANCELLED";
    const errorCode = cancelled
      ? "UXP_OPERATION_CANCELLED"
      : error && typeof error.code === "string" && /^UXP_[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : "UXP_COMMAND_FAILED";
    if (operation) publishOperation(cancelled ? "cancelled" : "failed", operation, {
      phase: operation.phase, progress: null, error: error.message || String(error)
    });
    send(Protocol.envelope("result", {
      ok: false,
      error: {
        code: errorCode,
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
    url = WorkspaceSupport.validateLoopbackBridgeUrl(configuredUrl);
    if (token) url.searchParams.set("token", token);
    url = url.toString();
  } catch (_) {
    return scheduleReconnect("Invalid bridge URL");
  }
  setStatus("Connecting to " + url.origin + url.pathname);
  try { socket = new WebSocket(url); } catch (e) { return scheduleReconnect(e.message); }
  socket.onopen = async () => { setStatus("Connected"); send(Protocol.envelope("hello", await capabilities())); publishState("connected"); };
  socket.onmessage = (event) => dispatch(event.data);
  socket.onerror = () => setStatus("Bridge connection error");
  socket.onclose = () => scheduleReconnect("Disconnected");
}
function scheduleReconnect(message) { setStatus(message + "; retrying in 2s"); reconnectTimer = setTimeout(connect, 2000); }
function send(value) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(Protocol.serializeEnvelope(value)); }
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
  const operation = constants.OperationCompleteEvent || {};
  const encoder = ppro.EncoderManager || {};
  return [
    hostEvent("project", "project.opened", project.OPENED, true),
    hostEvent("project", "project.closed", project.CLOSED, true),
    hostEvent("project", "project.dirty", project.DIRTY, true),
    hostEvent("project", "project.activated", project.ACTIVATED, true),
    hostEvent("project", "project.selection.changed", project.PROJECT_ITEM_SELECTION_CHANGED, true),
    hostEvent("sequence", "sequence.activated", sequence.ACTIVATED, true),
    hostEvent("sequence", "sequence.closed", sequence.CLOSED, true),
    hostEvent("sequence", "sequence.selection.changed", sequence.SELECTION_CHANGED, true),
    hostEvent("operation", "operation.import.complete", operation.IMPORT_MEDIA_COMPLETE || operation.EVENT_IMPORT_MEDIA_COMPLETE, false),
    hostEvent("operation", "operation.export.complete", operation.EXPORT_MEDIA_COMPLETE || operation.EVENT_EXPORT_MEDIA_COMPLETE, false),
    hostEvent("operation", "operation.effect.drop.complete", operation.EFFECT_DROP_COMPLETE || operation.EVENT_EFFECT_DROP_COMPLETE, false),
    hostEvent("operation", "operation.generative.extend.complete", operation.GENERATIVE_EXTEND_COMPLETE || operation.EVENT_GENERATIVE_EXTEND_COMPLETE, false),
    hostEvent("encoder", "encoder.queued", encoder.EVENT_RENDER_QUEUE, false),
    hostEvent("encoder", "encoder.progress", encoder.EVENT_RENDER_PROGRESS, false, "encoder.progress"),
    hostEvent("encoder", "encoder.complete", encoder.EVENT_RENDER_COMPLETE, false),
    hostEvent("encoder", "encoder.error", encoder.EVENT_RENDER_ERROR, false),
    hostEvent("encoder", "encoder.cancelled", encoder.EVENT_RENDER_CANCEL, false)
  ].filter((event) => event.eventName !== undefined && event.eventName !== null);
}
function hostEvent(category, name, eventName, stateInvalidating, coalesceKey) {
  return { category, name, eventName, stateInvalidating, coalesceKey: coalesceKey || null };
}
function subscribeHostEvents() {
  if (!ppro.EventManager || eventSubscriptions.length) return;
  supportedHostEvents().forEach((definition) => {
    const handler = (event) => recordHostEvent(definition, event);
    ppro.EventManager.addGlobalEventListener(definition.eventName, handler, false);
    eventSubscriptions.push({ eventName: definition.eventName, handler });
  });
}
function unsubscribeHostEvents() {
  if (!ppro.EventManager) return;
  eventSubscriptions.splice(0).forEach(({ eventName, handler }) => {
    try { ppro.EventManager.removeGlobalEventListener(eventName, handler, false); } catch (_) {}
  });
}
function recordHostEvent(definition, event) {
  const detail = {};
  if (event && typeof event === "object") {
    if (Number.isFinite(Number(event.state))) detail.state = Number(event.state);
    if (Number.isFinite(Number(event.progress))) detail.progress = Number(event.progress);
  }
  const receipt = eventJournal.append({
    category: definition.category,
    name: definition.name,
    detail,
    coalesceKey: definition.coalesceKey
  });
  if (receipt) send(Protocol.envelope("event", { name: "premiere.host.event", receipt }));
  if (definition.stateInvalidating) publishState("host-event", definition.name);
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

async function chooseWorkspace() {
  try {
    setStatus("Choose the folder that contains approved media, presets, and exports");
    await workspaceBroker.requestRoot();
    renderWorkspaceStatus();
    setStatus("Workspace access granted");
  } catch (error) {
    setStatus(error.message || String(error));
  }
}

async function revokeWorkspace() {
  try {
    await workspaceBroker.revoke();
    renderWorkspaceStatus();
    setStatus("Workspace access revoked");
  } catch (error) {
    setStatus(error.message || String(error));
  }
}

function renderWorkspaceStatus() {
  const element = document.getElementById("workspace-status"), value = workspaceBroker.status();
  if (element) element.textContent = value.configured
    ? "Approved folder: " + value.rootName + "\nPersistent access: yes\nNative path: redacted\nCanonical path validation: " + value.canonicalPathValidation
    : "No approved workspace folder";
}
