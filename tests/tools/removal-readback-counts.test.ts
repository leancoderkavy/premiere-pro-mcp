import { runInNewContext } from "node:vm";
import { parse } from "acorn";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getHelpersSource } from "../../src/bridge/script-builder.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";

describe("removal absence requires readable collections", () => {
  it.each([undefined, NaN, -1, 0.5, "0"])("does not verify an unreadable remaining clip count %s", async count => {
    const clips: any = { numItems: 1 };
    const clip = { nodeId: 'target"\\id', name: "Target", remove() { delete clips[0]; clips.numItems = count; } };
    clips[0] = clip;
    const seq = { videoTracks: { numTracks: 1, 0: { clips, isLocked: () => false } }, audioTracks: { numTracks: 0 } };
    vi.mocked(sendCommand).mockImplementation(async script => {
      const source = getHelpersSource() + "\n" + script;
      parse(source, { ecmaVersion: 3, allowReserved: "never" });
      return JSON.parse(String(runInNewContext(source, { app: { project: { activeSequence: seq } } })));
    });
    const result = await getTimelineTools({}).remove_from_timeline.handler({ node_id: clip.nodeId, include_linked: false });
    expect(result.success).toBe(false);
    expect(mutationReceipt(result.success, result.data, { dispatched: true }, "remove_from_timeline").outcome).not.toBe("verified");
  });
});
