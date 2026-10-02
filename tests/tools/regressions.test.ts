import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runInNewContext } from "node:vm";
import { escapeForExtendScript, getHelpersSource } from "../../src/bridge/script-builder.js";
import { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/tools/media-evidence.js", () => ({ probeMediaDurationTicks: vi.fn().mockResolvedValue(3600 * 254016000000) }));

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "/fixture/source.mp4" } }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getExportTools } from "../../src/tools/export.js";
import { getUtilityTools } from "../../src/tools/utility.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";
import { getEffectsTools } from "../../src/tools/effects.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getTextTools } from "../../src/tools/text.js";
import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getCaptionTools } from "../../src/tools/captions.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getPlayheadTools } from "../../src/tools/playhead.js";
import { getAudioTools } from "../../src/tools/audio.js";
import { getCompetitorGapTools } from "../../src/tools/competitor-gaps.js";

const mockedSendCommand = vi.mocked(sendCommand);
const bridgeOptions: BridgeOptions = { tempDir: "/tmp/test-bridge", timeoutMs: 5000 };
const temporaryDirectories: string[] = [];

function temporaryPreset(): string {
  const directory = mkdtempSync(join(tmpdir(), "premiere-ame-preset-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "preset.epr");
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

/** Run a tool handler and return the ExtendScript it generated. */
async function scriptFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  mockedSendCommand.mockClear();
  await tool.handler(args as never);
  expect(mockedSendCommand).toHaveBeenCalled();
  return mockedSendCommand.mock.calls.at(-1)[0] as string; // SEC #712: trim/slip send evidence+script
}

/**
 * Same, with comments removed. The helpers name the broken APIs in prose to explain
 * why they're avoided ("ProjectItem has no createProxy()"), so an assertion that a
 * method is never *called* has to look at code only.
 */
async function codeFor(tool: { handler: (args: never) => Promise<unknown> }, args: unknown) {
  const script = await scriptFor(tool, args);
  return script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

async function executePixelAspectRatioScript(sequence: unknown, ratio = "1.4222") {
  const utility = getUtilityTools(bridgeOptions);
  const script = await scriptFor(utility.set_sequence_pixel_aspect_ratio, { ratio });
  return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
    app: { project: { activeSequence: sequence } },
  })));
}

beforeEach(() => { vi.clearAllMocks(); mockedSendCommand.mockResolvedValue({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "/fixture/source.mp4" } }); });

describe("real-host social sequence regressions", () => {
  // #691: QE's newSequence silently ignores forward-slash preset paths on
  // Windows, so the handler must hand the host native separators and give a
  // missing file its own precise error.
  it("normalizes forward-slash preset_path to native separators before the QE call", async () => {
    const realFile = join(process.cwd(), "package.json");
    const forwardSlashed = realFile.split(sep).join("/");
    const script = await scriptFor(sequence.create_sequence_from_preset, { name: "PresetPathTest", preset_path: forwardSlashed });
    expect(script).toContain(escapeForExtendScript(resolve(forwardSlashed)));
    if (process.platform === "win32") {
      // en Windows los separadores nativos difieren del original: el script no
      // debe llevar el path forward-slashed (falla silenciosa de QE, #691)
      expect(script).not.toContain(escapeForExtendScript(forwardSlashed));
    }
  });

  it("create_sequence also normalizes preset_path and reports missing files (#714)", async () => {
    const forwardReal = join(process.cwd(), "package.json").split(sep).join("/");
    const script = await scriptFor(sequence.create_sequence, { name: "Create714", preset_path: forwardReal });
    expect(script).toContain(escapeForExtendScript(resolve(forwardReal)));
    await expect(sequence.create_sequence.handler({ name: "X", preset_path: "C:/no/such.sqpreset" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Preset file not found") });
  });

  it("reports a missing preset file precisely instead of a bare QE failure", async () => {
    await expect(sequence.create_sequence_from_preset.handler({
      name: "PresetPathTest",
      preset_path: join(process.cwd(), "no-such-dir", "no-such-preset.sqpreset"),
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Preset file not found") });
  });

  const sequence = getSequenceTools(bridgeOptions);
  const playhead = getPlayheadTools(bridgeOptions);
  const utility = getUtilityTools(bridgeOptions);

  it("calls Auto Reframe with its required five arguments and reports the derivative", async () => {
    const script = await scriptFor(sequence.auto_reframe_sequence, {
      sequence_id: "source-1",
      target_width: 1080,
      target_height: 1920,
      motion_preset: "faster",
      new_name: "TikTok Test",
    });
    expect(script).toContain('seq.autoReframeSequence(9, 16, "faster", newName, false)');
    expect(script).toContain("if (!reframed) return __error");
    expect(script).toContain("id: reframed.sequenceID");
  });

  it("resizes the reframed sequence to the requested frame (live 25.2: 9:16 of 1080p came out 607x1080)", async () => {
    const run = async (accept: boolean) => {
      const settings = { videoFrameWidth: 607, videoFrameHeight: 1080 };
      const reframed = {
        name: "Vertical",
        sequenceID: "v-1",
        frameSizeHorizontal: 607,
        frameSizeVertical: 1080,
        getSettings: () => ({ ...settings }),
        setSettings: (next: typeof settings) => { if (accept) Object.assign(settings, next); },
      };
      const script = await scriptFor(sequence.auto_reframe_sequence, { target_width: 1080, target_height: 1920, new_name: "Vertical" });
      const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
        app: { project: { activeSequence: { name: "Recap", autoReframeSequence: () => reframed } } },
      })));
      return { result, settings };
    };
    const ok = await run(true);
    expect(ok.result).toMatchObject({
      success: true,
      data: { width: 1080, height: 1920, premiereFrameSize: "607x1080", resizedToRequest: true, verified: true },
    });
    expect(ok.settings).toEqual({ videoFrameWidth: 1080, videoFrameHeight: 1920 });
    await expect(run(false)).resolves.toMatchObject({
      result: { success: false, error: expect.stringContaining("did not accept the requested 1080x1920"), data: { id: "v-1" } },
    });
  });

  it("sets and reads sequence in/out points in seconds with verification", async () => {
    const setScript = await scriptFor(playhead.set_sequence_in_out_points, { in_seconds: 0, out_seconds: 60 });
    expect(setScript).toContain("seq.setInPoint(0)");
    expect(setScript).toContain("seq.setOutPoint(60)");
    expect(setScript).not.toContain("__secondsToTicks(60)");
    expect(setScript).toContain("Math.abs(observedOut - 60)");

    const getScript = await scriptFor(playhead.get_sequence_in_out_points, {});
    expect(getScript).toContain("__sequencePointSeconds(seq.getOutPoint())");
    expect(getScript).not.toContain("__ticksToSeconds(seq.getOutPoint())");
  });

  it("uses documented DOM work-area accessors instead of unavailable properties and method names", async () => {
    const workArea = await codeFor(playhead.get_work_area, {});
    expect(workArea).toContain("seq.getWorkAreaInPoint()");
    expect(workArea).toContain("seq.getWorkAreaOutPoint()");
    expect(workArea).not.toContain("seq.workInPoint");
    expect(workArea).not.toContain("seq.workOutPoint");
    expect(workArea).toContain("inSeconds: __workAreaSeconds(inPoint)");
    expect(workArea).not.toContain("__ticksToSeconds(inPoint)");

    const setArea = await codeFor(playhead.set_work_area, { in_seconds: 4, out_seconds: 12 });
    expect(setArea).toContain("seq.setWorkAreaInPoint(requestedIn)");
    expect(setArea).not.toContain("__secondsToTicks(4)");
    expect(setArea).toContain("Premiere did not apply the work area");
    expect(setArea).toContain("verified: true");

    const enabled = await codeFor(sequence.is_work_area_enabled, {});
    expect(enabled).toContain("seq.isWorkAreaEnabled()");
    expect(enabled).not.toContain("seq.isWorkAreaBarEnabled()");
  });

  it("matches a sequence through projectItem.nodeId and verifies both names", async () => {
    const script = await scriptFor(utility.rename_project_item, { item_id: "item-1", new_name: "Instagram Test" });
    expect(script).toContain("candidate.projectItem.nodeId === item.nodeId");
    expect(script).toContain('sequence.name = "Instagram Test"');
    expect(script).toContain("sequence && sequence.name !==");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/6
describe("issue #6 — markers must use seconds, not ticks", () => {
  const markers = getMarkerTools(bridgeOptions);

  it("add_marker passes seconds straight to createMarker", async () => {
    const script = await scriptFor(markers.add_marker, { time_seconds: 2.0 });

    expect(script).toContain("createMarker(2)");
    // The old bug: __secondsToTicks(2) -> 508032000000 handed to createMarker(),
    // placing the marker ~508 billion seconds down the timeline.
    expect(script).not.toContain("__secondsToTicks(2).toString()");
    expect(script).not.toMatch(/createMarker\(parseFloat/);
  });

  it("add_marker sets marker.end in seconds when given a duration", async () => {
    const script = await scriptFor(markers.add_marker, { time_seconds: 2.0, duration_seconds: 3.0 });

    expect(script).toContain("marker.end = 5");
    expect(script).not.toMatch(/marker\.end = __secondsToTicks/);
  });

  it("list_markers reads Time.seconds rather than re-converting ticks", async () => {
    const script = await scriptFor(markers.list_markers, {});

    expect(script).toContain("startSeconds: marker.start.seconds");
    expect(script).toContain("endSeconds: marker.end.seconds");
    expect(script).not.toContain("__ticksToSeconds(marker.start.ticks)");
  });

  it("delete_marker still compares ticks against ticks", async () => {
    // This path was always correct — both sides are ticks. Guard it so the #6
    // fix doesn't get over-applied here.
    const script = await scriptFor(markers.delete_marker, { time_seconds: 2.0 });

    expect(script).toContain("__secondsToTicks(2)");
    expect(script).toContain("marker.start.ticks");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/7
describe("issue #7 — no calls to nonexistent ExtendScript methods", () => {
  const exportTools = getExportTools(bridgeOptions);
  const trackTargeting = getTrackTargetingTools(bridgeOptions);

  it("manage_proxies never calls ProjectItem.createProxy()", async () => {
    const code = await codeFor(exportTools.manage_proxies, {
      item_id: "clip1",
      action: "create",
      output_path: "/tmp/proxy.mov",
      preset_path: "/tmp/proxy.epr",
    });

    // ProjectItem has no createProxy(); proxies must go through Media Encoder.
    expect(code).not.toContain("createProxy");
    expect(code).toContain("encodeProjectItem");
  });

  it("manage_proxies 'create' refuses to report false success without an output path", async () => {
    const script = await scriptFor(exportTools.manage_proxies, { item_id: "clip1", action: "create" });

    expect(script).toContain("output_path is required");
    expect(script).not.toContain("Proxy creation started");
  });

  it("manage_proxies 'toggle' flips Premiere's app-level proxy setting and reads it back (live: app.project.isProxyEnabled is not a function)", async () => {
    let enabled = 0;
    const script = await scriptFor(exportTools.manage_proxies, { item_id: "clip1", action: "toggle" });
    const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: {
        project: { rootItem: { children: { numItems: 1, 0: { nodeId: "clip1", name: "Clip", type: 1 } } } },
        getEnableProxies: () => enabled,
        setEnableProxies: (value: number) => { enabled = value; },
      },
    })));
    expect(result).toMatchObject({ success: true, data: { proxiesEnabled: true, verified: true } });
    expect(enabled).toBe(1);
  });

  it("get_encoder_presets never calls encoder.getFormatList()", async () => {
    const code = await codeFor(trackTargeting.get_encoder_presets, { format: "H.264" });

    // EncoderManager has no getFormatList(); presets are found by scanning .epr files.
    expect(code).not.toContain("getFormatList");
    expect(code).toContain("__collectAllPresets()");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/9
describe("issue #9 — frame export uses the QE DOM and verifies the file landed", () => {
  const exportTools = getExportTools(bridgeOptions);
  const utility = getUtilityTools(bridgeOptions);

  const frameTools: Array<[string, { handler: (args: never) => Promise<unknown> }, unknown]> = [
    ["export_frame", exportTools.export_frame, { output_path: "/tmp/f.png" }],
    ["capture_frame", exportTools.capture_frame, {}],
    ["freeze_frame", utility.freeze_frame, { output_path: "/tmp/f.png" }],
  ];

  for (const [name, tool, args] of frameTools) {
    it(`${name} does not call exportFramePNG on the public DOM sequence`, async () => {
      const script = await scriptFor(tool, args);

      // exportFramePNG exists only on the QE sequence. Calling it on
      // app.project.activeSequence throws "seq.exportFramePNG is not a function".
      expect(script).not.toMatch(/seq\.exportFramePNG/);
      expect(script).toContain("__exportStillFrame(");
    });

    it(`${name} surfaces an error instead of claiming success when no file is written`, async () => {
      const script = await scriptFor(tool, args);

      expect(script).toContain("if (!res.ok) return __error(");
    });
  }

  it("sets and restores the AME one-frame range in seconds", () => {
    const helpers = getHelpersSource();

    // Sequence.setInPoint/setOutPoint accept seconds. Passing ticks here made
    // the fallback target an enormous range and prevented a still from landing.
    expect(helpers).toContain("seq.setInPoint(__ticksToSeconds(startTicks))");
    expect(helpers).toContain("seq.setOutPoint(__ticksToSeconds(startTicks + frameTicks))");
    expect(helpers).toContain("seq.setInPoint(__ticksToSeconds(savedIn))");
    expect(helpers).toContain("seq.setOutPoint(__ticksToSeconds(savedOut))");
    expect(helpers).not.toContain("seq.setInPoint(String(startTicks))");
    // If either in or out cannot be read, refuse the one-frame mutation rather
    // than leaving the sequence pinned to the still-export range.
    expect(helpers).toContain("savedIn === null || savedIn === undefined || savedOut === null || savedOut === undefined");
    expect(helpers).toContain("could not read sequence in/out points, so they were not changed");
    expect(helpers).toContain("sequence in/out could not be restored after the one-frame export");
  });
});

// Defects found while reviewing PR #3 (repair 6 broken tools on Premiere Pro 2026).
describe("PR #3 follow-ups — color_correct and export_sequence", () => {
  // #712: trim_clip and slip_edit must refuse source windows past the media's
  // own end (Premiere would otherwise extend the clip over nonexistent frames
  // and report verified: true).
  it("trim_clip and slip_edit scripts carry the ffprobe media-duration guard", async () => {
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "C:/media/clip.mp4" } } as never);
    const trim = await scriptFor(getTimelineTools(bridgeOptions, { probeMediaDurationSeconds: async () => 5 }).trim_clip, { node_id: "clip-1", new_out_seconds: 39 });
    expect(trim).not.toContain("projectItem.getOutPoint()");
    expect(trim).toContain("real media duration of 5.000s (ffprobe)");
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "C:/media/clip.mp4" } } as never);
    const slip = await scriptFor(getAdvancedTools(bridgeOptions, { probeMediaDurationSeconds: async () => 10 }).slip_edit, { node_id: "clip-1", offset_seconds: 2 });
    expect(slip).toContain("past this clip's real media duration of 10.000s (ffprobe)");
  });


  const effects = getEffectsTools(bridgeOptions);
  const exportTools = getExportTools(bridgeOptions);

  it("color_correct applies a value of 0 exactly once", async () => {
    const code = await codeFor(effects.color_correct, { node_id: "clip1", saturation: 0 });

    // saturation: 0 is a valid full desaturate. Guarding on `!changes.saturation`
    // leaves the guard permanently open for 0, re-firing setValue on every later
    // Lumetri sub-section that repeats the "Saturation" display name.
    expect(code).toContain("!taken.saturation");
    expect(code).toContain("taken.saturation = true");
    expect(code).not.toContain("!changes.saturation");
  });

  it("color_correct carries no dead helper", async () => {
    const code = await codeFor(effects.color_correct, { node_id: "clip1", exposure: 1 });
    expect(code).not.toContain("trySet");
  });

  it("color_correct only emits setters for the controls it was given", async () => {
    const code = await codeFor(effects.color_correct, { node_id: "clip1", exposure: 1.5 });

    expect(code).toContain('name === "Exposure"');
    expect(code).not.toContain('name === "Saturation"');
  });

  it("export_sequence finds its default preset without hardcoding a version year", async () => {
    const code = await codeFor(exportTools.export_sequence, { output_path: "/tmp/out.mp4" });

    expect(code).toContain("__findH264Preset()");
    // Hardcoded install paths rot the moment Adobe ships the next version.
    expect(code).not.toContain("Adobe Media Encoder 2025");
    expect(code).not.toContain("Adobe Media Encoder 2026");
  });

  it("export_sequence fails closed when Premiere rejects the render or writes no file", async () => {
    const script = await scriptFor(exportTools.export_sequence, { output_path: "/tmp/out.mp4" });

    expect(script).toContain("var exportResult = seq.exportAsMediaDirect(");
    expect(script).toContain('if (exportResult === false) return __error("Premiere rejected the sequence export; nothing was written to " + outputPath + ".")');
    expect(script).toContain("if (!written.exists || written.length <= 0)");
    expect(script).toContain("verified: true");
  });

  it("export_as_fcp_xml fails closed when Premiere writes no file or leaves the old file unchanged", async () => {
    const script = await scriptFor(exportTools.export_as_fcp_xml, { output_path: "/tmp/export.xml" });

    expect(script).toContain("seq.exportAsFinalCutProXML(outputFile.fsName)");
    expect(script).toContain('if (!outputFile.exists || !(outputFile.length > 0)) return __error("Premiere did not write the requested FCP XML file.")');
    expect(script).toContain("the existing output was unchanged");
    expect(script).toContain("verified: true");
  });

  it("treats a missing or unchanged export file as failure, not success", async () => {
    const advanced = getAdvancedTools(bridgeOptions);



    const projectScript = await scriptFor(advanced.export_as_project, { output_path: "/tmp/export.prproj" });
    const xmlScript = await scriptFor(exportTools.export_as_fcp_xml, { output_path: "/tmp/export.xml" });
    const sequenceScript = await scriptFor(exportTools.export_sequence, {
      output_path: "/tmp/out.mp4",
      preset_path: temporaryPreset(),
    });

    function run(script: string, file: { exists: boolean; length: number; modified: string }, sequence: Record<string, unknown>) {
      function FileStub(this: { fsName: string; parent: { exists: boolean } }, path: string) {
        this.fsName = path;
        Object.defineProperty(this, "exists", { get: () => file.exists });
        Object.defineProperty(this, "length", { get: () => file.length });
        Object.defineProperty(this, "modified", { get: () => file.modified });
        this.parent = { exists: true, toString() { return "/tmp"; } };
      }
      return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
        File: FileStub,
        app: { project: { activeSequence: sequence }, encoder: { ENCODE_ENTIRE: 1, ENCODE_WORKAREA: 2 } },
      })));
    }

    const stale = { exists: true, length: 42, modified: "old" };
    expect(run(projectScript, stale, { exportAsProject() {} }).error).toMatch(/existing output was unchanged/);
    expect(run(xmlScript, stale, { exportAsFinalCutProXML() {} }).error).toMatch(/existing output was unchanged/);
    // export_sequence refuses an existing output unless overwrite is true (#648).
    expect(run(sequenceScript, stale, { exportAsMediaDirect() { return undefined; } }).error).toMatch(/A file already exists at \/tmp\/out\.mp4/);

    const missing = { exists: false, length: 0, modified: "" };
    expect(run(projectScript, missing, { exportAsProject() {} }).error).toMatch(/did not write the requested project file/);
    expect(run(xmlScript, missing, { exportAsFinalCutProXML() {} }).error).toMatch(/did not write the requested FCP XML file/);
    expect(run(sequenceScript, missing, { exportAsMediaDirect() { return true; } }).error).toMatch(/Premiere did not write \/tmp\/out\.mp4/);

    const written = { exists: false, length: 0, modified: "" };
    const write = () => { written.exists = true; written.length = 99; written.modified = "new"; };
    expect(run(projectScript, written, { exportAsProject: write })).toMatchObject({ success: true, data: { exported: true, verified: true } });
  });
});

describe("script-builder helpers used by the fixes are actually defined", () => {
  const exportTools = getExportTools(bridgeOptions);

  it("defines every helper the generated scripts call", async () => {
    const script = getHelpersSource();

    for (const helper of [
      "function __exportStillFrame(",
      "function __firstWrittenFile(",
      "function __findStillPreset(",
      "function __collectAllPresets(",
      "function __listProxyPresetCandidates(",
      "function __findH264Preset(",
      "function __adobeAppFolders(",
      "function __collectEprFiles(",
    ]) {
      expect(script).toContain(helper);
    }
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/189
describe("issue #189 — Premiere 26.3 capability boundaries and macOS presets", () => {
  const trackTargeting = getTrackTargetingTools(bridgeOptions);
  const timeline = getTimelineTools(bridgeOptions);
  const advanced = getAdvancedTools(bridgeOptions);
  const text = getTextTools(bridgeOptions);
  const keyframes = getKeyframeTools(bridgeOptions);
  const captions = getCaptionTools(bridgeOptions);

  it("searches resources inside macOS application bundles and normalizes H.264 filters", async () => {
    const helpers = getHelpersSource();
    const code = await codeFor(trackTargeting.get_encoder_presets, { format: "H.264" });

    expect(helpers).toContain("function __adobeApplicationResourceFolder(");
    expect(helpers).toContain('"/Contents/"');
    expect(helpers).toContain('"MediaIO/systempresets"');
    expect(code).toContain("__collectAllPresets()");
  });

  it("labels each preset's real container and ranks format matches first (live: 'H264 ...' presets in the MooV folder write .mov)", async () => {
    const ame = "/Applications/Adobe Media Encoder 2025/Adobe Media Encoder 2025.app/Contents/MediaIO/systempresets";
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { presets: [
      { name: "H264 Match Source - High bitrate", path: `${ame}/3F3F3F3F_4D6F6F56/H264 Match Source - High bitrate.epr`, format: "3F3F3F3F_4D6F6F56" },
      { name: "Match Source - High bitrate", path: `${ame}/4E49434B_48323634/Match Source - High bitrate.epr`, format: "4E49434B_48323634" },
      { name: "Waveform Audio 48kHz 16-bit", path: `${ame}/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr`, format: "3F3F3F3F_57415645" },
    ] } });
    const result = await trackTargeting.get_encoder_presets.handler({ format: "H.264" }) as { success: boolean; data: { presets: Array<Record<string, unknown>> } };
    expect(result.data.presets.map((p) => [p.name, p.formatLabel, p.extension])).toEqual([
      ["Match Source - High bitrate", "H.264 (MP4)", "mp4"],
      ["H264 Match Source - High bitrate", "QuickTime (MOV)", "mov"],
    ]);
  });

  it("never calls unsupported speed setters", async () => {
    const variants = [
      timeline.speed_change.handler({ node_id: "clip-1", speed_percent: 65 }),
      advanced.set_clip_speed_qe.handler({ node_id: "clip-1", speed_percent: 65 }),
      timeline.set_clip_properties.handler({ node_id: "clip-1", speed: 0.65 }),
    ];

    await expect(Promise.all(variants)).resolves.toEqual([
      expect.objectContaining({ success: false, error: expect.stringContaining("No mutation was attempted") }),
      expect.objectContaining({ success: false, error: expect.stringContaining("No mutation was attempted") }),
      expect.objectContaining({ success: false, error: expect.stringContaining("No mutation was attempted") }),
    ]);
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("fails raw-text caption creation before it can call an unsupported signature", async () => {
    const result = await text.add_text_overlay.handler({ text: "TREINO UPPER" });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining("No mutation was attempted"),
    }));
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("labels keyframe and caption results as storage or structure verification, not rendered output", async () => {
    const keyframeScript = await scriptFor(keyframes.add_keyframe, {
      node_id: "clip-1", effect_name: "Opacity", property_name: "Opacity", time_seconds: 0, value: 0,
    });
    expect(keyframeScript).toContain("getValueAtKey(time)");
    expect(keyframeScript).toContain("renderVerified: false");
    expect(keyframeScript).toContain("Premiere parameter readback only");

    const captionScript = await scriptFor(captions.create_caption_track, { item_id: "captions.srt" });
    expect(captionScript).toContain("renderVerified: false");
    expect(captionScript).toContain("verify playback or exported frames");
  });

  it("validates and structurally verifies timeline insertion instead of trusting insertClip", async () => {
    const invalid = await timeline.add_to_timeline.handler({ item_id: "clip-1", start_seconds: -1 });
    expect(invalid).toEqual(expect.objectContaining({ success: false }));
    expect(mockedSendCommand).not.toHaveBeenCalled();

    const script = await scriptFor(timeline.add_to_timeline, {
      item_id: "clip-1", track_index: 0, audio_track_index: 0, start_seconds: 3.4,
    });
    expect(script).toContain("__insertClipHonoringSyncLock(");
    expect(getHelpersSource()).toContain("beforeVideoCount");
    expect(getHelpersSource()).toContain("afterVideoCount > beforeVideoCount + expectedVideoAdded");
    expect(getHelpersSource()).toContain("residual frame fragment");
    expect(getHelpersSource()).toContain("matched");
    expect(script).toContain("verified: outcome.data.verified");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/194
describe("issue #194 — string-backed MOGRT effect properties", () => {
  const keyframes = getKeyframeTools(bridgeOptions);

  it("accepts and safely serializes the JSON string exposed by MOGRT text properties", async () => {
    expect(keyframes.set_effect_property.parameters.properties.value).toMatchObject({
      type: ["number", "string", "boolean", "array", "object"],
    });

    const script = await scriptFor(keyframes.set_effect_property, {
      node_id: "clip-1",
      effect_name: "AE.ADBE Capsule",
      property_name: "Source Text",
      value: '{"textEditValue":"Hello \\"editor\\""}',
    });

    expect(script).toContain('var requestedValue = "{\\"textEditValue\\":\\"Hello \\\\\\\"editor\\\\\\\"\\"}";');
    expect(script).toContain("prop.setValue(requestedValue, true)");
    expect(script).toContain("readbackVerified: readbackAvailable && __sameParameterValue(readbackValue, requestedValue)");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/196
describe("issue #196 — empty Premiere 26.x QE effect catalogs", () => {
  const effects = getEffectsTools(bridgeOptions);

  it("probes an exact QE effect name before treating an empty catalog as unavailable", async () => {
    const script = await scriptFor(effects.apply_effect, {
      node_id: "clip-1",
      effect_name: "Transform",
    });

    expect(script).toContain("qe.project.getVideoEffectByName(effectName)");
    expect(script).toContain('var effectCatalog = __getQeEffectCatalog("video")');
    expect(script).toContain("Direct QE lookup for");
    expect(script).toContain('lookupSource: lookupSource');

    const listScript = await scriptFor(effects.list_available_effects, {});
    expect(listScript).toContain("var commonNames = [");
    expect(listScript).toContain("qe.byName.partial");
    expect(listScript).toContain("Direct lookup did not resolve any bounded fallback effects.");

    const helpers = getHelpersSource();
    expect(helpers).toContain("function __getQeEffectCatalog(kind)");
    expect(helpers).toContain("Premiere returned an empty legacy QE");
    expect(helpers).toContain("no effect was applied");
    expect(helpers).toContain("manage_clip_effects_uxp");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/129
// Premiere 25.2 has no DOM Component.remove(), but QE exposes a targeted
// qeClip.getComponentAt(i).remove() in the same order as the DOM components.
describe("issue #129 — effect removal uses the targeted QE component remove and verifies", () => {
  const effects = getEffectsTools(bridgeOptions);
  const clipboard = getClipboardTools(bridgeOptions);
  const advanced = getAdvancedTools(bridgeOptions);

  function removalHost(names: string[], options: { qeRemoveNoop?: boolean; noQeFor?: string[]; noQeAt?: number[]; matchNames?: Record<string, string>; trackType?: "video" | "audio" } = {}) {
    const list = names.map((displayName) => ({ displayName, matchName: options.matchNames?.[displayName] ?? displayName }));
    const components = new Proxy({}, { get: (_t, key) => (key === "numItems" ? list.length : list[Number(key)]) });
    const clip = { nodeId: "clip1", name: "Speaker", start: { ticks: "0" }, end: { ticks: "254016000000" }, components };
    const qeClip = {
      type: "Clip",
      start: { ticks: "0" },
      getComponentAt: (index: number) => (options.noQeFor?.includes(list[index]?.displayName) || options.noQeAt?.includes(index) ? null : {
        name: list[index]?.displayName,
        remove: () => { if (!options.qeRemoveNoop) list.splice(index, 1); return true; },
      }),
      removeEffects: () => { throw new Error("broad removeEffects must not be used"); },
    };
    const qeTrack = { numItems: 1, getItemAt: () => qeClip };
    const track = { numTracks: 1, 0: { clips: { numItems: 1, 0: clip } } };
    const seq = options.trackType === "audio"
      ? { sequenceID: "s", videoTracks: { numTracks: 0 }, audioTracks: track }
      : { sequenceID: "s", videoTracks: track, audioTracks: { numTracks: 0 } };
    mockedSendCommand.mockImplementation(async (script: string) => JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { enableQE: () => {}, project: { activeSequence: seq } },
      qe: { project: { getActiveSequence: () => ({ getVideoTrackAt: () => qeTrack, getAudioTrackAt: () => qeTrack }) } },
    }))));
    return list;
  }
  const names = (list: Array<{ displayName: string }>) => list.map((c) => c.displayName);

  it("remove_effect removes the named effect through QE and verifies", async () => {
    const list = removalHost(["Opacity", "Motion", "Gaussian Blur", "Lumetri Color"]);
    await expect(effects.remove_effect.handler({ node_id: "clip1", effect_name: "Gaussian Blur" })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(names(list)).toEqual(["Opacity", "Motion", "Lumetri Color"]);
  });

  it("remove_effect by index removes exactly that component", async () => {
    const list = removalHost(["Opacity", "Motion", "Gaussian Blur", "Lumetri Color"]);
    await expect(effects.remove_effect.handler({ node_id: "clip1", effect_index: 3 })).resolves.toMatchObject({ success: true });
    expect(names(list)).toEqual(["Opacity", "Motion", "Gaussian Blur"]);
  });

  it("remove_effect_by_name removes every instance", async () => {
    const list = removalHost(["Opacity", "Motion", "Gaussian Blur", "Tint", "Gaussian Blur"]);
    await expect(clipboard.remove_effect_by_name.handler({ node_id: "clip1", effect_name: "Gaussian Blur" })).resolves.toMatchObject({ success: true, data: { removed: 2 } });
    expect(names(list)).toEqual(["Opacity", "Motion", "Tint"]);
  });

  it("remove_all_effects keeps built-in components and never calls removeEffects()", async () => {
    const list = removalHost(["Opacity", "Motion", "Lumetri Color", "Gaussian Blur"]);
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(names(list)).toEqual(["Opacity", "Motion"]);
  });

  it("refuses to remove built-in components", async () => {
    removalHost(["Opacity", "Motion"]);
    await expect(effects.remove_effect.handler({ node_id: "clip1", effect_name: "Motion" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("built-in") });
  });

  it("reports failure when Premiere keeps the effect", async () => {
    removalHost(["Opacity", "Motion", "Lumetri Color"], { qeRemoveNoop: true });
    const result = await advanced.remove_all_effects.handler({ node_id: "clip1" });
    expect(result.success).toBe(false);
  });

  // Adapted from the original #129 guards: a component with no removal path
  // is a capability error, and nothing is removed before every match is checked.
  it.each([
    ["index", { node_id: "clip1", effect_index: 2 }],
    ["name", { node_id: "clip1", effect_name: "Amplify" }],
  ])("remove_effect by %s returns a capability error when neither Component.remove() nor QE can remove it", async (_mode, args) => {
    const list = removalHost(["Opacity", "Motion", "Amplify"], { noQeFor: ["Amplify"] });
    await expect(effects.remove_effect.handler(args)).resolves.toMatchObject({ success: false, error: expect.stringContaining("Capability error") });
    expect(names(list)).toEqual(["Opacity", "Motion", "Amplify"]);
  });

  it("preflights every matching component before remove_effect_by_name removes any", async () => {
    // Removal runs highest index first: the later Amplify is removable, the
    // earlier one (index 1) is not, so without the preflight one would go.
    const list = removalHost(["Opacity", "Amplify", "Tint", "Amplify"], { noQeAt: [1] });
    await expect(clipboard.remove_effect_by_name.handler({ node_id: "clip1", effect_name: "Amplify" })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("No matching components were removed"),
    });
    expect(names(list)).toEqual(["Opacity", "Amplify", "Tint", "Amplify"]);
  });

  // Match names seen live on Premiere 25.2.3 (#674); display names are localized.
  it("refuses on a localized host until every built-in match name is confirmed (German)", async () => {
    const german = { Deckkraft: "AE.ADBE Opacity", Bewegung: "AE.ADBE Motion", "Lumetri-Farbe": "AE.ADBE Lumetri" };
    const list = removalHost(["Deckkraft", "Bewegung", "Lumetri-Farbe"], { matchNames: german });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("shows built-in components under localized names") });
    expect(names(list)).toEqual(["Deckkraft", "Bewegung", "Lumetri-Farbe"]);
  });

  it("never removes a localized built-in whose match name is not confirmed (Time Remapping)", async () => {
    const german = { Deckkraft: "AE.ADBE Opacity", Bewegung: "AE.ADBE Motion", Zeitverzerrung: "ADBE Time Remapping", "Lumetri-Farbe": "AE.ADBE Lumetri" };
    const list = removalHost(["Bewegung", "Deckkraft", "Zeitverzerrung", "Lumetri-Farbe"], { matchNames: german });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: false });
    await expect(clipboard.remove_effect_by_name.handler({ node_id: "clip1", effect_name: "Zeitverzerrung" })).resolves.toMatchObject({ success: false });
    expect(names(list)).toEqual(["Bewegung", "Deckkraft", "Zeitverzerrung", "Lumetri-Farbe"]);
  });

  it("refuses to remove a localized built-in picked by index", async () => {
    const list = removalHost(["Deckkraft", "Bewegung", "Lumetri-Farbe"], { matchNames: { Deckkraft: "AE.ADBE Opacity", Bewegung: "AE.ADBE Motion", "Lumetri-Farbe": "AE.ADBE Lumetri" } });
    await expect(effects.remove_effect.handler({ node_id: "clip1", effect_index: 0 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("built-in") });
    await expect(clipboard.remove_effect_by_name.handler({ node_id: "clip1", effect_name: "Bewegung" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("built-in") });
    expect(names(list)).toEqual(["Deckkraft", "Bewegung", "Lumetri-Farbe"]);
  });

  it("removes effects from a mono audio clip, which has Volume but no Channel Volume (live 25.2.3)", async () => {
    const list = removalHost(["Volume", "DeNoise"], { trackType: "audio", matchNames: { Volume: "Internal Volume Mono", DeNoise: "AE.ADBE DeNoise" } });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { verified: true, removedEffects: ["DeNoise"] } });
    expect(names(list)).toEqual(["Volume"]);
  });

  it("removes effects from an English 5.1 clip by its Internal match names", async () => {
    const surround = { Volume: "Internal Volume 5.1", "Channel Volume": "Internal Channel Volume 5.1", DeNoise: "AE.ADBE DeNoise" };
    const list = removalHost(["Volume", "Channel Volume", "DeNoise"], { trackType: "audio", matchNames: surround });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { removedEffects: ["DeNoise"] } });
    expect(names(list)).toEqual(["Volume", "Channel Volume"]);
  });

  it("refuses on a localized audio host, since Panner's match name is not confirmed (French 5.1)", async () => {
    const french = { Volume: "Internal Volume 5.1", "Volume des canaux": "Internal Channel Volume 5.1", "Réduction du bruit": "AE.ADBE DeNoise" };
    const list = removalHost(["Volume", "Volume des canaux", "Réduction du bruit"], { trackType: "audio", matchNames: french });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("localized names (Volume des canaux)") });
    expect(names(list)).toEqual(["Volume", "Volume des canaux", "Réduction du bruit"]);
  });

  // es-ES display names measured live on Premiere 26.5.2 (#674): video
  // Opacidad / Movimiento / Movimiento del vector; audio Volumen / Volumen del
  // canal. The localized-host refusal must no longer fire there.
  it("removes effects on a Spanish (es-ES) host whose built-in names are measured", async () => {
    const spanish = { Opacidad: "AE.ADBE Opacity", Movimiento: "AE.ADBE Motion", "Desenfoque gaussiano": "AE.Impact_Blur_FX" };
    const list = removalHost(["Opacidad", "Movimiento", "Desenfoque gaussiano"], { matchNames: spanish });
    await expect(clipboard.remove_effect_by_name.handler({ node_id: "clip1", effect_name: "Desenfoque gaussiano" })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(names(list)).toEqual(["Opacidad", "Movimiento"]);
  });

  it("removes effects from a Spanish mono audio clip, keeping Volumen", async () => {
    const spanishMono = { Volumen: "Internal Volume Mono", DeEsser: "AE.ADBE DeEsser" };
    const list = removalHost(["Volumen", "DeEsser"], { trackType: "audio", matchNames: spanishMono });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { removedEffects: ["DeEsser"] } });
    expect(names(list)).toEqual(["Volumen"]);
  });

  it("classifies a touched Balance (Equilibrio / Internal Audio Balance) as built-in, not as a localized host (live 26.5.2 es-ES)", async () => {
    const spanishBalance = {
      Volumen: "Internal Volume Stereo",
      "Volumen del canal": "Internal Channel Volume Stereo",
      Equilibrio: "Internal Audio Balance",
      DeEsser: "AE.ADBE DeEsser",
    };
    const list = removalHost(["Volumen", "Volumen del canal", "Equilibrio", "DeEsser"], { trackType: "audio", matchNames: spanishBalance });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { removedEffects: ["DeEsser"] } });
    expect(names(list)).toEqual(["Volumen", "Volumen del canal", "Equilibrio"]);
    await expect(clipboard.remove_effect_by_name.handler({ node_id: "clip1", effect_name: "Equilibrio" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("built-in") });
  });

  it("classifies an English touched Balance as built-in too (live 25.2.3 en-US macOS data)", async () => {
    // Display names and match names reported from a Premiere 25.2.3 en-US macOS
    // host (#674): a stereo clip with Balance applied refused removal before the
    // English name joined the table. DeEsser's real match name on that host is a
    // GUID, encoded here to keep the fake honest.
    const englishBalance = {
      Volume: "Internal Volume Stereo",
      "Channel Volume": "Internal Channel Volume Stereo",
      Balance: "Internal Audio Balance",
      DeEsser: "ffbe710f-cd69-4139-ad26-65603616d9d4",
    };
    const list = removalHost(["Volume", "Channel Volume", "Balance", "DeEsser"], { trackType: "audio", matchNames: englishBalance });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { removedEffects: ["DeEsser"] } });
    expect(names(list)).toEqual(["Volume", "Channel Volume", "Balance"]);
    await expect(clipboard.remove_effect_by_name.handler({ node_id: "clip1", effect_name: "Balance" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("built-in") });
  });

  it("keeps a Spanish graphic's layers (Movimiento del vector, Texto) while removing effects", async () => {
    const graphicEs = { Opacidad: "AE.ADBE Opacity", Movimiento: "AE.ADBE Motion", "Movimiento del vector": "AE.ADBE Graphic Group", Texto: "AE.ADBE Text", Tinte: "AE.ADBE Tint" };
    const list = removalHost(["Opacidad", "Movimiento", "Movimiento del vector", "Texto", "Tinte"], { matchNames: graphicEs });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { removedEffects: ["Tinte"] } });
    expect(names(list)).toEqual(["Opacidad", "Movimiento", "Movimiento del vector", "Texto"]);
  });

  it("still refuses on locales with no measured display names (Italian)", async () => {
    const italian = { "Opacità": "AE.ADBE Opacity", Movimento: "AE.ADBE Motion", "Colore Lumetri": "AE.ADBE Lumetri" };
    const list = removalHost(["Opacità", "Movimento", "Colore Lumetri"], { matchNames: italian });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("localized names") });
    expect(names(list)).toEqual(["Opacità", "Movimento", "Colore Lumetri"]);
  });

  it("keeps a graphic's own layers (Vector Motion, Text) by match name", async () => {
    const graphic = { "Vector Motion": "AE.ADBE Graphic Group", Text: "AE.ADBE Text", Opacity: "AE.ADBE Opacity", Motion: "AE.ADBE Motion", Tint: "AE.ADBE Tint" };
    const list = removalHost(["Opacity", "Motion", "Vector Motion", "Text", "Tint"], { matchNames: graphic });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { removedEffects: ["Tint"] } });
    expect(names(list)).toEqual(["Opacity", "Motion", "Vector Motion", "Text"]);
  });

  it("keeps a stock lower third's shape layers by match name (live 25.2.3: AE.ADBE Shape)", async () => {
    const lowerThird = { "Vector Motion": "AE.ADBE Graphic Group", Shape: "AE.ADBE Shape", Text: "AE.ADBE Text", Opacity: "AE.ADBE Opacity", Motion: "AE.ADBE Motion", Tint: "AE.ADBE Tint" };
    const list = removalHost(["Opacity", "Motion", "Vector Motion", "Shape", "Text", "Shape", "Tint"], { matchNames: lowerThird });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { removedEffects: ["Tint"] } });
    expect(names(list)).toEqual(["Opacity", "Motion", "Vector Motion", "Shape", "Text", "Shape"]);
  });

  it("treats a localized shape layer as proof of a localized host", async () => {
    const list = removalHost(["Form", "Lumetri-Farbe"], { matchNames: { Form: "AE.ADBE Shape", "Lumetri-Farbe": "AE.ADBE Lumetri" } });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("localized names (Form)") });
    expect(names(list)).toEqual(["Form", "Lumetri-Farbe"]);
  });

  it("refuses, removing nothing, when a component reports no match name and a non-English name", async () => {
    const list = removalHost(["Deckkraft", "Lumetri-Farbe"], { matchNames: { Deckkraft: "", "Lumetri-Farbe": "AE.ADBE Lumetri" } });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("no match name") });
    expect(names(list)).toEqual(["Deckkraft", "Lumetri-Farbe"]);
  });

  it("removes audio effects when the audio built-ins are recognized", async () => {
    const list = removalHost(["Volume", "Channel Volume", "Panner", "DeNoise"], { trackType: "audio" });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: true, data: { verified: true } });
    expect(names(list)).toEqual(["Volume", "Channel Volume", "Panner"]);
  });

  it("says a silent QE no-op did not take effect, not that effects were removed", async () => {
    removalHost(["Opacity", "Motion", "Lumetri Color"], { qeRemoveNoop: true });
    await expect(advanced.remove_all_effects.handler({ node_id: "clip1" })).resolves.toMatchObject({ success: false, error: expect.stringContaining("did not take effect: the clip still has Opacity, Motion, Lumetri Color") });
  });

  it("documents the capability boundary and the experimental QE path in each removal tool", () => {
    for (const tool of [effects.remove_effect, clipboard.remove_effect_by_name, advanced.remove_all_effects]) {
      expect(tool.description).toContain("capability error");
      expect(tool.description).toContain("EXPERIMENTAL");
    }
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/37
describe("issue #37 — sequence frame rate uses ticks per frame", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("converts fps to a Time duration and verifies the applied ticks", async () => {
    const script = await scriptFor(utility.set_sequence_frame_rate, { frame_rate: 30 });

    expect(script).toContain("TICKS_PER_SECOND / requestedFps");
    expect(script).toContain("var frameDuration = new Time()");
    expect(script).toContain("frameDuration.ticks = requestedTicks.toString()");
    expect(script).toContain("settings.videoFrameRate = frameDuration");
    expect(script).toContain("Math.abs(appliedTicks - requestedTicks) > 1");
    expect(script).not.toContain("settings.videoFrameRate = 30");
  });

  it("rejects invalid frame rates before sending a Premiere command", async () => {
    mockedSendCommand.mockClear();
    const result = await utility.set_sequence_frame_rate.handler({ frame_rate: 0 });

    expect(result).toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/335
describe("issue #335 — pixel aspect ratio must fail closed on unsupported CEP hosts", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("checks host support and verifies the readback before reporting success", async () => {
    const script = await codeFor(utility.set_sequence_pixel_aspect_ratio, { ratio: "1.0" });

    expect(script).toContain("currentRatio = settings.videoPixelAspectRatio");
    expect(script).toContain('typeof currentRatio === "undefined"');
    expect(script).toContain("No sequence settings were changed");
    expect(script).toContain("settings.videoPixelAspectRatio = requestedRatio");
    expect(script).toContain("observed = seq.getSettings()");
    expect(script).toContain("observedRatio = String(observed.videoPixelAspectRatio)");
    expect(script.indexOf('typeof currentRatio === "undefined"'))
      .toBeLessThan(script.indexOf("settings.videoPixelAspectRatio = requestedRatio"));
  });

  it("returns structured failures for unavailable and rejected host settings", async () => {
    const unavailableSetSettings = vi.fn();
    await expect(executePixelAspectRatioScript({
      name: "Unsupported setting",
      getSettings: () => ({}),
      setSettings: unavailableSetSettings,
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("does not expose a writable"),
    });
    expect(unavailableSetSettings).not.toHaveBeenCalled();

    const lockedSettings: Record<string, string> = {};
    Object.defineProperty(lockedSettings, "videoPixelAspectRatio", {
      get: () => "1.0",
      set: () => { throw new Error("locked"); },
    });
    const rejectedSetSettings = vi.fn();
    await expect(executePixelAspectRatioScript({
      name: "Read-only setting",
      getSettings: () => lockedSettings,
      setSettings: rejectedSetSettings,
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("rejected the sequence pixel-aspect-ratio update"),
    });
    expect(rejectedSetSettings).not.toHaveBeenCalled();

    await expect(executePixelAspectRatioScript({
      name: "Apply failure",
      getSettings: () => ({ videoPixelAspectRatio: "1.0" }),
      setSettings: () => { throw new Error("host refused"); },
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("could not apply the sequence pixel-aspect-ratio update"),
    });
  });

  it("accepts a request that already matches Premiere's read-only num:den ratio (live 25.2)", async () => {
    const readOnly: Record<string, string> = {};
    Object.defineProperty(readOnly, "videoPixelAspectRatio", {
      get: () => "1:1",
      set: () => { throw new TypeError("Cannot set property videoPixelAspectRatio"); },
    });
    const setSettings = vi.fn();
    const sequence = { name: "Square", getSettings: () => readOnly, setSettings };
    await expect(executePixelAspectRatioScript(sequence, "1.0")).resolves.toMatchObject({
      success: true,
      data: { alreadySet: true, hostRatio: "1:1", verified: true },
    });
    expect(setSettings).not.toHaveBeenCalled();
    await expect(executePixelAspectRatioScript(sequence, "1.4222")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("rejected the sequence pixel-aspect-ratio update"),
    });
  });

  it("treats a false host result and mismatched readback as unverified", async () => {
    await expect(executePixelAspectRatioScript({
      name: "Rejected return value",
      getSettings: () => ({ videoPixelAspectRatio: "1.0" }),
      setSettings: () => false,
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("rejected the sequence pixel-aspect-ratio update"),
    });

    const initialSettings = { videoPixelAspectRatio: "1.0" };
    await expect(executePixelAspectRatioScript({
      name: "Mismatched readback",
      getSettings: vi.fn().mockReturnValueOnce(initialSettings).mockReturnValueOnce({ videoPixelAspectRatio: "1.0" }),
      setSettings: () => undefined,
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("did not apply the requested sequence pixel aspect ratio"),
    });
  });

  it("reports success only after an applied setting reads back exactly", async () => {
    const settings = { videoPixelAspectRatio: "1.0" };
    const result = await executePixelAspectRatioScript({
      name: "Verified sequence",
      getSettings: () => settings,
      setSettings: () => true,
    });

    expect(result).toEqual({
      success: true,
      data: { ratio: "1.4222", observedRatio: "1.4222", sequence: "Verified sequence", verified: true },
    });
  });

  it("compares the ratio numerically so host formatting does not fail a correct update (#642)", async () => {
    for (const [requested, hostFormat] of [["1.0", "1"], ["1.0", "1:1"], ["1.4222", "1.42222"], ["2", "2.0"]]) {
      const readback = { videoPixelAspectRatio: "0.9" };
      const result = await executePixelAspectRatioScript({
        name: "Formatted",
        getSettings: vi.fn().mockReturnValueOnce(readback).mockReturnValueOnce({ videoPixelAspectRatio: hostFormat }),
        setSettings: () => true,
      }, requested);
      expect(result).toMatchObject({ success: true, data: { ratio: requested, observedRatio: hostFormat, verified: true } });
    }
    const wrong = await executePixelAspectRatioScript({
      name: "Wrong",
      getSettings: vi.fn().mockReturnValueOnce({ videoPixelAspectRatio: "0.9" }).mockReturnValueOnce({ videoPixelAspectRatio: "0.9091" }),
      setSettings: () => true,
    }, "1.0");
    expect(wrong).toMatchObject({ success: false, error: expect.stringContaining("reads back as 0.9091") });
  });

  it("rejects non-string aspect ratios before sending a Premiere command", async () => {
    mockedSendCommand.mockClear();
    const result = await utility.set_sequence_pixel_aspect_ratio.handler({ ratio: 1 as never });

    expect(result).toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/235
describe("issue #235 — CEP tool calls use the host's documented argument types", () => {
  const utility = getUtilityTools(bridgeOptions);
  // #710: audio volume tools must recognize localized built-ins (es-ES
  // Volumen / Internal Volume Stereo, property Nivel) — previously they only
  // matched English names and failed with "is this an audio clip?".
  it("set_clip_volume and get_clip_volume recognize localized Volume components", async () => {
    const setScript = await scriptFor(tracks.set_clip_volume, { node_id: "clip-1", volume_db: -3 });
    expect(setScript).toContain("Volumen");
    expect(setScript).toContain("Internal Volume");
    expect(setScript).toContain("Nivel");
    const getScript = await scriptFor(tracks.get_clip_volume, { node_id: "clip-1" });
    expect(getScript).toContain("Volumen");
    expect(getScript).toContain("Nivel");
  });

  it.each([
    ["localized display name", "Volumen", ""],
    ["locale-independent match name", "Other language", "Internal Volume Stereo"],
  ])("writes and reads audio volume through %s", async (_label, displayName, matchName) => {
    let level = 1;
    const keyValues = new Map<string, number>();
    const property = {
      displayName: "Nivel",
      setValue(value: number) { level = value; },
      getValue() { return level; },
      setTimeVarying() {},
      addKey() {},
      setValueAtKey(time: { ticks: string }, value: number) { keyValues.set(time.ticks, value); },
      getValueAtTime(time: { ticks: string }) { return keyValues.get(time.ticks); },
    };
    const component = { displayName, matchName, properties: { numItems: 1, 0: property } };
    const clip = { nodeId: "audio-1", name: "Audio", duration: { ticks: String(3 * 254016000000) }, components: { numItems: 1, 0: component } };
    const track = { clips: { numItems: 1, 0: clip } };
    const sequence = { videoTracks: { numTracks: 0 }, audioTracks: { numTracks: 1, 0: track } };
    function Time(this: { ticks: string }) { this.ticks = "0"; }
    mockedSendCommand.mockImplementation(async (script: string) =>
      JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, { app: { project: { activeSequence: sequence } }, Time }))));

    await expect(tracks.set_clip_volume.handler({ node_id: "audio-1", volume_db: -3 })).resolves.toMatchObject({
      success: true, data: { requestedVolumeDb: -3, clamped: false },
    });
    expect(level).toBeGreaterThan(0);
    expect(level).toBeLessThan(1);
    const readback = await tracks.get_clip_volume.handler({ node_id: "audio-1" });
    expect(readback).toMatchObject({ success: true, data: { clip: "Audio" } });
    expect((readback as { data: { volumeDb: number } }).data.volumeDb).toBeCloseTo(-3, 3);
    await expect(tracks.set_clip_volume.handler({ node_id: "audio-1", volume_db: 100 })).resolves.toMatchObject({
      success: true, data: { requestedVolumeDb: 100, volumeDb: 15, level: 1, clamped: true },
    });
    await expect(tracks.set_clips_volume.handler({ track_index: 0, volume_db: -6 })).resolves.toMatchObject({
      success: true, data: { applied: 1, skipped: 0 },
    });
    const audio = getAudioTools(bridgeOptions);
    await expect(audio.adjust_audio_levels.handler({ node_id: "audio-1", level_db: -4 })).resolves.toMatchObject({
      success: true, data: { adjusted: true, verified: true },
    });
    await expect(audio.add_audio_keyframes.handler({ node_id: "audio-1", keyframes: [{ time_seconds: 1, level_db: -6 }] })).resolves.toMatchObject({
      success: true, data: { keyframesAdded: 1, verified: true },
    });
    const competitor = getCompetitorGapTools(bridgeOptions);
    await expect(competitor.setup_ducking.handler({ node_id: "audio-1", ducking_windows: [] })).resolves.toMatchObject({
      success: true, data: { updated: true, verified: true },
    });
    const originalSetter = property.setValue;
    Object.assign(property, { setValue: () => {} });
    await expect(tracks.set_clip_volume.handler({ node_id: "audio-1", volume_db: -20 })).resolves.toMatchObject({
      success: false, data: { outcome: "not_applied", verified: false, timelineChanged: false },
    });
    property.setValue = originalSetter;
    let invalidReads = 0;
    Object.assign(property, { getValue: () => ++invalidReads === 1 ? level : true });
    await expect(tracks.set_clip_volume.handler({ node_id: "audio-1", volume_db: 15 })).resolves.toMatchObject({
      success: true, data: { outcome: "committed_unverified", verified: false, level: null },
    });
    let throwingReads = 0;
    property.getValue = () => { if (++throwingReads > 1) throw new Error("readback unavailable"); return level; };
    const unreadable = await tracks.set_clip_volume.handler({ node_id: "audio-1", volume_db: -3 });
    expect(unreadable).toMatchObject({
      success: true,
      data: { outcome: "committed_unverified", requestedVolumeDb: -3, volumeDb: null },
    });
    Object.assign(property, { getValue: () => level, setValue: () => { throw new Error("setter refused before write"); } });
    await expect(tracks.set_clip_volume.handler({ node_id: "audio-1", volume_db: -12 })).resolves.toMatchObject({
      success: false, data: { outcome: "not_applied", verified: false, timelineChanged: false, level },
    });
    Object.assign(property, { getValue: () => level, setValue: (value: number) => { level = value; throw new Error("setter failed after write"); } });
    await expect(tracks.set_clip_volume.handler({ node_id: "audio-1", volume_db: -8 })).resolves.toMatchObject({
      success: false, data: { outcome: "committed_unverified", verified: false, timelineChanged: true },
    });
  });

  const tracks = getTrackTargetingTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);

  it("uses a string-backed pixel aspect ratio and verifies the settings readback", async () => {
    const script = await scriptFor(utility.set_sequence_pixel_aspect_ratio, { ratio: "1.0" });

    expect(utility.set_sequence_pixel_aspect_ratio.parameters.properties.ratio).toMatchObject({ type: "string" });
    expect(script).toContain('var requestedRatio = "1.0"');
    expect(script).toContain("settings.videoPixelAspectRatio = requestedRatio");
    expect(script).toContain("seq.getSettings()");
    expect(script).toContain("Premiere did not apply the requested sequence pixel aspect ratio");
  });

  it("clears sequence points with seconds derived from their tick values", async () => {
    const script = await scriptFor(tracks.clear_sequence_in_out, {});

    expect(script).toContain("var zeroSeconds = __ticksToSeconds(seq.zeroPoint)");
    expect(script).toContain("var endSeconds = __ticksToSeconds(seq.end)");
    expect(script).toContain("seq.setInPoint(zeroSeconds)");
    expect(script).toContain("seq.setOutPoint(endSeconds)");
    expect(script).not.toContain("seq.zeroPoint.ticks");
  });

  it("passes every positional bars-and-tone argument and captures the created item", async () => {
    const script = await scriptFor(project.create_bars_and_tone, {
      width: 1920,
      height: 1080,
      pixel_aspect_numerator: 1,
      pixel_aspect_denominator: 1,
      audio_sample_rate: 48000,
      name: "Bars",
    });

    expect(script).toContain("app.project.newBarsAndTone(");
    expect(script).toContain("1920,");
    expect(script).toContain("1080,");
    expect(script).toContain("1,");
    expect(script).toContain("48000,");
    expect(script).toContain('"Bars"');
    expect(script).toContain("var beforeIds = __collectNodeIds(");
    expect(script).toContain("__findNewProjectItem(beforeIds, requestedName)");
  });

  it("writes the Anti-flicker numeric stream value and verifies it", async () => {
    const script = await scriptFor(tracks.set_anti_alias_quality, { node_id: "clip-1", enabled: false });

    expect(script).toContain("var requestedValue = 0");
    expect(script).toContain("antiFlicker.setValue(requestedValue, 1)");
    expect(script).toContain("antiFlicker.getValue()");
    expect(script).not.toContain("Use Composition's Shutter Angle");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/236
describe("issue #236 — CEP tools supply required positional arguments", () => {
  const advanced = getAdvancedTools(bridgeOptions);
  const text = getTextTools(bridgeOptions);

  it("passes action, linked-audio, and sensitivity to scene detection", async () => {
    const script = await scriptFor(advanced.scene_edit_detection, {
      action: "CreateMarkers",
      apply_cuts_to_linked_audio: false,
      sensitivity: "MediumSensitivity",
    });

    expect(script).toContain("seq.performSceneEditDetectionOnSelection(");
    expect(script).toContain('"CreateMarkers"');
    expect(script).toContain("false,");
    expect(script).toContain('"MediumSensitivity"');
    expect(script).toContain("Select at least one clip");
  });

  it("passes the Creative Cloud Library name before the MOGRT name", async () => {
    const script = await scriptFor(text.import_mogrt_from_library, {
      library_name: "Brand Library",
      mogrt_name: "Lower Third",
    });

    expect(text.import_mogrt_from_library.parameters.required).toEqual(["library_name", "mogrt_name"]);
    expect(script).toContain("seq.importMGTFromLibrary(");
    expect(script).toContain('libraryName,');
    expect(script).toContain('mogrtName,');
    expect(script).toContain("startTicks,");
  });

  it("fails raw-text overlay creation before sending an unsupported bridge call", async () => {
    const result = await text.add_text_overlay.handler({ text: "Title" });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining("No mutation was attempted") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/237
describe("issue #237 — reported mutations must be observable or fail", () => {
  const advanced = getAdvancedTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);
  const tracks = getTrackTargetingTools(bridgeOptions);
  const media = getMediaTools(bridgeOptions);

  // #713: a missing import path must fail fast in the handler — importFiles
  // with a nonexistent path opens a blocking modal in Premiere that wedges the
  // CEP bridge until a restart.
  it("refuses import_media with missing paths before Premiere is contacted", async () => {
    await expect(media.import_media.handler({ file_paths: ["C:/no/existe.mp4"] })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("File(s) not found"),
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("refuses import_folder with a nonexistent folder before Premiere is contacted", async () => {
    const missing = join(process.cwd(), "__missing_import_folder_713__");
    await expect(media.import_folder.handler({ folder_path: missing })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("not found"),
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("rejects empty arrays and directories before host contact (#725 FAM-5)", async () => {
    expect(media.import_media.parameters.properties.file_paths).toMatchObject({ minItems: 1, items: { minLength: 1 } });
    await expect(media.import_media.handler({ file_paths: [] })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("at least one non-empty path"),
    });
    const dir = join(process.cwd());
    const dirForward = dir.split(sep).join("/");
    await expect(media.import_media.handler({ file_paths: [dirForward] })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("Use import_folder"),
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
    await expect(media.import_folder.handler({ folder_path: join(process.cwd(), "package.json") })).resolves.toMatchObject({
      success: false, error: expect.stringContaining("not a directory"),
    });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });

  it("resolves forward-slash import paths to native separators before embedding them", async () => {
    const forward = join(process.cwd(), "package.json").split(sep).join("/");
    const script = await scriptFor(media.import_media, { file_paths: [forward] });
    expect(script).toContain(escapeForExtendScript(resolve(forward)));
  });
  const exports = getExportTools(bridgeOptions);

  it("makes trim tools read back their claimed changes", async () => {
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { projectDocumentId: "project", sequenceId: "seq", entries: [{ nodeId: "clip-1", mediaPath: "/tmp/clip.mp4", position: "0|1|0|1", trackType: "video", trackIndex: 0, clipIndex: 0 }] } });
    const slide = await scriptFor(advanced.slide_edit, { node_id: "clip-1", offset_seconds: 1 });
    const slip = await scriptFor(advanced.slip_edit, { node_id: "clip-1", offset_seconds: 1 });
    mockedSendCommand.mockResolvedValueOnce({ success: true, data: { projectDocumentId: "project", sequenceId: "seq", entries: [{ nodeId: "clip-1", mediaPath: "/tmp/clip.mp4", position: "0|1|0|1", trackType: "video", trackIndex: 0, clipIndex: 0 }] } });
    const roll = await scriptFor(advanced.roll_edit, { node_id: "clip-1", offset_seconds: 1 });

    expect(slide).toContain("The slide edit returned without an observable timeline change");
    expect(roll).toContain("The roll edit returned without an observable timeline change");
    expect(slip).toContain("The slip edit returned without an observable source in/out change");
    expect(slip).toContain("verified: true");
  });

  it("uses structural receipts for import and duplicate consolidation", async () => {
    const imports = await scriptFor(project.import_sequences, {
      project_path: "/tmp/source.prproj",
      sequence_ids: ["source-sequence-id"],
    });
    const duplicates = await scriptFor(project.consolidate_duplicates, {});

    expect(imports).toContain("new File");
    expect(imports).toContain("beforeIds");
    expect(duplicates).toContain("var nodeId = String(item.nodeId || \"\")");
    expect(duplicates).toContain("pathMap[mediaPath].nodeIds[nodeId]");
    expect(imports).toContain("Premiere did not add any of the requested sequences");
    expect(duplicates).toContain("__duplicateMediaStats");
    expect(duplicates).toContain("duplicate media groups did not decrease");
  });

  it("checks image imports, source-point writes, disable state, and offline state", async () => {
    const image = await scriptFor(tracks.import_image_sequence, { first_file_path: "/tmp/frame_001.png" });
    const points = await scriptFor(tracks.set_item_in_out, { item_id: "item-1", in_seconds: 1 });
    const enabled = await scriptFor(tracks.batch_enable_disable, { target: "selected", enabled: false });
    const offline = await scriptFor(media.set_offline, { item_id: "item-1", offline: false });

    expect(image).toContain("sourceFile.exists");
    expect(image).toContain("Premiere accepted the image-sequence import but no project item was added");
    expect(points).toContain("item.getInPoint");
    expect(points).toContain("Premiere did not apply the requested project-item in point");
    expect(enabled).toContain("track.clips[c].disabled = disabled");
    expect(enabled).toContain("No clips matched target 'selected'");
    expect(offline).toContain("item.refreshMedia()");
    expect(offline).toContain("item.isOffline()");
  });

  it("labels sequence close as a tab operation and verifies an OMF file", async () => {
    const close = await scriptFor(advanced.close_sequence, { sequence_id: "sequence-1" });
    const omf = await scriptFor(exports.export_omf, { output_path: "/tmp/export.omf" });

    expect(close).toContain("timelineTabCloseRequested: true");
    expect(close).toContain("sequenceRetainedInProject");
    expect(omf).toContain("outputFile.exists");
    expect(omf).toContain("Premiere did not write the requested OMF file");
    expect(exports.export_omf.parameters.properties.include_pan).toMatchObject({ type: "boolean" });
  });

  it("export_as_project fails closed when Premiere writes no file or leaves the old file unchanged", async () => {
    const script = await scriptFor(advanced.export_as_project, { output_path: "/tmp/export.prproj" });

    expect(script).toContain("seq.exportAsProject(outputFile.fsName)");
    expect(script).toContain('if (!outputFile.exists || !(outputFile.length > 0)) return __error("Premiere did not write the requested project file.")');
    expect(script).toContain("the existing output was unchanged");
    expect(script).toContain("verified: true");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/238
describe("issue #238 — AME uses canonical paths and documented encodeFile positions", () => {
  const exports = getExportTools(bridgeOptions);

  it("captures AME job IDs and does not present queueing as a completed encode", async () => {
    const queued = await scriptFor(exports.add_to_render_queue, { output_path: "/tmp/render.mp4", preset_path: temporaryPreset() });
    const projectItem = await scriptFor(exports.encode_project_item, {
      item_id: "item-1",
      output_path: "/tmp/render.mp4",
      preset_path: "/tmp/preset.epr",
    });

    expect(queued).toContain("var outputFile = new File");
    expect(queued).toContain("var jobId = encoder.encodeSequence");
    // Queueing remains an unverified handoff. Batch start is opt-in because it
    // affects every ready AME job, including jobs unrelated to this call.
    expect(queued).toContain("Batch startup and output-file creation are not verified by this tool");
    expect(queued).toContain("if (false)");
    expect(queued).toContain("app.encoder.startBatch()");
    expect(projectItem).toContain("outputFile.fsName");
    expect(projectItem).toContain("var jobId = app.encoder.encodeProjectItem");
  });

  it("uses the documented encodeFile signature without a workArea argument (live: 'Illegal Parameter type')", async () => {
    const run = async (args: Record<string, unknown>) => {
      const calls: unknown[][] = [];
      const script = await scriptFor(exports.encode_file, { input_path: "/tmp/source.mov", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr", ...args });
      function Time(this: { seconds: number }) { this.seconds = 0; }
      function File(this: { exists: boolean; fsName: string; parent: { exists: boolean } }, path: string) { this.exists = true; this.fsName = path; this.parent = { exists: true }; }
      const result = JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
        Time, File,
        app: {
          project: { path: "/tmp/p.prproj" },
          encoder: {
            launchEncoder: () => true,
            startBatch: () => true,
            encodeFile: (...callArgs: unknown[]) => {
              calls.push(callArgs);
              if (typeof callArgs[3] !== "boolean" || (callArgs.length > 4 && !(callArgs[4] instanceof Time))) throw new Error("Illegal Parameter type");
              return "job-1";
            },
          },
        },
      })));
      return { result, calls };
    };
    const whole = await run({});
    expect(whole.result).toMatchObject({ success: true, data: { jobId: "job-1", range: "entire" } });
    expect(whole.calls[0]).toHaveLength(4);
    const ranged = await run({ in_seconds: 24.4, out_seconds: 34.9 });
    expect(ranged.result).toMatchObject({ success: true, data: { range: { inSeconds: 24.4, outSeconds: 34.9 } } });
    expect(ranged.calls[0]).toHaveLength(6);
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/615
describe("issue #615 — encode_file passes natively typed arguments", () => {
  const exports = getExportTools(bridgeOptions);
  const base = { input_path: "/tmp/source.mov", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr" };

  it("passes String paths, a Boolean removal flag, and Time in/out points", async () => {
    const script = await scriptFor(exports.encode_file, base);

    expect(script).toContain('var presetFile = new File("/tmp/preset.epr")');
    expect(script).toContain("if (!presetFile.exists) return __error");
    expect(script).toContain("var removeUponCompletion = true;");
    expect(script).toContain("String(inputFile.fsName), String(outputFile.fsName), String(presetFile.fsName), removeUponCompletion)");
    expect(script).not.toMatch(/,\s*workArea,/);
  });

  it("emits a false Boolean when remove_on_completion is false, with or without a range", async () => {
    const noRange = await scriptFor(exports.encode_file, { ...base, remove_on_completion: false });
    const range = await scriptFor(exports.encode_file, { ...base, remove_on_completion: false, in_seconds: 1, out_seconds: 3 });

    for (const script of [noRange, range]) {
      expect(script).toContain("var removeUponCompletion = false;");
    }
    expect(range).toContain("srcIn.seconds = 1;");
    expect(range).toContain("srcOut.seconds = 3;");
  });

  it("passes a Boolean removal flag to encodeProjectItem", async () => {
    const item = { item_id: "item-1", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr" };
    const keep = await scriptFor(exports.encode_project_item, { ...item, remove_on_completion: false });
    const remove = await scriptFor(exports.encode_project_item, item);

    expect(keep).toMatch(/ENCODE_IN_TO_OUT,\s*false\s*\)/);
    expect(remove).toMatch(/ENCODE_IN_TO_OUT,\s*true\s*\)/);
  });

  it("passes a Boolean removal flag from manage_proxies create and encodeSequence", async () => {
    const proxy = await scriptFor(exports.manage_proxies, {
      item_id: "item-1",
      action: "create",
      output_path: "/tmp/proxy.mov",
      preset_path: "/tmp/proxy.epr",
    });
    const queued = await scriptFor(exports.add_to_render_queue, {
      output_path: "/tmp/render.mp4",
      preset_path: temporaryPreset(),
    });

    expect(proxy).toMatch(/ENCODE_ENTIRE,\s*true\s*\)/);
    expect(proxy).not.toMatch(/ENCODE_ENTIRE,\s*1\s*\)/);
    expect(queued).toContain("encoder.encodeSequence(");
    expect(queued).toContain("true // removeUponCompletion");
    expect(queued).not.toMatch(/encodeSequence\([\s\S]*\b1\s*\/\/\s*removeOnCompletion/);
  });

  it("escapes a user preset path before embedding it", async () => {
    const script = await scriptFor(exports.encode_file, { ...base, preset_path: 'C:\\p\\a"b.epr' });
    expect(script).toContain('new File("C:\\\\p\\\\a\\"b.epr")');
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/322
describe("issue #322 — marker filtering retains the requested sequence collection", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("resolves the requested sequence once and returns its identity with the marker set", async () => {
    const script = await scriptFor(utility.get_sequence_markers_by_type, {
      sequence_id: "target-sequence", marker_type: "Comment",
    });

    expect(script).toContain('var seq = __findSequence("target-sequence")');
    expect(script).toContain("var selectedSequence = { id: String(seq.sequenceID)");
    expect(script).toContain("var markerCollection = seq.markers");
    expect(script).toContain("markerCollection.getFirstMarker()");
    expect(script).toContain("markerCollection.getNextMarker(m)");
    expect(script).toContain("sequence: selectedSequence");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/323
describe("issue #323 — AME handoffs are unverified until a queue or file readback", () => {
  const exports = getExportTools(bridgeOptions);
  const project = getProjectTools(bridgeOptions);

  it("does not present AME acceptance as a queued, started, or completed encode", async () => {
    const render = await scriptFor(exports.add_to_render_queue, { output_path: "/tmp/render.mp4", preset_path: temporaryPreset() });
    const item = await scriptFor(exports.encode_project_item, {
      item_id: "item-1", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr",
    });
    const proxy = await scriptFor(exports.manage_proxies, {
      item_id: "item-1", action: "create", output_path: "/tmp/proxy.mov", preset_path: "/tmp/proxy.epr",
    });
    const file = await scriptFor(exports.encode_file, {
      input_path: "/tmp/source.mov", output_path: "/tmp/render.mp4", preset_path: "/tmp/preset.epr",
    });
    const batch = await scriptFor(project.start_batch_encode, {});

    for (const script of [render, item, proxy, file]) {
      expect(script).toContain('if (!jobId || String(jobId) === "0") return __error');
      expect(script).toContain("accepted: true");
      expect(script).toContain('outcome: "committed_unverified"');
      expect(script).not.toContain("queued: true");
    }
    expect(batch).toContain("requested: true");
    expect(batch).toContain('outcome: "committed_unverified"');
    expect(batch).not.toContain("started: true");
    expect(batch).toContain("var startResult = app.encoder.startBatch()");
    expect(batch).toContain("if (startResult !== 1 && startResult !== true)");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/324
describe("issue #324 — duplicate media requires distinct project-item node IDs", () => {
  const utility = getUtilityTools(bridgeOptions);

  it("deduplicates each media path by stable node ID before forming a group", async () => {
    const script = await scriptFor(utility.get_duplicate_media, {});

    expect(script).toContain("var nodeId = String(item.nodeId || \"\")");
    expect(script).toContain("items: [], nodeIds: {} }");
    expect(script).toContain("if (!pathMap[key].nodeIds[nodeId])");
    expect(script).toContain("group.items.length > 1");
    expect(script).not.toContain("pathMap[path].length > 1");
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/326
describe("issue #326 — sequence creation requires project-collection readback", () => {
  const sequence = getSequenceTools(bridgeOptions);

  it("does not report a QE-active sequence as created unless it is discoverable", async () => {
    const script = await scriptFor(sequence.create_sequence, {
      name: "Verified Sequence", preset_path: join(process.cwd(), "package.json"),
    });
    expect(script).toContain("var beforeSequenceIds = {}");
    expect(script).toContain("var sequenceId = String(seq.sequenceID)");
    expect(script).toContain("if (beforeSequenceIds[sequenceId])");
    expect(script).toContain("did not create a new sequence");
    expect(script).toContain("var created = __findSequence(sequenceId)");
    expect(script).toContain("no creation success is reported");
    expect(script).toContain("verified: true");
  });

  it("applies the same new-ID readback to create_sequence_from_preset", async () => {
    const script = await scriptFor(sequence.create_sequence_from_preset, {
      name: "Interview", preset_path: join(process.cwd(), "package.json"),
    });
    expect(script).toContain("var beforeSequenceIds = {}");
    expect(script).toContain("if (beforeSequenceIds[sequenceId])");
    expect(script).toContain("did not create a new sequence");
    expect(script).toContain("var created = __findSequence(sequenceId)");
    expect(script).toContain("no creation success is reported");
    expect(script).toContain("verified: true");
  });

  it("fails closed when create_sequence_from_preset would claim the already-active sequence", async () => {
    const existing = { name: "Interview", sequenceID: "seq-existing" };
    const sequences = new Proxy({}, {
      get: (_t, k) => (k === "numSequences" ? 1 : existing),
    });
    mockedSendCommand.mockImplementation(async (script: string) =>
      JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
        app: {
          enableQE() {},
          project: { sequences, activeSequence: existing },
        },
        qe: { project: { newSequence() {} } },
      }))));

    await expect(sequence.create_sequence_from_preset.handler({
      name: "Interview",
      preset_path: join(process.cwd(), "package.json"),
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("already existed before the preset request"),
    });
  });

  it.each([false, true])("verifies a fresh active sequence only when present in the collection (%s)", async (listed) => {
    const existing = { name: "Old", sequenceID: "seq-existing" };
    const created = { name: "Interview", sequenceID: "seq-created" };
    const items = [existing];
    const project = {
      activeSequence: existing,
      sequences: new Proxy({}, { get: (_t, k) => k === "numSequences" ? items.length : items[Number(k)] }),
    };
    mockedSendCommand.mockImplementation(async (script: string) =>
      JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
        app: { enableQE() {}, project },
        qe: { project: { newSequence() { project.activeSequence = created; if (listed) items.push(created); } } },
      }))));
    const result = await sequence.create_sequence_from_preset.handler({ name: "Interview", preset_path: join(process.cwd(), "package.json") });
    if (listed) {
      expect(result).toMatchObject({ success: true, data: { created: true, verified: true, id: "seq-created", name: "Interview" } });
    } else {
      expect(result).toMatchObject({ success: false, error: expect.stringContaining("did not add the new sequence to the project collection") });
    }
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/327
describe("issue #327 — legacy media replacement is fail-closed", () => {
  const clipboard = getClipboardTools(bridgeOptions);

  it("never uses overwriteClip when duration and adjacent-track preservation cannot be verified", async () => {
    expect(clipboard.replace_clip_media.operationalCapability).toMatchObject({
      backend: "local", backends: ["local"], status: "unsupported", hostVerificationRequired: false,
    });
    const result = await clipboard.replace_clip_media.handler({ clip_node_id: "clip-1", new_item_id: "item-2" } as never);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("No mutation was attempted") });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

// QE still-frame export on Premiere 26.5 / 27 (macOS, verified 2026-09-12 against a
// hold-keyframe camera switch): exportFramePNG/exportFrameJPEG take
// (timecodeString, pathWithoutExtension). A (path, width, height) call returns false
// and writes nothing; a ticks string exports frame 0. And /Applications/<Adobe app>/
// is a plain folder holding the .app bundle, so Contents lives one level down.
describe("QE still frames are addressed by timecode and macOS bundles are resolved one level down", () => {
  it("formats the frame with Time.getFormatted in the sequence display format and strips the extension", () => {
    const helpers = getHelpersSource();

    expect(helpers).toContain("function __qeTimecodeForTicks(");
    expect(helpers).toContain("getFormatted(fr, displayFormat)");
    expect(helpers).toContain("fn.call(qeSeq, at.timecode, qeBase)");
    expect(helpers).not.toContain("fn.call(qeSeq, outputPath, w, h)");
    // The timecode argument alone selects the frame; the editor's playhead is left alone.
    expect(helpers).not.toContain("seq.setPlayerPosition(String(ticks))");
  });

  it("looks for Contents inside <app folder>/<name>.app on macOS", () => {
    const helpers = getHelpersSource();

    expect(helpers).toContain("/\\.app$/i");
    expect(helpers).toContain('"/Contents/" + relativePath');
  });
});

// https://github.com/leancoderkavy/premiere-pro-mcp/issues/503
describe("issue #503 — trim_clip partial write rollback prevents clip corruption", () => {
  const timeline = getTimelineTools(bridgeOptions);

  it("captures original source points before attempting trim", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    expect(script).toContain("var originalInPointTicks = String(clip.inPoint.ticks)");
    expect(script).toContain("var originalOutPointTicks = String(clip.outPoint.ticks)");
  });

  it("detects partial write when source metadata changed but timeline didn't move", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    expect(script).toContain("var sourceMetadataChanged = afterInTicks !== originalInPointTicks || afterOutTicks !== originalOutPointTicks");
    expect(script).toContain("var timelineMoved = afterStartTicks !== originalStartTicks || afterEndTicks !== originalEndTicks");
  });

  it("rolls back source metadata when partial write is detected", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    expect(script).toContain("if (sourceMetadataChanged || timelineMoved)");
    expect(script).toContain("restoredIn.ticks = originalInPointTicks");
    expect(script).toContain("restoredOut.ticks = originalOutPointTicks");
    expect(script).toContain("afterResult.clip.inPoint = restoredIn");
    expect(script).toContain("afterResult.clip.outPoint = restoredOut");
  });

  it("verifies rollback succeeded before reporting the error", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    expect(script).toContain("var rolledBack = __findClip");
    expect(script).toContain("var rollbackSucceeded = String(rolledBack.clip.inPoint.ticks) === originalInPointTicks");
    expect(script).toContain("String(rolledBack.clip.outPoint.ticks) === originalOutPointTicks");
  });

  it("explains partial write with rollback and provides workaround guidance", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    expect(script).toContain("The write partially changed source metadata without moving the timeline edge");
    expect(script).toContain("would poison the clip for future trims");
    expect(script).toContain("The source metadata was rolled back to its original state");
    expect(script).toContain("set in/out on Source Monitor before placing via create_sequence_from_clips");
  });

  it("distinguishes between partial write (rollback) and no-op (no rollback needed)", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    // Partial write path: sourceMetadataChanged is true
    expect(script).toContain("if (sourceMetadataChanged || timelineMoved)");
    expect(script).toContain("rolled back to its original state");

    // No-op path: sourceMetadataChanged is false
    expect(script).toContain("The source metadata was unchanged, so the clip remains consistent");
  });

  it("reports rollback verification failure distinctly", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    expect(script).toContain("rollback of source metadata could not be verified");
    expect(script).toContain("The clip may be in an inconsistent state");
    expect(script).toContain("Use Undo to restore it");
  });

  it("handles clip not found after partial write", async () => {
    const script = await scriptFor(timeline.trim_clip, { node_id: "clip-1", new_in_seconds: 0.3 });

    expect(script).toContain("the clip could not be re-found for rollback");
  });
});

describe("sequence settings setters verify their readback", () => {
  const utility = getUtilityTools(bridgeOptions);
  const run = async (tool: { handler: (args: never) => Promise<unknown> }, args: unknown, accept: boolean) => {
    const settings: Record<string, number> = { videoFrameWidth: 1920, videoFrameHeight: 1080, videoFieldType: 0, videoDisplayFormat: 1, audioDisplayFormat: 0 };
    const script = await scriptFor(tool, args);
    return JSON.parse(String(runInNewContext(`${getHelpersSource()}\n${script}`, {
      app: { project: { activeSequence: { name: "Seq", getSettings: () => ({ ...settings }), setSettings: (next: Record<string, number>) => { if (accept) Object.assign(settings, next); } } } },
    })));
  };

  it("fails when Premiere ignores a frame size, field type or display format", async () => {
    await expect(run(utility.set_sequence_resolution, { width: 1080, height: 1920 }, true)).resolves.toMatchObject({ success: true, data: { verified: true } });
    await expect(run(utility.set_sequence_resolution, { width: 1080, height: 1920 }, false)).resolves.toMatchObject({ success: false, error: expect.stringContaining("got 1920x1080") });
    await expect(run(utility.set_sequence_field_type, { field_type: 1 }, false)).resolves.toMatchObject({ success: false, error: expect.stringContaining("field type") });
    await expect(run(utility.set_sequence_display_format, { video_display_format: 9 }, false)).resolves.toMatchObject({ success: false, error: expect.stringContaining("video display format") });
    await expect(run(utility.set_sequence_display_format, { video_display_format: 9, audio_display_format: 1 }, true)).resolves.toMatchObject({ success: true, data: { videoDisplayFormat: 9, audioDisplayFormat: 1, verified: true } });
  });

  it("rejects out-of-range values before touching the host", async () => {
    await expect(utility.set_sequence_resolution.handler({ width: 0, height: 1080 })).resolves.toMatchObject({ success: false });
    await expect(utility.set_sequence_field_type.handler({ field_type: 7 })).resolves.toMatchObject({ success: false });
    await expect(utility.set_sequence_display_format.handler({})).resolves.toMatchObject({ success: false });
    expect(mockedSendCommand).not.toHaveBeenCalled();
  });
});

describe("#712 rework: media bound from real ffprobe duration (owner review)", () => {
  it("the media bound comes from ffprobe duration, not the editable source Out mark", async () => {
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "C:/media/clip.mp4" } } as never);
    const tools = getTimelineTools(bridgeOptions, { probeMediaDurationSeconds: async () => 10 });
    await tools.trim_clip.handler({ node_id: "clip-1", new_out_seconds: 15 });
    const script = mockedSendCommand.mock.calls.at(-1)[0] as string;
    expect(script).toContain("__secondsToTicks(targetOut) > 2540160000000");
    expect(script).toContain('real media duration of 10.000s (ffprobe)');
    expect(script).not.toContain("projectItem.getOutPoint()");
  });

  it("does not infer unlimited still media from an image filename when duration is unknown", async () => {
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "C:/media/still.png" } } as never);
    const tools = getTimelineTools(bridgeOptions, { probeMediaDurationSeconds: async () => null });
    await expect(tools.trim_clip.handler({ node_id: "clip-1", new_out_seconds: 15 })).resolves.toMatchObject({ success: false, error: expect.stringContaining("Physical media duration") });
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });

  it("slip_edit carries the same ffprobe-evidence bound", async () => {
    vi.mocked(sendCommand).mockResolvedValueOnce({ success: true, data: { projectId: "project", sequenceId: "seq", mediaPath: "C:/media/clip.mp4" } } as never);
    const tools = getAdvancedTools(bridgeOptions, { probeMediaDurationSeconds: async () => 10 });
    await tools.slip_edit.handler({ node_id: "clip-1", offset_seconds: 2 });
    const script = mockedSendCommand.mock.calls.at(-1)[0] as string;
    expect(script).toContain("past this clip's real media duration of 10.000s (ffprobe)");
  });
});

describe("source evidence preserves lookup failures", () => {
  it.each(["trim", "slip"])("%s preserves a missing-clip error and never probes or mutates", async operation => {
    const failure = { success: false, error: "Clip not found" };
    mockedSendCommand.mockResolvedValueOnce(failure);
    const probe = vi.fn().mockResolvedValue(10);
    const tool = operation === "trim"
      ? getTimelineTools(bridgeOptions, { probeMediaDurationSeconds: probe }).trim_clip
      : getAdvancedTools(bridgeOptions, { probeMediaDurationSeconds: probe }).slip_edit;
    const args = operation === "trim" ? { node_id: "missing", new_out_seconds: 12 } : { node_id: "missing", offset_seconds: 2 };
    await expect(tool.handler(args as never)).resolves.toEqual(failure);
    expect(probe).not.toHaveBeenCalled();
    expect(mockedSendCommand).toHaveBeenCalledTimes(1);
  });
});
