import { createHash } from "node:crypto";
import {
  sendCommand,
  type BridgeOptions,
  type CommandResult,
} from "../bridge/file-bridge.js";
import { buildToolScript } from "../bridge/script-builder.js";

/**
 * Compact, read-only snapshots exposed as MCP resources.  They deliberately
 * do not return native file paths or project tree paths: callers can discover
 * stable Premiere IDs and names, then ask an operator before a path-sensitive
 * action.  Each read is a fresh CEP bridge request and gets a revision hash
 * calculated from the returned, redacted payload.
 */
export interface LiveContextResource {
  name: string;
  uri: string;
  description: string;
  read: (uri: URL) => Promise<{
    contents: Array<{ uri: string; mimeType: "application/json"; text: string }>;
  }>;
}

const MAX_SEQUENCES = 50;
const MAX_PROJECT_ITEMS = 100;
const MAX_TIMELINE_CLIPS = 128;
const MAX_MARKERS = 128;

function snapshotRevision(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 20);
}

function resourceResult(uri: URL, resource: string, result: CommandResult) {
  const payload = result.success
    ? {
        ok: true,
        resource,
        resourceSchemaVersion: 1,
        backend: "cep",
        data: result.data ?? null,
      }
    : {
        ok: false,
        resource,
        resourceSchemaVersion: 1,
        backend: "cep",
        error: result.error ?? "Premiere did not return a resource snapshot",
      };

  const snapshot = {
    ...payload,
    snapshotRevision: snapshotRevision(payload),
  };

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json" as const,
        text: JSON.stringify(snapshot, null, 2),
      },
    ],
  };
}

function createReader(scriptBody: string, bridgeOptions: BridgeOptions) {
  const script = buildToolScript(scriptBody);
  return async (uri: URL, resource: string) =>
    resourceResult(uri, resource, await sendCommand(script, bridgeOptions));
}

export function getLiveContextResources(
  bridgeOptions: BridgeOptions,
): LiveContextResource[] {
  const projectInfo = createReader(
    `
      var project = app.project;
      if (!project) return __error("No project is open");
      var active = project.activeSequence;
      return __result({
        project: {
          name: String(project.name || ""),
          isDirty: project.dirty === true,
          sequenceCount: project.sequences.numSequences,
          rootItemCount: project.rootItem && project.rootItem.children ? project.rootItem.children.numItems : 0
        },
        activeSequence: active ? {
          id: String(active.sequenceID),
          name: String(active.name || ""),
          videoTrackCount: active.videoTracks.numTracks,
          audioTrackCount: active.audioTracks.numTracks,
          durationSeconds: __ticksToSeconds(active.end.ticks)
        } : null,
        privacy: { nativePaths: "not returned", projectTreePaths: "not returned" }
      });
    `,
    bridgeOptions,
  );

  const sequences = createReader(
    `
      var project = app.project;
      if (!project) return __error("No project is open");
      var allCount = project.sequences.numSequences;
      var rows = [];
      for (var i = 0; i < allCount && i < ${MAX_SEQUENCES}; i++) {
        var sequence = project.sequences[i];
        rows.push({
          id: String(sequence.sequenceID),
          name: String(sequence.name || ""),
          width: sequence.frameSizeHorizontal,
          height: sequence.frameSizeVertical,
          durationSeconds: __ticksToSeconds(sequence.end.ticks),
          videoTrackCount: sequence.videoTracks.numTracks,
          audioTrackCount: sequence.audioTracks.numTracks,
          isActive: project.activeSequence && String(project.activeSequence.sequenceID) === String(sequence.sequenceID)
        });
      }
      return __result({
        sequences: rows,
        returnedCount: rows.length,
        totalCount: allCount,
        truncated: allCount > rows.length,
        maximumSequences: ${MAX_SEQUENCES},
        privacy: { nativePaths: "not returned" }
      });
    `,
    bridgeOptions,
  );

  const media = createReader(
    `
      var project = app.project;
      if (!project) return __error("No project is open");
      var rows = [];
      var scannedItems = 0;
      var truncated = false;
      function scan(parent, depth) {
        if (!parent || !parent.children || truncated) return;
        for (var i = 0; i < parent.children.numItems; i++) {
          if (rows.length >= ${MAX_PROJECT_ITEMS}) { truncated = true; return; }
          var item = parent.children[i];
          scannedItems++;
          if (item.type === 1) {
            var hasMediaPath = false;
            var offline = null;
            var hasVideo = null;
            var hasAudio = null;
            try { hasMediaPath = !!item.getMediaPath(); } catch (pathError) {}
            try { offline = !!item.isOffline(); } catch (offlineError) {}
            try { hasVideo = !!item.hasVideo(); } catch (videoError) {}
            try { hasAudio = !!item.hasAudio(); } catch (audioError) {}
            rows.push({
              id: String(item.nodeId),
              name: String(item.name || ""),
              type: "clip",
              depth: depth,
              hasMediaPath: hasMediaPath,
              offline: offline,
              hasVideo: hasVideo,
              hasAudio: hasAudio
            });
          }
          if (item.type === 2) scan(item, depth + 1);
        }
      }
      scan(project.rootItem, 0);
      return __result({
        media: rows,
        returnedCount: rows.length,
        scannedItems: scannedItems,
        truncated: truncated,
        maximumMediaItems: ${MAX_PROJECT_ITEMS},
        privacy: { nativePaths: "not returned", projectTreePaths: "not returned" }
      });
    `,
    bridgeOptions,
  );

  const bins = createReader(
    `
      var project = app.project;
      if (!project) return __error("No project is open");
      var rows = [];
      var scannedItems = 0;
      var truncated = false;
      function scan(parent, depth) {
        if (!parent || !parent.children || truncated) return;
        for (var i = 0; i < parent.children.numItems; i++) {
          if (rows.length >= ${MAX_PROJECT_ITEMS}) { truncated = true; return; }
          var item = parent.children[i];
          scannedItems++;
          if (item.type === 2) {
            rows.push({
              id: String(item.nodeId),
              name: String(item.name || ""),
              depth: depth,
              directItemCount: item.children ? item.children.numItems : 0
            });
            scan(item, depth + 1);
          }
        }
      }
      scan(project.rootItem, 0);
      return __result({
        bins: rows,
        returnedCount: rows.length,
        scannedItems: scannedItems,
        truncated: truncated,
        maximumBins: ${MAX_PROJECT_ITEMS},
        privacy: { nativePaths: "not returned", projectTreePaths: "not returned" }
      });
    `,
    bridgeOptions,
  );

  const activeTimeline = createReader(
    `
      var project = app.project;
      if (!project) return __error("No project is open");
      var sequence = project.activeSequence;
      if (!sequence) return __result({ activeSequence: null, tracks: [], clips: [], markers: [] });
      var tracks = [];
      var clips = [];
      var clipsTruncated = false;
      function collectTracks(trackCollection, type) {
        for (var t = 0; t < trackCollection.numTracks; t++) {
          var track = trackCollection[t];
          var muted = null;
          var locked = null;
          try { muted = !!track.isMuted(); } catch (muteError) {}
          try { locked = !!track.isLocked(); } catch (lockError) {}
          tracks.push({ type: type, index: t, name: String(track.name || ""), clipCount: track.clips.numItems, muted: muted, locked: locked });
          for (var c = 0; c < track.clips.numItems; c++) {
            if (clips.length >= ${MAX_TIMELINE_CLIPS}) { clipsTruncated = true; break; }
            var clip = track.clips[c];
            clips.push({
              id: String(clip.nodeId),
              name: String(clip.name || ""),
              trackType: type,
              trackIndex: t,
              startSeconds: __ticksToSeconds(clip.start.ticks),
              endSeconds: __ticksToSeconds(clip.end.ticks),
              durationSeconds: __ticksToSeconds(clip.duration.ticks)
            });
          }
        }
      }
      collectTracks(sequence.videoTracks, "video");
      collectTracks(sequence.audioTracks, "audio");
      var markers = [];
      var markersTruncated = false;
      try {
        var marker = sequence.markers.getFirstMarker();
        while (marker) {
          if (markers.length >= ${MAX_MARKERS}) { markersTruncated = true; break; }
          markers.push({
            name: String(marker.name || ""),
            startSeconds: __ticksToSeconds(marker.start.ticks),
            endSeconds: __ticksToSeconds(marker.end.ticks),
            type: marker.type || null
          });
          marker = sequence.markers.getNextMarker(marker);
        }
      } catch (markerError) {}
      return __result({
        activeSequence: { id: String(sequence.sequenceID), name: String(sequence.name || ""), durationSeconds: __ticksToSeconds(sequence.end.ticks) },
        tracks: tracks,
        clips: clips,
        markers: markers,
        clipsTruncated: clipsTruncated,
        markersTruncated: markersTruncated,
        maximumClips: ${MAX_TIMELINE_CLIPS},
        maximumMarkers: ${MAX_MARKERS},
        privacy: { nativePaths: "not returned" }
      });
    `,
    bridgeOptions,
  );

  return [
    {
      name: "premiere-live-project-info",
      uri: "premiere://project/info",
      description: "Bounded, read-only current-project summary with no native paths.",
      read: (uri) => projectInfo(uri, "premiere://project/info"),
    },
    {
      name: "premiere-live-project-sequences",
      uri: "premiere://project/sequences",
      description: "Bounded, read-only sequence inventory with stable Premiere IDs.",
      read: (uri) => sequences(uri, "premiere://project/sequences"),
    },
    {
      name: "premiere-live-project-media",
      uri: "premiere://project/media",
      description: "Bounded, path-redacted media inventory for planning and inspection.",
      read: (uri) => media(uri, "premiere://project/media"),
    },
    {
      name: "premiere-live-project-bins",
      uri: "premiere://project/bins",
      description: "Bounded, path-redacted bin inventory for project organization planning.",
      read: (uri) => bins(uri, "premiere://project/bins"),
    },
    {
      name: "premiere-live-active-timeline",
      uri: "premiere://timeline/active",
      description: "Bounded, read-only active-timeline tracks, clips, and markers snapshot.",
      read: (uri) => activeTimeline(uri, "premiere://timeline/active"),
    },
  ];
}
