// Host-side ExtendScript (runs in Premiere Pro's ExtendScript engine)
// These helpers are always available to the AI Chat panel.

var TICKS_PER_SECOND = 254016000000;

function __ticksToSeconds(ticks) {
  return parseFloat(ticks) / TICKS_PER_SECOND;
}

function __secondsToTicks(seconds) {
  return Math.round(parseFloat(seconds) * TICKS_PER_SECOND);
}

function __jsonStringify(obj) {
  if (typeof JSON !== "undefined" && JSON.stringify) {
    return JSON.stringify(obj);
  }
  if (obj === null) return "null";
  if (obj === undefined) return "undefined";
  if (typeof obj === "string") return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
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

function aiChatPing() {
  try {
    var version = app.version;
    var projectName = app.project && app.project.name ? app.project.name : "No project open";
    return __result({
      connected: true,
      premiereVersion: version,
      projectName: projectName
    });
  } catch(e) {
    return __error(e.toString());
  }
}

function getProjectContext() {
  try {
    var project = app.project;
    if (!project) return __result({ hasProject: false });

    var info = {
      hasProject: true,
      name: project.name,
      path: project.path,
      numSequences: project.sequences.numSequences,
      numItems: project.rootItem.children.numItems,
      activeSequence: null
    };

    var seq = project.activeSequence;
    if (seq) {
      info.activeSequence = {
        name: seq.name,
        id: seq.sequenceID,
        videoTracks: seq.videoTracks.numTracks,
        audioTracks: seq.audioTracks.numTracks,
        frameSizeH: seq.frameSizeHorizontal,
        frameSizeV: seq.frameSizeVertical
      };
    }

    return __result(info);
  } catch(e) {
    return __error(e.toString());
  }
}
