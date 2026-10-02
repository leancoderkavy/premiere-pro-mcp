import { beforeEach, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getAudioTools } from "../../src/tools/audio.js";
import { sendCommand } from "../../src/bridge/file-bridge.js";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
const send = vi.mocked(sendCommand);
const tools = getAudioTools({ tempDir: "/tmp/audio-audit", timeoutMs: 5000 });
beforeEach(() => vi.resetAllMocks());
function muteHost(mode = "ok") {
  let state = false;
  let writes = 0;
  const track = { name: "Dialogue", isMuted() {
    if (mode === "unknown" || (mode === "unreadable" && writes)) return "unknown";
    return state;
  }, setMute: vi.fn((value) => {
    writes++;
    if (mode !== "noop") state = !!value;
    if (mode === "throw") throw Error("host failed after write");
  }) };
  send.mockImplementation(async (script) => JSON.parse(String(runInNewContext(getHelpersSource() + script, {
    app: { project: { activeSequence: { audioTracks: { 0: track, numTracks: 1 } } } },
  }))));
  return track;
}
it("reads mute and unmute back", async () => {
  muteHost();
  for (const muted of [true, false]) expect(await tools.mute_track.handler({ track_index: 0, muted })).toMatchObject({ success: true, data: { muted, verified: true, outcome: "verified" } });
});
it.each(["noop", "unreadable", "throw"])("does not claim mute success on %s", async (mode) => {
  const track = muteHost(mode);
  const result = await tools.mute_track.handler({ track_index: 0, muted: true });
  expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified" } });
  if (mode === "throw") expect(result).toMatchObject({ data: { timelineChanged: true } });
  expect(track.setMute).toHaveBeenCalledTimes(1);
});
it("refuses unknown pre-state without mutation", async () => {
  const track = muteHost("unknown");
  expect(await tools.mute_track.handler({ track_index: 0, muted: true })).toMatchObject({ success: false });
  expect(track.setMute).not.toHaveBeenCalled();
});
it.each([-1, 0.5, NaN, Infinity])("rejects index %s before dispatch", async (track_index) => {
  expect(await tools.mute_track.handler({ track_index, muted: true })).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
});
it("refuses out-of-range tracks and nonboolean mute", async () => {
  const track = muteHost();
  expect(await tools.mute_track.handler({ track_index: 2, muted: true })).toMatchObject({ success: false });
  expect(track.setMute).not.toHaveBeenCalled();
  send.mockClear();
  expect(await tools.mute_track.handler({ track_index: 0, muted: "false" as never })).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
});

function levelHost(mode = "ok") {
  let value = 0.5;
  let writes = 0;
  const prop = { displayName: "Level", getValue() {
    if (mode === "unreadable" && writes) throw Error("read failed");
    if (mode === "nullBefore") return null;
    if (mode === "booleanAfter" && writes) return true;
    return value;
  }, setValue: vi.fn((v) => {
    writes++;
    if (mode !== "noop") value = v;
    if (mode === "throw") throw Error("write failed");
  }) };
  const clip = { name: "Audio", nodeId: 'a"\\\u2028', components: { numItems: 1, 0: { displayName: "Volume", properties: { numItems: 1, 0: prop } } } };
  send.mockImplementation(async (script) => JSON.parse(String(runInNewContext(getHelpersSource() + script, {
    app: { project: { activeSequence: { videoTracks: { numTracks: 0 }, audioTracks: { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } } } } },
  }))));
  return { prop, id: clip.nodeId };
}
it("verifies static Level and escapes the node ID", async () => {
  const h = levelHost();
  expect(await tools.adjust_audio_levels.handler({ node_id: h.id, level_db: -6 })).toMatchObject({ success: true, data: { verified: true, outcome: "verified", levelDb: -6 } });
  expect(h.prop.setValue).toHaveBeenCalledWith(Math.pow(10, -21 / 20), true);
  expect(send.mock.calls[0][0]).toContain('\\u2028');
});
it.each(["noop", "throw", "unreadable"])("reports static Level uncertainty on %s", async (mode) => {
  const h = levelHost(mode);
  const result = await tools.adjust_audio_levels.handler({ node_id: h.id, level_db: -6 });
  expect(result).toMatchObject({ success: false, data: { outcome: "committed_unverified" } });
  if (mode === "throw") expect(result).toMatchObject({ data: { timelineChanged: true } });
});
it.each([NaN, Infinity, 16, -1e300])("refuses unrepresentable level %s", async (level_db) => {
  expect(await tools.adjust_audio_levels.handler({ node_id: "a", level_db })).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
});
it("refuses a null pre-write Level without mutation", async () => {
  const h = levelHost("nullBefore");
  expect(await tools.adjust_audio_levels.handler({ node_id: h.id, level_db: 0 })).toMatchObject({ success: false });
  expect(h.prop.setValue).not.toHaveBeenCalled();
});
it("does not coerce boolean readback into verified +15 dB", async () => {
  const h = levelHost("booleanAfter");
  expect(await tools.adjust_audio_levels.handler({ node_id: h.id, level_db: 15 })).toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", normalizedLevel: null } });
});
