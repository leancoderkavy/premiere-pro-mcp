import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { cleanupTempDirs, makePrivateBridgeTempDir, makeTempDir } from "../helpers/temp-dir.js";
import { getTimelineEditorialTools, timelineSnapshotScript, stackedCameraApplyScript } from "../../src/tools/timeline-editorial.js";
import { getExtendedEditPlanTools, validateExtendedEditPlan } from "../../src/tools/extended-edit-plans.js";
import { getSceneReviewWorkflowTools } from "../../src/tools/scene-review-workflow.js";
import { snapshotRevision, type TimelineSnapshot } from "../../src/ai/timeline-contract.js";
import { planStackedCameraEdit } from "../../src/ai/editorial-workflows.js";
import { secondsToTicks } from "../../src/ai/exact-time.js";
import { runWithExpectedHostTarget, expectedHostTarget } from "../../src/bridge/project-guard.js";
import { buildToolScript } from "../../src/bridge/script-builder.js";
import { resolveCapabilities } from "../../src/security/capabilities.js";

afterEach(cleanupTempDirs);
const workspace = () => makeTempDir("timeline-editorial-");
const privateWorkspace = () => makePrivateBridgeTempDir("timeline-editorial-");
const time = secondsToTicks;
function snapshot(): TimelineSnapshot {
  const s: TimelineSnapshot = { schema_version: 1, backend: "cep", project_id: "p", sequence_id: "s", session_id: "session", revision: "", frame_rate: { numerator: 24, denominator: 1 }, display_start_ticks: "0", tracks: [{ id: "video:0", type: "video", index: 0, locked: false, sync_locked: true, targeted: true, muted: false }, { id: "audio:0", type: "audio", index: 0, locked: false, sync_locked: true, targeted: false, muted: false }], clips: [{ id: "clip", source_id: "source", track_id: "video:0", start_ticks: "0", end_ticks: time(2), in_ticks: time(1), out_ticks: time(3), source_duration_ticks: time(60), speed: { numerator: 1, denominator: 1 }, reversed: false, enabled: true, linked_ids: [], identity: "host", effects: [], nested: false }], completeness: { clips: true, links: true, locks: true, effects: true, transitions: true, markers: true }, transitions: [], markers: [], pagination: { offset: 0, total: 1, next_offset: null } };
  s.revision = snapshotRevision(s); return s;
}
const revise = (s: TimelineSnapshot) => { s.pagination.total = s.clips.length; s.revision = snapshotRevision(s); return s; };
const success = (data: unknown) => ({ success: true, data });
const failure = (error: string, data?: unknown) => ({ success: false, error, data });

describe("reachable timeline/editorial contracts", () => {
  it("routes exact conversions and rejects unit contradictions", async () => {
    const tools = getTimelineEditorialTools({});
    expect(await tools.convert_timeline_time.handler({ value: "00:01:00;02", from: "timecode", to: "frames", frame_rate: { numerator: 30000, denominator: 1001 }, drop_frame: true })).toMatchObject({ success: true, data: { value: "1800" } });
    expect(await tools.convert_timeline_time.handler({ value: "1", from: "samples", to: "ticks", frame_rate: { numerator: 24, denominator: 1 }, sample_rate: 48000 })).toMatchObject({ data: { value: "5292000" } });
    expect(await tools.convert_timeline_time.handler({ value: "NaN", from: "ticks", to: "frames", frame_rate: { numerator: 24, denominator: 1 } })).toMatchObject({ success: false });
    expect(await tools.predict_timeline_edit.handler({ snapshot: snapshot(), operations: [{ type: "enable", clip_id: "clip", enabled: false }] })).toMatchObject({ success: true, data: { changes: [{ id: "clip" }] } });
    expect(await tools.verify_timeline_postconditions.handler({ expected: snapshot(), actual: snapshot() })).toMatchObject({ data: { verified: true } });
    expect(await tools.map_keyframe_time_domain.handler({ snapshot: snapshot(), clip_id: "clip", time_ticks: time(2), domain: "source" })).toMatchObject({ data: { clip_relative_ticks: time(1) } });
    expect(await tools.map_keyframe_time_domain.handler({ snapshot: snapshot(), clip_id: "missing", time_ticks: "0", domain: "source" })).toMatchObject({ success: false });
  });
  it("executes ES3 raw-tick snapshot with explicit unknown host fields", async () => {
    const clip = { nodeId: "clip", projectItem: { nodeId: "source", isSequence: () => false }, start: { ticks: "9007199254740993123" }, end: { ticks: "9007199255249025123" }, inPoint: { ticks: time(1) }, outPoint: { ticks: time(3) }, disabled: false, getLinkedItems: () => null, getSpeed: () => 1, isSpeedReversed: () => false };
    const tracks = Object.assign([{ clips: Object.assign([clip], { numItems: 1 }), isLocked: () => false }], { numTracks: 1 });
    const seq = { sequenceID: "s", timebase: time(1 / 24), zeroPoint: "0", videoTracks: tracks, audioTracks: Object.assign([], { numTracks: 0 }) };
    const send = vi.fn(async (script: string) => vm.runInNewContext(script, { app: { project: { documentID: "p" } }, __findSequence: () => seq, __isCurrentProjectSequence: () => true, __result: success, __error: failure, __refuse: failure }));
    const tools = getTimelineEditorialTools({}, { send }); const observed = await tools.inspect_timeline_snapshot.handler({ sequence_id: "s" });
    expect(observed).toMatchObject({ success: true, data: { clips: [{ start_ticks: "9007199254740993123" }], completeness: { effects: false, markers: false } } });
    expect(await tools.inspect_timeline_snapshot.handler({ sequence_id: "s", expected_revision: "wrong" })).toMatchObject({ success: false, error: expect.stringContaining("SNAPSHOT_CHANGED") });
    expect(timelineSnapshotScript('s"\\\n', 1)).not.toMatch(/\b(?:const|let)\b|=>|\d+n/); expect(timelineSnapshotScript('s"\\\n', 1)).toContain('s\\"\\\\\\n');
    await expect(tools.inspect_timeline_snapshot.handler({ sequence_id: "s", max_clips: 1001 })).rejects.toThrow();
    await expect(getTimelineEditorialTools({}, { capabilities: resolveCapabilities("edit"), send }).inspect_timeline_snapshot.handler({ sequence_id: "s" })).rejects.toThrow("inspect");
  });
  it("reads track targeting and mute from the DOM, and sync lock from QE only for the active sequence", async () => {
    // Live 26.5.2: these were always null, so predict_timeline_edit refused every sync_locked ripple.
    const clip = { nodeId: "clip", projectItem: { nodeId: "source", isSequence: () => false }, start: { ticks: "0" }, end: { ticks: time(2) }, inPoint: { ticks: "0" }, outPoint: { ticks: time(2) }, disabled: false, getLinkedItems: () => null, getSpeed: () => 1, isSpeedReversed: () => false };
    const videoTracks = Object.assign([{ clips: Object.assign([clip], { numItems: 1 }), isLocked: () => false, isTargeted: () => true, isMuted: () => false }], { numTracks: 1 });
    const audioTracks = Object.assign([{ clips: Object.assign([], { numItems: 0 }), isLocked: () => false, isTargeted: () => 0, isMuted: () => { throw new Error("unreadable"); } }], { numTracks: 1 });
    const seq = { sequenceID: "s", timebase: time(1 / 24), zeroPoint: "0", videoTracks, audioTracks };
    const qeSeq = { getVideoTrackAt: () => ({ isSyncLocked: () => true }), getAudioTrackAt: () => ({ isSyncLocked: () => "yes" }) };
    const enableQE = vi.fn();
    const contextFor = (active: unknown) => ({ app: { project: { documentID: "p", activeSequence: active }, enableQE }, qe: { project: { getActiveSequence: () => qeSeq } }, __findSequence: () => seq, __isCurrentProjectSequence: () => true, __result: success, __error: failure, __refuse: failure });
    let context = contextFor(seq);
    const send = vi.fn(async (script: string) => vm.runInNewContext(script, context));
    const tools = getTimelineEditorialTools({}, { send });
    const active = await tools.inspect_timeline_snapshot.handler({ sequence_id: "s" });
    expect(active.data.tracks).toEqual([
      expect.objectContaining({ id: "video:0", targeted: true, muted: false, sync_locked: true }),
      expect.objectContaining({ id: "audio:0", targeted: false, muted: null, sync_locked: null }),
    ]);
    expect(enableQE).toHaveBeenCalled();
    context = contextFor({ sequenceID: "other" }); enableQE.mockClear();
    const inactive = await tools.inspect_timeline_snapshot.handler({ sequence_id: "s" });
    expect(inactive.data.tracks[0]).toMatchObject({ targeted: true, muted: false, sync_locked: null });
    expect(enableQE).not.toHaveBeenCalled();
  });
  it("exposes local editorial routes with bounded invalid-input errors", async () => {
    const tools = getTimelineEditorialTools({});
    expect(await tools.plan_media_synchronization.handler({ method: "anchors", reference_ticks: ["20"], candidate_ticks: ["10"] })).toMatchObject({ data: { offset_ticks: "10" } });
    expect(await tools.plan_media_synchronization.handler({ method: "audio", reference_samples: Array(32).fill(0), candidate_samples: Array(32).fill(0), sample_rate: 1000 })).toMatchObject({ data: { status: "refused" } });
    expect(await tools.plan_media_synchronization.handler({ method: "anchors", reference_samples: [1] })).toMatchObject({ success: false });
    expect(await tools.plan_music_remix.handler({ plan: { beats_ticks: ["0", time(1), time(2), time(3)], source_duration_ticks: time(3), target_duration_ticks: time(2), protected_intro_ticks: "0", protected_outro_ticks: "0", signal_classification: "music" } })).toMatchObject({ success: true });
    expect(await tools.plan_scene_segments.handler({ plan: { source_id: "source", source_duration_ticks: time(3), candidates: [], approved_indices: [] } })).toMatchObject({ success: true, data: { segments: [{ start_ticks: "0" }] } });
    expect(await tools.bind_media_provenance.handler({ provenance: { source_id: "s", source_sha256: "a".repeat(64), proxy_sha256: null, original_offline: false, proxy_attached: false, analysis_provider: "original", snapshot_revision: "r", export_provider_verified: true } })).toMatchObject({ data: { delivery_ready: true } });
  });
  it("inspects bounded handoff bytes, missing media, unresolved dependencies and symlink escapes", async () => {
    const root = workspace(); writeFileSync(path.join(root, "edit.prproj"), "project"); writeFileSync(path.join(root, "clip.mov"), "media");
    const tools = getTimelineEditorialTools({ tempDir: root }), dependencies = [{ source_id: "project", relative_path: "edit.prproj", kind: "project", expected_bytes: "7", enumerated: true }, { source_id: "source", relative_path: "clip.mov", kind: "media", expected_bytes: "5", enumerated: true }];
    expect(await tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies, inventory_complete: true })).toMatchObject({ data: { complete: true, total_bytes: "12" } });
    expect(await tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [], inventory_complete: true })).toMatchObject({ data: { complete: false } });
    expect(await tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [{ ...dependencies[1], relative_path: "missing.mov" }], inventory_complete: true })).toMatchObject({ data: { complete: false, dependencies: [{ status: "missing" }] } });
    expect(await tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [{ ...dependencies[0], kind: "ae_composition" }], inventory_complete: false })).toMatchObject({ data: { complete: false, dependencies: [{ status: "unresolved_dependencies" }] } });
    const other = workspace(); writeFileSync(path.join(other, "secret"), "private"); symlinkSync(path.join(other, "secret"), path.join(root, "escape")); await expect(tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [{ ...dependencies[0], relative_path: "escape" }], inventory_complete: true })).rejects.toThrow("escapes");
    await expect(tools.build_project_handoff_manifest.handler({ approved_workspace_path: root, dependencies: [{ ...dependencies[0], relative_path: "../escape" }], inventory_complete: true })).rejects.toThrow("escapes");
  });
  it("persists private checkpoint states across restart with no replay or schema upgrade", async () => {
    const root = privateWorkspace(), tools = getTimelineEditorialTools({ tempDir: root }); const checkpoint = { schema_version: 1, project_id: "p", sequence_id: "s", snapshot_revision: "r", backup_reference: null, sequence_checkpoint_reference: null, operations: [{ operation_id: "o", tool: "trim_clip", state: "unknown", receipt_digest: null }] };
    const saved = await tools.save_workflow_checkpoint.handler({ checkpoint }); const id = saved.data.checkpoint_id;
    const restarted = getTimelineEditorialTools({ tempDir: root }); expect(await restarted.inspect_workflow_checkpoint.handler({ checkpoint_id: id })).toMatchObject({ data: { checkpoint: { automatic_replay: false, recovery_required: true } } });
    writeFileSync(path.join(root, `workflow-checkpoint-${id}.json`), JSON.stringify({ checkpoint: { ...checkpoint, schema_version: 2 } })); await expect(restarted.inspect_workflow_checkpoint.handler({ checkpoint_id: id })).rejects.toThrow("version");
    await expect(restarted.inspect_workflow_checkpoint.handler({ checkpoint_id: "../escape" })).rejects.toThrow("ID");
    await expect(getTimelineEditorialTools({ tempDir: root }, { capabilities: resolveCapabilities("inspect") }).save_workflow_checkpoint.handler({ checkpoint })).rejects.toThrow("filesystem");
  // Saving runs the private bridge-directory check, which on Windows spawns a
  // PowerShell ACL read bounded at 30 s; CI took 1-4 s and sometimes over 10 s.
  }, 60_000);
});

describe("native transcript readiness orchestration", () => {
  function fixture() { const root = privateWorkspace(); let present = false, json = '{"segments":[]}', calls = 0; const start = vi.fn(async () => { calls++; return success({ accepted: true }); }); const catalog = { has_transcript_uxp: { handler: async () => success({ result: { hasTranscript: present, projectGuid: "project" } }) }, get_clip_transcript_uxp: { handler: async () => success({ result: { json, projectGuid: "project" } }) }, transcribe_clip_uxp: { handler: start } }; const dependencies = { getToolCatalog: () => catalog, sleep: async () => {} }; const tools = () => getTimelineEditorialTools({ tempDir: root }, dependencies); return { tools, start, catalog, set: (p: boolean, text = json) => { present = p; json = text; }, count: () => calls }; }
  it("starts once, preserves consumed start state after restart, and waits for actual segment text", async () => {
    const f = fixture(), args = { project_item_id: "source", operation_id: "operation", start_if_missing: true, confirm_destructive: true };
    expect(await f.tools().prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "accepted" } });
    expect(await f.tools().prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "pending", start_retried: false } }); expect(f.count()).toBe(1);
    f.set(true, '{"segments":[{"text":"Hello","start":0,"end":1}]}'); expect(await f.tools().prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "ready", transcript_revision: expect.stringMatching(/^sha256:/) } });
    expect(await f.tools().prepare_transcript_workflow.handler({ ...args, expected_transcript_revision: "old" })).toMatchObject({ data: { state: "review_required" } }); expect(f.count()).toBe(1);
  });
  it("never treats empty, malformed, unsupported or failed presence as completion or dispatch authorization", async () => {
    const f = fixture(); f.set(true); expect(await f.tools().prepare_transcript_workflow.handler({ project_item_id: "source", operation_id: "empty", wait_seconds: 1 })).toMatchObject({ data: { state: "pending" } }); expect(f.count()).toBe(0);
    f.set(true, "{"); expect(await f.tools().prepare_transcript_workflow.handler({ project_item_id: "source", operation_id: "bad" })).toMatchObject({ success: false, data: { state: "failed" } });
    f.set(true, "{}"); expect(await f.tools().prepare_transcript_workflow.handler({ project_item_id: "source", operation_id: "schema" })).toMatchObject({ data: { state: "unknown" } });
    f.catalog.has_transcript_uxp.handler = async () => failure("offline") as any; expect(await f.tools().prepare_transcript_workflow.handler({ project_item_id: "source", operation_id: "offline", start_if_missing: true, confirm_destructive: true })).toMatchObject({ data: { state: "unknown" } }); expect(f.count()).toBe(0);
  });
  it("requires edit and explicit start confirmation; changed IDs cannot reuse a start receipt", async () => {
    const f = fixture(); await expect(f.tools().prepare_transcript_workflow.handler({ project_item_id: "source", operation_id: "operation", start_if_missing: true })).rejects.toThrow("confirm_destructive");
    await f.tools().prepare_transcript_workflow.handler({ project_item_id: "source", operation_id: "operation", start_if_missing: true, confirm_destructive: true });
    await expect(f.tools().prepare_transcript_workflow.handler({ project_item_id: "other", operation_id: "operation" })).rejects.toThrow("another");
    await expect(f.tools().prepare_transcript_workflow.handler({ project_item_id: "source", operation_id: "operation", wait_seconds: 31 })).rejects.toThrow("wait_seconds");
  });
  it("retains unknown start outcomes after restart without a second native start", async () => {
    const f = fixture(); f.start.mockResolvedValueOnce(failure("reply disappeared") as any); const args = { project_item_id: "source", operation_id: "unknown", start_if_missing: true, confirm_destructive: true };
    expect(await f.tools().prepare_transcript_workflow.handler(args)).toMatchObject({ success: false, data: { state: "unknown" } });
    expect(await f.tools().prepare_transcript_workflow.handler(args)).toMatchObject({ data: { state: "unknown", start_retried: false } }); expect(f.count()).toBe(0); expect(f.start).toHaveBeenCalledTimes(1);
  });
});

describe("reviewed compound CEP plans", () => {
  it("binds all targets, executes existing handlers inside exact host guards and consumes token before failure", async () => {
    const s = snapshot(), observed: unknown[] = []; const catalog = { enable_disable_clip: { handler: vi.fn(async () => { observed.push(expectedHostTarget()); return success({ verified: true }); }) } };
    const tools = getExtendedEditPlanTools({}, { send: async () => success({ targetsValidated: true }), getToolCatalog: () => catalog }); const plan = { project_path: "/project.prproj", snapshot: s, steps: [{ tool: "enable_disable_clip", clip_id: "clip", args: { node_id: "clip", enabled: false } }] };
    const preview = await tools.preview_extended_edit_plan.handler({ plan }); expect(preview.success).toBe(true); const token = (preview.data as any).confirmation_token; expect(catalog.enable_disable_clip.handler).not.toHaveBeenCalled();
    expect(await tools.apply_extended_edit_plan.handler({ confirmation_token: token })).toMatchObject({ success: true, data: { verified: true, atomic: false } }); expect(observed[0]).toMatchObject({ sequence_id: "s", project_document_id: "p", clip: { node_id: "clip", start_ticks: "0" } });
    await expect(tools.apply_extended_edit_plan.handler({ confirmation_token: token })).rejects.toThrow("consumed");
    const other = await tools.preview_extended_edit_plan.handler({ plan }); catalog.enable_disable_clip.handler.mockResolvedValueOnce(success({ verified: false })); expect(await tools.apply_extended_edit_plan.handler({ confirmation_token: (other.data as any).confirmation_token })).toMatchObject({ success: false, data: { retry_safe: false, failed_index: 0 } });
  });
  it("validates six routes and refuses descriptor/retime/link ambiguity before dispatch", () => {
    const s = snapshot(), base = { project_path: "/project.prproj", snapshot: s };
    expect(validateExtendedEditPlan({ ...base, steps: [{ tool: "trim_clip", clip_id: "clip", args: { node_id: "clip", new_out_seconds: 2, include_linked: false } }] }).steps[0].tool).toBe("trim_clip");
    expect(validateExtendedEditPlan({ ...base, steps: [{ tool: "split_clip", clip_id: "clip", args: { time_seconds: 1, track_type: "video", track_index: 0 } }] }).steps[0].tool).toBe("split_clip");
    expect(validateExtendedEditPlan({ ...base, steps: [{ tool: "move_clip", clip_id: "clip", args: { node_id: "clip", new_start_seconds: 5 } }] }).steps[0].tool).toBe("move_clip");
    expect(() => validateExtendedEditPlan({ ...base, steps: [{ tool: "move_clip", clip_id: "clip", args: { node_id: "clip", new_start_seconds: NaN } }] })).toThrow("finite");
    s.clips[0].effects = [{ identity: "e", match_name: "Match", display_name: "Localized", built_in: false, parameters: [{ identity: "parameter", display_name: "Amount", type: "number", units: null, animated: false, writable: true }] }]; revise(s);
    const effectStep = { tool: "set_effect_property", clip_id: "clip", effect_identity: "e", parameter_identity: "parameter", args: { node_id: "clip", effect_name: "Match", property_name: "Amount", property_index: 0, value: 3 } };
    expect(validateExtendedEditPlan({ ...base, snapshot: s, steps: [effectStep] }).steps[0].tool).toBe("set_effect_property");
    expect(validateExtendedEditPlan({ ...base, snapshot: s, steps: [{ ...effectStep, tool: "add_keyframe", time_domain: "source", time_ticks: time(2) }] }).steps[0].args.time_seconds).toBe(1);
    expect(() => validateExtendedEditPlan({ ...base, snapshot: s, steps: [{ ...effectStep, args: { ...effectStep.args, effect_name: "Localized" } }] })).toThrow("descriptor");
    expect(() => validateExtendedEditPlan({ ...base, snapshot: s, steps: [effectStep, effectStep] })).toThrow("Repeated");
    expect(() => validateExtendedEditPlan({ ...base, steps: [{ tool: "execute_extendscript", clip_id: "clip", args: {} }] })).toThrow("Unsupported");
  });
  it("same-command effect guard rejects locale/reorder ambiguity before a write", () => {
    const target = { backend: "cep", project_document_id: "p", sequence_id: "s", clip: { node_id: "clip", track_type: "video", track_index: 0, effect: { match_name: "Match", parameter_index: 0, parameter_name: "Amount" } } };
    const script = runWithExpectedHostTarget(target, () => buildToolScript('writes++; return __result({verified:true});'));
    const component = { matchName: "Match", properties: Object.assign([{ displayName: "Amount" }], { numItems: 1 }) }, clip = { components: Object.assign([component], { numItems: 1 }) }; let writes = 0;
    const context = { app: { project: { documentID: "p", activeSequence: { sequenceID: "s" } } }, __findClip: () => ({ clip, trackType: "video", trackIndex: 0 }), __result: success, __error: failure, __refuse: failure, get writes() { return writes; }, set writes(n: number) { writes = n; } };
    expect(vm.runInNewContext(script, context).success).toBe(true); expect(writes).toBe(1);
    component.properties[0].displayName = "Reordered"; expect(vm.runInNewContext(script, context)).toMatchObject({ success: false, error: expect.stringContaining("parameter identity") }); expect(writes).toBe(1);
    expect(() => runWithExpectedHostTarget({ ...target, clip: { ...target.clip, effect: { ...target.clip.effect, parameter_index: -1 } } }, () => null)).toThrow("indexed parameter");
  });
});

describe("ordinary stacked-camera execution", () => {
  it("retains clone and partial-write receipts when copied locks or final topology change", () => {
    const s = snapshot(); s.clips[0].enabled = false; s.clips.push({ ...s.clips[0], id: "master", track_id: "audio:0", enabled: true }); revise(s);
    const plan = planStackedCameraEdit(s, [{ start_ticks: "0", end_ticks: time(2), camera_track_id: "video:0" }], ["video:0"], ["audio:0"]), script = stackedCameraApplyScript(s, plan);
    const nativeClip = (c: TimelineSnapshot["clips"][number], copy: boolean): any => ({ nodeId: c.id + (copy ? "copy" : ""), projectItem: { nodeId: c.source_id, isSequence: () => false }, getSpeed: () => 1, isSpeedReversed: () => false, getLinkedItems: () => null, start: { ticks: c.start_ticks }, end: { ticks: c.end_ticks }, inPoint: { ticks: c.in_ticks }, outPoint: { ticks: c.out_ticks }, disabled: !c.enabled });
    const sequence = (copy: boolean): any => ({ sequenceID: copy ? "copy" : "s", videoTracks: Object.assign([{ isLocked: () => false, clips: Object.assign([nativeClip(s.clips[0], copy)], { numItems: 1 }) }], { numTracks: 1 }), audioTracks: Object.assign([{ isLocked: () => false, clips: Object.assign([nativeClip(s.clips[1], copy)], { numItems: 1 }) }], { numTracks: 1 }) });
    const original = sequence(false), sequences: any = Object.assign([original], { numSequences: 1 }), context = { app: { project: { documentID: "p", sequences } }, __findSequence: () => original, __result: success, __error: failure, __refuse: failure };
    original.clone = () => {};
    expect(vm.runInNewContext(script, context)).toMatchObject({ success: false, data: { outcome: "committed_unverified", verified: false } });
    original.clone = () => { const copy = sequence(true); copy.videoTracks[0].isLocked = () => true; sequences.push(copy); sequences.numSequences++; };
    expect(vm.runInNewContext(script, context)).toMatchObject({ success: false, error: expect.stringContaining("lock"), data: { outcome: "committed_unverified", sequenceId: "copy" } }); expect(sequences[1].videoTracks[0].clips[0].disabled).toBe(true);
    sequences.pop(); sequences.numSequences = 1;
    original.clone = () => { const copy = sequence(true); let disabled = true; Object.defineProperty(copy.videoTracks[0].clips[0], "disabled", { get: () => disabled, set: value => { disabled = value; copy.audioTracks[0].clips.numItems = 0; } }); sequences.push(copy); sequences.numSequences++; };
    expect(vm.runInNewContext(script, context)).toMatchObject({ success: false, error: expect.stringContaining("Final clip topology"), data: { outcome: "committed_unverified", appliedClipIds: ["clipcopy"], sequenceId: "copy" } });
  });
  it("runs clone-first host script and verifies enabled state with untouched master audio", () => {
    const s = snapshot(); s.tracks.push({ ...s.tracks[0], id: "video:1", index: 1 }); s.clips.push({ ...s.clips[0], id: "camera2", track_id: "video:1", source_id: "source2" }, { ...s.clips[0], id: "master", track_id: "audio:0" }); revise(s);
    const plan = planStackedCameraEdit(s, [{ start_ticks: "0", end_ticks: time(2), camera_track_id: "video:1" }], ["video:0", "video:1"], ["audio:0"]), script = stackedCameraApplyScript(s, plan);
    const makeClip = (c: TimelineSnapshot["clips"][number], cloned = false) => ({ nodeId: `${c.id}${cloned ? "copy" : ""}`, projectItem: { nodeId: c.source_id, isSequence: () => false }, getSpeed: () => 1, isSpeedReversed: () => false, getLinkedItems: () => null, start: { ticks: c.start_ticks }, end: { ticks: c.end_ticks }, inPoint: { ticks: c.in_ticks }, outPoint: { ticks: c.out_ticks }, disabled: !c.enabled });
    const makeSequence = (cloned = false): any => ({ sequenceID: cloned ? "copy" : "s", videoTracks: Object.assign([0, 1].map(index => ({ isLocked: () => false, clips: Object.assign(s.clips.filter(c => c.track_id === `video:${index}`).map(c => makeClip(c, cloned)), { numItems: 1 }) })), { numTracks: 2 }), audioTracks: Object.assign([{ isLocked: () => false, clips: Object.assign([makeClip(s.clips[2], cloned)], { numItems: 1 }) }], { numTracks: 1 }) });
    const original = makeSequence(), sequences: any = Object.assign([original], { numSequences: 1 }); original.clone = () => { sequences.push(makeSequence(true)); sequences.numSequences++; };
    const result = vm.runInNewContext(script, { app: { project: { documentID: "p", sequences } }, __findSequence: () => original, __result: success, __error: failure, __refuse: failure });
    expect(result).toMatchObject({ success: true, data: { sequenceId: "copy", masterAudioPreserved: true, nativeMulticam: false } }); expect(sequences[1].videoTracks[0].clips[0].disabled).toBe(true); expect(sequences[1].audioTracks[0].clips[0].disabled).toBe(false); expect(original.videoTracks[0].clips[0].disabled).toBe(false);
    expect(script).not.toMatch(/\b(?:let|const)\b|=>|\d+n/);
    original.videoTracks[0].isLocked = () => true;
    expect(vm.runInNewContext(script, { app: { project: { documentID: "p", sequences } }, __findSequence: () => original, __result: success, __error: failure, __refuse: failure })).toMatchObject({ success: false, error: expect.stringContaining("lock") }); expect(sequences.numSequences).toBe(2);
    original.videoTracks[0].isLocked = undefined;
    expect(vm.runInNewContext(script, { app: { project: { documentID: "p", sequences } }, __findSequence: () => original, __result: success, __error: failure, __refuse: failure })).toMatchObject({ success: false, error: expect.stringContaining("lock") }); expect(sequences.numSequences).toBe(2);
    original.videoTracks[0].isLocked = () => false; original.videoTracks[0].clips[0].getSpeed = () => 2;
    expect(vm.runInNewContext(script, { app: { project: { documentID: "p", sequences } }, __findSequence: () => original, __result: success, __error: failure, __refuse: failure })).toMatchObject({ success: false, error: expect.stringContaining("retimed") }); expect(sequences.numSequences).toBe(2);
    original.videoTracks[0].clips[0].getSpeed = () => 1; original.videoTracks[0].clips[0].getLinkedItems = () => Object.assign([{ nodeId: "master" }], { numItems: 1 });
    expect(vm.runInNewContext(script, { app: { project: { documentID: "p", sequences } }, __findSequence: () => original, __result: success, __error: failure, __refuse: failure })).toMatchObject({ success: false, error: expect.stringContaining("linked identities") }); expect(sequences.numSequences).toBe(2);
  });
});

describe("reviewed scene application", () => {
  it("composes markers/subclips/bin with verified source guards and no replay", async () => {
    const root = workspace(); const receipts: string[] = []; const catalog: any = { add_marker_to_project_item: { handler: async () => { receipts.push("marker"); expect(expectedHostTarget()).toMatchObject({ source_item: { node_id: "source", media_path: "/source.mov" } }); return success({ verified: true }); } }, create_bin: { handler: async () => success({ verified: true, nodeId: "bin" }) }, create_subclip: { handler: async () => { receipts.push("subclip"); return success({ verified: true, nodeId: "subclip" }); } }, move_item_to_bin: { handler: async () => success({ verified: true }) } };
    const tools = getSceneReviewWorkflowTools({ tempDir: root }, { send: async () => success({ projectId: "p", mediaPath: "/source.mov" }), probeDuration: async () => Number(time(10)), getToolCatalog: () => catalog });
    const preview = await tools.preview_scene_review_workflow.handler({ project_path: "/project.prproj", segmentation: { source_id: "source", source_duration_ticks: time(10), candidates: [{ ticks: time(5), confidence: 0.9, classification: "cut" }], approved_indices: [0] }, mode: "both", bin_name: "Scenes" });
    expect(preview.success).toBe(true); expect(receipts).toHaveLength(0); const token = (preview.data as any).confirmation_token; expect(await tools.apply_scene_review_workflow.handler({ confirmation_token: token })).toMatchObject({ success: true, data: { audio_requested: true, audio_preservation_verified: false, bin_id: "bin", timeline_changed: false } }); expect(receipts).toEqual(["marker", "subclip", "marker", "subclip"]); await expect(tools.apply_scene_review_workflow.handler({ confirmation_token: token })).rejects.toThrow("consumed");
  });
  it("refuses unknown physical handles before first write", async () => {
    const tools = getSceneReviewWorkflowTools({}, { send: async () => success({ projectId: "p", mediaPath: "/source.mov" }), probeDuration: async () => null, getToolCatalog: () => ({ add_marker_to_project_item: { handler: async () => success({ verified: true }) } }) });
    await expect(tools.preview_scene_review_workflow.handler({ project_path: "/project.prproj", segmentation: { source_id: "source", source_duration_ticks: time(10), candidates: [], approved_indices: [] }, mode: "markers", bin_name: "Scenes" })).rejects.toThrow("duration unknown");
  });
});
