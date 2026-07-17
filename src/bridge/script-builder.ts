/**
 * Builds ExtendScript strings with helper functions prepended.
 * All generated code must be ES3-compatible (var, no arrow functions, no let/const).
 */
import { createHash } from "node:crypto";

const HELPERS = `
// === MCP Bridge Helpers (auto-prepended) ===

// ExtendScript (ES3) has no native JSON object. Tool scripts use __jsonStringify
// directly, but LLM-authored code via execute_extendscript reaches for
// JSON.stringify reflexively — give it a global. Parse is intentionally omitted:
// implementing it needs eval, which the command validator blocks.
// The engine is shared and long-lived, so also REPLACE our own earlier wrapper if
// one is already installed (detected via the __mcpPolyfill flag or its source) —
// a stale wrapper closing over an older __jsonStringify caused recursion bugs.
// A real json2-style implementation loaded by another extension is left alone.
if (typeof JSON === "undefined") {
  JSON = {};
}
if (!JSON.stringify || JSON.__mcpPolyfill === true || String(JSON.stringify).indexOf("__jsonStringify") !== -1) {
  JSON.__mcpPolyfill = true;
  JSON.stringify = function (obj) { return __jsonStringify(obj); };
}

// Premiere's createNewSequence(name, id) expects a UUID-shaped id; anything else
// can fall back to interactive UI (a modal New Sequence dialog) and wedge the bridge.
function __uuid() {
  var hex = "0123456789abcdef";
  var s = "";
  for (var i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) { s += "-"; continue; }
    if (i === 14) { s += "4"; continue; }
    var r = Math.floor(Math.random() * 16);
    if (i === 19) { r = (r & 3) | 8; }
    s += hex.charAt(r);
  }
  return s;
}

var TICKS_PER_SECOND = 254016000000;

function __ticksToSeconds(ticks) {
  return parseFloat(ticks) / TICKS_PER_SECOND;
}

function __secondsToTicks(seconds) {
  return Math.round(parseFloat(seconds) * TICKS_PER_SECOND);
}

function __ticksToTimecode(ticks, fps) {
  var totalSeconds = __ticksToSeconds(ticks);
  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor((totalSeconds % 3600) / 60);
  var secs = Math.floor(totalSeconds % 60);
  var frames = Math.floor((totalSeconds % 1) * fps);
  return __pad(hours) + ":" + __pad(minutes) + ":" + __pad(secs) + ":" + __pad(frames);
}

function __pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function __findSequence(idOrName) {
  var project = app.project;
  for (var i = 0; i < project.sequences.numSequences; i++) {
    var seq = project.sequences[i];
    if (seq.sequenceID === idOrName || seq.name === idOrName) {
      return seq;
    }
  }
  return null;
}

function __findProjectItem(nodeIdOrName, rootItem) {
  if (!rootItem) rootItem = app.project.rootItem;
  for (var i = 0; i < rootItem.children.numItems; i++) {
    var item = rootItem.children[i];
    if (item.nodeId === nodeIdOrName || item.name === nodeIdOrName) {
      return item;
    }
    if (item.type === 2) { // Bin
      var found = __findProjectItem(nodeIdOrName, item);
      if (found) return found;
    }
  }
  return null;
}

function __findClip(nodeId) {
  var seq = app.project.activeSequence;
  if (!seq) return null;

  // Search video tracks
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (clip.nodeId === nodeId) {
        return { clip: clip, trackIndex: t, clipIndex: c, trackType: "video" };
      }
    }
  }

  // Search audio tracks
  for (var t = 0; t < seq.audioTracks.numTracks; t++) {
    var track = seq.audioTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (clip.nodeId === nodeId) {
        return { clip: clip, trackIndex: t, clipIndex: c, trackType: "audio" };
      }
    }
  }

  return null;
}

function __getAllClips(seq) {
  if (!seq) seq = app.project.activeSequence;
  if (!seq) return [];
  var clips = [];

  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      clips.push({
        nodeId: clip.nodeId,
        name: clip.name,
        trackIndex: t,
        trackType: "video",
        inPoint: __ticksToSeconds(clip.inPoint.ticks),
        outPoint: __ticksToSeconds(clip.outPoint.ticks),
        start: __ticksToSeconds(clip.start.ticks),
        end: __ticksToSeconds(clip.end.ticks),
        duration: __ticksToSeconds(clip.duration.ticks),
        mediaType: clip.mediaType
      });
    }
  }

  for (var t = 0; t < seq.audioTracks.numTracks; t++) {
    var track = seq.audioTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      clips.push({
        nodeId: clip.nodeId,
        name: clip.name,
        trackIndex: t,
        trackType: "audio",
        inPoint: __ticksToSeconds(clip.inPoint.ticks),
        outPoint: __ticksToSeconds(clip.outPoint.ticks),
        start: __ticksToSeconds(clip.start.ticks),
        end: __ticksToSeconds(clip.end.ticks),
        duration: __ticksToSeconds(clip.duration.ticks),
        mediaType: clip.mediaType
      });
    }
  }

  return clips;
}

// Premiere's ExtendScript API exposes no preset/format enumeration (there is no
// encoder.getFormatList()), so presets have to be discovered by walking the .epr
// files Adobe ships on disk.

function __isMacOS() {
  return !!($.os && $.os.toLowerCase().indexOf("mac") !== -1);
}

// Version-agnostic: returns install folders whose name starts with appNamePrefix,
// e.g. "Adobe Premiere Pro" -> [.../Adobe Premiere Pro 2026, .../Adobe Premiere Pro 2025]
function __adobeAppFolders(appNamePrefix) {
  var base = new Folder(__isMacOS() ? "/Applications" : "C:\\\\Program Files\\\\Adobe");
  if (!base.exists) return [];

  var found = [];
  var subs = base.getFiles(function(f) { return f instanceof Folder; });
  for (var i = 0; i < subs.length; i++) {
    if (subs[i].displayName.indexOf(appNamePrefix) === 0) found.push(subs[i]);
  }
  // Newest version first, so a 2026 preset wins over a stale 2024 one.
  found.sort(function(a, b) { return a.displayName < b.displayName ? 1 : -1; });
  return found;
}

function __collectEprFiles(folder, out) {
  if (!folder || !folder.exists) return out;
  var entries = folder.getFiles();
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (entry instanceof Folder) __collectEprFiles(entry, out);
    else if (/\\.epr$/i.test(entry.name)) out.push(entry);
  }
  return out;
}

// All export presets AME ships, plus the user's own saved presets.
function __collectAllPresets() {
  var roots = [];

  var ame = __adobeAppFolders("Adobe Media Encoder");
  for (var i = 0; i < ame.length; i++) {
    roots.push(new Folder(ame[i].fsName + "/MediaIO/systempresets"));
  }

  var ppro = __adobeAppFolders("Adobe Premiere Pro");
  for (var j = 0; j < ppro.length; j++) {
    roots.push(new Folder(ppro[j].fsName + "/Settings/IngestPresets"));
  }

  // User-saved presets live under the Documents tree on both platforms.
  var userRoot = new Folder(Folder.myDocuments.fsName + "/Adobe/Adobe Media Encoder");
  if (userRoot.exists) {
    var versions = userRoot.getFiles(function(f) { return f instanceof Folder; });
    for (var v = 0; v < versions.length; v++) {
      roots.push(new Folder(versions[v].fsName + "/Presets"));
    }
  }

  var presets = [];
  for (var r = 0; r < roots.length; r++) {
    var eprs = __collectEprFiles(roots[r], []);
    for (var e = 0; e < eprs.length; e++) {
      presets.push({
        name: decodeURI(eprs[e].displayName).replace(/\\.epr$/i, ""),
        path: eprs[e].fsName,
        // The parent folder is the format bucket, e.g. "48323634" (hex "H264").
        format: eprs[e].parent ? decodeURI(eprs[e].parent.displayName) : ""
      });
    }
  }
  return presets;
}

// Default export preset. "48323634" is hex for "H264" — the folder name AME uses
// for the H.264 format bucket on disk.
function __findH264Preset() {
  var presets = __collectAllPresets();
  var candidates = [];
  for (var i = 0; i < presets.length; i++) {
    var haystack = (presets[i].name + " " + presets[i].format).toLowerCase();
    if (haystack.indexOf("h264") !== -1 || haystack.indexOf("h.264") !== -1 || haystack.indexOf("48323634") !== -1) {
      candidates.push(presets[i]);
    }
  }
  if (!candidates.length) return "";

  for (var j = 0; j < candidates.length; j++) {
    if (candidates[j].name.toLowerCase().indexOf("match source - high") !== -1) return candidates[j].path;
  }
  return candidates[0].path;
}

function __findProxyPreset() {
  var ppro = __adobeAppFolders("Adobe Premiere Pro");
  for (var i = 0; i < ppro.length; i++) {
    var proxyDir = new Folder(ppro[i].fsName + "/Settings/IngestPresets/Proxy");
    var eprs = __collectEprFiles(proxyDir, []);
    if (eprs.length) {
      eprs.sort(function(a, b) { return a.displayName < b.displayName ? -1 : 1; });
      return eprs[0].fsName;
    }
  }
  return "";
}

function __findStillPreset(outputPath) {
  var wantJpeg = /\\.jpe?g$/i.test(outputPath);
  var needles = wantJpeg ? ["jpeg", "jpg"] : ["png"];
  var presets = __collectAllPresets();

  for (var n = 0; n < needles.length; n++) {
    for (var i = 0; i < presets.length; i++) {
      var haystack = (presets[i].name + " " + presets[i].format).toLowerCase();
      if (haystack.indexOf(needles[n]) !== -1) return presets[i].path;
    }
  }
  return "";
}

// Returns the path actually written, or "" if nothing was. Media Encoder treats a
// still export as a one-frame image *sequence* and appends a frame number to the
// filename, so an exact-path miss is not proof that nothing was written.
function __firstWrittenFile(outputPath) {
  var exact = new File(outputPath);
  if (exact.exists && exact.length > 0) return exact.fsName;

  var dir = exact.parent;
  if (!dir || !dir.exists) return "";

  var fullName = decodeURI(exact.name);
  var dot = fullName.lastIndexOf(".");
  var base = dot === -1 ? fullName : fullName.substring(0, dot);
  var ext = dot === -1 ? "" : fullName.substring(dot).toLowerCase();

  var matches = dir.getFiles(function(candidate) {
    if (candidate instanceof Folder) return false;
    var nm = decodeURI(candidate.name);
    if (nm.indexOf(base) !== 0) return false;
    return ext === "" || nm.toLowerCase().substring(nm.length - ext.length) === ext;
  });
  if (!matches || !matches.length) return "";

  // Normalize back to the caller's requested path so they get the name they asked for.
  var produced = matches[0];
  if (produced.length <= 0) return "";
  try {
    if (produced.fsName !== exact.fsName) produced.rename(fullName);
    return exact.exists ? exact.fsName : produced.fsName;
  } catch (e) {
    return produced.fsName;
  }
}

// Export a single frame to disk. Returns { ok, method, path, notes } / { ok:false, error, notes }.
//
// exportFramePNG/exportFrameJPEG do NOT exist on the public DOM sequence — only on
// the QE sequence — and even there they return false and write nothing on some
// builds. So we try QE first, verify against the filesystem rather than the return
// value, and fall back to a one-frame Media Encoder export.
function __exportStillFrame(outputPath, ticks) {
  var seq = app.project.activeSequence;
  if (!seq) return { ok: false, error: "No active sequence", notes: [] };

  var notes = [];
  var savedPos = null;
  try { savedPos = seq.getPlayerPosition().ticks; } catch (e) {}

  if (ticks) {
    try { seq.setPlayerPosition(String(ticks)); } catch (e) { notes.push("setPlayerPosition: " + e.toString()); }
  }
  var atTicks = ticks;
  if (!atTicks) {
    try { atTicks = seq.getPlayerPosition().ticks; } catch (e) { atTicks = "0"; }
  }

  // Clear any stale file so that a file existing afterwards proves we wrote it.
  var stale = new File(outputPath);
  if (stale.exists) { try { stale.remove(); } catch (e) {} }

  var wantJpeg = /\\.jpe?g$/i.test(outputPath);

  // --- Path 1: QE DOM. Signature is (path, width, height) with string args. ---
  try {
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) {
      notes.push("QE: no active sequence");
    } else {
      var fn = wantJpeg ? qeSeq.exportFrameJPEG : qeSeq.exportFramePNG;
      if (typeof fn !== "function") {
        notes.push("QE: exportFrame" + (wantJpeg ? "JPEG" : "PNG") + " unavailable on this build");
      } else {
        var w = String(seq.frameSizeHorizontal);
        var h = String(seq.frameSizeVertical);
        try {
          notes.push("QE returned " + fn.call(qeSeq, outputPath, w, h));
        } catch (eArgs) {
          try { notes.push("QE returned " + fn.call(qeSeq, outputPath, w)); }
          catch (eArgs2) { notes.push("QE: " + eArgs2.toString()); }
        }
      }
    }
  } catch (eQE) {
    notes.push("QE: " + eQE.toString());
  }

  var written = __firstWrittenFile(outputPath);
  if (written) {
    if (savedPos) { try { seq.setPlayerPosition(savedPos); } catch (e) {} }
    return { ok: true, method: "qe", path: written, notes: notes };
  }
  notes.push("QE wrote no file; falling back to Media Encoder");

  // --- Path 2: one-frame export through Media Encoder. ---
  try {
    var preset = __findStillPreset(outputPath);
    if (!preset) {
      notes.push("AME: no " + (wantJpeg ? "JPEG" : "PNG") + " still preset found on disk");
    } else {
      var savedIn = null, savedOut = null;
      try {
        savedIn = seq.getInPointAsTime().ticks;
        savedOut = seq.getOutPointAsTime().ticks;
      } catch (e) {}

      // seq.timebase is ticks-per-frame, so in..in+timebase is exactly one frame.
      var frameTicks = parseFloat(seq.timebase);
      var startTicks = parseFloat(atTicks);
      seq.setInPoint(String(startTicks));
      seq.setOutPoint(String(startTicks + frameTicks));

      try {
        seq.exportAsMediaDirect(outputPath, preset, app.encoder.ENCODE_IN_TO_OUT);
        notes.push("AME preset: " + preset);
      } finally {
        try {
          if (savedIn !== null) seq.setInPoint(savedIn);
          if (savedOut !== null) seq.setOutPoint(savedOut);
        } catch (e) {}
      }
    }
  } catch (eAME) {
    notes.push("AME: " + eAME.toString());
  }

  if (savedPos) { try { seq.setPlayerPosition(savedPos); } catch (e) {} }

  written = __firstWrittenFile(outputPath);
  if (written) return { ok: true, method: "ame", path: written, notes: notes };

  return {
    ok: false,
    error: "Frame export produced no file on disk. Neither the QE DOM nor Media Encoder wrote " + outputPath,
    notes: notes
  };
}

function __jsonStringify(obj) {
  // ES3-compatible JSON stringify. Never delegate to JSON.stringify here: the
  // global JSON polyfill above is a wrapper around THIS function, so delegating
  // creates infinite mutual recursion ("InternalError: Stack overrun") that took
  // down every __result call in the shared engine.
  if (obj === null) return "null";
  if (obj === undefined) return "undefined";
  if (typeof obj === "string") return '"' + obj.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, "\\\\n") + '"';
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (obj instanceof Array) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) {
      arr.push(__jsonStringify(obj[i]));
    }
    return "[" + arr.join(",") + "]";
  }
  if (typeof obj === "object") {
    var parts = [];
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) {
        parts.push(__jsonStringify(k) + ":" + __jsonStringify(obj[k]));
      }
    }
    return "{" + parts.join(",") + "}";
  }
  return String(obj);
}

function __result(data) {
  return __jsonStringify({ success: true, data: data });
}

function __error(msg) {
  return __jsonStringify({ success: false, error: String(msg) });
}

// === End MCP Bridge Helpers ===
`;

/**
 * The helpers are NOT inlined into every command. Re-sending ~14KB of helper code
 * with each evalScript both wastes the 200ms-polling pipe and — observed on
 * Premiere 26.2.2 — can hit "InternalError: Stack overrun" once the long-lived
 * ExtendScript engine has degraded, at which point every tool call dies with an
 * opaque "EvalScript error.". Instead the file bridge writes the helpers to
 * <tempDir>/helpers_<version>.jsx once, and each command carries only a tiny
 * bootstrap that $.evalFile's them into the engine if this exact version isn't
 * loaded yet. Self-healing across engine restarts, and each version of the server
 * loads its own helpers file, so upgrades can't execute stale helpers.
 */
export const HELPERS_VERSION = createHash("md5").update(HELPERS).digest("hex").slice(0, 12);

export function getHelpersSource(): string {
  return `${HELPERS}
var __HELPERS_V = "${HELPERS_VERSION}";
`;
}

export function helpersFileName(): string {
  return `helpers_${HELPERS_VERSION}.jsx`;
}

/**
 * Build the bootstrap + user-code command script. The helpers file path is only
 * known to the file bridge, which injects it via buildBootstrap().
 */
export function buildBootstrap(helpersPath: string): string {
  const escaped = helpersPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `if (typeof __HELPERS_V === "undefined" || __HELPERS_V !== "${HELPERS_VERSION}") { $.evalFile("${escaped}"); }`;
}

/**
 * Build a complete ExtendScript by wrapping user code in an IIFE.
 * Helper functions are loaded by the bootstrap the file bridge prepends.
 */
export function buildScript(code: string): string {
  return `(function() {
  try {
    ${code}
  } catch(e) {
    return __error(e.toString());
  }
})();`;
}

/**
 * Escape a string for safe embedding in ExtendScript.
 */
export function escapeForExtendScript(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Build a script that wraps code returning a value.
 * The code should use `return __result(...)` or `return __error(...)`.
 * @deprecated Use buildScript() directly. This is an alias kept for backward compatibility.
 */
export const buildToolScript = buildScript;
