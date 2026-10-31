import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { guardToolHandler, resolveCapabilities } from "../../src/security/capabilities.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getCaptionTools } from "../../src/tools/captions.js";

const tool = getCaptionTools({}).create_caption_track;
const formats = ["subtitle", "608", "708", "teletext", "ebu", "op42", "op47"];
const itemId = 'captions"\\\n.srt';
type HostOptions = { before?: unknown; after?: unknown; returned?: boolean; throws?: boolean; countThrows?: boolean; useProperty?: boolean };

function host(options: HostOptions = {}) {
  let attempted = false;
  const item = { nodeId: itemId, name: itemId };
  const getCount = () => {
    if (options.countThrows) throw new Error("Unreadable tracks");
    return attempted ? ("after" in options ? options.after : 1) : ("before" in options ? options.before : 0);
  };
  const create = vi.fn((received: unknown, seconds: number, format: number) => {
    expect(received).toBe(item);
    expect(seconds).toBe(2);
    expect(format).toBeGreaterThan(0);
    attempted = true;
    if (options.throws) throw new Error("Host threw after mutation");
    return options.returned ?? true;
  });
  const sequence = options.useProperty
    ? { createCaptionTrack: create, captionTracks: { get length() { return getCount(); } } }
    : { createCaptionTrack: create, getCaptionTracks: () => ({ numTracks: getCount() }) };
  vi.mocked(sendCommand).mockImplementation(async script => JSON.parse(String(runInNewContext(
    `${getHelpersSource()}\n${script}`,
    { app: { project: { activeSequence: sequence, rootItem: { children: Object.assign([item], { numItems: 1 }) } } },
      Sequence: { CAPTION_FORMAT_SUBTITLE: 1, CAPTION_FORMAT_608: 2, CAPTION_FORMAT_708: 3,
        CAPTION_FORMAT_TELETEXT: 4, CAPTION_FORMAT_OPEN_EBU: 5, CAPTION_FORMAT_OP42: 6, CAPTION_FORMAT_OP47: 7 } },
  ))));
  return create;
}

beforeEach(() => vi.clearAllMocks());

describe("caption import input and readback contract", () => {
  it.each(["unknown", "", "constructor", "__proto__", '"}); app.project.injected = true; //', "subtitle\n", null, 608])(
    "rejects unsupported format %s before sending generated code", async caption_format => {
      host();
      expect(await tool.handler({ item_id: itemId, start_seconds: 2, caption_format: caption_format as string }))
        .toMatchObject({ success: false, error: expect.stringContaining("caption_format") });
      expect(sendCommand).not.toHaveBeenCalled();
    },
  );

  it.each(formats)("imports supported format %s with escaped item identity", async caption_format => {
    const create = host();
    expect(await tool.handler({ item_id: itemId, start_seconds: 2, caption_format }))
      .toMatchObject({ success: true, data: { format: caption_format, verified: true, renderVerified: false, beforeTrackCount: 0, afterTrackCount: 1 } });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("defaults to subtitle and accepts an integer length readback", async () => {
    host({ useProperty: true });
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 }))
      .toMatchObject({ success: true, data: { format: "subtitle", verified: true, outcome: "verified" } });
  });

  it.each([undefined, null, "1", true, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])("never verifies invalid track count %s", async after => {
    host({ after });
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 }))
      .toMatchObject({ success: true, data: { verified: false, outcome: "committed_unverified", afterTrackCount: null } });
  });

  it("never coerces an invalid baseline to zero", async () => {
    host({ before: null, after: 1 });
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 }))
      .toMatchObject({ success: true, data: { verified: false, beforeTrackCount: null, afterTrackCount: 1 } });
  });

  it("never verifies unchanged counts when oversized integers round away the increment", async () => {
    const count = Number.MAX_SAFE_INTEGER + 1;
    expect(count + 1).toBe(count);
    host({ before: count, after: count });
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 }))
      .toMatchObject({ success: true, data: { verified: false, beforeTrackCount: null, afterTrackCount: null } });
  });

  it.each([0, 2])("does not certify unexpected track-count delta %s", async after => {
    host({ after });
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 }))
      .toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", beforeTrackCount: 0, afterTrackCount: after } });
  });

  it.each([{ returned: false }, { throws: true }])("reads back changes despite native failure: %j", async options => {
    const create = host(options);
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 }))
      .toMatchObject({ success: true, data: { created: true, verified: true, outcome: "verified", afterTrackCount: 1 } });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("preserves unknown mutation state when native call and count getter throw", async () => {
    const create = host({ throws: true, countThrows: true });
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 }))
      .toMatchObject({ success: false, data: { verified: false, outcome: "committed_unverified", timelineChanged: null, hostError: "Error: Host threw after mutation" } });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("adds manual styling notes to a successful import receipt", async () => {
    host();
    const result = await tool.handler({ item_id: itemId, start_seconds: 2 });
    expect(result).toMatchObject({ success: true, data: { verified: true, styleApplied: false, renderVerified: false } });
    const styling = (result.data as { styling: string[] }).styling.join(" ");
    expect(styling).toContain("default caption style");
    expect(styling).toContain("Upgrade Caption to Graphic");
    expect(styling).toContain("the MCP cannot run it");
    expect(styling).toContain("Still-frame exports can omit caption tracks");
    expect(tool.description).toContain("Upgrade Caption to Graphic stay manual");
  });

  it("leaves failed import receipts without styling notes", async () => {
    host({ after: 2 });
    const result = await tool.handler({ item_id: itemId, start_seconds: 2 });
    expect(result.success).toBe(false);
    expect(result.data).not.toHaveProperty("styling");
    expect(result.data).not.toHaveProperty("styleApplied");
  });

  it("passes non-object success data through unchanged", async () => {
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: "accepted" });
    expect(await tool.handler({ item_id: itemId, start_seconds: 2 })).toEqual({ success: true, data: "accepted" });
  });

  it("requires edit authority for caption import", async () => {
    const create = host();
    const guarded = guardToolHandler("create_caption_track", tool.handler, resolveCapabilities("inspect"));
    await expect(guarded({ item_id: itemId, start_seconds: 2 })).rejects.toMatchObject({ code: "CAPABILITY_DENIED", capability: "edit" });
    expect(create).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
