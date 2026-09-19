import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMetadataTools } from "../../src/tools/metadata.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5_000 };

async function scriptFor(tool: { handler: (args: any) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  return String(mockedSendCommand.mock.calls[0][0]);
}

beforeEach(() => vi.clearAllMocks());

describe("CEP field-level metadata inspect and update", () => {
  const metadata = getMetadataTools(bridgeOptions);

  it("parses named fields without dumping raw XML by default", async () => {
    const script = await scriptFor(metadata.get_metadata, {
      item_id: "clip-1",
      parse_fields: true,
    });
    expect(script).toContain("parse_fields");
    expect(script).toContain("new XMPMeta");
    expect(script).toContain("iterator");
    expect(script).toContain("omitted: \"sensitive\"");
    expect(script).not.toContain("metadata.projectMetadata =");
    expect(script).not.toContain("metadata.xmpMetadata =");
  });

  it("keeps raw packets available when parse_fields callers opt back in", async () => {
    const script = await scriptFor(metadata.get_metadata, {
      item_id: "clip-1",
      parse_fields: true,
      include_project_metadata: true,
      include_xmp_metadata: true,
    });
    expect(script).toContain("metadata.projectMetadata =");
    expect(script).toContain("metadata.xmpMetadata =");
    expect(script).toContain("new XMPMeta");
  });

  it("writes one XMP packet field with compare-and-set and field readback", async () => {
    const script = await scriptFor(metadata.set_metadata, {
      item_id: "clip-1",
      packet: "xmp",
      field_namespace: "dc",
      field_name: "description",
      value: "Updated clip",
      expected_value: "A clip",
    });
    expect(script).toContain("item.setXMPMetadata");
    expect(script).toContain("expectedValue");
    expect(script).toContain("field_value_readback");
    expect(script).not.toContain("item.setProjectMetadata");
  });
});
