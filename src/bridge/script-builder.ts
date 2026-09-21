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

// TrackItem.start and TrackItem.end are independent writes on Premiere Pro
// 26.x: writing start never carries end along, and a start write that would
// pass the clip's current end is rejected silently. Write the two edges in the
// order that keeps start < end at every intermediate step (issue #550).
function __writeClipSpan(item, startTicks, endTicks) {
  var wantedStart = parseFloat(startTicks);
  var wantedEnd = parseFloat(endTicks);
  if (!(wantedEnd > wantedStart)) throw new Error("clip span must end after it starts");
  if (wantedStart > parseFloat(item.start.ticks)) {
    item.end = String(wantedEnd);
    item.start = String(wantedStart);
  } else {
    item.start = String(wantedStart);
    item.end = String(wantedEnd);
  }
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
  var wantedId = String(idOrName);
  for (var i = 0; i < project.sequences.numSequences; i++) {
    var seq = project.sequences[i];
    if (String(seq.sequenceID) === wantedId || seq.name === idOrName) {
      return seq;
    }
  }
  return null;
}

// Premiere can retain a reference to the last active sequence immediately after
// app.newProject() switches to a new, empty project. Never expose or mutate
// through that stale object: only a sequence currently enumerated by this
// project's SequenceCollection is a valid active sequence for this command.
function __isCurrentProjectSequence(sequence) {
  if (!sequence || !app || !app.project || !app.project.sequences) return false;
  var wantedId = "";
  try { wantedId = String(sequence.sequenceID); } catch (e) { return false; }
  for (var i = 0; i < app.project.sequences.numSequences; i++) {
    var candidate = app.project.sequences[i];
    try {
      if (candidate === sequence || String(candidate.sequenceID) === wantedId) return true;
    } catch (e) {}
  }
  return false;
}

function __getCurrentActiveSequence() {
  var sequence = null;
  try { sequence = app.project.activeSequence; } catch (e) { return null; }
  return __isCurrentProjectSequence(sequence) ? sequence : null;
}

function __findProjectItem(nodeIdOrName, rootItem) {
  if (!rootItem) rootItem = app.project.rootItem;
  var wantedId = String(nodeIdOrName);
  for (var i = 0; i < rootItem.children.numItems; i++) {
    var item = rootItem.children[i];
    if (String(item.nodeId) === wantedId || item.name === nodeIdOrName) {
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
  var wantedId = String(nodeId);

  // Search video tracks
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (String(clip.nodeId) === wantedId) {
        return { clip: clip, trackIndex: t, clipIndex: c, trackType: "video" };
      }
    }
  }

  // Search audio tracks
  for (var t = 0; t < seq.audioTracks.numTracks; t++) {
    var track = seq.audioTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (String(clip.nodeId) === wantedId) {
        return { clip: clip, trackIndex: t, clipIndex: c, trackType: "audio" };
      }
    }
  }

  return null;
}

// QE tracks include gaps and transitions in addition to clips, so a DOM clip
// index cannot safely be passed to qeTrack.getItemAt(). Resolve a QE clip by
// its timeline start instead. Return null rather than a nearest candidate: a
// mutation must never be redirected to a neighbouring clip.
function __findQeClipByDomClip(qeTrack, domClip) {
  if (!qeTrack || !domClip) return null;
  var wantedStart = null;
  try { wantedStart = parseFloat(domClip.start.ticks); } catch (eStart) {}
  if (wantedStart === null || isNaN(wantedStart)) return null;

  for (var qi = 0; qi < qeTrack.numItems; qi++) {
    var candidate = null;
    try { candidate = qeTrack.getItemAt(qi); } catch (eItem) {}
    if (!candidate || String(candidate.type) !== "Clip") continue;
    try {
      if (Math.abs(parseFloat(candidate.start.ticks) - wantedStart) < 1) return candidate;
    } catch (eCandidate) {}
  }
  return null;
}

// CEP's legacy QE path can enumerate a host's effect catalog before adding an
// effect to a timeline clip. Recent Premiere builds can expose QE yet return an
// empty catalog, so distinguish that host limitation from a misspelled effect
// name. Calling addVideoEffect/addAudioEffect without a catalog entry is not a
// safe fallback; an available UXP bridge has its own documented effect workflow.
function __getQeEffectCatalog(kind) {
  var label = kind === "audio" ? "audio" : "video";
  if (typeof app === "undefined" || typeof app.enableQE !== "function") {
    return { ok: false, error: "QE is unavailable in this Premiere build, so " + label + " effects cannot be enumerated or applied." };
  }

  try {
    app.enableQE();
  } catch (eEnable) {
    return { ok: false, error: "Premiere could not enable QE for " + label + " effect discovery: " + eEnable.toString() };
  }

  if (typeof qe === "undefined" || !qe.project) {
    return { ok: false, error: "QE did not expose a project after enableQE(), so " + label + " effects cannot be enumerated or applied." };
  }

  var getter = kind === "audio" ? qe.project.getAudioEffectList : qe.project.getVideoEffectList;
  if (typeof getter !== "function") {
    return { ok: false, error: "This Premiere QE build does not expose the " + label + " effect catalog API." };
  }

  var effects = null;
  try {
    effects = getter.call(qe.project);
  } catch (eList) {
    return { ok: false, error: "Premiere could not read its QE " + label + " effect catalog: " + eList.toString() };
  }

  var count = effects && typeof effects.numItems !== "undefined" ? Number(effects.numItems) : NaN;
  if (isNaN(count) || count < 1) {
    return {
      ok: false,
      error: "Premiere returned an empty legacy QE " + label + " effect catalog; no effect was applied. If the authenticated Premiere UXP bridge is connected, use manage_clip_effects_uxp with action 'catalog' and then 'add' instead. Existing clip components can still be inspected or edited."
    };
  }

  return { ok: true, effects: effects, count: count };
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

// macOS applications are bundles: AME/Premiere resources live below Contents,
// whereas the Windows installers put the same folders directly below the app root.
// On macOS the /Applications entry is normally a plain folder that holds the bundle
// ("/Applications/Adobe Media Encoder 2026/Adobe Media Encoder 2026.app"), so when
// Contents is not directly there, look one level down for the ".app".
function __adobeApplicationResourceFolder(appFolder, relativePath) {
  if (!__isMacOS()) return new Folder(appFolder.fsName + "/" + relativePath);

  var direct = new Folder(appFolder.fsName + "/Contents/" + relativePath);
  if (direct.exists) return direct;

  var bundles = appFolder.getFiles(function(f) { return /\\.app$/i.test(f.name); });
  for (var i = 0; i < bundles.length; i++) {
    var nested = new Folder(bundles[i].fsName + "/Contents/" + relativePath);
    if (nested.exists) return nested;
  }
  return direct;
}

// All export presets AME ships, plus the user's own saved presets.
function __collectAllPresets() {
  var roots = [];

  var ame = __adobeAppFolders("Adobe Media Encoder");
  for (var i = 0; i < ame.length; i++) {
    roots.push(__adobeApplicationResourceFolder(ame[i], "MediaIO/systempresets"));
  }

  var ppro = __adobeAppFolders("Adobe Premiere Pro");
  for (var j = 0; j < ppro.length; j++) {
    roots.push(__adobeApplicationResourceFolder(ppro[j], "Settings/IngestPresets"));
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

function __presetSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
    var proxyDir = __adobeApplicationResourceFolder(ppro[i], "Settings/IngestPresets/Proxy");
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
  var wantTiff = /\\.tiff?$/i.test(outputPath);
  var needles = wantJpeg ? ["jpeg", "jpg"] : (wantTiff ? ["tiff", "tif"] : ["png"]);
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

// Premiere's own timecode string for a tick position, in the sequence's display
// format (drop-frame sequences get semicolons, a "frames" display gets a bare frame
// count). The QE still exporters take (timecodeString, pathWithoutExtension): a ticks
// string is silently read as frame 0, a bare frame number is read as a timecode, and
// the (path, width, height) call returns false without writing anything.
function __qeTimecodeForTicks(seq, ticks) {
  var tb = parseFloat(seq.timebase); // ticks per frame
  var frameIdx = Math.floor(parseFloat(ticks) / tb + 0.000001);
  if (!(frameIdx >= 0)) frameIdx = 0;
  var frameTicks = frameIdx * tb;

  var displayFormat = 100;
  try { displayFormat = seq.getSettings().videoDisplayFormat; } catch (e) {}
  try {
    var fr = new Time(); fr.ticks = String(tb);
    var t = new Time(); t.ticks = String(frameTicks);
    if (typeof t.getFormatted === "function") {
      return { timecode: t.getFormatted(fr, displayFormat), frame: frameIdx };
    }
  } catch (e2) {}

  // Fallback: non-drop timecode at the nominal integer base (24 for 23.976, 30 for 29.97).
  var nominal = Math.round(TICKS_PER_SECOND / tb);
  var ff = frameIdx % nominal;
  var s = Math.floor(frameIdx / nominal) % 60;
  var m = Math.floor(frameIdx / (nominal * 60)) % 60;
  var h = Math.floor(frameIdx / (nominal * 3600));
  return { timecode: __pad(h) + ":" + __pad(m) + ":" + __pad(s) + ":" + __pad(ff), frame: frameIdx };
}

// Export a single frame to disk. Returns { ok, method, path, notes, timecode, frame }
// / { ok:false, error, notes }.
//
// exportFramePNG/exportFrameJPEG do NOT exist on the public DOM sequence — only on
// the QE sequence — where they take a timecode string and a path WITHOUT extension
// (they append .png / .jpg themselves). The playhead is never moved: the timecode
// argument alone selects the frame. We verify against the filesystem rather than the
// return value, and fall back to a one-frame Media Encoder export.
function __exportStillFrame(outputPath, ticks) {
  var seq = app.project.activeSequence;
  if (!seq) return { ok: false, error: "No active sequence", notes: [] };

  var notes = [];
  var atTicks = ticks;
  if (!atTicks) {
    try { atTicks = seq.getPlayerPosition().ticks; } catch (e) { atTicks = "0"; }
  }

  var dot = outputPath.lastIndexOf(".");
  var slash = Math.max(outputPath.lastIndexOf("/"), outputPath.lastIndexOf("\\\\"));
  var ext = dot > slash ? outputPath.substring(dot).toLowerCase() : "";
  if (ext === "") { outputPath = outputPath + ".png"; ext = ".png"; }
  var basePath = outputPath.substring(0, outputPath.length - ext.length);
  var wantJpeg = ext === ".jpg" || ext === ".jpeg";
  var qeCanWrite = wantJpeg || ext === ".png";
  var qePath = basePath + (wantJpeg ? ".jpg" : ".png");

  // Clear any stale file (under either name) so that a file existing afterwards proves we wrote it.
  var stale = new File(outputPath);
  if (stale.exists) { try { stale.remove(); } catch (e) {} }
  var staleQe = new File(qePath);
  if (staleQe.exists) { try { staleQe.remove(); } catch (e) {} }

  // --- Path 1: QE DOM. Signature is (timecodeString, pathWithoutExtension). ---
  var at = null;
  if (!qeCanWrite) {
    notes.push("QE: no still exporter for " + ext + "; using Media Encoder");
  } else {
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
          at = __qeTimecodeForTicks(seq, atTicks);
          notes.push("QE " + qeSeq.name + " @ " + at.timecode + " (frame " + at.frame + ") returned " + fn.call(qeSeq, at.timecode, basePath));
        }
      }
    } catch (eQE) {
      notes.push("QE: " + eQE.toString());
    }
  }

  // QE always names the file base + ".png"/".jpg"; give the caller the name they asked for.
  var produced = new File(qePath);
  if (qePath !== outputPath && produced.exists && produced.length > 0) {
    try { produced.rename(decodeURI(new File(outputPath).name)); } catch (e) {}
  }

  var written = __firstWrittenFile(outputPath);
  if (written) {
    return { ok: true, method: "qe", path: written, notes: notes, timecode: at ? at.timecode : null, frame: at ? at.frame : null };
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
      // Unreadable in/out cannot be restored. Changing them anyway left the
      // sequence pinned to a one-frame export range after QE-to-AME fallback.
      if (savedIn === null || savedIn === undefined || savedOut === null || savedOut === undefined) {
        notes.push("AME: could not read sequence in/out points, so they were not changed for a one-frame export");
      } else {
        // seq.timebase is ticks-per-frame, but Sequence.setInPoint/setOutPoint take
        // seconds (unlike setPlayerPosition, which takes ticks). Convert before
        // setting the one-frame range or Premiere targets an astronomically large
        // interval and the still export produces no file.
        var frameTicks = parseFloat(seq.timebase);
        var startTicks = parseFloat(atTicks);
        try {
          seq.setInPoint(__ticksToSeconds(startTicks));
          seq.setOutPoint(__ticksToSeconds(startTicks + frameTicks));
          seq.exportAsMediaDirect(outputPath, preset, app.encoder.ENCODE_IN_TO_OUT);
          notes.push("AME preset: " + preset);
        } finally {
          try { seq.setInPoint(__ticksToSeconds(savedIn)); } catch (eIn) {}
          try { seq.setOutPoint(__ticksToSeconds(savedOut)); } catch (eOut) {}
        }
      }
    }
  } catch (eAME) {
    notes.push("AME: " + eAME.toString());
  }

  written = __firstWrittenFile(outputPath);
  if (written) return { ok: true, method: "ame", path: written, notes: notes, timecode: null, frame: null };

  return {
    ok: false,
    error: "Frame export produced no file on disk. Neither the QE DOM nor Media Encoder wrote " + outputPath,
    notes: notes
  };
}

// Sequence.insertClip(item, time, vTrack, aTrack) only ripples the two named
// tracks. Premiere's UI insert also razors and shifts every sync-locked track;
// the public DOM Track object has no isSyncLocked. QE exposes it. Default
// scope "sync_locked" matches the UI; "target_tracks" is an explicit desync.
function __insertClipHonoringSyncLock(seq, item, timeTicks, videoTrackIndex, audioTrackIndex, scope) {
  if (!seq) return { ok: false, error: "No active sequence" };
  if (!item) return { ok: false, error: "No clip to insert" };

  var targetOnly = scope === "target_tracks";
  var vTrackIndex = parseInt(videoTrackIndex, 10);
  var aTrackIndex = parseInt(audioTrackIndex, 10);
  if (isNaN(vTrackIndex) || vTrackIndex < 0 || isNaN(aTrackIndex) || aTrackIndex < 0) {
    return { ok: false, error: "video_track_index and audio_track_index must be non-negative integers" };
  }

  var videoTrack = seq.videoTracks[vTrackIndex];
  var audioTrack = seq.audioTracks[aTrackIndex];
  if (!videoTrack) return { ok: false, error: "Video track index " + vTrackIndex + " is out of range" };
  if (!audioTrack) return { ok: false, error: "Audio track index " + aTrackIndex + " is out of range" };

  var insertTicks = parseFloat(timeTicks);
  if (isNaN(insertTicks)) return { ok: false, error: "Insert time is not a valid tick value" };

  if (!targetOnly) {
    var activeSeq = null;
    try { activeSeq = app.project.activeSequence; } catch (eAct) { activeSeq = null; }
    if (!activeSeq) {
      return { ok: false, error: "Insert refused; nothing was changed. There is no active sequence, so QE cannot razor the same timeline. Activate the target sequence and retry, or pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
    }
    var activeId = "";
    var seqId = "";
    try { activeId = String(activeSeq.sequenceID); } catch (eId1) {}
    try { seqId = String(seq.sequenceID); } catch (eId2) {}
    if (!seqId || activeId !== seqId) {
      return { ok: false, error: "Insert refused; nothing was changed. The target sequence is not the active sequence, so QE would razor a different timeline. Activate it and retry, or pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
    }
  }

  var frameTicks = seq.timebase ? parseFloat(seq.timebase) : NaN;
  if (!frameTicks || isNaN(frameTicks)) frameTicks = TICKS_PER_SECOND / 24;
  var tol = frameTicks;

  var durationTicks = NaN;
  try { durationTicks = parseFloat(item.getOutPoint().ticks) - parseFloat(item.getInPoint().ticks); } catch (eDur) {}
  if (!(durationTicks > 0)) {
    try { durationTicks = parseFloat(item.getOutPoint(4).ticks) - parseFloat(item.getInPoint(4).ticks); } catch (eDur4) {}
  }
  if (!(durationTicks > 0)) {
    return { ok: false, error: "The source clip has no positive in/out duration, so an insert cannot be verified." };
  }

  function domTrackFor(type, idx) {
    return type === "video" ? seq.videoTracks[idx] : seq.audioTracks[idx];
  }

  var qeSeq = null;
  if (!targetOnly) {
    try {
      if (typeof app === "undefined" || typeof app.enableQE !== "function") {
        return { ok: false, error: "QE is unavailable, so sync-lock state cannot be read and the insert was not attempted. Pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
      }
      app.enableQE();
    } catch (eQE) {
      return { ok: false, error: "Premiere could not enable QE, so sync-lock state cannot be read and the insert was not attempted. Pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
    }
    try { qeSeq = (typeof qe !== "undefined" && qe.project) ? qe.project.getActiveSequence() : null; } catch (eSeq) { qeSeq = null; }
    if (!qeSeq) {
      return { ok: false, error: "No active sequence (QE); cannot read sync-lock state, so the insert was not attempted. Pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
    }
  }

  function qeTrackFor(type, idx) {
    if (!qeSeq) return null;
    return type === "video" ? qeSeq.getVideoTrackAt(idx) : qeSeq.getAudioTrackAt(idx);
  }

  var parts = [];
  function addPart(type, idx, isTarget) {
    var dt = domTrackFor(type, idx);
    if (!dt) return;
    parts.push({ type: type, index: idx, domTrack: dt, isTarget: isTarget });
  }

  addPart("video", vTrackIndex, true);
  addPart("audio", aTrackIndex, true);

  if (!targetOnly) {
    var vN = seq.videoTracks.numTracks;
    var aN = seq.audioTracks.numTracks;
    var ti;
    for (ti = 0; ti < vN; ti++) {
      if (ti === vTrackIndex) continue;
      var slv = null;
      try {
        var qv = qeTrackFor("video", ti);
        if (qv && typeof qv.isSyncLocked === "function") slv = !!qv.isSyncLocked();
      } catch (e1) { slv = null; }
      if (slv === null) {
        return { ok: false, error: "Insert refused; nothing was changed. Could not read isSyncLocked() on video track " + ti + ". Pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
      }
      if (slv) addPart("video", ti, false);
    }
    for (ti = 0; ti < aN; ti++) {
      if (ti === aTrackIndex) continue;
      var sla = null;
      try {
        var qa = qeTrackFor("audio", ti);
        if (qa && typeof qa.isSyncLocked === "function") sla = !!qa.isSyncLocked();
      } catch (e2) { sla = null; }
      if (sla === null) {
        return { ok: false, error: "Insert refused; nothing was changed. Could not read isSyncLocked() on audio track " + ti + ". Pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
      }
      if (sla) addPart("audio", ti, false);
    }
  }

  var lockedList = [];
  var pi;
  for (pi = 0; pi < parts.length; pi++) {
    var lk = null;
    try {
      if (typeof parts[pi].domTrack.isLocked === "function") lk = !!parts[pi].domTrack.isLocked();
    } catch (eDomLock) { lk = null; }
    if (lk === null) {
      try {
        var ql = qeTrackFor(parts[pi].type, parts[pi].index);
        if (ql && typeof ql.isLocked === "function") lk = !!ql.isLocked();
      } catch (e3) { lk = null; }
    }
    if (!targetOnly && lk === null) {
      return { ok: false, error: "Insert refused; nothing was changed. Could not read isLocked() on " + parts[pi].type + " track " + parts[pi].index + ". Pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks)." };
    }
    if (lk) lockedList.push(parts[pi].type + " track " + parts[pi].index);
  }
  if (lockedList.length) {
    return { ok: false, error: "Insert refused; nothing was changed. These tracks must shift but are locked: " + lockedList.join(", ") + ". Unlock them or use scope 'target_tracks' (which will desync other tracks)." };
  }

  var shiftPlan = [];
  for (pi = 0; pi < parts.length; pi++) {
    var t = parts[pi];
    if (t.isTarget) continue;
    var straddlers = [];
    var movers = [];
    var ci;
    for (ci = 0; ci < t.domTrack.clips.numItems; ci++) {
      var c = t.domTrack.clips[ci];
      var cs = parseFloat(c.start.ticks);
      var ce = parseFloat(c.end.ticks);
      if (cs < insertTicks - tol && ce > insertTicks + tol) {
        straddlers.push({ nodeId: String(c.nodeId), start: cs, end: ce });
        continue;
      }
      if (cs >= insertTicks - tol) {
        movers.push({ nodeId: String(c.nodeId), start: cs, end: ce });
      }
    }
    shiftPlan.push({ type: t.type, index: t.index, domTrack: t.domTrack, movers: movers, straddlers: straddlers });
  }

  var needRazor = false;
  for (pi = 0; pi < shiftPlan.length; pi++) {
    if (shiftPlan[pi].straddlers.length) needRazor = true;
  }
  if (needRazor) {
    var razorAt = null;
    try { razorAt = __qeTimecodeForTicks(seq, insertTicks); } catch (eTc) {}
    if (!razorAt || !razorAt.timecode) {
      return { ok: false, error: "Insert refused; nothing was changed. Could not format a QE razor timecode for the insert point." };
    }
    for (pi = 0; pi < shiftPlan.length; pi++) {
      if (!shiftPlan[pi].straddlers.length) continue;
      var razorTrack = null;
      try { razorTrack = qeTrackFor(shiftPlan[pi].type, shiftPlan[pi].index); } catch (eProbe) {}
      if (!razorTrack || typeof razorTrack.razor !== "function") {
        return { ok: false, error: "Insert refused; nothing was changed. Sync-locked " + shiftPlan[pi].type + " track " + shiftPlan[pi].index + " has a clip spanning the insert point and QE razor is unavailable, so those tracks cannot be rippled without slicing through them. Razor them first or pass scope 'target_tracks' (which will desync other tracks)." };
      }
    }
    var razored = [];
    for (pi = 0; pi < shiftPlan.length; pi++) {
      if (!shiftPlan[pi].straddlers.length) continue;
      try {
        qeTrackFor(shiftPlan[pi].type, shiftPlan[pi].index).razor(razorAt.timecode);
        razored.push(shiftPlan[pi].type + " " + shiftPlan[pi].index);
      } catch (razorErr) {
        return { ok: false, error: "QE razor failed on " + shiftPlan[pi].type + " track " + shiftPlan[pi].index + (razored.length ? " after already razoring " + razored.join(", ") : "") + ", so the timeline is partially changed: " + razorErr.toString() };
      }
      shiftPlan[pi].movers = [];
      var stillSpan = false;
      for (ci = 0; ci < shiftPlan[pi].domTrack.clips.numItems; ci++) {
        var rc = shiftPlan[pi].domTrack.clips[ci];
        var rcs = parseFloat(rc.start.ticks);
        var rce = parseFloat(rc.end.ticks);
        if (rcs < insertTicks - tol && rce > insertTicks + tol) stillSpan = true;
        if (rcs >= insertTicks - tol) {
          shiftPlan[pi].movers.push({ nodeId: String(rc.nodeId), start: rcs, end: rce });
        }
      }
      if (stillSpan) {
        return { ok: false, error: "QE razor did not split a spanning clip on " + shiftPlan[pi].type + " track " + shiftPlan[pi].index + ", so the timeline is partially changed. Razor that track at the insert point or pass scope 'target_tracks' (which will desync other tracks)." };
      }
    }
  }

  var beforeVideoIds = {};
  var beforeAudioIds = {};
  var i;
  var beforeVideoCount = videoTrack.clips.numItems;
  var beforeAudioCount = audioTrack.clips.numItems;
  for (i = 0; i < beforeVideoCount; i++) beforeVideoIds[String(videoTrack.clips[i].nodeId)] = true;
  for (i = 0; i < beforeAudioCount; i++) beforeAudioIds[String(audioTrack.clips[i].nodeId)] = true;

  function expectedAddedForTrack(track) {
    var ci2;
    for (ci2 = 0; ci2 < track.clips.numItems; ci2++) {
      var cs2 = parseFloat(track.clips[ci2].start.ticks);
      var ce2 = parseFloat(track.clips[ci2].end.ticks);
      if (cs2 < insertTicks - tol && ce2 > insertTicks + tol) return 2;
    }
    return 1;
  }
  var expectedVideoAdded = expectedAddedForTrack(videoTrack);
  var expectedAudioAdded = expectedAddedForTrack(audioTrack);
  var afterRazorNote = needRazor
    ? " after sync-locked tracks were razored at the insert point, so the timeline is partially changed"
    : "";

  try {
    seq.insertClip(item, String(timeTicks), vTrackIndex, aTrackIndex);
  } catch (insErr) {
    return { ok: false, error: "Premiere rejected Sequence.insertClip" + afterRazorNote + ": " + insErr.toString() };
  }

  var afterVideoCount = videoTrack.clips.numItems;
  var afterAudioCount = audioTrack.clips.numItems;
  if (afterVideoCount > beforeVideoCount + expectedVideoAdded || afterAudioCount > beforeAudioCount + expectedAudioAdded) {
    return { ok: false, error: "Premiere inserted more clips on a targeted track than a split-plus-insert accounts for" + afterRazorNote + ". This can leave a residual frame fragment at an exact boundary; the insertion is not reported as verified." };
  }

  var insertedClips = [];
  for (i = 0; i < afterVideoCount; i++) {
    if (!beforeVideoIds[String(videoTrack.clips[i].nodeId)]) insertedClips.push(videoTrack.clips[i]);
  }
  for (i = 0; i < afterAudioCount; i++) {
    if (!beforeAudioIds[String(audioTrack.clips[i].nodeId)]) insertedClips.push(audioTrack.clips[i]);
  }
  if (!insertedClips.length) {
    return { ok: false, error: "Premiere did not add a new track item at the requested insertion point" + afterRazorNote + "." };
  }

  var matched = false;
  var actualDuration = durationTicks;
  var bestDiff = null;
  for (i = 0; i < insertedClips.length; i++) {
    var ic = insertedClips[i];
    if (!(ic.projectItem && String(ic.projectItem.nodeId) === String(item.nodeId))) continue;
    var insertedStart = parseFloat(ic.start.ticks);
    if (Math.abs(insertedStart - insertTicks) > tol) continue;
    var insertedDuration = parseFloat(ic.end.ticks) - insertedStart;
    var durationDiff = Math.abs(insertedDuration - durationTicks);
    if (bestDiff === null || durationDiff < bestDiff) {
      bestDiff = durationDiff;
      matched = true;
      actualDuration = insertedDuration;
    }
  }
  if (!matched) {
    return { ok: false, error: "Premiere changed the target track but the requested project item was not found after insertion" + afterRazorNote + "." };
  }
  if (!(actualDuration > 0)) actualDuration = durationTicks;

  var moved = 0;
  var failures = [];
  if (!targetOnly) {
    for (pi = 0; pi < shiftPlan.length; pi++) {
      var tp = shiftPlan[pi];
      tp.movers.sort(function (a, b) { return b.start - a.start; });
      for (var mi = 0; mi < tp.movers.length; mi++) {
        var want = tp.movers[mi];
        var found = null;
        for (var fi = 0; fi < tp.domTrack.clips.numItems; fi++) {
          if (String(tp.domTrack.clips[fi].nodeId) === want.nodeId) { found = tp.domTrack.clips[fi]; break; }
        }
        if (!found) { failures.push(tp.type + " " + tp.index + ": clip " + want.nodeId + " vanished before it could be shifted"); continue; }
        try {
          __writeClipSpan(found, want.start + actualDuration, want.end + actualDuration);
          moved++;
        } catch (shiftErr) {
          failures.push(tp.type + " " + tp.index + ": " + want.nodeId + " -> " + shiftErr.toString());
        }
      }
    }
  }

  var verifyProblems = [];
  if (!targetOnly) {
    for (pi = 0; pi < shiftPlan.length; pi++) {
      var tv = shiftPlan[pi];
      for (var vi = 0; vi < tv.movers.length; vi++) {
        var w = tv.movers[vi];
        var got = null;
        for (var gi = 0; gi < tv.domTrack.clips.numItems; gi++) {
          if (String(tv.domTrack.clips[gi].nodeId) === w.nodeId) { got = tv.domTrack.clips[gi]; break; }
        }
        if (!got) { verifyProblems.push(tv.type + " " + tv.index + ": " + w.nodeId + " not found after shifting"); continue; }
        var gs = parseFloat(got.start.ticks);
        var gd = parseFloat(got.end.ticks) - gs;
        if (Math.abs(gs - (w.start + actualDuration)) > tol) {
          verifyProblems.push(tv.type + " " + tv.index + ": expected start " + __ticksToSeconds(w.start + actualDuration) + "s, got " + __ticksToSeconds(gs) + "s");
        }
        if (Math.abs(gd - (w.end - w.start)) > tol) {
          verifyProblems.push(tv.type + " " + tv.index + ": duration changed from " + __ticksToSeconds(w.end - w.start) + "s to " + __ticksToSeconds(gd) + "s");
        }
      }
    }
  }

  if (failures.length || verifyProblems.length) {
    return { ok: false, error: "The clip was inserted on the named tracks but sync-locked tracks were not rippled cleanly, so the timeline is now partially desynced and needs checking. " + failures.concat(verifyProblems).join("; ") + "." };
  }

  var tracksAffected = [];
  for (pi = 0; pi < parts.length; pi++) tracksAffected.push(parts[pi].type + " " + parts[pi].index);

  var data = {
    inserted: true,
    added: true,
    verified: true,
    syncLockHonored: !targetOnly,
    item: item.name,
    atSeconds: __ticksToSeconds(insertTicks),
    durationSeconds: __ticksToSeconds(actualDuration),
    videoTrackIndex: vTrackIndex,
    audioTrackIndex: aTrackIndex,
    clipsShifted: moved,
    tracksAffected: tracksAffected,
    scope: targetOnly ? "target_tracks" : "sync_locked",
    insertedTrackItems: insertedClips.length
  };
  if (targetOnly) {
    data.warning = "Only the named tracks were rippled. Other tracks were left in place and may be out of sync. This will desync any sync-locked neighbours.";
  }
  return { ok: true, data: data };
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
