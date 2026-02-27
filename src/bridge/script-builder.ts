/**
 * Builds ExtendScript strings with helper functions prepended.
 * All generated code must be ES3-compatible (var, no arrow functions, no let/const).
 */

const HELPERS = `
// === MCP Bridge Helpers (auto-prepended) ===

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

function __jsonStringify(obj) {
  // ES3-compatible JSON stringify
  if (typeof JSON !== "undefined" && JSON.stringify) {
    return JSON.stringify(obj);
  }
  // Fallback for very old ExtendScript
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
 * Build a complete ExtendScript by wrapping user code in an IIFE with helpers.
 */
export function buildScript(code: string): string {
  return `${HELPERS}
(function() {
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
