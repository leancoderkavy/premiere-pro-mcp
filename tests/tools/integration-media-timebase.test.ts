import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), sendRawCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getPlaybackTools } from "../../src/tools/playback.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { runWithUndoTracking } from "../../src/bridge/undo-tracking.js";
const opts = { tempDir: "/tmp/integration-gap", timeoutMs: 5000 };
function install(app: unknown, qe?: unknown) {
  vi.mocked(sendCommand).mockImplementation(async script => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app, qe }))));
}
describe("independent media duration", () => {
  it.each([
    ["00:00:04:15", "25.00 fps", 4.6], ["00:00:06:24000", "48000 Hz", 6.5],
    // Live 26.5.2 metadata: nominal-rate timecode for fractional media, and drop-frame 29.97.
    ["00:02:55:04", "23.98 fps", 175.34169320331], ["00:05:26:01", "29.97 fps", 326.359366666667],
    ["00;05;26;11", "29.97 fps", 326.359366666667], ["00:00:06:18", "60.00 fps", 6.3],
    ["00:00:13:06710", "44100 Hz", 13.1521541950113],
  ])("verifies full duration %s using MediaTimebase %s", async (duration, timebase, out) => {
    const item = { nodeId: "a", name: "Media", type: 1, getInPoint: () => ({ seconds: 0 }), getOutPoint: () => ({ seconds: out }), clearInPoint() {}, clearOutPoint() {}, getProjectMetadata: () => `<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>${duration}</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>${timebase}</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>` };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });
    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "a" })).resolves.toMatchObject({ success: true, data: { verified: true, outSeconds: out } });
  });
  it.each(["", "0 fps", "48000 Hz", "NaN fps"])("leaves unknown or incompatible duration %s unverified and reports In separately", async rate => {
    const item = { nodeId: "a", name: "Media", type: 1, getInPoint: () => ({ seconds: 0 }), getOutPoint: () => ({ seconds: 4.6 }), clearInPoint() {}, clearOutPoint() {}, getProjectMetadata: () => `<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:04:15</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>${rate}</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>` };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });
    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "a" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("In cleared to 0 s; Out could not"), data: { outcome: "committed_unverified", unverifiedFields: ["outPoint"] } });
    expect(String(vi.mocked(sendCommand).mock.lastCall?.[0])).toContain("\\s+");
  });
  it.each([
    ["RDF attributes on duration", '<x:xmpmeta><xmpDM:duration xmpDM:value="250" xmpDM:scale="1/25"/></x:xmpmeta>'],
    ["direct xmpDM child elements", '<x:xmpmeta><xmpDM:duration><xmpDM:value>250</xmpDM:value><xmpDM:scale>1/25</xmpDM:scale></xmpDM:duration></x:xmpmeta>'],
  ])("uses independent XMP Dynamic Media duration serialized as %s", async (_form, xmp) => {
    let inside = 2, outside = 6;
    const item = {
      nodeId: "xmp-duration", name: "Ten seconds", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 10; },
      // The previous MediaDuration + MediaTimebase-only predicate has no usable duration here.
      getProjectMetadata: () => "<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>unreadable</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>",
      getXMPMetadata: () => xmp,
    };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "xmp-duration" })).resolves.toMatchObject({
      success: true, data: { verified: true, inSeconds: 0, outSeconds: 10, outVerificationEvidence: "xmpDynamicMedia" },
    });
  });
  it("does not read XMP duration fields from a nested RDF resource", async () => {
    let inside = 2, outside = 6;
    const item = {
      nodeId: "nested-xmp-duration", name: "Unknown duration", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 10; },
      getProjectMetadata: () => "",
      getXMPMetadata: () => '<xmpDM:duration><rdf:Description xmpDM:value="250" xmpDM:scale="1/25"/></xmpDM:duration>',
    };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "nested-xmp-duration" })).resolves.toMatchObject({
      success: false, data: { verified: false, unverifiedFields: ["outPoint"], outVerificationEvidence: null },
    });
  });
  it.each([
    ["missing", () => ""],
    ["malformed", () => '<xmpDM:duration xmpDM:scale="not-a-rational"><rdf:value>250</rdf:value></xmpDM:duration>'],
  ])("keeps Out unverified with %s independent duration evidence", async (_kind, xmp) => {
    let inside = 2, outside = 6;
    const item = {
      nodeId: "no-xmp-duration", name: "Unknown duration", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 10; },
      getProjectMetadata: () => "<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>unreadable</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>",
      getXMPMetadata: xmp,
    };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "no-xmp-duration" })).resolves.toMatchObject({
      success: false, data: { verified: false, inSeconds: 0, outSeconds: 10, unverifiedFields: ["outPoint"], outVerificationEvidence: null },
    });
  });
  it("rejects a wrong Out even when XMP provides independent duration", async () => {
    let inside = 2, outside = 6;
    const item = {
      nodeId: "wrong-xmp-out", name: "Ten seconds", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 8; },
      getProjectMetadata: () => "",
      getXMPMetadata: () => '<xmpDM:duration xmpDM:value="250" xmpDM:scale="1/25"/>',
    };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "wrong-xmp-out" })).resolves.toMatchObject({
      success: false, data: { verified: false, outSeconds: 8, unverifiedFields: ["outPoint"], outVerificationEvidence: "xmpDynamicMedia" },
    });
  });
  it("rejects a coarse-scale XMP duration when clear Out is materially wrong", async () => {
    let inside = 2, outside = 6;
    const item = {
      nodeId: "coarse-xmp-duration", name: "Ten seconds", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 9; },
      getProjectMetadata: () => "",
      getXMPMetadata: () => '<xmpDM:duration xmpDM:value="10" xmpDM:scale="1/1"/>',
    };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "coarse-xmp-duration" })).resolves.toMatchObject({
      success: false, data: { verified: false, outSeconds: 9, unverifiedFields: ["outPoint"], outVerificationEvidence: "xmpDynamicMedia", outVerificationFrameRateEvidence: null },
    });
  });
  it("accepts frame-rounded XMP duration only with independent MediaTimebase evidence", async () => {
    let inside = 2, outside = 3;
    const item = {
      nodeId: "fractional-xmp-duration", name: "Fractional media", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 4.65; },
      getProjectMetadata: () => "<premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>23.98 fps</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>",
      getXMPMetadata: () => '<xmpDM:duration xmpDM:value="111" xmpDM:scale="1001/24000"/>',
    };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "fractional-xmp-duration" })).resolves.toMatchObject({
      success: true, data: { verified: true, outSeconds: 4.65, outVerificationEvidence: "xmpDynamicMedia", outVerificationFrameRateEvidence: "projectMetadataMediaTimebase" },
    });
  });
  it("verifies fractional source duration while clearing marks without changing a nonempty timeline", async () => {
    let inside = 2, outside = 3, undoIndex = 0;
    const item = {
      nodeId: "a", name: "Media", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 4.629625; undoIndex = 1; },
      getProjectMetadata: () => "<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:04:15</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>23.98 fps</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>",
    };
    const time = (seconds: number) => ({ ticks: String(seconds * 254016000000) });
    const timelineClip = { nodeId: "timeline-clip", start: time(10), end: time(15), inPoint: time(2), outPoint: time(7) };
    const transition = { nodeId: "transition", type: "Cross Dissolve", start: time(14.5), end: time(15.5) };
    const activeSequence = {
      sequenceID: "seq",
      videoTracks: Object.assign([Object.assign({ clips: Object.assign([timelineClip], { numItems: 1 }), transitions: Object.assign([transition], { numItems: 1 }) }, {})], { numTracks: 1 }),
      audioTracks: Object.assign([], { numTracks: 0 }),
    };
    install({ enableQE() {}, project: { activeSequence, rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } }, { project: { undoStackIndex: () => undoIndex } });

    const result = await runWithUndoTracking(true, () => getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "a" })) as any;

    expect(result).toMatchObject({ success: true, data: { verified: true, marksChanged: true, timelineChanged: false, inSeconds: 0, outSeconds: 4.629625, undoSteps: 1 } });
  });
  it("does not accept a materially wrong clear-out value within a fractional source's duration check", async () => {
    let inside = 2, outside = 3;
    const item = {
      nodeId: "a", name: "Media", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 4.879625; },
      getProjectMetadata: () => "<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:04:15</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>23.98 fps</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>",
    };
    install({ project: { rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "a" })).resolves.toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false, marksChanged: true, unverifiedFields: ["outPoint"] } });
  });
  it("leaves timeline change unknown when an active-sequence snapshot is unreadable", async () => {
    let inside = 2, outside = 3;
    const item = {
      nodeId: "a", name: "Media", type: 1,
      getInPoint: () => ({ seconds: inside }), getOutPoint: () => ({ seconds: outside }),
      clearInPoint() { inside = 0; }, clearOutPoint() { outside = 4.629625; },
      getProjectMetadata: () => "<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>00:00:04:15</premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration><premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>23.98 fps</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>",
    };
    const activeSequence = {
      sequenceID: "seq",
      videoTracks: Object.assign([{ clips: Object.assign([{ nodeId: "bad", start: { ticks: "1" }, end: { ticks: "2" }, inPoint: { ticks: "0" } }], { numItems: 1 }), transitions: Object.assign([], { numItems: 0 }) }], { numTracks: 1 }),
      audioTracks: Object.assign([], { numTracks: 0 }),
    };
    install({ project: { activeSequence, rootItem: { children: Object.assign({ numItems: 1 }, [item]) } } });

    await expect(getTrackTargetingTools(opts).clear_item_in_out.handler({ item_id: "a" })).resolves.toMatchObject({ success: true, data: { verified: true, timelineChanged: null } });
  });
});
