import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("../../src/tools/mogrt-validation.js", () => ({ validateMogrtArchive: vi.fn(() => null) }));
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn(), sendRawCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMetadataTools } from "../../src/tools/metadata.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getWorkspaceTools } from "../../src/tools/workspace.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getAvSettingsTools } from "../../src/tools/av-settings.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getTextTools } from "../../src/tools/text.js";

const bridge = { tempDir: "/tmp/readback-leftovers" };
const metadata = getMetadataTools(bridge), media = getMediaTools(bridge), workspace = getWorkspaceTools(bridge);
const advanced = getAdvancedTools(bridge), av = getAvSettingsTools(bridge), tracks = getTrackTargetingTools(bridge), text = getTextTools(bridge);
const send = vi.mocked(sendCommand);
const ticks = 254016000000;
const collection = (items: any[]) => Object.assign({ numItems: items.length }, items);
const quoted = ' item " \\ \n ); throw new Error("unexpected"); // ';
function host(item: any = {}, extra: any = {}) {
  item = { name: "Temporary", nodeId: quoted, type: 1, ...item };
  const app = { project: { rootItem: { children: collection([item]) } }, ...extra.app };
  send.mockImplementation(async (script) => JSON.parse(String(runInNewContext(getHelpersSource() + "\n" + script, { ...extra, app }))));
  return item;
}
beforeEach(() => vi.clearAllMocks());

function xmpHost(mode = "apply", patchCount = 2, patchText = "patch") {
  const fields = Array.from({ length: patchCount }, (_, i) => ({ namespace: "urn:test/", path: i ? `dc:subject[${i}]` : "dc:title", value: i ? ' two " \\ \n ' : "  new title  " }));
  let packet = JSON.stringify([{ namespace: "urn:test/", path: "dc:title", value: "old" }, { namespace: "urn:other/", path: "other:keep", value: "keep" }]);
  let written = false;
  class Xmp {
    fields: any[];
    constructor(input: string) { this.fields = input === patchText ? fields.map(x => ({ ...x })) : JSON.parse(input); }
    iterator() { let i = 0; return { next: () => this.fields[i++] ?? null }; }
    getProperty(ns: string, name: string) { if (mode === "read-throws" && written) throw new Error("unreadable"); return this.fields.find(f => f.namespace === ns && f.path === name); }
    serialize() { return JSON.stringify(this.fields); }
  }
  const write = vi.fn((value: string) => { written = true; if (mode !== "ignore") packet = value; });
  host({ getXMPMetadata: () => mode === "empty-read" && written ? "" : packet, setXMPMetadata: write }, {
    ExternalObject: { AdobeXMPScript: {} }, XMPMeta: Xmp,
    XMPConst: { APPEND_ALL_PROPERTIES: 1, APPEND_REPLACE_OLD_VALUES: 2, ITERATOR_JUST_LEAFNODES: 4 },
    XMPUtils: { appendProperties: (patch: Xmp, target: Xmp) => { for (const field of patch.fields) { target.fields = target.fields.filter(f => f.namespace !== field.namespace || f.path !== field.path); target.fields.push(field); } } },
  });
  return { write, packet: () => JSON.parse(packet) };
}
describe("XMP patch field readback", () => {
  it("checks every supplied leaf including array paths, whitespace and escaped values", async () => {
    const h = xmpHost();
    await expect(metadata.set_xmp_metadata.handler({ item_id: quoted, xmp_xml: "patch" })).resolves.toMatchObject({ success: true, data: { updated: true, verified: true, outcome: "verified", checkedFieldCount: 2 } });
    expect(h.packet()).toContainEqual({ namespace: "urn:other/", path: "other:keep", value: "keep" });
  });
  it("fails when valid XML still contains the old values", async () => {
    xmpHost("ignore");
    await expect(metadata.set_xmp_metadata.handler({ item_id: quoted, xmp_xml: "patch" })).resolves.toMatchObject({ success: false, data: { updated: false, verified: false, outcome: "failed", mismatchedFieldCount: 2 } });
  });
  it.each(["empty-read", "read-throws"])("keeps a completed write unverified on %s", async mode => {
    xmpHost(mode);
    await expect(metadata.set_xmp_metadata.handler({ item_id: quoted, xmp_xml: "patch" })).resolves.toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified" } });
  });
  it.each([0, 257])("refuses %s patch leaves before writing", async count => {
    const h = xmpHost("apply", count);
    await expect(metadata.set_xmp_metadata.handler({ item_id: quoted, xmp_xml: "patch" })).resolves.toMatchObject({ success: false });
    expect(h.write).not.toHaveBeenCalled();
  });
  it("escapes the XML packet without executing its contents", async () => {
    xmpHost("apply", 2, quoted);
    await expect(metadata.set_xmp_metadata.handler({ item_id: quoted, xmp_xml: quoted })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(send.mock.calls[0][0]).toContain('\\"unexpected\\"');
    expect(send.mock.calls[0][0]).not.toContain('throw new Error("unexpected")');
  });
});

describe("workspace and preview return boundaries", () => {
  it("reports workspace acceptance without claiming current-layout verification", async () => {
    const set = vi.fn(() => true); host({}, { app: { setWorkspace: set } });
    await expect(workspace.set_workspace.handler({ name: quoted })).resolves.toMatchObject({ success: true, data: { set: true, workspace: quoted, verified: false, outcome: "committed_unverified" } });
    expect(set).toHaveBeenCalledWith(quoted);
  });
  it("reports a rejected workspace as failed", async () => {
    host({}, { app: { setWorkspace: () => false } });
    await expect(workspace.set_workspace.handler({ name: "missing" })).resolves.toMatchObject({ success: false, data: { verified: false, outcome: "failed" } });
  });
  it("refuses an empty workspace name before dispatch", async () => {
    await expect(workspace.set_workspace.handler({ name: "  " })).resolves.toMatchObject({ success: false }); expect(send).not.toHaveBeenCalled();
  });
  it.each([true, undefined, 0])("does not equate preview return %s with deleted files", async returned => {
    const remove = vi.fn(() => returned); host({}, { app: { enableQE: vi.fn() }, qe: { project: { deletePreviewFiles: remove } } });
    await expect(advanced.delete_preview_files.handler({ media_type: "video" })).resolves.toMatchObject({ success: true, data: { deleted: null, verified: false, outcome: "committed_unverified", mediaType: "video" } });
    expect(remove).toHaveBeenCalledWith("228CDA18-3625-4d2d-951E-348879E4ED93");
  });
  it("reports a false preview return as failure", async () => {
    host({}, { app: { enableQE: vi.fn() }, qe: { project: { deletePreviewFiles: () => false } } });
    await expect(advanced.delete_preview_files.handler({})).resolves.toMatchObject({ success: false, data: { deleted: false, outcome: "failed" } });
  });
  it.each([quoted, "__proto__", ""])("refuses invalid preview media type %s without deleting all", async media_type => {
    await expect(advanced.delete_preview_files.handler({ media_type })).resolves.toMatchObject({ success: false }); expect(send).not.toHaveBeenCalled();
  });
});

describe("Project panel selection", () => {
  it("matches fresh selected wrappers by node ID", async () => {
    const select = vi.fn(); const item = host({ select });
    host(item, { app: { project: { rootItem: { children: collection([item]) } }, getCurrentProjectViewSelection: () => [{ nodeId: quoted }] } });
    await expect(media.select_item.handler({ item_id: quoted })).resolves.toMatchObject({ success: true, data: { selected: true, verified: true, outcome: "verified" } }); expect(select).toHaveBeenCalledOnce();
  });
  it("fails when selection ignored the request", async () => {
    const item = { name: "Temporary", nodeId: quoted, select: vi.fn() };
    host(item, { app: { project: { rootItem: { children: collection([item]) } }, getCurrentProjectViewSelection: () => [] } });
    await expect(media.select_item.handler({ item_id: quoted })).resolves.toMatchObject({ success: false, data: { selected: false, verified: false, outcome: "failed" } });
  });
  it.each([undefined, () => null, () => { throw new Error("no getter"); }, () => [{ nodeId: "" }]])("does not certify unreadable selection", async getter => {
    const item = { nodeId: quoted, name: "Temporary", select: vi.fn() };
    host(item, { app: { project: { rootItem: { children: collection([item]) } }, getCurrentProjectViewSelection: getter } });
    await expect(media.select_item.handler({ item_id: quoted })).resolves.toMatchObject({ success: true, data: { selected: null, verified: false, outcome: "committed_unverified" } });
  });
  it("refuses a missing item before selecting anything", async () => { host({ select: vi.fn() }); await expect(media.select_item.handler({ item_id: "missing" })).resolves.toMatchObject({ success: false }); });
});

describe("audio mapping getter limit", () => {
  it("keeps acceptance explicitly unverified without inventing a channel getter", async () => {
    const set = vi.fn(() => true); host({ getAudioChannelMapping: () => ({ setMappingForChannel: set }) });
    await expect(av.set_project_item_audio_channel_mapping.handler({ item_id: quoted, channel_index: 0, source_channel_index: 1 })).resolves.toMatchObject({ success: true, data: { accepted: true, verified: false, outcome: "committed_unverified", verification: "api-return" } }); expect(set).toHaveBeenCalledWith(0, 1);
  });
  it("fails rejected mapping and rejects invalid indexes before dispatch", async () => {
    host({ getAudioChannelMapping: () => ({ setMappingForChannel: () => false }) });
    await expect(av.set_project_item_audio_channel_mapping.handler({ item_id: quoted, channel_index: 0, source_channel_index: 1 })).resolves.toMatchObject({ success: false, data: { outcome: "failed" } });
    send.mockClear(); await expect(av.set_project_item_audio_channel_mapping.handler({ item_id: quoted, channel_index: -1, source_channel_index: 0 })).resolves.toMatchObject({ success: false }); expect(send).not.toHaveBeenCalled();
  });
});

function volumeHost(kinds: string[]) {
  const clips = kinds.map((kind, i) => {
    let level = 1;
    return { nodeId: `clip-${i}`, name: `Clip ${i}`, components: collection(kind === "missing" ? [] : [{ matchName: "Internal Volume Stereo", displayName: "Volume", properties: collection([{ displayName: "Level", setValue: (value: number) => { if (kind !== "ignore") level = value; return true; }, getValue: () => level }]) }]) };
  });
  host({}, { app: { project: { activeSequence: { audioTracks: Object.assign({ numTracks: 1 }, [{ clips: collection(clips) }]) } } } });
}
describe("batch volume coverage", () => {
  it("verifies only when every requested clip was checked", async () => {
    volumeHost(["apply", "apply"]); await expect(tracks.set_clips_volume.handler({ track_index: 0, volume_db: -3 })).resolves.toMatchObject({ success: true, data: { verified: true, outcome: "verified", checked: 2, skippedClips: [] } });
  });
  it("lists missing controls and keeps partial completion unverified", async () => {
    volumeHost(["apply", "missing"]); await expect(tracks.set_clips_volume.handler({ track_index: 0, volume_db: -3 })).resolves.toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", applied: 1, skipped: 1, skippedClips: [{ clipIndex: 1, nodeId: "clip-1", reason: expect.any(String) }] } });
  });
  it.each([{ kinds: ["missing"] }, { kinds: [] }])("does not verify an empty checked set $kinds", async ({ kinds }) => {
    volumeHost(kinds); await expect(tracks.set_clips_volume.handler({ track_index: 0, volume_db: -3 })).resolves.toMatchObject({ success: false, data: { verified: false, checked: 0, outcome: "failed" } });
  });
  it("reports ignored writes and validates arguments without dispatch", async () => {
    volumeHost(["ignore"]); await expect(tracks.set_clips_volume.handler({ track_index: 0, volume_db: -3 })).resolves.toMatchObject({ success: false, data: { verified: false, mismatched: [{ clipIndex: 0 }] } });
    send.mockClear(); await expect(tracks.set_clips_volume.handler({ track_index: 0, volume_db: NaN })).resolves.toMatchObject({ success: false }); expect(send).not.toHaveBeenCalled();
    await expect(tracks.set_clips_volume.handler({ track_index: 0, volume_db: quoted as never })).resolves.toMatchObject({ success: false }); expect(send).not.toHaveBeenCalled();
  });
});

function mogrtHost(mode = "apply") {
  const clip: any = { nodeId: "graphic", name: "Graphic", start: { ticks: String(2 * ticks) }, end: { ticks: String(7 * ticks) } };
  if (mode === "unreadable") delete clip.start;
  const placed = mode === "wrong-track" ? [[], [clip]] : [[clip], []];
  const seq = { timebase: String(ticks / 25), videoTracks: Object.assign({ numTracks: 2 }, placed.map(clips => ({ clips: collection(clips) }))), importMGT: vi.fn(() => clip) };
  if (mode === "wrong-start") clip.start.ticks = String(3 * ticks);
  if (mode === "malformed-start") clip.start.ticks += "junk";
  if (mode === "whitespace") { clip.start.ticks = "  " + clip.start.ticks + "  "; clip.end.ticks = "  " + clip.end.ticks + "  "; }
  host({}, { app: { project: { activeSequence: seq } } });
  return seq;
}
describe("MOGRT placed geometry", () => {
  it("reports actual start, end, duration and track after import", async () => {
    const seq = mogrtHost();
    await expect(text.import_mogrt.handler({ mogrt_path: quoted, start_seconds: 2, duration_seconds: 5 })).resolves.toMatchObject({ success: true, data: { imported: true, verified: true, outcome: "verified", requestedStartSeconds: 2, startSeconds: 2, endSeconds: 7, durationSeconds: 5, trackIndex: 0 } }); expect(seq.importMGT).toHaveBeenCalledWith(quoted, String(2 * ticks), 0, 0);
  });
  it.each(["wrong-start", "wrong-track"])("exposes %s instead of echoing placement", async mode => {
    mogrtHost(mode); const result: any = await text.import_mogrt.handler({ mogrt_path: "temp.mogrt", start_seconds: 2, duration_seconds: 5 });
    expect(result).toMatchObject({ success: false, data: { imported: true, verified: false, outcome: "failed", requestedStartSeconds: 2 } });
    expect(result.data[mode === "wrong-start" ? "startSeconds" : "trackIndex"]).toBe(mode === "wrong-start" ? 3 : 1);
  });
  it.each(["unreadable", "malformed-start"])("keeps %s placement unverified", async mode => {
    mogrtHost(mode); await expect(text.import_mogrt.handler({ mogrt_path: "temp.mogrt", start_seconds: 2 })).resolves.toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", startSeconds: null } });
  });
  it("accepts whitespace around readable host tick strings", async () => {
    mogrtHost("whitespace"); await expect(text.import_mogrt.handler({ mogrt_path: "temp.mogrt", start_seconds: 2 })).resolves.toMatchObject({ success: true, data: { verified: true, startSeconds: 2, endSeconds: 7 } });
  });
  it.each([{ start_seconds: NaN }, { start_seconds: -1 }, { track_index: -1 }, { track_index: 0.5 }])("refuses invalid placement %s before import", async args => {
    await expect(text.import_mogrt.handler({ mogrt_path: "temp.mogrt", ...args })).resolves.toMatchObject({ success: false }); expect(send).not.toHaveBeenCalled();
  });
});
