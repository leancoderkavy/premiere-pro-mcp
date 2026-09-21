import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { getHelpersSource } from "../../src/bridge/script-builder.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getDiscoveryTools } from "../../src/tools/discovery.js";
import { getHealthTools } from "../../src/tools/health.js";
import { getMetadataTools } from "../../src/tools/metadata.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { EXTENDSCRIPT_REFERENCE } from "../../src/resources/extendscript-reference.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5_000 };

async function scriptFor(tool: { handler: (args: any) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args);
  expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  return String(mockedSendCommand.mock.calls[0][0]);
}

beforeEach(() => vi.clearAllMocks());

describe("project-item source range units", () => {
  it("passes seconds to both setters and still verifies tick readback", async () => {
    const tool = getTrackTargetingTools(bridgeOptions).set_item_in_out;
    const script = await scriptFor(tool, { item_id: "media", in_seconds: 1.5, out_seconds: 5.25 });
    class MockTime {
      seconds = 0;
      get ticks() { return String(Math.round(this.seconds * 254016000000)); }
    }
    const inPoint = new MockTime();
    const outPoint = new MockTime();
    const item = {
      nodeId: "media", name: "Media",
      setInPoint: vi.fn((seconds: number) => { inPoint.seconds = seconds; }),
      setOutPoint: vi.fn((seconds: number) => { outPoint.seconds = seconds; }),
      getInPoint: () => inPoint,
      getOutPoint: () => outPoint,
    };
    const result = JSON.parse(runInNewContext(getHelpersSource() + "\n" + script, {
      Time: MockTime,
      app: { project: { rootItem: { children: { 0: item, numItems: 1 } } } },
    }));
    expect(item.setInPoint).toHaveBeenCalledWith(1.5, 4);
    expect(item.setOutPoint).toHaveBeenCalledWith(5.25, 4);
    expect(result).toMatchObject({ success: true, data: { verified: true, inSet: true, outSet: true } });
  });

  it("advertises non-negative in/out seconds and requires at least one field", () => {
    const tool = getSourceMonitorTools(bridgeOptions).set_source_in_out;
    expect(tool.parameters.properties.in_seconds).toMatchObject({ type: "number", minimum: 0 });
    expect(tool.parameters.properties.out_seconds).toMatchObject({ type: "number", minimum: 0 });
    expect(tool.parameters.anyOf).toEqual([
      { required: ["in_seconds"] },
      { required: ["out_seconds"] },
    ]);
  });

  it.each([
    ["an empty object", {}],
    ["a negative in point", { in_seconds: -1 }],
    ["a negative out point", { out_seconds: -0.25 }],
  ])("rejects %s without contacting Premiere", async (_label, args) => {
    const tool = getSourceMonitorTools(bridgeOptions).set_source_in_out;
    const result = await tool.handler(args);
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/in_seconds|out_seconds/) });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("passes seconds from the Source Monitor tool and still verifies tick readback", async () => {
    const tool = getSourceMonitorTools(bridgeOptions).set_source_in_out;
    const script = await scriptFor(tool, { in_seconds: 1.5, out_seconds: 5.25 });
    expect(script).not.toContain("setInPoint(inTime.ticks");
    expect(script).not.toContain("setOutPoint(outTime.ticks");
    class MockTime {
      seconds = 0;
      get ticks() { return String(Math.round(this.seconds * 254016000000)); }
    }
    const inPoint = new MockTime();
    const outPoint = new MockTime();
    const item = {
      name: "Media",
      setInPoint: vi.fn((seconds: number) => { inPoint.seconds = seconds; }),
      setOutPoint: vi.fn((seconds: number) => { outPoint.seconds = seconds; }),
      getInPoint: () => inPoint,
      getOutPoint: () => outPoint,
    };
    const result = JSON.parse(runInNewContext(getHelpersSource() + "\n" + script, {
      Time: MockTime,
      app: { sourceMonitor: { getProjectItem: () => item } },
    }));
    expect(item.setInPoint).toHaveBeenCalledWith(1.5, 4);
    expect(item.setOutPoint).toHaveBeenCalledWith(5.25, 4);
    expect(result).toMatchObject({ success: true, data: { verified: true, inSet: true, outSet: true } });
  });

  it("restores original marks when Source Monitor setter readback mismatches", async () => {
    const tool = getSourceMonitorTools(bridgeOptions).set_source_in_out;
    const script = await scriptFor(tool, { in_seconds: 1.5, out_seconds: 5.25 });
    class MockTime {
      seconds = 0;
      get ticks() { return String(Math.round(this.seconds * 254016000000)); }
    }
    const inPoint = new MockTime();
    inPoint.seconds = 0.25;
    const outPoint = new MockTime();
    outPoint.seconds = 8;
    const item = {
      name: "Media",
      setInPoint: vi.fn((seconds: number) => {
        inPoint.seconds = item.setInPoint.mock.calls.length === 1 ? 9.99 : seconds;
      }),
      setOutPoint: vi.fn((seconds: number) => { outPoint.seconds = seconds; }),
      getInPoint: () => inPoint,
      getOutPoint: () => outPoint,
    };
    const result = JSON.parse(runInNewContext(getHelpersSource() + "\n" + script, {
      Time: MockTime,
      app: { sourceMonitor: { getProjectItem: () => item } },
    }));
    expect(item.setInPoint).toHaveBeenNthCalledWith(1, 1.5, 4);
    expect(item.setInPoint).toHaveBeenNthCalledWith(2, 0.25, 4);
    expect(item.setOutPoint).toHaveBeenCalledWith(8, 4);
    expect(item.setOutPoint).not.toHaveBeenCalledWith(5.25, 4);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Original marks were restored"),
    });
  });

  it("restores original marks when the Source Monitor out-point setter throws", async () => {
    const tool = getSourceMonitorTools(bridgeOptions).set_source_in_out;
    const script = await scriptFor(tool, { in_seconds: 1.5, out_seconds: 5.25 });
    class MockTime {
      seconds = 0;
      get ticks() { return String(Math.round(this.seconds * 254016000000)); }
    }
    const inPoint = new MockTime();
    inPoint.seconds = 0.25;
    const outPoint = new MockTime();
    outPoint.seconds = 8;
    const item = {
      name: "Media",
      setInPoint: vi.fn((seconds: number) => { inPoint.seconds = seconds; }),
      setOutPoint: vi.fn((seconds: number) => {
        if (seconds === 5.25) throw new Error("host rejected out");
        outPoint.seconds = seconds;
      }),
      getInPoint: () => inPoint,
      getOutPoint: () => outPoint,
    };
    const result = JSON.parse(runInNewContext(getHelpersSource() + "\n" + script, {
      Time: MockTime,
      app: { sourceMonitor: { getProjectItem: () => item } },
    }));
    expect(item.setInPoint).toHaveBeenNthCalledWith(1, 1.5, 4);
    expect(item.setInPoint).toHaveBeenNthCalledWith(2, 0.25, 4);
    expect(item.setOutPoint).toHaveBeenNthCalledWith(1, 5.25, 4);
    expect(item.setOutPoint).toHaveBeenNthCalledWith(2, 8, 4);
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Original marks were restored"),
    });
  });

  it("documents ProjectItem in/out setters as seconds", () => {
    expect(EXTENDSCRIPT_REFERENCE).toContain("item.setInPoint(seconds, mediaType)");
    expect(EXTENDSCRIPT_REFERENCE).toContain("item.setOutPoint(seconds, mediaType)");
    expect(EXTENDSCRIPT_REFERENCE).not.toContain("item.setInPoint(ticks, mediaType)");
    expect(EXTENDSCRIPT_REFERENCE).not.toContain("item.setOutPoint(ticks, mediaType)");
  });
});

describe("issue #239 — metadata writes require a readback-capable payload", () => {
  const metadata = getMetadataTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);

  it("turns field/value writes into a complete XMP property update with field readback", async () => {
    const script = await scriptFor(metadata.set_metadata, {
      item_id: "clip-1",
      field_name: "Column.Intrinsic.LogNote",
      value: "unique value",
    });

    expect(script).toContain("new XMPMeta");
    expect(script).toContain("setProperty");
    expect(script).toContain("item.setProjectMetadata");
    expect(script).toContain("field_value_readback");
    expect(script).not.toContain("partial field_name/value");
  });

  it("rejects mixing a complete XML payload with field/value arguments", async () => {
    const result = await metadata.set_metadata.handler({
      item_id: "clip-1",
      field_name: "Column.Intrinsic.LogNote",
      value: "unique value",
      metadata_xml: "<xmpmeta />",
      updated_fields: ["Column.Intrinsic.LogNote"],
    });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("cannot combine") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("writes complete Project Metadata XML only with field paths and exact readback", async () => {
    const script = await scriptFor(metadata.set_metadata, {
      item_id: "clip-1",
      metadata_xml: "<xmpmeta><Description>unique value</Description></xmpmeta>",
      updated_fields: ["Column.Intrinsic.Description"],
    });

    expect(script).toContain("item.setProjectMetadata(requestedMetadata, updatedFields)");
    expect(script).toContain("String(readback) !== requestedMetadata");
    expect(script).toContain("verified: true");
  });

  it("verifies project-panel metadata and labels schema creation as non-value-writing", async () => {
    const panelScript = await scriptFor(project.set_project_panel_metadata, { metadata_xml: "<columns />" });
    expect(panelScript).toContain("app.project.getProjectPanelMetadata()");
    expect(panelScript).toContain("String(readback) !== requestedMetadata");

    const schemaScript = await scriptFor(project.add_custom_metadata_field, {
      field_name: "ReviewStatus", field_label: "Review Status", field_type: 2,
    });
    expect(schemaScript).toContain("outcome: \"committed_unverified\"");
    expect(schemaScript).toContain("perItemValue");
  });
});

describe("issue #240 — legacy structural tools verify or refuse the operation", () => {
  const utility = getUtilityTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);
  const sequence = getSequenceTools(bridgeOptions);

  it("uses documented bin/sequence deletion paths and checks target absence", async () => {
    const itemScript = await scriptFor(utility.delete_project_item, { item_id: "item-1" });
    expect(itemScript).not.toContain("deleteProjectItem(");
    expect(itemScript).toContain("item.deleteBin()");
    expect(itemScript).toContain("app.project.deleteSequence(sequence)");
    expect(itemScript).toContain("if (__findProjectItem(nodeId))");

    const manyScript = await scriptFor(utility.delete_multiple_project_items, { item_ids: ["item-1", "item-2"] });
    expect(manyScript).toContain("No project items were deleted");
    expect(manyScript).toContain("The batch is not reported as successful");

    const binScript = await scriptFor(project.delete_bin, { bin_id: "bin-1" });
    expect(binScript).toContain("if (__findProjectItem(nodeId))");

    const sequenceScript = await scriptFor(sequence.delete_sequence, { sequence_id: "sequence-1" });
    expect(sequenceScript).toContain("var seq = __findSequence");
    expect(sequenceScript).toContain("if (__findSequence(sequenceId))");
  });

  it("does not misrepresent createSubsequence as timeline nesting", async () => {
    const subsequenceScript = await scriptFor(sequence.create_subsequence, {});
    expect(subsequenceScript).toContain("nested: false");
    expect(subsequenceScript).toContain("The source timeline selection is intentionally unchanged");
    expect(subsequenceScript).toContain("before[newId] === true");
    expect(subsequenceScript).not.toContain("before.indexOf");

    mockedSendCommand.mockClear();
    const result = await utility.nest_clips.handler({ name: "Verified nest" });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("does not replace the original clips") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it.each(["new", "existing", "missing"])("verifies a %s subsequence without ES5 Array.indexOf", async (outcome) => {
    const script = await scriptFor(sequence.create_subsequence, {});
    const original = { sequenceID: "original", name: "Original" };
    const created = { sequenceID: "created", name: "Created" };
    const sequences: any = { 0: original, numSequences: 1 };
    const activeSequence = Object.assign(original, {
      createSubsequence: () => {
        if (outcome === "existing") return original;
        if (outcome === "new") {
          sequences[1] = created;
          sequences.numSequences = 2;
        }
        return created;
      },
    });
    const result = JSON.parse(runInNewContext(
      "Array.prototype.indexOf = undefined;\n" + getHelpersSource() + "\n" + script,
      { app: { project: { activeSequence, sequences } } },
    ));
    expect(result.success).toBe(outcome === "new");
    if (outcome === "new") expect(result.data).toMatchObject({ created: true, verified: true, id: "created" });
    else expect(result.error).toContain("newly created subsequence");
  });

  it("refuses a linked A/V unnest before it can leave an audio reference behind", async () => {
    const script = await scriptFor(sequence.unnest_sequence, { node_id: "nested-clip" });
    expect(script).toContain("collectLinkedReferences(seq.videoTracks, \"video\")");
    expect(script).toContain("collectLinkedReferences(seq.audioTracks, \"audio\")");
    expect(script).toContain("linkedReferences.length !== 1");
    expect(script).toContain("No clips were changed");
  });
});

describe("issue #241 — sequence rates use Time durations and readback", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("converts a requested audio Hz value to ticks per sample and verifies it", async () => {
    const script = await scriptFor(utility.set_sequence_audio_settings, { sample_rate: 48_000 });
    expect(script).toContain("TICKS_PER_SECOND / requestedSampleRate");
    expect(script).toContain("var sampleDuration = new Time()");
    expect(script).toContain("settings.audioSampleRate = sampleDuration");
    expect(script).toContain("Math.abs(appliedTicksPerSample - requestedTicksPerSample) > 1");
    expect(script).not.toContain("settings.audioSampleRate = 48000");
  });

  it("rejects unsafe audio-rate inputs without contacting Premiere", async () => {
    const result = await utility.set_sequence_audio_settings.handler({ sample_rate: 0 });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("between 1 and 768000") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("issue #242 — stale active sequences are not surfaced or trusted", () => {
  const discovery = getDiscoveryTools(bridgeOptions);
  const health = getHealthTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);

  it("defines one current-project active-sequence guard", () => {
    const helpers = getHelpersSource();
    expect(helpers).toContain("function __isCurrentProjectSequence(sequence)");
    expect(helpers).toContain("function __getCurrentActiveSequence()");
  });

  it("uses the guard in project info, active-sequence inspection, and ping", async () => {
    const projectInfo = await scriptFor(discovery.get_project_info, {});
    expect(projectInfo).toContain("var activeSeq = __getCurrentActiveSequence()");

    const activeSequence = await scriptFor(discovery.get_active_sequence, {});
    expect(activeSequence).toContain("var seq = __getCurrentActiveSequence()");
    expect(activeSequence).toContain("No active sequence in the current project");

    const ping = await scriptFor(health.ping, {});
    expect(ping).toContain("var activeSequence = app.project ? __getCurrentActiveSequence() : null");
  });

  it("verifies project creation and sequence activation before reporting success", async () => {
    const create = await scriptFor(project.create_project, { path: "/tmp/New project.prproj" });
    expect(create).toContain("project.sequences.numSequences === 0 && active");
    expect(create).toContain("activeSequence: active ?");

    const activate = await scriptFor(project.set_active_sequence, { sequence_id: "sequence-1" });
    expect(activate).toContain("String(active.sequenceID) !== String(seq.sequenceID)");
    expect(activate).toContain("verified: true");
  });
});

describe("issue #243 — copy_effect_values refuses unsafe Blend Mode writes", () => {
  const clipboard = getClipboardTools(bridgeOptions);

  it("does not copy Blend Mode through the generic enum setter and verifies every copied scalar", async () => {
    const script = await scriptFor(clipboard.copy_effect_values, {
      source_node_id: "source-clip", target_node_id: "target-clip", effect_name: "Opacity",
    });

    expect(script).toContain('srcProp.displayName === "Blend Mode"');
    expect(script).toContain("Legacy CEP enum writes can corrupt Blend Mode; no write was attempted.");
    expect(script).toContain("var readback = tgtComp.properties[q].getValue(0, 0)");
    expect(script).toContain("Effect-value copy was not fully verified");
  });
});
