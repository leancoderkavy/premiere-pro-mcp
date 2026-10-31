import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import type { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getExportTools } from "../../src/tools/export.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tools = getExportTools({ tempDir: "/tmp/create-subclip", timeoutMs: 5000 } as BridgeOptions);
const TICKS = 254016000000;
const FRAME_23976 = 10594584000;
const FRAME_2997 = 8475667200;
const FRAME_25 = 10160640000;
const FRAME_24 = 10584000000;
const SAMPLE_48K = 5292000;
const MICROSECOND = 254016;
type Result = { success: boolean; error?: string; data?: Record<string, any> };

beforeEach(() => vi.clearAllMocks());

function point(column: string, timecode: string, frameTicks: number) {
  return `<premierePrivateProjectMetaData:Column.Intrinsic.${column} rdf:parseType="Resource">`
    + `<rdf:value>${timecode}</rdf:value>`
    + `<premierePrivateProjectMetaData:frame_rate>${frameTicks}</premierePrivateProjectMetaData:frame_rate>`
    + `</premierePrivateProjectMetaData:Column.Intrinsic.${column}>`;
}

function packet(inTimecode: string, outTimecode: string, frameTicks: number) {
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta><rdf:RDF><rdf:Description>`
    + `<premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>${frameTicks}</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>`
    + point("VideoInPoint", inTimecode, frameTicks)
    + point("VideoOutPoint", outTimecode, frameTicks)
    + `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

/**
 * A source item whose createSubClip returns a subclip exposing the given project metadata. `source`
 * gives the source item a footage frame rate and project metadata, as Premiere does; without it the
 * source exposes neither and the write grid is unknown.
 */
function host(metadata: (() => string) | null, source?: { frameRate: number; metadata?: string }) {
  const calls: unknown[][] = [];
  const subclip: Record<string, unknown> = { nodeId: "sub-9", name: "" };
  if (metadata) subclip.getProjectMetadata = metadata;
  const item: Record<string, unknown> = {
    nodeId: "src-1", name: "Interview.mov", type: 1,
    createSubClip(...args: unknown[]) { calls.push(args); subclip.name = args[0]; return subclip; },
  };
  if (source) {
    item.getFootageInterpretation = () => ({ frameRate: source.frameRate });
    item.getProjectMetadata = () => source.metadata ?? "";
  }
  const context = {
    $: { global: {} },
    app: { project: { rootItem: { children: { numItems: 1, 0: item } } } },
  };
  mockedSendCommand.mockImplementation(async (script: string) =>
    JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, context))));
  return calls;
}

const run = (args: Record<string, unknown>) => tools.create_subclip.handler(args as never) as Promise<Result>;

describe("create_subclip reads the stored range back", () => {
  it("returns the new nodeId and verifies a range within half a media frame", async () => {
    const calls = host(() => packet("00:00:02:00", "00:00:03:23", FRAME_23976));
    const result = await run({ item_id: "src-1", name: 'Take "A" \\ 1', in_seconds: 2, out_seconds: 4 });
    // No readable source rate: each point is sent one microsecond past the request.
    expect(calls[0]).toEqual(['Take "A" \\ 1', String(2 * TICKS + MICROSECOND), String(4 * TICKS + MICROSECOND), 0, 1, 1]);
    expect(result).toMatchObject({
      success: true,
      data: { created: true, nodeId: "sub-9", name: 'Take "A" \\ 1', source: "Interview.mov", requestedInSeconds: 2, requestedOutSeconds: 4, outcome: "verified", verified: true, observedInTimecode: "00:00:02:00", observedOutTimecode: "00:00:03:23" },
    });
    // 48 frames in; the Out timecode names the last frame, so the range ends after frame 95.
    expect(result.data?.observedInSeconds).toBeCloseTo(48 * FRAME_23976 / TICKS, 9);
    expect(result.data?.observedOutSeconds).toBeCloseTo(96 * FRAME_23976 / TICKS, 9);
  });

  it("reads an audio-only subclip's range from its Audio points and sample timebase", async () => {
    // Live 26.5.2: Video points are empty, Audio points count samples, and their frame_rate is 25 fps display.
    const audio = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta><rdf:RDF><rdf:Description>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>48000 Hz</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint rdf:parseType="Resource"><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint rdf:parseType="Resource"><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint>`
      + point("AudioInPoint", "00:00:01:00048", FRAME_25)
      + point("AudioOutPoint", "00:00:04:00191", FRAME_25)
      + `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    host(() => audio);
    const result = await run({ item_id: "src-1", name: "Tone", in_seconds: 1.001, out_seconds: 4.004 });
    expect(result.data).toMatchObject({ outcome: "verified", verified: true, observedInTimecode: "00:00:01:00048", observedOutTimecode: "00:00:04:00191" });
    expect(result.data?.observedInSeconds).toBeCloseTo(1.001, 9);
    expect(result.data?.observedOutSeconds).toBeCloseTo(4.004, 9);
    host(() => audio.replace("48000 Hz", "25"));
    expect((await run({ item_id: "src-1", name: "Tone", in_seconds: 1.001, out_seconds: 4.004 })).data).toMatchObject({ outcome: "committed_unverified", verified: false });
  });

  it("subtracts the media start timecode a BWF WAV carries before comparing", async () => {
    // Live 26.5.2: an Envato WAV with bext time_reference 405000 at 44.1 kHz starts at 9.1837 s, so a
    // subclip from the file's first sample stores 00:00:09:08100 and every point's offset child holds
    // that start in ticks; the stored range is still 0-13.667 s of the file.
    const startTicks = 2332800000000;
    const withOffset = (column: string, timecode: string) => point(column, timecode, FRAME_25)
      .replace("</rdf:value>", `</rdf:value><premierePrivateProjectMetaData:offset>${startTicks}</premierePrivateProjectMetaData:offset>`);
    const audio = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta><rdf:RDF><rdf:Description>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>44100 Hz</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.MediaStart>00:00:09:08100</premierePrivateProjectMetaData:Column.Intrinsic.MediaStart>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint rdf:parseType="Resource"><rdf:value/><premierePrivateProjectMetaData:offset>${startTicks}</premierePrivateProjectMetaData:offset></premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint rdf:parseType="Resource"><rdf:value/><premierePrivateProjectMetaData:offset>${startTicks}</premierePrivateProjectMetaData:offset></premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint>`
      + withOffset("AudioInPoint", "00:00:09:08100")
      + withOffset("AudioOutPoint", "00:00:22:37499")
      + `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    host(() => audio);
    const result = await run({ item_id: "src-1", name: "M intro", in_seconds: 0, out_seconds: 41 / 3 });
    expect(result.data).toMatchObject({ outcome: "verified", verified: true, observedInTimecode: "00:00:09:08100", observedOutTimecode: "00:00:22:37499" });
    expect(result.data?.observedInSeconds).toBeCloseTo(0, 6);
    expect(result.data?.observedOutSeconds).toBeCloseTo(41 / 3, 4);
    expect(result.data?.mediaStartSeconds).toBeCloseTo(405000 / 44100, 6);
  });

  it("reads a camera clip that starts at 01:00:00:00 relative to the file", async () => {
    const hour = String(3600 * TICKS);
    const camera = packet("01:00:02:00", "01:00:03:24", FRAME_25)
      .replace(/<\/rdf:value>/g, `</rdf:value><premierePrivateProjectMetaData:offset>${hour}</premierePrivateProjectMetaData:offset>`);
    host(() => camera);
    const result = await run({ item_id: "src-1", name: "Cam", in_seconds: 2, out_seconds: 4 });
    expect(result.data).toMatchObject({ outcome: "verified", verified: true, observedInSeconds: 2, mediaStartSeconds: 3600 });
    expect(result.data?.observedOutSeconds).toBeCloseTo(4, 9);
    // Without a media start the receipt carries no mediaStartSeconds.
    host(() => packet("00:00:02:00", "00:00:03:24", FRAME_25));
    expect((await run({ item_id: "src-1", name: "Cam", in_seconds: 2, out_seconds: 4 })).data).not.toHaveProperty("mediaStartSeconds");
  });

  it("sends each point a quarter frame past the nearest media frame so Premiere's floor lands on it", async () => {
    // Live 26.5.2, 24 fps CFR MP4: an In of 1826.8333333 s sent as exact ticks stored 1826.7916667 s.
    const calls = host(() => packet("00:30:26:20", "00:30:29:23", FRAME_24), { frameRate: 24 });
    const result = await run({ item_id: "src-1", name: "Long", in_seconds: 1826.8333333, out_seconds: 1830 });
    expect(Number(calls[0][1]) / FRAME_24).toBeCloseTo(43844.25, 9);
    expect(Number(calls[0][2]) / FRAME_24).toBeCloseTo(43920.25, 9);
    expect(calls[0][1]).toBe(String(Math.round(43844.25 * FRAME_24)));
    expect(result.data).toMatchObject({ outcome: "verified", verified: true, requestedInSeconds: 1826.8333333 });
    expect(result.data?.observedInSeconds).toBeCloseTo(43844 / 24, 9);
    // The script calls the bias helper, and the helper source kept its regex escapes.
    const script = String(mockedSendCommand.mock.calls[0][0]);
    expect(script).toContain("__subclipWriteTicks(requestedInSeconds, sourceGridTicks)");
    expect(script).toContain("__subclipWriteTicks(requestedOutSeconds, sourceGridTicks)");
    expect(getHelpersSource()).toContain("/Column\\.Intrinsic\\.MediaTimebase[^>]*>\\s*([0-9]+(?:\\.[0-9]+)?)\\s*Hz\\s*</i");
  });

  it("uses the exact NTSC frame and snaps a between-frames request to the nearest frame", async () => {
    let calls = host(() => packet("00:00:02:00", "00:00:03:23", FRAME_23976), { frameRate: 23.976 });
    await run({ item_id: "src-1", name: "NTSC", in_seconds: 2, out_seconds: 4 });
    expect(calls[0][1]).toBe(String(Math.round(48.25 * FRAME_23976)));
    expect(calls[0][2]).toBe(String(Math.round(96.25 * FRAME_23976)));
    // 2.03 s is frame 48.72 at 24 fps: the nearest frame is 49, half a frame or less from the request.
    calls = host(() => packet("00:00:02:01", "00:00:02:23", FRAME_24), { frameRate: 24 });
    const result = await run({ item_id: "src-1", name: "Near", in_seconds: 2.03, out_seconds: 3 });
    expect(calls[0][1]).toBe(String(49.25 * FRAME_24));
    expect(result.data).toMatchObject({ outcome: "verified", verified: true });
  });

  it("keeps one frame when a short range snaps both points to the same frame", async () => {
    const calls = host(() => packet("00:00:01:00", "00:00:01:00", FRAME_24), { frameRate: 24 });
    await run({ item_id: "src-1", name: "Blink", in_seconds: 1, out_seconds: 1.01 });
    expect(Number(calls[0][2]) - Number(calls[0][1])).toBe(FRAME_24);
  });

  it.each([
    ["In", "00:30:26:19", "00:30:29:23"],
    ["Out", "00:30:26:20", "00:30:29:22"],
  ])("reports a whole-frame %s miss as committed_unverified with the requested and observed values", async (_point, inTimecode, outTimecode) => {
    host(() => packet(inTimecode, outTimecode, FRAME_24), { frameRate: 24 });
    const result = await run({ item_id: "src-1", name: "Miss", in_seconds: 1826.8333333, out_seconds: 1830 });
    expect(result).toMatchObject({ success: true, data: { created: true, outcome: "committed_unverified", verified: false, requestedInSeconds: 1826.8333333, requestedOutSeconds: 1830, observedInTimecode: inTimecode, observedOutTimecode: outTimecode } });
    expect(result.data?.note).toContain("more than half a media frame");
    if (_point === "In") expect(result.data?.observedInSeconds).toBeCloseTo(1826.7916667, 6);
    else expect(result.data?.observedOutSeconds).toBeCloseTo(1830 - 1 / 24, 9);
  });

  describe("48 kHz audio-only source", () => {
    const source = {
      frameRate: 2.75404699046078e-8,
      metadata: "<premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase> 48000 Hz </premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>",
    };
    const wav = (outTimecode: string) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta><rdf:RDF><rdf:Description>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>48000 Hz</premierePrivateProjectMetaData:Column.Intrinsic.MediaTimebase>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint rdf:parseType="Resource"><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoInPoint>`
      + `<premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint rdf:parseType="Resource"><rdf:value/></premierePrivateProjectMetaData:Column.Intrinsic.VideoOutPoint>`
      + point("AudioInPoint", "00:00:00:00000", FRAME_25)
      + point("AudioOutPoint", outTimecode, FRAME_25)
      + `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

    it("sends a quarter sample past the exact sample, never reaching the next one", async () => {
      // 1237.3333333 s is sample 59,392,000 (to 7 decimals); its last sample is 00:20:37:15999.
      const calls = host(() => wav("00:20:37:15999"), source);
      const result = await run({ item_id: "src-1", name: "Cue", in_seconds: 0, out_seconds: 1237.3333333 });
      expect(calls[0][1]).toBe(String(0.25 * SAMPLE_48K));
      expect(calls[0][2]).toBe(String(59392000.25 * SAMPLE_48K));
      expect(Number(calls[0][2])).toBeLessThan(59392001 * SAMPLE_48K);
      expect(result.data).toMatchObject({ outcome: "verified", verified: true });
      expect(result.data?.observedOutSeconds).toBeCloseTo(1237.3333333, 6);
    });

    it("reports an Out stored one sample low as committed_unverified", async () => {
      // Live 26.5.2: the Out stored 1237.3333125 s, one sample short of 1237.3333333 s.
      host(() => wav("00:20:37:15998"), source);
      const result = await run({ item_id: "src-1", name: "Cue", in_seconds: 0, out_seconds: 1237.3333333 });
      expect(result.data).toMatchObject({ outcome: "committed_unverified", verified: false, requestedOutSeconds: 1237.3333333 });
      expect(result.data?.observedOutSeconds).toBeCloseTo(1237.3333125, 9);
    });

    it("falls back to a one-microsecond bias when the sample rate is unreadable", async () => {
      const calls = host(() => wav("00:20:37:15999"), { frameRate: source.frameRate });
      await run({ item_id: "src-1", name: "Cue", in_seconds: 0, out_seconds: 2 });
      expect(calls[0].slice(1, 3)).toEqual([String(MICROSECOND), String(2 * TICKS + MICROSECOND)]);
    });
  });

  it("counts drop-frame timecode at 29.97", async () => {
    host(() => packet("00;01;00;02", "00;01;01;01", FRAME_2997));
    const result = await run({ item_id: "src-1", name: "DF", in_seconds: 60.06, out_seconds: 61.06 });
    expect(result.data).toMatchObject({ outcome: "verified", verified: true });
    expect(result.data?.observedInSeconds).toBeCloseTo(1800 * FRAME_2997 / TICKS, 9);
    expect(result.data?.observedOutSeconds).toBeCloseTo(1830 * FRAME_2997 / TICKS, 9);
  });

  it("reports committed_unverified when Premiere stored the whole media instead of the request", async () => {
    host(() => packet("00:00:00:00", "00:00:09:24", FRAME_25));
    const result = await run({ item_id: "src-1", name: "Whole", in_seconds: 2, out_seconds: 4 });
    expect(result).toMatchObject({ success: true, data: { outcome: "committed_unverified", verified: false, observedInSeconds: 0, requestedInSeconds: 2, requestedOutSeconds: 4 } });
    expect(result.data?.observedOutSeconds).toBeCloseTo(10, 9);
    expect(result.data?.note).toContain("more than half a media frame");
  });

  it.each([
    ["throws", () => { throw new Error("no metadata"); }],
    ["has no range columns", () => "<x:xmpmeta></x:xmpmeta>"],
    ["has no frame rate", () => packet("00:00:02:00", "00:00:03:23", FRAME_25).replace(/<premierePrivateProjectMetaData:frame_rate>\d+<\/premierePrivateProjectMetaData:frame_rate>/g, "")],
  ])("stays committed_unverified with a note when the metadata %s", async (_label, metadata) => {
    host(metadata);
    const result = await run({ item_id: "src-1", name: "S", in_seconds: 2, out_seconds: 4 });
    expect(result).toMatchObject({ success: true, data: { created: true, nodeId: "sub-9", outcome: "committed_unverified", verified: false, observedInSeconds: null, observedOutSeconds: null } });
    expect(result.data?.note).toContain("could not be read");
  });

  it("stays committed_unverified when the subclip exposes no getProjectMetadata", async () => {
    host(null);
    await expect(run({ item_id: "src-1", name: "S", in_seconds: 2, out_seconds: 4 }))
      .resolves.toMatchObject({ success: true, data: { outcome: "committed_unverified", nodeId: "sub-9" } });
  });

  it.each([
    { in_seconds: 4, out_seconds: 2 },
    { in_seconds: -1, out_seconds: 2 },
    { in_seconds: Number.NaN, out_seconds: 2 },
  ])("rejects an invalid range %j before contacting Premiere", async (range) => {
    await expect(run({ item_id: "src-1", name: "S", ...range })).resolves.toMatchObject({ success: false, error: expect.stringContaining("out_seconds") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});
