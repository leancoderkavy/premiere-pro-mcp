import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({ sendCommand: vi.fn().mockResolvedValue({ success: true }) }));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getEffectsTools } from "../../src/tools/effects.js";

const mockedSendCommand = vi.mocked(sendCommand);
const tool = getEffectsTools({ tempDir: "/tmp/test" }).inspect_stabilizer_status;

beforeEach(() => vi.clearAllMocks());

describe("inspect_stabilizer_status", () => {
  it("builds a read-only all-clips inspection with an explicit unknown-state boundary", async () => {
    await tool.handler({});
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('requestedNodeId = ""');
    expect(script).toContain("analysisStatus = \"unknown\"");
    expect(script).toContain("unknown is not proof of a completed solve");
    expect(script).not.toContain("setValue(");
    expect(script).not.toContain("addVideoEffect(");
  });

  it("escapes and limits inspection to a requested video clip", async () => {
    await tool.handler({ node_id: 'clip"1' });
    const script = mockedSendCommand.mock.calls[0][0];
    expect(script).toContain('requestedNodeId = "clip\\\"1"');
    expect(script).toContain("__findClip(requestedNodeId)");
    expect(script).toContain('found.trackType !== "video"');
  });
});
