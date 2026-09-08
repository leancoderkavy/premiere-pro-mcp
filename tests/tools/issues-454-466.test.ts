import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getExportTools } from "../../src/tools/export.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getUxpAdvancedWorkflowTools } from "../../src/tools/uxp-advanced-workflows.js";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5_000 };

const advanced = getAdvancedTools(bridgeOptions);
const exports_ = getExportTools(bridgeOptions);
const keyframes = getKeyframeTools(bridgeOptions);
const project = getProjectTools(bridgeOptions);
const sequence = getSequenceTools(bridgeOptions);
const trackTargeting = getTrackTargetingTools(bridgeOptions);

async function scriptFor(tool: { handler: (args: any) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  return String(mockedSendCommand.mock.calls[0][0]);
}

beforeEach(() => vi.clearAllMocks());

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/457
describe("issue #457 — roll_edit must move source in/out with the visible cut", () => {
  it("writes the matching outPoint and inPoint alongside the rolled edges", async () => {
    const script = await scriptFor(advanced.roll_edit, { node_id: "clip-1", offset_seconds: 1 });

    expect(script).toContain("result.clip.outPoint = expectedOut;");
    expect(script).toContain("outgoing.inPoint = expectedIncomingIn;");
    expect(script).toContain("var expectedOut = String(Math.round(parseFloat(beforeOut) + offsetTicks));");
  });

  it("fails when the source in/out metadata does not follow the visible cut", async () => {
    const script = await scriptFor(advanced.roll_edit, { node_id: "clip-1", offset_seconds: 1 });

    expect(script).toContain("afterOut !== expectedOut || afterIncomingIn !== expectedIncomingIn");
    expect(script).toContain("the source in/out metadata did not follow");
    expect(script).toContain('verification: "timeline_edge_and_source_in_out_readback"');
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/458
describe("issue #458 — import_fcp_xml supplies both openFCPXML arguments", () => {
  it("requires the destination project path openFCPXML needs", async () => {
    expect(project.import_fcp_xml.parameters.required).toEqual(["path", "project_path"]);

    const result = await project.import_fcp_xml.handler({ path: "/tmp/edit.xml", project_path: "  " });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("Not Enough Parameters") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("passes both paths and verifies the destination project exists afterwards", async () => {
    const script = await scriptFor(project.import_fcp_xml, {
      path: "/tmp/edit.xml",
      project_path: "/tmp/imported.prproj",
    });

    expect(script).toContain('app.openFCPXML("/tmp/edit.xml", "/tmp/imported.prproj");');
    expect(script).toContain('var xmlFile = new File("/tmp/edit.xml");');
    expect(script).toContain("if (!xmlFile.exists)");
    expect(script).toContain("A project already exists at /tmp/imported.prproj");
    expect(script).toContain("verified: destinationFile.exists");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/460
describe("issue #460 — attach_custom_property verifies the XMP packet", () => {
  it("reads the sequence project item XMP on both sides of the write", async () => {
    const script = await scriptFor(sequence.attach_custom_property, {
      property_id: "spot-code",
      property_value: "ABC-123",
    });

    expect(script).toContain("var beforePacket");
    expect(script).toContain("var afterPacket");
    expect(script).toContain('afterPacket === beforePacket || afterPacket.indexOf("ABC-123") === -1');
    expect(script).toContain("the sequence XMP packet does not contain the property value");
    expect(script).toContain('verification: "sequence_project_item_xmp_readback"');
  });

  it("rejects an empty property id or value before touching the bridge", async () => {
    await expect(sequence.attach_custom_property.handler({ property_id: " ", property_value: "x" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("property_id") });
    await expect(sequence.attach_custom_property.handler({ property_id: "x", property_value: "" }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("property_value") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/462
describe("issue #462 — undo and redo fail closed like multiple_undo", () => {
  it("does not call app.project.undo, which is not a function on current builds", async () => {
    const result = await project.undo.handler({});

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("app.project.undo is not a function"),
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("validates count before reporting the capability gap", async () => {
    await expect(project.undo.handler({ count: 0 }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("count must be an integer") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("never reports an unverifiable redo success", async () => {
    const result = await trackTargeting.redo.handler({});

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("no supported redo API"),
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/463
describe("issue #463 — set_effect_property handles 2D vector properties", () => {
  it("accepts an array value for Position and Anchor Point", async () => {
    expect(keyframes.set_effect_property.parameters.properties.value.type)
      .toEqual(["number", "string", "boolean", "array"]);

    const script = await scriptFor(keyframes.set_effect_property, {
      node_id: "clip-1",
      effect_name: "Motion",
      property_name: "Position",
      value: [0.25, 0.75],
    });

    expect(script).toContain("var requestedValue = [0.25, 0.75];");
    expect(script).toContain("prop.setValue(requestedValue, true)");
  });

  it("compares an array readback component by component rather than with ===", async () => {
    const script = await scriptFor(keyframes.set_effect_property, {
      node_id: "clip-1",
      effect_name: "Motion",
      property_name: "Anchor Point",
      value: [10, 20],
    });

    expect(script).toContain("function __sameParameterValue(actual, expected)");
    expect(script).toContain("readbackVerified: readbackAvailable && __sameParameterValue(readbackValue, requestedValue)");
    expect(script).not.toContain("readbackValue === requestedValue");
  });

  it("rejects malformed vector values locally", async () => {
    await expect(keyframes.set_effect_property.handler({
      node_id: "clip-1", effect_name: "Motion", property_name: "Position", value: [],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("1 to 4 numbers") });

    await expect(keyframes.set_effect_property.handler({
      node_id: "clip-1", effect_name: "Motion", property_name: "Position", value: [1, Number.NaN],
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("finite number") });

    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/464
describe("issue #464 — import_ae_comps verifies the file and the bin", () => {
  it("checks the .aep exists before importing all comps", async () => {
    const script = await scriptFor(project.import_ae_comps, { ae_project_path: "/tmp/titles.aep" });

    expect(script).toContain('var aeFile = new File("/tmp/titles.aep");');
    expect(script).toContain("if (!aeFile.exists)");
    expect(script).toContain("var beforeItems = targetBin.children.numItems;");
    expect(script).toContain("if (addedItems <= 0)");
    expect(script).toContain("app.project.importAllAEComps(");
  });

  it("checks the named-comp path the same way", async () => {
    const script = await scriptFor(project.import_ae_comps, {
      ae_project_path: "/tmp/titles.aep",
      comp_names: ["Lower Third"],
    });

    expect(script).toContain('app.project.importAEComps("/tmp/titles.aep", ["Lower Third"], targetBin);');
    expect(script).toContain("if (addedItems <= 0)");
    expect(script).toContain("the target bin gained no items");
  });

  it("rejects an empty path before touching the bridge", async () => {
    await expect(project.import_ae_comps.handler({ ae_project_path: "   " }))
      .resolves.toMatchObject({ success: false, error: expect.stringContaining("ae_project_path") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/465
describe("issue #465 — add_tracks reports the QE index-0 track shift", () => {
  it("fingerprints every existing track and locates it again afterwards", async () => {
    const script = await scriptFor(advanced.add_tracks, { video_tracks: 1 });

    expect(script).toContain("function __trackFingerprints(collection)");
    expect(script).toContain("function __offsetOfExistingTracks(before, after, added)");
    expect(script).toContain("var beforeVideoFingerprints = __trackFingerprints(seq.videoTracks);");
    expect(script).toContain("var beforeAudioFingerprints = __trackFingerprints(seq.audioTracks);");
  });

  it("surfaces the shift instead of leaving a correct total count to imply success", async () => {
    const script = await scriptFor(advanced.add_tracks, { video_tracks: 2, audio_tracks: 1 });

    expect(script).toContain("newTracksInsertedAtStart: videoShifted || audioShifted");
    expect(script).toContain("existingVideoTracksShiftedBy");
    expect(script).toContain("existingAudioTracksShiftedBy");
    expect(script).toContain("shifted every pre-existing track up");
    expect(script).toContain("verified: !existingTracksUnlocatable");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/466
describe("issue #466 — get_render_queue_status fails closed on a missing host API", () => {
  it("never reports an \"unknown\" string as a queue state", async () => {
    const script = await scriptFor(exports_.get_render_queue_status, {});

    expect(script).not.toContain('"unknown"');
    expect(script).toContain('typeof encoder.isRunning !== "function"');
    expect(script).toContain("does not expose app.encoder.isRunning");
    expect(script).toContain('typeof isRunning !== "boolean"');
    expect(script).toContain('source: "app.encoder.isRunning"');
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/459
describe("issue #459 — manage_sequences_uxp forwards only each action's own parameters", () => {
  const request = vi.fn().mockResolvedValue({ ok: true });
  const bridge = { request, getState: () => ({ connected: true, authenticated: true }) } as unknown as UxpWebSocketBridge;
  const tools = getUxpAdvancedWorkflowTools(bridge) as Record<string, {
    handler: (args: any) => Promise<any>;
  }>;

  beforeEach(() => request.mockClear());

  it("sends a documented sequence_id through for the actions that take one", async () => {
    await tools.manage_sequences_uxp.handler({ action: "clone", sequence_id: "sequence-guid-1" });

    expect(request).toHaveBeenCalledWith("sequences.clone", { sequenceId: "sequence-guid-1" });
  });

  it("sends the create_from_media parameters without leaking clone-only fields", async () => {
    await tools.manage_sequences_uxp.handler({
      action: "create_from_media",
      name: "Cutdown",
      project_item_ids: ["item-1"],
      confirm_non_undoable: true,
      operation_id: "op-1",
    });

    expect(request).toHaveBeenCalledWith("sequences.createFromMedia", {
      name: "Cutdown",
      projectItemIds: ["item-1"],
      confirmNonUndoable: true,
      operationId: "op-1",
    });
  });

  it("explains that inspect takes no target instead of letting the host reject it", async () => {
    const result = await tools.manage_sequences_uxp.handler({
      action: "inspect",
      sequence_id: "sequence-guid-1",
    });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("takes no other parameters") });
    expect(result.error).toContain("sequence_id");
    expect(request).not.toHaveBeenCalled();
  });

  it("names the accepted parameters when an action is given one it does not take", async () => {
    const result = await tools.manage_sequences_uxp.handler({
      action: "clone",
      sequence_id: "sequence-guid-1",
      name: "Cutdown",
    });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("does not accept name") });
    expect(result.error).toContain("It accepts: sequence_id, operation_id");
    expect(request).not.toHaveBeenCalled();
  });
});
