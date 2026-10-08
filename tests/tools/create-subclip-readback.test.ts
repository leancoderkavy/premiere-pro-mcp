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

/** A source item whose createSubClip returns a subclip exposing the given project metadata. */
function host(metadata: (() => string) | null) {
  const calls: unknown[][] = [];
  const subclip: Record<string, unknown> = { nodeId: "sub-9", name: "" };
  if (metadata) subclip.getProjectMetadata = metadata;
  const item = {
    nodeId: "src-1", name: "Interview.mov", type: 1,
    createSubClip(...args: unknown[]) { calls.push(args); subclip.name = args[0]; return subclip; },
  };
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
  it("returns the new nodeId and verifies a range within one media frame", async () => {
    const calls = host(() => packet("00:00:02:00", "00:00:03:23", FRAME_23976));
    const result = await run({ item_id: "src-1", name: 'Take "A" \\ 1', in_seconds: 2, out_seconds: 4 });
    expect(calls[0]).toEqual(['Take "A" \\ 1', String(2 * TICKS), String(4 * TICKS), 0, 1, 1]);
    expect(result).toMatchObject({
      success: true,
      data: { created: true, nodeId: "sub-9", name: 'Take "A" \\ 1', source: "Interview.mov", requestedInSeconds: 2, requestedOutSeconds: 4, outcome: "verified", verified: true, observedInTimecode: "00:00:02:00", observedOutTimecode: "00:00:03:23" },
    });
    // 48 frames in; the Out timecode names the last frame, so the range ends after frame 95.
    expect(result.data?.observedInSeconds).toBeCloseTo(48 * FRAME_23976 / TICKS, 9);
    expect(result.data?.observedOutSeconds).toBeCloseTo(96 * FRAME_23976 / TICKS, 9);
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
    expect(result.data?.note).toContain("more than one media frame");
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
