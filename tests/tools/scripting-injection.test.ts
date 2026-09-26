import { beforeEach, describe, expect, it, vi } from "vitest";
import { getScriptingTools } from "../../src/tools/scripting.js";
import { escapeForExtendScript } from "../../src/bridge/script-builder.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand, sendRawCommand } from "../../src/bridge/file-bridge.js";

const mockedSendCommand = vi.mocked(sendCommand);
const mockedSendRawCommand = vi.mocked(sendRawCommand);
const tools = getScriptingTools({ tempDir: "/tmp/scripting-injection", timeoutMs: 5000 });

beforeEach(() => {
  mockedSendCommand.mockClear();
  mockedSendRawCommand.mockClear();
});

describe("inspect_dom_object refuses arbitrary ExtendScript", () => {
  it("rejects function calls that would close the project under an inspect tool", async () => {
    await expect(tools.inspect_dom_object.handler({
      object_path: "app.project.closeDocument()",
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Function calls"),
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
    expect(mockedSendRawCommand).not.toHaveBeenCalled();
  });

  it("rejects statements and sendRawCommand-only payloads such as System.callSystem", async () => {
    await expect(tools.inspect_dom_object.handler({
      object_path: 'app.project.activeSequence; System.callSystem("rm -rf /")',
    })).resolves.toMatchObject({ success: false });
    await expect(tools.inspect_dom_object.handler({
      object_path: "eval('app.project.closeDocument()')",
    })).resolves.toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
    expect(mockedSendRawCommand).not.toHaveBeenCalled();
  });

  it("walks a documented property path through sendCommand, not sendRawCommand", async () => {
    const path = "app.project.activeSequence.videoTracks[0].clips[0]";
    await expect(tools.inspect_dom_object.handler({ object_path: path }))
      .resolves.toMatchObject({ success: true });
    expect(mockedSendRawCommand).not.toHaveBeenCalled();
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    expect(String(mockedSendCommand.mock.calls[0][0])).toContain(`var obj = ${path};`);
  });
});

describe("get_sequence_structure escapes sequence_id", () => {
  it("does not break out of the __findSequence string when sequence_id contains quotes", async () => {
    const payload = 'x"); app.project.closeDocument(); void("';
    await expect(tools.get_sequence_structure.handler({ sequence_id: payload }))
      .resolves.toMatchObject({ success: true });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
    const script = String(mockedSendCommand.mock.calls[0][0]);
    expect(script).toContain(`__findSequence("${escapeForExtendScript(payload)}")`);
    expect(script).not.toContain(`__findSequence("${payload}")`);
  });
});
