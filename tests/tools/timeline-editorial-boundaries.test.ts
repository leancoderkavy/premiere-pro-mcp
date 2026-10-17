import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { rmSync, writeFileSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { cleanupTempDirs, makePrivateBridgeTempDir, makeTempDir } from "../helpers/temp-dir.js";
import { getTimelineEditorialTools } from "../../src/tools/timeline-editorial.js";
import { getExtendedEditPlanTools, validateExtendedEditPlan } from "../../src/tools/extended-edit-plans.js";
import { getSceneReviewWorkflowTools } from "../../src/tools/scene-review-workflow.js";
import { snapshotRevision, predictEdits, type TimelineSnapshot } from "../../src/ai/timeline-contract.js";
import { secondsToTicks } from "../../src/ai/exact-time.js";
import { resolveCapabilities } from "../../src/security/capabilities.js";
import { inspectWindowsBridgeDirectoryAcl } from "../../src/bridge/file-bridge.js";

const workspace = () => makeTempDir("editorial-boundary-");
const privateWorkspace = () => makePrivateBridgeTempDir("editorial-boundary-");
afterEach(cleanupTempDirs);
const ok = (data: unknown) => ({ success: true, data });
const no = (error: string) => ({ success: false, error });
const sec = secondsToTicks;
function snapshot(): TimelineSnapshot {
  const s: TimelineSnapshot = { schema_version: 1, backend: "cep", project_id: "p", sequence_id: "s", session_id: "session", revision: "", frame_rate: { numerator: 24, denominator: 1 }, display_start_ticks: "0", tracks: [{ id: "video:0", type: "video", index: 0, locked: false, sync_locked: true, targeted: true, muted: false }, { id: "audio:0", type: "audio", index: 0, locked: false, sync_locked: true, targeted: false, muted: false }], clips: [{ id: "clip", source_id: "source", track_id: "video:0", start_ticks: "0", end_ticks: sec(2), in_ticks: sec(1), out_ticks: sec(3), source_duration_ticks: sec(60), speed: { numerator: 1, denominator: 1 }, reversed: false, enabled: true, linked_ids: [], identity: "host", effects: [], nested: false }], completeness: { clips: true, links: true, locks: true, effects: true, transitions: true, markers: true }, transitions: [], markers: [], pagination: { offset: 0, total: 1, next_offset: null } }; return revise(s);
}
const revise = (s: TimelineSnapshot) => { s.pagination.total = s.clips.length; s.revision = snapshotRevision(s); return s; };
const enablePlan = (s = snapshot()) => ({ project_path: "/project.prproj", snapshot: s, steps: [{ tool: "enable_disable_clip", clip_id: "clip", args: { node_id: "clip", enabled: false } }] });

describe("local tool evidence boundaries", () => {
  it("exposes word occurrences and measured caption evidence without dispatch", async () => {
    const send = vi.fn(), tools = getTimelineEditorialTools({}, { send });
    expect(await tools.map_word_timeline_occurrences.handler({ word_timeline: { source_project_item_id: "source", transcript_revision: `sha256:${"a".repeat(64)}`, words: [{ text: "Hello", start_seconds: 1.5, end_seconds: 2 }] }, snapshot: snapshot() })).toMatchObject({ data: { occurrences: [{ occurrence_id: "clip:0", sequence_start_ticks: sec(0.5) }] } });
    expect(await tools.verify_caption_render_evidence.handler({ evidence: { artifact_sha256: "a".repeat(64), frame_width: 1920, frame_height: 1080, safe_margin: 0.1, cues: [{ text: "Hello", bounds: { x: 200, y: 200, width: 300, height: 80 }, missing_glyphs: [], line_breaks_verified: true, bidi_verified: true, sampled_ticks: "0", evidence_method: "manual_render_review" }] } })).toMatchObject({ data: { passed: true } });
    expect(send).not.toHaveBeenCalled();
    for (const input of [{ value: "1", from: "frames", to: "timecode" }, { value: "0.5", from: "seconds", to: "ticks" }]) expect(await tools.convert_timeline_time.handler({ ...input, frame_rate: { numerator: 24, denominator: 1 } })).toMatchObject({ success: true });
    expect(await tools.convert_timeline_time.handler({ value: "1", from: "invalid", to: "ticks", frame_rate: { numerator: 24, denominator: 1 } })).toMatchObject({ success: false });
    expect(await tools.convert_timeline_time.handler({ value: "1", from: "ticks", to: "invalid", frame_rate: { numerator: 24, denominator: 1 } })).toMatchObject({ success: false });
    expect(await tools.plan_media_synchronization.handler({ method: "audio", reference_ticks: ["0"] })).toMatchObject({ success: false });
  });
  it("refuses handoff mismatches, unresolved containers and malformed inventory", async () => {
    const root = workspace(), tools = getTimelineEditorialTools({ tempDir: root }); writeFileSync(path.join(root, "edit.prproj"), "123"); mkdirSync(path.join(root, "folder"));
    const dep = { source_id: "p", relative_path: "edit.prproj", kind: "project", expected_bytes: "4", enumerated: true };
    expect(await tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [dep], inventory_complete: true })).toMatchObject({ data: { complete: false, dependencies: [{ status: "byte_mismatch", observed_bytes: "3" }] } });
    expect(await tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [{ ...dep, relative_path: "folder", expected_bytes: null }], inventory_complete: true })).toMatchObject({ data: { dependencies: [{ status: "unresolved_container" }] } });
    expect(await tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [{ ...dep, expected_bytes: null, enumerated: false }], inventory_complete: true })).toMatchObject({ data: { dependencies: [{ status: "unresolved_dependencies" }] } });
    for (const input of [ { approved_workspace_path: "relative", dependencies: [], inventory_complete: true }, { approved_workspace_path: path.join(root, "edit.prproj"), dependencies: [], inventory_complete: true }, { approved_workspace_path: root, dependencies: [dep, dep], inventory_complete: true }, { approved_workspace_path: root, dependencies: [{ ...dep, expected_bytes: "-1" }], inventory_complete: true }, { approved_workspace_path: root, dependencies: [{ ...dep, kind: "unknown" }], inventory_complete: true }, { approved_workspace_path: root, dependencies: [{ ...dep, relative_path: "/absolute" }], inventory_complete: true } ]) await expect(tools.build_project_handoff_manifest.handler(input)).rejects.toThrow();
  });
  it("keeps checkpoints private and refuses symlinked or oversized records", async () => {
    const root = privateWorkspace(), tools = getTimelineEditorialTools({ tempDir: root }); const checkpoint = { schema_version: 1, project_id: "p", sequence_id: "s", snapshot_revision: "r", backup_reference: "backup", sequence_checkpoint_reference: null, operations: [{ operation_id: "done", tool: "enable_disable_clip", state: "completed", receipt_digest: null }] };
    const saved = await tools.save_workflow_checkpoint.handler({ checkpoint }), file = path.join(root, `workflow-checkpoint-${saved.data.checkpoint_id}.json`);
    // Node's POSIX mode bits cannot describe the inherited Windows file ACL.
    if (process.platform === "win32") {
      const acl = inspectWindowsBridgeDirectoryAcl(file, false, { file: true, readAccess: true });
      expect(acl.currentUserSid).toMatch(/^S-1-/);
      expect(acl.unsafeWriteAces).toEqual([]);
      expect(acl.unsafeAncestorEntries).toEqual([]);
    } else expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await tools.inspect_workflow_checkpoint.handler({ checkpoint_id: saved.data.checkpoint_id })).toMatchObject({ data: { checkpoint: { automatic_replay: false, recovery_required: false } } });
    rmSync(file); const outside = workspace(); writeFileSync(path.join(outside, "record"), "{}"); symlinkSync(path.join(outside, "record"), file); await expect(tools.inspect_workflow_checkpoint.handler({ checkpoint_id: saved.data.checkpoint_id })).rejects.toThrow("bounded regular"); rmSync(file); writeFileSync(file, "x".repeat(1024 * 1024 + 1)); await expect(tools.inspect_workflow_checkpoint.handler({ checkpoint_id: saved.data.checkpoint_id })).rejects.toThrow("bounded regular");
  });
});

describe("compound token and dispatch boundaries", () => {
  it("expires tokens, refuses stale or absent preflight receipts, and reclaims expired previews", async () => {
    let now = 0; const handler = vi.fn(async () => ok({ verified: true })), send = vi.fn(async () => ok({ targetsValidated: true })); const catalog: any = { enable_disable_clip: { handler } }, tools = getExtendedEditPlanTools({}, { now: () => now, send, getToolCatalog: () => catalog });
    const first = await tools.preview_extended_edit_plan.handler({ plan: enablePlan() }); now = 600001; await expect(tools.apply_extended_edit_plan.handler({ confirmation_token: first.data.confirmation_token })).rejects.toThrow("expired"); expect(handler).not.toHaveBeenCalled();
    const second = await tools.preview_extended_edit_plan.handler({ plan: enablePlan() }); send.mockResolvedValueOnce(no("changed project") as any); expect(await tools.apply_extended_edit_plan.handler({ confirmation_token: second.data.confirmation_token })).toMatchObject({ success: false, error: "changed project" }); expect(handler).not.toHaveBeenCalled();
    const third = await tools.preview_extended_edit_plan.handler({ plan: enablePlan() }); send.mockResolvedValueOnce(ok({}) as any); expect(await tools.apply_extended_edit_plan.handler({ confirmation_token: third.data.confirmation_token })).toMatchObject({ success: false, error: expect.stringContaining("validation readback") }); expect(handler).not.toHaveBeenCalled();
    send.mockResolvedValueOnce(no("offline") as any); expect(await tools.preview_extended_edit_plan.handler({ plan: enablePlan() })).toMatchObject({ success: false });
    const full = getExtendedEditPlanTools({}, { now: () => now, send, getToolCatalog: () => catalog }); for (let i = 0; i < 100; i++) await full.preview_extended_edit_plan.handler({ plan: enablePlan() }); await expect(full.preview_extended_edit_plan.handler({ plan: enablePlan() })).rejects.toThrow("Too many"); now += 600001; expect(await full.preview_extended_edit_plan.handler({ plan: enablePlan() })).toMatchObject({ success: true });
    delete catalog.enable_disable_clip; await expect(tools.preview_extended_edit_plan.handler({ plan: enablePlan() })).rejects.toThrow("unavailable");
  });
  it("retains completed steps on an exception or disappeared route without replay", async () => {
    const s = snapshot(); s.clips.push({ ...s.clips[0], id: "second", start_ticks: sec(3), end_ticks: sec(5) }); revise(s);
    const handler = vi.fn().mockResolvedValueOnce(ok({ verified: true })).mockRejectedValueOnce("transport lost"), catalog: any = { enable_disable_clip: { handler } }; const tools = getExtendedEditPlanTools({}, { send: async () => ok({ targetsValidated: true }), getToolCatalog: () => catalog }); const plan = { ...enablePlan(s), steps: [enablePlan(s).steps[0], { tool: "enable_disable_clip", clip_id: "second", args: { node_id: "second", enabled: false } }] };
    const preview = await tools.preview_extended_edit_plan.handler({ plan }); expect(await tools.apply_extended_edit_plan.handler({ confirmation_token: preview.data.confirmation_token })).toMatchObject({ success: false, error: "transport lost", data: { outcome: "unknown", completed: [{ index: 0 }], failed_index: 1, retry_safe: false } }); expect(handler).toHaveBeenCalledTimes(2);
    const other = await tools.preview_extended_edit_plan.handler({ plan }); delete catalog.enable_disable_clip; expect(await tools.apply_extended_edit_plan.handler({ confirmation_token: other.data.confirmation_token })).toMatchObject({ data: { outcome: "not_applied", completed: [] } });
    await expect(getExtendedEditPlanTools({}, { capabilities: resolveCapabilities("inspect") }).apply_extended_edit_plan.handler({ confirmation_token: "x" })).rejects.toThrow("edit");
  });
  it("runs preflight against actual host source/range/track identities", async () => {
    const s = snapshot(), clip: any = { projectItem: { nodeId: "source" }, start: { ticks: "0" }, end: { ticks: sec(2) }, inPoint: { ticks: sec(1) }, outPoint: { ticks: sec(3) } }, app = { project: { documentID: "p", path: "/project.prproj", activeSequence: { sequenceID: "s" } } };
    const send = vi.fn(async (script: string) => vm.runInNewContext(script, { app, File: function (this: { fsName: string }, p: string) { this.fsName = p; }, $: { os: "Mac OS" }, __findClip: () => ({ clip, trackType: "video", trackIndex: 0 }), __result: ok, __error: no })), tools = getExtendedEditPlanTools({}, { send, getToolCatalog: () => ({ enable_disable_clip: { handler: async () => ok({ verified: true }) } }) });
    expect(await tools.preview_extended_edit_plan.handler({ plan: enablePlan(s) })).toMatchObject({ success: true }); clip.projectItem.nodeId = "relinked"; expect(await tools.preview_extended_edit_plan.handler({ plan: enablePlan(s) })).toMatchObject({ success: false, error: expect.stringContaining("target changed") }); clip.projectItem.nodeId = "source"; app.project.documentID = "new"; expect(await tools.preview_extended_edit_plan.handler({ plan: enablePlan(s) })).toMatchObject({ success: false, error: expect.stringContaining("project/active sequence") });
  });
  it("refuses sliver splits, ambiguous descriptors and nonlinear keyframe writes", () => {
    const s = snapshot(), plan = (step: any) => ({ project_path: "/project.prproj", snapshot: s, steps: [step] });
    expect(() => predictEdits(s, [{ type: "split", clip_id: "clip", at_ticks: "1", right_id: "right" }])).toThrow("sliver");
    expect(() => validateExtendedEditPlan(plan({ tool: "split_clip", clip_id: "clip", args: { time_seconds: 0.01, track_type: "video", track_index: 0 } }))).toThrow("sliver");
    const trim = { tool: "trim_clip", clip_id: "clip", args: { node_id: "clip", new_in_seconds: 1.5, keyframe_policy: "preserve" } }; expect(validateExtendedEditPlan(plan(trim)).steps[0].args.include_linked).toBe(false);
    for (const step of [{ ...trim, args: { ...trim.args, new_out_seconds: 2 } }, { ...trim, args: { ...trim.args, include_linked: true } }, { ...trim, args: { ...trim.args, include_linked: "false" } }, { ...trim, args: { ...trim.args, keyframe_policy: "unknown" } }, { tool: "enable_disable_clip", clip_id: "clip", args: { node_id: "different", enabled: false } }, { tool: "enable_disable_clip", clip_id: "clip", args: { node_id: "clip", enabled: 0 } }]) expect(() => validateExtendedEditPlan(plan(step))).toThrow();
    s.clips[0].effects = [{ identity: "e", match_name: "Match", display_name: "Display", built_in: false, parameters: [{ identity: "p", display_name: "Value", type: "number", units: null, animated: false, writable: true }] }]; revise(s); const effect: any = { tool: "set_effect_property", clip_id: "clip", effect_identity: "e", parameter_identity: "p", args: { node_id: "clip", effect_name: "Match", property_name: "Value", property_index: 0, value: 2 } };
    s.clips[0].effects[0].parameters.push({ ...s.clips[0].effects[0].parameters[0], identity: "q" }); revise(s); expect(() => validateExtendedEditPlan(plan(effect))).toThrow("Duplicate parameter"); s.clips[0].effects[0].parameters.pop(); s.clips[0].effects[0].built_in = true; revise(s); expect(() => validateExtendedEditPlan(plan(effect))).toThrow("Built-in"); s.clips[0].effects[0].built_in = false; s.clips[0].effects[0].parameters[0].animated = true; revise(s); expect(() => validateExtendedEditPlan(plan(effect))).toThrow("animation");
    s.clips[0].effects[0].parameters[0].animated = false; revise(s); expect(() => validateExtendedEditPlan(plan({ ...effect, tool: "add_keyframe" }))).toThrow("explicit"); expect(() => validateExtendedEditPlan(plan({ ...effect, tool: "add_keyframe", time_domain: "source", time_ticks: "0" }))).toThrow("visible"); expect(() => validateExtendedEditPlan(plan({ ...effect, tool: "add_keyframe", time_domain: "source", time_ticks: sec(2), args: { ...effect.args, value: NaN } }))).toThrow("finite scalar");
  });
});

describe("source-scene recovery boundaries", () => {
  function fixture(mode: "markers" | "subclips" | "both" = "markers") { const root = workspace(); let now = 0; const catalog: any = { add_marker_to_project_item: { handler: vi.fn(async () => ok({ verified: true })) }, create_bin: { handler: vi.fn(async () => ok({ verified: true, nodeId: "bin" })) }, create_subclip: { handler: vi.fn(async () => ok({ verified: true, nodeId: "sub" })) }, move_item_to_bin: { handler: vi.fn(async () => ok({ verified: true })) } }; const send = vi.fn(async () => ok({ projectId: "p", mediaPath: "/source.mov" })), probeDuration = vi.fn(async () => Number(sec(10))); const tools = getSceneReviewWorkflowTools({ tempDir: root }, { send, probeDuration, now: () => now, getToolCatalog: () => catalog }); const args = { project_path: "/project.prproj", segmentation: { source_id: "source", source_duration_ticks: sec(10), candidates: [], approved_indices: [] }, mode, bin_name: "Scene", parent_bin_id: "parent" }; return { tools, args, catalog, send, probeDuration, advance: () => { now += 600001; } }; }
  it("supports marker-only and subclip-only modes, respecting parent bin and token expiry", async () => {
    const markers = fixture(), preview = await markers.tools.preview_scene_review_workflow.handler(markers.args); expect(await markers.tools.apply_scene_review_workflow.handler({ confirmation_token: preview.data.confirmation_token })).toMatchObject({ data: { bin_id: null, audio_requested: false } }); expect(markers.catalog.create_bin.handler).not.toHaveBeenCalled();
    const sub = fixture("subclips"), other = await sub.tools.preview_scene_review_workflow.handler(sub.args); expect(await sub.tools.apply_scene_review_workflow.handler({ confirmation_token: other.data.confirmation_token })).toMatchObject({ success: true }); expect(sub.catalog.create_bin.handler).toHaveBeenCalledWith({ name: "Scene", parent_bin_id: "parent" }); expect(sub.catalog.add_marker_to_project_item.handler).not.toHaveBeenCalled();
    const expired = await sub.tools.preview_scene_review_workflow.handler(sub.args); sub.advance(); await expect(sub.tools.apply_scene_review_workflow.handler({ confirmation_token: expired.data.confirmation_token })).rejects.toThrow("expired"); expect(await sub.tools.preview_scene_review_workflow.handler(sub.args)).toMatchObject({ success: true });
  });
  it("stops a partially written scene and refuses missing dispatch routes", async () => {
    const f = fixture("both"), preview = await f.tools.preview_scene_review_workflow.handler(f.args); f.catalog.create_subclip.handler.mockResolvedValueOnce(ok({ verified: false })); expect(await f.tools.apply_scene_review_workflow.handler({ confirmation_token: preview.data.confirmation_token })).toMatchObject({ success: false, data: { outcome: "committed_unverified", bin_id: "bin", completed: [{ tool: "create_bin" }, { tool: "add_marker_to_project_item" }, { tool: "create_subclip" }], retry_safe: false, rollback_attempted: false } }); expect(f.catalog.move_item_to_bin.handler).not.toHaveBeenCalled();
    const next = await f.tools.preview_scene_review_workflow.handler(f.args); delete f.catalog.create_bin; expect(await f.tools.apply_scene_review_workflow.handler({ confirmation_token: next.data.confirmation_token })).toMatchObject({ data: { outcome: "unknown", completed: [] } }); await expect(f.tools.preview_scene_review_workflow.handler(f.args)).rejects.toThrow("unavailable");
  });
  it("requires bounded approved duration and actual source inspection", async () => {
    const f = fixture(); await expect(f.tools.preview_scene_review_workflow.handler({ ...f.args, mode: "unknown" as any })).rejects.toThrow("mode/name"); await expect(f.tools.preview_scene_review_workflow.handler({ ...f.args, bin_name: "x".repeat(129) })).rejects.toThrow("mode/name"); f.send.mockResolvedValueOnce(no("missing source") as any); expect(await f.tools.preview_scene_review_workflow.handler(f.args)).toMatchObject({ success: false, error: "missing source" }); f.send.mockResolvedValueOnce(ok({ projectId: "p", mediaPath: "" })); await expect(f.tools.preview_scene_review_workflow.handler(f.args)).rejects.toThrow("path unavailable"); f.probeDuration.mockResolvedValueOnce(Number(sec(9))); await expect(f.tools.preview_scene_review_workflow.handler(f.args)).rejects.toThrow("shorter");
    const many = Array.from({ length: 100 }, (_, i) => ({ ticks: sec((i + 1) / 11), confidence: 1, classification: "cut" })); await expect(f.tools.preview_scene_review_workflow.handler({ ...f.args, segmentation: { ...f.args.segmentation, candidates: many as any, approved_indices: many.map((_, i) => i) } })).rejects.toThrow("100 segments");
  });
});

describe("transcript evidence and recovery bounds", () => {
  it("refuses malformed receipts and oversized/changed project evidence without starting", async () => {
    const root = privateWorkspace(), start = vi.fn(), catalog: any = { has_transcript_uxp: { handler: async () => ok({ result: { hasTranscript: true, projectGuid: "p" } }) }, get_clip_transcript_uxp: { handler: async () => ok({ result: { json: JSON.stringify({ segments: [{ text: "Hello" }] }), projectGuid: "different" } }) }, transcribe_clip_uxp: { handler: start } }, tools = getTimelineEditorialTools({ tempDir: root }, { getToolCatalog: () => catalog, sleep: async () => {} }); const args = { project_item_id: "source", operation_id: "op", start_if_missing: true, confirm_destructive: true };
    expect(await tools.prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "unknown", readiness_error: expect.stringContaining("Project changed") } });
    catalog.get_clip_transcript_uxp.handler = async () => ok({ result: { json: "x".repeat(1024 * 1024 + 1) } }); expect(await tools.prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "pending" } });
    catalog.get_clip_transcript_uxp.handler = async () => no("host pending"); expect(await tools.prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "pending", readiness_error: "host pending" } });
    catalog.get_clip_transcript_uxp.handler = async () => ok({ result: { json: JSON.stringify({ segments: [Array(10001).fill(null)] }) } }); expect(await tools.prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "unknown", readiness_error: expect.stringContaining("10000") } }); expect(start).not.toHaveBeenCalled();
    const file = path.join(root, `transcript-start-${createHash("sha256").update("op").digest("hex")}.json`); writeFileSync(file, "x".repeat(4097)); await expect(tools.prepare_transcript_workflow.handler(args)).rejects.toThrow("Invalid private");
    delete catalog.has_transcript_uxp; await expect(tools.prepare_transcript_workflow.handler(args)).rejects.toThrow("unavailable");
  });
  it("polls accepted native work to ready and never starts through missing edit authority", async () => {
    const root = privateWorkspace(); let present = false, reads = 0; const start = vi.fn(async () => { present = true; return ok({ accepted: true }); }); const catalog: any = { has_transcript_uxp: { handler: async () => ok({ result: { hasTranscript: present, projectGuid: "p" } }) }, get_clip_transcript_uxp: { handler: async () => { reads++; return ok({ result: { json: JSON.stringify({ segments: [{ text: reads === 1 ? "" : "Ready" }] }) } }); } }, transcribe_clip_uxp: { handler: start } }, tools = getTimelineEditorialTools({ tempDir: root }, { getToolCatalog: () => catalog, sleep: async () => {} }); const args = { project_item_id: "source", operation_id: "op", start_if_missing: true, confirm_destructive: true, language: "en", wait_seconds: 1 };
    expect(await tools.prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "ready", native_receipt: { success: true } } }); expect(start).toHaveBeenCalledWith(expect.objectContaining({ language: "en" })); expect(start).toHaveBeenCalledTimes(1); expect(reads).toBe(2);
    present = false; await expect(getTimelineEditorialTools({ tempDir: root }, { capabilities: resolveCapabilities("inspect,filesystem"), getToolCatalog: () => catalog }).prepare_transcript_workflow.handler({ ...args, operation_id: "new" })).rejects.toThrow("edit"); expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("camera tool session and token boundaries", () => {
  it("requires same-session inspection and consumes tokens before dispatch failure", async () => {
    let now = 0; const s = snapshot(); s.tracks.push({ ...s.tracks[0], id: "video:1", index: 1 }); s.clips.push({ ...s.clips[0], id: "second", track_id: "video:1" }, { ...s.clips[0], id: "master", track_id: "audio:0" }); revise(s); const send = vi.fn(async () => ok({ project_id: "p", sequence_id: "s", frame_duration_ticks: sec(1 / 24), display_start_ticks: "0", tracks: s.tracks, clips: s.clips, links_complete: true, locks_complete: true, total: 3 })); const tools = getTimelineEditorialTools({}, { send, now: () => now }), args = { snapshot: s, cuts: [{ start_ticks: "0", end_ticks: sec(2), camera_track_id: "video:1" }], camera_track_ids: ["video:0", "video:1"], master_audio_track_ids: ["audio:0"] };
    await expect(tools.preview_stacked_camera_edit.handler(args)).rejects.toThrow("current-session"); const inspected = await tools.inspect_timeline_snapshot.handler({ sequence_id: "s" }); const current = { ...args, snapshot: inspected.data }; const preview = await tools.preview_stacked_camera_edit.handler(current); send.mockResolvedValueOnce(no("bridge disappeared") as any); expect(await tools.apply_stacked_camera_edit.handler({ confirmation_token: preview.data.confirmation_token })).toMatchObject({ success: false }); await expect(tools.apply_stacked_camera_edit.handler({ confirmation_token: preview.data.confirmation_token })).rejects.toThrow("consumed");
    const expired = await tools.preview_stacked_camera_edit.handler(current); now = 600001; await expect(tools.apply_stacked_camera_edit.handler({ confirmation_token: expired.data.confirmation_token })).rejects.toThrow("expired");
    send.mockResolvedValueOnce(no("offline") as any); await expect(tools.inspect_timeline_snapshot.handler({ sequence_id: "s" })).rejects.toThrow("offline"); send.mockResolvedValueOnce(ok({ frame_duration_ticks: "0" }) as any); await expect(tools.inspect_timeline_snapshot.handler({ sequence_id: "s" })).rejects.toThrow("frame grid");
  });
});


describe("compound trim keeps existing terminal padding", () => {
  function paddedPlan() {
    const s = snapshot(); s.frame_rate = { numerator: 30000, denominator: 1001 };
    Object.assign(s.clips[0], { in_ticks: sec(5.005), out_ticks: sec(15.015), end_ticks: sec(10.01), source_duration_ticks: sec(15) }); revise(s);
    return { project_path: "/project.prproj", snapshot: s, steps: [{ tool: "trim_clip", clip_id: "clip", args: { node_id: "clip", new_in_seconds: 5.5055, include_linked: false } }] };
  }
  it("allows a trim inside the padded existing Out", () => { expect(() => validateExtendedEditPlan(paddedPlan())).not.toThrow(); });
  it("refuses extending farther beyond the physical end", () => {
    const p = paddedPlan(); p.steps[0].args = { node_id: "clip", new_out_seconds: 15.015 + 1001 / 30000, include_linked: false } as any;
    expect(() => validateExtendedEditPlan(p)).toThrow("SOURCE_HANDLE_BOUNDARY");
  });
  it("refuses one full frame of existing padding", () => {
    const p = paddedPlan(); p.snapshot.clips[0].out_ticks = sec(15 + 1001 / 30000); revise(p.snapshot);
    expect(() => validateExtendedEditPlan(p)).toThrow(/exceeds source duration/);
  });
});
