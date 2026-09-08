import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCaptionAuthoringTools, MAX_INLINE_ARTIFACT_BYTES, resolveContainedOutputPath } from "../../src/tools/caption-authoring.js";

const revision = `sha256:${"b".repeat(64)}`;
const word = (text: string, start: number, end: number) => ({ text, start_seconds: start, end_seconds: end });
const FIXTURE = {
  source_project_item_id: "clip-1",
  transcript_revision: revision,
  words: [word("Hello", 0, 0.4), word("world,", 0.45, 0.8), word("this", 0.9, 1.1), word("is", 1.1, 1.2), word("a", 1.2, 1.3), word("test.", 1.3, 1.8), word("Captions", 2.5, 3.0), word("rock!", 3.0, 3.4)],
};

type Schema = { type?: string; description?: string; properties?: Record<string, Schema>; items?: Schema; required?: string[] };
function assertSchema(schema: Schema, path: string) {
  expect(schema.type, `${path} has a type`).toBeTruthy();
  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      expect(child.type, `${path}.${key} has a type`).toBeTruthy();
      expect(child.description, `${path}.${key} has a description`).toBeTruthy();
      assertSchema(child, `${path}.${key}`);
    }
    for (const name of schema.required ?? []) expect(schema.properties[name], `${path} required ${name} exists`).toBeTruthy();
  }
  if (schema.items) assertSchema(schema.items, `${path}[]`);
}

const tools = getCaptionAuthoringTools();

describe("caption authoring tool schemas", () => {
  it("exposes exactly the two expected tools", () => {
    expect(Object.keys(tools).sort()).toEqual(["build_caption_artifact", "check_caption_safe_zone"]);
  });

  it.each(Object.entries(tools))("%s has a bounded, fully described schema", (name, tool) => {
    expect(tool.description.length).toBeLessThan(400);
    expect(tool.description).toMatch(/never|local/i);
    expect(tool.parameters.type).toBe("object");
    expect(tool.parameters.additionalProperties).toBe(false);
    assertSchema(tool.parameters as Schema, name);
    expect(tool.parameters.required.length).toBeGreaterThan(0);
  });

  it("bounds every array and enum", () => {
    const build = tools.build_caption_artifact.parameters.properties;
    expect(build.emphasis_words.maxItems).toBe(128);
    expect(build.strip_fillers.maxItems).toBe(64);
    expect(build.format.enum).toEqual(["srt", "vtt"]);
    expect(build.style_preset.enum).toEqual(["clean", "bold_pop", "karaoke", "podcast", "lecture"]);
    const check = tools.check_caption_safe_zone.parameters.properties;
    expect(check.elements.maxItems).toBe(64);
    expect(check.platform.enum).toEqual(["tiktok", "instagram_reels", "youtube_shorts", "instagram_feed", "youtube", "linkedin", "x"]);
  });
});

describe("build_caption_artifact handler", () => {
  let workspace: string;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "caption-authoring-"));
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("returns the artifact inline with plan metadata", async () => {
    const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cue_count).toBe(3);
    expect(typeof result.data.artifact).toBe("string");
    expect(result.data.artifact).toMatch(/^1\n00:00:00,000 --> 00:00:01,100\nHello world, this\n/);
    expect(result.data.applied).toBe(false);
    expect(result.data.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.data.routes).toEqual(["create_caption_track", "read_sequence_captions", "inspect_caption_tracks_uxp"]);
    expect(result.data.evidence.transcript_revision).toBe(revision);
    expect(result.data.style.preset).toBe("clean");
    expect(result.data.next_steps.length).toBe(2);
  });

  it("is deterministic across calls", async () => {
    const first = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "vtt", karaoke: true });
    const second = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "vtt", karaoke: true });
    expect(first).toEqual(second);
  });

  it("writes the artifact into an approved workspace with a digest", async () => {
    const output = join(workspace, "captions.vtt");
    const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "vtt", output_path: output, approved_workspace_path: workspace });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const artifact = result.data.artifact as { path: string; bytes: number; sha256: string };
    const written = readFileSync(artifact.path, "utf8");
    expect(written.startsWith("WEBVTT\n\n")).toBe(true);
    expect(artifact.bytes).toBe(Buffer.byteLength(written, "utf8"));
    expect(artifact.sha256).toBe(createHash("sha256").update(written, "utf8").digest("hex"));
    expect(result.data.warnings).toEqual([]);
  });

  it("warns when the extension does not match the format", async () => {
    const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(workspace, "captions.vtt"), approved_workspace_path: workspace });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.warnings.some((entry: string) => /does not match format srt/.test(entry))).toBe(true);
  });

  it("refuses to overwrite an existing file", async () => {
    const output = join(workspace, "existing.srt");
    writeFileSync(output, "keep me", "utf8");
    const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: output, approved_workspace_path: workspace });
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/already exists/) });
    expect(readFileSync(output, "utf8")).toBe("keep me");
  });

  it("rejects an output path outside the workspace", async () => {
    const outside = mkdtempSync(join(tmpdir(), "caption-outside-"));
    try {
      const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(outside, "captions.srt"), approved_workspace_path: workspace });
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/contained within approved_workspace_path/) });
      const traversal = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(workspace, "..", "escape.srt"), approved_workspace_path: workspace });
      expect(traversal.success).toBe(false);
      expect(existsSync(join(outside, "captions.srt"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects symlinked parents that resolve outside the workspace", async () => {
    const outside = mkdtempSync(join(tmpdir(), "caption-symlink-"));
    try {
      symlinkSync(outside, join(workspace, "link"), process.platform === "win32" ? "junction" : "dir");
      const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(workspace, "link", "captions.srt"), approved_workspace_path: workspace });
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/contained within/) });
      expect(existsSync(join(outside, "captions.srt"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("allows nested directories inside the workspace", async () => {
    mkdirSync(join(workspace, "out", "deep"), { recursive: true });
    const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(workspace, "out", "deep", "captions.srt"), approved_workspace_path: workspace });
    expect(result.success).toBe(true);
    expect(existsSync(join(workspace, "out", "deep", "captions.srt"))).toBe(true);
  });

  it("requires approved_workspace_path with output_path and vice versa", async () => {
    expect(await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(workspace, "a.srt") })).toMatchObject({ success: false, error: expect.stringMatching(/approved_workspace_path is required/) });
    expect(await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", approved_workspace_path: workspace })).toMatchObject({ success: false, error: expect.stringMatching(/only accepted together with output_path/) });
    expect(await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: "relative.srt", approved_workspace_path: workspace })).toMatchObject({ success: false, error: expect.stringMatching(/absolute path/) });
    expect(await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(workspace, "missing-dir", "a.srt"), approved_workspace_path: workspace })).toMatchObject({ success: false, error: expect.stringMatching(/parent directory must already exist/) });
    expect(await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", output_path: join(workspace, "a.srt"), approved_workspace_path: join(workspace, "nope") })).toMatchObject({ success: false, error: expect.stringMatching(/existing directory/) });
  });

  it("does not write a file when the caption options are invalid", async () => {
    const output = join(workspace, "never.srt");
    const result = await tools.build_caption_artifact.handler({ word_timeline: FIXTURE, format: "srt", karaoke: true, output_path: output, approved_workspace_path: workspace });
    expect(result.success).toBe(false);
    expect(existsSync(output)).toBe(false);
  });

  it("caps inline output and points the caller at output_path", async () => {
    const words = Array.from({ length: 6_000 }, (_, index) => word("w".repeat(100), index * 0.5, index * 0.5 + 0.4));
    const result = await tools.build_caption_artifact.handler({ word_timeline: { ...FIXTURE, words }, format: "srt", words_per_cue: 1, max_chars_per_line: 80 });
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(new RegExp(`${MAX_INLINE_ARTIFACT_BYTES}-byte inline limit.*output_path`)) });
  });

  it.each([
    [{}, /word_timeline must be an object/],
    [{ word_timeline: FIXTURE }, /format must be one of/],
    [{ word_timeline: FIXTURE, format: "srt", karaoke: true }, /karaoke/],
    [{ word_timeline: FIXTURE, format: "srt", words_per_cue: 99 }, /words_per_cue/],
    [{ word_timeline: { ...FIXTURE, words: [] }, format: "srt" }, /between 1 and/],
    [{ word_timeline: FIXTURE, format: "srt", emphasis_words: [1] }, /emphasis_words\[0\]/],
  ])("returns success:false for invalid args %#", async (args, message) => {
    const result = await tools.build_caption_artifact.handler(args as Record<string, unknown>);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(message);
  });

  it("resolveContainedOutputPath rejects directory-like names", () => {
    expect(() => resolveContainedOutputPath(workspace, `${workspace}/`)).toThrow(/must name a file|contained within/);
    expect(() => resolveContainedOutputPath(workspace, workspace)).toThrow(/must name a file|contained within|already exists/);
    expect(() => resolveContainedOutputPath(workspace, `${workspace}/..`)).toThrow(/must name a file/);
    expect(() => resolveContainedOutputPath(workspace, join(workspace, ".."))).toThrow(/contained within/);
  });
});

describe("check_caption_safe_zone handler", () => {
  it("returns per-element reports with routes", async () => {
    const result = await tools.check_caption_safe_zone.handler({
      platform: "youtube_shorts",
      frame: { width: 1080, height: 1920 },
      elements: [
        { id: "caption", x: 0.1, y: 0.88, width: 0.8, height: 0.08, kind: "caption" },
        { id: "logo", x: 0.05, y: 0.1, width: 0.15, height: 0.08, kind: "logo" },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.all_safe).toBe(false);
    expect(result.data.elements.map((element: { id: string; safe: boolean }) => [element.id, element.safe])).toEqual([["caption", false], ["logo", true]]);
    expect(result.data.elements[0].overlaps).toEqual([{ zone_id: "bottom_caption_area", overlap_ratio: 1 }]);
    expect(result.data.elements[0].suggested_position).toEqual({ x: 0.06, y: 0.74 });
    expect(result.data.recommended_caption_anchor).toEqual({ x: 0.5, y: 0.7 });
    expect(result.data.applied).toBe(false);
    expect(result.data.routes).toEqual(["set_clip_position", "transform_track_item_uxp", "export_sequence_review_frames", "create_caption_track"]);
    expect(result.data.assumptions.some((entry: string) => /verify against current platform overlay guides/.test(entry))).toBe(true);
    expect(result.data.plan_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each([
    [{}, /platform must be one of/],
    [{ platform: "tiktok" }, /frame must be an object/],
    [{ platform: "tiktok", frame: { width: 1080, height: 1920 } }, /elements must contain/],
    [{ platform: "tiktok", frame: { width: 1080, height: 1920 }, elements: [{ id: "a", x: 2, y: 0, width: 0.1, height: 0.1, kind: "logo" }] }, /elements\[0\]\.x/],
  ])("returns success:false for invalid args %#", async (args, message) => {
    const result = await tools.check_caption_safe_zone.handler(args as Record<string, unknown>);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(message);
  });

  it("never throws on hostile argument shapes", async () => {
    for (const args of [null, undefined, 42, "text", [], [FIXTURE]]) {
      const result = await tools.check_caption_safe_zone.handler(args as never);
      expect(result.success).toBe(false);
      expect(result.error).toBe("arguments must be an object");
      const build = await tools.build_caption_artifact.handler(args as never);
      expect(build.success).toBe(false);
      expect(build.error).toBe("arguments must be an object");
    }
  });
});
