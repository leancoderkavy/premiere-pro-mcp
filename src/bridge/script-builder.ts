/**
 * Builds ExtendScript strings with helper functions prepended.
 * All generated code must be ES3-compatible (var, no arrow functions, no let/const).
 */
import { createHash } from "node:crypto";
import { expectedProjectPath } from "./project-guard.js";
import { undoTrackingEnabled } from "./undo-tracking.js";

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

function __workAreaEnabled(seq) {
  try {
    if (typeof seq.isWorkAreaEnabled !== "function") return null;
    var enabled = seq.isWorkAreaEnabled();
    return typeof enabled === "boolean" ? enabled : null;
  } catch (workAreaStateError) { return null; }
}

// Sequence work-area getters return seconds (often as a string) on live 25.x
// and 26.x hosts. Values above 1e6 can only be ticks, so convert those.
function __workAreaSeconds(value) {
  var number = parseFloat(value);
  if (!isFinite(number) || number <= -399999) return null;
  return number > 1000000 ? number / TICKS_PER_SECOND : number;
}

function __secondsToTicks(seconds) {
  return Math.round(parseFloat(seconds) * TICKS_PER_SECOND);
}

// Sequence timeline writes use the sequence's frame grid. Premiere stores
// sequence.timebase as ticks per frame; keep this separate from source media
// clocks because edit offsets are expressed in timeline frames.
function __sequenceFrameTicks(sequence) {
  var ticks = NaN;
  try { ticks = parseFloat(sequence.timebase); } catch (frameError) {}
  return isFinite(ticks) && ticks > 0 ? ticks : NaN;
}

function __snapSequenceTicks(sequence, ticks) {
  var frameTicks = __sequenceFrameTicks(sequence);
  if (!isFinite(frameTicks)) throw new Error("the active sequence frame grid could not be read");
  var frameCount = parseFloat(ticks) / frameTicks;
  var roundedFrames = frameCount < 0 ? -Math.round(-frameCount) : Math.round(frameCount);
  return Math.round(roundedFrames * frameTicks);
}

function __frameSnapReceipt(requestedTicks, appliedTicks, frameTicks, requestedName, appliedName) {
  var receipt = {};
  if (!isFinite(frameTicks) || frameTicks <= 0 || Math.abs(appliedTicks - requestedTicks) <= frameTicks / 1000) return receipt;
  receipt[requestedName] = __ticksToSeconds(requestedTicks);
  receipt[appliedName] = __ticksToSeconds(appliedTicks);
  return receipt;
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

// Tick comparisons for values that round-trip through seconds (ProjectItem
// marks take seconds). Far below one frame at any frame rate.
var __TICK_MATCH_TOL = 16;

function __isTrackLocked(track) {
  try {
    if (track && typeof track.isLocked === "function") return !!track.isLocked();
  } catch (eLocked) {}
  return false;
}

// Read the private source range before temporarily changing project-item marks.
function __itemMarksForRestore(item, mediaType) {
  function domMarks() {
    try {
      var inMark = item.getInPoint(mediaType), outMark = item.getOutPoint(mediaType);
      if (!inMark || !outMark || inMark.ticks === null || outMark.ticks === null || inMark.ticks === undefined || outMark.ticks === undefined || String(inMark.ticks) === "" || String(outMark.ticks) === "") return null;
      var left = Number(inMark.ticks), right = Number(outMark.ticks);
      if (isFinite(left) && isFinite(right) && left >= 0 && right >= left) return { inTicks: String(Math.round(left)), outTicks: String(Math.round(right)), inSeconds: left / TICKS_PER_SECOND, outSeconds: right / TICKS_PER_SECOND };
    } catch (domMarkError) {}
    return null;
  }
  var dom = domMarks(), xml = "";
  try { if (typeof item.getProjectMetadata === "function") xml = String(item.getProjectMetadata() || ""); } catch (metadataMarkError) { return null; }
  if (!xml) return dom;
  if (xml.length > 1000000) return null;
  function field(name, text) {
    var escaped = name.replace(/\\./g, "\\\\.");
    var pattern = new RegExp("<(?:[A-Za-z_][\\\\w.-]*:)?" + escaped + "\\\\b[^>]*>([\\\\s\\\\S]*?)</(?:[A-Za-z_][\\\\w.-]*:)?" + escaped + "\\\\s*>");
    var match = pattern.exec(text);
    return match ? match[1] : null;
  }
  function value(text) {
    if (text === null) return null;
    var nested = field("value", text);
    return String(nested === null ? text : nested).replace(/^\\s+|\\s+$/g, "");
  }
  var timebase = value(field("Column.Intrinsic.MediaTimebase", xml));
  function point(block, audio) {
    if (block === null) return null;
    var tc = value(block), match = /^(\\d+):(\\d{2}):(\\d{2})([:;])(\\d+)$/.exec(tc);
    if (!match) return null;
    var hours = Number(match[1]), minutes = Number(match[2]), seconds = Number(match[3]), last = Number(match[5]);
    if (minutes > 59 || seconds > 59) return null;
    var rateText = value(field("frame_rate", block));
    var hz = audio && timebase && (/Hz/i.test(timebase) || parseFloat(timebase) > 240) ? parseFloat(timebase) : NaN;
    if (audio && isFinite(hz) && hz > 0) {
      if (match[4] === ";" || last >= hz || Math.floor(hz) !== hz) return null;
      return { ticks: Math.round(((hours * 3600 + minutes * 60 + seconds) * hz + last) * TICKS_PER_SECOND / hz), frameTicks: TICKS_PER_SECOND / hz };
    }
    var frameTicks = rateText !== null ? Number(rateText) : NaN;
    if (rateText !== null && (!isFinite(frameTicks) || frameTicks <= 0)) return null;
    if (!(frameTicks > 0)) {
      var fps = timebase ? parseFloat(timebase) : NaN;
      if (!isFinite(fps) || fps <= 0 || fps > 240 || /Hz/i.test(timebase)) {
        try { fps = Number(item.getFootageInterpretation().frameRate); } catch (footageRateError) { fps = NaN; }
      }
      if (!isFinite(fps) || fps <= 0 || fps > 240) return null;
      if (Math.abs(fps - 23.976) < 0.001) frameTicks = TICKS_PER_SECOND * 1001 / 24000;
      else if (Math.abs(fps - 29.97) < 0.001) frameTicks = TICKS_PER_SECOND * 1001 / 30000;
      else if (Math.abs(fps - 59.94) < 0.001) frameTicks = TICKS_PER_SECOND * 1001 / 60000;
      else frameTicks = TICKS_PER_SECOND / fps;
    }
    var actualRate = TICKS_PER_SECOND / frameTicks, nominal = Math.round(actualRate);
    if (nominal < 1 || nominal > 240 || last >= nominal) return null;
    var frames = (hours * 3600 + minutes * 60 + seconds) * nominal + last;
    if (match[4] === ";") {
      var dropped = 0;
      if (nominal === 30) dropped = 2;
      else if (nominal === 60) dropped = 4;
      if (!dropped || Math.abs(actualRate - nominal * 1000 / 1001) > 0.01 || (minutes % 10 !== 0 && seconds === 0 && last < dropped)) return null;
      var totalMinutes = hours * 60 + minutes;
      frames -= dropped * (totalMinutes - Math.floor(totalMinutes / 10));
    }
    return { ticks: Math.round(frames * frameTicks), frameTicks: frameTicks };
  }
  var kind = mediaType === 2 ? "Audio" : "Video";
  var inBlock = field("Column.Intrinsic." + kind + "InPoint", xml), outBlock = field("Column.Intrinsic." + kind + "OutPoint", xml);
  var videoFieldsPresent = xml.indexOf("Column.Intrinsic.VideoInPoint") >= 0 || xml.indexOf("Column.Intrinsic.VideoOutPoint") >= 0;
  if (mediaType === 4 && inBlock === null && outBlock === null && !videoFieldsPresent) {
    kind = "Audio";
    inBlock = field("Column.Intrinsic.AudioInPoint", xml); outBlock = field("Column.Intrinsic.AudioOutPoint", xml);
  }
  if (inBlock === null && outBlock === null) {
    if (xml.indexOf("Column.Intrinsic." + kind + "InPoint") >= 0 || xml.indexOf("Column.Intrinsic." + kind + "OutPoint") >= 0) return null;
    return dom;
  }
  var left = point(inBlock, kind === "Audio"), right = point(outBlock, kind === "Audio");
  // The private VideoOutPoint names the last frame (inclusive): a subclip made
  // with an exclusive Out at frame 719 shows 00:00:29:22 (frame 718) on 26.5.2.
  if (right && kind !== "Audio") right.ticks += right.frameTicks;
  if (!left || !right || !isFinite(left.ticks) || !isFinite(right.ticks) || left.ticks < 0 || right.ticks > 9007199254740991 || right.ticks <= left.ticks || Math.abs(left.frameTicks - right.frameTicks) > 1) return null;
  var tolerance = Math.max(left.frameTicks, right.frameTicks);
  if (dom && Math.abs(Number(dom.inTicks) - left.ticks) <= tolerance && Math.abs(Number(dom.outTicks) - right.ticks) <= tolerance) return dom;
  // Premiere floors a written mark to the media's frame (or sample) grid, so a
  // value exactly on the boundary can land one frame early (live 26.5.2: a
  // restored Out of 00:00:29:22 read back 00:00:29:21). Write a quarter frame
  // past the boundary; the ticks stay on the boundary for readback checks.
  return { inTicks: String(left.ticks), outTicks: String(right.ticks), inSeconds: (left.ticks + left.frameTicks / 4) / TICKS_PER_SECOND, outSeconds: (right.ticks + right.frameTicks / 4) / TICKS_PER_SECOND };
}

// Place exactly [inTicks, outTicks) of a project item on ONE track at
// startTicks without rippling. Track.overwriteClip places the item's In/Out
// range, so set those marks first and restore the item's own marks afterwards.
// mediaType: 1 = video, 2 = audio. Callers must prove the destination range is
// empty first; overwrite never shifts neighbours but would replace them.
// Returns { ok, attempted, marksRestored, error }. attempted=true means the
// overwrite call ran (or threw), so the timeline may have changed.
// Set a project item's In/Out marks, ordering the writes so the In never
// passes the current Out, and report whether both read back within tolerance
// ticks (default: exact).
function __setItemMarks(item, wantIn, wantOut, mediaType, tolerance) {
  var tol = tolerance > __TICK_MATCH_TOL ? tolerance : __TICK_MATCH_TOL;
  var currentOut = parseFloat(item.getOutPoint(mediaType).ticks);
  if (parseFloat(wantIn) >= currentOut) {
    item.setOutPoint(__ticksToSeconds(wantOut), mediaType);
    item.setInPoint(__ticksToSeconds(wantIn), mediaType);
  } else {
    item.setInPoint(__ticksToSeconds(wantIn), mediaType);
    item.setOutPoint(__ticksToSeconds(wantOut), mediaType);
  }
  return Math.abs(parseFloat(item.getInPoint(mediaType).ticks) - parseFloat(wantIn)) <= tol &&
    Math.abs(parseFloat(item.getOutPoint(mediaType).ticks) - parseFloat(wantOut)) <= tol;
}

// Live 26.5.2: a project item's video marks are floored to the media's own
// frame grid (a 23.976 clip in a 29.97 sequence loses up to 1.25 sequence
// frames) and audio marks to the sample grid. Returns the most a mark can
// move, in ticks.
function __itemMarkToleranceTicks(item, seq, mediaType) {
  var seqFrame = __sequenceFrameTicks(seq);
  if (!isFinite(seqFrame) || !(seqFrame > 0)) seqFrame = 0;
  if (mediaType !== 1) return seqFrame / 2;
  var mediaFrame = 0;
  try {
    var fps = parseFloat(item.getFootageInterpretation().frameRate);
    if (fps > 0) mediaFrame = TICKS_PER_SECOND / fps;
  } catch (eInterp) {}
  return Math.max(mediaFrame, seqFrame);
}

function __readItemMarks(item, mediaType) {
  if (!item || typeof item.getInPoint !== "function" || typeof item.getOutPoint !== "function" ||
      typeof item.setInPoint !== "function" || typeof item.setOutPoint !== "function") return null;
  try {
    return { inTicks: String(item.getInPoint(mediaType).ticks), outTicks: String(item.getOutPoint(mediaType).ticks) };
  } catch (eMarks) { return null; }
}

// Check, before any timeline change, that the item accepts this source range
// (a still or a too-short clip does not), then put its marks back.
function __itemAcceptsRange(item, inTicks, outTicks, mediaType, tolerance) {
  var original = __itemMarksForRestore(item, mediaType);
  if (!original || typeof item.getInPoint !== "function" || typeof item.setInPoint !== "function") return { ok: false, marksRestored: true, error: "Could not reliably read or set the project item's In/Out marks" };
  var accepted = false;
  try { accepted = __setItemMarks(item, inTicks, outTicks, mediaType, tolerance); } catch (eSet) { accepted = false; }
  var restored = false;
  try { restored = __setItemMarks(item, original.inTicks, original.outTicks, mediaType); } catch (eRestore) { restored = false; }
  return {
    ok: accepted,
    marksRestored: restored,
    error: accepted ? "" : "Premiere did not accept a source range of " + __ticksToSeconds(String(parseFloat(outTicks) - parseFloat(inTicks))) + "s from " + __ticksToSeconds(String(inTicks)) + "s on project item " + item.name
  };
}

function __overwriteRangeOnTrack(track, item, startTicks, inTicks, outTicks, mediaType, tolerance) {
  if (!track || typeof track.overwriteClip !== "function") {
    return { ok: false, attempted: false, marksRestored: true, error: "Track.overwriteClip is unavailable on this Premiere build" };
  }
  if (!item || typeof item.getInPoint !== "function" || typeof item.getOutPoint !== "function" ||
      typeof item.setInPoint !== "function" || typeof item.setOutPoint !== "function") {
    return { ok: false, attempted: false, marksRestored: true, error: "Project item In/Out marks cannot be set on this Premiere build" };
  }
  var original = __itemMarksForRestore(item, mediaType);
  if (!original) {
    return { ok: false, attempted: false, marksRestored: true, error: "Could not reliably read the project item's In/Out marks; nothing was changed" };
  }
  function restore() {
    try { return __setItemMarks(item, original.inTicks, original.outTicks, mediaType); } catch (eRestore) { return false; }
  }
  var applied = false;
  try { applied = __setItemMarks(item, inTicks, outTicks, mediaType, tolerance); } catch (eSet) { applied = false; }
  if (!applied) {
    return { ok: false, attempted: false, marksRestored: restore(), error: "Premiere did not apply the source In/Out range to project item " + item.name };
  }
  var at = new Time();
  at.ticks = String(startTicks);
  try {
    track.overwriteClip(item, at);
  } catch (eOverwrite) {
    return { ok: false, attempted: true, marksRestored: restore(), error: "Track.overwriteClip rejected project item " + item.name + ": " + eOverwrite.toString() };
  }
  return { ok: true, attempted: true, marksRestored: restore(), error: "" };
}

function __ticksToTimecode(ticks, fps) {
  // Count whole frames from ticks first. Deriving frames from fractional
  // seconds floors float error: 121.6 s at 25 fps gave frame 14 instead of 15.
  var totalFrames = Math.floor(parseFloat(ticks) * fps / TICKS_PER_SECOND + 1e-6);
  var framesPerHour = fps * 3600;
  var hours = Math.floor(totalFrames / framesPerHour);
  var remainder = totalFrames - hours * framesPerHour;
  var minutes = Math.floor(remainder / (fps * 60));
  remainder -= minutes * fps * 60;
  var secs = Math.floor(remainder / fps);
  var frames = remainder - secs * fps;
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

// Sequence.getInPoint/getOutPoint/getWorkArea*Point return SECONDS (as a
// string), not ticks, and -400000 when the point is unset (verified on
// Premiere Pro 25.2). Returns null for unset or unreadable points.
function __sequencePointSeconds(value) {
  var seconds = Number(value);
  if (!isFinite(seconds) || seconds <= -399999) return null;
  return seconds;
}

// Premiere reports sample rates as a Time holding one sample period. Returns
// the rate in Hz (e.g. 48000), or null when it cannot be derived.
function __sampleRateHz(value) {
  if (value === null || value === undefined) return null;
  var ticks = NaN;
  try { if (value.ticks !== undefined) ticks = parseFloat(value.ticks); } catch (eTicks) {}
  if (isFinite(ticks) && ticks > 0) return Math.round(TICKS_PER_SECOND / ticks);
  var numeric = Number(value);
  if (isFinite(numeric) && numeric > 1) return Math.round(numeric);
  return null;
}

function __sequenceFrameSize(seq) {
  var width = NaN, height = NaN;
  try { width = Number(seq.frameSizeHorizontal); height = Number(seq.frameSizeVertical); } catch (eSize) {}
  if (!(width > 0 && height > 0)) {
    try { var settings = seq.getSettings(); width = Number(settings.videoFrameWidth); height = Number(settings.videoFrameHeight); } catch (eSettings) {}
  }
  return { width: width, height: height };
}

// Anchor Point is relative to the clip's own source frame.
function __clipSourceFrameSize(clip, seq) {
  try {
    var info = /VideoInfo>\\s*([0-9]+)\\s*x\\s*([0-9]+)/.exec(String(clip.projectItem.getProjectMetadata()));
    if (info) return { width: Number(info[1]), height: Number(info[2]) };
  } catch (eInfo) {}
  return __sequenceFrameSize(seq);
}

// Premiere's scripting API stores Motion Position and Anchor Point normalized
// to the frame (0.5, 0.5 is the centre; verified on 25.2). Tools take pixels,
// so scale before writing. Writing pixels directly threw clips ~1000 frame
// widths off screen. The current value is not used to guess the space: a clip
// already damaged that way reads back in the thousands.
function __motionPointScale(prop, frame) {
  if (!(frame.width > 0 && frame.height > 0)) return null;
  return { x: 1 / frame.width, y: 1 / frame.height, normalized: true };
}

// Premiere renames Motion "Scale" to "Scale Height" once a clip has been set
// to non-uniform scale, and keeps that name after uniform scale is turned
// back on (verified on 25.2). The two names are the same uniform scale only
// while the component's Uniform Scale box is on; on a non-uniformly scaled
// clip "Scale Height" is the height alone, so the exact name is required.
function __isUniformScale(component) {
  if (!component || !component.properties) return false;
  for (var i = 0; i < component.properties.numItems; i++) {
    var prop = component.properties[i];
    if (!__videoIntrinsicPropertyMatches(prop, "Uniform Scale")) continue;
    try {
      var value = prop.getValue();
      return value === true || value === 1;
    } catch (eUniform) {
      return false;
    }
  }
  return false;
}
// Colour parameters (Lumetri White Balance, Fill Color, ...) read through
// getValue() as one 64-bit packed number above 2^53, so the low bits are lost
// and writing it back stores a different colour (measured on 25.2: a grey
// came back as transparent blue). getColorValue() returns the exact
// [alpha, red, green, blue] and throws on any non-colour parameter.
function __readColorValue(prop) {
  if (!prop || typeof prop.getColorValue !== "function") return null;
  var color;
  try { color = prop.getColorValue(); } catch (eColor) { return null; }
  if (!color || color.length !== 4) return null;
  var out = [];
  for (var i = 0; i < 4; i++) {
    var channel = Number(color[i]);
    if (!isFinite(channel)) return null;
    out.push(channel);
  }
  return out;
}
// Built-in Motion/Opacity components have stable match names, but their
// property display names are localized. These es-ES labels were measured on
// Premiere 26.5.2 (#722); unknown labels fail closed rather than guessing an
// ordinal or a property match name that the CEP API has not confirmed.
function __videoIntrinsicPropertyMatches(property, wanted) {
  if (!property) return false;
  var actual = String(property.displayName);
  if (actual === wanted) return true;
  var spanish = {
    "Opacity": "Opacidad",
    "Position": "Posición",
    "Scale": "Escala",
    "Scale Height": "Altura de escala",
    "Scale Width": "Anchura de escala",
    "Uniform Scale": "Escala uniforme",
    "Rotation": "Rotación"
  };
  return actual === spanish[wanted];
}
function __propertyNameMatches(actual, wanted, component) {
  actual = String(actual);
  wanted = String(wanted);
  if (actual === wanted) return true;
  var aliased = (wanted === "Scale" && actual === "Scale Height") || (wanted === "Scale Height" && actual === "Scale");
  return aliased && __isUniformScale(component);
}
function __availablePropertyNames(component) {
  var names = [];
  var counts = {};
  var total = 0;
  for (var i = 0; i < component.properties.numItems; i++) {
    var name = "";
    try { name = String(component.properties[i].displayName || ""); } catch (eName) {}
    if (!name.replace(/\\s/g, "")) continue;
    total++;
    names.push({ name: name, index: i });
    var key = "$" + name;
    counts[key] = (counts[key] || 0) + 1;
  }
  var shown = [];
  var limit = Math.min(names.length, 25);
  for (var n = 0; n < limit; n++) {
    var entry = names[n];
    shown.push(counts["$" + entry.name] > 1 ? entry.name + " (property_index " + entry.index + ")" : entry.name);
  }
  var summary = shown.length ? shown.join(", ") : "none with a non-empty display name";
  if (total > limit) summary += " (first " + limit + " of " + total + ")";
  return summary;
}
function __resolveProperty(component, wanted, propertyIndex) {
  var matches = [];
  if (propertyIndex !== null && propertyIndex !== undefined) {
    if (typeof propertyIndex !== "number" || !isFinite(propertyIndex) || Math.floor(propertyIndex) !== propertyIndex || propertyIndex < 0 || propertyIndex >= component.properties.numItems) {
      return { property: null, index: null, candidates: [], error: "property_index is out of range. Available properties: " + __availablePropertyNames(component) + "." };
    }
    if (!__propertyNameMatches(component.properties[propertyIndex].displayName, wanted, component)) {
      return { property: null, index: null, candidates: [], error: "property_index " + propertyIndex + " does not match property name '" + wanted + "'. Available properties: " + __availablePropertyNames(component) + "." };
    }
    return { property: component.properties[propertyIndex], index: propertyIndex, candidates: [propertyIndex], error: null };
  }
  for (var i = 0; i < component.properties.numItems; i++) {
    if (__propertyNameMatches(component.properties[i].displayName, wanted, component)) matches.push(i);
  }
  if (matches.length > 1) {
    return { property: null, index: null, candidates: matches, error: "Property name '" + wanted + "' is ambiguous at property indices [" + matches.join(", ") + "]; pass property_index. Available properties: " + __availablePropertyNames(component) + "." };
  }
  if (!matches.length) return { property: null, index: null, candidates: [], error: "Property name '" + wanted + "' not found. Available properties: " + __availablePropertyNames(component) + "." };
  return { property: component.properties[matches[0]], index: matches[0], candidates: matches, error: null };
}

// Scale a clip's Motion component uniformly and read it back. With Uniform
// Scale on, "Scale" (or its renamed "Scale Height") scales both axes. With it
// off, "Scale" is the height alone (live 25.2.3: writing Scale 120 left Scale
// Width at 100 and stretched the picture), so the width is written too.
// Returns { ok, uniform, error }.
function __setMotionScale(motion, value) {
  var uniform = __isUniformScale(motion);
  var height = null;
  var width = null;
  var heightIndices = [];
  var widthIndices = [];
  for (var i = 0; i < motion.properties.numItems; i++) {
    if (__videoIntrinsicPropertyMatches(motion.properties[i], "Scale") || __videoIntrinsicPropertyMatches(motion.properties[i], "Scale Height")) { height = motion.properties[i]; heightIndices.push(i); }
    else if (__videoIntrinsicPropertyMatches(motion.properties[i], "Scale Width")) { width = motion.properties[i]; widthIndices.push(i); }
  }
  if (heightIndices.length > 1) return { ok: false, uniform: uniform, error: "Motion Scale is ambiguous at property indices [" + heightIndices.join(", ") + "]; nothing was changed." };
  if (widthIndices.length > 1) return { ok: false, uniform: uniform, error: "Motion Scale Width is ambiguous at property indices [" + widthIndices.join(", ") + "]; nothing was changed." };
  if (!height) return { ok: false, uniform: uniform, error: "Motion has no Scale property; nothing was changed." };
  if (!uniform && !width) return { ok: false, uniform: uniform, error: "Uniform Scale is off but Motion has no Scale Width property, so the clip cannot be scaled evenly; nothing was changed." };
  height.setValue(value, true);
  if (!uniform) width.setValue(value, true);
  var readHeight = Number(height.getValue());
  var readWidth = uniform ? readHeight : Number(width.getValue());
  if (!(Math.abs(readHeight - value) < 0.01) || !(Math.abs(readWidth - value) < 0.01)) {
    return { ok: false, uniform: uniform, error: "Premiere did not apply the scale: it reads back as " + readHeight + (uniform ? "" : " (height) and " + readWidth + " (width)") + " instead of " + value + "." };
  }
  return { ok: true, uniform: uniform };
}

// TrackItem.isDisabled() does not exist on Premiere 25.2; the state is the
// boolean "disabled" property. Callers wrapped isDisabled() in try/catch, so
// every disabled clip was silently reported as enabled.
function __isClipDisabled(clip) {
  try {
    if (typeof clip.disabled === "boolean") return clip.disabled;
    if (clip.disabled === 1 || clip.disabled === 0) return clip.disabled === 1;
  } catch (eDisabled) {}
  try { if (typeof clip.isDisabled === "function") return !!clip.isDisabled(); } catch (eIsDisabled) {}
  return false;
}

// How many timeline clips, in every sequence, use this project item.
function __projectItemUsage(item) {
  // A bin's usage is the usage of everything inside it: deleting the bin
  // deletes its contents and their timeline clips.
  var wanted = {};
  var collect = function (entry) {
    wanted[String(entry.nodeId)] = true;
    if (__isBinItem(entry)) {
      var count = __childCount(entry);
      for (var k = 0; k < count; k++) { var child = __childAt(entry, k); if (child) collect(child); }
    }
  };
  collect(item);
  var usage = { clips: 0, sequences: [] };
  for (var sq = 0; sq < app.project.sequences.numSequences; sq++) {
    var sequenceInUse = app.project.sequences[sq];
    var hit = false;
    var groups = [sequenceInUse.videoTracks, sequenceInUse.audioTracks];
    for (var g = 0; g < groups.length; g++) {
      for (var t = 0; t < groups[g].numTracks; t++) {
        var trackClips = groups[g][t].clips;
        for (var c = 0; c < trackClips.numItems; c++) {
          try {
            if (trackClips[c].projectItem && wanted[String(trackClips[c].projectItem.nodeId)]) { usage.clips++; hit = true; }
          } catch (eUse) {}
        }
      }
    }
    if (hit) usage.sequences.push(String(sequenceInUse.name));
  }
  return usage;
}

// Premiere has no documented delete for a clip/file project item, but deleting
// a bin deletes what it contains. Move the item into a fresh temporary bin and
// delete that bin; restore on failure. Callers must refuse items still used on
// a timeline unless the caller confirmed, because deleting the item also
// removes those timeline clips, and this path is not undoable.
function __deleteProjectItemViaBin(item) {
  var itemId = String(item.nodeId);
  var holderName = "mcp-delete-" + new Date().getTime();
  var rootCount = __childCount(app.project.rootItem);
  for (var r = 0; r < rootCount; r++) {
    var existing = __childAt(app.project.rootItem, r);
    if (existing && String(existing.name) === holderName) {
      return { ok: false, changed: false, error: "A bin named " + holderName + " already exists, so the temporary bin could not be told apart from it. Nothing was deleted." };
    }
  }
  var holder = null;
  try { holder = app.project.rootItem.createBin(holderName); } catch (eCreate) {}
  if (!holder) return { ok: false, changed: false, error: "Premiere could not create a temporary bin for the deletion. Nothing was deleted." };
  var holderId = String(holder.nodeId);
  var originalParent = null;
  try { originalParent = item.getBin ? item.getBin() : null; } catch (eParent) {}
  try { item.moveBin(holder); } catch (eMove) {
    try { holder.deleteBin(); } catch (eCleanup) {}
    return { ok: false, changed: !!__findProjectItemByNodeId(holderId), error: "Premiere could not move the item into a temporary bin: " + eMove.toString() + "." };
  }
  try { holder.deleteBin(); } catch (eDelete) {
    try { if (originalParent) item.moveBin(originalParent); } catch (eRestore) {}
    return { ok: false, changed: true, error: "Premiere could not delete the temporary bin " + holderName + ": " + eDelete.toString() + ". Check the Project panel." };
  }
  var itemLeft = !!__findProjectItemByNodeId(itemId);
  var holderLeft = !!__findProjectItemByNodeId(holderId);
  if (itemLeft || holderLeft) {
    return { ok: false, changed: true, error: "The project changed: after deleting the temporary bin " + holderName + ", " + (itemLeft && holderLeft ? "the item and the bin are" : (itemLeft ? "the item is" : "the temporary bin is")) + " still in the project. Check the Project panel." };
  }
  return { ok: true, changed: true };
}

function __isBinItem(item) {
  if (!item) return false;
  try { return item.type === 2; } catch (e) { return false; }
}

// ProjectItemType names: CLIP=1, BIN=2, ROOT=3, FILE=4. Written as if/else on
// purpose: ExtendScript parses chained ternaries (a ? b : c ? d : e) left to
// right, so "item.type === 1 ? 'clip' : item.type === 2 ? ..." yields the wrong
// name in Premiere even though it is correct in Node.
function __projectItemTypeName(item) {
  var type = null;
  try { type = item.type; } catch (e) { return "unknown"; }
  if (type === 1) return "clip";
  if (type === 2) return "bin";
  if (type === 3) return "root";
  if (type === 4) return "file";
  return "unknown";
}

// Like __projectItemTypeName, but reports sequences (CLIP items whose
// isSequence() is true) as "sequence".
function __projectItemKind(item) {
  var name = __projectItemTypeName(item);
  if (name === "clip") {
    try { if (item.isSequence && item.isSequence()) return "sequence"; } catch (e) {}
  }
  return name;
}

// Some bin-typed project items (search bins, items mid-refresh) expose no
// children collection. A project walk must skip them instead of aborting with
// "undefined is not an object" on an unguarded .children.numItems read.
function __childCount(item) {
  if (!item) return 0;
  try {
    var children = item.children;
    if (!children) return 0;
    var count = children.numItems;
    return typeof count === "number" && count > 0 ? count : 0;
  } catch (e) {
    return 0;
  }
}

function __childAt(item, index) {
  try { return item.children[index] || null; } catch (e) { return null; }
}

function __nodeIdOf(item) {
  try {
    var id = item.nodeId;
    return id === undefined || id === null ? "" : String(id);
  } catch (e) {
    return "";
  }
}

function __findProjectItem(nodeIdOrName, rootItem) {
  if (!rootItem) rootItem = app.project.rootItem;
  var wantedId = String(nodeIdOrName);
  var count = __childCount(rootItem);
  for (var i = 0; i < count; i++) {
    var item = __childAt(rootItem, i);
    if (!item) continue;
    if (String(item.nodeId) === wantedId || item.name === nodeIdOrName) {
      return item;
    }
    if (__isBinItem(item)) { // Bin
      var found = __findProjectItem(nodeIdOrName, item);
      if (found) return found;
    }
  }
  return null;
}

// Exact node-ID lookup across every nested bin. Never matches by name, so a
// same-named item elsewhere in the project cannot shadow the requested ID.
function __findProjectItemByNodeId(nodeId, rootItem) {
  if (!rootItem) rootItem = app.project.rootItem;
  var wantedId = String(nodeId);
  if (!wantedId) return null;
  var count = __childCount(rootItem);
  for (var i = 0; i < count; i++) {
    var item = __childAt(rootItem, i);
    if (!item) continue;
    if (__nodeIdOf(item) === wantedId) return item;
    if (__isBinItem(item)) {
      var found = __findProjectItemByNodeId(wantedId, item);
      if (found) return found;
    }
  }
  return null;
}

// Resolve a bin by node ID, then slash-separated bin path from the root, then
// the first bin with that exact name. Returns null for non-bin matches.
function __findBin(idPathOrName) {
  var root = app.project.rootItem;
  var wanted = String(idPathOrName);
  var byId = __findProjectItemByNodeId(wanted, root);
  if (byId && __isBinItem(byId)) return byId;
  var parts = wanted.split("/");
  var current = root;
  for (var p = 0; p < parts.length && current; p++) {
    var next = null;
    var count = __childCount(current);
    for (var i = 0; i < count; i++) {
      var child = __childAt(current, i);
      if (child && child.name === parts[p] && __isBinItem(child)) { next = child; break; }
    }
    current = next;
  }
  if (current && current !== root) return current;
  return __findBinByName(wanted, root);
}

function __findBinByName(name, rootItem) {
  var count = __childCount(rootItem);
  for (var i = 0; i < count; i++) {
    var item = __childAt(rootItem, i);
    if (!item || !__isBinItem(item)) continue;
    if (item.name === name) return item;
    var found = __findBinByName(name, item);
    if (found) return found;
  }
  return null;
}

// Record every project item node ID (recursively) into map; used to diff the
// project before and after a host call that does not return the created item.
function __collectNodeIds(rootItem, map) {
  if (!rootItem) rootItem = app.project.rootItem;
  var count = __childCount(rootItem);
  for (var i = 0; i < count; i++) {
    var item = __childAt(rootItem, i);
    if (!item) continue;
    var id = __nodeIdOf(item);
    if (id) map[id] = true;
    if (__isBinItem(item)) __collectNodeIds(item, map);
  }
  return map;
}

// First non-bin project item absent from beforeMap, preferring an exact name.
function __findNewProjectItem(beforeMap, preferredName, rootItem) {
  var fallback = null;
  var pending = [rootItem || app.project.rootItem];
  while (pending.length > 0) {
    var bin = pending.shift();
    var count = __childCount(bin);
    for (var i = 0; i < count; i++) {
      var item = __childAt(bin, i);
      if (!item) continue;
      if (__isBinItem(item)) { pending.push(item); continue; }
      var id = __nodeIdOf(item);
      if (!id || beforeMap[id]) continue;
      var name = null;
      try { name = item.name; } catch (e) {}
      if (name === preferredName) return item;
      if (!fallback) fallback = item;
    }
  }
  return fallback;
}

function __isDirectChild(parent, item) {
  var wantedId = __nodeIdOf(item);
  if (!wantedId) return false;
  var count = __childCount(parent);
  for (var i = 0; i < count; i++) {
    var child = __childAt(parent, i);
    if (child && __nodeIdOf(child) === wantedId) return true;
  }
  return false;
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
// QE catalogs come in two shapes: legacy collections ({ numItems, [i]: { name } })
// and, on Premiere 25.2, plain arrays of name strings. Normalize both to the
// legacy shape; string entries become { name, __qeStub: true } and must be
// resolved with __qeEffectObject / __qeTransitionObject before use.
function __qeCatalogFrom(list) {
  var out = { numItems: 0 };
  if (!list) return out;
  var count = NaN;
  try { if (typeof list.numItems !== "undefined") count = Number(list.numItems); } catch (eCount) {}
  if (isNaN(count)) { try { count = Number(list.length); } catch (eLength) {} }
  if (isNaN(count) || count < 0) return out;
  for (var i = 0; i < count; i++) {
    var entry = null;
    try { entry = list[i]; } catch (eEntry) {}
    if (entry === null || entry === undefined) continue;
    if (typeof entry === "string") entry = { name: entry, __qeStub: true };
    out[out.numItems] = entry;
    out.numItems++;
  }
  return out;
}

function __qeEffectObject(kind, entry) {
  if (!entry) return null;
  if (!entry.__qeStub) return entry;
  try {
    return kind === "audio" ? qe.project.getAudioEffectByName(entry.name) : qe.project.getVideoEffectByName(entry.name);
  } catch (eByName) {
    return null;
  }
}

function __qeTransitionObject(kind, entry) {
  if (!entry) return null;
  if (!entry.__qeStub) return entry;
  try {
    return kind === "audio" ? qe.project.getAudioTransitionByName(entry.name) : qe.project.getVideoTransitionByName(entry.name);
  } catch (eByName) {
    return null;
  }
}

// Components every clip carries (and a graphic's own layers). They are not
// effects and are never removed. English names plus es-ES names measured live
// on Premiere 26.5.2 (#674): video Opacidad / Movimiento / Movimiento del
// vector / Texto, audio Volumen / Volumen del canal, and Balance / Equilibrio —
// the touched-Balance built-in appears on a clip once Balance was applied (QE
// or UI) with matchName "Internal Audio Balance" (seen on en-US macOS 25.2.3
// and es-ES Windows 26.5.2); its localized display name must be classified or
// it alone trips the localized-host refusal. The remaining es-ES entries are
// the Spanish UI vocabulary for families not yet seen live on a component
// (Time Remapping, Panner, Shape); adding a name to this table only ever
// prevents a removal, so vocabulary entries are fail-safe.
var __BUILT_IN_COMPONENTS = { "Opacity": true, "Motion": true, "Time Remapping": true, "Volume": true, "Channel Volume": true, "Panner": true, "Vector Motion": true, "Text": true, "Shape": true, "Opacidad": true, "Movimiento": true, "Movimiento del vector": true, "Volumen": true, "Volumen del canal": true, "Balance": true, "Equilibrio": true, "Tiempo de reconfiguración": true, "Paneo de balance": true, "Texto": true, "Forma": true };
// Match names do not change with the host language. Seen live on Premiere
// 25.2.3 (#674): video "AE.ADBE Opacity", "AE.ADBE Motion"; graphics
// "AE.ADBE Graphic Group" (Vector Motion), "AE.ADBE Text"; audio "Internal
// Volume Mono|Stereo|5.1" and "Internal Channel Volume Stereo|5.1" (a mono clip
// has no Channel Volume), and shape layers "AE.ADBE Shape" (a stock lower
// third). 25.2.3 lists no clip-level Panner, even for a mono clip on a stereo
// track (panning is per track there). Time Remapping was not listed and cannot
// be enabled by script; its likely name is included because treating a
// component as built-in only ever prevents a removal.
var __BUILT_IN_MATCH_NAMES = { "AE.ADBE Motion": true, "AE.ADBE Opacity": true, "AE.ADBE Graphic Group": true, "AE.ADBE Text": true, "AE.ADBE Shape": true, "AE.ADBE Time Remapping": true };

function __componentMatchName(component) {
  try { return String(component.matchName || ""); } catch (eMatch) { return ""; }
}

// Built-in by match name (any host language), by Premiere's "Internal ..."
// audio intrinsics, by graphic/shape layer match names, or by English name.
function __isBuiltInComponent(component) {
  var match = __componentMatchName(component);
  if (__BUILT_IN_MATCH_NAMES[match] || /^Internal /.test(match) || /^AE\\.ADBE (Vector|Shape|Graphic)/.test(match)) return true;
  return !!__BUILT_IN_COMPONENTS[String(component.displayName)];
}

// Match names confirmed live (#674). Unlike the guessed entries above, these
// prove the host language: one of them showing a non-English display name
// means the built-ins are localized.
function __isConfirmedBuiltInMatchName(match) {
  return match === "AE.ADBE Motion" || match === "AE.ADBE Opacity" || match === "AE.ADBE Graphic Group" ||
    match === "AE.ADBE Text" || match === "AE.ADBE Shape" || /^Internal /.test(match);
}

// A component can only be classified when it reports a match name or carries a
// built-in's English name. On a localized host, the match names of Time
// Remapping, Panner and shape layers are not confirmed, so an unknown match
// name could be one of them: refuse rather than risk removing it (#674).
function __componentClassificationProblem(clip) {
  var localized = null;
  for (var i = 0; i < clip.components.numItems; i++) {
    var component = clip.components[i];
    var match = __componentMatchName(component);
    var name = String(component.displayName);
    if (!match && !__BUILT_IN_COMPONENTS[name]) {
      return "Premiere reports no match name for the component " + name + ", so it cannot be told apart from a built-in component reliably.";
    }
    if (__isConfirmedBuiltInMatchName(match) && !__BUILT_IN_COMPONENTS[name]) localized = name;
  }
  if (localized !== null) {
    return "This Premiere host shows built-in components under localized names (" + localized + "). The match names of Time Remapping and Panner are not confirmed yet, so an effect cannot be told apart from them reliably (#674).";
  }
  return null;
}

// Remove the clip components selected by wanted(displayName, index), highest
// index first. DOM Component.remove() is used when present. EXPERIMENTAL:
// Premiere 25.2 has no DOM remove, so the undocumented QE DOM's targeted
// qeClip.getComponentAt(i).remove() is used instead; its component order
// matched the DOM in live testing. Every target's removal path is resolved
// before anything is removed, so a component neither path can remove refuses
// the whole call with nothing changed.
// Returns { removed, failures, before, remaining, verified, nothingRemoved,
// unsupported } where unsupported explains a refusal made before any removal.
function __removeClipComponents(result, wanted) {
  var clip = result.clip;
  var out = { removed: [], failures: [], before: [], remaining: [], verified: false, nothingRemoved: true, unsupported: null };
  var targets = [];
  out.unsupported = __componentClassificationProblem(clip);
  if (out.unsupported) {
    for (var u = 0; u < clip.components.numItems; u++) out.remaining.push(String(clip.components[u].displayName));
    out.before = out.remaining.slice();
    return out;
  }
  for (var b = 0; b < clip.components.numItems; b++) out.before.push(String(clip.components[b].displayName));
  for (var i = clip.components.numItems - 1; i >= 0; i--) {
    var name = String(clip.components[i].displayName);
    if (__isBuiltInComponent(clip.components[i])) continue;
    if (wanted(name, i)) targets.push({ index: i, name: name, component: clip.components[i] });
  }
  var qeClip = null;
  if (targets.length) {
    try {
      app.enableQE();
      var qeSeq = qe.project.getActiveSequence();
      var qeTrack = result.trackType === "video" ? qeSeq.getVideoTrackAt(result.trackIndex) : qeSeq.getAudioTrackAt(result.trackIndex);
      qeClip = __findQeClipByDomClip(qeTrack, clip);
    } catch (eQe) {}
  }
  // Preflight: pick a removal path for every target before changing anything.
  for (var p = 0; p < targets.length; p++) {
    var candidate = targets[p];
    candidate.path = null;
    try { if (typeof candidate.component.remove === "function") candidate.path = "dom"; } catch (eDomCheck) {}
    if (!candidate.path && qeClip && typeof qeClip.getComponentAt === "function") {
      try {
        var qeCandidate = qeClip.getComponentAt(candidate.index);
        if (qeCandidate && String(qeCandidate.name) === candidate.name && typeof qeCandidate.remove === "function") candidate.path = "qe";
      } catch (eQeCheck) {}
    }
    if (!candidate.path) out.failures.push(candidate.name);
  }
  if (out.failures.length) {
    out.remaining = out.before.slice();
    return out;
  }
  var expected = out.before.slice();
  for (var t = 0; t < targets.length; t++) {
    var target = targets[t];
    var done = false;
    try {
      if (target.path === "dom") { target.component.remove(); done = true; }
      else {
        var qeComponent = qeClip.getComponentAt(target.index);
        if (qeComponent && String(qeComponent.name) === target.name) { qeComponent.remove(); done = true; }
      }
    } catch (eRemove) {}
    if (done) { out.removed.push(target.name); out.nothingRemoved = false; expected.splice(target.index, 1); }
    else out.failures.push(target.name);
  }
  var again = __findClip(String(clip.nodeId));
  if (again) for (var r = 0; r < again.clip.components.numItems; r++) out.remaining.push(String(again.clip.components[r].displayName));
  out.verified = !!again && out.remaining.join("|") === expected.join("|");
  return out;
}

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

  effects = __qeCatalogFrom(effects);
  var count = effects.numItems;
  if (count < 1) {
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

  // Prefer AME's H.264 exporter folder ("..._48323634", hex "H264"), which writes
  // MP4. Presets named "H264 ..." also live in the QuickTime folder
  // ("..._4D6F6F56", "MooV") and write MOV (live 25.2).
  var ranked = [];
  for (var k = 0; k < candidates.length; k++) {
    var mp4 = /_48323634$/i.test(candidates[k].format);
    var high = candidates[k].name.toLowerCase().indexOf("match source - high") !== -1;
    ranked.push({ path: candidates[k].path, score: (mp4 ? 2 : 0) + (high ? 1 : 0) });
  }
  var best = ranked[0];
  for (var j = 1; j < ranked.length; j++) if (ranked[j].score > best.score) best = ranked[j];
  return best.path;
}

// Candidate presets for manage_proxies auto-discovery, in preference order:
// Premiere's IngestPresets/Proxy files first, then AME's H.264 system presets.
// Adobe ships the Proxy folder presets with a "Same as Project" destination, so
// the TypeScript handler must content-scan every candidate (gzip-aware) before
// using one. ExtendScript cannot inflate gzipped .epr files, so no filtering here.
function __listProxyPresetCandidates() {
  var out = [];
  var ppro = __adobeAppFolders("Adobe Premiere Pro");
  for (var i = 0; i < ppro.length; i++) {
    var proxyDir = __adobeApplicationResourceFolder(ppro[i], "Settings/IngestPresets/Proxy");
    var eprs = __collectEprFiles(proxyDir, []);
    eprs.sort(function(a, b) { return a.displayName < b.displayName ? -1 : 1; });
    for (var e = 0; e < eprs.length; e++) out.push(eprs[e].fsName);
  }
  var presets = __collectAllPresets();
  for (var p = 0; p < presets.length; p++) {
    var haystack = (presets[p].name + " " + presets[p].format).toLowerCase();
    if (presets[p].path.indexOf("IngestPresets") !== -1) continue;
    if (haystack.indexOf("h264") !== -1 || haystack.indexOf("h.264") !== -1 || haystack.indexOf("48323634") !== -1) {
      out.push(presets[p].path);
    }
  }
  return out;
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
  // QE cuts its output name at the first dot ("shot-12.5s" became "shot-12.png"),
  // so hand it a dot-free temporary name in the same folder and rename after.
  var qeBase = outputPath.substring(0, slash + 1) + "mcp-frame-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
  var qePath = qeBase + (wantJpeg ? ".jpg" : ".png");

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
          notes.push("QE " + qeSeq.name + " @ " + at.timecode + " (frame " + at.frame + ") returned " + fn.call(qeSeq, at.timecode, qeBase));
        }
      }
    } catch (eQE) {
      notes.push("QE: " + eQE.toString());
    }
  }

  // Give the caller the name they asked for, and never leave the temporary file behind.
  var produced = new File(qePath);
  if (produced.exists && produced.length > 0) {
    try { produced.rename(decodeURI(new File(outputPath).name)); } catch (e) { notes.push("QE: could not rename " + qePath + ": " + e.toString()); }
  }
  var leftover = new File(qePath);
  if (leftover.exists) { try { leftover.remove(); } catch (e) {} }

  var exactFile = new File(outputPath);
  var written = exactFile.exists && exactFile.length > 0 ? exactFile.fsName : "";
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
        var ameMutatedMarks = false;
        try {
          seq.setInPoint(__ticksToSeconds(startTicks));
          ameMutatedMarks = true;
          seq.setOutPoint(__ticksToSeconds(startTicks + frameTicks));
          seq.exportAsMediaDirect(outputPath, preset, app.encoder.ENCODE_IN_TO_OUT);
          notes.push("AME preset: " + preset);
        } finally {
          try { seq.setInPoint(__ticksToSeconds(savedIn)); } catch (eIn) {}
          try { seq.setOutPoint(__ticksToSeconds(savedOut)); } catch (eOut) {}
        }
        // Premiere 26.x setters can throw or silently no-op. A still file is
        // not success if the sequence is still pinned to the one-frame range.
        if (ameMutatedMarks) {
          var restoredIn = null, restoredOut = null;
          try { restoredIn = seq.getInPointAsTime().ticks; } catch (eRi) {}
          try { restoredOut = seq.getOutPointAsTime().ticks; } catch (eRo) {}
          var restoreTol = (frameTicks && !isNaN(frameTicks)) ? frameTicks : (TICKS_PER_SECOND / 24);
          var inRestored = restoredIn != null && !isNaN(parseFloat(restoredIn))
            && Math.abs(parseFloat(restoredIn) - parseFloat(savedIn)) <= restoreTol;
          var outRestored = restoredOut != null && !isNaN(parseFloat(restoredOut))
            && Math.abs(parseFloat(restoredOut) - parseFloat(savedOut)) <= restoreTol;
          if (!inRestored || !outRestored) {
            notes.push("AME: sequence in/out could not be restored after the one-frame export");
            return {
              ok: false,
              error: "Media Encoder still export left the sequence in/out points unrestored. The sequence may still be pinned to a one-frame range; restore the marks in Premiere or Undo before exporting again.",
              notes: notes
            };
          }
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
// QE razor() splits each track independently, and on Premiere 25.2 the new
// right-hand pieces of linked video/audio come out unlinked (the left pieces
// keep the link). Unlinked pieces then drift out of sync on later edits.
// Capture link groups that span the cut before razoring, then relink the
// matching right-hand pieces and restore the user's selection.
// Result helpers for per-clip edit functions that run once for a clip and once
// for each of its linked partners.
function __editOk(data) { return { ok: true, data: data }; }
function __editFail(message, data) { var failure = { ok: false, error: String(message) }; if (data) failure.data = data; return failure; }

// Effect-parameter key times are media time: the clip's in-point plus the
// offset into the clip. On live 25.2.3 a clip starting at 25s with its
// in-point at 30s rendered keys stored at 32s and 34s at timeline 27s and
// 29s. Tools take seconds from the clip's start, so convert through the
// in-point. A speed change or reverse remaps media time, so refuse those.
function __clipKeyframeBase(clip) {
  var speed = 1;
  var reversed = false;
  try {
    speed = clip.getSpeed();
    if (typeof speed !== "number" || !isFinite(speed)) throw new Error("Invalid speed state");
    var reverseState = clip.isSpeedReversed();
    if (reverseState !== true && reverseState !== false && reverseState !== 0 && reverseState !== 1) throw new Error("Invalid reverse state");
    reversed = reverseState === true || reverseState === 1;
  } catch (eSpeed) {
    return { ok: false, error: "Premiere did not report the clip's speed or reverse state. Nothing was changed." };
  }
  // Older hosts report normal speed as 100 percent rather than a ratio of 1.
  if (reversed || !(Math.abs(speed - 1) < 0.0001 || Math.abs(speed - 100) < 0.0001)) {
    return { ok: false, error: "This clip has a speed change or is reversed, and keyframe times on such clips are not supported yet. Nothing was changed." };
  }
  var inTicks = parseFloat(clip.inPoint.ticks);
  var durationSeconds = __ticksToSeconds(parseFloat(clip.end.ticks) - parseFloat(clip.start.ticks));
  if (!isFinite(inTicks) || !isFinite(durationSeconds)) {
    return { ok: false, error: "Premiere did not report the clip's in-point and duration. Nothing was changed." };
  }
  return { ok: true, inTicks: inTicks, durationSeconds: durationSeconds };
}

function __clipKeyTime(base, clipSeconds) {
  var time = new Time();
  time.ticks = String(base.inTicks + __secondsToTicks(clipSeconds));
  return time;
}

function __clipSecondsFromKey(base, time) {
  return Math.round(__ticksToSeconds(parseFloat(time.ticks) - base.inTicks) * 1000000) / 1000000;
}

// A property with no keyframes reports getKeys() as 0 on some hosts and as
// undefined on Premiere 25.2.3 (with isTimeVarying() false). Treat those as an
// empty list only when the property readably is not time-varying; null and
// other shapes stay unreadable.
function __isEmptyKeyList(prop, keys) {
  if (keys === 0) return true;
  if (keys !== undefined) return false;
  var timeVarying = null;
  try { timeVarying = prop.isTimeVarying(); } catch (eTimeVarying) { return false; }
  return timeVarying === false;
}

// The stored key within 0.01s of a time, or null.
function __findKeyNear(prop, time, strict) {
  var keys = null;
  try { keys = prop.getKeys(); } catch (eKeys) { if (strict) throw eKeys; }
  if (strict && !__isEmptyKeyList(prop, keys) && (!keys || typeof keys.length !== "number" || !isFinite(keys.length) || keys.length < 0 || Math.floor(keys.length) !== keys.length)) throw new Error("Invalid key-list readback");
  if (!keys) return null;
  var closest = null, closestDelta = TICKS_PER_SECOND * 0.01;
  for (var k = 0; k < keys.length; k++) {
    if (strict && (!keys[k] || !isFinite(parseFloat(keys[k].ticks)))) throw new Error("Invalid key-time readback");
    var delta = Math.abs(parseFloat(keys[k].ticks) - parseFloat(time.ticks));
    if (delta <= closestDelta && (closest === null || delta < closestDelta)) { closest = keys[k]; closestDelta = delta; }
  }
  return closest;
}

function __findKeyExact(prop, time) {
  var keys = prop.getKeys();
  if (__isEmptyKeyList(prop, keys)) return null;
  if (!keys || typeof keys.length !== "number" || !isFinite(keys.length) || keys.length < 0 || Math.floor(keys.length) !== keys.length) throw new Error("Invalid key-list readback");
  for (var k = 0; k < keys.length; k++) {
    if (!keys[k] || !isFinite(parseFloat(keys[k].ticks))) throw new Error("Invalid key-time readback");
    if (String(keys[k].ticks) === String(time.ticks)) return keys[k];
  }
  return null;
}

// Clip-relative seconds of every stored key.
function __clipKeySeconds(base, prop, strict) {
  var keys = null;
  try { keys = prop.getKeys(); } catch (eKeys) { if (strict) throw eKeys; }
  if (strict && !__isEmptyKeyList(prop, keys) && (!keys || typeof keys.length !== "number" || !isFinite(keys.length) || keys.length < 0 || Math.floor(keys.length) !== keys.length)) throw new Error("Invalid key-list readback");
  var list = [];
  if (!keys) return list;
  for (var k = 0; k < keys.length; k++) {
    if (strict && (!keys[k] || !isFinite(parseFloat(keys[k].ticks)))) throw new Error("Invalid key-time readback");
    list.push(__clipSecondsFromKey(base, keys[k]));
  }
  return list;
}

// Colour parameters report getValue() as a packed 64-bit integer (live 25.2:
// 0xff0014002800a0c8 for ARGB 255,20,40,160), which a JS double cannot hold
// exactly. Read them with getColorValue() instead, as [alpha, red, green, blue].
// getColorValue() has no time argument, so an animated colour is flagged.
function __readableParamValue(prop, value) {
  if (typeof value !== "number" || value < 4294967296) return { value: value };
  var color = null;
  try { if (typeof prop.getColorValue === "function") color = prop.getColorValue(); } catch (eColor) {}
  if (!color || color.length !== 4) return { value: value };
  var animated = false;
  try { animated = !!prop.isTimeVarying(); } catch (eVarying) {}
  var out = { value: [Number(color[0]), Number(color[1]), Number(color[2]), Number(color[3])], valueType: "color_argb" };
  if (animated) out.note = "Animated colour: getColorValue() reports the current value, not the value at the requested time.";
  return out;
}

// new Folder(path).exists is also true when path is a FILE (live 25.2); calling
// Folder(path) without new returns a File object for a file, so test the type.
function __isDirectory(path) {
  var entry = Folder(path);
  return entry instanceof Folder && entry.exists;
}

// Open projects (Premiere keeps several open; app.project is the active one).
// Paths compare case-insensitively with forward slashes.
function __normProjectPath(path) {
  return String(path || "").split(String.fromCharCode(92)).join("/").toLowerCase();
}
function __openProjects() {
  var list = [];
  try {
    for (var i = 0; i < app.projects.numProjects; i++) list.push(app.projects[i]);
  } catch (eProjects) {
    if (app.project) list.push(app.project);
  }
  return list;
}
function __openProjectPaths() {
  var paths = [];
  var list = __openProjects();
  for (var i = 0; i < list.length; i++) paths.push(String(list[i].path));
  return paths;
}
function __findOpenProject(path) {
  var list = __openProjects();
  for (var i = 0; i < list.length; i++) if (__normProjectPath(list[i].path) === __normProjectPath(path)) return list[i];
  return null;
}

// Remove a timeline clip (a __findClip result) without rippling, plus its
// linked audio/video partners when includeLinked is true (Premiere's Clear on
// a linked clip), then verify every removed clip is gone. Every clip's track
// lock and remove() are checked before anything is removed, so a partner on a
// locked track refuses the whole removal instead of leaving its audio behind.
function __removalIdentity(sequence) {
  try {
    var documentId = app.project.documentID, sequenceId = sequence && sequence.sequenceID;
    var values = [documentId, sequenceId];
    for (var vi = 0; vi < values.length; vi++) if ((typeof values[vi] !== "string" && typeof values[vi] !== "number") || (typeof values[vi] === "number" && !isFinite(values[vi])) || !/\\S/.test(String(values[vi]))) return null;
    return { projectDocumentId:String(documentId), sequenceId:String(sequenceId) };
  } catch (identityError) { return null; }
}

function __removalThrowReceipt(ids, identity) {
  var gone = [], remaining = [], readable = true;
  try {
    var sequence = app.project.activeSequence;
    var currentIdentity = __removalIdentity(sequence);
    if (!identity || !currentIdentity || currentIdentity.projectDocumentId !== identity.projectDocumentId || currentIdentity.sequenceId !== identity.sequenceId) throw new Error("Removal project or sequence identity is unavailable or changed");
    var families = [sequence.videoTracks, sequence.audioTracks], present = {};
    for (var ft = 0; ft < families.length; ft++) {
      var trackCount = families[ft] && families[ft].numTracks;
      if (typeof trackCount !== "number" || !isFinite(trackCount) || trackCount < 0 || Math.floor(trackCount) !== trackCount) throw new Error("Track collection is unreadable");
      for (var ti = 0; ti < trackCount; ti++) {
        var track = families[ft][ti];
        var clips = track && track.clips, clipCount = clips && clips.numItems;
        if (typeof clipCount !== "number" || !isFinite(clipCount) || clipCount < 0 || Math.floor(clipCount) !== clipCount) throw new Error("Clip collection is unreadable");
        for (var ci = 0; ci < clipCount; ci++) {
          var clipId = clips[ci] && clips[ci].nodeId;
          if ((typeof clipId !== "string" && typeof clipId !== "number") || (typeof clipId === "number" && !isFinite(clipId)) || !/\\S/.test(String(clipId))) throw new Error("Clip identity is unreadable");
          present["$" + String(clipId)] = true;
        }
      }
    }
    for (var ri = 0; ri < ids.length; ri++) {
      if (present["$" + ids[ri]]) remaining.push(ids[ri]); else gone.push(ids[ri]);
    }
  } catch (readError) { readable = false; }
  return { mutationAttempted:true, timelineChanged:gone.length > 0 ? true : (readable ? false : null), mutationOutcome:gone.length > 0 ? "changed" : (readable ? "unchanged" : "unknown"), verified:false, readbackComplete:readable, removedClipIds:gone, remainingClipIds:remaining };
}

function __removeClipAndPartners(result, includeLinked, validatedPartners) {
  var targets = [result];
  if (includeLinked) {
    var partners = validatedPartners !== undefined ? validatedPartners : __linkedPartnerClips(result);
    for (var p = 0; p < partners.length; p++) targets.push(partners[p]);
  }
  var seq = app.project.activeSequence;
  var ids = [];
  var names = [];
  for (var t = 0; t < targets.length; t++) {
    var located = targets[t];
    ids.push(String(located.clip.nodeId));
    names.push(located.clip.name);
    var label = located.trackType + " track " + (located.trackIndex + 1);
    var track = seq ? (located.trackType === "video" ? seq.videoTracks : seq.audioTracks)[located.trackIndex] : null;
    var locked = null;
    try { if (track && typeof track.isLocked === "function") locked = !!track.isLocked(); } catch (eLocked) {}
    if (locked === null) return __editFail("Could not read whether " + label + " is locked, so " + names[t] + " was not removed. Nothing was changed.");
    if (locked) return __editFail(names[t] + " is on locked " + label + ". Nothing was changed; unlock the track or pass include_linked false (this leaves its linked partner in place).");
    if (typeof located.clip.remove !== "function") return __editFail("Premiere does not expose remove() for " + names[t] + " on " + label + ". Nothing was changed.");
  }
  var removed = [];
  var removalIdentity = __removalIdentity(seq);
  for (var r = 0; r < targets.length; r++) {
    try {
      targets[r].clip.remove(false, false);
      removed.push(names[r]);
    } catch (eRemove) {
      var receipt = __removalThrowReceipt(ids.slice(0, r + 1), removalIdentity);
      var evidence = receipt.timelineChanged === true ? " The timeline changed; inspect the linked clips." : (receipt.timelineChanged === null ? " Removal may have changed the timeline; readback is unavailable. Inspect the timeline." : " The attempted removal targets remain on the timeline.");
      return __editFail("Premiere threw while removing " + names[r] + ": " + eRemove.toString() + evidence, receipt);
    }
  }
  var left = [];
  for (var v = 0; v < ids.length; v++) if (__findClip(ids[v])) left.push(names[v]);
  if (left.length) {
    var gone = ids.length - left.length;
    return __editFail((gone ? "The timeline changed: " + gone + " clip(s) were removed, but " : "") + "Premiere did not remove: " + left.join(", ") + (gone ? ". Inspect the timeline; linked clips may be out of sync." : ". Nothing was changed."));
  }
  return __editOk({ removed: true, clipName: names[0], removedClipIds: ids, linkedPartnersRemoved: ids.length - 1 });
}

// Marker writes may use a different undo surface than QE. Keep a conservative
// barrier in the persistent CEP engine, scoped by documented project.documentID.
function __markerUndoState(create) {
  try {
    if (typeof $ === "undefined" || !$.global) return null;
    var state = $.global.__premiereMcpMarkerUndoBarrierV1;
    if (!state && create) {
      state = { unknownProject: false, entries: [] };
      $.global.__premiereMcpMarkerUndoBarrierV1 = state;
      if ($.global.__premiereMcpMarkerUndoBarrierV1 !== state) return null;
    }
    if (state && (!(state.entries instanceof Array) || typeof state.unknownProject !== "boolean")) return null;
    if (state) for (var si = 0; si < state.entries.length; si++) {
      var saved = state.entries[si];
      if (!saved || typeof saved.projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.projectId) ||
        (saved.index !== null && (typeof saved.index !== "number" || !isFinite(saved.index) || saved.index < 0 || Math.floor(saved.index) !== saved.index))) return null;
    }
    return state || { unknownProject: false, entries: [] };
  } catch (barrierReadError) { return null; }
}
function __markerUndoProjectId() {
  try {
    var id = String(app.project.documentID || "");
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
  } catch (identityError) { return null; }
}
function __rememberMarkerUndoBarrier(index) {
  var state = __markerUndoState(true);
  if (!state) return { ok: false, error: "The CEP engine cannot persist a marker undo barrier; no marker write was attempted." };
  __markerWriteAttempted = true;
  var projectId = __markerUndoProjectId();
  if (!projectId) { state.unknownProject = true; return { ok: true }; }
  var safeIndex = typeof index === "number" && isFinite(index) && index >= 0 && Math.floor(index) === index ? index : null;
  for (var i = 0; i < state.entries.length; i++) {
    var entry = state.entries[i];
    if (entry.projectId === projectId) {
      entry.index = entry.index === null || safeIndex === null ? null : Math.max(entry.index, safeIndex);
      return { ok: true };
    }
  }
  if (state.entries.length >= 128) { state.unknownProject = true; return { ok: true }; }
  state.entries.push({ projectId: projectId, index: safeIndex });
  return { ok: true };
}
function __markerUndoBarrier(direction, count, index, acknowledged) {
  var state = __markerUndoState(false);
  if (!state) return { ok: false, error: "The CEP marker undo barrier could not be read; no " + direction + " was attempted." };
  var projectId = __markerUndoProjectId(), blocked = state.unknownProject;
  for (var i = 0; i < state.entries.length; i++) {
    var entry = state.entries[i];
    if (entry.projectId !== projectId && projectId !== null) continue;
    if (entry.index === null || projectId === null ||
      (direction === "undo" && index - count < entry.index) ||
      (direction === "redo" && index < entry.index && index + count >= entry.index)) blocked = true;
  }
  if (!blocked) return { ok: true };
  if (acknowledged) return { ok: true, warning: "Marker reversal through QE is not verified. You acknowledged reversing or restoring prior non-marker QE actions; inspect markers separately." };
  return { ok: false, error: "A marker write occurred at this undo boundary, but QE cannot verify that its steps reverse the marker. No " + direction + " was attempted. Inspect markers separately; pass acknowledge_untracked_markers:true only to deliberately reverse or restore prior non-marker QE actions." };
}

// EXPERIMENTAL (undocumented QE DOM). Step Premiere's project undo stack with
// QE and check every step against qe.project.undoStackIndex(), which moved by
// exactly one per undone or redone action in live 25.2 testing. The check is
// about the stack position only; nothing reads the timeline back.
// status: "stack_verified" (every step moved the index by one), "did_not_move"
// (nothing left to undo/redo), "moved_unexpectedly" (the index moved by a
// different amount or the wrong way), "index_unreadable" (a step ran but the
// index could not be read), or "rejected" (Premiere threw). The last three may
// have changed the project and must not be treated as "nothing happened".
function __qeUndoSteps(direction, count, acknowledgeMarkers) {
  app.enableQE();
  var stack = null;
  try { stack = qe.project; } catch (eQe) {}
  if (!stack) return { ok: false, status: "unavailable", error: "QE project is unavailable, so the undo stack cannot be reached. No " + direction + " was attempted.", done: 0 };
  var readIndex = function () {
    try { var v = Number(stack.undoStackIndex()); return isFinite(v) ? v : null; } catch (eIdx) { return null; }
  };
  var start = readIndex();
  if (start === null) return { ok: false, status: "unavailable", error: "This Premiere host does not expose qe.project.undoStackIndex(), so " + direction + " cannot be checked. No " + direction + " was attempted.", done: 0 };
  var markerBarrier = __markerUndoBarrier(direction, count, start, acknowledgeMarkers === true);
  if (!markerBarrier.ok) return { ok: false, status: "marker_boundary", error: markerBarrier.error, done: 0, startIndex: start, index: start };
  var step = direction === "undo" ? -1 : 1;
  var done = 0;
  var index = start;
  for (var i = 0; i < count; i++) {
    try {
      if (direction === "undo") stack.undo(); else stack.redo();
    } catch (eStep) {
      // The step may have moved the stack before throwing; check before
      // reporting it as rejected.
      var afterThrow = readIndex();
      if (afterThrow === null) {
        return { ok: false, status: "index_unreadable", done: done, startIndex: start, index: index,
          error: direction + " step " + (i + 1) + " threw (" + eStep.toString() + ") and Premiere's undo-stack index could not be read afterwards, so it is not known what changed. Do not retry; inspect the project." };
      }
      if (afterThrow !== index) {
        return { ok: false, status: "moved_unexpectedly", done: done, startIndex: start, index: afterThrow,
          error: direction + " step " + (i + 1) + " threw (" + eStep.toString() + ") but Premiere's undo stack moved from " + index + " to " + afterThrow + ", so more actions than reported may have been " + direction + "ne. Do not retry; inspect the project." };
      }
      return { ok: false, status: "rejected", done: done, startIndex: start, index: index,
        error: "Premiere rejected " + direction + " step " + (i + 1) + ": " + eStep.toString() + (done ? " (" + done + " step(s) before it were " + direction + "ne)." : ".") };
    }
    var next = readIndex();
    if (next === null) {
      return { ok: false, status: "index_unreadable", done: done, startIndex: start, index: index,
        error: direction + " step " + (i + 1) + " ran, but Premiere's undo-stack index could not be read afterwards, so it is not known what changed. Do not retry; inspect the project." };
    }
    if (next === index) break;
    if (next !== index + step) {
      return { ok: false, status: "moved_unexpectedly", done: done, startIndex: start, index: next,
        error: direction + " step " + (i + 1) + " moved Premiere's undo stack from " + index + " to " + next + " instead of " + (index + step) + ", so more or other actions than requested may have been " + direction + "ne. Do not retry; inspect the project." };
    }
    index = next;
    done++;
  }
  if (done < count) {
    return {
      ok: false,
      status: "did_not_move",
      error: done === 0
        ? "Nothing to " + direction + ": Premiere's undo stack did not move."
        : "Only " + done + " of " + count + " " + direction + " steps were available; the undo stack stopped moving.",
      done: done, startIndex: start, index: index
    };
  }
  return { ok: true, status: "stack_verified", markerWarning: markerBarrier.warning || null, done: done, startIndex: start, index: index };
}

// Result of an undo/redo tool from a __qeUndoSteps outcome. An unexpected or
// unreadable stack move is reported as committed_unverified (success, not
// verified), never as "nothing happened", so an agent does not retry.
function __undoStepsResult(outcome, doneKey) {
  var summary = { undoStackIndexBefore: outcome.startIndex, undoStackIndexAfter: outcome.index, stackStatus: outcome.status,
    scope: "Premiere's undo history is project-wide: this steps the most recent project actions, whichever sequence they touched." };
  summary[doneKey] = outcome.done;
  if (outcome.markerWarning) { summary.markerUndoWarning = outcome.markerWarning; summary.untrackedMarkersAcknowledged = true; }
  // Anything that may have moved the stack, including a run that stopped part
  // way after undoing some steps, is committed_unverified with a do-not-retry
  // warning, so an agent does not undo more of the user's work.
  if (outcome.status === "moved_unexpectedly" || outcome.status === "index_unreadable" || (!outcome.ok && outcome.done > 0)) {
    summary.outcome = "committed_unverified";
    summary.stackVerified = false;
    summary.warning = outcome.error + (/Do not retry/.test(outcome.error) ? "" : " " + outcome.done + " step(s) were " + (doneKey === "redone" ? "redone" : "undone") + ". Do not retry the whole count; inspect the project first.");
    return __result(summary);
  }
  if (!outcome.ok) return __jsonStringify({ success: false, error: outcome.error, data: summary });
  summary.stackVerified = true;
  summary.verification = "undo-stack position only: each step moved qe.project.undoStackIndex() by one; the timeline is not read back";
  return __result(summary);
}

// Linked partners of a clip on other tracks (its synced audio for a video
// clip, and vice versa). getLinkedItems() returns null for unlinked clips.
function __linkedPartnerClips(result) {
  var partners = [];
  var linked = null;
  try { linked = result.clip.getLinkedItems(); } catch (eLinked) {}
  for (var i = 0; linked && i < linked.numItems; i++) {
    var id = String(linked[i].nodeId);
    if (id === String(result.clip.nodeId)) continue;
    var located = __findClip(id);
    if (!located) continue;
    if (located.trackType === result.trackType && located.trackIndex === result.trackIndex) continue;
    partners.push(located);
  }
  return partners;
}

// Apply a per-clip edit to a clip and, when includeLinked is true, to its
// linked audio/video partners. edit(result, nodeId, checkOnly) returns
// __editOk/__editFail and must change nothing when checkOnly is true. Every
// clip is checked before any is changed, so a partner that cannot follow
// refuses the whole edit instead of leaving picture and sound out of sync
// (most DOM writes add no undo entry, so Undo cannot be relied on). The
// result is verified only when every clip's edit was verified.
// Timeline and source position of a clip, read fresh, to tell whether it moved.
function __clipPositionKey(nodeId) {
  var found = __findClip(nodeId);
  if (!found) return null;
  var parts = [];
  var fields = ["start", "end", "inPoint", "outPoint"];
  for (var f = 0; f < fields.length; f++) {
    try { parts.push(String(found.clip[fields[f]].ticks)); } catch (eField) { parts.push("?"); }
  }
  return parts.join("|");
}

function __runLinkedEdit(target, nodeId, includeLinked, edit, label, validatedPartners) {
  var partners = [];
  if (includeLinked) {
    if (validatedPartners !== undefined) partners = validatedPartners;
    else {
      try {
        var linked = target.clip.getLinkedItems();
        // A clip with no linked partner returns null without throwing (measured
        // on 25.2.3); that is a readable "no partners", not an unreadable one.
        if (linked === null) linked = { numItems: 0 };
        if (!linked || typeof linked.numItems !== "number" || !isFinite(linked.numItems) || linked.numItems < 0 || Math.floor(linked.numItems) !== linked.numItems || linked.numItems > 256) throw new Error("Linked collection is unreadable");
        var linkedSeen = {};
        for (var li = 0; li < linked.numItems; li++) {
          var member = linked[li];
          if (!member || typeof member.nodeId !== "string" || !member.nodeId.length) throw new Error("Linked member identity is unreadable");
          var linkedId = member.nodeId;
          if (linkedId === String(target.clip.nodeId) || linkedSeen["$" + linkedId]) continue;
          var located = __findClip(linkedId);
          if (!located) throw new Error("Linked member could not be located");
          linkedSeen["$" + linkedId] = true;
          partners.push(located);
        }
      } catch (eLinkedRead) { return __error("Linked membership could not be verified; nothing was changed. " + String(eLinkedRead)); }
    }
  }
  // Each clip's position when it was checked. A partner is edited only if it is
  // still there when its turn comes: if Premiere moved it while writing the
  // main clip, applying the offset again would double it and still read back
  // as the requested target.
  function editContext() {
    try {
      var projectId = app.project.documentID, sequenceId = app.project.activeSequence.sequenceID;
      if ((typeof projectId !== "string" && typeof projectId !== "number") || (typeof sequenceId !== "string" && typeof sequenceId !== "number") || !String(projectId).length || !String(sequenceId).length) return null;
      return { projectId: String(projectId), sequenceId: String(sequenceId) };
    } catch (eContext) { return null; }
  }
  var beforeContext = editContext();
  function position(nodeId) { try { return __clipPositionKey(nodeId); } catch (ePosition) { return null; } }
  var checkedAt = {}, affectedIds = [];
  function rememberAffected(check, fallbackId) {
    var ids = check && check.data && check.data.affectedNodeIds ? check.data.affectedNodeIds : [fallbackId];
    for (var ai = 0; ai < ids.length; ai++) {
      var affectedId = String(ids[ai]);
      var seen = false;
      for (var prior = 0; prior < affectedIds.length; prior++) if (affectedIds[prior] === affectedId) seen = true;
      if (!seen) { affectedIds.push(affectedId); checkedAt[affectedId] = position(affectedId); }
    }
  }
  function affectedPlacements() {
    var observed = [];
    for (var ai = 0; ai < affectedIds.length; ai++) observed.push({ nodeId: affectedIds[ai], before: checkedAt[affectedIds[ai]], after: position(affectedIds[ai]) });
    return observed;
  }
  function failedMutation(message, edited, mainData, failedPartner) {
    var observations = affectedPlacements(), afterContext = editContext();
    var stable = beforeContext && afterContext && beforeContext.projectId === afterContext.projectId && beforeContext.sequenceId === afterContext.sequenceId;
    var changed = false, readable = !!stable && observations.length > 0;
    var primaryAfter = null;
    for (var oi = 0; oi < observations.length; oi++) {
      var observation = observations[oi];
      if (observation.nodeId === nodeId) primaryAfter = observation.after;
      var before = typeof observation.before === "string" ? observation.before.split("|") : [];
      var after = typeof observation.after === "string" ? observation.after.split("|") : [];
      if (before.length !== 4 || after.length !== 4) readable = false;
      for (var fi = 0; fi < 4; fi++) {
        var known = before[fi] !== undefined && after[fi] !== undefined && /^-?\\d+$/.test(before[fi]) && /^-?\\d+$/.test(after[fi]);
        if (!known) readable = false;
        else if (stable && before[fi] !== after[fi]) changed = true;
      }
    }
    var data = { verified: false, mutationAttempted: true, rollbackPerformed: false,
      outcome: changed ? "committed_unverified" : (readable ? "not_applied" : "failed"),
      timelineChanged: changed ? true : (readable ? false : null),
      beforePosition: checkedAt[nodeId], afterPosition: primaryAfter, linkedPartnersEdited: edited,
      affectedPlacements: observations, contextStable: !!stable };
    if (!changed && !readable) data.mutationOutcome = "unknown";
    if (mainData) data.clipEdited = mainData;
    if (failedPartner) data.failedPartner = failedPartner;
    return __jsonStringify({ success: false,
      error: message + " The " + label + " mutation was attempted. Do not retry; inspect the clip and adjacent cuts before continuing.", data: data });
  }
  checkedAt[nodeId] = position(nodeId);
  var check;
  try { check = edit(target, nodeId, true); } catch (eCheck) { check = __editFail(eCheck.toString()); }
  if (!check.ok) return __error(check.error);
  rememberAffected(check, nodeId);
  var p;
  for (p = 0; p < partners.length; p++) {
    var partnerCheck;
    try { partnerCheck = edit(partners[p], String(partners[p].clip.nodeId), true); } catch (ePartnerCheck) { partnerCheck = __editFail(ePartnerCheck.toString()); }
    checkedAt[String(partners[p].clip.nodeId)] = position(String(partners[p].clip.nodeId));
    rememberAffected(partnerCheck, String(partners[p].clip.nodeId));
    if (!partnerCheck.ok) {
      return __error("The linked " + partners[p].trackType + " clip on track " + (partners[p].trackIndex + 1) + " cannot follow the " + label + ": " + partnerCheck.error + " Nothing was changed; fix that clip or pass include_linked false (this desyncs picture and sound).");
    }
  }
  var main;
  try { main = edit(target, nodeId, false); } catch (eMain) { main = __editFail(eMain.toString()); }
  if (!main.ok) return failedMutation(main.error, [], null, null);
  var verified = main.data.verified !== false;
  var edited = [];
  for (p = 0; p < partners.length; p++) {
    var partner = partners[p];
    var partnerId = String(partner.clip.nodeId);
    var outcome;
    if (position(partnerId) !== checkedAt[partnerId]) {
      outcome = __editFail("Premiere moved it while the main clip was written, so the " + label + " was not applied to it again");
    } else {
      try { outcome = edit(partner, partnerId, false); } catch (ePartner) { outcome = __editFail(ePartner.toString()); }
    }
    if (!outcome.ok) {
      return failedMutation("The " + label + " failed for its linked " + partner.trackType + " clip on track " + (partner.trackIndex + 1) + ": " + outcome.error, edited, main.data,
        { nodeId: String(partner.clip.nodeId), trackType: partner.trackType, trackIndex: partner.trackIndex });
    }
    var partnerVerified = !!outcome.data && outcome.data.verified !== false;
    if (!partnerVerified) verified = false;
    edited.push({ nodeId: String(partner.clip.nodeId), trackType: partner.trackType, trackIndex: partner.trackIndex, verified: partnerVerified });
  }
  main.data.linkedPartnersEdited = edited;
  if (!verified) {
    main.data.verified = false;
    main.data.outcome = "committed_unverified";
    if (!main.data.warning) main.data.warning = "The " + label + " was applied, but not every linked clip's result could be verified; inspect them.";
  }
  return __result(main.data);
}

// Start/end keys of a track's transitions, so readback can tell a transition
// this call added from one that was already there.
function __transitionKeys(track) {
  var keys = {};
  for (var i = 0; i < track.transitions.numItems; i++) keys[String(track.transitions[i].start.ticks) + "-" + String(track.transitions[i].end.ticks)] = true;
  return keys;
}
// True when a transition not listed in beforeKeys covers ticks. Covering
// rather than centring: Premiere cannot centre an odd frame count on a cut
// (a 25-frame dissolve splits 12/13) and adds tick drift.
function __newTransitionCovers(track, beforeKeys, ticks, frameTicks) {
  var tolerance = frameTicks / 2 + 1;
  for (var i = 0; i < track.transitions.numItems; i++) {
    var transition = track.transitions[i];
    if (beforeKeys[String(transition.start.ticks) + "-" + String(transition.end.ticks)]) continue;
    var start = parseFloat(transition.start.ticks);
    var end = parseFloat(transition.end.ticks);
    if (!isNaN(start) && !isNaN(end) && start - tolerance <= ticks && ticks <= end + tolerance) return true;
  }
  return false;
}

function __captureLinkGroupsAt(seq, cutTicks, onlyTracks) {
  var cut = parseFloat(cutTicks);
  var groups = [];
  var seen = {};
  var kinds = [["video", seq.videoTracks], ["audio", seq.audioTracks]];
  for (var k = 0; k < kinds.length; k++) {
    var tracks = kinds[k][1];
    for (var t = 0; t < tracks.numTracks; t++) {
      for (var c = 0; c < tracks[t].clips.numItems; c++) {
        var clip = tracks[t].clips[c];
        if (!(parseFloat(clip.start.ticks) < cut - 1 && parseFloat(clip.end.ticks) > cut + 1)) continue;
        var linked = null;
        try { linked = clip.getLinkedItems(); } catch (eLinked) {}
        if (!linked || !(linked.numItems > 1)) continue;
        var members = [];
        var ids = [];
        for (var li = 0; li < linked.numItems; li++) {
          var member = __findClip(String(linked[li].nodeId));
          if (!member) continue;
          var ms = parseFloat(member.clip.start.ticks);
          var me = parseFloat(member.clip.end.ticks);
          if (!(ms < cut - 1 && me > cut + 1)) continue;
          if (onlyTracks && !onlyTracks[member.trackType + ":" + member.trackIndex]) { members = []; break; }
          members.push({ trackType: member.trackType, trackIndex: member.trackIndex });
          ids.push(String(linked[li].nodeId));
        }
        ids.sort();
        var key = ids.join("|");
        if (members.length > 1 && !seen[key]) { seen[key] = true; groups.push(members); }
      }
    }
  }
  return groups;
}

function __relinkRazoredPieces(seq, cutTicks, groups) {
  var outcome = { relinked: 0, failures: [] };
  if (!groups.length) return outcome;
  var cut = parseFloat(cutTicks);
  var tolerance = seq.timebase ? parseFloat(seq.timebase) : TICKS_PER_SECOND / 24;
  var previous = [];
  try {
    var selection = seq.getSelection();
    for (var p = 0; selection && p < selection.length; p++) previous.push(String(selection[p].nodeId));
  } catch (eSelection) {}
  function clearSelection() {
    try {
      var current = seq.getSelection();
      for (var q = 0; current && q < current.length; q++) current[q].setSelected(false, true);
    } catch (eClear) {}
  }
  for (var g = 0; g < groups.length; g++) {
    var pieces = [];
    for (var m = 0; m < groups[g].length; m++) {
      var info = groups[g][m];
      var track = info.trackType === "video" ? seq.videoTracks[info.trackIndex] : seq.audioTracks[info.trackIndex];
      for (var c = 0; track && c < track.clips.numItems; c++) {
        if (Math.abs(parseFloat(track.clips[c].start.ticks) - cut) <= tolerance) { pieces.push(track.clips[c]); break; }
      }
    }
    if (pieces.length < 2) { outcome.failures.push("could not find the right-hand pieces to relink"); continue; }
    clearSelection();
    try {
      for (var s = 0; s < pieces.length; s++) pieces[s].setSelected(true, true);
      seq.linkSelection();
    } catch (eLink) {
      outcome.failures.push(eLink.toString());
    }
    var relinked = null;
    try { relinked = pieces[0].getLinkedItems(); } catch (eCheck) {}
    if (relinked && relinked.numItems >= pieces.length) outcome.relinked++;
    else outcome.failures.push("Premiere did not relink the pieces after the cut");
  }
  clearSelection();
  for (var r = 0; r < previous.length; r++) {
    var again = __findClip(previous[r]);
    if (again) { try { again.clip.setSelected(true, true); } catch (eRestore) {} }
  }
  return outcome;
}

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
  // Structural edge classification must be tighter than the one-frame
  // readback tolerance, or a real one-frame head or tail is missed.
  var edgeTol = __TICK_MATCH_TOL;

  var durationTicks = NaN;
  try { durationTicks = parseFloat(item.getOutPoint().ticks) - parseFloat(item.getInPoint().ticks); } catch (eDur) {}
  if (!(durationTicks > 0)) {
    try { durationTicks = parseFloat(item.getOutPoint(4).ticks) - parseFloat(item.getInPoint(4).ticks); } catch (eDur4) {}
  }
  if (!(durationTicks > 0)) {
    return { ok: false, error: "The source clip has no positive in/out duration, so an insert cannot be verified." };
  }

  // insertClip only ripples a target track that actually receives part of the
  // item: an audio-only item leaves the video target in place, and a still or
  // silent video leaves the audio target in place. Such a target must be
  // treated like any other track (shifted only if sync-locked), or it ends up
  // out of sync with everything that moved. getIn/OutPoint(1) is video media,
  // (2) audio; an unreadable span keeps the target assumption.
  function mediaSpan(mediaType) {
    try { return parseFloat(item.getOutPoint(mediaType).ticks) - parseFloat(item.getInPoint(mediaType).ticks); } catch (eSpan) { return null; }
  }
  var videoSpan = mediaSpan(1);
  var audioSpan = mediaSpan(2);
  var videoReceives = !(videoSpan !== null && !isNaN(videoSpan) && !(videoSpan > 0));
  var audioReceives = !(audioSpan !== null && !isNaN(audioSpan) && !(audioSpan > 0));

  // Premiere may move a split target-track tail to the sequence end while
  // reporting the requested insert as successful. Snapshot those tails before
  // any razor or insert so a misplaced remainder cannot receive a verified receipt.
  var targetTails = [];
  function captureTargetTails(track, type, index) {
    var ci2;
    for (ci2 = 0; ci2 < track.clips.numItems; ci2++) {
      var clip = track.clips[ci2];
      var start = parseFloat(clip.start.ticks);
      var end = parseFloat(clip.end.ticks);
      if (start < insertTicks - edgeTol && end > insertTicks + edgeTol) {
        var sourceId = "";
        try { sourceId = String(clip.projectItem.nodeId); } catch (eSource) {}
        if (!sourceId || sourceId === "undefined" || sourceId === "null") return false;
        targetTails.push({ track: track, type: type, index: index, sourceId: sourceId, tailDuration: end - insertTicks });
      }
    }
    return true;
  }
  if ((videoReceives && !captureTargetTails(videoTrack, "video", vTrackIndex)) ||
      (audioReceives && !captureTargetTails(audioTrack, "audio", aTrackIndex))) {
    return { ok: false, error: "Insert refused; nothing was changed. A target-track clip spans the insert point but its source identity is unreadable, so its split tail cannot be verified." };
  }

  // Premiere 26.5.2 can move a target straddler's tail to the sequence end
  // when insertClip performs the split itself (#730). Pre-razor that target
  // before insertion so insertClip sees an existing boundary. Target-only
  // calls need QE for this case too; otherwise refuse before mutation.
  var needsTargetRazor = targetTails.length > 0;
  if (targetOnly && needsTargetRazor) {
    var activeTarget = null;
    try { activeTarget = app.project.activeSequence; } catch (eActiveTarget) {}
    var targetId = "";
    var activeTargetId = "";
    try { targetId = String(seq.sequenceID); } catch (eTargetId) {}
    try { activeTargetId = String(activeTarget.sequenceID); } catch (eActiveTargetId) {}
    if (!targetId || targetId !== activeTargetId) {
      return { ok: false, error: "Insert refused; nothing was changed. A target clip spans the insert point, but QE can only razor the active sequence. Activate the target sequence first." };
    }
  }

  function domTrackFor(type, idx) {
    return type === "video" ? seq.videoTracks[idx] : seq.audioTracks[idx];
  }

  var qeSeq = null;
  if (!targetOnly || needsTargetRazor) {
    var qeUnavailableReason = needsTargetRazor ? "a target clip cannot be pre-razored" : "sync-lock state cannot be read";
    var qeUnavailableAdvice = needsTargetRazor
      ? " A target clip spans the insert point; razor it in Premiere before inserting."
      : " Pass scope 'target_tracks' to ripple only the named tracks (this will desync other tracks).";
    try {
      if (typeof app === "undefined" || typeof app.enableQE !== "function") {
        return { ok: false, error: "QE is unavailable, so " + qeUnavailableReason + " and the insert was not attempted." + qeUnavailableAdvice };
      }
      app.enableQE();
    } catch (eQE) {
      return { ok: false, error: "Premiere could not enable QE, so " + qeUnavailableReason + " and the insert was not attempted." + qeUnavailableAdvice };
    }
    try { qeSeq = (typeof qe !== "undefined" && qe.project) ? qe.project.getActiveSequence() : null; } catch (eSeq) { qeSeq = null; }
    if (!qeSeq) {
      return { ok: false, error: "No active sequence (QE); " + qeUnavailableReason + " and the insert was not attempted." + qeUnavailableAdvice };
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

  if (videoReceives) addPart("video", vTrackIndex, true);
  if (audioReceives) addPart("audio", aTrackIndex, true);

  if (!targetOnly) {
    var vN = seq.videoTracks.numTracks;
    var aN = seq.audioTracks.numTracks;
    var ti;
    for (ti = 0; ti < vN; ti++) {
      if (ti === vTrackIndex && videoReceives) continue;
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
      if (ti === aTrackIndex && audioReceives) continue;
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
      if (cs < insertTicks - edgeTol && ce > insertTicks + edgeTol) {
        straddlers.push({ nodeId: String(c.nodeId), start: cs, end: ce });
        continue;
      }
      if (cs >= insertTicks - edgeTol) {
        movers.push({ nodeId: String(c.nodeId), start: cs, end: ce });
      }
    }
    shiftPlan.push({ type: t.type, index: t.index, domTrack: t.domTrack, movers: movers, straddlers: straddlers });
  }

  var razorPlan = [];
  if (needsTargetRazor) {
    if (videoReceives) {
      for (pi = 0; pi < targetTails.length; pi++) {
        if (targetTails[pi].type === "video") { razorPlan.push({ type: "video", index: vTrackIndex, domTrack: videoTrack, shiftEntry: null }); break; }
      }
    }
    if (audioReceives) {
      for (pi = 0; pi < targetTails.length; pi++) {
        if (targetTails[pi].type === "audio") { razorPlan.push({ type: "audio", index: aTrackIndex, domTrack: audioTrack, shiftEntry: null }); break; }
      }
    }
  }
  for (pi = 0; pi < shiftPlan.length; pi++) {
    if (shiftPlan[pi].straddlers.length) razorPlan.push({ type: shiftPlan[pi].type, index: shiftPlan[pi].index, domTrack: shiftPlan[pi].domTrack, shiftEntry: shiftPlan[pi] });
  }
  var needRazor = razorPlan.length > 0;
  if (needRazor) {
    // QE razor accepts a formatted frame timecode, while insertClip receives
    // the exact ticks. Rounding a sub-frame request would cut at a different
    // point and leave a partially changed timeline. Refuse before any cut.
    var frameBoundary = Math.round(insertTicks / frameTicks) * frameTicks;
    if (Math.abs(insertTicks - frameBoundary) > __TICK_MATCH_TOL) {
      return { ok: false, error: "Insert refused; nothing was changed. The requested insertion time is not on a sequence frame boundary, so QE cannot razor the same point. Use a frame-aligned time." };
    }
    var razorAt = null;
    try { razorAt = __qeTimecodeForTicks(seq, insertTicks); } catch (eTc) {}
    if (!razorAt || !razorAt.timecode) {
      return { ok: false, error: "Insert refused; nothing was changed. Could not format a QE razor timecode for the insert point." };
    }
    // Resolve every QE razor route before changing any track. A missing audio
    // razor must not leave a video track cut with a "nothing changed" receipt.
    for (pi = 0; pi < razorPlan.length; pi++) {
      var razorTrack = null;
      try { razorTrack = qeTrackFor(razorPlan[pi].type, razorPlan[pi].index); } catch (eProbe) {}
      if (!razorTrack || typeof razorTrack.razor !== "function") {
        return { ok: false, error: "Insert refused; nothing was changed. " + razorPlan[pi].type + " track " + razorPlan[pi].index + " has a clip spanning the insert point and QE razor is unavailable. Razor it first in Premiere." };
      }
    }
    var razoredTracks = {};
    for (pi = 0; pi < razorPlan.length; pi++) {
      razoredTracks[razorPlan[pi].type + ":" + razorPlan[pi].index] = true;
    }
    var insertLinkGroups = __captureLinkGroupsAt(seq, insertTicks, razoredTracks);
    var razored = [];
    for (pi = 0; pi < razorPlan.length; pi++) {
      var razorPart = razorPlan[pi];
      try {
        qeTrackFor(razorPart.type, razorPart.index).razor(razorAt.timecode);
        razored.push(razorPart.type + " " + razorPart.index);
      } catch (razorErr) {
        return { ok: false, changed: true, error: "QE razor failed on " + razorPart.type + " track " + razorPart.index + (razored.length ? " after already razoring " + razored.join(", ") : "") + ". The timeline may be partially changed: " + razorErr.toString() };
      }
      if (razorPart.shiftEntry) razorPart.shiftEntry.movers = [];
      var stillSpan = false;
      for (ci = 0; ci < razorPart.domTrack.clips.numItems; ci++) {
        var rc = razorPart.domTrack.clips[ci];
        var rcs = parseFloat(rc.start.ticks);
        var rce = parseFloat(rc.end.ticks);
        if (rcs < insertTicks - edgeTol && rce > insertTicks + edgeTol) stillSpan = true;
        if (razorPart.shiftEntry && rcs >= insertTicks - edgeTol) {
          razorPart.shiftEntry.movers.push({ nodeId: String(rc.nodeId), start: rcs, end: rce });
        }
      }
      if (stillSpan) {
        return { ok: false, changed: true, error: "QE razor did not split a spanning clip on " + razorPart.type + " track " + razorPart.index + ", so the timeline may be partially changed. Inspect that track or use Undo." };
      }
    }
    var insertRelink = __relinkRazoredPieces(seq, insertTicks, insertLinkGroups);
    if (insertRelink.failures.length) {
      return { ok: false, changed: true, error: "QE razored tracks but did not keep " + insertRelink.failures.length + " linked video/audio group(s) linked (" + insertRelink.failures.join("; ") + "), so the timeline is partially changed. Relink them with link_selection or use Undo." };
    }
  }

  var beforeVideoIds = {};
  var beforeAudioIds = {};
  var i;
  // Every clip in the sequence, so a clip Premiere places somewhere other than
  // the requested tracks is still found (live 25.2.3: a 5.1 clip inserted on a
  // stereo track landed on a new track at the bottom).
  var beforeAllIds = {};
  var groupsBefore = [seq.videoTracks, seq.audioTracks];
  for (var gb = 0; gb < groupsBefore.length; gb++) {
    for (var tb = 0; tb < groupsBefore[gb].numTracks; tb++) {
      for (var cb = 0; cb < groupsBefore[gb][tb].clips.numItems; cb++) beforeAllIds[String(groupsBefore[gb][tb].clips[cb].nodeId)] = true;
    }
  }
  var audioTracksBefore = seq.audioTracks.numTracks;
  var videoTracksBefore = seq.videoTracks.numTracks;
  var beforeVideoCount = videoTrack.clips.numItems;
  var beforeAudioCount = audioTrack.clips.numItems;
  for (i = 0; i < beforeVideoCount; i++) beforeVideoIds[String(videoTrack.clips[i].nodeId)] = true;
  for (i = 0; i < beforeAudioCount; i++) beforeAudioIds[String(audioTrack.clips[i].nodeId)] = true;

  function expectedAddedForTrack(track) {
    var ci2;
    for (ci2 = 0; ci2 < track.clips.numItems; ci2++) {
      var cs2 = parseFloat(track.clips[ci2].start.ticks);
      var ce2 = parseFloat(track.clips[ci2].end.ticks);
      if (cs2 < insertTicks - edgeTol && ce2 > insertTicks + edgeTol) return 2;
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
    return { ok: false, changed: true, error: "Premiere rejected Sequence.insertClip" + afterRazorNote + ". The timeline may be partially changed: " + insErr.toString() };
  }

  var afterVideoCount = videoTrack.clips.numItems;
  var afterAudioCount = audioTrack.clips.numItems;
  if (afterVideoCount > beforeVideoCount + expectedVideoAdded || afterAudioCount > beforeAudioCount + expectedAudioAdded) {
    return { ok: false, changed: true, error: "Premiere inserted more clips on a targeted track than a split-plus-insert accounts for" + afterRazorNote + ". This can leave a residual frame fragment at an exact boundary; the insertion is not reported as verified." };
  }

  var insertedClips = [];
  var newOnVideo = 0;
  var newOnAudio = 0;
  function isRequestedInsert(clip) {
    try {
      return !!clip.projectItem && String(clip.projectItem.nodeId) === String(item.nodeId)
        && Math.abs(parseFloat(clip.start.ticks) - insertTicks) <= tol;
    } catch (eRequested) { return false; }
  }
  for (i = 0; i < afterVideoCount; i++) {
    if (!beforeVideoIds[String(videoTrack.clips[i].nodeId)]) {
      insertedClips.push(videoTrack.clips[i]);
      if (isRequestedInsert(videoTrack.clips[i])) newOnVideo++;
    }
  }
  for (i = 0; i < afterAudioCount; i++) {
    if (!beforeAudioIds[String(audioTrack.clips[i].nodeId)]) {
      insertedClips.push(audioTrack.clips[i]);
      if (isRequestedInsert(audioTrack.clips[i])) newOnAudio++;
    }
  }
  // Every stream the item has must land on its requested track. Live 25.2.3:
  // a 5.1 clip inserted on a stereo track landed on a new track at the bottom,
  // and a video with 5.1 audio can land its picture correctly but not its sound.
  var missingVideo = videoReceives && newOnVideo === 0;
  var missingAudio = audioReceives && newOnAudio === 0;
  if (!insertedClips.length || missingVideo || missingAudio) {
    var elsewhere = [];
    var groupsAfter = [["video", seq.videoTracks], ["audio", seq.audioTracks]];
    for (var ga = 0; ga < groupsAfter.length; ga++) {
      for (var ta = 0; ta < groupsAfter[ga][1].numTracks; ta++) {
        var clipsAfter = groupsAfter[ga][1][ta].clips;
        for (var ca = 0; ca < clipsAfter.numItems; ca++) {
          var candidateClip = clipsAfter[ca];
          if (beforeAllIds[String(candidateClip.nodeId)]) continue;
          // Only pieces of the inserted item count; a sync-lock split elsewhere does not.
          var fromItem = false;
          try { fromItem = !!candidateClip.projectItem && String(candidateClip.projectItem.nodeId) === String(item.nodeId); } catch (eItem) {}
          if (!fromItem) continue;
          if (groupsAfter[ga][0] === "video" && ta === vTrackIndex) continue;
          if (groupsAfter[ga][0] === "audio" && ta === aTrackIndex) continue;
          elsewhere.push({ trackType: groupsAfter[ga][0], trackIndex: ta, nodeId: String(candidateClip.nodeId), startSeconds: __ticksToSeconds(candidateClip.start.ticks) });
        }
      }
    }
    if (elsewhere.length || insertedClips.length) {
      var newTracks = (seq.audioTracks.numTracks - audioTracksBefore) + (seq.videoTracks.numTracks - videoTracksBefore);
      var labels = [];
      for (var el = 0; el < elsewhere.length; el++) labels.push(elsewhere[el].trackType + " track " + (elsewhere[el].trackIndex + 1));
      var missing = (missingVideo ? "video" : "") + (missingVideo && missingAudio ? " and " : "") + (missingAudio ? "audio" : "");
      var missingStreams = [];
      if (missingVideo) missingStreams.push("video");
      if (missingAudio) missingStreams.push("audio");
      return { ok: false, changed: true, placedOn: elsewhere, missingStreams: missingStreams, error: "The timeline changed: Premiere did not put the clip's " + (missing || "media") + " on the requested video track " + (vTrackIndex + 1) + " / audio track " + (aTrackIndex + 1) + (labels.length ? "; it placed it on " + labels.join(", ") : "") + (newTracks > 0 ? ", adding " + newTracks + " track(s)" : "") + " (for example, 5.1 audio does not fit a stereo track). Other tracks were not shifted to match" + afterRazorNote + ". Move or remove those pieces, or target tracks that match the clip's channel layout." };
    }
    return { ok: false, changed: true, error: "Premiere did not add a new track item at the requested insertion point" + afterRazorNote + ". The timeline may be partially changed." };
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
    return { ok: false, changed: true, error: "Premiere changed the target track but the requested project item was not found after insertion" + afterRazorNote + "." };
  }
  if (!(actualDuration > 0)) actualDuration = durationTicks;

  var displacedTails = [];
  for (i = 0; i < targetTails.length; i++) {
    var tail = targetTails[i];
    var expectedStart = insertTicks + actualDuration;
    var expectedEnd = expectedStart + tail.tailDuration;
    var adjacent = false;
    var observed = [];
    for (var ti2 = 0; ti2 < tail.track.clips.numItems; ti2++) {
      var candidate = tail.track.clips[ti2];
      var candidateId = "";
      try { candidateId = String(candidate.projectItem.nodeId); } catch (eCandidate) {}
      if (candidateId !== tail.sourceId) continue;
      var candidateStart = parseFloat(candidate.start.ticks);
      var candidateEnd = parseFloat(candidate.end.ticks);
      if (Math.abs(candidateStart - expectedStart) <= tol && Math.abs(candidateEnd - expectedEnd) <= tol) adjacent = true;
      if (Math.abs((candidateEnd - candidateStart) - tail.tailDuration) <= tol) observed.push(__ticksToSeconds(candidateStart) + "s");
    }
    if (!adjacent) displacedTails.push(tail.type + " tail expected at " + __ticksToSeconds(expectedStart) + "s; matching remainder starts at " + (observed.length ? observed.join(", ") : "no readable position"));
  }
  if (displacedTails.length) {
    return { ok: false, changed: true, displacedTails: displacedTails, error: "The timeline changed, but Premiere did not leave a split target-track tail adjacent to the inserted clip. " + displacedTails.join("; ") + ". The insert is not verified; inspect the sequence and undo if needed." };
  }

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
    return { ok: false, changed: true, error: "The clip was inserted on the named tracks but sync-locked tracks were not rippled cleanly, so the timeline is now partially desynced and needs checking. " + failures.concat(verifyProblems).join("; ") + "." };
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
    insertedTrackItems: newOnVideo + newOnAudio,
    splitRemainders: insertedClips.length - newOnVideo - newOnAudio
  };
  if (targetOnly) {
    data.warning = "Only the named tracks were rippled. Other tracks were left in place and may be out of sync. This will desync any sync-locked neighbours.";
  }
  return { ok: true, data: data };
}

function __jsonEscapeString(value) {
  return '"' + value
    .replace(/\\\\/g, "\\\\\\\\")
    .replace(/"/g, '\\\\"')
    .replace(/\\n/g, "\\\\n")
    .replace(/\\r/g, "\\\\r")
    .replace(/\\t/g, "\\\\t")
    .replace(/[\\u0000-\\u001f\\u2028\\u2029]/g, function (ch) {
      var hex = ch.charCodeAt(0).toString(16);
      while (hex.length < 4) hex = "0" + hex;
      return "\\\\u" + hex;
    }) + '"';
}

function __jsonStringify(obj) {
  // ES3-compatible JSON stringify. Never delegate to JSON.stringify here: the
  // global JSON polyfill above is a wrapper around THIS function, so delegating
  // creates infinite mutual recursion ("InternalError: Stack overrun") that took
  // down every __result call in the shared engine.
  // Output must always be valid JSON: one NaN, undefined, or raw control
  // character would otherwise make the whole tool response unparseable.
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return __jsonEscapeString(obj);
  if (typeof obj === "number") return isFinite(obj) ? String(obj) : "null";
  if (typeof obj === "boolean") return String(obj);
  if (typeof obj === "function") return "null";
  if (obj instanceof Array) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) {
      var item = obj[i];
      arr.push(item === undefined || typeof item === "function" ? "null" : __jsonStringify(item));
    }
    return "[" + arr.join(",") + "]";
  }
  if (typeof obj === "object") {
    var parts = [];
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) {
        var member = obj[k];
        if (member === undefined || typeof member === "function") continue;
        parts.push(__jsonEscapeString(String(k)) + ":" + __jsonStringify(member));
      }
    }
    return "{" + parts.join(",") + "}";
  }
  return __jsonEscapeString(String(obj));
}

// EXPERIMENTAL (undocumented QE DOM). Premiere's undo history position when
// the current command started; buildScript sets it only for tools that change
// the project (see undo-tracking.ts) and clears it otherwise. QE edits (razor,
// insert, lift, extract...) add entries; most DOM property/marker writes add
// none. __result reports how many entries the command added so an agent can
// undo exactly that call.
var __undoStart = null;
var __markerWriteAttempted = false;
function __readUndoIndex() {
  try {
    app.enableQE();
    var v = Number(qe.project.undoStackIndex());
    return isFinite(v) ? v : null;
  } catch (eUndoIdx) {
    return null;
  }
}

function __markerWriteReceipt(data) {
  if (!__markerWriteAttempted) return data;
  if (!data || typeof data !== "object" || data instanceof Array) data = {};
  var barrier = __rememberMarkerUndoBarrier(__readUndoIndex());
  data.qeMarkerUndoVerified = false;
  data.markerUndoBarrier = barrier.ok;
  if (!data.markerUndoWarning) data.markerUndoWarning = "Marker reversal through QE is not verified. The undo tools protect this observed marker boundary; inspect markers separately.";
  return data;
}
function __result(data) {
  data = __markerWriteReceipt(data);
  if (__undoStart !== null && data && typeof data === "object" && !(data instanceof Array)) {
    var undoNow = __readUndoIndex();
    if (undoNow !== null && undoNow > __undoStart) {
      data.undoSteps = undoNow - __undoStart;
      data.undoStackIndex = undoNow;
    }
  }
  return __jsonStringify({ success: true, data: data });
}

// extraData (optional) is merged into the failure's data, alongside any undo
// entries the command recorded.
function __error(msg, extraData) {
  var message = String(msg);
  // A failure can come after the command recorded undo entries; report them
  // so the caller knows the project may have changed.
  var data = null;
  if (extraData && typeof extraData === "object") {
    data = {};
    for (var key in extraData) if (extraData.hasOwnProperty(key)) data[key] = extraData[key];
  }
  data = __markerWriteReceipt(data);
  if (__markerWriteAttempted && data) {
    // A throwing DOM call may have changed the marker; an attempted write
    // alone cannot establish that it committed. Preserve observed changes.
    data.timelineChanged = data.timelineChanged === true ? true : null;
    data.outcome = data.timelineChanged === true ? "committed_unverified" : "failed";
    if (data.timelineChanged !== true) data.mutationOutcome = "unknown";
    data.mutationAttempted = true;
    data.verified = false;
  }
  if (__undoStart !== null) {
    var undoNow = __readUndoIndex();
    if (undoNow !== null && undoNow > __undoStart) {
      var recorded = undoNow - __undoStart;
      if (!data) data = {};
      data.undoSteps = recorded;
      data.undoStackIndex = undoNow;
      data.timelineChanged = true;
      message += " Premiere recorded " + recorded + " undo entr" + (recorded === 1 ? "y" : "ies") + " during this command, so the project may have changed.";
    }
  }
  return data ? __jsonStringify({ success: false, error: message, data: data }) : __jsonStringify({ success: false, error: message });
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
  const expected = expectedProjectPath();
  const projectGuard = expected === undefined ? "" : `
    var __expectedProjectPath = new File("${escapeForExtendScript(expected)}").fsName;
    var __activeProjectPath = app.project && app.project.path;
    if (!__activeProjectPath) return __error("Expected project guard refused: active project is missing or unsaved; nothing was changed.");
    __activeProjectPath = new File(__activeProjectPath).fsName;
    if (String($.os).toLowerCase().indexOf("windows") !== -1) {
      __expectedProjectPath = __expectedProjectPath.toLowerCase();
      __activeProjectPath = __activeProjectPath.toLowerCase();
    }
    if (__activeProjectPath !== __expectedProjectPath) return __error("Expected project guard refused: active project differs; nothing was changed.");
  `;
  // Helpers live in a long-lived engine, so __undoStart is always reset: set
  // for tools that change the project, cleared for everything else.
  const undoStart = undoTrackingEnabled()
    ? `__undoStart = typeof __readUndoIndex === "function" ? __readUndoIndex() : null;`
    : `__undoStart = null;`;
  return `(function() {
  try {
    ${projectGuard}
    ${undoStart}
    __markerWriteAttempted = false;
    ${code}
  } catch(e) {
    return __error(e.toString());
  }
})();`;
}

/**
 * Escape a string for safe embedding in ExtendScript.
 */
// Control characters, the U+2028/U+2029 line separators (which ES3 does not
// allow raw inside a string literal), and lone surrogates (which cannot be
// written to the UTF-8 command file and would arrive as U+FFFD). Built from a
// string so no tool parses the separators inside a regex literal.
const UNSAFE_LITERAL_CHARACTERS = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u2028\\u2029]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]",
  "g",
);

/** Write characters a string literal cannot carry safely as `\uXXXX` escapes. */
export function escapeUnsafeLiteralCharacters(value: string): string {
  return value.replace(UNSAFE_LITERAL_CHARACTERS, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function escapeForExtendScript(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    // ES3 treats U+2028 and U+2029 as line terminators, so a raw one inside a
    // string literal is a syntax error and Premiere rejects the whole script
    // (live 25.2.3: a marker named "Line<U+2028>break" failed with "EvalScript
    // error"). Other control characters and lone surrogates are escaped too.
    .replace(UNSAFE_LITERAL_CHARACTERS, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Build a script that wraps code returning a value.
 * The code should use `return __result(...)` or `return __error(...)`.
 * @deprecated Use buildScript() directly. This is an alias kept for backward compatibility.
 */
export const buildToolScript = buildScript;
