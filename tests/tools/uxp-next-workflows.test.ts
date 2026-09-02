import { describe, expect, it, vi } from "vitest";
import type { UxpWebSocketBridge } from "../../src/bridge/uxp-websocket-bridge.js";
import { getUxpNextWorkflowTools } from "../../src/tools/uxp-next-workflows.js";

describe("next-wave UXP MCP tools", () => {
  it("publishes a closed and bounded event receipt schema", () => {
    const bridge = { request: vi.fn(), getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).inspect_premiere_events_uxp;
    expect(tool.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["list", "wait"] },
        after_revision: { maximum: Number.MAX_SAFE_INTEGER },
        categories: { maxItems: 32 },
        event_names: { maxItems: 32 },
        limit: { maximum: 256 },
        timeout_ms: { maximum: 60000 },
      },
    });
    const readiness = getUxpNextWorkflowTools(bridge).wait_for_host_readiness_uxp;
    expect(readiness.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["snapshot", "analysis", "operation"] },
        operation_type: { enum: ["import", "export", "effect_drop", "generative_extend"] },
        after_revision: { maximum: Number.MAX_SAFE_INTEGER },
        timeout_ms: { maximum: 60000 },
        poll_max_ms: { maximum: 5000 },
      },
    });
    const projects = getUxpNextWorkflowTools(bridge).manage_project_sessions_uxp;
    expect(projects.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["list", "validate", "create", "open", "save", "save_as", "branch_copies", "close"] },
        paths: { maxItems: 16, uniqueItems: true },
        confirm_external_write: { type: "boolean" },
        confirm_discard_unsaved: { type: "boolean" },
      },
    });
    const growing = getUxpNextWorkflowTools(bridge).manage_growing_media_uxp;
    expect(growing.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["status", "pause", "resume"] },
        lease_ms: { minimum: 1000, maximum: 600000 },
        confirm_pause: { type: "boolean" },
      },
    });
    const checkpoints = getUxpNextWorkflowTools(bridge).manage_workflow_checkpoints_uxp;
    expect(checkpoints.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action", "name"],
      properties: {
        action: { enum: ["has", "get", "set", "clear"] },
        owner: { enum: ["project", "sequence"] },
        value_type: { enum: ["string", "int", "float", "bool"] },
        persistence: { enum: ["session", "persistent"] },
      },
    });
    const media = getUxpNextWorkflowTools(bridge).maintain_media_health_uxp;
    expect(media.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["inspect", "refresh", "set_offline", "find_by_media_path"] },
        project_item_ids: { maxItems: 64, uniqueItems: true },
        confirm_set_offline: { type: "boolean" },
        include_paths: { type: "boolean" },
        include_media_timing: { type: "boolean" },
      },
    });
    const sourceMediaTiming = getUxpNextWorkflowTools(bridge).manage_source_media_timing_uxp;
    expect(sourceMediaTiming.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action", "project_item_id"],
      properties: {
        action: { enum: ["inspect", "set_start"] },
        project_item_id: { maxLength: 512 },
        expected_timing: {
          additionalProperties: false,
          required: ["start_seconds", "duration_seconds"],
        },
        start_seconds: { maximum: 86400000 },
        confirm_set_start: { type: "boolean" },
      },
    });
    const sourceMediaOverrides = getUxpNextWorkflowTools(bridge).manage_source_media_overrides_uxp;
    expect(sourceMediaOverrides.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action", "project_item_id"],
      properties: {
        action: { enum: ["inspect", "update"] },
        project_item_id: { maxLength: 512 },
        expected_overrides: {
          additionalProperties: false,
          required: ["project_guid", "frame_rate", "pixel_aspect_ratio"],
        },
        frame_rate: { minimum: 1, maximum: 240 },
        pixel_aspect_ratio: {
          additionalProperties: false,
          required: ["numerator", "denominator"],
        },
        confirm_media_interpretation: { type: "boolean" },
        operation_id: { pattern: "^[A-Za-z0-9._:-]{1,128}$" },
      },
    });
    const tracks = getUxpNextWorkflowTools(bridge).manage_track_state_uxp;
    expect(tracks.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: ["inspect", "set_mute"] },
        media_type: { enum: ["all", "video", "audio", "caption"] },
        track_indices: { maxItems: 64, uniqueItems: true },
        muted: { type: "boolean" },
      },
    });
    const source = getUxpNextWorkflowTools(bridge).manage_source_clip_uxp;
    expect(source.parameters).toMatchObject({
      additionalProperties: false,
      required: ["action", "items"],
      properties: {
        action: { enum: ["inspect", "update"] },
        items: {
          maxItems: 64,
          items: {
            additionalProperties: false,
            required: ["project_item_id"],
            properties: {
              media_type: { enum: ["video", "audio"] },
              scale_to_frame: { enum: [true] },
            },
          },
        },
      },
    });
  });

  it("maps snake-case event queries to the exact bridge commands", async () => {
    const request = vi.fn().mockResolvedValue({ events: [] });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).inspect_premiere_events_uxp;
    await tool.handler({
      action: "wait", after_revision: 7, categories: ["encoder"],
      event_names: ["encoder.complete"], limit: 4, timeout_ms: 5000,
    });
    expect(request).toHaveBeenCalledWith("events.wait", {
      afterRevision: 7,
      categories: ["encoder"],
      eventNames: ["encoder.complete"],
      limit: 4,
      timeoutMs: 5000,
    }, { minimumTimeoutMs: 10000 });

    const readiness = getUxpNextWorkflowTools(bridge).wait_for_host_readiness_uxp;
    await readiness.handler({
      action: "analysis", sequence_id: "sequence-1", expected_sequence_id: "sequence-1",
      timeout_ms: 10000, poll_min_ms: 100, poll_max_ms: 1000,
    });
    expect(request).toHaveBeenLastCalledWith("readiness.analysis.wait", {
      sequenceId: "sequence-1", expectedSequenceId: "sequence-1",
      timeoutMs: 10000, pollMinMs: 100, pollMaxMs: 1000,
    }, { minimumTimeoutMs: 15000 });

    await readiness.handler({
      action: "operation", operation_type: "effect_drop", after_revision: 9, timeout_ms: 5000,
    });
    expect(request).toHaveBeenLastCalledWith("readiness.operation.wait", {
      operationType: "effectDrop", afterRevision: 9, timeoutMs: 5000,
    }, { minimumTimeoutMs: 10000 });

    const projects = getUxpNextWorkflowTools(bridge).manage_project_sessions_uxp;
    await projects.handler({
      action: "branch_copies", project_id: "project-1", expected_path: "C:/work/source.prproj",
      paths: ["C:/work/a.prproj", "C:/work/b.prproj"], confirm_external_write: true,
      confirm_overwrite: false, operation_id: "branches-1",
    });
    expect(request).toHaveBeenLastCalledWith("project.sessions.branchCopies", {
      projectId: "project-1", expectedPath: "C:/work/source.prproj", operationId: "branches-1",
      paths: ["C:/work/a.prproj", "C:/work/b.prproj"],
      confirmExternalWrite: true, confirmOverwrite: false,
    });

    const growing = getUxpNextWorkflowTools(bridge).manage_growing_media_uxp;
    await growing.handler({
      action: "pause", project_id: "project-1", expected_path: "C:/work/source.prproj",
      lease_ms: 30000, confirm_pause: true, operation_id: "pause-1",
    });
    expect(request).toHaveBeenLastCalledWith("growing.pause", {
      projectId: "project-1", expectedPath: "C:/work/source.prproj",
      leaseMs: 30000, confirmPause: true, operationId: "pause-1",
    });

    const checkpoints = getUxpNextWorkflowTools(bridge).manage_workflow_checkpoints_uxp;
    await checkpoints.handler({
      action: "set", owner: "sequence", sequence_id: "sequence-1", expected_owner_id: "sequence-1",
      name: "render.pass", value_type: "int", value: 3, persistence: "persistent", operation_id: "checkpoint-1",
    });
    expect(request).toHaveBeenLastCalledWith("checkpoint.set", {
      owner: "sequence", sequenceId: "sequence-1", expectedOwnerId: "sequence-1",
      name: "render.pass", valueType: "int", value: 3, persistence: "persistent", operationId: "checkpoint-1",
    });

    const media = getUxpNextWorkflowTools(bridge).maintain_media_health_uxp;
    await media.handler({
      action: "set_offline", project_item_ids: ["clip-1", "clip-2"],
      expected_offline: false, confirm_set_offline: true, operation_id: "offline-1",
    });
    expect(request).toHaveBeenLastCalledWith("media.health.setOffline", {
      projectItemIds: ["clip-1", "clip-2"], expectedOffline: false,
      confirmSetOffline: true, operationId: "offline-1",
    });

    const sourceMediaTiming = getUxpNextWorkflowTools(bridge).manage_source_media_timing_uxp;
    await sourceMediaTiming.handler({ action: "set_start", project_item_id: "clip-1", start_seconds: 12,
      expected_timing: { start_seconds: 10, duration_seconds: 60 }, confirm_set_start: true, operation_id: "source-time-1" });
    expect(request).toHaveBeenLastCalledWith("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 10, durationSeconds: 60 },
      startSeconds: 12, confirmSetStart: true, operationId: "source-time-1",
    });

    const sourceMediaOverrides = getUxpNextWorkflowTools(bridge).manage_source_media_overrides_uxp;
    await sourceMediaOverrides.handler({
      action: "update", project_item_id: "clip-1",
      expected_overrides: { project_guid: "project-1", frame_rate: 23.976, pixel_aspect_ratio: 1 },
      frame_rate: 25, pixel_aspect_ratio: { numerator: 4, denominator: 3 },
      confirm_media_interpretation: true, operation_id: "source-override-1",
    });
    expect(request).toHaveBeenLastCalledWith("source.mediaOverrides.update", {
      projectItemId: "clip-1",
      expectedOverrides: { projectGuid: "project-1", frameRate: 23.976, pixelAspectRatio: 1 },
      frameRate: 25, pixelAspectRatio: { numerator: 4, denominator: 3 },
      confirmMediaInterpretation: true, operationId: "source-override-1",
    });

    const tracks = getUxpNextWorkflowTools(bridge).manage_track_state_uxp;
    await tracks.handler({
      action: "set_mute", sequence_id: "sequence-1", expected_sequence_id: "sequence-1",
      media_type: "caption", track_indices: [0], muted: true, expected_muted: false, operation_id: "mute-1",
    });
    expect(request).toHaveBeenLastCalledWith("track.state.set", {
      sequenceId: "sequence-1", expectedSequenceId: "sequence-1",
      mediaType: "caption", trackIndices: [0], muted: true, expectedMuted: false, operationId: "mute-1",
    });

    const source = getUxpNextWorkflowTools(bridge).manage_source_clip_uxp;
    await source.handler({
      action: "update",
      items: [{
        project_item_id: "clip-1", media_type: "video", expected_in_seconds: 1,
        in_seconds: 2, out_seconds: 8, scale_to_frame: true,
      }],
      operation_id: "source-1",
    });
    expect(request).toHaveBeenLastCalledWith("source.clip.update", {
      items: [{
        projectItemId: "clip-1", mediaType: "video", expectedInSeconds: 1,
        inSeconds: 2, outSeconds: 8, scaleToFrame: true,
      }],
      operationId: "source-1",
    });
  });

  it("covers bounded event and readiness fallbacks without hiding bridge errors", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tools = getUxpNextWorkflowTools(bridge);

    await tools.inspect_premiere_events_uxp.handler({ action: "list" });
    expect(request).toHaveBeenLastCalledWith("events.list", {});
    await tools.inspect_premiere_events_uxp.handler({
      action: "list",
      after_revision: 0,
      categories: [],
      event_names: [],
      limit: 1,
      timeout_ms: 10,
    });
    expect(request).toHaveBeenLastCalledWith("events.list", {
      afterRevision: 0,
      categories: [],
      eventNames: [],
      limit: 1,
    });
    await expect(tools.inspect_premiere_events_uxp.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported event action: unsupported" });

    request.mockRejectedValueOnce(new Error("bridge unavailable"));
    await expect(tools.inspect_premiere_events_uxp.handler({ action: "wait" }))
      .resolves.toEqual({ success: false, error: "bridge unavailable" });
    request.mockRejectedValueOnce("plain failure");
    await expect(tools.inspect_premiere_events_uxp.handler({ action: "wait", timeout_ms: 0 }))
      .resolves.toEqual({ success: false, error: "plain failure" });

    await tools.wait_for_host_readiness_uxp.handler({ action: "snapshot" });
    expect(request).toHaveBeenLastCalledWith("readiness.snapshot", {});
    await tools.wait_for_host_readiness_uxp.handler({ action: "snapshot", sequence_id: "sequence-1" });
    expect(request).toHaveBeenLastCalledWith("readiness.snapshot", { sequenceId: "sequence-1" });
    await tools.wait_for_host_readiness_uxp.handler({ action: "analysis" });
    expect(request).toHaveBeenLastCalledWith(
      "readiness.analysis.wait", {}, { minimumTimeoutMs: 35000 },
    );
    await tools.wait_for_host_readiness_uxp.handler({ action: "operation" });
    expect(request).toHaveBeenLastCalledWith(
      "readiness.operation.wait", {}, { minimumTimeoutMs: 35000 },
    );
    await expect(tools.wait_for_host_readiness_uxp.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported readiness action: unsupported" });
  });

  it("covers every project-session route and its optional argument mappings", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).manage_project_sessions_uxp;

    await tool.handler({ action: "list" });
    expect(request).toHaveBeenLastCalledWith("project.sessions.list", {});
    await tool.handler({ action: "list", include_paths: false });
    expect(request).toHaveBeenLastCalledWith("project.sessions.list", { includePaths: false });
    await tool.handler({ action: "validate", path: "C:/work/source.prproj" });
    expect(request).toHaveBeenLastCalledWith("project.sessions.validate", { path: "C:/work/source.prproj" });

    await tool.handler({ action: "create", path: "C:/work/new.prproj" });
    expect(request).toHaveBeenLastCalledWith("project.sessions.create", { path: "C:/work/new.prproj" });
    await tool.handler({
      action: "create", path: "C:/work/new.prproj", confirm_external_write: true,
      confirm_overwrite: false, operation_id: "create-1",
    });
    expect(request).toHaveBeenLastCalledWith("project.sessions.create", {
      path: "C:/work/new.prproj", confirmExternalWrite: true,
      confirmOverwrite: false, operationId: "create-1",
    });

    await tool.handler({ action: "open", path: "C:/work/open.prproj" });
    expect(request).toHaveBeenLastCalledWith("project.sessions.open", { path: "C:/work/open.prproj" });
    await tool.handler({
      action: "open", path: "C:/work/open.prproj", show_dialogs: false,
      add_to_mru: true, operation_id: "open-1",
    });
    expect(request).toHaveBeenLastCalledWith("project.sessions.open", {
      path: "C:/work/open.prproj", showDialogs: false, addToMru: true, operationId: "open-1",
    });

    await tool.handler({ action: "save" });
    expect(request).toHaveBeenLastCalledWith("project.sessions.save", {});
    await tool.handler({ action: "save_as", path: "C:/work/copy.prproj" });
    expect(request).toHaveBeenLastCalledWith("project.sessions.saveAs", { path: "C:/work/copy.prproj" });
    await tool.handler({
      action: "save_as", project_id: "project-1", expected_path: "C:/work/source.prproj",
      path: "C:/work/copy.prproj", confirm_external_write: true,
      confirm_overwrite: true, operation_id: "save-as-1",
    });
    expect(request).toHaveBeenLastCalledWith("project.sessions.saveAs", {
      projectId: "project-1", expectedPath: "C:/work/source.prproj", operationId: "save-as-1",
      path: "C:/work/copy.prproj", confirmExternalWrite: true, confirmOverwrite: true,
    });

    await tool.handler({ action: "branch_copies", paths: ["C:/work/branch.prproj"] });
    expect(request).toHaveBeenLastCalledWith("project.sessions.branchCopies", {
      paths: ["C:/work/branch.prproj"],
    });
    await tool.handler({ action: "close" });
    expect(request).toHaveBeenLastCalledWith("project.sessions.close", {});
    await tool.handler({
      action: "close", project_id: "project-1", expected_path: "C:/work/source.prproj",
      save_before_close: false, confirm_close: true, confirm_discard_unsaved: true,
      operation_id: "close-1",
    });
    expect(request).toHaveBeenLastCalledWith("project.sessions.close", {
      projectId: "project-1", expectedPath: "C:/work/source.prproj", operationId: "close-1",
      saveBeforeClose: false, confirmClose: true, confirmDiscardUnsaved: true,
    });
    await expect(tool.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported project-session action: unsupported" });
  });

  it("covers growing-media status, lease defaults, resume targeting, and rejection", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).manage_growing_media_uxp;

    await tool.handler({ action: "status" });
    expect(request).toHaveBeenLastCalledWith("growing.status", {});
    await tool.handler({ action: "pause" });
    expect(request).toHaveBeenLastCalledWith("growing.pause", {});
    await tool.handler({ action: "resume" });
    expect(request).toHaveBeenLastCalledWith("growing.resume", {});
    await tool.handler({ action: "resume", project_id: "project-1", operation_id: "resume-1" });
    expect(request).toHaveBeenLastCalledWith("growing.resume", {
      projectId: "project-1", operationId: "resume-1",
    });
    await expect(tool.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported growing-media action: unsupported" });
  });

  it("covers checkpoint reads, typed writes, clears, and optional owner targeting", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).manage_workflow_checkpoints_uxp;

    await tool.handler({ action: "has", name: "render.pass" });
    expect(request).toHaveBeenLastCalledWith("checkpoint.has", { name: "render.pass" });
    await tool.handler({ action: "get", name: "render.pass" });
    expect(request).toHaveBeenLastCalledWith("checkpoint.get", { name: "render.pass" });
    await tool.handler({
      action: "get", owner: "project", sequence_id: "sequence-1",
      expected_owner_id: "project-1", name: "render.pass", value_type: "int",
    });
    expect(request).toHaveBeenLastCalledWith("checkpoint.get", {
      owner: "project", sequenceId: "sequence-1", expectedOwnerId: "project-1",
      name: "render.pass", valueType: "int",
    });

    await tool.handler({ action: "set", name: "render.pass" });
    expect(request).toHaveBeenLastCalledWith("checkpoint.set", { name: "render.pass" });
    await tool.handler({ action: "clear", name: "render.pass" });
    expect(request).toHaveBeenLastCalledWith("checkpoint.clear", { name: "render.pass" });
    await tool.handler({ action: "clear", name: "render.pass", operation_id: "clear-1" });
    expect(request).toHaveBeenLastCalledWith("checkpoint.clear", {
      name: "render.pass", operationId: "clear-1",
    });
    await expect(tool.handler({ action: "unsupported", name: "render.pass" }))
      .resolves.toEqual({ success: false, error: "Unsupported checkpoint action: unsupported" });
  });

  it("covers every media-health route with redacted defaults and explicit options", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).maintain_media_health_uxp;

    await tool.handler({ action: "inspect" });
    expect(request).toHaveBeenLastCalledWith("media.health.inspect", {});
    await tool.handler({ action: "inspect", project_item_ids: ["clip-1"], include_paths: false, include_media_timing: true });
    expect(request).toHaveBeenLastCalledWith("media.health.inspect", {
      projectItemIds: ["clip-1"], includePaths: false, includeMediaTiming: true,
    });
    await tool.handler({ action: "refresh" });
    expect(request).toHaveBeenLastCalledWith("media.health.refresh", {});
    await tool.handler({
      action: "refresh", project_item_ids: ["clip-1"], expected_offline: true,
      operation_id: "refresh-1",
    });
    expect(request).toHaveBeenLastCalledWith("media.health.refresh", {
      projectItemIds: ["clip-1"], expectedOffline: true, operationId: "refresh-1",
    });
    await tool.handler({ action: "set_offline" });
    expect(request).toHaveBeenLastCalledWith("media.health.setOffline", {});
    await tool.handler({ action: "find_by_media_path" });
    expect(request).toHaveBeenLastCalledWith("media.health.findByPath", {});
    await tool.handler({
      action: "find_by_media_path", project_item_id: "clip-1", match_path: "C:/media/a.mov",
      ignore_subclips: true, include_paths: true,
    });
    expect(request).toHaveBeenLastCalledWith("media.health.findByPath", {
      projectItemId: "clip-1", matchPath: "C:/media/a.mov",
      ignoreSubclips: true, includePaths: true,
    });
    await expect(tool.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported media-health action: unsupported" });
  });

  it("covers source-media timing inspection, guarded start mapping, and rejection", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).manage_source_media_timing_uxp;

    await tool.handler({ action: "inspect", project_item_id: "clip-1" });
    expect(request).toHaveBeenLastCalledWith("source.mediaTiming.inspect", { projectItemId: "clip-1" });
    await tool.handler({ action: "set_start", project_item_id: "clip-1" });
    expect(request).toHaveBeenLastCalledWith("source.mediaTiming.setStart", { projectItemId: "clip-1" });
    await tool.handler({
      action: "set_start", project_item_id: "clip-1", start_seconds: 12,
      expected_timing: { start_seconds: 10, duration_seconds: 60 }, confirm_set_start: false,
    });
    expect(request).toHaveBeenLastCalledWith("source.mediaTiming.setStart", {
      projectItemId: "clip-1", expectedTiming: { startSeconds: 10, durationSeconds: 60 },
      startSeconds: 12, confirmSetStart: false,
    });
    await expect(tool.handler({ action: "unsupported", project_item_id: "clip-1" }))
      .resolves.toEqual({ success: false, error: "Unsupported source-media timing action: unsupported" });
  });

  it("covers source-media override inspection, exact snapshot mapping, and rejection", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).manage_source_media_overrides_uxp;

    await tool.handler({ action: "inspect", project_item_id: "clip-1" });
    expect(request).toHaveBeenLastCalledWith("source.mediaOverrides.inspect", { projectItemId: "clip-1" });
    await tool.handler({ action: "update", project_item_id: "clip-1" });
    expect(request).toHaveBeenLastCalledWith("source.mediaOverrides.update", { projectItemId: "clip-1" });
    await tool.handler({
      action: "update", project_item_id: "clip-1",
      expected_overrides: { project_guid: "project-1", frame_rate: 23.976, pixel_aspect_ratio: 1 },
      pixel_aspect_ratio: { numerator: 4, denominator: 3 }, confirm_media_interpretation: false,
      operation_id: "source-override-1",
    });
    expect(request).toHaveBeenLastCalledWith("source.mediaOverrides.update", {
      projectItemId: "clip-1",
      expectedOverrides: { projectGuid: "project-1", frameRate: 23.976, pixelAspectRatio: 1 },
      pixelAspectRatio: { numerator: 4, denominator: 3 },
      confirmMediaInterpretation: false, operationId: "source-override-1",
    });
    await expect(tool.handler({ action: "unsupported", project_item_id: "clip-1" }))
      .resolves.toEqual({ success: false, error: "Unsupported source-media override action: unsupported" });
  });

  it("covers track-state inspection, mute defaults, and unsupported actions", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).manage_track_state_uxp;

    await tool.handler({ action: "inspect" });
    expect(request).toHaveBeenLastCalledWith("track.state.inspect", {});
    await tool.handler({
      action: "inspect", sequence_id: "sequence-1", expected_sequence_id: "sequence-1",
      media_type: "all", track_indices: [0, 1],
    });
    expect(request).toHaveBeenLastCalledWith("track.state.inspect", {
      sequenceId: "sequence-1", expectedSequenceId: "sequence-1",
      mediaType: "all", trackIndices: [0, 1],
    });
    await tool.handler({ action: "set_mute" });
    expect(request).toHaveBeenLastCalledWith("track.state.set", {});
    await expect(tool.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported track-state action: unsupported" });
  });

  it("covers source-clip inspection, complete mappings, absent items, and rejection", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { request, getState: vi.fn() } as unknown as UxpWebSocketBridge;
    const tool = getUxpNextWorkflowTools(bridge).manage_source_clip_uxp;

    await tool.handler({ action: "inspect" });
    expect(request).toHaveBeenLastCalledWith("source.clip.inspect", { items: undefined });
    await tool.handler({ action: "inspect", items: [{}] });
    expect(request).toHaveBeenLastCalledWith("source.clip.inspect", { items: [{}] });
    await tool.handler({
      action: "inspect",
      items: [{
        project_item_id: "clip-1", media_type: "audio",
        expected_in_seconds: 1, expected_out_seconds: 10,
        in_seconds: 2, out_seconds: 9, clear_in_out: false, scale_to_frame: true,
      }],
    });
    expect(request).toHaveBeenLastCalledWith("source.clip.inspect", {
      items: [{
        projectItemId: "clip-1", mediaType: "audio",
        expectedInSeconds: 1, expectedOutSeconds: 10,
        inSeconds: 2, outSeconds: 9, clearInOut: false, scaleToFrame: true,
      }],
    });
    await tool.handler({ action: "update" });
    expect(request).toHaveBeenLastCalledWith("source.clip.update", { items: undefined });
    await expect(tool.handler({ action: "unsupported" }))
      .resolves.toEqual({ success: false, error: "Unsupported source-clip action: unsupported" });
  });
});
