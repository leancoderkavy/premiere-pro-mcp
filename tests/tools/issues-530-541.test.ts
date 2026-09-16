import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { getExportTools } from "../../src/tools/export.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getUxpTools } from "../../src/tools/uxp.js";
import claudeDesktopManifest from "../../claude-desktop/manifest.json";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/issue-fixes", timeoutMs: 5000 };
const temporaryDirectories: string[] = [];

function temporaryPreset(): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-ame-preset-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "delivery.epr");
  writeFileSync(path, "<preset />");
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    } catch {
      // Windows can leave a locked temp dir after the test already observed the script.
    }
  }
});

async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalled();
  return mockedSendCommand.mock.calls[0][0] as string;
}

describe("issue #530 — Claude Desktop UXP token is optional for CEP-only setups", () => {
  it("does not require a Premiere UXP token in the Claude Desktop bundle", () => {
    expect(claudeDesktopManifest.user_config.premiere_uxp_token).toMatchObject({
      type: "string",
      sensitive: true,
      required: false,
    });
    expect(claudeDesktopManifest.user_config.premiere_uxp_token.description).toMatch(/CEP/i);
    expect(claudeDesktopManifest.user_config.premiere_uxp_token.description).toMatch(/UXP Plugins/i);
  });
});

describe("issue #536 — first transcript import can omit the revision", () => {
  it("treats an omitted or null expected_transcript_revision as the untranscribed path", async () => {
    const request = vi.fn().mockResolvedValue({ committed: true, verified: true });
    const tool = getUxpTools({ request, getState: vi.fn() } as unknown as UxpWebSocketBridge).import_transcript_uxp;
    expect(tool.parameters.required).not.toContain("expected_transcript_revision");

    await expect(tool.handler({
      project_item_id: "clip-1",
      project_guid: "project-1",
      replacement_transcript_json: '{"segments":[]}',
      confirm_destructive: true,
      operation_id: "transcript-first-1",
    } as never)).resolves.toMatchObject({ success: true });
    expect(request).toHaveBeenLastCalledWith("transcript.import", expect.objectContaining({
      expectedTranscriptRevision: null,
    }));

    await tool.handler({
      project_item_id: "clip-1",
      project_guid: "project-1",
      expected_transcript_revision: "null",
      replacement_transcript_json: '{"segments":[]}',
      confirm_destructive: true,
      operation_id: "transcript-first-2",
    } as never);
    expect(request).toHaveBeenLastCalledWith("transcript.import", expect.objectContaining({
      expectedTranscriptRevision: null,
    }));
  });
});

describe("issue #537 — MOGRT JSON values survive MCP schema validation", () => {
  it("accepts object-shaped MOGRT values and writes them as JSON strings", async () => {
    const keyframes = getKeyframeTools(bridgeOptions);
    expect(keyframes.set_effect_property.parameters.properties.value.type).toEqual(
      expect.arrayContaining(["number", "string", "boolean", "array", "object"]),
    );
    const script = await scriptFor(keyframes.set_effect_property, {
      node_id: "clip-1",
      effect_name: "Graphic Parameters",
      property_name: "Text Source",
      value: { textEditValue: "Hello" },
    });
    expect(script).toContain('var requestedValue = "{\\"textEditValue\\":\\"Hello\\"}"');
  });
});

describe("issue #539 — list_markers does not throw on a timeline clip", () => {
  it("guards a missing clip marker collection and names the supported paths", async () => {
    const script = await scriptFor(getMarkerTools(bridgeOptions).list_markers, { node_id: "timeline-clip-1" });
    expect(script).toContain("clipResult.clip.markers");
    expect(script).toContain("clipResult.clip.projectItem");
    expect(script).toContain("does not expose a marker collection");
    expect(script).toContain("typeof markers.getFirstMarker !== \"function\"");
  });
});

describe("issue #541 — import_fcp_xml does not treat an empty folder as verified", () => {
  it("requires the destination to be a file Premiere actually opened", async () => {
    const script = await scriptFor(getProjectTools(bridgeOptions).import_fcp_xml, {
      path: "/tmp/cut.xml",
      project_path: "/tmp/dest.prproj",
    });
    expect(script).toContain("new Folder(\"/tmp/dest.prproj\")");
    expect(script).toContain("exists as a directory");
    expect(script).toContain("openedMatches");
    expect(script).toContain("verified: destExistsAsFile && openedMatches");
  });
});

describe("issue #535 — AME handoff requires a preset and a saved project", () => {
  it("rejects add_to_render_queue without preset_path before calling Premiere", async () => {
    mockedSendCommand.mockClear();
    const result = await getExportTools(bridgeOptions).add_to_render_queue.handler({
      output_path: "/tmp/out.mp4",
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("preset_path") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("refuses Same as Project presets before calling Premiere", async () => {
    mockedSendCommand.mockClear();
    const directory = mkdtempSync(join(tmpdir(), "premiere-ame-preset-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "same-as-project.epr");
    writeFileSync(path, "<Exporter Dest=\"SameAsProject\" />");
    const result = await getExportTools(bridgeOptions).add_to_render_queue.handler({
      output_path: "/tmp/out.mp4",
      preset_path: path,
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Same as Project") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("refuses AME handoff when the Premiere project has no saved path", async () => {
    const script = await scriptFor(getExportTools(bridgeOptions).add_to_render_queue, {
      output_path: "/tmp/out.mp4",
      preset_path: temporaryPreset(),
    });
    expect(script).toContain("Save the Premiere project");
    expect(script).toContain("Same as Project");
    expect(script).not.toContain("ENCODE_MATCH_SEQUENCE");
  });
});
