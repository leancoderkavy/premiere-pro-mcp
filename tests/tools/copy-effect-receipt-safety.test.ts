import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn() }));
import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { mutationReceipt } from "../../src/workflows/mutation-receipt.js";
const send = vi.mocked(sendCommand);
const tool = getClipboardTools({ tempDir: "/tmp/copy-receipt", timeoutMs: 1000 }).copy_effects_between_clips;
beforeEach(() => vi.clearAllMocks());

describe("effect-copy receipt safety", () => {
  const cases = [
    [{ verified: false }, "committed_unverified"],
    [{ mutationOutcome: "unknown" }, "unknown"],
    [{ outcome: "unknown" }, "unknown"],
    [{ outcome: "committed_unverified" }, "committed_unverified"],
    [{ recoveryRequired: true }, "unknown"],
    [{ stateUnknown: true }, "unknown"],
  ] as const;
  it.each(cases)("preserves underlying safety evidence %j", async (evidence, expected) => {
    send.mockResolvedValueOnce({ success: true, data: { names: ["Gaussian Blur"], source: "Source", target: "Target" } } as never)
      .mockResolvedValueOnce({ success: true, data: { status: "verified", summary: { verified: 2 }, ...evidence } } as never);
    const result = await tool.handler({ source_node_id: "source", target_node_id: "target" });
    expect(result).toMatchObject({ success: true, data: { ...evidence, verified: false, valuesCopied: false, copiedEffects: 0, copied: [] } });
    expect(mutationReceipt(result.success, result.data, { dispatched: true }, "copy_effects_between_clips").outcome).toBe(expected);
  });
});
